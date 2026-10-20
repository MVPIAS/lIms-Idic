import { Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { pasosActuales } from "../plantilla-render/reglas-emision";
import { calcularAvance, puedeActuar, type DocumentoAvance, type HechosOt } from "./avance-ot";
import { metrologiaParaCierre } from "../metrologia/metrologia-ot.datos";

/** Laboratorios de la Sección Metrología (los mismos que usa el módulo de Metrología). */
const LABS_METROLOGIA = ["LMT", "LMTE", "LNF", "LCAD"];

/**
 * «Ruta de la OT» (docs/FLUJO_LABORATORIO.md §«Ruta de la OT»): reúne los
 * hechos de la OT (solo lectura) y aplica las reglas puras de avance-ot.ts.
 * No escribe nada ni guarda la etapa: se recalcula en cada consulta.
 */
@Injectable()
export class AvanceOtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  /** Hechos de la OT que alimentan la ruta. */
  async hechos(id: string, req: any): Promise<HechosOt> {
    const tenantId = req?.user?.tenantId;
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { unidad: { select: { codigo: true } } },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);

    const [cotizacion, muestras, analistas, resultados, docs, factura, calibraciones, internacion, reinspeccion] = await Promise.all([
      ot.cotizacionId
        ? this.prisma.cotizacion.findFirst({ where: { id: ot.cotizacionId }, select: { codigo: true, estado: true } })
        : null,
      this.prisma.$queryRawUnsafe<{ total: number; incompletas: number; veredictos: (string | null)[] | null }[]>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE m.toma_muestra IS NULL OR m.condicion_recepcion IS NULL)::int AS incompletas,
                array_agg(m.veredicto ORDER BY m.codigo) AS veredictos
           FROM muestra m WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL`,
        id,
      ),
      // Asignados a la OT o a alguno de sus ensayos (mismo criterio que «Mis OT»).
      this.prisma.$queryRawUnsafe<{ nombre: string }[]>(
        `SELECT DISTINCT u.nombre_completo AS nombre FROM usuario u
          WHERE u.id IN (SELECT oa.usuario_id FROM ot_analista oa WHERE oa.ot_id = $1::uuid
                         UNION SELECT r.asignado_a FROM resultado r WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL AND r.asignado_a IS NOT NULL)
          ORDER BY 1`,
        id,
      ),
      this.prisma.resultado.groupBy({ by: ["estado"], where: { otId: id, deletedAt: null }, _count: { _all: true } }),
      this.prisma.certificado.findMany({
        where: { otId: id, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, numero: true, codigo: true, estado: true, tipoDocumento: true, entregadoAt: true,
          firmas: { select: { id: true, orden: true, estado: true, rolNombre: true, rolCodigo: true, unidadCodigo: true, responsables: true } },
        },
      }),
      this.prisma.factura.findFirst({
        where: { otId: id, deletedAt: null, NOT: { estado: "anulada" } },
        orderBy: { createdAt: "desc" },
        select: { numero: true, estado: true },
      }),
      // Metrología (EP-04): instrumentos y calibraciones ligados a la OT por su id.
      ot.unidad && LABS_METROLOGIA.includes(ot.unidad.codigo) ? metrologiaParaCierre(this.prisma, id, ot.tenantId) : null,
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT i.id, i.numero, u.codigo AS unidad, i.sujeta_tasa AS "sujetaTasa", i.remitida_dco_at AS "remitidaAt",
                i.doc_adm_estado AS documentacion,
                EXISTS (SELECT 1 FROM calculo_tasa_internacion t WHERE t.internacion_id = i.id) AS "conTasa",
                (SELECT count(*)::int FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS lotes,
                (SELECT count(it.muestra_id)::int FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS "lotesRegistrados",
                (SELECT array_agg(c.certificado_id ORDER BY it.orden) FROM bpch_internacion_item it
                   LEFT JOIN bpch_codificacion c ON c.id = it.codificacion_id AND c.deleted_at IS NULL
                  WHERE it.internacion_id = i.id) AS "codificacionCertificados"
           FROM bpch_internacion i LEFT JOIN unidad u ON u.id = i.unidad_inspeccion_id
          WHERE i.ot_id = $1::uuid AND i.estado <> 'anulada'
          ORDER BY i.created_at DESC LIMIT 1`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT r.id, r.numero, u.codigo AS unidad, r.muestra_id IS NOT NULL AS "loteRegistrado",
                r.codificacion_id IS NOT NULL AS "conCodificacion", r.trazabilidad_at IS NOT NULL AS "trazabilidadHecha"
           FROM bpch_reinspeccion r LEFT JOIN unidad u ON u.id = r.unidad_inspeccion_id
          WHERE r.ot_id = $1::uuid
          ORDER BY r.created_at DESC LIMIT 1`,
        id,
      ),
    ]);

    const cuenta = (...estados: string[]) => resultados.filter((r) => estados.includes(r.estado ?? "")).reduce((s, r) => s + r._count._all, 0);
    const totalRes = resultados.reduce((s, r) => s + r._count._all, 0);
    const documentos: DocumentoAvance[] = docs.map(({ firmas, ...d }) => ({
      id: d.id,
      numero: d.numero ?? d.codigo ?? d.id.slice(0, 8),
      estado: d.estado,
      tipoDocumento: d.tipoDocumento,
      entregadoAt: d.entregadoAt,
      pendientes:
        d.estado === "en_firma"
          ? pasosActuales(firmas).map((p) => ({
              rol: p.rolNombre ?? p.rolCodigo,
              unidad: p.unidadCodigo ?? null,
              personas: (Array.isArray(p.responsables) ? (p.responsables as any[]) : [])
                .filter((x) => x && typeof x.usuarioId === "string")
                .map((x) => ({ id: x.usuarioId as string, nombre: String(x.nombre ?? "") })),
            }))
          : [],
    }));
    const m = muestras[0] ?? { total: 0, incompletas: 0, veredictos: [] };
    const i = internacion[0];
    const r = reinspeccion[0];
    return {
      id: ot.id,
      codigo: ot.codigo,
      estado: ot.estado,
      origen: ot.origenTrabajo ?? null,
      conCobro: ot.conCobro,
      opiPendiente: ot.opiPendiente,
      unidad: ot.unidad ? { codigo: ot.unidad.codigo, esMetrologia: LABS_METROLOGIA.includes(ot.unidad.codigo) } : null,
      cotizacion: cotizacion ?? null,
      fechaCierre: ot.fechaCierre,
      muestras: { total: m.total, recepcionIncompleta: m.incompletas, veredictos: m.veredictos ?? [] },
      analistas: analistas.map((a) => a.nombre),
      resultados: {
        total: totalRes,
        pendientes: cuenta("pendiente"),
        capturados: cuenta("capturado"),
        revisados: cuenta("revisado_n1"),
        aprobados: cuenta("aprobado"),
        devueltos: cuenta("devuelto", "rechazado"),
      },
      documentos,
      factura: factura ? { numero: factura.numero ?? "(sin número)", estado: factura.estado } : null,
      calibraciones: (calibraciones?.cals ?? []).map((c) => ({
        id: c.id, instrumentoId: c.instrumentoId, codigo: c.codigo, numeroCertificado: c.numeroCertificado ?? null, estado: c.estado, entregadoAt: c.entregadoAt ?? null,
      })),
      instrumentos: (calibraciones?.items ?? []).map((x) => ({
        id: x.id, numero: x.numero, descripcion: x.descripcion, estado: x.estado, metrologo: x.metrologoNombre, metrologoId: x.metrologoId,
      })),
      exigeDevolucion: calibraciones?.exigeDevolucion ?? true,
      internacion: i
        ? {
            id: i.id,
            numero: i.numero,
            unidad: i.unidad ?? null,
            lotes: i.lotes,
            lotesRegistrados: i.lotesRegistrados,
            codificacionCertificados: i.codificacionCertificados ?? [],
            sujetaTasa: Boolean(i.sujetaTasa),
            tasaRemitida: Boolean(i.remitidaAt),
            tasaEnCurso: Boolean(i.conTasa) || (i.documentacion ?? "pendiente") !== "pendiente",
            documentacion: i.documentacion ?? null,
          }
        : null,
      reinspeccion: r
        ? { id: r.id, numero: r.numero, unidad: r.unidad ?? null, loteRegistrado: r.loteRegistrado, conCodificacion: r.conCodificacion, trazabilidadHecha: r.trazabilidadHecha }
        : null,
    };
  }

  /** Ruta de la OT + si el usuario puede hacer el siguiente paso. */
  async avance(id: string, req: any) {
    const a = calcularAvance(await this.hechos(id, req));
    const u = req?.user ?? {};
    return {
      ...a,
      siguiente: a.siguiente
        ? { ...a.siguiente, puedoActuar: puedeActuar(a.siguiente.accion, { id: u.sub, permisos: u.permisos, roles: u.roles }) }
        : null,
    };
  }
}

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class AvanceOtController {
  constructor(private readonly svc: AvanceOtService) {}

  @Get(":id/avance")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Ruta de la OT: etapas deducidas del estado real y siguiente paso (quién y dónde)" })
  avance(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.avance(id, req);
  }
}
