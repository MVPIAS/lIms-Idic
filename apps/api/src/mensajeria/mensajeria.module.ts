import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
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
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { ConfiguracionModule, MailService } from "../configuracion/configuracion.module";
import { cotizacionOficial, datosFirmaCotizacion, nombrePdfCotizacion, pdfCotizacion } from "../cotizacion/cotizacion-documento";
import { exigirCotizacionEnAlcance } from "../cotizacion/alcance-cotizacion";
import { AlcanceService } from "../rbac/alcance.service";
import { estadoCorreo } from "../avisos/reglas-avisos";
import { TipoCorreo, componerCorreo } from "./correo-plantillas";
import { CorreoPlantillasService, NuevaPlantillaBody, PlantillaBody, type PlantillaBd } from "./plantillas.service";
import {
  MAX_ADJUNTO_BYTES,
  MAX_ADJUNTOS,
  asuntoConPrioridad,
  condicionesBusqueda,
  prioridadDe,
  textoAHtml,
  validarAdjuntos,
  type AdjuntoValido,
  type Prioridad,
} from "./reglas-mensajes";
import { MensajesController, MensajesService } from "./mensajes.service";
import { EtapasCorreoService } from "./etapas-correo.service";
import { fechaChile } from "../common/fecha-chile";

// ---------------------------------------------------------------------------
// Módulo MENSAJERÍA · correo transaccional, plantillas por etapa y mensajería
// interna (contrato §4.5.4 / §4.5.5 / §4.5.6 y alertas §4.2.6):
//   1. Enviar la COTIZACIÓN al cliente con su PDF adjunto.
//   2. Notificar el RESULTADO/validación de una OT al cliente/responsables.
//   3. Correo LIBRE con adjuntos vinculado a OT, muestra, cotización o cliente.
//   4. Envío AUTOMÁTICO por etapa (etapas-correo.service.ts) con las plantillas
//      editables de `correo_plantilla` (plantillas.service.ts).
//   5. Registro (bitácora) de correos con búsqueda por remitente, destinatario,
//      asunto, urgencia, adjuntos y palabras clave.
//   La mensajería INTERNA entre usuarios está en mensajes.service.ts.
//
// REUTILIZA el `MailService` de ConfiguracionModule (sendMail lee la config SMTP
// del tenant y construye el transporte nodemailer). NO reimplementa el envío.
//
// La bitácora vive en `correo_enviado` (align_correo_log.sql y
// align_comunicacion.sql), fuera del schema de Prisma: SQL crudo parametrizado.
//
// Si NO hay relay SMTP configurado/activo (caso preprod), el envío FALLA DE FORMA
// CONTROLADA: se captura el error, se registra el correo con estado
// «sin_configurar» o «error» y se devuelve 200 con { ok:false }. Nunca tumba la request.
// ---------------------------------------------------------------------------

/* --- helpers de formato/saneo -------------------------------------------- */

/** Peso chileno sin decimales, miles con punto (convención es-CL). */
function clp(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "$ 0";
  return "$ " + Math.round(n).toLocaleString("es-CL");
}

