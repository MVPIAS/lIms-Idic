/**
 * Reportes › Gestión (EP-00 9.4, BL-174, frente r4c): OT por laboratorio y
 * estado, cumplimiento de plazo y tiempo de ciclo por laboratorio, facturación
 * por centro de costo, OT sin cobro valorizadas, encuestas por laboratorio y
 * trazabilidad cotización → OT → factura. «⬇ Excel» descarga un .xlsx real (una
 * hoja por sección). Todo se acota a las unidades visibles de quien consulta y
 * los valores van como parámetros posicionales (nunca se interpola entrada).
 */
import { BadRequestException, Controller, Get, NotFoundException, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { condicionAlcance } from "./alcance-reportes";
import { libroXlsx } from "../common/xlsx-escritura";
import { hojasGestion, otPorLaboratorioEstado, plazosPorLaboratorio, type ReporteGestion } from "./gestion";
import { SQL_ZONA } from "../common/fecha-chile";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const n = (x: unknown) => (x === null || x === undefined ? 0 : Number(x));

@ApiTags("reportes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("reportes")
export class ReportesGestionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  /** `AND col >= desde AND col < hasta + 1` con parámetros. */
  private rango(col: string, desde: string | undefined, hasta: string | undefined, args: unknown[]): string {
    let s = "";
    if (desde) {
      if (!FECHA.test(desde)) throw new BadRequestException("Parámetro 'desde' con formato inválido (AAAA-MM-DD)");
      args.push(desde);
      s += ` AND ${col} >= $${args.length}::date`;
    }
    if (hasta) {
      if (!FECHA.test(hasta)) throw new BadRequestException("Parámetro 'hasta' con formato inválido (AAAA-MM-DD)");
      args.push(hasta);
      s += ` AND ${col} < ($${args.length}::date + 1)`;
    }
    return s;
  }

  async armar(req: any, desde?: string, hasta?: string): Promise<ReporteGestion> {
    const t = req?.user?.tenantId;
    if (!t) throw new NotFoundException("Tenant no resuelto en el token");
    const unidades = await this.alcance.filtroUnidades(req);
    const q = <T = any>(sql: string, args: unknown[]) => this.prisma.$queryRawUnsafe<T[]>(sql, ...args);
    const ot = (alias = "o", col = `${alias}.created_at`) => {
      const args: unknown[] = [t];
      const cond = this.rango(col, desde, hasta, args) + condicionAlcance("orden_trabajo", alias, unidades, args);
      return { args, cond };
    };

    const a1 = ot();
    const estados = await q<{ laboratorio: string; estado: string; total: number }>(
      `SELECT COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio, o.estado, count(*)::int AS total
         FROM orden_trabajo o LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE o.tenant_id = $1::uuid ${a1.cond} GROUP BY 1, 2`,
      a1.args,
    );

    const a2 = ot();
    const plazos = await q<any>(
      `SELECT COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio, o.estado = 'cerrada' AS cerrada,
              CASE WHEN o.fecha_cierre IS NOT NULL AND o.fecha_recepcion IS NOT NULL
                   THEN EXTRACT(EPOCH FROM (o.fecha_cierre - o.fecha_recepcion)) / 86400.0 END::float8 AS dias,
              CASE WHEN o.fecha_compromiso IS NULL OR o.estado <> 'cerrada' THEN NULL
                   ELSE COALESCE(o.fecha_recep_dco, (o.fecha_cierre AT TIME ZONE ${SQL_ZONA})::date) <= o.fecha_compromiso END AS dentro,
              (o.estado NOT IN ('cerrada', 'anulada') AND o.fecha_compromiso < (now() AT TIME ZONE ${SQL_ZONA})::date) AS vencida,
              CASE WHEN o.fecha_compromiso IS NULL OR o.estado <> 'cerrada' THEN NULL
                   ELSE COALESCE(o.fecha_recep_dco, (o.fecha_cierre AT TIME ZONE ${SQL_ZONA})::date) - o.fecha_compromiso END AS atraso
         FROM orden_trabajo o LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE o.tenant_id = $1::uuid AND o.estado <> 'anulada' ${a2.cond}`,
      a2.args,
    );

    const a3 = ot("o", "COALESCE(f.fecha_emision, f.created_at::date)");
    const facturacion = await q<any>(
      `SELECT COALESCE(cc.codigo, '(sin centro de costo)') AS centro, cc.nombre, count(*)::int AS facturas,
              COALESCE(sum(f.neto), 0)::float8 AS neto, COALESCE(sum(f.total), 0)::float8 AS total,
              COALESCE(sum((SELECT COALESCE(sum(p.monto), 0) FROM pago p WHERE p.factura_id = f.id)), 0)::float8 AS pagado,
              COALESCE(sum(f.saldo), 0)::float8 AS saldo
         FROM factura f
         JOIN orden_trabajo o ON o.id = f.ot_id
         LEFT JOIN centro_costo cc ON cc.id = COALESCE(f.centro_costo_id, o.centro_costo_id)
        WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL AND f.estado NOT IN ('anulada', 'pendiente') ${a3.cond}
        GROUP BY 1, 2 ORDER BY total DESC`,
      a3.args,
    );

    const a4 = ot();
    const sinCobro = await q<any>(
      `SELECT COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio, count(*)::int AS ot, COALESCE(sum(o.costo_estimado), 0)::float8 AS costo
         FROM orden_trabajo o LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE o.tenant_id = $1::uuid AND NOT o.con_cobro AND o.estado <> 'anulada' ${a4.cond}
        GROUP BY 1 ORDER BY 1`,
      a4.args,
    );

    const a5 = ot("o", "e.created_at");
    const encuestas = await q<any>(
      `SELECT COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio,
              count(*) FILTER (WHERE e.estado = 'registrada')::int AS registradas,
              count(*) FILTER (WHERE e.estado = 'pendiente')::int AS pendientes,
              avg(e.promedio) FILTER (WHERE e.estado = 'registrada')::float8 AS promedio
         FROM encuesta_satisfaccion e
         JOIN orden_trabajo o ON o.id = e.ot_id
         LEFT JOIN unidad u ON u.id = COALESCE(e.unidad_id, o.unidad_principal)
        WHERE e.tenant_id = $1::uuid ${a5.cond}
        GROUP BY 1 ORDER BY 1`,
      a5.args,
    ).catch(() => [] as any[]);

    const a6 = ot();
    const traza = await q<any>(
      `SELECT c.codigo AS cotizacion, o.codigo AS ot, u.codigo AS laboratorio, o.estado AS estado_ot,
              f.numero AS factura, f.estado AS estado_factura, f.total::float8 AS total
         FROM orden_trabajo o
         LEFT JOIN cotizacion c ON c.id = o.cotizacion_id
         LEFT JOIN unidad u ON u.id = o.unidad_principal
         LEFT JOIN LATERAL (SELECT x.numero, x.estado, x.total FROM factura x WHERE x.ot_id = o.id AND x.deleted_at IS NULL AND x.estado <> 'anulada'
                             ORDER BY x.created_at DESC LIMIT 1) f ON TRUE
        WHERE o.tenant_id = $1::uuid ${a6.cond}
        ORDER BY o.created_at DESC LIMIT 1000`,
      a6.args,
    );

    return {
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      otPorEstado: otPorLaboratorioEstado(estados.map((e) => ({ ...e, total: n(e.total) }))),
      plazos: plazosPorLaboratorio(
        plazos.map((p) => ({
          laboratorio: p.laboratorio,
          cerrada: Boolean(p.cerrada),
          dias: p.dias === null ? null : Number(p.dias),
          dentro: p.dentro === null ? null : Boolean(p.dentro),
          vencidaAbierta: Boolean(p.vencida),
          diasAtraso: p.atraso === null ? null : Number(p.atraso),
        })),
      ),
      facturacionCentroCosto: facturacion.map((f) => ({ centroCosto: f.centro, nombre: f.nombre ?? null, facturas: n(f.facturas), neto: n(f.neto), total: n(f.total), pagado: n(f.pagado), saldo: n(f.saldo) })),
      sinCobro: sinCobro.map((s) => ({ laboratorio: s.laboratorio, ot: n(s.ot), costoEstimado: n(s.costo) })),
      encuestas: encuestas.map((e) => ({
        laboratorio: e.laboratorio,
        registradas: n(e.registradas),
        pendientes: n(e.pendientes),
        promedio: e.promedio === null ? null : Math.round(Number(e.promedio) * 10) / 10,
      })),
      trazabilidad: traza.map((x) => ({
        cotizacion: x.cotizacion ?? null,
        ot: x.ot,
        laboratorio: x.laboratorio ?? null,
        estadoOt: x.estado_ot,
        factura: x.factura ?? null,
        estadoFactura: x.estado_factura ?? null,
        total: x.total === null || x.total === undefined ? null : Number(x.total),
      })),
    };
  }

  @Get("gestion")
  @RequierePermiso("reporte.ver")
  gestion(@Req() req: any, @Query("desde") desde?: string, @Query("hasta") hasta?: string) {
    return this.armar(req, desde, hasta);
  }

  @Get("gestion.xlsx")
  @RequierePermiso("reporte.ver")
  async excel(@Req() req: any, @Res() res: Response, @Query("desde") desde?: string, @Query("hasta") hasta?: string) {
    const r = await this.armar(req, desde, hasta);
    const b = libroXlsx(hojasGestion(r));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="reporte_gestion_${desde ?? "inicio"}_${hasta ?? "hoy"}.xlsx"`);
    res.send(b);
  }
}
