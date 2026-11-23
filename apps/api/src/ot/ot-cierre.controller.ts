import { faltantesCierreArmas } from "../saec/d11/cierre-d11";
import { errorCambioPlazo } from "./plazo-resolucion";
import { faltantesOrdenInterna, pendientesOrdenInterna } from "../flujo-real/oi-pendientes-datos";
import { SQL_OT_LISTA_PARA_CERRAR } from "./lista-cierre";
import { faltantesNotificacionDgmn } from "../bpch/notificacion-dgmn/notificacion-dgmn.module";
import { faltantesTasaInternacion } from "../bpch/internacion/cierre-tasa";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { FacturaService } from "../facturacion/facturacion.module";
import { borradorSinImporte } from "../facturacion/reglas-factura";
import { pasosActuales, esOficial } from "../plantilla-render/reglas-emision";
import {
  OT_ESTADOS_TERMINADOS,
  UMBRAL_POR_VENCER_DIAS,
  caminoEstadosOt,
  diaDe,
  faltantesParaCerrar,
  fechaCompromisoDesdePlazo,
  hoyCl,
  semaforoPlazo,
  sumarDias,
  validarFechaCompromiso,
} from "./plazos";
import { diasPorVencerDe } from "./dias-por-vencer";
import { hechosCobertura } from "../plantilla-render/cobertura-ot";
import { metrologiaParaCierre } from "../metrologia/metrologia-ot.datos";
import { documentosDeMetrologia, documentosDeNoCalibrables, esEntregableNoCalibrable, faltantesMetrologia } from "../metrologia/metrologia-ot.reglas";
import { conTraza } from "../laboratorio/traza";
import { configCierreDe, cuentasResultados, exigePlanilla, hechasDe, hechosCierreQ4 } from "./cierre-q4.datos";
import {
  ESTADOS_A_NO_EJECUTADO,
  ETAPAS_CIERRE,
  NOMBRE_ETAPA,
  PERMISO_ETAPA,
  esEtapaCierre,
  faltantesCierreIncumplimiento,
  faltantesEtapaCierre,
  faltantesPlanillaCostos,
  faltantesTresCierres,
  laboratorioEn,
  plazoCierre,
  type EtapaCierre,
} from "./reglas-cierre-q4";

const FechaCompromiso = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD"),
  motivo: z.string().max(500).optional(),
});
const SEMAFOROS = ["vencida", "por_vencer", "en_plazo", "sin_fecha"] as const;
const CierreIncumplimiento = z.object({ motivo: z.string().trim().min(10, "Indique el motivo (mínimo 10 caracteres).").max(1000) });

function tienePermiso(req: any, codigo: string): boolean {
  const u = req?.user ?? {};
  return (u.roles ?? []).includes("SUPERADMIN") || (u.permisos ?? []).includes(codigo);
}

/**
 * Plazos y cierre de la OT (docs/FLUJO_FIRMA_CIERRE.md). Fichero propio para no
 * tocar las rutas de `ot.controller.ts`. Se registra ANTES que OtController en
 * OtModule para que GET /ot/plazos no lo capture la ruta GET /ot/:id.
 */
