/**
 * Mensajería INTERNA entre usuarios del LIMS (contrato §4.5.5, §4.5.6).
 *
 * Un mensaje tiene remitente, uno o más destinatarios internos, prioridad
 * (normal, alta, urgente), adjuntos libres y, si se quiere, vínculo a una OT,
 * muestra, cotización o cliente (comprobados contra el alcance del remitente).
 * Cada destinatario lo ve en su bandeja con leído / archivado propios. Con
 * «copia por correo», además sale un correo a los destinatarios (bitácora
 * `correo_enviado`, tipo «mensaje»).
 *
 * Solo ven un mensaje su remitente y sus destinatarios. Tablas en
 * align_comunicacion.sql; SQL crudo parametrizado.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  forwardRef,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { MensajeriaService } from "./mensajeria.module";
import { MAX_ADJUNTO_BYTES, MAX_ADJUNTOS, condicionesBusqueda, prioridadDe, resumenTexto, textoAHtml, validarAdjuntos } from "./reglas-mensajes";

const vacioANull = (v: unknown) => (v === "" || v === "null" ? null : v);
const uuidOpcional = z.preprocess(vacioANull, z.string().uuid().nullable().optional());

/** Multipart: los destinatarios llegan como lista separada por comas o JSON. */
export const NuevoMensajeBody = z.object({
  destinatarios: z.preprocess(
    (v) => (Array.isArray(v) ? v : String(v ?? "").trim().startsWith("[") ? JSON.parse(String(v)) : String(v ?? "").split(/[,;\s]+/).filter(Boolean)),
    z.array(z.string().uuid()).min(1, "Elija al menos un destinatario.").max(50),
  ),
  asunto: z.string().trim().min(3, "Indique el asunto.").max(200),
  cuerpo: z.string().trim().min(1, "Escriba el mensaje.").max(20_000),
  prioridad: z.string().max(10).optional(),
  otId: uuidOpcional,
  otCodigo: z.preprocess(vacioANull, z.string().trim().max(40).nullable().optional()),
  muestraId: uuidOpcional,
  cotizacionId: uuidOpcional,
  clienteId: uuidOpcional,
  respuestaA: uuidOpcional,
  copiaCorreo: z.preprocess((v) => v === true || v === "true" || v === "1" || v === "si", z.boolean()).optional(),
});

const BANDEJAS = ["recibidos", "enviados", "archivados"] as const;

@Injectable()
export class MensajesService {
  constructor(
    private readonly prisma: PrismaService,
    // forwardRef: mensajeria.module importa este archivo (import circular).
    @Inject(forwardRef(() => MensajeriaService)) private readonly mensajeria: MensajeriaService,
  ) {}

  private yo(req: any) {
    const tenantId = req?.user?.tenantId;
    const usuarioId = req?.user?.sub;
    if (!tenantId || !usuarioId) throw new NotFoundException("Usuario no resuelto en el token");
    return { tenantId: tenantId as string, usuarioId: usuarioId as string };
  }