/** dd-mm-aaaa en Chile (no en la zona del servidor; D02-27). */
function fechaCorta(d: Date = new Date()): string {
  return fechaChile(d);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Normaliza la lista de destinatarios (array o cadena separada por coma/;) a
 * un array de correos válidos. Lanza si no queda ninguno.
 */
function normalizarDestinatarios(entrada: string[] | string | undefined, fallback?: string | null): string[] {
  const bruto: string[] = Array.isArray(entrada)
    ? entrada
    : typeof entrada === "string"
      ? entrada.split(/[,;\s]+/)
      : [];
  let correos = bruto.map((s) => s.trim()).filter(Boolean);
  if (correos.length === 0 && fallback) correos = [fallback.trim()].filter(Boolean);
  const validos = correos.filter((c) => EMAIL.test(c));
  if (validos.length === 0) {
    throw new BadRequestException(
      "No hay destinatarios válidos. Indique al menos un correo (o registre el email del cliente).",
    );
  }
  // Sin duplicados, preservando el orden.
  return Array.from(new Set(validos));
}

/** Mensaje de error legible del SMTP (sin filtrar credenciales), acotado. */
function saneaError(e: any): string {
  const partes: string[] = [];
  if (e?.code) partes.push(String(e.code));
  if (e?.responseCode) partes.push(`SMTP ${e.responseCode}`);
  partes.push(String(e?.response ?? e?.message ?? "Error desconocido al enviar"));
  return partes.join(" · ").slice(0, 300);
}

/* --- schemas Zod ---------------------------------------------------------- */

const EnviarCotizacionSchema = z.object({
  destinatarios: z.union([z.array(z.string()), z.string()]).optional(),
  plantilla: z.string().max(60).optional(),
  prioridad: z.string().max(10).optional(),
});

const EnviarResultadoSchema = z.object({
  destinatarios: z.union([z.array(z.string()), z.string()]).optional(),
  plantilla: z.string().max(60).optional(),
  /** Veredicto/estado a comunicar; si no se indica, se usa el estado de la OT. */
  veredicto: z.string().max(200).optional(),
  prioridad: z.string().max(10).optional(),
});

const vacioANull = (v: unknown) => (v === "" || v === "null" ? null : v);
/** Correo externo libre (§4.5.5): multipart con adjuntos; los campos llegan como texto. */
const EnviarLibreSchema = z.object({
  destinatarios: z.string().trim().min(3, "Indique al menos un destinatario."),
  asunto: z.string().trim().min(3, "Indique el asunto.").max(250),
  cuerpo: z.string().trim().min(1, "Escriba el mensaje.").max(20_000),
  prioridad: z.string().max(10).optional(),
  otId: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
  /** Alternativa a otId: el código de la OT (OT-2026-0012). */
  otCodigo: z.preprocess(vacioANull, z.string().trim().max(40).nullable().optional()),
  muestraId: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
  cotizacionId: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
  clienteId: z.preprocess(vacioANull, z.string().uuid().nullable().optional()),
});

export interface Vinculos {
  otId?: string | null;
  otCodigo?: string | null;
  muestraId?: string | null;
  cotizacionId?: string | null;
  clienteId?: string | null;
}

/* ========================================================================== */
/* Service                                                                     */
/* ========================================================================== */

@Injectable()
export class MensajeriaService {
  private prisma = new PrismaClient();

  constructor(
    private readonly mail: MailService,
    private readonly alcance: AlcanceService,
    private readonly plantillas: CorreoPlantillasService,
  ) {}

  tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  private paginacion(page?: string, limit?: string) {
    const p = Math.max(1, parseInt(page ?? "1") || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit ?? "50") || 50));
    return { p, l, offset: (p - 1) * l };
  }

  /**
   * Inserta la fila en la bitácora `correo_enviado`. Se llama SIEMPRE, tanto si
   * el envío salió como si falló, para que el historial refleje también los
   * intentos fallidos. Sin cliente explícito, se toma el de la cotización u OT.
   */
  private async registrar(
    req: any,
    tenantId: string,
    datos: {
      tipo: TipoCorreo;
      destinatarios: string[];
      asunto: string;
      cuerpoResumen: string;
      plantilla: string | null;
      prioridad: Prioridad;
      adjuntos: { nombre: string; mime: string; bytes: number }[];
      estado: string;
      error?: string | null;
      messageId?: string | null;
    } & Vinculos,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO correo_enviado
         (tenant_id, tipo, destinatarios, asunto, cuerpo_resumen, plantilla,
          ot_id, cotizacion_id, estado, error, message_id, enviado_por,
          cliente_id, muestra_id, prioridad, adjuntos, n_adjuntos)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9, $10, $11, $12::uuid,
               COALESCE($13::uuid, (SELECT cliente_id FROM cotizacion WHERE id = $8::uuid),
                                   (SELECT cliente_id FROM orden_trabajo WHERE id = $7::uuid)),
               $14::uuid, $15, $16::jsonb, $17)
       RETURNING id, created_at`,
      tenantId,
      datos.tipo,
      datos.destinatarios.join(", "),
      datos.asunto.slice(0, 300),
      datos.cuerpoResumen.slice(0, 2000),
      datos.plantilla,
      datos.otId ?? null,
      datos.cotizacionId ?? null,
      datos.estado,
      datos.error ?? null,
      datos.messageId ?? null,
      req?.user?.sub ?? req?.user?.id ?? null,
      datos.clienteId ?? null,
      datos.muestraId ?? null,
      datos.prioridad,
      datos.adjuntos.length ? JSON.stringify(datos.adjuntos) : null,
      datos.adjuntos.length,
    );
    return rows[0];
  }

  /** Extrae un resumen en texto plano del cuerpo HTML del correo. */
  private resumen(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
  }

  /**
   * Envío común: intenta enviar por SMTP y SIEMPRE registra en la bitácora.
   * No relanza si el SMTP falla: devuelve un resultado controlado. Lo usa
   * también la copia por correo de un mensaje interno (mensajes.service.ts).
   */
  async enviarYRegistrar(
    req: any,
    tenantId: string,
    args: {
      tipo: TipoCorreo;
      to: string[];
      subject: string;
      html: string;
      attachments?: { filename: string; content: Buffer; contentType: string }[];
      plantilla: string | null;
      prioridad?: Prioridad;
      /** Adjuntos libres que se guardan para descargarlos desde el historial. */
      guardar?: AdjuntoValido[];
    } & Vinculos,
  ) {
    let estado = "enviado";
    let error: string | null = null;
    let messageId: string | null = null;
    const prioridad = args.prioridad ?? "normal";
    const subject = asuntoConPrioridad(args.subject, prioridad);

    try {
      const r = await this.mail.sendMail(tenantId, {
        to: args.to,
        subject,
        html: args.html,
        attachments: args.attachments,
      });
      messageId = r.messageId ?? null;
    } catch (e: any) {
      error = saneaError(e);
      // «sin_configurar» si no hay relay SMTP activo (mismo criterio que los avisos).
      estado = estadoCorreo({ quiere: true, destinatarios: args.to.length, error });
    }

    const fila = await this.registrar(req, tenantId, {
      tipo: args.tipo,
      destinatarios: args.to,
      asunto: subject,
      cuerpoResumen: this.resumen(args.html),
      plantilla: args.plantilla,
      prioridad,
      adjuntos: (args.attachments ?? []).map((a) => ({ nombre: a.filename, mime: a.contentType, bytes: a.content.length })),
      otId: args.otId ?? null,
      cotizacionId: args.cotizacionId ?? null,
      clienteId: args.clienteId ?? null,
      muestraId: args.muestraId ?? null,
      estado,
      error,
      messageId,
    });
    for (const a of args.guardar ?? [])
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO mensaje_adjunto (tenant_id, correo_id, nombre, mime, bytes, sha256, contenido)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
        tenantId,
        fila.id,
        a.nombre,
        a.mime,
        a.bytes,
        createHash("sha256").update(a.datos).digest("hex"),
        a.datos.toString("base64"),
      );

    return {
      ok: estado === "enviado",
      id: fila?.id,
      estado,
      error,
      messageId,
      destinatarios: args.to,
    };
  }

  private async exigirPlantilla(tenantId: string, etapa: string, clave?: string | null): Promise<PlantillaBd> {
    const p = await this.plantillas.deEtapa(tenantId, etapa, clave);
    if (!p) throw new ConflictException("No hay ninguna plantilla activa para esta etapa: active una en Mensajería › Plantillas.");
    return p;
  }

  /* --- 1. Cotización con PDF adjunto ------------------------------------- */

  async enviarCotizacion(
    req: any,
    cotizacionId: string,
    dto: z.infer<typeof EnviarCotizacionSchema>,
    opts: { pdf?: Buffer } = {},
  ) {
    const tenantId = this.tenantId(req);
    await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, cotizacionId);
    const cot = await this.prisma.cotizacion.findFirst({
      where: { id: cotizacionId, tenantId },
      include: { cliente: true, lineas: true },
    });
    if (!cot) throw new NotFoundException("Cotización no encontrada");

    const destinatarios = normalizarDestinatarios(dto.destinatarios, cot.cliente?.email ?? null);
    const plantilla = await this.exigirPlantilla(tenantId, "cotizacion_enviada", dto.plantilla);
    const { asunto, html } = componerCorreo(plantilla, {
      cliente: cot.cliente?.razonSocial ?? "cliente",
      codigo: cot.codigo,
      validez: String(cot.validezDias ?? 30),
      total: clp(cot.total),
      fecha: fechaCorta(),
    });

    // PDF de la cotización con sus firmas (cotizacion/cotizacion-documento.ts). Al
    // cliente solo sale una cotización firmada por el Jefe DCO (o histórica).
    const firma = await datosFirmaCotizacion(this.prisma, cot.id);
    if (!cotizacionOficial(firma))
      throw new ConflictException(
        `La cotización ${cot.codigo} aún no está firmada por el Jefe DCO: solo se envía al cliente una cotización firmada.`,
      );
    const pdf = opts.pdf ?? (await pdfCotizacion({ ...cot, ...firma }, firma.firmas));
    const nombrePdf = nombrePdfCotizacion(cot.codigo);

    const r = await this.enviarYRegistrar(req, tenantId, {
      tipo: "cotizacion",
      to: destinatarios,
      subject: asunto,
      html,
      attachments: [{ filename: nombrePdf, content: pdf, contentType: "application/pdf" }],
      plantilla: plantilla.clave,
      cotizacionId: cot.id,
      clienteId: cot.clienteId ?? null,
      prioridad: prioridadDe(dto.prioridad),
    });
    // Enviada desde Mensajería: queda registrado el envío en la cotización (columna
    // «Enviada» del listado). Desde el panel de la cotización lo registra el circuito.
    if (r.ok && !opts.pdf)
      await this.prisma.$executeRawUnsafe(
        `UPDATE cotizacion SET enviada_at = now(), enviada_medio = 'correo', enviada_por = $2::uuid,
                enviada_destinatarios = $3, updated_at = now()
          WHERE id = $1::uuid`,
        cot.id,
        req?.user?.sub ?? null,
        destinatarios.join(", "),
      );
    return r;
  }

  /* --- 2. Resultado / validación de la OT -------------------------------- */

  async enviarResultado(req: any, otId: string, dto: z.infer<typeof EnviarResultadoSchema>) {
    const tenantId = this.tenantId(req);
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId },
      include: { cliente: true },
    });
    if (!ot) throw new NotFoundException("Orden de trabajo no encontrada");
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);

    const destinatarios = normalizarDestinatarios(dto.destinatarios, ot.cliente?.email ?? null);
    const plantilla = await this.exigirPlantilla(tenantId, "resultado", dto.plantilla);
    const veredicto = dto.veredicto?.trim() || ot.estado || "sin veredicto";
    const { asunto, html } = componerCorreo(plantilla, {
      cliente: ot.cliente?.razonSocial ?? "cliente",
      codigo: ot.codigo,
      veredicto,
      fecha: fechaCorta(),
    });

    return this.enviarYRegistrar(req, tenantId, {
      tipo: "resultado",
      to: destinatarios,
      subject: asunto,
      html,
      plantilla: plantilla.clave,
      otId: ot.id,
      clienteId: ot.clienteId ?? null,
      prioridad: prioridadDe(dto.prioridad),
    });
  }

  /* --- 3. Correo libre con adjuntos (§4.5.5) ------------------------------ */

  /**
   * Correo externo escrito a mano, con adjuntos libres (PDF, imágenes, Office,
   * texto) y vinculado a una OT, muestra, cotización o cliente de su alcance.
   */
  async enviarLibre(req: any, dto: z.infer<typeof EnviarLibreSchema>, archivos: any[] | undefined) {
    const tenantId = this.tenantId(req);
    const destinatarios = normalizarDestinatarios(dto.destinatarios);
    const { adjuntos, errores } = validarAdjuntos(archivos);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const v = await this.vinculos(req, tenantId, dto);
    const html =
      textoAHtml(dto.cuerpo) +
      `<p style="margin-top:18px;color:#5b6b7c;font-size:13px">Instituto de Investigaciones y Control &middot; Ejército de Chile</p>`;
    return this.enviarYRegistrar(req, tenantId, {
      tipo: "otro",
      to: destinatarios,
      subject: dto.asunto,
      html,
      attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.datos, contentType: a.mime })),
      guardar: adjuntos,
      plantilla: null,
      prioridad: prioridadDe(dto.prioridad),
      ...v,
    });
  }

  /**
   * Vínculos de un mensaje o correo, comprobados: la OT en el alcance del
   * usuario, la muestra de esa OT (o la OT de la muestra), la cotización en su
   * alcance y el cliente del tenant. Sin cliente explícito, el de la OT o cotización.
   */
  async vinculos(req: any, tenantId: string, d: Vinculos): Promise<Required<Omit<Vinculos, "otCodigo">>> {
    let otId = d.otId ?? null;
    let clienteId = d.clienteId ?? null;
    if (!otId && d.otCodigo) {
      const ot = await this.prisma.ordenTrabajo.findFirst({ where: { codigo: d.otCodigo.trim().toUpperCase(), tenantId }, select: { id: true } });
      if (!ot) throw new NotFoundException(`No existe la OT ${d.otCodigo}.`);
      otId = ot.id;
    }
    if (d.muestraId) {
      const m = await this.prisma.muestra.findFirst({ where: { id: d.muestraId, tenantId, deletedAt: null }, select: { otId: true } });
      if (!m) throw new NotFoundException("Muestra no encontrada.");
      if (otId && m.otId && m.otId !== otId) throw new BadRequestException("La muestra no es de esa OT.");
      otId = otId ?? m.otId ?? null;
    }
    if (otId) {
      const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId }, select: { codigo: true, unidadPrincipal: true, clienteId: true } });
      if (!ot) throw new NotFoundException("Orden de trabajo no encontrada.");
      await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
      clienteId = clienteId ?? ot.clienteId ?? null;
    }
    if (d.cotizacionId) {
      await exigirCotizacionEnAlcance(this.prisma, this.alcance, req, d.cotizacionId);
      const c = await this.prisma.cotizacion.findFirst({ where: { id: d.cotizacionId, tenantId }, select: { clienteId: true } });
      clienteId = clienteId ?? c?.clienteId ?? null;
    }
    if (clienteId) {
      const c = await this.prisma.cliente.findFirst({ where: { id: clienteId, tenantId }, select: { id: true } });
      if (!c) throw new NotFoundException("Cliente no encontrado.");
    }
    return { otId, muestraId: d.muestraId ?? null, cotizacionId: d.cotizacionId ?? null, clienteId };
  }

  /* --- 4. Envío automático por etapa (§4.5.4) ----------------------------- */

  /**
   * Envía la plantilla AUTOMÁTICA de la etapa al cliente, si la etapa tiene una
   * activa y el cliente tiene correo. Nunca falla: sin plantilla o sin correo
   * no hace nada; un SMTP caído queda registrado en la bitácora. Una vez por
   * etapa y OT o cotización (lo ya enviado no se repite).
   */
  async enviarAutomatico(
    tenantId: string,
    etapa: string,
    destino: { correo: string | null } & Vinculos,
    vars: Record<string, string>,
  ) {
    const p = await this.plantillas.automatica(tenantId, etapa);
    const correo = destino.correo?.trim() ?? "";
    if (!p || !EMAIL.test(correo)) return null;
    const [ya] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT 1 FROM correo_enviado
        WHERE tenant_id = $1::uuid AND tipo = 'etapa' AND plantilla = $2 AND estado = 'enviado'
          AND ot_id IS NOT DISTINCT FROM $3::uuid AND cotizacion_id IS NOT DISTINCT FROM $4::uuid
          AND ($5::text IS NULL OR asunto = $5)
        LIMIT 1`,
      tenantId,
      p.clave,
      destino.otId ?? null,
      destino.cotizacionId ?? null,
      // El informe oficial se avisa por documento: lo distingue su asunto.
      etapa === "documento_oficial" ? componerCorreo(p, vars).asunto : null,
    );
    if (ya) return null;
    const { asunto, html } = componerCorreo(p, vars);
    // Remitente «Sistema LIMS» (enviado_por vacío): lo envía el sistema, no quien disparó la etapa.
    return this.enviarYRegistrar(null, tenantId, {
      tipo: "etapa",
      to: [correo],
      subject: asunto,
      html,
      plantilla: p.clave,
      otId: destino.otId ?? null,
      cotizacionId: destino.cotizacionId ?? null,
      clienteId: destino.clienteId ?? null,
    });
  }

  /** Adjunto de un correo libre del historial. */
  async adjuntoCorreo(req: any, correoId: string, adjuntoId: string) {
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.nombre, a.mime, a.contenido FROM mensaje_adjunto a JOIN correo_enviado ce ON ce.id = a.correo_id
        WHERE a.id = $1::uuid AND a.correo_id = $2::uuid AND ce.tenant_id = $3::uuid`,
      adjuntoId,
      correoId,
      this.tenantId(req),
    );
    if (!a) throw new NotFoundException("Adjunto no encontrado.");
    return { nombre: a.nombre as string, mime: a.mime as string, datos: Buffer.from(a.contenido, "base64") };
  }

  /* --- 5. Historial con búsqueda (§4.5.6) -------------------------------- */

  async historial(req: any, opts: Record<string, string | undefined>) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(opts.page, opts.limit);

    const filtros: string[] = [];
    const args: any[] = [tenantId];
    if (opts.tipo) {
      args.push(opts.tipo);
      filtros.push(`AND ce.tipo = $${args.length}`);
    }
    if (opts.estado) {
      args.push(opts.estado);
      filtros.push(`AND ce.estado = $${args.length}`);
    }
    const uuid = /^[0-9a-f-]{36}$/i;
    if (opts.otId && uuid.test(opts.otId)) {
      args.push(opts.otId);
      filtros.push(`AND ce.ot_id = $${args.length}::uuid`);
    }
    if (opts.clienteId && uuid.test(opts.clienteId)) {
      args.push(opts.clienteId);
      filtros.push(`AND ce.cliente_id = $${args.length}::uuid`);
    }
    // Remitente, destinatario, asunto, urgencia, adjuntos, palabras clave y fechas.
    const b = condicionesBusqueda(
      opts,
      {
        remitente: `(COALESCE(u.nombre_completo, '') || ' ' || COALESCE(u.email, '') || CASE WHEN ce.enviado_por IS NULL THEN ' Sistema LIMS' ELSE '' END)`,
        destinatario: "ce.destinatarios",
        asunto: "COALESCE(ce.asunto, '')",
        cuerpo: "(COALESCE(ce.cuerpo_resumen, '') || ' ' || ce.destinatarios)",
        prioridad: "ce.prioridad",
        nAdjuntos: "ce.n_adjuntos",
        fecha: "ce.created_at",
      },
      args.length + 1,
    );
    args.push(...b.args);
    filtros.push(...b.sql.map((c) => `AND ${c}`));
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ce.id, ce.tipo, ce.destinatarios, ce.asunto, ce.cuerpo_resumen, ce.plantilla, ce.estado, ce.error,
              ce.message_id, ce.created_at, ce.prioridad, ce.n_adjuntos, ce.ot_id, ce.cotizacion_id, ce.cliente_id, ce.muestra_id,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'bytes', a.bytes) ORDER BY a.created_at)
                          FROM mensaje_adjunto a WHERE a.correo_id = ce.id), ce.adjuntos) AS adjuntos,
              COALESCE(u.nombre_completo, CASE WHEN ce.enviado_por IS NULL THEN 'Sistema LIMS' END) AS enviado_por_nombre,
              cot.codigo AS cotizacion_codigo, ot.codigo AS ot_codigo, cl.razon_social AS cliente_nombre, m.codigo AS muestra_codigo
         FROM correo_enviado ce
         LEFT JOIN usuario u        ON u.id  = ce.enviado_por
         LEFT JOIN cotizacion cot   ON cot.id = ce.cotizacion_id
         LEFT JOIN orden_trabajo ot ON ot.id  = ce.ot_id
         LEFT JOIN cliente cl       ON cl.id  = ce.cliente_id
         LEFT JOIN muestra m        ON m.id   = ce.muestra_id
        WHERE ce.tenant_id = $1::uuid ${where}
        ORDER BY ce.created_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args,
      l,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM correo_enviado ce
         LEFT JOIN usuario u ON u.id = ce.enviado_por
        WHERE ce.tenant_id = $1::uuid ${where}`,
      ...args,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }
}

