import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { ConfiguracionModule, MailService } from "../configuracion/configuracion.module";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import type { Sello } from "../plantilla-render/plantilla-defecto";
import {
  PLANTILLAS_CORREO,
  TipoCorreo,
  aplicarPlaceholders,
  plantillaPorClave,
  plantillaPorDefecto,
} from "./correo-plantillas";

// ---------------------------------------------------------------------------
// Módulo MENSAJERÍA · correo transaccional con plantilla seleccionable.
//
// Cubre el contrato §4.5.4 / §4.5.5 / §4.5.6 y las alertas §4.2.6:
//   1. Enviar la COTIZACIÓN al cliente con su PDF adjunto.
//   2. Notificar el RESULTADO/validación de una OT al cliente/responsables.
//   3. Registro (bitácora) de correos enviados con búsqueda por asunto/destinatario.
//
// REUTILIZA el `MailService` de ConfiguracionModule (sendMail lee la config SMTP
// del tenant y construye el transporte nodemailer). NO reimplementa el envío.
//
// La bitácora vive en `correo_enviado` (packages/db/align_correo_log.sql), que NO
// está en el schema de Prisma: se accede con SQL crudo parametrizado
// ($queryRawUnsafe), mismo patrón e idéntico aislamiento por tenant que saec, para
// no tocar schema.prisma y no chocar con otros agentes que lo editan.
//
// Si NO hay relay SMTP configurado/activo (caso preprod), el envío FALLA DE FORMA
// CONTROLADA: se captura el error, se registra el correo con estado 'error' y se
// devuelve 200 con { ok:false }. Nunca tumba la request.
// ---------------------------------------------------------------------------

/* --- helpers de formato/saneo -------------------------------------------- */

/** Escapa texto para incrustarlo en HTML (cuerpo del correo y del PDF). */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Peso chileno sin decimales, miles con punto (convención es-CL). */
function clp(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "$ 0";
  return "$ " + Math.round(n).toLocaleString("es-CL");
}

