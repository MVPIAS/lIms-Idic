import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { FirmasMatrizService } from "../rbac/firmas-matriz.controller";
import type { ReglaFirma } from "../rbac/firmas-resolver";
import { MensajeriaService } from "../mensajeria/mensajeria.module";
import { CotizacionService } from "./cotizacion.service";
import { exigirCotizacionEnAlcance } from "./alcance-cotizacion";
import { leerConfigCircuito } from "./circuito-config";
import {
  ETIQUETA_SOLICITUD,
  calcularRutaCotizacion,
  estadoTrasRespuesta,
  estadoTrasVb,
  faltantesParaFirma,
  motivoNoEditable,
  motivoNoEnviable,
  nivelVbPendiente,
  puedeResponder,
  type FirmaEstado,
  type NivelVb,
  type RespuestaLab,
  type SolicitudRuta,
} from "./circuito-cotizacion";
import { exigirMedioEnvioActivo, textoEnFrase } from "../common/medios-envio";
import { calcularForm05, erroresForm05, erroresPrograma, type Form05Entrada, type ProgramaTrabajo, exigeCosteo, type TipoServicio } from "./form05";
import { numeroFormulario } from "./numeracion-cotizacion";
import { htmlCotizacion, pdfCotizacion, type FirmasCotizacion } from "./cotizacion-documento";
import { hoyEnChile, soloFecha } from "./validez";

/** Tipos de unidad a los que Comercial pide fechas y costo (laboratorios y sus equivalentes). */
const TIPOS_CONSULTABLES = ["LABORATORIO", "SUCURSAL", "DELEGACION", "SECCION"];

export interface FilaCot {
  id: string;
  tenantId: string;
  codigo: string;
  estado: string;
  circuito: string | null;
  firmaEstado: FirmaEstado;
  firmaDevueltaMotivo: string | null;
  firmadaAt: Date | null;
  firmadaPorNombre: string | null;
  firmaSolicitadaAt: Date | null;
  enviadaAt: Date | null;
  enviadaMedio: string | null;
  enviadaMedioTexto: string | null;
  enviadaDestinatarios: string | null;
  envioObservacion: string | null;
  ejecutivoNombre: string | null;
  createdAt: Date;
  lineas: number;
  clienteId: string;
  centroCostoId: string | null;
  otCodigo: string | null;
}

export interface FilaSol {
  id: string;
  cotizacionId: string;
  unidadId: string | null;
  unidadCodigo: string | null;
  unidadNombre: string | null;
  numero: string | null;
  tipoServicio: string | null;
  estado: string;
  comentarioEjecutivo: string | null;
  conCopia: string | null;
  solicitadaAt: Date | null;
  solicitadaPorNombre: string | null;
  respuesta: string | null;
  comentarioLab: string | null;
  programa: any;
  costeo: any;
  plazoEntregaDias: number | null;
  fechaInicio: Date | null;
  fechaTermino: Date | null;
  respondidaAt: Date | null;
  respondidaPorNombre: string | null;
  vbLabAt: Date | null;
  vbLabPorNombre: string | null;
  vbLabComentario: string | null;
  vbDeptoAt: Date | null;
  vbDeptoPorNombre: string | null;
  vbDeptoComentario: string | null;
  devueltaMotivo: string | null;
  horasHombre: number;
  costoDirecto: number;
}

const SQL_COT = `
  SELECT c.id, c.tenant_id AS "tenantId", c.codigo, c.estado, c.circuito, c.firma_estado AS "firmaEstado",
         c.firma_devuelta_motivo AS "firmaDevueltaMotivo", c.firmada_at AS "firmadaAt", fp.nombre_completo AS "firmadaPorNombre",
         c.firma_solicitada_at AS "firmaSolicitadaAt", c.enviada_at AS "enviadaAt", c.enviada_medio AS "enviadaMedio",
         (SELECT p.etiqueta FROM parametro_sistema p
           WHERE p.tenant_id = c.tenant_id AND p.categoria = 'medio_envio' AND p.codigo = c.enviada_medio LIMIT 1) AS "enviadaMedioTexto",
         c.enviada_destinatarios AS "enviadaDestinatarios", c.envio_observacion AS "envioObservacion",
         e.nombre_completo AS "ejecutivoNombre", c.created_at AS "createdAt", c.cliente_id AS "clienteId",
         c.centro_costo_id AS "centroCostoId",
         (SELECT count(*)::int FROM linea_cotizacion l WHERE l.cotizacion_id = c.id) AS lineas,
         (SELECT o.codigo FROM orden_trabajo o WHERE o.cotizacion_id = c.id ORDER BY o.created_at LIMIT 1) AS "otCodigo"
    FROM cotizacion c
    LEFT JOIN usuario fp ON fp.id = c.firmada_por
    LEFT JOIN usuario e  ON e.id = c.ejecutivo_id
   WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid`;

