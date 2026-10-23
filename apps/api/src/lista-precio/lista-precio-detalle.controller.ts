/**
 * Detalle de una lista de precios con su estructura de costos (lista oficial
 * 2026, frente lp26): ítems con CD, CI, CT, recargo, neto, IVA y precio
 * particular, el ensayo del catálogo enlazado, el centro de costo y la unidad,
 * y un resumen por centro de costo (enlazados, sin enlace, centros que no
 * existen en el LIMS).
 *
 * Dato maestro del instituto, como el resto de /listas-precio: se lee con
 * `cotizacion.ver` y no depende del laboratorio (no hay alcance que filtrar).
 */
import { BadRequestException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

const ENLACES = ["codigo", "nombre", "nombre_base", "manual"] as const;

export interface FiltroDetalle {
  q?: string;
  centro?: string;
  enlace?: string;
  page?: number;
  limit?: number;
}

/** Cláusulas WHERE y parámetros del filtro (pura; lista-precio-detalle.spec.ts). */
export function filtroDetalle(f: FiltroDetalle, desde = 2): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  let n = desde;
  const q = (f.q ?? "").trim();
  if (q) {
    where.push(`(i.codigo ILIKE $${n} OR i.descripcion ILIKE $${n} OR ce.codigo ILIKE $${n} OR ce.nombre ILIKE $${n})`);
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    n++;
  }
  const centro = (f.centro ?? "").trim();
  if (centro) {
    where.push(`COALESCE(i.cc, '') = $${n}`);
    params.push(centro === "(vacío)" ? "" : centro);
    n++;
  }
  const e = (f.enlace ?? "").trim();
  if (e === "si") where.push("i.cat_ensayo_id IS NOT NULL");
  else if (e === "no") where.push("i.cat_ensayo_id IS NULL");
  else if ((ENLACES as readonly string[]).includes(e)) {
    where.push(`i.enlace = $${n}`);
    params.push(e);
    n++;
  } else if (e) throw new BadRequestException("enlace: si | no | codigo | nombre | nombre_base | manual");
  return { where, params };
}

const num = (v: unknown) => (v == null ? null : Number(v));

@Injectable()
export class ListaPrecioDetalleService {
  constructor(private readonly prisma: PrismaService) {}

  async detalle(tenantId: string, id: string, f: FiltroDetalle) {
    const listas: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id::text, codigo, nombre, moneda, vigente_desde AS "vigenteDesde", vigente_hasta AS "vigenteHasta",
              COALESCE(activa, TRUE) AS activa, fuente
         FROM lista_precio WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantId,
    );
    const lista = listas[0];
    if (!lista) throw new NotFoundException("Lista de precios no encontrada");

    const page = Math.max(1, Math.floor(Number(f.page) || 1));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(f.limit) || 50)));
    const { where, params } = filtroDetalle(f, 2);
    const cond = ["i.lista_precio_id = $1::uuid", ...where].join(" AND ");
    const desde = `FROM lista_precio_item i
                   LEFT JOIN cat_ensayo ce ON ce.id = i.cat_ensayo_id
                   LEFT JOIN cat_familia cf ON cf.id = ce.familia_id
                   LEFT JOIN centro_costo cc ON cc.id = i.centro_costo_id
                   LEFT JOIN unidad u ON u.id = i.unidad_id`;
    const [filas, total, resumen] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT i.id::text, i.codigo, i.descripcion, i.cc AS "centroOrigen", i.tipo, i.precio,
                i.costo_directo AS "costoDirecto", i.costo_indirecto AS "costoIndirecto", i.costo_total AS "costoTotal",
                i.recargo, i.neto, i.iva, i.precio_iva_incluido AS "precioIvaIncluido",
                i.enlace, ce.id::text AS "catEnsayoId", ce.codigo AS "catEnsayoCodigo", ce.nombre AS "catEnsayoNombre",
                cf.laboratorio AS "catLaboratorio",
                cc.codigo AS "centroCostoCodigo", cc.nombre AS "centroCostoNombre", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre"
           ${desde} WHERE ${cond}
          ORDER BY i.codigo LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        id,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n ${desde} WHERE ${cond}`, id, ...params),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT COALESCE(i.cc, '') AS centro, string_agg(DISTINCT cc.codigo, ' · ') AS "centroCosto", string_agg(DISTINCT u.codigo, ' · ') AS unidad,
                count(*)::int AS items, count(i.cat_ensayo_id)::int AS enlazados,
                count(*) FILTER (WHERE i.enlace = 'codigo')::int AS "porCodigo",
                count(*) FILTER (WHERE i.enlace IN ('nombre', 'nombre_base'))::int AS "porNombre",
                count(*) FILTER (WHERE i.enlace = 'manual')::int AS manuales,
                bool_or(i.centro_costo_id IS NULL) AS "sinCentroCosto"
           FROM lista_precio_item i
           LEFT JOIN centro_costo cc ON cc.id = i.centro_costo_id
           LEFT JOIN unidad u ON u.id = i.unidad_id
          WHERE i.lista_precio_id = $1::uuid
          GROUP BY 1 ORDER BY count(*) DESC, 1`,
        id,
      ),
    ]);
    const items = resumen.reduce((a, r) => a + r.items, 0);
    const enlazados = resumen.reduce((a, r) => a + r.enlazados, 0);
    return {
      lista,
      resumen: {
        items,
        enlazados,
        sinEnlace: items - enlazados,
        conCostos: resumen.length > 0,
        porCentro: resumen,
        centrosSinCentroCosto: resumen.filter((r) => r.sinCentroCosto).map((r) => r.centro || "(vacío)"),
      },
      data: filas.map((r) => ({
        ...r,
        precio: num(r.precio),
        costoDirecto: num(r.costoDirecto),
        costoIndirecto: num(r.costoIndirecto),
        costoTotal: num(r.costoTotal),
        recargo: num(r.recargo),
        neto: num(r.neto),
        iva: num(r.iva),
        precioIvaIncluido: num(r.precioIvaIncluido),
      })),
      meta: { page, limit, total: Number(total[0]?.n ?? 0) },
    };
  }
}

@ApiTags("listas-precio")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("listas-precio")
export class ListaPrecioDetalleController {
  constructor(private readonly svc: ListaPrecioDetalleService) {}

  @Get(":id/detalle")
  @RequierePermiso("cotizacion.ver")
  @ApiOperation({ summary: "Ítems de la lista con estructura de costos, enlace al catálogo y resumen por centro de costo" })
  detalle(@Param("id", ParseUUIDPipe) id: string, @Query() query: Record<string, string>, @Req() req: any) {
    return this.svc.detalle(req?.user?.tenantId, id, {
      q: query.q,
      centro: query.centro,
      enlace: query.enlace,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 50,
    });
  }
}
