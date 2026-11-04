import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { diaChile } from "../common/fecha-chile";
import { hoyCl } from "../ot/plazos";
import { descontarFifo } from "./consumo-automatico";
import { ConversionError, aUnidadConsumo } from "./conversion";
import { AlcanceService } from "../rbac/alcance.service";
import { AlcanceResultadoService } from "../rbac/alcance-resultado.service";
import { ACTIVIDADES, VinculoError, actividadDelMovimiento, otDelMovimiento, resumenConsumos } from "./vinculo-movimiento";

// ---------------------------------------------------------------------------
// Módulo CONSUMIBLES · inventario por lotes + KARDEX de movimientos.
//
// Cubre el contrato §4.4.4 / §4.4.5:
//   · Inventario de compras: un consumible (reactivo, columna, estándar…) se
//     recibe en LOTES, cada uno con su stock, nº de lote y caducidad.
//   · Cada ensayo CONSUME una cantidad que se descuenta del stock del lote.
//   · El KARDEX registra los tres tipos de movimiento:
//       entrada  (compra / recepción)  -> suma stock
//       consumo  (por ensayo/muestra/método) -> resta stock (409 si insuficiente)
//       ajuste   (corrección de inventario, con signo) -> suma/resta stock
//   · Vínculo (§4.4.5): todo movimiento puede ligarse a una OT, una muestra,
//     un método y una actividad (vinculo-movimiento.ts). El descuento
//     automático de la captura lo hace siempre; en el registro manual es
//     opcional y el buscador de OT y muestras se acota al alcance del usuario.
//     La ficha de la OT muestra sus consumos (GET /consumibles/ot/:otId).
//   · Consumos pendientes: lo que una captura no pudo descontar por falta de
//     stock (regla «avisar», consumo-automatico.ts) queda en
//     `consumo_pendiente` y se regulariza aquí (descontar o descartar con motivo).
//
// Las tablas (`consumible`, `lote_consumible`, `movimiento_consumible`) las
// crea/alinea `packages/db/align_consumibles.sql` y —igual que equipos.module.ts
// y crm.module.ts— este módulo usa SQL crudo tipado sobre un PrismaClient propio,
// con aislamiento por tenant (req.user.tenantId), 404 cross-tenant y respuestas
// { data, meta }.
// ---------------------------------------------------------------------------

/* ========================================================================== */
/* Vocabularios y esquemas                                                     */
/* ========================================================================== */

const TIPOS_MOVIMIENTO = ["entrada", "consumo", "ajuste"] as const;

const emptyToNull = (v: unknown) => (v === "" ? null : v);
const optStr = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max).nullable().optional());
const optDate = () => z.preprocess(emptyToNull, z.string().nullable().optional());
const optUuid = () =>
  z.preprocess(emptyToNull, z.string().uuid().nullable().optional());
const optNum = () => z.preprocess(emptyToNull, z.coerce.number().nullable().optional());

/** DATE de Prisma llega como Date (medianoche UTC); toISOString evita el −1 día. */
const soloFecha = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return diaChile(v);
  return String(v).slice(0, 10);
};

const CrearConsumibleSchema = z.object({
  codigo: z.string().min(1).max(40),
  nombre: z.string().min(1).max(200),
  tipo: optStr(40),
  unidadMedida: optStr(20),
  proveedorId: optUuid(),
  stockMinimo: optNum(),
  activo: z.preprocess(emptyToNull, z.coerce.boolean().optional()),
  // §4.4.4: se compra en envases (unidadCompra) y se consume en unidadMedida.
  unidadCompra: optStr(30),
  factorConversion: z.preprocess(emptyToNull, z.coerce.number().positive().nullable().optional()),
  // Contrato 4.1.4: costo de referencia por unidad de medida (CLP); lo propone el costeo FORM05.
  costoUnitarioClp: z.preprocess(emptyToNull, z.coerce.number().nonnegative("El costo unitario no puede ser negativo.").max(1e12).nullable().optional()),
});
const ActualizarConsumibleSchema = CrearConsumibleSchema.partial();

const CrearLoteSchema = z.object({
  consumibleId: z.string().uuid(),
  numeroLote: z.string().min(1).max(80),
  fechaRecepcion: optDate(),
  fechaVencimiento: optDate(),
  cantidadInicial: z.coerce.number().nonnegative(),
  /** La cantidad viene en unidades de compra (envases): se multiplica por el factor. */
  enUnidadCompra: z.preprocess(emptyToNull, z.coerce.boolean().optional()),
  ubicacionId: optUuid(),
  estado: optStr(30),
});
const ActualizarLoteSchema = z.object({
  numeroLote: optStr(80),
  fechaRecepcion: optDate(),
  fechaVencimiento: optDate(),
  ubicacionId: optUuid(),
  estado: optStr(30),
});

const MovimientoSchema = z
  .object({
    tipo: z.enum(TIPOS_MOVIMIENTO),
    // El movimiento apunta a un lote concreto; si no se da, se resuelve por
    // FIFO de caducidad a partir del consumible (sólo para 'consumo').
    loteId: optUuid(),
    consumibleId: optUuid(),
    cantidad: z.coerce.number(),
    // Vínculo opcional (§4.4.5): OT, muestra, método y actividad.
    otId: optUuid(),
    muestraId: optUuid(),
    catMetodoId: optUuid(),
    actividad: optStr(20), // se valida con actividadDelMovimiento (mensaje en español)
    motivo: optStr(2000),
    /** La cantidad viene en unidades de compra (envases): se multiplica por el factor (§4.4.4). */
    enUnidadCompra: z.preprocess(emptyToNull, z.coerce.boolean().optional()),
  })
  .refine((d) => d.loteId || d.consumibleId, {
    message: "Se requiere loteId o consumibleId",
  })
  .refine((d) => d.tipo === "ajuste" || d.cantidad > 0, {
    message: "La cantidad debe ser mayor que 0 para entrada/consumo",
  })
  .refine((d) => d.tipo !== "ajuste" || d.cantidad !== 0, {
    message: "El ajuste no puede ser 0",
  });

