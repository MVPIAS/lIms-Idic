import {
  Body,
  ConflictException,
  Controller,
  Delete,
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
import { RequierePermisoCrud } from "../auth/permisos.decorator";

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
  if (v instanceof Date) return v.toISOString().slice(0, 10);
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
});
const ActualizarConsumibleSchema = CrearConsumibleSchema.partial();

const CrearLoteSchema = z.object({
  consumibleId: z.string().uuid(),
  numeroLote: z.string().min(1).max(80),
  fechaRecepcion: optDate(),
  fechaVencimiento: optDate(),
  cantidadInicial: z.coerce.number().nonnegative(),
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
    muestraId: optUuid(),
    catMetodoId: optUuid(),
    motivo: optStr(2000),
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

/* ========================================================================== */
/* ConsumiblesService                                                          */
/* ========================================================================== */

@Injectable()
export class ConsumiblesService {
  private prisma = new PrismaClient();

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
           (tenant_id, codigo, nombre, tipo, unidad_medida, proveedor_id, stock_minimo, activo)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8)
         RETURNING *`,
        tenantId,
        d.codigo,
        d.nombre,
        d.tipo ?? null,
        d.unidadMedida ?? null,
        d.proveedorId ?? null,
        d.stockMinimo ?? null,
        d.activo ?? true,
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
      `SELECT id FROM consumible WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      d.consumibleId,
      tenantId,
    );
    if (!con.length) throw new NotFoundException("Consumible no encontrado");

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
  ) {
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
           (tenant_id, lote_id, tipo, cantidad, muestra_id, cat_metodo_id, motivo, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, $8::uuid)
         RETURNING *`,
        tenantId,
        loteId,
        d.tipo,
        cantidadAsiento,
        d.muestraId ?? null,
        d.catMetodoId ?? null,
        d.motivo ?? null,
        usuarioId,
      );
      return { ...mov[0], stock_resultante: nuevo };
    });
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
              me.nombre AS metodo_nombre,
              u.nombre_completo AS usuario_nombre
         FROM movimiento_consumible m
         JOIN lote_consumible l ON l.id = m.lote_id
         LEFT JOIN muestra   mu ON mu.id = m.muestra_id
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
@RequierePermisoCrud({
  ver: "catalogo.gestionar",
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
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
    return this.svc.registrarMovimiento(
      this.svc.tenantId(req),
      req?.user?.sub ?? req?.user?.id ?? null,
      d,
    );
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

/* ========================================================================== */

@Module({
  controllers: [ConsumiblesController],
  providers: [ConsumiblesService],
  exports: [ConsumiblesService],
})
export class ConsumiblesModule {}