const SQL_SOL = `
  SELECT s.id, s.cotizacion_id AS "cotizacionId", s.unidad_id AS "unidadId", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre",
         s.numero, s.tipo_servicio AS "tipoServicio", s.estado, s.comentario_ejecutivo AS "comentarioEjecutivo", s.con_copia AS "conCopia",
         s.solicitada_at AS "solicitadaAt", us.nombre_completo AS "solicitadaPorNombre", s.respuesta, s.comentario_lab AS "comentarioLab",
         s.programa, s.costeo, s.plazo_entrega_dias AS "plazoEntregaDias", s.fecha_inicio AS "fechaInicio", s.fecha_termino AS "fechaTermino",
         s.respondida_at AS "respondidaAt", ur.nombre_completo AS "respondidaPorNombre",
         s.vb_lab_at AS "vbLabAt", ul.nombre_completo AS "vbLabPorNombre", s.vb_lab_comentario AS "vbLabComentario",
         s.vb_depto_at AS "vbDeptoAt", ud.nombre_completo AS "vbDeptoPorNombre", s.vb_depto_comentario AS "vbDeptoComentario",
         s.devuelta_motivo AS "devueltaMotivo", s.horas_hombre::float8 AS "horasHombre", s.costo_directo::float8 AS "costoDirecto"
    FROM solicitud_costeo s
    LEFT JOIN unidad u   ON u.id = s.unidad_id
    LEFT JOIN usuario us ON us.id = s.solicitada_por
    LEFT JOIN usuario ur ON ur.id = s.respondida_por
    LEFT JOIN usuario ul ON ul.id = s.vb_lab_por
    LEFT JOIN usuario ud ON ud.id = s.vb_depto_por
   WHERE s.deleted_at IS NULL AND s.tenant_id = $2::uuid`;

/**
 * Circuito de la cotización (EP-00 2.3–2.8, 3.4): solicitud al laboratorio,
 * respuesta con programa y costeo, V°B°, firma del Jefe DCO, documento y envío.
 * Reglas puras en circuito-cotizacion.ts y form05.ts.
 */
