import { BadRequestException, Controller, Get, Injectable, Module, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AmbitoUnidad } from "../rbac/ambito-unidad.guard";
import { AlcanceService } from "../rbac/alcance.service";
import { TasaMensualController, TasaMensualService } from "./tasa-mensual";

/**
 * SVT8 · Búsqueda de OT de INTERNACIÓN (IDIC-PG 24 Anexo 03) con la tasa del
 * 1,5 % y su estado de cobro. La tasa se CALCULA en POST /cotizaciones/tasa-internacion
 * (costeo.service.ts); aquí solo se consulta lo registrado.
 *
 * DEFENSIVO frente al esquema: según cómo se construyó la BD pueden faltar
 * `calculo_tasa_internacion` (solo existe en schema.sql), `factura.ot_id` o las
 * columnas nuevas de la OT (`con_cobro`, de align_comercial_r2.sql). Se consulta
 * information_schema una vez y la SQL se arma solo con lo que existe; lo que no
 * existe se devuelve como null.
 *
 * Una OT es "de internación" si `origen_trabajo = 'INTERNACION'` (código nuevo)
 * o si su texto heredado contiene «internaci» (p. ej. "Internación de armamento").
 * La resolución DGMN vive en `numero_ley`.
 */

export const COBROS = ["pendiente", "facturada", "pagada", "sin_cobro"] as const;

export interface FiltroInternacion {
  resolucion?: string;
  empresa?: string;
  estado?: string;
  cobro?: string;
  limit?: number;
  /** Alcance: null = todas; si no, solo las OT cuyo laboratorio responsable está aquí. */
  unidades?: string[] | null;
}

@Injectable()
export class InternacionService {
  private esquema?: { tasa: boolean; facturaOt: boolean; facturaBorrado: boolean; conCobro: boolean; numeroLey: boolean };

  constructor(private readonly prisma: PrismaService) {}