/* ========================================================================== */
/* Controller                                                                  */
/* ========================================================================== */

@ApiTags("mensajería")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("mensajeria")
export class MensajeriaController {
  constructor(
    private readonly svc: MensajeriaService,
    private readonly plantillas: CorreoPlantillasService,
  ) {}

  /**
   * Plantillas de correo por etapa (§4.5.4). El selector de envío usa clave,
   * tipo, nombre y asunto; Mensajería › Plantillas, el resto.
   */
  @Get("plantillas")
  @RequierePermiso("cotizacion.ver")
  async listarPlantillas(@Req() req: any) {
    const r = await this.plantillas.listar(req.user.tenantId);
    const tipo = (etapa: string) => (etapa === "cotizacion_enviada" ? "cotizacion" : etapa === "resultado" ? "resultado" : "etapa");
    return { ...r, data: r.data.map((p: any) => ({ ...p, tipo: tipo(p.etapa) })) };
  }

  @Post("plantillas")
  @RequierePermiso("correo_plantilla.editar")
  crearPlantilla(@Body() body: unknown, @Req() req: any) {
    return this.plantillas.crear(req, NuevaPlantillaBody.parse(body ?? {}));
  }

  @Patch("plantillas/:id")
  @RequierePermiso("correo_plantilla.editar")
  editarPlantilla(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.plantillas.actualizar(req, id, PlantillaBody.parse(body ?? {}));
  }