/** Conversión a unidad de consumo; un consumible sin factor da 400 con el motivo. */
function convertir(cantidad: number, factor: unknown, enUnidadCompra: boolean | null | undefined): number {
  try {
    return aUnidadConsumo(cantidad, factor as any, enUnidadCompra);
  } catch (e) {
    if (e instanceof ConversionError) throw new BadRequestException(e.message);
    throw e;
  }
}

/** Vínculo efectivo de un movimiento (§4.4.5). */
interface Vinculo {
  otId: string | null;
  muestraId: string | null;
  catMetodoId: string | null;
  actividad: string | null;
}

/* ========================================================================== */
/* ConsumiblesService                                                          */
/* ========================================================================== */

@Injectable()
export class ConsumiblesService {
  private prisma = new PrismaClient();

  constructor(
    private readonly alcance: AlcanceService,
    private readonly alcanceResultado: AlcanceResultadoService,
  ) {}

  tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }
  private usuarioId(req: any): string | null {
    return req?.user?.sub ?? req?.user?.id ?? req?.user?.usuarioId ?? null;
  }

  /* --- consumibles (catálogo) ------------------------------------------- */

  async listarConsumibles(
    tenantId: string,
    opts: { page: number; limit: number; search?: string; soloActivos?: boolean },
  ) {
    const { page, limit, search, soloActivos } = opts;
    const offset = (page - 1) * limit;

    const args: any[] = [tenantId];
    const filtros: string[] = [];
    if (soloActivos) filtros.push(`AND c.activo = TRUE`);
    if (search) {
      args.push(`%${search}%`);
      filtros.push(`AND (c.codigo ILIKE $${args.length} OR c.nombre ILIKE $${args.length})`);
    }
    const where = filtros.join(" ");

    // Stock agregado por lotes + flags de caducado / bajo stock (para la UI).
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*,
              COALESCE(s.stock_total, 0)               AS stock_total,
              COALESCE(s.lotes, 0)                     AS lotes,
              COALESCE(s.lotes_caducados, 0)           AS lotes_caducados,
              (c.stock_minimo IS NOT NULL
               AND COALESCE(s.stock_total,0) < c.stock_minimo) AS bajo_stock
         FROM consumible c
         LEFT JOIN (
           SELECT consumible_id,
                  SUM(cantidad_actual)                                    AS stock_total,
                  COUNT(*)                                                AS lotes,
                  COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL
                                     AND fecha_vencimiento < CURRENT_DATE
                                     AND cantidad_actual > 0)             AS lotes_caducados
             FROM lote_consumible
            WHERE tenant_id = $1::uuid
            GROUP BY consumible_id
         ) s ON s.consumible_id = c.id
        WHERE c.tenant_id = $1::uuid ${where}
        ORDER BY c.codigo ASC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      ...args,
    );

    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM consumible c
        WHERE c.tenant_id = $1::uuid ${where}`,
      ...args,
    );

    const kpiRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT
         (SELECT COUNT(*)::int FROM consumible WHERE tenant_id = $1::uuid) AS total,
         (SELECT COUNT(*)::int FROM lote_consumible
            WHERE tenant_id = $1::uuid
              AND fecha_vencimiento IS NOT NULL
              AND fecha_vencimiento < CURRENT_DATE
              AND cantidad_actual > 0)                                     AS lotes_caducados,
         (SELECT COUNT(*)::int FROM lote_consumible
            WHERE tenant_id = $1::uuid
              AND fecha_vencimiento IS NOT NULL
              AND fecha_vencimiento >= CURRENT_DATE
              AND fecha_vencimiento < CURRENT_DATE + 30
              AND cantidad_actual > 0)                                     AS lotes_por_vencer,
         (SELECT COUNT(*)::int FROM consumible c
            WHERE c.tenant_id = $1::uuid AND c.stock_minimo IS NOT NULL
              AND COALESCE((SELECT SUM(cantidad_actual) FROM lote_consumible l
                             WHERE l.consumible_id = c.id AND l.tenant_id = $1::uuid),0)
                  < c.stock_minimo)                                        AS bajo_stock`,
      tenantId,
    );

    const total = Number(totalRows[0]?.total ?? 0);
    const norm = data.map((r) => ({
      ...r,
      stock_total: Number(r.stock_total ?? 0),
      lotes: Number(r.lotes ?? 0),
      lotes_caducados: Number(r.lotes_caducados ?? 0),
    }));
    return {
      data: norm,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        kpis: kpiRows[0] ?? {},
      },
    };
  }

  async cargarConsumible(id: string, tenantId: string): Promise<any> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*,
              COALESCE((SELECT SUM(cantidad_actual) FROM lote_consumible l
                         WHERE l.consumible_id = c.id AND l.tenant_id = $2::uuid),0) AS stock_total
         FROM consumible c
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid
        LIMIT 1`,
      id,
      tenantId,
    );
    if (!rows.length) throw new NotFoundException("Consumible no encontrado");
    const r = rows[0];
    r.stock_total = Number(r.stock_total ?? 0);
    r.lotes = await this.lotesDeConsumible(id, tenantId);
    return r;
  }

  async crearConsumible(tenantId: string, d: z.infer<typeof CrearConsumibleSchema>) {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO consumible
           (tenant_id, codigo, nombre, tipo, unidad_medida, proveedor_id, stock_minimo, activo, unidad_compra, factor_conversion, costo_unitario_clp)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11)
         RETURNING *`,
        tenantId,
        d.codigo,
        d.nombre,
        d.tipo ?? null,
        d.unidadMedida ?? null,
        d.proveedorId ?? null,
        d.stockMinimo ?? null,
        d.activo ?? true,
        d.unidadCompra ?? null,
        d.factorConversion ?? null,
        d.costoUnitarioClp ?? null,
      );
      return rows[0];
    } catch (e: any) {
      if (String(e?.message ?? "").includes("consumible_tenant_id_codigo_key"))
        throw new ConflictException(`Ya existe un consumible con el código ${d.codigo}`);
      throw e;
    }
  }

  async actualizarConsumible(id: string, tenantId: string, d: Record<string, unknown>) {
    await this.cargarConsumible(id, tenantId);
    const COLS: Record<string, string> = {
      codigo: "codigo",
      nombre: "nombre",
      tipo: "tipo",
      unidadMedida: "unidad_medida",
      proveedorId: "proveedor_id",
      stockMinimo: "stock_minimo",
      activo: "activo",
      unidadCompra: "unidad_compra",
      factorConversion: "factor_conversion",
      costoUnitarioClp: "costo_unitario_clp",
    };
    const CAST: Record<string, string> = { proveedor_id: "::uuid" };
    const sets: string[] = [];
    const args: any[] = [id, tenantId];
    for (const [key, col] of Object.entries(COLS)) {
      if (key in d) {
        args.push(d[key] ?? null);
        sets.push(`${col} = $${args.length}${CAST[col] ?? ""}`);
      }
    }
    if (sets.length) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE consumible SET ${sets.join(", ")}
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        ...args,
      );
    }
    return this.cargarConsumible(id, tenantId);
  }

  /** Baja lógica: activo = FALSE (no hay deleted_at en esta tabla). */
  async eliminarConsumible(id: string, tenantId: string) {
    await this.cargarConsumible(id, tenantId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE consumible SET activo = FALSE WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      id,
      tenantId,
    );
    return { ok: true };
  }

  /* --- lotes ------------------------------------------------------------- */

  async lotesDeConsumible(consumibleId: string, tenantId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT l.*,
              (l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < CURRENT_DATE) AS caducado,
              (l.fecha_vencimiento IS NOT NULL
               AND l.fecha_vencimiento >= CURRENT_DATE
               AND l.fecha_vencimiento < CURRENT_DATE + 30)                            AS por_vencer
         FROM lote_consumible l
        WHERE l.consumible_id = $1::uuid AND l.tenant_id = $2::uuid
        ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.numero_lote ASC`,
      consumibleId,
      tenantId,
    );
    return rows.map((r) => ({ ...r, cantidad_actual: Number(r.cantidad_actual ?? 0) }));
  }

  async listarLotes(
    tenantId: string,
    opts: { page: number; limit: number; consumibleId?: string; soloDisponibles?: boolean },
  ) {
    const { page, limit, consumibleId, soloDisponibles } = opts;
    const offset = (page - 1) * limit;
    const args: any[] = [tenantId];
    const filtros: string[] = [];
    if (consumibleId) {
      args.push(consumibleId);
      filtros.push(`AND l.consumible_id = $${args.length}::uuid`);
    }
    if (soloDisponibles) filtros.push(`AND l.cantidad_actual > 0`);
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT l.*, c.codigo AS consumible_codigo, c.nombre AS consumible_nombre,
              c.unidad_medida,
              (l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < CURRENT_DATE) AS caducado
         FROM lote_consumible l
         JOIN consumible c ON c.id = l.consumible_id
        WHERE l.tenant_id = $1::uuid ${where}
        ORDER BY l.fecha_vencimiento ASC NULLS LAST, c.codigo ASC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      ...args,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM lote_consumible l
        WHERE l.tenant_id = $1::uuid ${where}`,
      ...args,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    return {
      data: data.map((r) => ({ ...r, cantidad_actual: Number(r.cantidad_actual ?? 0) })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async cargarLote(id: string, tenantId: string): Promise<any> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT l.*, c.codigo AS consumible_codigo, c.nombre AS consumible_nombre, c.unidad_medida
         FROM lote_consumible l
         JOIN consumible c ON c.id = l.consumible_id
        WHERE l.id = $1::uuid AND l.tenant_id = $2::uuid
        LIMIT 1`,
      id,
      tenantId,
    );
    if (!rows.length) throw new NotFoundException("Lote no encontrado");
    return rows[0];
  }

  /**
   * Crea un lote y, si trae stock inicial > 0, asienta el movimiento de
   * `entrada` correspondiente (así el kardex arranca cuadrado desde el alta).
   */
  async crearLote(
    tenantId: string,
    usuarioId: string | null,
    d: z.infer<typeof CrearLoteSchema>,
  ) {
    // El consumible debe ser del tenant (404 cross-tenant).
    const con = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, factor_conversion FROM consumible WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      d.consumibleId,
      tenantId,
    );
    if (!con.length) throw new NotFoundException("Consumible no encontrado");
    // §4.4.4: lo recibido en envases entra al stock en unidad de consumo.
    d = { ...d, cantidadInicial: convertir(d.cantidadInicial, con[0].factor_conversion, d.enUnidadCompra) };

    return this.prisma.$transaction(async (tx) => {
      let lote: any;
      try {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO lote_consumible
             (tenant_id, consumible_id, numero_lote, fecha_recepcion, fecha_vencimiento,
              cantidad_inicial, cantidad_actual, ubicacion_id, estado)
           VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6, $6, $7::uuid, $8)
           RETURNING *`,
          tenantId,
          d.consumibleId,
          d.numeroLote,
          d.fechaRecepcion ?? null,
          d.fechaVencimiento ?? null,
          d.cantidadInicial,
          d.ubicacionId ?? null,
          d.estado ?? "disponible",
        );
        lote = rows[0];
      } catch (e: any) {
        if (String(e?.message ?? "").includes("lote_consumible_consumible_id_numero_lote_key"))
          throw new ConflictException(`Ya existe el lote ${d.numeroLote} para este consumible`);
        throw e;
      }

      if (Number(d.cantidadInicial) > 0) {
        await tx.$executeRawUnsafe(
          `INSERT INTO movimiento_consumible
             (tenant_id, lote_id, tipo, cantidad, motivo, created_by)
           VALUES ($1::uuid, $2::uuid, 'entrada', $3, $4, $5::uuid)`,
          tenantId,
          lote.id,
          d.cantidadInicial,
          "Alta de lote (stock inicial)",
          usuarioId,
        );
      }
      return lote;
    });
  }

  async actualizarLote(id: string, tenantId: string, d: Record<string, unknown>) {
    await this.cargarLote(id, tenantId);
    const COLS: Record<string, string> = {
      numeroLote: "numero_lote",
      fechaRecepcion: "fecha_recepcion",
      fechaVencimiento: "fecha_vencimiento",
      ubicacionId: "ubicacion_id",
      estado: "estado",
    };
    const CAST: Record<string, string> = {
      fecha_recepcion: "::date",
      fecha_vencimiento: "::date",
      ubicacion_id: "::uuid",
    };
    const sets: string[] = [];
    const args: any[] = [id, tenantId];
    for (const [key, col] of Object.entries(COLS)) {
      if (key in d) {
        args.push(d[key] ?? null);
        sets.push(`${col} = $${args.length}${CAST[col] ?? ""}`);
      }
    }
    if (sets.length) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE lote_consumible SET ${sets.join(", ")}
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        ...args,
      );
    }
    return this.cargarLote(id, tenantId);
  }

  /** Sólo se puede borrar un lote sin movimientos de consumo/ajuste (traza intacta). */
  async eliminarLote(id: string, tenantId: string) {
    await this.cargarLote(id, tenantId);
    const movs = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS n FROM movimiento_consumible
        WHERE lote_id = $1::uuid AND tenant_id = $2::uuid AND tipo <> 'entrada'`,
      id,
      tenantId,
    );
    if (Number(movs[0]?.n ?? 0) > 0)
      throw new ConflictException(
        "El lote tiene movimientos de consumo/ajuste y no puede eliminarse. Use un ajuste para corregir el stock.",
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM movimiento_consumible WHERE lote_id = $1::uuid AND tenant_id = $2::uuid`,
        id,
        tenantId,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM lote_consumible WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        id,
        tenantId,
      );
    });
    return { ok: true };
  }

  /* --- movimientos (KARDEX) ---------------------------------------------- */

  /**
   * Registra un movimiento y actualiza el stock del lote en la MISMA
   * transacción, con `SELECT ... FOR UPDATE` sobre el lote para serializar
   * consumos concurrentes (sin él, dos consumos simultáneos leerían el mismo
   * stock y podrían dejarlo negativo).
   *
   *   entrada -> stock += cantidad
   *   consumo -> valida stock >= cantidad (409 si no), stock -= cantidad
   *   ajuste  -> stock += cantidad (con signo); 409 si dejara stock < 0
   *
   * Para 'consumo' sin loteId se elige el lote con stock por FIFO de caducidad
   * (fecha_vencimiento más próxima primero).
   */
  async registrarMovimiento(
    tenantId: string,
    usuarioId: string | null,
    d: z.infer<typeof MovimientoSchema>,
    vinculo: Vinculo = { otId: null, muestraId: null, catMetodoId: null, actividad: null },
  ) {
    if (d.enUnidadCompra) {
      const [c] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.factor_conversion FROM consumible c
          WHERE c.tenant_id = $1::uuid AND c.id = COALESCE($2::uuid, (SELECT consumible_id FROM lote_consumible WHERE id = $3::uuid))`,
        tenantId,
        d.consumibleId ?? null,
        d.loteId ?? null,
      );
      if (!c) throw new NotFoundException("Consumible no encontrado");
      d = { ...d, cantidad: convertir(d.cantidad, c.factor_conversion, true) };
    }
    return this.prisma.$transaction(async (tx) => {
      let loteId = d.loteId ?? null;

      // FIFO por caducidad si no se especificó el lote.
      if (!loteId) {
        if (d.tipo !== "consumo")
          throw new ConflictException("entrada y ajuste requieren un loteId explícito");
        const cand = await tx.$queryRawUnsafe<any[]>(
          `SELECT id FROM lote_consumible
            WHERE consumible_id = $1::uuid AND tenant_id = $2::uuid AND cantidad_actual >= $3
            ORDER BY fecha_vencimiento ASC NULLS LAST, numero_lote ASC
            LIMIT 1
            FOR UPDATE`,
          d.consumibleId,
          tenantId,
          d.cantidad,
        );
        if (!cand.length)
          throw new ConflictException({
            statusCode: 409,
            error: "Stock insuficiente",
            message:
              "Ningún lote del consumible tiene stock suficiente para cubrir el consumo solicitado.",
          });
        loteId = cand[0].id;
      }

      // Bloquea el lote y valida pertenencia al tenant.
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, cantidad_actual, numero_lote FROM lote_consumible
          WHERE id = $1::uuid AND tenant_id = $2::uuid
          FOR UPDATE`,
        loteId,
        tenantId,
      );
      if (!rows.length) throw new NotFoundException("Lote no encontrado");
      const stockActual = Number(rows[0].cantidad_actual ?? 0);

      // delta con signo: cuánto cambia el stock.
      let delta: number;
      if (d.tipo === "entrada") delta = Math.abs(d.cantidad);
      else if (d.tipo === "consumo") delta = -Math.abs(d.cantidad);
      else delta = d.cantidad; // ajuste: viene con signo

      const nuevo = stockActual + delta;
      if (nuevo < 0) {
        throw new ConflictException({
          statusCode: 409,
          error: "Stock insuficiente",
          message:
            d.tipo === "consumo"
              ? `Stock insuficiente en el lote ${rows[0].numero_lote}: disponible ${stockActual}, se solicitó ${Math.abs(
                  d.cantidad,
                )}.`
              : `El ajuste dejaría el stock del lote ${rows[0].numero_lote} en negativo (actual ${stockActual}, ajuste ${d.cantidad}).`,
          loteId,
          stockActual,
        });
      }

      await tx.$executeRawUnsafe(
        `UPDATE lote_consumible
            SET cantidad_actual = $3,
                estado = CASE WHEN $3 <= 0 THEN 'agotado'
                              WHEN estado = 'agotado' THEN 'disponible'
                              ELSE estado END
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        loteId,
        tenantId,
        nuevo,
      );

      // El asiento guarda la MAGNITUD del movimiento (con signo sólo en ajuste).
      const cantidadAsiento = d.tipo === "ajuste" ? d.cantidad : Math.abs(d.cantidad);
      const mov = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO movimiento_consumible
           (tenant_id, lote_id, tipo, cantidad, muestra_id, cat_metodo_id, motivo, created_by, ot_id, actividad)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, $8::uuid, $9::uuid, $10)
         RETURNING *`,
        tenantId,
        loteId,
        d.tipo,
        cantidadAsiento,
        vinculo.muestraId,
        vinculo.catMetodoId,
        d.motivo ?? null,
        usuarioId,
        vinculo.otId,
        vinculo.actividad,
      );
      return { ...mov[0], stock_resultante: nuevo };
    });
  }

  /* --- vínculo con OT / muestra / método / actividad (§4.4.5) ------------- */

  /**
   * Valida el vínculo de un movimiento manual: la OT y la muestra existen y son
   * del alcance del usuario, la muestra es de la OT, el método existe y la
   * actividad es de la lista. Devuelve el vínculo efectivo (OT de la muestra si
   * no se indicó; «análisis» si hay muestra o método y no se eligió actividad).
   */
  async resolverVinculo(req: any, tenantId: string, d: z.infer<typeof MovimientoSchema>): Promise<Vinculo> {
    let muestra: { id: string; codigo: string; otId: string | null; otCodigo: string | null } | null = null;
    if (d.muestraId) {
      const [m] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT m.id, m.codigo, m.ot_id, o.codigo AS ot_codigo, o.unidad_principal
           FROM muestra m LEFT JOIN orden_trabajo o ON o.id = m.ot_id
          WHERE m.id = $1::uuid AND m.tenant_id = $2::uuid AND m.deleted_at IS NULL`,
        d.muestraId,
        tenantId,
      );
      if (!m) throw new NotFoundException("La muestra elegida no existe.");
      if (m.ot_id) await this.exigirOt(req, { id: m.ot_id, codigo: m.ot_codigo, unidadPrincipal: m.unidad_principal });
      muestra = { id: m.id, codigo: m.codigo, otId: m.ot_id, otCodigo: m.ot_codigo };
    }
    if (d.otId && d.otId !== muestra?.otId) {
      const [o] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        d.otId,
        tenantId,
      );
      if (!o) throw new NotFoundException("La OT elegida no existe.");
      await this.exigirOt(req, { id: o.id, codigo: o.codigo, unidadPrincipal: o.unidad_principal });
    }
    if (d.catMetodoId) {
      const [me] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM cat_metodo WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
        d.catMetodoId,
        tenantId,
      );
      if (!me) throw new NotFoundException("El método elegido no existe.");
    }
    try {
      return {
        otId: otDelMovimiento(d.otId, muestra),
        muestraId: d.muestraId ?? null,
        catMetodoId: d.catMetodoId ?? null,
        actividad: actividadDelMovimiento(d.actividad, d),
      };
    } catch (e) {
      if (e instanceof VinculoError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** La OT es del alcance del usuario (su laboratorio o uno que participa por orden interna). */
  private async exigirOt(req: any, ot: { id: string; codigo: string; unidadPrincipal: string | null }) {
    try {
      await this.alcanceResultado.alcanceEnOt(req, ot, "consumible.gestionar");
    } catch {
      throw new ForbiddenException(`La OT ${ot.codigo} es de un laboratorio fuera de su alcance.`);
    }
  }

  /**
   * Buscador del formulario de movimiento: OT, muestras o métodos que contienen
   * el texto. OT y muestras, solo de los laboratorios del alcance del usuario;
   * los métodos de la muestra elegida aparecen primero.
   */
  async buscarVinculo(req: any, tenantId: string, tipo: string, q: string, filtros: { otId?: string; muestraId?: string }) {
    const texto = `%${q.trim().slice(0, 60)}%`;
    const unidades = await this.alcance.filtroUnidades(req, "consumible.gestionar");
    if (tipo === "ot") {
      return this.prisma.$queryRawUnsafe<any[]>(
        `SELECT o.id, o.codigo, c.razon_social AS detalle, o.estado
           FROM orden_trabajo o LEFT JOIN cliente c ON c.id = o.cliente_id
          WHERE o.tenant_id = $1::uuid AND (o.codigo ILIKE $2 OR c.razon_social ILIKE $2)
            AND ($3::uuid[] IS NULL OR o.unidad_principal = ANY($3::uuid[]))
          ORDER BY o.created_at DESC LIMIT 20`,
        tenantId,
        texto,
        unidades,
      );
    }
    if (tipo === "muestra") {
      return this.prisma.$queryRawUnsafe<any[]>(
        `SELECT m.id, m.codigo, m.nombre AS detalle, m.ot_id AS "otId", o.codigo AS "otCodigo"
           FROM muestra m LEFT JOIN orden_trabajo o ON o.id = m.ot_id
          WHERE m.tenant_id = $1::uuid AND m.deleted_at IS NULL AND (m.codigo ILIKE $2 OR m.nombre ILIKE $2)
            AND ($3::uuid IS NULL OR m.ot_id = $3::uuid)
            AND ($4::uuid[] IS NULL OR o.unidad_principal = ANY($4::uuid[]))
          ORDER BY m.created_at DESC LIMIT 20`,
        tenantId,
        texto,
        filtros.otId ?? null,
        unidades,
      );
    }
    if (tipo === "metodo") {
      return this.prisma.$queryRawUnsafe<any[]>(
        `SELECT me.id, me.codigo, me.nombre AS detalle,
                EXISTS (SELECT 1 FROM resultado r WHERE r.cat_metodo_id = me.id AND r.muestra_id = $3::uuid AND r.deleted_at IS NULL) AS "deLaMuestra"
           FROM cat_metodo me
          WHERE me.tenant_id = $1::uuid AND me.deleted_at IS NULL AND me.activo AND (me.codigo ILIKE $2 OR me.nombre ILIKE $2)
          ORDER BY 4 DESC, me.codigo LIMIT 20`,
        tenantId,
        texto,
        filtros.muestraId ?? null,
      );
    }
    throw new BadRequestException("Indique qué buscar: ot, muestra o metodo.");
  }

  /**
   * Consumos de una OT (ficha de la OT, §4.4.5): movimientos de lotes ligados a
   * la OT o a sus muestras —automáticos de la captura y manuales— y los
   * consumos pendientes de descontar de sus muestras.
   */
  async consumosDeOt(req: any, otId: string) {
    const tenantId = this.tenantId(req);
    const [ot] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      otId,
      tenantId,
    );
    if (!ot) throw new NotFoundException("OT no encontrada");
    await this.alcanceResultado.alcanceEnOt(req, { id: ot.id, codigo: ot.codigo, unidadPrincipal: ot.unidad_principal }, "ot.ver");
    const movimientos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT mv.id, mv.tipo, mv.cantidad::float AS cantidad, mv.actividad, mv.automatico, mv.motivo, mv.created_at,
              c.codigo AS consumible_codigo, c.nombre AS consumible_nombre, c.unidad_medida,
              l.numero_lote, l.fecha_vencimiento,
              mu.codigo AS muestra_codigo, me.codigo AS metodo_codigo, me.nombre AS metodo_nombre,
              u.nombre_completo AS usuario_nombre
         FROM movimiento_consumible mv
         JOIN lote_consumible l ON l.id = mv.lote_id
         JOIN consumible c ON c.id = l.consumible_id
         LEFT JOIN muestra mu ON mu.id = mv.muestra_id
         LEFT JOIN cat_metodo me ON me.id = mv.cat_metodo_id
         LEFT JOIN usuario u ON u.id = mv.created_by
        WHERE mv.tenant_id = $2::uuid
          AND (mv.ot_id = $1::uuid OR mu.ot_id = $1::uuid)
        ORDER BY mv.created_at DESC, mv.id
        LIMIT 1000`,
      otId,
      tenantId,
    );
    const pendientes = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.cantidad::float AS cantidad, p.referencia, p.created_at, c.codigo AS consumible_codigo, c.nombre AS consumible_nombre,
              c.unidad_medida, mu.codigo AS muestra_codigo, me.codigo AS metodo_codigo
         FROM consumo_pendiente p
         JOIN consumible c ON c.id = p.consumible_id
         JOIN muestra mu ON mu.id = p.muestra_id
         LEFT JOIN cat_metodo me ON me.id = p.cat_metodo_id
        WHERE p.tenant_id = $2::uuid AND mu.ot_id = $1::uuid AND p.estado = 'pendiente'
        ORDER BY p.created_at DESC`,
      otId,
      tenantId,
    );
    return { ot: { id: ot.id, codigo: ot.codigo }, actividades: ACTIVIDADES, resumen: resumenConsumos(movimientos), movimientos, pendientes };
  }

  /* --- consumos pendientes (captura sin stock con la regla «avisar») ------- */

  async listarPendientes(tenantId: string, todos: boolean) {
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.consumible_id, c.codigo AS consumible_codigo, c.nombre AS consumible_nombre, c.unidad_medida,
              p.cantidad::float AS cantidad, p.referencia, p.estado, p.created_at, p.resuelto_en, p.motivo_resolucion, p.lotes,
              mu.codigo AS muestra_codigo, me.codigo AS metodo_codigo, me.nombre AS metodo_nombre,
              uc.nombre_completo AS creado_por_nombre, ur.nombre_completo AS resuelto_por_nombre,
              (SELECT COALESCE(SUM(l.cantidad_actual), 0)::float FROM lote_consumible l
                WHERE l.consumible_id = p.consumible_id AND l.tenant_id = p.tenant_id AND l.cantidad_actual > 0
                  AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= $3::date)) AS disponible
         FROM consumo_pendiente p
         JOIN consumible c ON c.id = p.consumible_id
         LEFT JOIN muestra mu ON mu.id = p.muestra_id
         LEFT JOIN cat_metodo me ON me.id = p.cat_metodo_id
         LEFT JOIN usuario uc ON uc.id = p.creado_por
         LEFT JOIN usuario ur ON ur.id = p.resuelto_por
        WHERE p.tenant_id = $1::uuid AND ($2::boolean OR p.estado = 'pendiente')
        ORDER BY (p.estado = 'pendiente') DESC, p.created_at DESC
        LIMIT 500`,
      tenantId,
      todos,
      hoyCl(),
    );
    return { data, meta: { total: data.length, pendientes: data.filter((x) => x.estado === "pendiente").length } };
  }

  private async pendiente(id: string, tenantId: string) {
    const [p] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.*, p.cantidad::float AS cantidad_num, c.codigo, c.nombre FROM consumo_pendiente p JOIN consumible c ON c.id = p.consumible_id
        WHERE p.id = $1::uuid AND p.tenant_id = $2::uuid`,
      id,
      tenantId,
    );
    if (!p) throw new NotFoundException("Consumo pendiente no encontrado");
    if (p.estado !== "pendiente") throw new ConflictException("Este consumo ya fue regularizado.");
    return p;
  }

  /** Descuenta ahora el consumo pendiente (FIFO de caducidad, lotes vigentes). */
  async descontarPendiente(id: string, tenantId: string, usuarioId: string | null) {
    const p = await this.pendiente(id, tenantId);
    // Se marca primero (condicional) para que dos clics no descuenten dos veces.
    const marcadas = await this.prisma.$executeRawUnsafe(
      `UPDATE consumo_pendiente SET estado = 'descontado', resuelto_por = $2::uuid, resuelto_en = now() WHERE id = $1::uuid AND estado = 'pendiente'`,
      id,
      usuarioId,
    );
    if (!marcadas) throw new ConflictException("Este consumo ya fue regularizado.");
    const r = await descontarFifo(this.prisma as any, {
      tenantId,
      consumibleId: p.consumible_id,
      cantidad: Number(p.cantidad_num),
      muestraId: p.muestra_id,
      catMetodoId: p.cat_metodo_id,
      resultadoId: p.resultado_id,
      automatico: false,
      motivo: `Regularización de consumo pendiente · ${p.referencia ?? ""}`,
      usuarioId,
    }).catch(async (e) => {
      await this.prisma.$executeRawUnsafe(`UPDATE consumo_pendiente SET estado = 'pendiente', resuelto_por = NULL, resuelto_en = NULL WHERE id = $1::uuid`, id);
      throw e;
    });
    if ("disponible" in r) {
      await this.prisma.$executeRawUnsafe(`UPDATE consumo_pendiente SET estado = 'pendiente', resuelto_por = NULL, resuelto_en = NULL WHERE id = $1::uuid`, id);
      throw new ConflictException({
        statusCode: 409,
        error: "Stock insuficiente",
        message: `Aún no hay stock vigente de ${p.codigo} · ${p.nombre}: se necesitan ${p.cantidad_num} y hay ${r.disponible}. Registre la entrada del lote y vuelva a intentarlo.`,
      });
    }
    await this.prisma.$executeRawUnsafe(`UPDATE consumo_pendiente SET lotes = $2 WHERE id = $1::uuid`, id, r.lotes.join(", "));
    return { ok: true, lotes: r.lotes };
  }

  /** Descarta el pendiente (p. ej. el consumible no se usó): exige motivo y no toca el stock. */
  async descartarPendiente(id: string, tenantId: string, usuarioId: string | null, motivo: unknown) {
    const m = typeof motivo === "string" ? motivo.trim().slice(0, 1000) : "";
    if (m.length < 5) throw new BadRequestException("Indique el motivo para descartar el consumo pendiente.");
    await this.pendiente(id, tenantId);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE consumo_pendiente SET estado = 'descartado', resuelto_por = $2::uuid, resuelto_en = now(), motivo_resolucion = $3 WHERE id = $1::uuid AND estado = 'pendiente'`,
      id,
      usuarioId,
      m,
    );
    if (!n) throw new ConflictException("Este consumo ya fue regularizado.");
    return { ok: true };
  }

  /**
   * KARDEX de un consumible: todos los movimientos de sus lotes en orden
   * cronológico, con saldo corrido, y el resumen de stock.
   * stock_actual = Σ entradas − Σ consumos ± Σ ajustes = Σ cantidad_actual de lotes.
   */
  async kardex(consumibleId: string, tenantId: string) {
    const consumible = await this.cargarConsumible(consumibleId, tenantId);

    const movs = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.*,
              l.numero_lote,
              mu.codigo AS muestra_codigo,
              me.codigo AS metodo_codigo,
              me.nombre AS metodo_nombre,
              COALESCE(o.codigo, om.codigo) AS ot_codigo,
              u.nombre_completo AS usuario_nombre
         FROM movimiento_consumible m
         JOIN lote_consumible l ON l.id = m.lote_id
         LEFT JOIN muestra   mu ON mu.id = m.muestra_id
         LEFT JOIN orden_trabajo o  ON o.id = m.ot_id
         LEFT JOIN orden_trabajo om ON om.id = mu.ot_id
         LEFT JOIN cat_metodo me ON me.id = m.cat_metodo_id
         LEFT JOIN usuario    u ON u.id = m.created_by
        WHERE l.consumible_id = $1::uuid AND m.tenant_id = $2::uuid
        ORDER BY m.created_at ASC, m.id ASC`,
      consumibleId,
      tenantId,
    );

    // Saldo corrido global del consumible.
    let saldo = 0;
    const data = movs.map((m) => {
      const c = Number(m.cantidad ?? 0);
      const delta = m.tipo === "entrada" ? c : m.tipo === "consumo" ? -c : c;
      saldo += delta;
      return { ...m, cantidad: c, delta, saldo };
    });

    const resumen = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT
         COALESCE(SUM(cantidad) FILTER (WHERE tipo = 'entrada'),0) AS total_entradas,
         COALESCE(SUM(cantidad) FILTER (WHERE tipo = 'consumo'),0) AS total_consumos,
         COALESCE(SUM(cantidad) FILTER (WHERE tipo = 'ajuste'),0)  AS total_ajustes
         FROM movimiento_consumible m
         JOIN lote_consumible l ON l.id = m.lote_id
        WHERE l.consumible_id = $1::uuid AND m.tenant_id = $2::uuid`,
      consumibleId,
      tenantId,
    );
    const r = resumen[0] ?? {};

    return {
      data,
      meta: {
        total: data.length,
        consumible: {
          id: consumible.id,
          codigo: consumible.codigo,
          nombre: consumible.nombre,
          unidad_medida: consumible.unidad_medida,
          stock_minimo: consumible.stock_minimo,
        },
        actividades: ACTIVIDADES,
        resumen: {
          total_entradas: Number(r.total_entradas ?? 0),
          total_consumos: Number(r.total_consumos ?? 0),
          total_ajustes: Number(r.total_ajustes ?? 0),
          // stock por asientos (debe coincidir con el stock por lotes).
          stock_actual: Number(consumible.stock_total ?? 0),
        },
      },
    };
  }
}