  private async detectarEsquema() {
    if (this.esquema) return this.esquema;
    const cols = await this.prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('calculo_tasa_internacion', 'factura', 'orden_trabajo')`,
    );
    const tiene = (t: string, c: string) => cols.some((x) => x.table_name === t && x.column_name === c);
    this.esquema = {
      tasa: tiene("calculo_tasa_internacion", "ot_id") && tiene("calculo_tasa_internacion", "total_a_cancelar"),
      facturaOt: tiene("factura", "ot_id"),
      facturaBorrado: tiene("factura", "deleted_at"),
      conCobro: tiene("orden_trabajo", "con_cobro"),
      numeroLey: tiene("orden_trabajo", "numero_ley"),
    };
    return this.esquema;
  }

  async buscar(tenantId: string, f: FiltroInternacion) {
    if (f.cobro && !(COBROS as readonly string[]).includes(f.cobro))
      throw new BadRequestException(`cobro debe ser uno de: ${COBROS.join(", ")}`);
    const e = await this.detectarEsquema();
    const args: unknown[] = [tenantId];
    const p = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };

    const conCobro = e.conCobro ? "ot.con_cobro" : "TRUE";
    const resolucion = e.numeroLey ? "ot.numero_ley" : "NULL::varchar";
    const tasaJoin = e.tasa
      ? `LEFT JOIN LATERAL (
           SELECT c.monto_cif_usd, c.paridad_usd, c.monto_operacion, c.iva_internacion, c.total_a_cancelar, c.calculado_at
             FROM calculo_tasa_internacion c
            WHERE c.ot_id = ot.id
            ORDER BY c.calculado_at DESC NULLS LAST
            LIMIT 1) tasa ON TRUE`
      : "";
    const tasaCols = e.tasa
      ? `tasa.monto_cif_usd::float8 AS cif_usd, tasa.paridad_usd::float8 AS paridad,
         tasa.monto_operacion::float8 AS tasa_monto, tasa.iva_internacion::float8 AS tasa_iva,
         tasa.total_a_cancelar::float8 AS tasa_total, tasa.calculado_at AS tasa_calculada_at`
      : `NULL::float8 AS cif_usd, NULL::float8 AS paridad, NULL::float8 AS tasa_monto,
         NULL::float8 AS tasa_iva, NULL::float8 AS tasa_total, NULL::timestamptz AS tasa_calculada_at`;
    const facJoin = e.facturaOt
      ? `LEFT JOIN LATERAL (
           SELECT fa.id, fa.numero, fa.estado, fa.total
             FROM factura fa
            WHERE fa.ot_id = ot.id ${e.facturaBorrado ? "AND fa.deleted_at IS NULL" : ""} AND COALESCE(fa.estado, '') <> 'anulada'
            ORDER BY fa.fecha_emision DESC
            LIMIT 1) fac ON TRUE`
      : "";
    const facCols = e.facturaOt
      ? `fac.numero AS factura_numero, fac.estado AS factura_estado`
      : `NULL::varchar AS factura_numero, NULL::varchar AS factura_estado`;
    const cobroExpr = e.facturaOt
      ? `CASE WHEN NOT ${conCobro} THEN 'sin_cobro'
              WHEN fac.estado = 'pagada' THEN 'pagada'
              WHEN fac.id IS NOT NULL THEN 'facturada'
              ELSE 'pendiente' END`
      : `CASE WHEN NOT ${conCobro} THEN 'sin_cobro' ELSE 'pendiente' END`;

    const where: string[] = [
      `ot.tenant_id = $1::uuid`,
      `(ot.origen_trabajo = 'INTERNACION' OR ot.origen_trabajo ILIKE '%internaci%')`,
    ];
    if (f.resolucion?.trim() && e.numeroLey) where.push(`ot.numero_ley ILIKE ${p(`%${f.resolucion.trim()}%`)}`);
    if (f.empresa?.trim()) {
      const q = p(`%${f.empresa.trim()}%`);
      where.push(`(cl.razon_social ILIKE ${q} OR cl.rut ILIKE ${q})`);
    }
    if (f.estado?.trim()) where.push(`ot.estado = ${p(f.estado.trim())}`);
    if (f.unidades) where.push(`ot.unidad_principal = ANY(${p(f.unidades)}::uuid[])`);
    const limit = Math.min(Math.max(Number(f.limit) || 200, 1), 1000);

    const sql = `
      SELECT * FROM (
        SELECT ot.id, ot.codigo, ot.estado, ot.origen_trabajo, ${resolucion} AS resolucion,
               ot.fecha_recepcion, ot.cotizacion_id, ${conCobro} AS con_cobro,
               cl.id AS cliente_id, cl.razon_social AS empresa, cl.rut AS rut,
               ${tasaCols}, ${facCols},
               ${cobroExpr} AS cobro
          FROM orden_trabajo ot
          JOIN cliente cl ON cl.id = ot.cliente_id
          ${tasaJoin}
          ${facJoin}
         WHERE ${where.join(" AND ")}
      ) x
      ${f.cobro ? `WHERE x.cobro = ${p(f.cobro)}` : ""}
      ORDER BY x.fecha_recepcion DESC NULLS LAST, x.codigo DESC
      LIMIT ${limit}`;

    const filas = await this.prisma.$queryRawUnsafe<any[]>(sql, ...args);
    return {
      data: filas.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        estado: r.estado,
        origenTrabajo: r.origen_trabajo,
        resolucion: r.resolucion,
        fechaRecepcion: r.fecha_recepcion,
        cotizacionId: r.cotizacion_id,
        conCobro: r.con_cobro,
        cliente: { id: r.cliente_id, razonSocial: r.empresa, rut: r.rut },
        tasa:
          r.tasa_total !== null && r.tasa_total !== undefined
            ? {
                cifUsd: r.cif_usd,
                paridad: r.paridad,
                monto: r.tasa_monto,
                iva: r.tasa_iva,
                total: r.tasa_total,
                calculadaAt: r.tasa_calculada_at,
              }
            : null,
        factura: r.factura_numero ? { numero: r.factura_numero, estado: r.factura_estado } : null,
        cobro: r.cobro,
      })),
      meta: {
        total: filas.length,
        // Qué datos hay disponibles en esta BD (para que la UI explique los vacíos).
        fuentes: { tasa: e.tasa, factura: e.facturaOt, conCobro: e.conCobro },
      },
    };
  }
}

@ApiTags("internaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("internaciones")
export class InternacionController {
  constructor(
    private readonly svc: InternacionService,
    private readonly alcance: AlcanceService,
  ) {}

  /**
   * Alcance de las OT de internación (frente L · C7): la unidad que inspecciona
   * (laboratorio responsable de la OT) tiene que estar en el alcance. Quien
   * tiene en su alcance la Sección Certificación de la Conformidad las ve todas
   * (carril SCC del IDIC-PG 24), igual que en /bpch/internaciones.
   */
  private async unidadesVisibles(req: any): Promise<string[] | null> {
    const filtro = await this.alcance.filtroUnidades(req);
    if (filtro === null) return null;
    const scc = (await this.alcance.arbol(req?.user?.tenantId)).porCodigo.get("SCC")?.id;
    return scc && filtro.includes(scc) ? null : filtro;
  }

  // La usa /bpch/internaciones (tasa, cobro y «OT de internación sin expediente BPCH").
  @Get("ot")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "OT de internación con tasa 1,5 % y estado de cobro (?resolucion=&empresa=&estado=&cobro=)" })
  async buscar(
    @Query("resolucion") resolucion?: string,
    @Query("empresa") empresa?: string,
    @Query("estado") estado?: string,
    @Query("cobro") cobro?: string,
    @Query("limit") limit?: string,
    @Req() req?: any,
  ) {
    return this.svc.buscar(req?.user?.tenantId ?? DEV_TENANT, {
      resolucion,
      empresa,
      estado,
      cobro,
      limit: limit ? Number(limit) : undefined,
      unidades: await this.unidadesVisibles(req),
    });
  }
}

@Module({
  // TasaMensualController ANTES: su ruta estática /internaciones/tasa-mensual.
  controllers: [TasaMensualController, InternacionController],
  providers: [InternacionService, TasaMensualService],
})
export class InternacionModule {}