  /** Usuarios activos del tenant para elegir destinatarios. */
  async usuarios(req: any, q?: string) {
    const { tenantId, usuarioId } = this.yo(req);
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT u.id, u.nombre_completo AS nombre, u.email,
              (SELECT string_agg(DISTINCT un.codigo, ', ') FROM usuario_rol ur JOIN unidad un ON un.id = ur.unidad_id WHERE ur.usuario_id = u.id) AS unidades
         FROM usuario u
        WHERE u.tenant_id = $1::uuid AND u.deleted_at IS NULL AND u.estado = 'activo' AND u.id <> $2::uuid
          AND ($3::text IS NULL OR u.nombre_completo ILIKE $3 OR u.email ILIKE $3)
          AND NOT EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
                           WHERE ur.usuario_id = u.id AND COALESCE(r.alias_de, r.codigo) = 'CLIENTE')
        ORDER BY u.nombre_completo
        LIMIT 100`,
      tenantId,
      usuarioId,
      q?.trim() ? `%${q.trim()}%` : null,
    );
  }

  async noLeidos(req: any) {
    const { tenantId, usuarioId } = this.yo(req);
    const [n] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM mensaje_destinatario d JOIN mensaje m ON m.id = d.mensaje_id
        WHERE d.usuario_id = $1::uuid AND m.tenant_id = $2::uuid AND d.leido_at IS NULL AND d.archivado_at IS NULL`,
      usuarioId,
      tenantId,
    );
    return { noLeidos: Number(n?.n ?? 0) };
  }

  /**
   * Bandeja (recibidos, enviados o archivados) con la búsqueda del §4.5.6:
   * remitente, destinatario, asunto, prioridad, adjuntos (si/no), palabras
   * clave (asunto y cuerpo) y rango de fechas; `noLeidos=true` en recibidos.
   */
  async listar(req: any, f: Record<string, string | undefined>) {
    const { tenantId, usuarioId } = this.yo(req);
    const bandeja = (BANDEJAS as readonly string[]).includes(f.bandeja ?? "") ? f.bandeja! : "recibidos";
    const args: unknown[] = [tenantId, usuarioId];
    const where: string[] = ["m.tenant_id = $1::uuid"];
    if (bandeja === "enviados") where.push("m.remitente_id = $2::uuid");
    else
      where.push(
        `EXISTS (SELECT 1 FROM mensaje_destinatario d WHERE d.mensaje_id = m.id AND d.usuario_id = $2::uuid
                   AND d.archivado_at IS ${bandeja === "archivados" ? "NOT NULL" : "NULL"}
                   ${f.noLeidos === "true" ? "AND d.leido_at IS NULL" : ""})`,
      );
    const b = condicionesBusqueda(
      f,
      {
        remitente: "(ur.nombre_completo || ' ' || COALESCE(ur.email, ''))",
        destinatario: `(SELECT string_agg(u.nombre_completo || ' ' || COALESCE(u.email, ''), ' ') FROM mensaje_destinatario d JOIN usuario u ON u.id = d.usuario_id WHERE d.mensaje_id = m.id)`,
        asunto: "m.asunto",
        cuerpo: "m.cuerpo",
        prioridad: "m.prioridad",
        nAdjuntos: "m.n_adjuntos",
        fecha: "m.created_at",
      },
      args.length + 1,
    );
    args.push(...b.args);
    where.push(...b.sql);
    const limite = Math.min(Math.max(parseInt(f.limit ?? "100", 10) || 100, 1), 200);
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.asunto, m.prioridad, m.n_adjuntos AS "nAdjuntos", m.created_at AS "createdAt",
              left(regexp_replace(m.cuerpo, '<[^>]+>', ' ', 'g'), 200) AS resumen,
              ur.nombre_completo AS remitente, m.remitente_id AS "remitenteId",
              (SELECT string_agg(u.nombre_completo, ', ' ORDER BY u.nombre_completo) FROM mensaje_destinatario d JOIN usuario u ON u.id = d.usuario_id WHERE d.mensaje_id = m.id) AS destinatarios,
              (SELECT d.leido_at FROM mensaje_destinatario d WHERE d.mensaje_id = m.id AND d.usuario_id = $2::uuid) AS "leidoAt",
              o.codigo AS "otCodigo", mu.codigo AS "muestraCodigo", c.codigo AS "cotizacionCodigo", cl.razon_social AS "clienteNombre"
         FROM mensaje m
         JOIN usuario ur ON ur.id = m.remitente_id
         LEFT JOIN orden_trabajo o ON o.id = m.ot_id
         LEFT JOIN muestra mu ON mu.id = m.muestra_id
         LEFT JOIN cotizacion c ON c.id = m.cotizacion_id
         LEFT JOIN cliente cl ON cl.id = m.cliente_id
        WHERE ${where.join(" AND ")}
        ORDER BY m.created_at DESC
        LIMIT ${limite}`,
      ...args,
    );
    return { bandeja, data, ...(await this.noLeidos(req)) };
  }

  /** Mensaje completo (con su hilo) si el usuario es remitente o destinatario; lo marca leído. */
  async detalle(req: any, id: string) {
    const { tenantId, usuarioId } = this.yo(req);
    const m = await this.cargar(tenantId, usuarioId, id);
    await this.prisma.$executeRawUnsafe(
      `UPDATE mensaje_destinatario SET leido_at = now() WHERE mensaje_id = $1::uuid AND usuario_id = $2::uuid AND leido_at IS NULL`,
      id,
      usuarioId,
    );
    // Hilo: el mensaje raíz y sus respuestas que el usuario puede ver.
    const raiz = m.respuesta_a ?? m.id;
    const hilo = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.asunto, m.cuerpo, m.prioridad, m.created_at AS "createdAt", u.nombre_completo AS remitente
         FROM mensaje m JOIN usuario u ON u.id = m.remitente_id
        WHERE m.tenant_id = $1::uuid AND (m.id = $2::uuid OR m.respuesta_a = $2::uuid) AND m.id <> $4::uuid
          AND (m.remitente_id = $3::uuid OR EXISTS (SELECT 1 FROM mensaje_destinatario d WHERE d.mensaje_id = m.id AND d.usuario_id = $3::uuid))
        ORDER BY m.created_at`,
      tenantId,
      raiz,
      usuarioId,
      id,
    );
    return { ...m, hilo };
  }

  private async cargar(tenantId: string, usuarioId: string, id: string) {
    const [m] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.asunto, m.cuerpo, m.prioridad, m.created_at AS "createdAt", m.respuesta_a,
              m.remitente_id AS "remitenteId", ur.nombre_completo AS remitente, ur.email AS "remitenteEmail",
              m.ot_id AS "otId", o.codigo AS "otCodigo", m.muestra_id AS "muestraId", mu.codigo AS "muestraCodigo",
              m.cotizacion_id AS "cotizacionId", c.codigo AS "cotizacionCodigo", m.cliente_id AS "clienteId", cl.razon_social AS "clienteNombre",
              (SELECT json_agg(json_build_object('id', u.id, 'nombre', u.nombre_completo, 'leidoAt', d.leido_at) ORDER BY u.nombre_completo)
                 FROM mensaje_destinatario d JOIN usuario u ON u.id = d.usuario_id WHERE d.mensaje_id = m.id) AS destinatarios,
              (SELECT json_agg(json_build_object('id', a.id, 'nombre', a.nombre, 'bytes', a.bytes, 'mime', a.mime) ORDER BY a.created_at)
                 FROM mensaje_adjunto a WHERE a.mensaje_id = m.id) AS adjuntos
         FROM mensaje m
         JOIN usuario ur ON ur.id = m.remitente_id
         LEFT JOIN orden_trabajo o ON o.id = m.ot_id
         LEFT JOIN muestra mu ON mu.id = m.muestra_id
         LEFT JOIN cotizacion c ON c.id = m.cotizacion_id
         LEFT JOIN cliente cl ON cl.id = m.cliente_id
        WHERE m.id = $1::uuid AND m.tenant_id = $2::uuid
          AND (m.remitente_id = $3::uuid OR EXISTS (SELECT 1 FROM mensaje_destinatario d WHERE d.mensaje_id = m.id AND d.usuario_id = $3::uuid))`,
      id,
      tenantId,
      usuarioId,
    );
    if (!m) throw new NotFoundException("Mensaje no encontrado.");
    return m;
  }

  async enviar(req: any, body: z.infer<typeof NuevoMensajeBody>, archivos: any[] | undefined) {
    const { tenantId, usuarioId } = this.yo(req);
    const { adjuntos, errores } = validarAdjuntos(archivos);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const ids = [...new Set(body.destinatarios.filter((d) => d !== usuarioId))];
    if (!ids.length) throw new BadRequestException("Elija al menos un destinatario distinto de usted.");
    const dest = await this.prisma.$queryRawUnsafe<{ id: string; email: string | null }[]>(
      `SELECT id, email FROM usuario WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid AND deleted_at IS NULL AND estado = 'activo'`,
      ids,
      tenantId,
    );
    if (dest.length !== ids.length) throw new BadRequestException("Algún destinatario no existe o no está activo.");
    if (body.respuestaA) await this.cargar(tenantId, usuarioId, body.respuestaA);
    const v = await this.mensajeria.vinculos(req, tenantId, body);
    const prioridad = prioridadDe(body.prioridad);
    const cuerpo = textoAHtml(body.cuerpo);

    const id = await this.prisma.$transaction(async (tx) => {
      const [m] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO mensaje (tenant_id, remitente_id, asunto, cuerpo, prioridad, ot_id, muestra_id, cotizacion_id, cliente_id, respuesta_a, n_adjuntos)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11) RETURNING id`,
        tenantId,
        usuarioId,
        body.asunto,
        cuerpo,
        prioridad,
        v.otId,
        v.muestraId,
        v.cotizacionId,
        v.clienteId,
        body.respuestaA ?? null,
        adjuntos.length,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO mensaje_destinatario (mensaje_id, usuario_id) SELECT $1::uuid, unnest($2::uuid[])`,
        m.id,
        ids,
      );
      for (const a of adjuntos)
        await tx.$executeRawUnsafe(
          `INSERT INTO mensaje_adjunto (tenant_id, mensaje_id, nombre, mime, bytes, sha256, contenido) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
          tenantId,
          m.id,
          a.nombre,
          a.mime,
          a.bytes,
          createHash("sha256").update(a.datos).digest("hex"),
          a.datos.toString("base64"),
        );
      return m.id;
    });

    let correo: { estado: string } | null = null;
    if (body.copiaCorreo) {
      const para = [...new Set(dest.map((d) => d.email?.trim().toLowerCase()).filter((e): e is string => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
      if (para.length)
        correo = await this.mensajeria.enviarYRegistrar(req, tenantId, {
          tipo: "mensaje",
          to: para,
          subject: `Mensaje interno · ${body.asunto}`,
          html: `${cuerpo}<p style="color:#666">Mensaje interno del LIMS IDIC: respóndalo desde «Mensajería › Bandeja».</p>`,
          attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.datos, contentType: a.mime })),
          plantilla: null,
          prioridad,
          ...v,
        });
    }
    return { id, destinatarios: ids.length, adjuntos: adjuntos.length, correo: correo?.estado ?? null, resumen: resumenTexto(cuerpo, 80) };
  }

  async archivar(req: any, id: string, archivar: boolean) {
    const { tenantId, usuarioId } = this.yo(req);
    await this.cargar(tenantId, usuarioId, id);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE mensaje_destinatario SET archivado_at = ${archivar ? "now()" : "NULL"}, leido_at = COALESCE(leido_at, now())
        WHERE mensaje_id = $1::uuid AND usuario_id = $2::uuid`,
      id,
      usuarioId,
    );
    if (!n) throw new BadRequestException("Solo se archivan los mensajes recibidos.");
    return { ok: true };
  }

  async adjunto(req: any, id: string, adjuntoId: string) {
    const { tenantId, usuarioId } = this.yo(req);
    await this.cargar(tenantId, usuarioId, id);
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT nombre, mime, contenido FROM mensaje_adjunto WHERE id = $1::uuid AND mensaje_id = $2::uuid`,
      adjuntoId,
      id,
    );
    if (!a) throw new NotFoundException("Adjunto no encontrado.");
    return { nombre: a.nombre as string, mime: a.mime as string, datos: Buffer.from(a.contenido, "base64") };
  }
}

