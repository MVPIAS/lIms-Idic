/**
 * Bodegas de consumibles (frente S4 · reuniones R1 y R5; contrato 4.4.4 y 4.4.5).
 *
 *   GET   consumibles/bodegas                 bodegas con su stock valorizado         · consumible.gestionar
 *   POST  consumibles/bodegas                 alta (central o sub-bodega de un lab)   · consumible.gestionar
 *   PATCH consumibles/bodegas/:id             edición (nombre, ubicación, activa)     · consumible.gestionar
 *   GET   consumibles/bodegas/:id/inventario  inventario valorizado por lote          · consumible.gestionar
 *   POST  consumibles/bodegas/traspaso        traspaso de stock de un lote a otra bodega · consumible.gestionar
 *
 * El jefe de un laboratorio ve el inventario de su sub-bodega en la Zona de
 * informes («Inventario valorizado por bodega y lote», con alcance por
 * laboratorio). Reglas puras: bodegas.ts.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { hoyCl } from "../ot/plazos";
import { erroresBodega, erroresTraspaso, resumenInventario, valorLote } from "./bodegas";

const vacioANulo = (v: unknown) => (v === "" ? null : v);

const CrearBodega = z.object({
  codigo: z.string().trim().min(1, "Indique el código de la bodega.").max(30).transform((s) => s.toUpperCase()),
  nombre: z.string().trim().min(1, "Indique el nombre de la bodega.").max(160),
  tipo: z.enum(["central", "laboratorio"], { errorMap: () => ({ message: "Tipo de bodega: central o laboratorio." }) }),
  unidadId: z.preprocess(vacioANulo, z.string().uuid().nullable().optional()),
  ubicacion: z.preprocess(vacioANulo, z.string().trim().max(200).nullable().optional()),
});
const EditarBodega = z.object({
  nombre: z.string().trim().min(1, "Indique el nombre de la bodega.").max(160).optional(),
  ubicacion: z.preprocess(vacioANulo, z.string().trim().max(200).nullable().optional()),
  activa: z.boolean().optional(),
});
const Traspaso = z.object({
  loteId: z.string().uuid("Elija el lote."),
  bodegaDestinoId: z.string().uuid("Elija la bodega de destino."),
  cantidad: z.coerce.number({ invalid_type_error: "La cantidad debe ser un número." }),
  motivo: z.preprocess(vacioANulo, z.string().trim().max(2000).nullable().optional()),
});

const tenantDe = (req: any): string => {
  const t = req?.user?.tenantId;
  if (!t) throw new NotFoundException("Tenant no resuelto en el token");
  return t;
};
const usuarioDe = (req: any): string | null => req?.user?.sub ?? req?.user?.id ?? null;

@Injectable()
export class BodegasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(req: any) {
    const t = tenantDe(req);
    const bodegas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT b.id, b.codigo, b.nombre, b.tipo, b.unidad_id AS "unidadId", b.ubicacion, b.activa,
              u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre"
         FROM bodega b LEFT JOIN unidad u ON u.id = b.unidad_id
        WHERE b.tenant_id = $1::uuid
        ORDER BY (b.tipo = 'central') DESC, b.codigo`,
      t,
    );
    const lotes = await this.prisma.$queryRawUnsafe<{ bodega_id: string | null; cantidad: number; costo_lote: number | null; costo_consumible: number | null }[]>(
      `SELECT l.bodega_id, l.cantidad_actual::float8 AS cantidad, l.costo_unitario_clp::float8 AS costo_lote, c.costo_unitario_clp::float8 AS costo_consumible
         FROM lote_consumible l JOIN consumible c ON c.id = l.consumible_id
        WHERE l.tenant_id = $1::uuid AND l.cantidad_actual > 0`,
      t,
    );
    const porBodega = new Map<string, typeof lotes>();
    for (const l of lotes) {
      const k = l.bodega_id ?? "";
      porBodega.set(k, [...(porBodega.get(k) ?? []), l]);
    }
    const resumen = (k: string) =>
      resumenInventario((porBodega.get(k) ?? []).map((l) => ({ cantidad: Number(l.cantidad), costoLote: l.costo_lote, costoConsumible: l.costo_consumible })));
    const laboratorios = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre FROM unidad WHERE tenant_id = $1::uuid AND tipo = 'LABORATORIO' ORDER BY codigo`,
      t,
    );
    const total = resumenInventario(lotes.map((l) => ({ cantidad: Number(l.cantidad), costoLote: l.costo_lote, costoConsumible: l.costo_consumible })));
    return {
      data: bodegas.map((b) => ({ ...b, inventario: resumen(b.id) })),
      sinBodega: resumen(""),
      total,
      laboratorios,
      pendienteIdic: total.sinCosto > 0 ? "Hay lotes sin costo: el IDIC aún no entrega el costo de los insumos (se valorizan al registrar el precio del lote o el costo de referencia del consumible)." : null,
    };
  }

  private async bodega(id: string, t: string) {
    const [b] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT * FROM bodega WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, t);
    if (!b) throw new NotFoundException("Bodega no encontrada");
    return b;
  }

  async crear(body: unknown, req: any) {
    const t = tenantDe(req);
    const d = CrearBodega.parse(body ?? {});
    const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM bodega WHERE tenant_id = $1::uuid AND tipo = 'central'`,
      t,
    );
    const errores = erroresBodega({ ...d, unidadId: d.unidadId ?? null }, n > 0);
    if (d.unidadId) {
      const [u] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM unidad WHERE id = $1::uuid AND tenant_id = $2::uuid`, d.unidadId, t);
      if (!u) errores.push("El laboratorio elegido no existe.");
    }
    if (errores.length) throw new BadRequestException(errores.join(" "));
    try {
      const [b] = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO bodega (tenant_id, codigo, nombre, tipo, unidad_id, ubicacion) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6) RETURNING *`,
        t,
        d.codigo,
        d.nombre,
        d.tipo,
        d.tipo === "central" ? null : d.unidadId,
        d.ubicacion ?? null,
      );
      return b;
    } catch (e: any) {
      if (String(e?.message ?? "").includes("uq_bodega_codigo")) throw new ConflictException(`Ya existe una bodega con el código ${d.codigo}.`);
      throw e;
    }
  }

  async editar(id: string, body: unknown, req: any) {
    const t = tenantDe(req);
    const b = await this.bodega(id, t);
    const d = EditarBodega.parse(body ?? {});
    if (d.activa === false && b.tipo === "central") throw new BadRequestException("La bodega central no se desactiva: recibe los lotes por defecto.");
    if (d.activa === false) {
      const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM lote_consumible WHERE bodega_id = $1::uuid AND cantidad_actual > 0`,
        id,
      );
      if (n > 0) throw new ConflictException(`La bodega tiene ${n} lote(s) con stock: trasládelos antes de desactivarla.`);
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE bodega SET nombre = COALESCE($3, nombre), ubicacion = CASE WHEN $4::boolean THEN $5 ELSE ubicacion END,
              activa = COALESCE($6, activa), updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      id,
      t,
      d.nombre ?? null,
      "ubicacion" in d,
      d.ubicacion ?? null,
      d.activa ?? null,
    );
    return this.bodega(id, t);
  }

  async inventario(id: string, req: any) {
    const t = tenantDe(req);
    const b = await this.bodega(id, t);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT l.id, l.numero_lote AS "numeroLote", l.fecha_vencimiento AS "fechaVencimiento", l.cantidad_actual::float8 AS cantidad,
              l.costo_unitario_clp::float8 AS "costoLote", c.costo_unitario_clp::float8 AS "costoConsumible",
              c.id AS "consumibleId", c.codigo AS "consumibleCodigo", c.nombre AS "consumibleNombre", c.unidad_medida AS unidad,
              (l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < $3::date) AS vencido
         FROM lote_consumible l JOIN consumible c ON c.id = l.consumible_id
        WHERE l.tenant_id = $1::uuid AND l.bodega_id = $2::uuid AND l.cantidad_actual > 0
        ORDER BY c.codigo, l.fecha_vencimiento ASC NULLS LAST, l.numero_lote`,
      t,
      id,
      hoyCl(),
    );
    const lotes = filas.map((f) => ({ ...f, ...valorLote({ cantidad: f.cantidad, costoLote: f.costoLote, costoConsumible: f.costoConsumible }) }));
    return {
      bodega: { id: b.id, codigo: b.codigo, nombre: b.nombre, tipo: b.tipo },
      lotes,
      resumen: resumenInventario(filas.map((f) => ({ cantidad: f.cantidad, costoLote: f.costoLote, costoConsumible: f.costoConsumible }))),
    };
  }

  /**
   * Traspasa stock de un lote a otra bodega: descuenta del lote de origen y suma
   * al lote con el mismo número en la bodega de destino (lo crea si no existe,
   * con la misma caducidad y precio). Dos asientos «traspaso» con signo, unidos
   * por traspaso_id. El stock total del consumible no cambia.
   */
  async traspasar(body: unknown, req: any) {
    const t = tenantDe(req);
    const usuario = usuarioDe(req);
    const d = Traspaso.parse(body ?? {});
    const destino = await this.bodega(d.bodegaDestinoId, t);
    return this.prisma.$transaction(async (tx) => {
      const [lote] = await tx.$queryRawUnsafe<any[]>(
        `SELECT l.*, l.cantidad_actual::float8 AS stock, b.codigo AS bodega_codigo,
                (l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < $3::date) AS vencido
           FROM lote_consumible l LEFT JOIN bodega b ON b.id = l.bodega_id
          WHERE l.id = $1::uuid AND l.tenant_id = $2::uuid FOR UPDATE OF l`,
        d.loteId,
        t,
        hoyCl(),
      );
      if (!lote) throw new NotFoundException("Lote no encontrado");
      const vencido = !!lote.vencido;
      const errores = erroresTraspaso({
        cantidad: d.cantidad,
        stockOrigen: Number(lote.stock),
        bodegaOrigenId: lote.bodega_id,
        bodegaDestinoId: destino.id,
        destinoActiva: !!destino.activa,
        loteVencido: vencido,
      });
      if (errores.length) throw new BadRequestException(errores.join(" "));

      const [traspaso] = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT gen_random_uuid() AS id`);
      const motivo = `Traspaso ${lote.bodega_codigo ?? "sin bodega"} → ${destino.codigo}${d.motivo ? ` · ${d.motivo}` : ""}`.slice(0, 2000);
      const queda = Math.round((Number(lote.stock) - d.cantidad) * 1e6) / 1e6;
      await tx.$executeRawUnsafe(
        `UPDATE lote_consumible SET cantidad_actual = $2, estado = CASE WHEN $2 <= 0 THEN 'agotado' ELSE estado END WHERE id = $1::uuid`,
        lote.id,
        queda,
      );
      const [dest] = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, cantidad_actual::float8 AS stock FROM lote_consumible
          WHERE consumible_id = $1::uuid AND numero_lote = $2 AND bodega_id = $3::uuid FOR UPDATE`,
        lote.consumible_id,
        lote.numero_lote,
        destino.id,
      );
      let destinoId: string;
      if (dest) {
        destinoId = dest.id;
        await tx.$executeRawUnsafe(
          `UPDATE lote_consumible SET cantidad_actual = cantidad_actual + $2, estado = CASE WHEN estado = 'agotado' THEN 'disponible' ELSE estado END WHERE id = $1::uuid`,
          dest.id,
          d.cantidad,
        );
      } else {
        // Copia los datos del lote en SQL (las fechas DATE no pasan por JS: sin corrimiento de zona horaria).
        const [n] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO lote_consumible (tenant_id, consumible_id, numero_lote, fecha_recepcion, fecha_vencimiento, cantidad_inicial, cantidad_actual,
                                        estado, bodega_id, costo_unitario_clp)
           SELECT tenant_id, consumible_id, numero_lote, fecha_recepcion, fecha_vencimiento, 0, $2, 'disponible', $3::uuid, costo_unitario_clp
             FROM lote_consumible WHERE id = $1::uuid
           RETURNING id`,
          lote.id,
          d.cantidad,
          destino.id,
        );
        destinoId = n.id;
      }
      for (const [loteId, cantidad] of [[lote.id, -d.cantidad], [destinoId, d.cantidad]] as const) {
        await tx.$executeRawUnsafe(
          `INSERT INTO movimiento_consumible (tenant_id, lote_id, tipo, cantidad, motivo, created_by, traspaso_id)
           VALUES ($1::uuid, $2::uuid, 'traspaso', $3, $4, $5::uuid, $6::uuid)`,
          t,
          loteId,
          cantidad,
          motivo,
          usuario,
          traspaso.id,
        );
      }
      return { traspasoId: traspaso.id, loteOrigenId: lote.id, loteDestinoId: destinoId, cantidad: d.cantidad, quedaEnOrigen: queda, destino: destino.codigo };
    });
  }
}

@ApiTags("consumibles")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("consumibles/bodegas")
export class BodegasController {
  constructor(private readonly svc: BodegasService) {}

  @Get()
  @RequierePermiso("consumible.gestionar")
  @ApiOperation({ summary: "Bodega central y sub-bodegas por laboratorio, con su inventario valorizado" })
  listar(@Req() req: any) {
    return this.svc.listar(req);
  }

  @Post("traspaso")
  @RequierePermiso("consumible.gestionar")
  @ApiOperation({ summary: "Traspasa stock de un lote a otra bodega (queda en el kardex)" })
  traspasar(@Body() body: unknown, @Req() req: any) {
    return this.svc.traspasar(body, req);
  }

  @Post()
  @RequierePermiso("consumible.gestionar")
  @ApiOperation({ summary: "Crea una bodega (central o sub-bodega de un laboratorio)" })
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(body, req);
  }

  @Get(":id/inventario")
  @RequierePermiso("consumible.gestionar")
  @ApiOperation({ summary: "Inventario valorizado por lote de una bodega" })
  inventario(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.inventario(id, req);
  }

  @Patch(":id")
  @RequierePermiso("consumible.gestionar")
  @ApiOperation({ summary: "Edita una bodega (nombre, ubicación, activa)" })
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(id, body, req);
  }
}