@Injectable()
export class OtCierreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly facturas: FacturaService,
  ) {}

  private async cargarOt(id: string, req: any) {
    const tenantId = req?.user?.tenantId;
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { cliente: { select: { id: true, razonSocial: true, email: true } } },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  /** Columnas de plazo que no están en el modelo Prisma de la OT (align_firma_cierre.sql). */
  private async extrasOt(id: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.fecha_compromiso_origen AS origen, o.fecha_compromiso_at AS "fijadaAt",
              u.nombre_completo AS "fijadaPor", o.cerrada_por AS "cerradaPor",
              c.codigo AS "cotizacionCodigo", c.plazo_entrega_dias AS "plazoDias", c.estado AS "cotizacionEstado",
              to_char(o.vigencia_resolucion_hasta, 'YYYY-MM-DD') AS "vigenciaResolucion"
         FROM orden_trabajo o
         LEFT JOIN usuario u ON u.id = o.fecha_compromiso_por
         LEFT JOIN cotizacion c ON c.id = o.cotizacion_id
        WHERE o.id = $1::uuid`,
      id,
    );
    return f[0] ?? {};
  }

  /**
   * Con documentos por muestra, producto o laboratorio, cada uno con resultados
   * debe tener el suyo (o su «no emitido») para cerrar (docs/FLUJO_DOCUMENTOS_POR_OT.md).
   */
  private async coberturaPendiente(otId: string, tenantId: string, db: any = this.prisma): Promise<string[]> {
    try {
      return (await hechosCobertura(db, otId, tenantId)).pendientes;
    } catch {
      return []; // BD sin align_r1b_documentos_ot.sql: un documento por OT
    }
  }

  /** Documentos de la OT con lo necesario para el cierre. */
  private async documentos(otId: string) {
    const docs = await this.prisma.certificado.findMany({
      where: { otId, deletedAt: null },
      orderBy: { fecha: "asc" },
      select: {
        id: true,
        numero: true,
        codigo: true,
        version: true,
        estado: true,
        tipo: true,
        fecha: true,
        oficialAt: true,
        entregadoAt: true,
        entregaMedio: true,
        entregaDestinatario: true,
        plantilla: { select: { nombre: true, repid: true } },
        firmas: { select: { id: true, orden: true, estado: true, accion: true, rolNombre: true, responsables: true, obligatorio: true } },
      },
    });
    return docs.map(({ firmas, ...d }) => {
      const actuales = d.estado === "en_firma" ? pasosActuales(firmas) : [];
      const pendienteDe = actuales
        .map((p) => {
          const nombres = Array.isArray(p.responsables) ? (p.responsables as any[]).map((r) => r?.nombre).filter(Boolean) : [];
          return `${p.rolNombre ?? p.accion}${nombres.length ? `: ${nombres.join(" o ")}` : ""}`;
        })
        .join("; ");
      return {
        ...d,
        numero: d.numero ?? d.codigo,
        oficial: esOficial(d.estado),
        firmasHechas: firmas.filter((x) => x.estado === "firmado").length,
        // Pasos del circuito, también los anulados al devolver o anular.
        firmasTotal: firmas.length,
        pendienteDe: pendienteDe || null,
      };
    });
  }

  /** Estado de cierre de la OT: plazo, documentos, resultados, factura y qué falta. */
  async estadoCierre(id: string, req: any) {
    const ot = await this.cargarOt(id, req);
    const [extras, documentos, resultados, factura, metro] = await Promise.all([
      this.extrasOt(id),
      this.documentos(id),
      this.prisma.resultado.groupBy({ by: ["estado"], where: { otId: id, deletedAt: null }, _count: { _all: true } }),
      this.prisma.factura.findFirst({
        where: { otId: id, deletedAt: null, NOT: { estado: "anulada" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, numero: true, estado: true, total: true, moneda: true },
      }),
      // Metrología (EP-04): los certificados de calibración y los instrumentos de la OT cuentan para el cierre.
      metrologiaParaCierre(this.prisma, id, ot.tenantId),
    ]);
    const totalRes = resultados.reduce((a, r) => a + r._count._all, 0);
    const aprobados = resultados.find((r) => r.estado === "aprobado")?._count._all ?? 0;
    // Lote 4: «No ejecutado» (cierre por incumplimiento) no deja nada pendiente.
    const noEjecutados = resultados.find((r) => r.estado === "no_ejecutado")?._count._all ?? 0;
    const q4 = await this.cierreQ4(ot, req);
    const faltantes = [
      ...faltantesParaCerrar({
        estado: ot.estado,
        documentos: [
          ...documentos.map((d) => ({ numero: d.numero, estado: d.estado, entregadoAt: d.entregadoAt, pendienteDe: d.pendienteDe })),
          ...documentosDeMetrologia(metro.cals, metro.docsNoCalibrables),
        ],
        resultadosNoAprobados: totalRes - aprobados - noEjecutados,
        coberturaPendiente: await this.coberturaPendiente(id, ot.tenantId),
      }),
      // D04-31: las mismas reglas de Metrología que el cierre técnico (devolución, servicio externo, no calibrable).
      ...(ot.estado === "cerrada" ? [] : faltantesMetrologia(metro.items, metro.cals, metro.docsNoCalibrables, metro)),
      // EP-10 10.15/10.17: incumplimiento oficial notificado a DGMN; EP-11 11.27: armas entregadas.
      ...(ot.estado === "cerrada" ? [] : await faltantesNotificacionDgmn(this.prisma, id)),
      ...(ot.estado === "cerrada" ? [] : await faltantesCierreArmas(this.prisma, id)),
      // R3: muestra que pasa a otro laboratorio sin orden interna.
      ...(ot.estado === "cerrada" ? [] : faltantesOrdenInterna(await pendientesOrdenInterna(this.prisma, id))),
      // IDIC-PG 24 Anexo 03: internación sujeta a la tasa con la tasa remitida a facturación.
      ...(ot.estado === "cerrada" ? [] : await faltantesTasaInternacion(this.prisma, id)),
      // Lote 4: planilla de costos cerrada (por laboratorio) y, si se exige, los tres cierres (COORD-02).
      ...(ot.estado === "cerrada" ? [] : q4.faltantesCierre),
    ];
    const camino = caminoEstadosOt(ot.estado);
    if (!faltantes.length && camino === null)
      faltantes.push(`La OT está en un estado ('${ot.estado}') desde el que no se puede llegar a «cerrada».`);
    const avisos = ot.estado !== "cerrada" && ot.conCobro && !factura ? await this.avisosFactura(ot) : [];
    return {
      ot: {
        id: ot.id,
        codigo: ot.codigo,
        estado: ot.estado,
        conCobro: ot.conCobro,
        cotizacionId: ot.cotizacionId ?? null,
        origenTrabajo: ot.origenTrabajo ?? null,
        cliente: ot.cliente?.razonSocial ?? null,
        emailCliente: ot.cliente?.email ?? null,
        fechaRecepcion: ot.fechaRecepcion,
        fechaCierre: ot.fechaCierre,
      },
      plazo: {
        fechaCompromiso: diaDe(ot.fechaCompromiso),
        origen: extras.origen ?? null,
        fijadaAt: extras.fijadaAt ?? null,
        fijadaPor: extras.fijadaPor ?? null,
        sugerida: fechaCompromisoDesdePlazo(ot.fechaRecepcion, extras.plazoDias ?? null),
        plazoDiasCotizacion: extras.plazoDias ?? null,
        cotizacionCodigo: extras.cotizacionCodigo ?? null,
        // F009: OT del BPCH o la D11: la fecha no pasa la vigencia de la resolución.
        vigenciaResolucion: extras.vigenciaResolucion ?? null,
        // COM-23: umbral del parámetro avisos.dias_por_vencer y medición con la recepción en el DCO.
        ...semaforoPlazo(ot.fechaCompromiso, ot.estado, new Date(), {
          diasPorVencer: await diasPorVencerDe(this.prisma, ot.tenantId),
          fechaRecepDco: (ot as any).fechaRecepDco ?? null,
        }),
        fechaRecepDco: diaDe((ot as any).fechaRecepDco ?? null),
      },
      resultados: { total: totalRes, aprobados, noEjecutados },
      documentos,
      calibraciones: metro.cals
        .filter((c) => c.estado !== "reemplazada")
        // D04-32: con el medio de la entrega, como el resto de documentos.
        .map((c) => ({ id: c.id, numero: c.numeroCertificado ?? c.codigo, estado: c.estado, entregadoAt: c.entregadoAt ?? null, entregaMedio: c.entregaMedio ?? null })),
      // Informe técnico emitido y certificado externo validado de los no calibrables: también cuentan (decisión 24-10).
      documentosNoCalibrables: metro.docsNoCalibrables.filter(esEntregableNoCalibrable).map((x, i) => ({
        id: `${x.tipo}-${x.instrumentoId ?? i}`,
        tipo: x.tipo,
        numero: documentosDeNoCalibrables([x])[0].numero,
        entregadoAt: x.entregadoAt ?? null,
        entregaMedio: x.entregaMedio ?? null,
      })),
      factura: factura ? { ...factura, total: Number(factura.total) } : null,
      faltantes,
      avisos,
      // Lote 4: cierre por incumplimiento, tres cierres, planilla de costos y plazo de cierre.
      incumplimiento: q4.incumplimiento,
      cierres: q4.cierres,
      planillaCostos: q4.planillaCostos,
      plazoCierre: ot.estado === "cerrada" || ot.estado === "anulada" ? null : q4.plazoCierre,
      puedeCerrar: faltantes.length === 0,
      caminoEstados: camino ?? [],
      puedo: {
        planificar: tienePermiso(req, "ot.planificar") && !(OT_ESTADOS_TERMINADOS as readonly string[]).includes(ot.estado),
        cerrar: tienePermiso(req, "ot.cerrar"),
        cerrarIncumplimiento: tienePermiso(req, "ot.cerrar_incumplimiento"),
        emitir: tienePermiso(req, "certificado.emitir"),
        entregar: tienePermiso(req, "certificado.entregar"),
      },
    };
  }

  /**
   * Lote 4 (quinto envío): lo que el cierre necesita saber del cierre por
   * incumplimiento, los tres cierres (COORD-02), la planilla de costos y el
   * plazo de cierre (IDIC-PG03). Con la BD sin align_q4_cierre_ot.sql no bloquea.
   */
  private async cierreQ4(ot: { id: string; estado: string; tenantId: string }, req: any) {
    const [cfg, h] = await Promise.all([configCierreDe(this.prisma, ot.tenantId), hechosCierreQ4(this.prisma, ot.id)]);
    const n = cuentasResultados(h.porEstado);
    const hechas = hechasDe(h);
    const exige = exigePlanilla(cfg, h.laboratorio);
    const habilitado = laboratorioEn(cfg.incumplimientoLabs, h.laboratorio);
    const faltantesCierre = [
      ...faltantesPlanillaCostos({ exige, laboratorio: h.laboratorio, estadoPlanilla: h.estadoPlanilla }),
      ...faltantesTresCierres(cfg.exigeTresCierres, hechas),
    ];
    const terminada = !!h.terminadaEl;
    return {
      faltantesCierre,
      incumplimiento: {
        habilitado,
        registrado: h.incumplimiento,
        noCumpleAprobados: h.noCumpleAprobados,
        pendientes: n.sinTerminar,
        noEjecutados: n.noEjecutados,
        puede: tienePermiso(req, "ot.cerrar_incumplimiento"),
        // Lo que impide la acción, sin el motivo (lo pide la pantalla).
        faltantes: faltantesCierreIncumplimiento({
          estadoOt: ot.estado,
          laboratorio: h.laboratorio,
          habilitado,
          noCumpleAprobados: h.noCumpleAprobados,
          pendientes: n.sinTerminar,
        }),
      },
      cierres: {
        exigeTres: cfg.exigeTresCierres,
        etapas: ETAPAS_CIERRE.map((e) => ({
          etapa: e,
          nombre: NOMBRE_ETAPA[e],
          registro: h.etapas[e],
          puedo: tienePermiso(req, PERMISO_ETAPA[e]),
          faltantes: faltantesEtapaCierre(e, { estadoOt: ot.estado, hechas, sinCapturar: n.sinCapturar, sinTerminar: n.sinTerminar }),
        })),
      },
      planillaCostos: { exige, laboratorio: h.laboratorio, estado: h.estadoPlanilla },
      plazoCierre: terminada ? { ...plazoCierre(h.terminadaEl, hoyCl(), cfg.diasCierre)!, dias: cfg.diasCierre, habiles: true } : null,
    };
  }

  /**
   * Lote 4 · «Cerrar por incumplimiento» (BPCH): un ensayo aprobado dio No
   * cumple y el Jefe de Laboratorio cierra el flujo de TODA la OT (todas sus
   * muestras y lotes): los ensayos aún no aprobados pasan a «No ejecutado» con
   * el motivo, quién y cuándo (no se borran; traza en resultado_historial,
   * ot_historial y la bitácora). Después la OT se emite (Informe de
   * Incumplimiento con esos ensayos «No ejecutado») y se cierra normalmente;
   * los «No ejecutado» no se cobran.
   */
  async cerrarPorIncumplimiento(id: string, dto: { motivo: string }, req: any) {
    const ot = await this.cargarOt(id, req);
    const usuarioId: string | null = req?.user?.sub ?? null;
    const cfg = await configCierreDe(this.prisma, ot.tenantId);
    const r = await conTraza(this.prisma, { usuarioId, motivo: dto.motivo.trim(), origen: "cierre_incumplimiento" }, async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`, id);
      const h = await hechosCierreQ4(tx as any, id);
      const n = cuentasResultados(h.porEstado);
      const f = faltantesCierreIncumplimiento({
        estadoOt: ot.estado,
        laboratorio: h.laboratorio,
        habilitado: laboratorioEn(cfg.incumplimientoLabs, h.laboratorio),
        noCumpleAprobados: h.noCumpleAprobados,
        pendientes: n.sinTerminar,
        motivo: dto.motivo,
      });
      if (f.length) throw new ConflictException(`No se puede cerrar la OT ${ot.codigo} por incumplimiento. ${f.join(" ")}`);
      const motivo = dto.motivo.trim();
      const filas = await tx.$queryRawUnsafe<{ id: string; estado: string }[]>(
        `UPDATE resultado r
            SET estado_previo_no_ejecutado = r.estado, estado = 'no_ejecutado',
                no_ejecutado_motivo = $2, no_ejecutado_por = $3::uuid, no_ejecutado_at = now()
          WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL AND r.estado = ANY($4::text[])
          RETURNING r.id, r.estado_previo_no_ejecutado AS estado`,
        id,
        motivo,
        usuarioId,
        [...ESTADOS_A_NO_EJECUTADO],
      );
      // La traza por ensayo (estado anterior → no_ejecutado, con quién, motivo y origen) la
      // escribe el disparador de resultado_historial con el contexto de conTraza.
      await tx.$executeRawUnsafe(
        `UPDATE orden_trabajo
            SET incumplimiento_cerrado_at = now(), incumplimiento_cerrado_por = $2::uuid, incumplimiento_cerrado_motivo = $3, updated_at = now()
          WHERE id = $1::uuid`,
        id,
        usuarioId,
        motivo,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'cierre_incumplimiento', $3::jsonb, $4::uuid)`,
        ot.tenantId,
        id,
        JSON.stringify({ motivo, noEjecutados: filas.length, noCumpleAprobados: h.noCumpleAprobados }),
        usuarioId,
      );
      return filas.length;
    });
    // `codigo` y `motivo`: la bitácora (AuditInterceptor) registra la acción con el código de la OT.
    return { id: ot.id, codigo: ot.codigo, noEjecutados: r, ...(await this.estadoCierre(id, req)) };
  }

  /**
   * COORD-02 · Registra el cierre de una etapa (analista, jefe de laboratorio o
   * jefe de departamento) con la fecha real y el usuario. Cada etapa pide su
   * permiso (ot.cierre_analista, ot.cierre_jefe_lab, ot.cierre_jefe_depto) y la
   * anterior registrada. `fecha_cierre` sigue siendo el cierre final de la OT.
   */
  async registrarEtapa(id: string, etapa: EtapaCierre, req: any) {
    if (!tienePermiso(req, PERMISO_ETAPA[etapa]))
      throw new ForbiddenException(`Permiso insuficiente. Requiere: ${PERMISO_ETAPA[etapa]}`);
    const ot = await this.cargarOt(id, req);
    const usuarioId: string | null = req?.user?.sub ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`, id);
      const h = await hechosCierreQ4(tx as any, id);
      const n = cuentasResultados(h.porEstado);
      const f = faltantesEtapaCierre(etapa, { estadoOt: ot.estado, hechas: hechasDe(h), sinCapturar: n.sinCapturar, sinTerminar: n.sinTerminar });
      if (f.length) throw new ConflictException(`No se puede registrar el cierre del ${NOMBRE_ETAPA[etapa]} de la OT ${ot.codigo}. ${f.join(" ")}`);
      // Columnas fijas por etapa (nunca texto del usuario en el SQL).
      const col = { analista: "cierre_analista", jefe_lab: "cierre_jefe_lab", jefe_depto: "cierre_jefe_depto" }[etapa];
      await tx.$executeRawUnsafe(`UPDATE orden_trabajo SET ${col}_at = now(), ${col}_por = $2::uuid, updated_at = now() WHERE id = $1::uuid`, id, usuarioId);
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'cierre_etapa', $3::jsonb, $4::uuid)`,
        ot.tenantId,
        id,
        JSON.stringify({ etapa, nombre: NOMBRE_ETAPA[etapa] }),
        usuarioId,
      );
    });
    return { id: ot.id, codigo: ot.codigo, etapa, ...(await this.estadoCierre(id, req)) };
  }

  /**
   * Aviso (no bloquea) antes de cerrar una OT con cobro sin cotización aceptada:
   * si sus ensayos no tienen precio en la lista vigente ni en la ficha y no hay
   * valor estimado, la factura pendiente nacerá en $ 0 (p. ej. Producción Nacional).
   */
  private async avisosFactura(ot: { id: string; codigo: string; tenantId: string; cotizacionId: string | null }): Promise<string[]> {
    if (ot.cotizacionId) {
      const cot = await this.prisma.cotizacion.findFirst({ where: { id: ot.cotizacionId }, select: { estado: true } });
      if (cot?.estado === "aceptada") return [];
    }
    const lineas = await this.facturas.lineasSinCotizacion(this.prisma, { id: ot.id, codigo: ot.codigo, tenantId: ot.tenantId });
    return borradorSinImporte(lineas)
      ? [
          lineas.length
            ? "Los ensayos de la OT no tienen precio en la lista de precios vigente ni en la ficha: la factura pendiente nacerá con sus líneas en $ 0 y Finanzas deberá valorizarlas antes de emitirla."
            : "La OT no tiene ensayos con precio ni valor estimado: la factura pendiente nacerá sin importe y Finanzas deberá completar sus líneas antes de emitirla.",
        ]
      : [];
  }

  /** Planificación / jefatura fija o corrige la fecha de compromiso (origen «manual»). */
  async fijarFechaCompromiso(id: string, dto: { fecha: string; motivo?: string }, req: any) {
    const ot = await this.cargarOt(id, req);
    if ((OT_ESTADOS_TERMINADOS as readonly string[]).includes(ot.estado))
      throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: su plazo ya no se modifica.`);
    // Sin fecha de recepción (OT antiguas), el límite es el alta de la OT.
    const error = validarFechaCompromiso(dto.fecha, ot.fechaRecepcion ?? ot.createdAt);
    if (error) throw new BadRequestException(error);
    // R3: no pasa la vigencia de la resolución (OT del BPCH y la D11).
    const [v] = await this.prisma.$queryRawUnsafe<{ vigencia: string | null }[]>(
      `SELECT to_char(vigencia_resolucion_hasta, 'YYYY-MM-DD') AS vigencia FROM orden_trabajo WHERE id = $1::uuid`,
      id,
    );
    const errorVigencia = errorCambioPlazo(dto.fecha, v?.vigencia ?? null, false);
    if (errorVigencia) throw new BadRequestException(errorVigencia);
    const nota = dto.motivo?.trim()
      ? `[${hoyCl()}] Fecha de compromiso ${diaDe(ot.fechaCompromiso) ?? "sin fecha"} → ${dto.fecha}: ${dto.motivo.trim()}`
      : null;
    const usuarioId: string | null = req?.user?.sub ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE orden_trabajo
            SET fecha_compromiso = $2::date, fecha_compromiso_origen = 'manual',
                fecha_compromiso_por = $3::uuid, fecha_compromiso_at = now(), updated_at = now(),
                notas = CASE WHEN $4::text IS NULL THEN notas ELSE concat_ws(E'\\n', notas, $4::text) END
          WHERE id = $1::uuid`,
        id,
        dto.fecha,
        usuarioId,
        nota,
      );
      // Pestaña «Historial» de la OT: la fecha anterior, la nueva y el motivo, con quién y cuándo.
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'fecha_compromiso', $3::jsonb, $4::uuid)`,
        ot.tenantId,
        id,
        JSON.stringify({ desde: diaDe(ot.fechaCompromiso) ?? null, hacia: dto.fecha, motivo: dto.motivo?.trim() || null }),
        usuarioId,
      );
    });
    // `codigo`: la bitácora (AuditInterceptor) registra el cambio con el código de la OT.
    return { id: ot.id, codigo: ot.codigo, ...(await this.estadoCierre(id, req)) };
  }

  /**
   * Cierra la OT: comprueba (con la OT bloqueada) que todos sus documentos
   * están oficiales y entregados, recorre la máquina de estados hasta
   * «cerrada», fija fecha de cierre y, si la OT es con cobro, crea la factura
   * en borrador para Finanzas. Todo en una transacción.
   */
  async cerrar(id: string, req: any) {
    const ot = await this.cargarOt(id, req);
    const usuarioId: string | null = req?.user?.sub ?? null;
    // Lote 4: planilla de costos cerrada y tres cierres (se leen fuera de la transacción:
    // con la BD sin align_q4_cierre_ot.sql la lectura falla sin abortarla).
    const q4 = await this.cierreQ4(ot, req);
    const resultado = await this.prisma.$transaction(async (tx) => {
      // Bloqueo de la fila: dos cierres simultáneos no generan dos facturas.
      const filas = await tx.$queryRawUnsafe<{ estado: string }[]>(
        `SELECT estado FROM orden_trabajo WHERE id = $1::uuid FOR UPDATE`,
        id,
      );
      const estado = filas[0]?.estado ?? ot.estado;
      const docs = await tx.certificado.findMany({
        where: { otId: id, deletedAt: null },
        select: { numero: true, codigo: true, estado: true, entregadoAt: true },
      });
      // Lote 4: «No ejecutado» (cierre por incumplimiento) tampoco deja nada pendiente.
      const noAprobados = await tx.resultado.count({ where: { otId: id, deletedAt: null, estado: { notIn: ["aprobado", "no_ejecutado"] } } });
      const metro = await metrologiaParaCierre(tx, id, ot.tenantId);
      const faltantes = [
        ...faltantesParaCerrar({
          estado,
          documentos: [
            ...docs.map((d) => ({ numero: d.numero ?? d.codigo, estado: d.estado, entregadoAt: d.entregadoAt })),
            ...documentosDeMetrologia(metro.cals, metro.docsNoCalibrables),
          ],
          resultadosNoAprobados: noAprobados,
          coberturaPendiente: await this.coberturaPendiente(id, ot.tenantId, tx),
        }),
        ...(estado === "cerrada" ? [] : faltantesMetrologia(metro.items, metro.cals, metro.docsNoCalibrables, metro)),
        ...(estado === "cerrada" ? [] : await faltantesNotificacionDgmn(tx, id)),
        ...(estado === "cerrada" ? [] : await faltantesCierreArmas(tx, id)),
        ...(estado === "cerrada" ? [] : faltantesOrdenInterna(await pendientesOrdenInterna(tx as any, id))),
        ...(estado === "cerrada" ? [] : await faltantesTasaInternacion(tx, id)),
        ...(estado === "cerrada" ? [] : q4.faltantesCierre),
      ];
      const camino = caminoEstadosOt(estado);
      if (!faltantes.length && camino === null)
        faltantes.push(`La OT está en un estado ('${estado}') desde el que no se puede llegar a «cerrada».`);
      if (faltantes.length) throw new ConflictException(`No se puede cerrar la OT ${ot.codigo}. ${faltantes.join(" ")}`);

      const ahora = new Date();
      await tx.ordenTrabajo.update({
        where: { id },
        data: { estado: "cerrada", fechaCierre: ahora, updatedAt: ahora },
      });
      await tx.$executeRawUnsafe(`UPDATE orden_trabajo SET cerrada_por = $2::uuid WHERE id = $1::uuid`, id, usuarioId);

      const factura = ot.conCobro
        ? await this.facturas.crearBorradorDesdeOt(
            tx,
            {
              id: ot.id,
              codigo: ot.codigo,
              tenantId: ot.tenantId,
              clienteId: ot.clienteId,
              cotizacionId: ot.cotizacionId,
              centroCostoId: ot.centroCostoId,
            },
            usuarioId,
          )
        : null;
      return { recorrido: [estado, ...(camino ?? [])], factura };
    });
    const estadoFinal = await this.estadoCierre(id, req);
    return {
      ...estadoFinal,
      recorrido: resultado.recorrido,
      facturaCreada: resultado.factura
        ? { id: resultado.factura.id, numero: resultado.factura.numero, estado: resultado.factura.estado, total: Number(resultado.factura.total) }
        : null,
    };
  }

  /**
   * OT «listas para cerrar»: documento oficial, todos entregados, ninguno en
   * firma ni devuelto y todos los resultados aprobados. Mismo criterio que la
   * tarjeta de Mi bandeja (rbac/bandeja.service.ts) y que GET /ot?listasCierre=1.
   */
  async idsListasParaCerrar(tenantId?: string | null): Promise<string[]> {
    // Misma condición que la tarjeta de Mi bandeja (ot/lista-cierre.ts, B-017).
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT o.id FROM orden_trabajo o
        WHERE o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND ${SQL_OT_LISTA_PARA_CERRAR}`,
      tenantId ?? null,
    );
    return filas.map((r) => r.id);
  }

  /** OT cerradas CON COBRO sin ninguna factura viva (tarjeta de Finanzas). */
  async idsCerradasSinFactura(tenantId?: string | null): Promise<string[]> {
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT o.id FROM orden_trabajo o
        WHERE o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND o.estado = 'cerrada' AND o.con_cobro
          AND NOT EXISTS (SELECT 1 FROM factura f WHERE f.ot_id = o.id AND f.deleted_at IS NULL AND f.estado <> 'anulada')`,
      tenantId ?? null,
    );
    return filas.map((r) => r.id);
  }

  /**
   * OT abiertas con su semáforo de plazo. `?semaforo=` filtra (vencida |
   * por_vencer | en_plazo | sin_fecha), con los mismos cortes que la bandeja.
   * Misma forma que GET /ot (con cliente), acotado por alcance.
   */
  async plazos(req: any, semaforo?: string, listasCierre = false, unidadCodigo?: string) {
    const tenantId = req?.user?.tenantId;
    let filtro = await this.alcance.filtroUnidades(req);
    if (unidadCodigo) {
      const u = await this.prisma.unidad.findFirst({
        where: { codigo: unidadCodigo, ...(tenantId ? { tenantId } : {}) },
        select: { id: true },
      });
      const id = u?.id ?? "00000000-0000-0000-0000-000000000000";
      filtro = filtro ? filtro.filter((x) => x === id) : [id];
    }
    // «OT listas para cerrar»: mismo criterio que la tarjeta de la bandeja.
    const listas = listasCierre ? await this.idsListasParaCerrar(tenantId) : null;
    const hoy = hoyCl();
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const umbral = await diasPorVencerDe(this.prisma, tenantId);
    // COM-23: con la recepción en el DCO registrada el plazo ya no corre.
    const sinRecepDco = { fechaRecepDco: null };
    const condFecha: any =
      semaforo === "vencida"
        ? { ...sinRecepDco, fechaCompromiso: { lt: d(hoy) } }
        : semaforo === "por_vencer"
          ? { ...sinRecepDco, fechaCompromiso: { gte: d(hoy), lte: d(sumarDias(hoy, umbral)) } }
          : semaforo === "en_plazo"
            ? { ...sinRecepDco, fechaCompromiso: { gt: d(sumarDias(hoy, umbral)) } }
            : semaforo === "sin_fecha"
              ? { ...sinRecepDco, fechaCompromiso: null }
              : {};
    const ots = await this.prisma.ordenTrabajo.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(filtro ? { unidadPrincipal: { in: filtro } } : {}),
        estado: { notIn: [...OT_ESTADOS_TERMINADOS] },
        ...condFecha,
        ...(listas ? { id: { in: listas } } : {}),
      },
      orderBy: [{ fechaCompromiso: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 500,
      include: { cliente: true },
    });
    return ots.map((o) => ({ ...o, plazo: semaforoPlazo(o.fechaCompromiso, o.estado, new Date(), { diasPorVencer: umbral, fechaRecepDco: o.fechaRecepDco }) }));
  }
}

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class OtCierreController {
  constructor(private readonly svc: OtCierreService) {}

  /** OT abiertas con semáforo de plazo (?semaforo=vencida|por_vencer|en_plazo|sin_fecha, ?listasCierre=1). */
  @Get("plazos")
  @RequierePermiso("ot.ver")
  plazos(
    @Req() req: any,
    @Query("semaforo") semaforo?: string,
    @Query("listasCierre") listasCierre?: string,
    @Query("unidad") unidad?: string,
  ) {
    const s = semaforo && (SEMAFOROS as readonly string[]).includes(semaforo) ? semaforo : undefined;
    const u = unidad && /^[A-Za-z0-9_-]{1,40}$/.test(unidad) ? unidad : undefined;
    return this.svc.plazos(req, s, listasCierre === "1" || listasCierre === "true", u);
  }

  /** Plazo, documentos, resultados, factura y qué falta para cerrar. */
  @Get(":id/cierre")
  @RequierePermiso("ot.ver")
  estado(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.estadoCierre(id, req);
  }

  @Put(":id/fecha-compromiso")
  @RequierePermiso("ot.planificar")
  fijar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.fijarFechaCompromiso(id, FechaCompromiso.parse(body ?? {}), req);
  }

  @Post(":id/cerrar")
  @RequierePermiso("ot.cerrar")
  cerrar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cerrar(id, req);
  }

  /** Lote 4 · BPCH: ensayos pendientes → «No ejecutado» con motivo (un ensayo aprobado dio No cumple). */
  @Post(":id/cerrar-incumplimiento")
  @RequierePermiso("ot.cerrar_incumplimiento")
  cerrarIncumplimiento(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.cerrarPorIncumplimiento(id, CierreIncumplimiento.parse(body ?? {}), req);
  }

  /** COORD-02 · Cierre del analista, del jefe de laboratorio o del jefe de departamento (permiso propio de cada etapa). */
  @Post(":id/cierre-etapa/:etapa")
  @RequierePermiso("ot.ver")
  registrarEtapa(@Param("id", ParseUUIDPipe) id: string, @Param("etapa") etapa: string, @Req() req: any) {
    if (!esEtapaCierre(etapa)) throw new BadRequestException(`Etapa de cierre desconocida. Valores: ${ETAPAS_CIERRE.join(", ")}`);
    return this.svc.registrarEtapa(id, etapa, req);
  }
}