@ApiTags("mensajería")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("mensajes")
export class MensajesController {
  constructor(private readonly svc: MensajesService) {}

  @Get()
  @RequierePermiso("mensaje.usar")
  listar(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.listar(req, q ?? {});
  }

  @Get("no-leidos")
  @RequierePermiso("mensaje.usar")
  noLeidos(@Req() req: any) {
    return this.svc.noLeidos(req);
  }

  @Get("usuarios")
  @RequierePermiso("mensaje.usar")
  usuarios(@Query("q") q: string | undefined, @Req() req: any) {
    return this.svc.usuarios(req, q);
  }

  @Get(":id")
  @RequierePermiso("mensaje.usar")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(req, id);
  }

  /** Nuevo mensaje o respuesta (multipart: campos de texto + archivos en «adjuntos»). */
  @Post()
  @RequierePermiso("mensaje.usar")
  @UseInterceptors(FilesInterceptor("adjuntos", MAX_ADJUNTOS, { limits: { fileSize: MAX_ADJUNTO_BYTES, files: MAX_ADJUNTOS, fields: 20 } }))
  enviar(@UploadedFiles() archivos: any[], @Body() body: unknown, @Req() req: any) {
    return this.svc.enviar(req, NuevoMensajeBody.parse(body ?? {}), archivos);
  }

  @Post(":id/archivar")
  @RequierePermiso("mensaje.usar")
  archivar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.archivar(req, id, true);
  }

  @Post(":id/desarchivar")
  @RequierePermiso("mensaje.usar")
  desarchivar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.archivar(req, id, false);
  }

  @Get(":id/adjuntos/:adjuntoId")
  @RequierePermiso("mensaje.usar")
  async adjunto(@Param("id", ParseUUIDPipe) id: string, @Param("adjuntoId", ParseUUIDPipe) adjuntoId: string, @Req() req: any, @Res() res: any) {
    const a = await this.svc.adjunto(req, id, adjuntoId);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.send(a.datos);
  }
}