/* ========================================================================== */
/* Controller                                                                  */
/* ========================================================================== */

const pag = (page: string, limit: string, max = 500, def = 100) => ({
  page: Math.max(1, parseInt(page) || 1),
  limit: Math.min(max, Math.max(1, parseInt(limit) || def)),
});

@ApiTags("consumibles")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
// Kardex de consumibles: `consumible.gestionar` (Abastecimiento y quienes
// gestionan el catálogo; align_correcciones_manuales.sql). Antes exigía
// `catalogo.gestionar`, que daba a Abastecimiento todo el catálogo y los
// parámetros del sistema.
@RequierePermisoCrud({
  ver: "consumible.gestionar",
  crear: "consumible.gestionar",
  editar: "consumible.gestionar",
  eliminar: "consumible.gestionar",
})
@Controller("consumibles")
export class ConsumiblesController {
  constructor(private readonly svc: ConsumiblesService) {}

  /* --- rutas literales antes que las de :id (orden de resolución Nest) --- */

  @Get("lotes")
  async listarLotes(
    @Query("page") page = "1",
    @Query("limit") limit = "100",
    @Query("consumibleId") consumibleId: string | undefined,
    @Query("disponibles") disponibles: string | undefined,
    @Req() req: any,
  ) {
    return this.svc.listarLotes(this.svc.tenantId(req), {
      ...pag(page, limit),
      consumibleId: consumibleId || undefined,
      soloDisponibles: disponibles === "1" || disponibles === "true",
    });
  }

