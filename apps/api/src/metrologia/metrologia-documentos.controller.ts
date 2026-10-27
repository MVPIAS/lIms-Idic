import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { ancestroDeTipo } from "../rbac/alcance";
import { documentoCompleto, type Sello } from "../plantilla-render/plantilla-defecto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { MetrologiaOtService, fechaEntrega } from "./metrologia-ot.controller";
import { formatearNumero, siguienteCorrelativo, solicitanteDeOt } from "./metrologia-ot.reglas";
import { exigirMedioEnvioActivo, zMedioEnvio } from "../common/medios-envio";
import { instrumentosDeOt } from "./metrologia-ot.datos";
import {
  MAX_PDF_EXTERNO, motivoExterno, motivoInforme, revisarPdf, type AccionExterno, type AccionInforme, type ExternoDoc, type InformeDoc,
} from "./metrologia-documentos.reglas";
import { ZONA_CHILE, hoyChile } from "../common/fecha-chile";

// ---------------------------------------------------------------------------
// Documentos del instrumento que NO se calibra en el laboratorio (EP-04 P2.3 y
// P2.4, entrega R4 · T28): informe técnico (metrólogo → jefatura, con número
// IT-NNNN, PDF sellado y entrega) y servicio externo (Jefe Lab. solicita → Jefe
// de Departamento aprueba → envío con O/C → certificado externo PDF → validación).
// Bajo /ot, como la pestaña Instrumentos: el alcance lo da el laboratorio de la OT.
// Reglas puras en metrologia-documentos.reglas.ts; formatos y firmantes POR
// CONFIRMAR con el IDIC (EP-04 §10 P5 y P6).
// ---------------------------------------------------------------------------

const t500 = z.string().trim().max(4000);
const InformeSchema = z.object({ hallazgos: t500, motivo: t500, recomendacion: z.string().trim().max(4000).nullish() });
const MotivoSchema = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (mínimo 5 caracteres)").max(1000) });
const EntregaSchema = z.object({
  fecha: z.string().trim().max(40).optional(),
  medio: zMedioEnvio, // frente f5: «Parámetros del sistema › medio_envio»
  destinatario: z.string().trim().min(2, "Indique a quién se entregó").max(160),
  observacion: z.string().trim().max(1000).nullish(),
});
const SolicitudSchema = z.object({ proveedorId: z.string().uuid("Elija el proveedor"), justificacion: z.string().trim().max(2000), costo: z.coerce.number().min(0).max(1e12).nullish() });
const EnvioSchema = z.object({
  ocNumero: z.string().trim().max(40).nullish(), fechaEnvio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD"), costo: z.coerce.number().min(0).max(1e12).nullish(),
});
const ValidarSchema = z.object({ aptitud: z.enum(["apto", "no_apto"]), comentario: z.string().trim().max(2000).nullish() });
type ArchivoSubido = { buffer: Buffer; originalname?: string; mimetype?: string; size?: number };

const tiene = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fechaHora = (x: any) => (x ? new Date(x).toLocaleString("es-CL", { timeZone: ZONA_CHILE, dateStyle: "short", timeStyle: "short" }) : "");

@Injectable()
export class MetrologiaDocumentosService {
  constructor(private readonly prisma: PrismaService, private readonly alcance: AlcanceService, private readonly ot: MetrologiaOtService) {}