  /**
   * Historial de correos con búsqueda (§4.5.6): tipo, estado, remitente,
   * destinatario, asunto, prioridad, adjuntos (si/no), q (palabras clave),
   * desde/hasta (AAAA-MM-DD), otId, clienteId.
   */
  @Get()
  @RequierePermiso("cotizacion.ver")
  historial(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.historial(req, q ?? {});
  }

  /** Correo libre con adjuntos (multipart: campos de texto + archivos en «adjuntos»). */
  @Post("correo")
  @RequierePermiso("correo.enviar")
  @UseInterceptors(FilesInterceptor("adjuntos", MAX_ADJUNTOS, { limits: { fileSize: MAX_ADJUNTO_BYTES, files: MAX_ADJUNTOS, fields: 20 } }))
  enviarLibre(@UploadedFiles() archivos: any[], @Body() body: unknown, @Req() req: any) {
    return this.svc.enviarLibre(req, EnviarLibreSchema.parse(body ?? {}), archivos);
  }

  @Get("correos/:id/adjuntos/:adjuntoId")
  @RequierePermiso("cotizacion.ver")
  async adjunto(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("adjuntoId", ParseUUIDPipe) adjuntoId: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const a = await this.svc.adjuntoCorreo(req, id, adjuntoId);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.send(a.datos);
  }

  /**
   * Envía la cotización con su PDF adjunto usando la plantilla elegida. Enviar
   * es tarea del ejecutivo (EP-00 3.4): `cotizacion.crear` y la cotización en su
   * alcance (antes bastaba `cotizacion.ver`).
   */
  @Post("cotizacion/:id")
  @RequierePermiso("cotizacion.crear")
  enviarCotizacion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = EnviarCotizacionSchema.parse(body ?? {});
    return this.svc.enviarCotizacion(req, id, dto);
  }

  /** Notifica el veredicto/resultado de una OT al cliente/responsables. */
  @Post("resultado/:otId")
  @RequierePermiso("ot.ver")
  enviarResultado(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    const dto = EnviarResultadoSchema.parse(body ?? {});
    return this.svc.enviarResultado(req, otId, dto);
  }
}

/* ========================================================================== */

@Module({
  // ConfiguracionModule exporta MailService (sendMail + config SMTP del tenant).
  imports: [ConfiguracionModule],
  controllers: [MensajeriaController, MensajesController],
  providers: [MensajeriaService, CorreoPlantillasService, MensajesService, EtapasCorreoService],
  exports: [MensajeriaService, CorreoPlantillasService],
})
export class MensajeriaModule {}