  @Post("lotes")
  async crearLote(@Body() body: unknown, @Req() req: any) {
    const d = CrearLoteSchema.parse(body);
    return this.svc.crearLote(
      this.svc.tenantId(req),
      req?.user?.sub ?? req?.user?.id ?? null,
      d,
    );
  }

  @Patch("lotes/:loteId")
  async actualizarLote(
    @Param("loteId", ParseUUIDPipe) loteId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const d = ActualizarLoteSchema.parse(body) as Record<string, unknown>;
    return this.svc.actualizarLote(loteId, this.svc.tenantId(req), d);
  }

  @Delete("lotes/:loteId")
  async eliminarLote(@Param("loteId", ParseUUIDPipe) loteId: string, @Req() req: any) {
    return this.svc.eliminarLote(loteId, this.svc.tenantId(req));
  }

  @Post("movimiento")
  async movimiento(@Body() body: unknown, @Req() req: any) {
    const d = MovimientoSchema.parse(body);
    const tenantId = this.svc.tenantId(req);
    const vinculo = await this.svc.resolverVinculo(req, tenantId, d);
    return this.svc.registrarMovimiento(tenantId, req?.user?.sub ?? req?.user?.id ?? null, d, vinculo);
  }

  /** Buscador de OT, muestras y métodos para el vínculo del movimiento (alcance del usuario). */
  @Get("vinculos")
  async vinculos(
    @Query("tipo") tipo: string,
    @Query("q") q: string | undefined,
    @Query("otId") otId: string | undefined,
    @Query("muestraId") muestraId: string | undefined,
    @Req() req: any,
  ) {
    const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    return this.svc.buscarVinculo(req, this.svc.tenantId(req), tipo, q ?? "", { otId: uuid(otId), muestraId: uuid(muestraId) });
  }