  /** ¿Tiene el permiso con alcance en el laboratorio de la OT? */
  private async puede(req: any, permisos: string[], unidadId: string | null) {
    for (const p of permisos) if (tiene(req, p) && (await this.alcance.puedeVerUnidad(req, unidadId, p))) return true;
    return false;
  }
  private async exigirPermiso(req: any, permisos: string[], ot: { unidadId: string | null; codigo: string }, que: string) {
    if (!(await this.puede(req, permisos, ot.unidadId)))
      throw new ForbiddenException(`No puede ${que} en la OT ${ot.codigo}: requiere ${permisos.join(" o ")} en el laboratorio de la OT.`);
  }
  /**
   * Aprueba la contratación externa el Jefe del Departamento del laboratorio (titular o
   * subrogante en Administración › Unidades): carril «Jefe DSA» del Anexo 01.
   */
  private async esJefeDepto(req: any, ot: { tenantId: string; unidadId: string | null }): Promise<{ ok: boolean; depto: string | null }> {
    if ((req?.user?.roles ?? []).includes("SUPERADMIN")) return { ok: true, depto: null };
    if (!ot.unidadId) return { ok: false, depto: null };
    const arbol = await this.alcance.arbol(ot.tenantId);
    const d = ancestroDeTipo(arbol, ot.unidadId, "DEPARTAMENTO");
    if (!d) return { ok: false, depto: null };
    const j = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT 1 FROM unidad_jefe WHERE unidad_id = $1::uuid AND usuario_id = $2::uuid LIMIT 1`, d.id, req?.user?.sub ?? null);
    return { ok: j.length > 0, depto: d.nombre };
  }

  private async itemDe(otId: string, itemId: string, tx: any = this.prisma) {
    const it = (await instrumentosDeOt(tx, otId)).find((x) => x.id === itemId);
    if (!it) throw new NotFoundException("Instrumento no encontrado en esta OT");
    return it;
  }
  private async informeDe(itemId: string, tx: any = this.prisma, bloquear = false) {
    const r = await tx.$queryRawUnsafe(
      `SELECT i.*, ue.nombre_completo AS elaborado_nombre, ue2.nombre_completo AS emitido_nombre, ue3.nombre_completo AS entregado_nombre
         FROM met_informe_tecnico i
         LEFT JOIN usuario ue ON ue.id = i.elaborado_por LEFT JOIN usuario ue2 ON ue2.id = i.emitido_por LEFT JOIN usuario ue3 ON ue3.id = i.entregado_por
        WHERE i.ot_instrumento_id = $1::uuid AND i.estado <> 'anulado' ${bloquear ? "FOR UPDATE OF i" : ""}`, itemId) as any[];
    return r[0] ?? null;
  }
  private async externoDe(itemId: string, tx: any = this.prisma, bloquear = false) {
    const r = await tx.$queryRawUnsafe(
      `SELECT e.id, e.estado, e.proveedor_id, p.razon_social AS proveedor, e.justificacion, e.costo::float8 AS costo, e.oc_numero,
              to_char(e.fecha_envio, 'YYYY-MM-DD') AS fecha_envio, to_char(e.fecha_retorno, 'YYYY-MM-DD') AS fecha_retorno,
              e.certificado_numero, e.certificado_nombre, (e.certificado_datos IS NOT NULL) AS tiene_certificado, e.certificado_hash,
              e.aptitud, e.aptitud_comentario, e.rechazo_motivo, e.aprobado_at, e.validado_at, e.created_at,
              e.entregado_at, e.entrega_medio, e.entrega_destinatario, e.entrega_observacion,
              us.nombre_completo AS solicitado_nombre, ua.nombre_completo AS aprobado_nombre, uv.nombre_completo AS validado_nombre
         FROM met_servicio_externo e LEFT JOIN proveedor p ON p.id = e.proveedor_id
         LEFT JOIN usuario us ON us.id = e.solicitado_por LEFT JOIN usuario ua ON ua.id = e.aprobado_por LEFT JOIN usuario uv ON uv.id = e.validado_por
        WHERE e.ot_instrumento_id = $1::uuid AND e.estado NOT IN ('anulado') ORDER BY e.created_at DESC ${bloquear ? "FOR UPDATE OF e" : ""}`, itemId) as any[];
    // El último vigente (un rechazado se puede volver a solicitar).
    return r.find((x) => x.estado !== "rechazado") ?? r[0] ?? null;
  }
  private docInforme = (x: any): InformeDoc | null => (x ? { estado: x.estado, entregadoAt: x.entregado_at, elaboradoPor: x.elaborado_por } : null);
  private docExterno = (x: any): ExternoDoc | null =>
    (x ? { estado: x.estado, certificadoNumero: x.certificado_numero, tieneCertificado: !!x.tiene_certificado, fechaEnvio: x.fecha_envio, entregadoAt: x.entregado_at } : null);

  /* ------------------------------------------------------------ lectura --- */
  /** Informe técnico y servicio externo de cada ítem no calibrable, con lo que el usuario puede hacer. */
  async documentos(otId: string, req: any) {
    const ot = await this.ot.cargarOt(otId, req);
    const items = (await instrumentosDeOt(this.prisma, otId)).filter((i) => i.estado === "no_apto" || (i.estado === "devuelto" && i.calibrable === false));
    const [crea, emite, entrega, asigna] = await Promise.all([
      this.puede(req, ["metrologia.crear"], ot.unidadId), this.puede(req, ["metrologia.emitir"], ot.unidadId),
      this.puede(req, ["certificado.entregar", "metrologia.crear"], ot.unidadId), this.puede(req, ["ot.asignar"], ot.unidadId),
    ]);
    const jefe = await this.esJefeDepto(req, ot);
    const data = [];
    for (const i of items) {
      const inf = await this.informeDe(i.id), ext = await this.externoDe(i.id);
      const base = { numero: i.numero, estado: i.estado, otEstado: ot.estado, calibrable: i.calibrable };
      const accInf = (["ENVIAR", "EMITIR", "DEVOLVER", "ENTREGAR"] as AccionInforme[]).filter((a) => !motivoInforme(a, base, this.docInforme(inf)) &&
        (a === "ENVIAR" ? crea : a === "ENTREGAR" ? entrega : emite));
      if (crea && (!inf || inf.estado === "borrador") && !(ot.estado === "cerrada" || ot.estado === "anulada")) accInf.unshift("GUARDAR");
      const e = this.docExterno(ext);
      const accExt: AccionExterno[] = [];
      if (asigna && !motivoExterno("SOLICITAR", base, e, { proveedorId: "x", justificacion: "xxxxx" })) accExt.push("SOLICITAR");
      if (jefe.ok && ext?.estado === "solicitado" && !motivoExterno("APROBAR", base, e)) accExt.push("APROBAR", "RECHAZAR");
      if (asigna && ext?.estado === "aprobado") accExt.push("ENVIO");
      if ((asigna || crea) && ext?.estado === "enviado") accExt.push("CERTIFICADO");
      if (asigna && ext?.estado === "enviado" && ext.tiene_certificado) accExt.push("VALIDAR");
      if (entrega && !motivoExterno("ENTREGAR", base, e)) accExt.push("ENTREGAR");
      const { documento_html, ...infSinHtml } = inf ?? {};
      data.push({
        instrumento: { id: i.id, numero: i.numero, descripcion: i.descripcion, serie: i.serie, estado: i.estado, motivoNoCalibrable: i.motivoNoCalibrable, requiereExterno: i.requiereExterno },
        informe: inf ? infSinHtml : null, accionesInforme: accInf, externo: ext, accionesExterno: accExt,
      });
    }
    return { data, jefeDepartamento: jefe.depto };
  }

  /** Proveedores activos del maestro (para elegir el laboratorio externo). */
  async proveedores(otId: string, req: any) {
    const ot = await this.ot.cargarOt(otId, req);
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, razon_social FROM proveedor WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND COALESCE(activo, TRUE) ORDER BY razon_social LIMIT 500`, ot.tenantId);
    return { data };
  }

  /* ------------------------------------------------------ informe técnico --- */
  async guardarInforme(otId: string, itemId: string, body: unknown, req: any) {
    const d = InformeSchema.parse(body ?? {});
    const ot = await this.ot.cargarOt(otId, req);
    await this.exigirPermiso(req, ["metrologia.crear"], ot, "elaborar el informe técnico");
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM met_ot_instrumento WHERE id = $1::uuid FOR UPDATE`, itemId);
      const it = await this.itemDe(otId, itemId, tx);
      const inf = await this.informeDe(itemId, tx, true);
      const m = motivoInforme("GUARDAR", { numero: it.numero, estado: it.estado, otEstado: ot.estado, calibrable: it.calibrable }, this.docInforme(inf), d);
      if (m) throw new BadRequestException(m);
      if (inf) {
        await tx.$executeRawUnsafe(
          `UPDATE met_informe_tecnico SET hallazgos = $2, motivo = $3, recomendacion = $4, elaborado_por = $5::uuid, updated_at = now() WHERE id = $1::uuid AND estado = 'borrador'`,
          inf.id, d.hallazgos, d.motivo, d.recomendacion ?? null, req.user.sub);
        return inf.id as string;
      }
      const r = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO met_informe_tecnico (tenant_id, ot_id, ot_instrumento_id, hallazgos, motivo, recomendacion, elaborado_por)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid) RETURNING id`,
        ot.tenantId, otId, itemId, d.hallazgos, d.motivo, d.recomendacion ?? null, req.user.sub);
      return r[0].id as string;
    });
    return { data: { id, estado: "borrador" } };
  }

  private async transicionInforme(otId: string, itemId: string, accion: "ENVIAR" | "EMITIR" | "DEVOLVER", req: any, motivo?: string) {
    const ot = await this.ot.cargarOt(otId, req);
    await this.exigirPermiso(req, accion === "ENVIAR" ? ["metrologia.crear"] : ["metrologia.emitir"], ot,
      accion === "ENVIAR" ? "enviar a firma el informe técnico" : accion === "EMITIR" ? "firmar y emitir el informe técnico" : "devolver el informe técnico");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM met_ot_instrumento WHERE id = $1::uuid FOR UPDATE`, itemId);
      const it = await this.itemDe(otId, itemId, tx);
      const inf = await this.informeDe(itemId, tx, true);
      const m = motivoInforme(accion, { numero: it.numero, estado: it.estado, otEstado: ot.estado, calibrable: it.calibrable }, this.docInforme(inf));
      if (m) throw new ConflictException(m);
      if (accion === "ENVIAR") {
        await tx.$executeRawUnsafe(`UPDATE met_informe_tecnico SET estado = 'en_firma', enviado_at = now(), devuelto_motivo = NULL, updated_at = now() WHERE id = $1::uuid`, inf.id);
        return { data: { id: inf.id, estado: "en_firma" } };
      }
      if (accion === "DEVOLVER") {
        await tx.$executeRawUnsafe(`UPDATE met_informe_tecnico SET estado = 'borrador', devuelto_motivo = $2, updated_at = now() WHERE id = $1::uuid`, inf.id, motivo);
        return { data: { id: inf.id, estado: "borrador" } };
      }
      // Emitir: número IT-NNNN (correlativo atómico, configurable en Metrología › Numeración), documento sellado.
      const n = await tx.$queryRawUnsafe<any[]>(
        `SELECT ultimo, relleno, formato, anual, anio FROM met_numeracion WHERE tenant_id = $1::uuid AND prefijo = 'ITEC' FOR UPDATE`, ot.tenantId);
      if (!n.length) throw new ConflictException("Falta la numeración del informe técnico (prefijo ITEC) en Metrología › Numeración.");
      const anio = Number(hoyChile().slice(0, 4));
      const sig = siguienteCorrelativo({ ultimo: Number(n[0].ultimo), anual: n[0].anual, anio: n[0].anio }, anio);
      await tx.$executeRawUnsafe(`UPDATE met_numeracion SET ultimo = $2, anio = $3, updated_at = now() WHERE tenant_id = $1::uuid AND prefijo = 'ITEC'`, ot.tenantId, sig.n, sig.anio);
      const numero = formatearNumero(n[0].formato, "ITEC", sig.n, Number(n[0].relleno), sig.anio ?? anio);
      const yo = await tx.$queryRawUnsafe<any[]>(`SELECT nombre_completo, cargo FROM usuario WHERE id = $1::uuid`, req.user.sub);
      const emitidoAt = new Date();
      const html = this.cuerpoInforme({ ...inf, numero, emitido_at: emitidoAt, emitido_nombre: yo[0]?.nombre_completo ?? "", emitido_cargo: yo[0]?.cargo ?? null }, it, ot);
      const hash = createHash("sha256").update(html, "utf8").digest("hex");
      await tx.$executeRawUnsafe(
        `UPDATE met_informe_tecnico SET estado = 'emitido', numero = $2, emitido_at = $3, emitido_por = $4::uuid, documento_html = $5, documento_hash = $6, updated_at = now()
          WHERE id = $1::uuid AND estado = 'en_firma'`, inf.id, numero, emitidoAt, req.user.sub, html, hash);
      return { data: { id: inf.id, estado: "emitido", numero, hash } };
    });
  }
  enviarInforme(otId: string, itemId: string, req: any) { return this.transicionInforme(otId, itemId, "ENVIAR", req); }
  emitirInforme(otId: string, itemId: string, req: any) { return this.transicionInforme(otId, itemId, "EMITIR", req); }
  devolverInforme(otId: string, itemId: string, body: unknown, req: any) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    return this.transicionInforme(otId, itemId, "DEVOLVER", req, motivo);
  }

  async entregarInforme(otId: string, itemId: string, body: unknown, req: any) {
    const d = EntregaSchema.parse(body ?? {});
    const ot = await this.ot.cargarOt(otId, req);
    await this.exigirPermiso(req, ["certificado.entregar", "metrologia.crear"], ot, "registrar la entrega del informe técnico");
    await exigirMedioEnvioActivo(this.prisma, ot.tenantId, d.medio);
    await this.prisma.$transaction(async (tx) => {
      const it = await this.itemDe(otId, itemId, tx);
      const inf = await this.informeDe(itemId, tx, true);
      const m = motivoInforme("ENTREGAR", { numero: it.numero, estado: it.estado, otEstado: ot.estado, calibrable: it.calibrable }, this.docInforme(inf));
      if (m) throw new ConflictException(m);
      const fecha = fechaEntrega(d.fecha);
      if (Number.isNaN(fecha.getTime()) || fecha.getTime() > Date.now() + 60_000) throw new BadRequestException("Fecha de entrega no válida o futura.");
      if (inf.emitido_at && fecha.getTime() < new Date(inf.emitido_at).getTime() - 86_400_000) throw new BadRequestException("La entrega no puede ser anterior a la emisión del informe.");
      await tx.$executeRawUnsafe(
        `UPDATE met_informe_tecnico SET entregado_at = $2, entrega_medio = $3, entrega_destinatario = $4, entrega_observacion = $5, entregado_por = $6::uuid, updated_at = now()
          WHERE id = $1::uuid AND entregado_at IS NULL`, inf.id, fecha, d.medio, d.destinatario, d.observacion ?? null, req.user.sub);
    });
    return { data: { entregado: true } };
  }

  /** B-029 · Entrega al cliente del certificado externo validado (EP-04 §8.1). */
  async entregarExterno(otId: string, itemId: string, body: unknown, req: any) {
    const d = EntregaSchema.parse(body ?? {});
    const ot = await this.ot.cargarOt(otId, req);
    await this.exigirPermiso(req, ["certificado.entregar", "metrologia.crear"], ot, "registrar la entrega del certificado externo");
    await exigirMedioEnvioActivo(this.prisma, ot.tenantId, d.medio);
    await this.prisma.$transaction(async (tx) => {
      const it = await this.itemDe(otId, itemId, tx);
      const ext = await this.externoDe(itemId, tx, true);
      const m = motivoExterno("ENTREGAR", { numero: it.numero, estado: it.estado, otEstado: ot.estado, calibrable: it.calibrable }, this.docExterno(ext));
      if (m) throw new ConflictException(m);
      const fecha = fechaEntrega(d.fecha);
      if (Number.isNaN(fecha.getTime()) || fecha.getTime() > Date.now() + 60_000) throw new BadRequestException("Fecha de entrega no válida o futura.");
      if (ext.validado_at && fecha.getTime() < new Date(ext.validado_at).getTime() - 86_400_000)
        throw new BadRequestException("La entrega no puede ser anterior a la validación del certificado externo.");
      await tx.$executeRawUnsafe(
        `UPDATE met_servicio_externo SET entregado_at = $2, entrega_medio = $3, entrega_destinatario = $4, entrega_observacion = $5, entregado_por = $6::uuid, updated_at = now()
          WHERE id = $1::uuid AND entregado_at IS NULL`, ext.id, fecha, d.medio, d.destinatario, d.observacion ?? null, req.user.sub);
    });
    return { data: { entregado: true } };
  }

  /** Cuerpo HTML del informe técnico (el que se sella al emitir). */
  private cuerpoInforme(inf: any, it: any, ot: any): string {
    const fila = (l: string, v: unknown) => `<tr><th>${esc(l)}</th><td>${v == null || String(v).trim() === "" ? "--" : esc(v)}</td></tr>`;
    const par = (t: string) => String(t ?? "").split(/\r?\n/).filter((x) => x.trim()).map((x) => `<p>${esc(x)}</p>`).join("") || "<p>--</p>";
    return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL, IDIC</b><span>Ejército de Chile · Laboratorio de Metrología</span></div>
  <div class="doc"><b>${esc(inf.numero ?? "BORRADOR")}</b><span>Informe técnico</span></div>
</div>
<h1 class="compacta">INFORME TÉCNICO N° ${esc(inf.numero ?? "BORRADOR")}</h1>
<p class="linea-acred"><b>Instrumento no calibrable · ${esc(ot.laboratorioNombre ?? ot.laboratorio ?? "")}</b></p>
<table class="meta compacta"><tbody>
${fila("Orden de trabajo", ot.codigo)}${fila("Fecha de la OT", /^\d{4}-\d{2}-\d{2}$/.test(String(ot.fechaOt ?? "")) ? String(ot.fechaOt).split("-").reverse().join("-") : ot.fechaOt)}${fila("Cliente", ot.cliente)}${fila("Solicitante", solicitanteDeOt(ot))}
${fila("Instrumento", it.descripcion)}${fila("Marca y modelo", [it.marca, it.modelo].filter(Boolean).join(" · "))}${fila("Número de serie", it.serie)}
${fila("Identificación especial", it.idEspecial)}${fila("Capacidad", it.capacidad)}${fila("Etiqueta de custodia", it.etiqueta)}
${fila("Recepción", fechaHora(it.recibidoAt))}${fila("Fecha de emisión", inf.emitido_at ? fechaHora(inf.emitido_at) : "Se fija al emitir")}
</tbody></table>
<h2 class="compacta">Motivo por el que no se calibra</h2>${par(inf.motivo)}
<h2 class="compacta">Hallazgos</h2>${par(inf.hallazgos)}
<h2 class="compacta">Recomendación</h2>${par(inf.recomendacion)}
<div class="pie-hoja">
<table class="firmas-cert compacta"><tbody><tr>
<td><b>${esc(inf.elaborado_nombre ?? "")}</b><br>Metrólogo (elabora)<br>${inf.enviado_at ? `Firmado electrónicamente el ${esc(fechaHora(inf.enviado_at))}` : "Pendiente de firma"}</td>
<td><b>${esc(inf.emitido_nombre ?? "")}</b><br>${esc(inf.emitido_cargo ?? "Jefatura del laboratorio")} (emite)<br>${inf.emitido_at ? `Firmado electrónicamente el ${esc(fechaHora(inf.emitido_at))}` : "Pendiente de firma"}</td>
</tr></tbody></table>
<p class="fin"><b>Fin del informe técnico</b></p>
</div>`;
  }

  /** PDF del informe: el sellado si está emitido; si no, borrador. */
  async pdfInforme(otId: string, itemId: string, req: any, res: Response) {
    const ot = await this.ot.cargarOt(otId, req);
    const it = await this.itemDe(otId, itemId);
    const inf = await this.informeDe(itemId);
    if (!inf) throw new NotFoundException("El instrumento no tiene informe técnico");
    const sellado = inf.estado === "emitido" && inf.documento_html;
    const cuerpo = sellado ? inf.documento_html : this.cuerpoInforme(inf, it, ot);
    const sello: Sello = {
      numero: inf.numero ?? `BORRADOR ${ot.codigo}-I${String(it.numero).padStart(2, "0")}`,
      codigoVerificacion: "—",
      hash: sellado ? inf.documento_hash : createHash("sha256").update(cuerpo, "utf8").digest("hex"),
      fecha: new Date(inf.emitido_at ?? Date.now()).toLocaleDateString("es-CL", { timeZone: ZONA_CHILE }),
      urlVerificacion: "",
      borrador: !sellado,
    };
    const buf = await generarPdf(cuerpo, sello, `Informe técnico ${sello.numero}`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${sello.numero.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`);
    res.end(buf);
  }

  /** Vista en pantalla del informe (documento completo, como el PDF). */
  async htmlInforme(otId: string, itemId: string, req: any) {
    const ot = await this.ot.cargarOt(otId, req);
    const it = await this.itemDe(otId, itemId);
    const inf = await this.informeDe(itemId);
    if (!inf) throw new NotFoundException("El instrumento no tiene informe técnico");
    const sellado = inf.estado === "emitido" && inf.documento_html;
    const cuerpo = sellado ? inf.documento_html : this.cuerpoInforme(inf, it, ot);
    const sello: Sello = { numero: inf.numero ?? "BORRADOR", codigoVerificacion: "—", hash: inf.documento_hash ?? "", fecha: "", urlVerificacion: "", borrador: !sellado };
    return { data: { html: documentoCompleto(cuerpo, sello, `Informe técnico ${sello.numero}`) } };
  }

  /* ------------------------------------------------------ servicio externo --- */
  async solicitarExterno(otId: string, itemId: string, body: unknown, req: any) {
    const d = SolicitudSchema.parse(body ?? {});
    const ot = await this.ot.cargarOt(otId, req);
    await this.exigirPermiso(req, ["ot.asignar"], ot, "solicitar un servicio externo");
    const prov = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM proveedor WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`, d.proveedorId, ot.tenantId);
    if (!prov.length) throw new BadRequestException("El proveedor no existe en el maestro de proveedores.");
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM met_ot_instrumento WHERE id = $1::uuid FOR UPDATE`, itemId);
      const it = await this.itemDe(otId, itemId, tx);
      const m = motivoExterno("SOLICITAR", { numero: it.numero, estado: it.estado, otEstado: ot.estado }, this.docExterno(await this.externoDe(itemId, tx)), d);
      if (m) throw new BadRequestException(m);
      const r = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO met_servicio_externo (tenant_id, ot_id, ot_instrumento_id, proveedor_id, justificacion, costo, solicitado_por)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid) RETURNING id`,
        ot.tenantId, otId, itemId, d.proveedorId, d.justificacion, d.costo ?? null, req.user.sub);
      return r[0].id as string;
    });
    return { data: { id, estado: "solicitado" } };
  }

  private async pasoExterno(otId: string, itemId: string, accion: AccionExterno, req: any, d: any, hacer: (tx: any, ext: any) => Promise<unknown>) {
    const ot = await this.ot.cargarOt(otId, req);
    if (accion === "APROBAR" || accion === "RECHAZAR") {
      const j = await this.esJefeDepto(req, ot);
      if (!j.ok) throw new ForbiddenException(`Aprueba o rechaza la contratación externa el Jefe ${j.depto ? `del ${j.depto}` : "de Departamento"} (titular o subrogante).`);
    } else await this.exigirPermiso(req, accion === "CERTIFICADO" ? ["ot.asignar", "metrologia.crear"] : ["ot.asignar"], ot,
      accion === "ENVIO" ? "registrar el envío al proveedor" : accion === "CERTIFICADO" ? "adjuntar el certificado externo" : "validar el certificado externo");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM met_ot_instrumento WHERE id = $1::uuid FOR UPDATE`, itemId);
      const it = await this.itemDe(otId, itemId, tx);
      const ext = await this.externoDe(itemId, tx, true);
      const m = motivoExterno(accion, { numero: it.numero, estado: it.estado, otEstado: ot.estado }, this.docExterno(ext), d);
      if (m) throw new ConflictException(m);
      await hacer(tx, ext);
      return { data: { id: ext.id } };
    });
  }
  aprobarExterno(otId: string, itemId: string, req: any) {
    return this.pasoExterno(otId, itemId, "APROBAR", req, {}, (tx, e) =>
      tx.$executeRawUnsafe(`UPDATE met_servicio_externo SET estado = 'aprobado', aprobado_por = $2::uuid, aprobado_at = now(), updated_at = now() WHERE id = $1::uuid`, e.id, req.user.sub));
  }
  rechazarExterno(otId: string, itemId: string, body: unknown, req: any) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    return this.pasoExterno(otId, itemId, "RECHAZAR", req, { motivo }, (tx, e) =>
      tx.$executeRawUnsafe(`UPDATE met_servicio_externo SET estado = 'rechazado', rechazo_motivo = $2, aprobado_por = $3::uuid, aprobado_at = now(), updated_at = now() WHERE id = $1::uuid`, e.id, motivo, req.user.sub));
  }
  envioExterno(otId: string, itemId: string, body: unknown, req: any) {
    const d = EnvioSchema.parse(body ?? {});
    if (d.fechaEnvio > hoyChile()) throw new BadRequestException("La fecha de envío no puede ser futura.");
    return this.pasoExterno(otId, itemId, "ENVIO", req, d, (tx, e) =>
      tx.$executeRawUnsafe(
        `UPDATE met_servicio_externo SET estado = 'enviado', oc_numero = $2, fecha_envio = $3::date, costo = COALESCE($4, costo), enviado_por = $5::uuid, updated_at = now() WHERE id = $1::uuid`,
        e.id, d.ocNumero ?? null, d.fechaEnvio, d.costo ?? null, req.user.sub));
  }
  certificadoExterno(otId: string, itemId: string, archivo: ArchivoSubido | undefined, body: any, req: any) {
    const numero = typeof body?.numero === "string" ? body.numero.trim().slice(0, 60) : "";
    const fechaRetorno = typeof body?.fechaRetorno === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fechaRetorno) ? body.fechaRetorno : null;
    if (fechaRetorno && fechaRetorno > hoyChile()) throw new BadRequestException("La fecha de retorno no puede ser futura.");
    const r = revisarPdf(archivo?.buffer);
    if ("error" in r) throw new BadRequestException(r.error);
    const nombre = (archivo!.originalname ?? "certificado.pdf").replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 200);
    return this.pasoExterno(otId, itemId, "CERTIFICADO", req, { certificadoNumero: numero, fechaRetorno }, (tx, e) =>
      tx.$executeRawUnsafe(
        `UPDATE met_servicio_externo SET certificado_numero = $2, certificado_nombre = $3, certificado_mime = 'application/pdf', certificado_datos = $4,
                certificado_hash = $5, fecha_retorno = COALESCE($6::date, fecha_retorno), updated_at = now() WHERE id = $1::uuid`,
        e.id, numero, nombre, archivo!.buffer.toString("base64"), createHash("sha256").update(archivo!.buffer).digest("hex"), fechaRetorno));
  }
  validarExterno(otId: string, itemId: string, body: unknown, req: any) {
    const d = ValidarSchema.parse(body ?? {});
    return this.pasoExterno(otId, itemId, "VALIDAR", req, d, (tx, e) =>
      tx.$executeRawUnsafe(
        `UPDATE met_servicio_externo SET estado = 'validado', aptitud = $2, aptitud_comentario = $3, validado_por = $4::uuid, validado_at = now(), updated_at = now() WHERE id = $1::uuid`,
        e.id, d.aptitud, d.comentario ?? null, req.user.sub));
  }
  async pdfExterno(otId: string, itemId: string, req: any, res: Response) {
    await this.ot.cargarOt(otId, req);
    await this.itemDe(otId, itemId);
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT certificado_nombre, certificado_datos FROM met_servicio_externo WHERE ot_instrumento_id = $1::uuid AND certificado_datos IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`, itemId);
    if (!f.length) throw new NotFoundException("No hay certificado externo adjunto");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${String(f[0].certificado_nombre ?? "certificado.pdf").replace(/[^A-Za-z0-9._-]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(Buffer.from(f[0].certificado_datos, "base64"));
  }
}

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class MetrologiaDocumentosController {
  constructor(private readonly svc: MetrologiaDocumentosService) {}

  @Get(":id/metrologia/documentos")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Informe técnico y servicio externo de los instrumentos no calibrables de la OT" })
  documentos(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) { return this.svc.documentos(id, req); }

  @Get(":id/metrologia/proveedores")
  @RequierePermiso("ot.ver")
  proveedores(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) { return this.svc.proveedores(id, req); }

  @Post(":id/instrumentos/:item/informe-tecnico")
  @RequierePermiso("ot.ver")
  guardarInforme(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.guardarInforme(id, item, b, req); }

  @Post(":id/instrumentos/:item/informe-tecnico/enviar")
  @RequierePermiso("ot.ver")
  enviarInforme(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Req() req: any) { return this.svc.enviarInforme(id, item, req); }

  @Post(":id/instrumentos/:item/informe-tecnico/emitir")
  @RequierePermiso("ot.ver")
  emitirInforme(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Req() req: any) { return this.svc.emitirInforme(id, item, req); }

  @Post(":id/instrumentos/:item/informe-tecnico/devolver")
  @RequierePermiso("ot.ver")
  devolverInforme(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.devolverInforme(id, item, b, req); }

  @Post(":id/instrumentos/:item/informe-tecnico/entregar")
  @RequierePermiso("ot.ver")
  entregarInforme(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.entregarInforme(id, item, b, req); }

  @Get(":id/instrumentos/:item/informe-tecnico/html")
  @RequierePermiso("ot.ver")
  htmlInforme(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Req() req: any) { return this.svc.htmlInforme(id, item, req); }

  @Get(":id/instrumentos/:item/informe-tecnico/pdf")
  @RequierePermiso("ot.ver")
  pdfInforme(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Req() req: any, @Res() res: Response) { return this.svc.pdfInforme(id, item, req, res); }

  @Post(":id/instrumentos/:item/servicio-externo")
  @RequierePermiso("ot.ver")
  solicitarExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.solicitarExterno(id, item, b, req); }

  @Post(":id/instrumentos/:item/servicio-externo/aprobar")
  @RequierePermiso("ot.ver")
  aprobarExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Req() req: any) { return this.svc.aprobarExterno(id, item, req); }

  @Post(":id/instrumentos/:item/servicio-externo/rechazar")
  @RequierePermiso("ot.ver")
  rechazarExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.rechazarExterno(id, item, b, req); }

  @Post(":id/instrumentos/:item/servicio-externo/envio")
  @RequierePermiso("ot.ver")
  envioExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.envioExterno(id, item, b, req); }

  @Put(":id/instrumentos/:item/servicio-externo/certificado")
  @RequierePermiso("ot.ver")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_PDF_EXTERNO, files: 1, fields: 4 } }))
  certificadoExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @UploadedFile() archivo: ArchivoSubido | undefined, @Body() b: any, @Req() req: any) {
    return this.svc.certificadoExterno(id, item, archivo, b, req);
  }

  @Get(":id/instrumentos/:item/servicio-externo/certificado")
  @RequierePermiso("ot.ver")
  pdfExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Req() req: any, @Res() res: Response) { return this.svc.pdfExterno(id, item, req, res); }

  @Post(":id/instrumentos/:item/servicio-externo/entregar")
  @RequierePermiso("ot.ver")
  entregarExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.entregarExterno(id, item, b, req); }

  @Post(":id/instrumentos/:item/servicio-externo/validar")
  @RequierePermiso("ot.ver")
  validarExterno(@Param("id", ParseUUIDPipe) id: string, @Param("item", ParseUUIDPipe) item: string, @Body() b: unknown, @Req() req: any) { return this.svc.validarExterno(id, item, b, req); }
}