/** dd-mm-aaaa. */
function fechaCorta(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

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
  const validos = correos.filter((c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c));
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

/* --- cuerpo del PDF de la cotización ------------------------------------- */

/**
 * Cuerpo HTML de la cotización que consume el generador de PDF (pdf.renderer).
 * Es el mismo subconjunto de HTML (membrete, h1/h2, table.meta, table.rep) que
 * usan los informes, así que hereda su maquetado sin código nuevo de layout.
 */
function cuerpoCotizacionHtml(cot: any): string {
  const razon = esc(cot.cliente?.razonSocial ?? cot.cliente?.razon_social ?? "—");
  const rut = esc(cot.cliente?.rut ?? "—");
  const lineas: any[] = Array.isArray(cot.lineas) ? cot.lineas : [];
  const filas = lineas
    .map(
      (l, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(l.descripcion ?? l.categoria ?? l.tipo ?? "—")}</td>
        <td class="num">${esc(l.cantidad ?? 1)}</td>
        <td class="num">${clp(l.precioUnitario)}</td>
        <td class="num">${clp(l.subtotal)}</td>
      </tr>`,
    )
    .join("");

  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Cotización comercial</span>
  </div>
  <div class="doc">
    <b>${esc(cot.codigo)}</b>
    <span>Cotización</span>
  </div>
</div>

<h1>COTIZACIÓN</h1>

<table class="meta">
  <tr><th>Cliente</th><td>${razon}</td><th>RUT</th><td>${rut}</td></tr>
  <tr><th>Código</th><td>${esc(cot.codigo)}</td><th>Fecha</th><td>${fechaCorta(new Date(cot.createdAt ?? Date.now()))}</td></tr>
  <tr><th>Forma de pago</th><td>${esc(cot.formaPago ?? "—")}</td><th>Validez</th><td>${esc(cot.validezDias ?? 30)} días</td></tr>
</table>

<h2>Detalle</h2>
<table class="rep">
  <thead>
    <tr><th>#</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">P. unitario</th><th class="num">Subtotal</th></tr>
  </thead>
  <tbody>
    ${filas || '<tr><td class="vacio" colspan="5">Sin líneas de detalle.</td></tr>'}
  </tbody>
</table>

<h2>Totales</h2>
<table class="meta">
  <tr><th>Subtotal</th><td>${clp(cot.subtotal)}</td><th>Descuento</th><td>${clp(cot.descuentoMonto)}</td></tr>
  <tr><th>Neto</th><td>${clp(cot.neto)}</td><th>IVA</th><td>${clp(cot.ivaMonto)}</td></tr>
  <tr><th>TOTAL</th><td>${clp(cot.total)}</td><th></th><td></td></tr>
</table>

<p class="nota">Documento generado por el sistema LIMS IDIC. Los valores están expresados en pesos chilenos (CLP).</p>`;
}

/* --- schemas Zod ---------------------------------------------------------- */

const EnviarCotizacionSchema = z.object({
  destinatarios: z.union([z.array(z.string()), z.string()]).optional(),
  plantilla: z.string().max(60).optional(),
});

const EnviarResultadoSchema = z.object({
  destinatarios: z.union([z.array(z.string()), z.string()]).optional(),
  plantilla: z.string().max(60).optional(),
  /** Veredicto/estado a comunicar; si no se indica, se usa el estado de la OT. */
  veredicto: z.string().max(200).optional(),
});

/* ========================================================================== */
/* Service                                                                     */
/* ========================================================================== */

@Injectable()
export class MensajeriaService {
  private prisma = new PrismaClient();

  constructor(private readonly mail: MailService) {}

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
   * el envío salió como si falló (estado 'error'), para que el historial refleje
   * también los intentos fallidos.
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
      otId?: string | null;
      cotizacionId?: string | null;
      estado: "enviado" | "error";
      error?: string | null;
      messageId?: string | null;
    },
  ) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO correo_enviado
         (tenant_id, tipo, destinatarios, asunto, cuerpo_resumen, plantilla,
          ot_id, cotizacion_id, estado, error, message_id, enviado_por)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9, $10, $11, $12::uuid)
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
    );
    return rows[0];
  }

  /** Extrae un resumen en texto plano del cuerpo HTML del correo. */
  private resumen(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  }

  /**
   * Envío común: intenta enviar por SMTP y SIEMPRE registra en la bitácora.
   * No relanza si el SMTP falla: devuelve un resultado controlado.
   */
  private async enviarYRegistrar(
    req: any,
    tenantId: string,
    args: {
      tipo: TipoCorreo;
      to: string[];
      subject: string;
      html: string;
      attachments?: { filename: string; content: Buffer; contentType: string }[];
      plantilla: string | null;
      otId?: string | null;
      cotizacionId?: string | null;
    },
  ) {
    let estado: "enviado" | "error" = "enviado";
    let error: string | null = null;
    let messageId: string | null = null;

    try {
      const r = await this.mail.sendMail(tenantId, {
        to: args.to,
        subject: args.subject,
        html: args.html,
        attachments: args.attachments,
      });
      messageId = r.messageId ?? null;
    } catch (e: any) {
      estado = "error";
      error = saneaError(e);
    }

    const fila = await this.registrar(req, tenantId, {
      tipo: args.tipo,
      destinatarios: args.to,
      asunto: args.subject,
      cuerpoResumen: this.resumen(args.html),
      plantilla: args.plantilla,
      otId: args.otId ?? null,
      cotizacionId: args.cotizacionId ?? null,
      estado,
      error,
      messageId,
    });

    return {
      ok: estado === "enviado",
      id: fila?.id,
      estado,
      error,
      messageId,
      destinatarios: args.to,
    };
  }

  /* --- 1. Cotización con PDF adjunto ------------------------------------- */

  async enviarCotizacion(
    req: any,
    cotizacionId: string,
    dto: z.infer<typeof EnviarCotizacionSchema>,
  ) {
    const tenantId = this.tenantId(req);
    const cot = await this.prisma.cotizacion.findFirst({
      where: { id: cotizacionId, tenantId },
      include: { cliente: true, lineas: true },
    });
    if (!cot) throw new NotFoundException("Cotización no encontrada");

    const destinatarios = normalizarDestinatarios(dto.destinatarios, cot.cliente?.email ?? null);
    const plantilla = plantillaPorClave(dto.plantilla) ?? plantillaPorDefecto("cotizacion");

    const vars: Record<string, string> = {
      cliente: cot.cliente?.razonSocial ?? "cliente",
      codigo: cot.codigo,
      validez: String(cot.validezDias ?? 30),
      total: clp(cot.total),
      fecha: fechaCorta(),
    };
    const asunto = aplicarPlaceholders(plantilla.asunto, vars);
    const html = aplicarPlaceholders(plantilla.cuerpo, {
      ...vars,
      cliente: esc(vars.cliente),
    });

    // Genera el PDF de la cotización (mismo motor pdfkit/PDF/A que los informes).
    const cuerpo = cuerpoCotizacionHtml(cot);
    const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    const sello: Sello = {
      numero: cot.codigo,
      codigoVerificacion: cot.codigo,
      hash,
      fecha: fechaCorta(new Date(cot.createdAt ?? Date.now())),
      urlVerificacion: "",
      borrador: false,
    };
    const pdf = await generarPdf(cuerpo, sello, `Cotización ${cot.codigo}`);
    const nombrePdf = `Cotizacion-${cot.codigo.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;

    return this.enviarYRegistrar(req, tenantId, {
      tipo: "cotizacion",
      to: destinatarios,
      subject: asunto,
      html,
      attachments: [{ filename: nombrePdf, content: pdf, contentType: "application/pdf" }],
      plantilla: plantilla.clave,
      cotizacionId: cot.id,
    });
  }

  /* --- 2. Resultado / validación de la OT -------------------------------- */

  async enviarResultado(req: any, otId: string, dto: z.infer<typeof EnviarResultadoSchema>) {
    const tenantId = this.tenantId(req);
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId },
      include: { cliente: true },
    });
    if (!ot) throw new NotFoundException("Orden de trabajo no encontrada");

    const destinatarios = normalizarDestinatarios(dto.destinatarios, ot.cliente?.email ?? null);
    const plantilla = plantillaPorClave(dto.plantilla) ?? plantillaPorDefecto("resultado");
    const veredicto = dto.veredicto?.trim() || ot.estado || "sin veredicto";

    const vars: Record<string, string> = {
      cliente: ot.cliente?.razonSocial ?? "cliente",
      codigo: ot.codigo,
      veredicto,
      fecha: fechaCorta(),
    };
    const asunto = aplicarPlaceholders(plantilla.asunto, vars);
    const html = aplicarPlaceholders(plantilla.cuerpo, {
      ...vars,
      cliente: esc(vars.cliente),
      veredicto: esc(vars.veredicto),
      codigo: esc(vars.codigo),
    });

    return this.enviarYRegistrar(req, tenantId, {
      tipo: "resultado",
      to: destinatarios,
      subject: asunto,
      html,
      plantilla: plantilla.clave,
      otId: ot.id,
    });
  }

  /* --- 3. Historial con búsqueda ----------------------------------------- */

  async historial(
    req: any,
    opts: { tipo?: string; q?: string; estado?: string; page?: string; limit?: string },
  ) {
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
    if (opts.q) {
      args.push(`%${opts.q}%`);
      filtros.push(`AND (ce.asunto ILIKE $${args.length} OR ce.destinatarios ILIKE $${args.length})`);
    }
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ce.*, u.nombre_completo AS enviado_por_nombre,
              cot.codigo AS cotizacion_codigo, ot.codigo AS ot_codigo
         FROM correo_enviado ce
         LEFT JOIN usuario u        ON u.id  = ce.enviado_por
         LEFT JOIN cotizacion cot   ON cot.id = ce.cotizacion_id
         LEFT JOIN orden_trabajo ot ON ot.id  = ce.ot_id
        WHERE ce.tenant_id = $1::uuid ${where}
        ORDER BY ce.created_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args,
      l,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM correo_enviado ce
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
  constructor(private readonly svc: MensajeriaService) {}

  /** Catálogo de plantillas de correo predefinidas (para poblar el selector). */
  @Get("plantillas")
  @RequierePermiso("cotizacion.ver")
  plantillas() {
    return PLANTILLAS_CORREO.map(({ clave, tipo, nombre, asunto }) => ({ clave, tipo, nombre, asunto }));
  }

  /** Historial de correos enviados con búsqueda por asunto/destinatario. */
  @Get()
  @RequierePermiso("cotizacion.ver")
  historial(
    @Query("tipo") tipo?: string,
    @Query("q") q?: string,
    @Query("estado") estado?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Req() req?: any,
  ) {
    return this.svc.historial(req, { tipo, q, estado, page, limit });
  }

  /** Envía la cotización con su PDF adjunto usando la plantilla elegida. */
  @Post("cotizacion/:id")
  @RequierePermiso("cotizacion.ver")
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
  controllers: [MensajeriaController],
  providers: [MensajeriaService],
  exports: [MensajeriaService],
})
export class MensajeriaModule {}