  @Get("pendientes")
  async pendientes(@Query("todos") todos: string | undefined, @Req() req: any) {
    return this.svc.listarPendientes(this.svc.tenantId(req), todos === "1" || todos === "true");
  }

  @Post("pendientes/:pendienteId/descontar")
  async descontarPendiente(@Param("pendienteId", ParseUUIDPipe) pendienteId: string, @Req() req: any) {
    return this.svc.descontarPendiente(pendienteId, this.svc.tenantId(req), req?.user?.sub ?? req?.user?.id ?? null);
  }

  @Post("pendientes/:pendienteId/descartar")
  async descartarPendiente(@Param("pendienteId", ParseUUIDPipe) pendienteId: string, @Body() body: any, @Req() req: any) {
    return this.svc.descartarPendiente(pendienteId, this.svc.tenantId(req), req?.user?.sub ?? req?.user?.id ?? null, body?.motivo);
  }

  /* --- CRUD de consumibles ---------------------------------------------- */

  @Get()
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "100",
    @Query("search") search: string | undefined,
    @Query("activos") activos: string | undefined,
    @Req() req: any,
  ) {
    return this.svc.listarConsumibles(this.svc.tenantId(req), {
      ...pag(page, limit),
      search: search || undefined,
      soloActivos: activos === "1" || activos === "true",
    });
  }

  @Get(":id/kardex")
  async kardex(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.kardex(id, this.svc.tenantId(req));
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cargarConsumible(id, this.svc.tenantId(req));
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearConsumible(this.svc.tenantId(req), CrearConsumibleSchema.parse(body));
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = ActualizarConsumibleSchema.parse(body) as Record<string, unknown>;
    return this.svc.actualizarConsumible(id, this.svc.tenantId(req), d);
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.eliminarConsumible(id, this.svc.tenantId(req));
  }
}

/**
 * Consumos de la OT (§4.4.5): los ve quien ve la OT (pestaña «Consumos» del
 * expediente), sin necesitar el permiso del inventario.
 */
@ApiTags("consumibles")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("consumibles/ot")
export class ConsumosOtController {
  constructor(private readonly svc: ConsumiblesService) {}

  @Get(":otId")
  @RequierePermiso("ot.ver")
  consumos(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.consumosDeOt(req, otId);
  }
}

/* ========================================================================== */

@Module({
  controllers: [ConsumosOtController, ConsumiblesController],
  providers: [ConsumiblesService],
  exports: [ConsumiblesService],
})
export class ConsumiblesModule {}