@Injectable()
export class CircuitoCotizacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly matriz: FirmasMatrizService,
    private readonly mensajeria: MensajeriaService,
    private readonly cotizaciones: CotizacionService,
  ) {}

  private tenant(req: any): string {
    const t = req?.user?.tenantId;
    if (!t) throw new ForbiddenException("Tenant no resuelto en el token");
    return t;
  }

  private yo(req: any): string | null {
    return req?.user?.sub ?? null;
  }

  private async cot(id: string, tenantId: string): Promise<FilaCot> {
    const f = await this.prisma.$queryRawUnsafe<FilaCot[]>(SQL_COT, id, tenantId);
    if (!f[0]) throw new NotFoundException("Cotización no encontrada");
    return f[0];
  }

  private async solicitudes(cotizacionId: string, tenantId: string): Promise<FilaSol[]> {
    return this.prisma.$queryRawUnsafe<FilaSol[]>(`${SQL_SOL} AND s.cotizacion_id = $1::uuid ORDER BY s.created_at`, cotizacionId, tenantId);
  }

  private async solicitud(id: string, tenantId: string): Promise<FilaSol> {
    const f = await this.prisma.$queryRawUnsafe<FilaSol[]>(`${SQL_SOL} AND s.id = $1::uuid`, id, tenantId);
    if (!f[0]) throw new NotFoundException("Solicitud al laboratorio no encontrada");
    return f[0];
  }

  private async evento(tenantId: string, cotizacionId: string, accion: string, usuarioId: string | null, comentario?: string | null, detalle?: unknown, solicitudId?: string | null) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO cotizacion_evento (tenant_id, cotizacion_id, solicitud_id, accion, comentario, detalle, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7::uuid)`,
      tenantId,
      cotizacionId,
      solicitudId ?? null,
      accion,
      comentario ?? null,
      detalle === undefined ? null : JSON.stringify(detalle),
      usuarioId,
    );
  }

  /* ------------------------------------------------------- responsables --- */

  private async rolesPorCodigo(codigos: string[]) {
    return this.prisma.rol.findMany({
      where: { codigo: { in: codigos } },
      select: { id: true, codigo: true, nombre: true, nivel: true, alcance: true, aliasDe: true },
    });
  }

  /** Quién da el V°B° de un nivel para la unidad de la solicitud (Jefe de Laboratorio · Jefe de Departamento). */
  async responsablesVb(nivel: NivelVb, unidadId: string, tenantId: string) {
    const codigo = nivel === "lab" ? "JEFE_LAB" : "JEFE_DEPTO";
    const rol = (await this.rolesPorCodigo([codigo])).find((r) => r.codigo === codigo);
    if (!rol) return { rol: nivel === "lab" ? "Jefe de Laboratorio" : "Jefe de Departamento", unidad: null as string | null, personas: [] as { id: string; nombre: string }[] };
    const regla: ReglaFirma = {
      id: `vb-${nivel}`,
      tipoDocumento: "COTIZACION_VB",
      unidadId: null,
      orden: 1,
      accion: "VB",
      rolId: rol.id,
      nivelUnidad: nivel === "lab" ? "MISMA" : "DEPARTAMENTO",
      unidadDestinoId: null,
      obligatorio: true,
      activo: true,
      rol,
    };
    const res = await this.matriz.resolver("COTIZACION_VB", unidadId, tenantId, { reglasFijas: [regla] });
    const paso = res.pasos[0];
    return {
      rol: nivel === "lab" ? "Jefe de Laboratorio" : "Jefe de Departamento",
      unidad: paso?.unidad?.codigo ?? null,
      personas: (paso?.responsables ?? []).map((r) => ({ id: r.usuarioId, nombre: r.nombre })),
    };
  }

  /** Responsables del paso FIRMA de la matriz COTIZACION (la cotización la emite el Departamento Comercial). */
  async firmantes(tenantId: string) {
    const dco = (await this.alcance.arbol(tenantId)).porCodigo.get("DCO")?.id ?? null;
    const res = await this.matriz.resolver("COTIZACION", dco, tenantId);
    const pasos = res.pasos.filter((p) => p.accion === "FIRMA");
    const personas = new Map<string, string>();
    for (const p of pasos) for (const r of p.responsables) personas.set(r.usuarioId, r.nombre);
    return [...personas].map(([id, nombre]) => ({ id, nombre }));
  }

  private tienePermiso(req: any, permisos: string[]): boolean {
    if ((req?.user?.roles ?? []).includes("SUPERADMIN")) return true;
    const tiene: string[] = req?.user?.permisos ?? [];
    return permisos.every((p) => tiene.includes(p));
  }

  /* ------------------------------------------------------------- estado --- */

  /** Todo lo que pinta la ficha de la cotización: ruta, solicitudes, V°B°, firma, envío y bitácora. */
  async estado(req: any, id: string) {
    const tenantId = this.tenant(req);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id, "cotizacion.ver");
    await this.cotizaciones.vencerFueraDeValidez(tenantId, id);
    const [c, sols, cfg, firmantes] = await Promise.all([
      this.cot(id, tenantId),
      this.solicitudes(id, tenantId),
      leerConfigCircuito(this.prisma, tenantId),
      this.firmantes(tenantId),
    ]);
    const yo = this.yo(req);
    const conVb: (FilaSol & { vb: SolicitudRuta["vb"]; puedoResponder: boolean; puedoVb: boolean })[] = [];
    for (const s of sols) {
      const nivel = s.unidadId ? nivelVbPendiente(s.estado, cfg.niveles) : null;
      const vb = nivel && s.unidadId ? { nivel, ...(await this.responsablesVb(nivel, s.unidadId, tenantId)) } : null;
      const enAlcance = s.unidadId ? await this.alcance.puedeVerUnidad(req, s.unidadId, "cotizacion.costear") : false;
      const editable = c.estado === "abierta" && !motivoNoEditable(c.firmaEstado);
      conVb.push({
        ...s,
        vb,
        puedoResponder: editable && puedeResponder(s.estado) && this.tienePermiso(req, ["cotizacion.costear"]) && enAlcance,
        puedoVb: editable && !!vb && this.tienePermiso(req, ["cotizacion.vb"]) && !!yo && vb.personas.some((p) => p.id === yo),
      });
    }
    const hechos = {
      codigo: c.codigo,
      estado: c.estado,
      circuito: c.circuito,
      firmaEstado: c.firmaEstado,
      lineas: c.lineas,
      firmaDevueltaMotivo: c.firmaDevueltaMotivo,
      firmadaPor: c.firmadaPorNombre,
      enviadaAt: c.enviadaAt,
      enviadaMedio: c.enviadaMedio,
      enviadaMedioTexto: c.enviadaMedioTexto,
      ot: c.otCodigo ? { codigo: c.otCodigo } : null,
      solicitudes: conVb.map((s) => ({ id: s.id, estado: s.estado, unidad: s.unidadCodigo, unidadId: s.unidadId, numero: s.numero, vb: s.vb })),
      firmantes,
    };
    const ruta = calcularRutaCotizacion(hechos, cfg);
    let puedoActuar = false;
    const a = ruta.siguiente?.accion;
    if (a) {
      puedoActuar = this.tienePermiso(req, a.permisos);
      if (puedoActuar && a.usuarios) puedoActuar = !!yo && a.usuarios.includes(yo);
      if (puedoActuar && a.unidadId) puedoActuar = await this.alcance.puedeVerUnidad(req, a.unidadId, "cotizacion.costear");
    }
    const eventos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.accion, e.comentario, e.detalle, e.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre",
              s.numero AS "solicitudNumero", un.codigo AS "unidadCodigo"
         FROM cotizacion_evento e
         LEFT JOIN usuario u ON u.id = e.usuario_id
         LEFT JOIN solicitud_costeo s ON s.id = e.solicitud_id
         LEFT JOIN unidad un ON un.id = s.unidad_id
        WHERE e.cotizacion_id = $1::uuid AND e.tenant_id = $2::uuid
        ORDER BY e.created_at`,
      id,
      tenantId,
    );
    // Destinatarios sugeridos para «Enviar al cliente»: correo del cliente y de sus contactos.
    const destinatarios = await this.prisma.$queryRawUnsafe<{ nombre: string; cargo: string | null; email: string; principal: boolean }[]>(
      `SELECT cl.razon_social AS nombre, NULL::text AS cargo, cl.email::text AS email, TRUE AS principal
         FROM cliente cl WHERE cl.id = $1::uuid AND cl.email IS NOT NULL AND cl.email::text <> ''
       UNION ALL
       SELECT ct.nombre, ct.cargo, ct.email::text, COALESCE(ct.principal, ct.es_principal, FALSE)
         FROM contacto ct WHERE ct.cliente_id = $1::uuid AND ct.deleted_at IS NULL AND COALESCE(ct.activo, TRUE)
          AND ct.email IS NOT NULL AND ct.email::text <> ''`,
      c.clienteId,
    );
    const faltanFirma = faltantesParaFirma(c, sols.map((s) => ({ id: s.id, estado: s.estado, unidad: s.unidadCodigo, numero: s.numero })), cfg, "enviar");
    const editable = c.estado === "abierta" && !motivoNoEditable(c.firmaEstado);
    return {
      cotizacion: c,
      config: { niveles: cfg.niveles, exigirConsulta: cfg.exigirConsulta, exigirFirma: cfg.exigirFirma, cfaPct: cfg.cfaPct, margenParticularPct: cfg.margenParticularPct, ivaPct: cfg.ivaPct },
      ruta: { ...ruta, siguiente: ruta.siguiente ? { ...ruta.siguiente, puedoActuar } : null },
      solicitudes: conVb.map((s) => ({ ...s, etiquetaEstado: ETIQUETA_SOLICITUD[s.estado] ?? s.estado })),
      firmantes: firmantes.map((f) => f.nombre),
      faltantesFirma: faltanFirma,
      eventos,
      destinatarios,
      puedo: {
        solicitar: editable && this.tienePermiso(req, ["cotizacion.crear"]),
        enviarAFirma: faltanFirma.length === 0 && c.circuito === "r1" && this.tienePermiso(req, ["cotizacion.crear"]),
        firmar: c.firmaEstado === "pendiente" && c.estado === "abierta" && this.tienePermiso(req, ["cotizacion.firmar"]) && !!yo && firmantes.some((f) => f.id === yo),
        enviarCliente: !motivoNoEnviable(c) && this.tienePermiso(req, ["cotizacion.crear"]),
      },
    };
  }

  /* --------------------------------------------------------- solicitudes --- */

  /** 2.3 / 2.4 · El ejecutivo pide fechas (servicio estándar) o abre el formulario de costeo (no estándar). */
  async solicitar(req: any, id: string, b: { unidadId: string; tipoServicio: TipoServicio; comentario?: string | null; conCopia?: string | null }) {
    const tenantId = this.tenant(req);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id);
    const c = await this.cot(id, tenantId);
    if (c.estado !== "abierta") throw new ConflictException(`La cotización ${c.codigo} no está Abierta: no se puede consultar al laboratorio.`);
    const noEditable = motivoNoEditable(c.firmaEstado);
    if (noEditable) throw new ConflictException(noEditable);
    const un = (await this.alcance.arbol(tenantId)).porId.get(b.unidadId);
    if (!un) throw new BadRequestException("El laboratorio indicado no existe.");
    if (!TIPOS_CONSULTABLES.includes(String(un.tipo ?? "").toUpperCase()))
      throw new BadRequestException(`${un.codigo} no es un laboratorio: elija el laboratorio que realizará el servicio.`);
    const viva = await this.prisma.$queryRawUnsafe<{ numero: string | null }[]>(
      `SELECT numero FROM solicitud_costeo WHERE cotizacion_id = $1::uuid AND unidad_id = $2::uuid AND deleted_at IS NULL AND estado <> 'rechazado'`,
      id,
      b.unidadId,
    );
    if (viva.length) throw new ConflictException(`Ya hay una solicitud vigente a ${un.codigo} en esta cotización.`);
    const fila = await this.prisma.$transaction(async (tx) => {
      let numero: string | null = null;
      if (exigeCosteo(b.tipoServicio)) {
        const r = await tx.$queryRawUnsafe<{ n: number }[]>(
          `UPDATE cotizacion SET form_correlativo = form_correlativo + 1 WHERE id = $1::uuid RETURNING form_correlativo AS n`,
          id,
        );
        numero = numeroFormulario(c.codigo, Number(r[0].n));
      }
      const ins = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO solicitud_costeo (tenant_id, cotizacion_id, unidad_id, numero, tipo_servicio, estado, comentario_ejecutivo, con_copia,
                                       solicitada_por, solicitada_at, glosa, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'solicitado', $6, $7, $8::uuid, now(), $9, now())
         RETURNING id`,
        tenantId,
        id,
        b.unidadId,
        numero,
        b.tipoServicio,
        b.comentario?.trim() || null,
        b.conCopia?.trim() || null,
        this.yo(req),
        b.tipoServicio === "no_estandar" ? "Formulario de cotización (FORM05)" : b.tipoServicio === "comision" ? "Costeo de comisión (FORM05)" : "Solicitud de fechas",
      );
      return { id: ins[0].id, numero };
    });
    await this.evento(tenantId, id, "solicitud", this.yo(req), b.comentario ?? null, { unidad: un.codigo, tipoServicio: b.tipoServicio, numero: fila.numero }, fila.id);
    return { ok: true, id: fila.id, numero: fila.numero, mensaje: `Solicitud enviada a ${un.codigo}${fila.numero ? ` (${fila.numero})` : ""}.` };
  }

  /** El ejecutivo retira una solicitud aún sin V°B° (p. ej. el laboratorio no realiza el servicio). */
  async retirar(req: any, solicitudId: string, motivo: string) {
    const tenantId = this.tenant(req);
    const s = await this.solicitud(solicitudId, tenantId);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, s.cotizacionId);
    const c = await this.cot(s.cotizacionId, tenantId);
    const noEditable = motivoNoEditable(c.firmaEstado);
    if (noEditable) throw new ConflictException(noEditable);
    if (!["solicitado", "devuelto", "rechazado"].includes(s.estado))
      throw new ConflictException(`La solicitud ya tiene respuesta o V°B° (${ETIQUETA_SOLICITUD[s.estado] ?? s.estado}): no se retira.`);
    await this.prisma.$executeRawUnsafe(`UPDATE solicitud_costeo SET deleted_at = now(), updated_at = now() WHERE id = $1::uuid`, solicitudId);
    await this.evento(tenantId, s.cotizacionId, "solicitud_retirada", this.yo(req), motivo, { unidad: s.unidadCodigo }, solicitudId);
    return { ok: true, mensaje: `Solicitud a ${s.unidadCodigo} retirada.` };
  }

  /** 2.5 · El laboratorio responde: programa de trabajo (FORM06) y, si no es estándar, formulario de costeo (FORM05). */
  async responder(
    req: any,
    solicitudId: string,
    b: { respuesta: RespuestaLab; comentario?: string | null; programa?: ProgramaTrabajo | null; costeo?: Form05Entrada | null },
  ) {
    const tenantId = this.tenant(req);
    const s = await this.solicitud(solicitudId, tenantId);
    await this.alcance.exigirUnidad(req, s.unidadId, `la solicitud ${s.numero ?? ""}`.trim(), "cotizacion.costear");
    const c = await this.cot(s.cotizacionId, tenantId);
    if (c.estado !== "abierta") throw new ConflictException(`La cotización ${c.codigo} ya no está Abierta (${c.estado}).`);
    const noEditable = motivoNoEditable(c.firmaEstado);
    if (noEditable) throw new ConflictException(noEditable);
    if (!puedeResponder(s.estado))
      throw new ConflictException(`La solicitud ya fue respondida (${ETIQUETA_SOLICITUD[s.estado] ?? s.estado}).`);
    const comentario = b.comentario?.trim() || null;
    if ((b.respuesta === "rechazar" || b.respuesta === "aceptar_con_comentario") && !comentario)
      throw new BadRequestException(b.respuesta === "rechazar" ? "Indique por qué el laboratorio no realiza el servicio." : "Escriba el comentario para Comercial.");
    const cfg = await leerConfigCircuito(this.prisma, tenantId);
    let programa: ProgramaTrabajo | null = null;
    let costeo: any = null;
    if (b.respuesta !== "rechazar") {
      if (!b.programa) throw new BadRequestException("Complete el programa de trabajo (FORM06): al menos el plazo de entrega propuesto.");
      const ep = erroresPrograma(b.programa);
      if (ep.length) throw new BadRequestException(ep.join(" "));
      programa = b.programa;
      if (exigeCosteo(s.tipoServicio)) {
        if (!b.costeo)
          throw new BadRequestException(
            s.tipoServicio === "comision"
              ? "Comisión: complete el costeo (horas por rol, viáticos, pasajes, traslados y arriendo) en el formulario de costeo (FORM05)."
              : "Servicio no estandarizado: complete el formulario de costeo (FORM05).",
          );
        const ec = erroresForm05(b.costeo);
        if (ec.length) throw new BadRequestException(ec.join(" "));
        costeo = { ...b.costeo, resultado: calcularForm05(b.costeo, cfg) };
      } else if (b.costeo) {
        const ec = erroresForm05(b.costeo);
        if (!ec.length) costeo = { ...b.costeo, resultado: calcularForm05(b.costeo, cfg) };
      }
    }
    const nuevo = estadoTrasRespuesta(b.respuesta, cfg.niveles);
    await this.prisma.$executeRawUnsafe(
      `UPDATE solicitud_costeo
          SET estado = $2, respuesta = $3, comentario_lab = $4, programa = $5::jsonb, costeo = $6::jsonb,
              plazo_entrega_dias = $7, fecha_inicio = $8::date, fecha_termino = $9::date,
              horas_hombre = $10, costo_directo = $11,
              respondida_por = $12::uuid, respondida_at = now(),
              vb_lab_por = NULL, vb_lab_at = NULL, vb_lab_comentario = NULL,
              vb_depto_por = NULL, vb_depto_at = NULL, vb_depto_comentario = NULL,
              updated_at = now()
        WHERE id = $1::uuid`,
      solicitudId,
      nuevo,
      b.respuesta,
      comentario,
      programa ? JSON.stringify(programa) : null,
      costeo ? JSON.stringify(costeo) : null,
      programa?.plazoEntregaDias ?? null,
      programa?.fechaInicio || null,
      programa?.fechaTermino || null,
      costeo?.resultado?.horasHombreTotal ?? 0,
      costeo?.resultado?.cdt ?? 0,
      this.yo(req),
    );
    await this.evento(tenantId, s.cotizacionId, b.respuesta === "rechazar" ? "laboratorio_rechaza" : "respuesta_laboratorio", this.yo(req), comentario, {
      respuesta: b.respuesta,
      plazoEntregaDias: programa?.plazoEntregaDias ?? null,
      cdt: costeo?.resultado?.cdt ?? null,
      precioParticular: costeo?.resultado?.precioParticular ?? null,
    }, solicitudId);
    return {
      ok: true,
      estado: nuevo,
      resultado: costeo?.resultado ?? null,
      mensaje: b.respuesta === "rechazar" ? "Respuesta registrada: el laboratorio no realiza el servicio. Comercial queda avisado." : `Respuesta enviada. ${nuevo === "aprobado" ? "Queda lista para la firma." : "Queda pendiente del V°B°."}`,
    };
  }

  /** 2.6 · V°B° del laboratorio o del departamento: dar o devolver con comentario. */
  async vb(req: any, solicitudId: string, b: { accion: "dar" | "devolver"; comentario?: string | null }) {
    const tenantId = this.tenant(req);
    const s = await this.solicitud(solicitudId, tenantId);
    const c = await this.cot(s.cotizacionId, tenantId);
    if (c.estado !== "abierta") throw new ConflictException(`La cotización ${c.codigo} ya no está Abierta (${c.estado}).`);
    const noEditable = motivoNoEditable(c.firmaEstado);
    if (noEditable) throw new ConflictException(noEditable);
    const cfg = await leerConfigCircuito(this.prisma, tenantId);
    const nivel = s.unidadId ? nivelVbPendiente(s.estado, cfg.niveles) : null;
    if (!nivel || !s.unidadId) throw new ConflictException(`La solicitud no espera V°B° (${ETIQUETA_SOLICITUD[s.estado] ?? s.estado}).`);
    const resp = await this.responsablesVb(nivel, s.unidadId, tenantId);
    const yo = this.yo(req);
    if (!yo || !resp.personas.some((p) => p.id === yo))
      throw new ForbiddenException(
        `El V°B° ${nivel === "lab" ? "del laboratorio" : "del departamento"} lo da ${resp.rol}${resp.unidad ? ` de ${resp.unidad}` : ""}` +
          `${resp.personas.length ? ` (${resp.personas.map((p) => p.nombre).join(", ")})` : ": no hay nadie asignado a esa jefatura"}.`,
      );
    const comentario = b.comentario?.trim() || null;
    if (b.accion === "devolver" && !comentario) throw new BadRequestException("Indique el motivo de la devolución.");
    const nuevo = estadoTrasVb(nivel, cfg.niveles, b.accion);
    const col = nivel === "lab" ? "vb_lab" : "vb_depto";
    if (b.accion === "dar") {
      await this.prisma.$executeRawUnsafe(
        `UPDATE solicitud_costeo SET estado = $2, ${col}_por = $3::uuid, ${col}_at = now(), ${col}_comentario = $4, updated_at = now() WHERE id = $1::uuid`,
        solicitudId,
        nuevo,
        yo,
        comentario,
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        `UPDATE solicitud_costeo SET estado = 'devuelto', devuelta_motivo = $2,
                vb_lab_por = NULL, vb_lab_at = NULL, vb_lab_comentario = NULL,
                vb_depto_por = NULL, vb_depto_at = NULL, vb_depto_comentario = NULL, updated_at = now()
          WHERE id = $1::uuid`,
        solicitudId,
        comentario,
      );
    }
    await this.evento(tenantId, s.cotizacionId, b.accion === "dar" ? `vb_${nivel}` : `vb_${nivel}_devuelto`, yo, comentario, { unidad: s.unidadCodigo }, solicitudId);
    return {
      ok: true,
      estado: nuevo,
      mensaje: b.accion === "dar" ? `V°B° ${nivel === "lab" ? "del laboratorio" : "del departamento"} registrado.` : "Respuesta devuelta al laboratorio con su comentario.",
    };
  }

  /** Bandeja del laboratorio: solicitudes de sus unidades (por responder, por V°B° o todas). */
  async bandejaLaboratorio(req: any, filtro: { estado?: string }) {
    const tenantId = this.tenant(req);
    const unidades = await this.alcance.filtroUnidades(req);
    const estados =
      filtro.estado === "por_responder" ? ["solicitado", "devuelto"] : filtro.estado === "vb" ? ["respondido", "vb_lab"] : null;
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT s.id, s.numero, s.estado, s.tipo_servicio AS "tipoServicio", s.solicitada_at AS "solicitadaAt",
              s.respondida_at AS "respondidaAt", s.plazo_entrega_dias AS "plazoEntregaDias", s.comentario_ejecutivo AS "comentarioEjecutivo",
              u.id AS "unidadId", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre",
              c.id AS "cotizacionId", c.codigo AS "cotizacionCodigo", c.estado AS "cotizacionEstado", cl.razon_social AS "cliente",
              us.nombre_completo AS "solicitadaPorNombre"
         FROM solicitud_costeo s
         JOIN cotizacion c ON c.id = s.cotizacion_id
         JOIN unidad u ON u.id = s.unidad_id
         LEFT JOIN cliente cl ON cl.id = c.cliente_id
         LEFT JOIN usuario us ON us.id = s.solicitada_por
        WHERE s.deleted_at IS NULL AND s.tenant_id = $1::uuid
          AND ($2::uuid[] IS NULL OR s.unidad_id = ANY($2::uuid[]))
          AND ($3::text[] IS NULL OR s.estado = ANY($3::text[]))
          AND ($3::text[] IS NULL OR c.estado = 'abierta')
        ORDER BY s.solicitada_at DESC NULLS LAST
        LIMIT 300`,
      tenantId,
      unidades,
      estados,
    );
    const cfg = await leerConfigCircuito(this.prisma, tenantId);
    const yo = this.yo(req);
    const data = [];
    const cache = new Map<string, Awaited<ReturnType<CircuitoCotizacionService["responsablesVb"]>>>();
    for (const f of filas) {
      const nivel = nivelVbPendiente(f.estado, cfg.niveles);
      let vb = null as Awaited<ReturnType<CircuitoCotizacionService["responsablesVb"]>> | null;
      if (nivel) {
        const k = `${nivel}:${f.unidadId}`;
        if (!cache.has(k)) cache.set(k, await this.responsablesVb(nivel, f.unidadId, tenantId));
        vb = cache.get(k) ?? null;
      }
      data.push({
        ...f,
        etiquetaEstado: ETIQUETA_SOLICITUD[f.estado] ?? f.estado,
        nivelVb: nivel,
        vbResponsables: vb?.personas.map((p) => p.nombre) ?? [],
        meToca: puedeResponder(f.estado) || (!!vb && !!yo && vb.personas.some((p) => p.id === yo)),
      });
    }
    return { data };
  }

  /* ---------------------------------------------------------------- firma --- */

  /** 2.7 → 2.8 · El ejecutivo envía la cotización a firma del Jefe DCO. */
  async enviarAFirma(req: any, id: string) {
    const tenantId = this.tenant(req);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id);
    const c = await this.cot(id, tenantId);
    if (c.circuito !== "r1") throw new ConflictException("Cotización anterior al circuito de firma: no se envía a firma.");
    const sols = await this.solicitudes(id, tenantId);
    const cfg = await leerConfigCircuito(this.prisma, tenantId);
    const f = faltantesParaFirma(c, sols.map((s) => ({ id: s.id, estado: s.estado, unidad: s.unidadCodigo, numero: s.numero })), cfg, "enviar");
    if (f.length) throw new ConflictException(`No se puede enviar a firma: ${f.join(" ")}`);
    const firmantes = await this.firmantes(tenantId);
    if (!firmantes.length)
      throw new ConflictException("La matriz de firmas COTIZACION no tiene a nadie para firmar (Jefe del Departamento Comercial): asígnelo en Administración › Estructura.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE cotizacion SET firma_estado = 'pendiente', firma_solicitada_por = $2::uuid, firma_solicitada_at = now(),
              firma_devuelta_motivo = NULL, updated_at = now() WHERE id = $1::uuid`,
      id,
      this.yo(req),
    );
    await this.evento(tenantId, id, "enviada_a_firma", this.yo(req), null, { firmantes: firmantes.map((x) => x.nombre) });
    return { ok: true, mensaje: `Cotización ${c.codigo} enviada a firma de ${firmantes.map((x) => x.nombre).join(", ")}.` };
  }

  private async exigirFirmante(req: any, tenantId: string) {
    const firmantes = await this.firmantes(tenantId);
    const yo = this.yo(req);
    if (!yo || !firmantes.some((f) => f.id === yo))
      throw new ForbiddenException(
        `Según la matriz de firmas COTIZACION, la firma el Jefe del Departamento Comercial${firmantes.length ? ` (${firmantes.map((f) => f.nombre).join(", ")})` : ""}.`,
      );
  }

  /** 2.8 · El Jefe DCO firma: la cotización queda emitida, con fecha de emisión y validez de hoy. */
  async firmar(req: any, id: string) {
    const tenantId = this.tenant(req);
    await this.exigirFirmante(req, tenantId);
    const c = await this.cot(id, tenantId);
    const sols = await this.solicitudes(id, tenantId);
    const cfg = await leerConfigCircuito(this.prisma, tenantId);
    const f = faltantesParaFirma(c, sols.map((s) => ({ id: s.id, estado: s.estado, unidad: s.unidadCodigo, numero: s.numero })), cfg, "firmar");
    if (f.length) throw new ConflictException(`No se puede firmar: ${f.join(" ")}`);
    // Al emitir, la validez corre desde hoy (IT DCO-PG01-P01-IT02).
    const hoy = hoyEnChile();
    const validez = await this.cotizaciones.calcularValidezPara(tenantId, c.clienteId, c.centroCostoId, hoy);
    await this.prisma.$executeRawUnsafe(
      `UPDATE cotizacion SET firma_estado = 'firmada', firmada_por = $2::uuid, firmada_at = now(),
              fecha_emision = $3::date, valida_hasta = $4::date, expira_at = $4::date, validez_dias = $5, updated_at = now()
        WHERE id = $1::uuid AND firma_estado = 'pendiente'`,
      id,
      this.yo(req),
      hoy.toISOString().slice(0, 10),
      soloFecha(validez.validaHasta).toISOString().slice(0, 10),
      validez.dias,
    );
    await this.evento(tenantId, id, "firmada", this.yo(req), null, { validaHasta: soloFecha(validez.validaHasta).toISOString().slice(0, 10) });
    return { ok: true, mensaje: `Cotización ${c.codigo} firmada y emitida. Válida hasta el ${soloFecha(validez.validaHasta).toISOString().slice(0, 10).split("-").reverse().join("-")}.` };
  }

  /** 2.8 · El Jefe DCO devuelve al ejecutivo con motivo. */
  async devolverFirma(req: any, id: string, motivo: string) {
    const tenantId = this.tenant(req);
    await this.exigirFirmante(req, tenantId);
    const c = await this.cot(id, tenantId);
    if (c.firmaEstado !== "pendiente") throw new ConflictException("La cotización no está en firma.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE cotizacion SET firma_estado = 'devuelta', firma_devuelta_motivo = $2, updated_at = now() WHERE id = $1::uuid`,
      id,
      motivo,
    );
    await this.evento(tenantId, id, "firma_devuelta", this.yo(req), motivo);
    return { ok: true, mensaje: `Cotización ${c.codigo} devuelta al ejecutivo.` };
  }

  /* ------------------------------------------------------------ documento --- */

  private async documento(req: any, id: string) {
    const tenantId = this.tenant(req);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id, "cotizacion.ver");
    const cot = await this.cotizaciones.detalle(id, tenantId);
    const c = await this.cot(id, tenantId);
    const firmantes = c.firmaEstado === "firmada" ? [] : await this.firmantes(tenantId);
    const firmas: FirmasCotizacion = {
      elabora: { nombre: c.ejecutivoNombre, fecha: c.createdAt },
      firma: c.firmaEstado === "firmada" ? { nombre: c.firmadaPorNombre, fecha: c.firmadaAt } : null,
      pendientes: firmantes.map((f) => f.nombre),
    };
    return { cot: { ...cot, circuito: c.circuito, firmaEstado: c.firmaEstado, firmadaAt: c.firmadaAt }, firmas, codigo: c.codigo };
  }

  async html(req: any, id: string): Promise<string> {
    const d = await this.documento(req, id);
    return htmlCotizacion(d.cot, d.firmas);
  }

  async pdf(req: any, id: string): Promise<{ pdf: Buffer; codigo: string }> {
    const d = await this.documento(req, id);
    return { pdf: await pdfCotizacion(d.cot, d.firmas), codigo: d.codigo };
  }

  /* ---------------------------------------------------------------- envío --- */

  /** 3.4 · Enviar al cliente (correo con el PDF) o registrar la entrega en mano / courier. */
  async enviarCliente(
    req: any,
    id: string,
    b: { medio: string; destinatarios?: string[]; observacion?: string | null; plantilla?: string },
  ) {
    const tenantId = this.tenant(req);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, id);
    // Frente f5: el medio es uno activo de «Parámetros del sistema › medio_envio».
    const texto = await exigirMedioEnvioActivo(this.prisma, tenantId, b.medio);
    const c = await this.cot(id, tenantId);
    const no = motivoNoEnviable(c);
    if (no) throw new ConflictException(no);
    const obs = b.observacion?.trim() || null;
    let resultado: { ok: boolean; error?: string | null; destinatarios?: string[] } = { ok: true };
    if (b.medio === "correo") {
      if (!b.destinatarios?.length) throw new BadRequestException("Indique al menos un destinatario.");
      const { pdf } = await this.pdf(req, id);
      resultado = await this.mensajeria.enviarCotizacion(req, id, { destinatarios: b.destinatarios, plantilla: b.plantilla }, { pdf });
      if (!resultado.ok) {
        await this.evento(tenantId, id, "envio_fallido", this.yo(req), resultado.error ?? null, { destinatarios: resultado.destinatarios ?? b.destinatarios });
        return {
          ok: false,
          error: resultado.error,
          mensaje: `No se pudo enviar el correo: ${(resultado.error ?? "error del servidor de correo").replace(/\s*para este tenant\.?/i, " en esta instalación (Administración › Correo)").replace(/\.$/, "")}. El envío no quedó registrado: reintente o registre la entrega en mano o por courier.`,
        };
      }
    } else if (!obs) {
      throw new BadRequestException(
        b.medio === "oficio" || b.medio === "oficina_partes"
          ? `Envío ${b.medio === "oficio" ? "por oficio" : "por la Oficina de partes"}: indique el Nº del oficio o del registro de la Oficina de partes.`
          : `${texto}: indique a quién se entregó, el número de seguimiento o la referencia del envío.`,
      );
    }
    const dest = b.medio === "correo" ? (resultado.destinatarios ?? b.destinatarios ?? []).join(", ") : null;
    await this.prisma.$executeRawUnsafe(
      `UPDATE cotizacion SET enviada_at = now(), enviada_por = $2::uuid, enviada_medio = $3, enviada_destinatarios = $4,
              envio_observacion = $5, updated_at = now() WHERE id = $1::uuid`,
      id,
      this.yo(req),
      b.medio,
      dest,
      obs,
    );
    await this.evento(tenantId, id, "enviada_cliente", this.yo(req), obs, { medio: b.medio, destinatarios: dest });
    return { ok: true, mensaje: `Envío de la cotización ${c.codigo} registrado (${b.medio === "correo" ? `correo a ${dest}` : textoEnFrase(texto)}).` };
  }
}
