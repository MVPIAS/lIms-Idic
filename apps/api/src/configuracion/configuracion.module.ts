import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Put,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import * as nodemailer from "nodemailer";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

// ---------------------------------------------------------------------------
// Módulo CONFIGURACIÓN · Zona de administrador del sistema.
//
// Primer bloque: CONFIGURACIÓN DE CORREO (SMTP). Es el HABILITADOR del futuro
// módulo de mensajería (avisos de cotización / resultados): aquí solo se gestiona
// la config + un envío de PRUEBA. Los correos de negocio llegarán después y
// reutilizarán el `MailService` que se exporta.
//
// CONTEXTO ON-PREMISE (IMPORTANTE):
//   El servidor del IDIC irá SIN salida a internet. El `host` NO es un SMTP
//   público (Gmail/O365/SendGrid): es el RELAY SMTP INSTITUCIONAL del IDIC,
//   alcanzable dentro de su LAN (p.ej. smtp.idic.local:25 o :587). La app solo
//   necesita conectividad de red interna hacia ese relay.
//
// La tabla `configuracion_correo` la crea packages/db/align_configuracion.sql y
// se modela en Prisma (`ConfiguracionCorreo`). Una fila por tenant. La clave del
// relay se guarda en `password_cifrada` y NUNCA se re-expone en los GET.
//
// Permiso: `admin.usuarios` — el permiso de administración de sistema del
// seed_rbac.sql (lo tienen SUPERADMIN y ADMIN). SUPERADMIN pasa siempre.
// ---------------------------------------------------------------------------

const PERMISO_ADMIN = "admin.usuarios";

/** Marca que se usa en los GET en lugar de devolver la clave real. */
const PASSWORD_MASK = "********";

const MODOS_SEGURIDAD = ["none", "starttls", "tls"] as const;

const emptyToNull = (v: unknown) => (v === "" ? null : v);
const optStr = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max).nullable().optional());

/**
 * Esquema del PUT (upsert). Todos los campos son opcionales para tolerar guardados
 * parciales; la contraseña se trata aparte: si viene vacía / ausente / enmascarada
 * se CONSERVA la existente (no se borra).
 */
const GuardarConfigSchema = z.object({
  host: optStr(255),
  puerto: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(1).max(65535).nullable().optional(),
  ),
  seguridad: z.enum(MODOS_SEGURIDAD).optional(),
  usuario: optStr(255),
  // Puede venir vacía (conservar), enmascarada (conservar) o con un valor nuevo.
  password: z.preprocess(emptyToNull, z.string().max(500).nullable().optional()),
  remitenteNombre: optStr(200),
  remitenteEmail: z.preprocess(
    emptyToNull,
    z.string().email().max(255).nullable().optional(),
  ),
  activo: z.preprocess(emptyToNull, z.coerce.boolean().nullable().optional()),
});
export type GuardarConfigDto = z.infer<typeof GuardarConfigSchema>;

const ProbarSchema = z.object({
  destinatario: z.string().email(),
});

/** Config de correo tal como la usa el transporte nodemailer. */
export interface ConfigCorreo {
  host: string | null;
  puerto: number;
  seguridad: (typeof MODOS_SEGURIDAD)[number];
  usuario: string | null;
  password: string | null;
  remitenteNombre: string | null;
  remitenteEmail: string | null;
  activo: boolean;
}

/* ========================================================================== */
/* MailService · reutilizable por el futuro módulo de mensajería               */
/* ========================================================================== */

@Injectable()
export class MailService {
  private prisma = new PrismaClient();

  /** Resuelve el tenant del JWT. Sin tenant no se sirve nada. */
  tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  /** Lee la config de correo cruda (con la clave) del tenant, o null si no hay. */
  async obtenerConfig(tenantId: string): Promise<ConfigCorreo | null> {
    const row = await this.prisma.configuracionCorreo.findUnique({
      where: { tenantId },
    });
    if (!row) return null;
    return {
      host: row.host,
      puerto: row.puerto,
      seguridad: (row.seguridad as ConfigCorreo["seguridad"]) ?? "starttls",
      usuario: row.usuario,
      password: row.passwordCifrada,
      remitenteNombre: row.remitenteNombre,
      remitenteEmail: row.remitenteEmail,
      activo: row.activo,
    };
  }

  /** Vista pública de la config: sin la clave (se enmascara si existe). */
  async obtenerConfigPublica(tenantId: string) {
    const cfg = await this.obtenerConfig(tenantId);
    if (!cfg) {
      // Valores por defecto para que el formulario tenga algo que pintar.
      return {
        host: "",
        puerto: 587,
        seguridad: "starttls",
        usuario: "",
        passwordDefinida: false,
        password: "",
        remitenteNombre: "",
        remitenteEmail: "",
        activo: false,
      };
    }
    return {
      host: cfg.host ?? "",
      puerto: cfg.puerto,
      seguridad: cfg.seguridad,
      usuario: cfg.usuario ?? "",
      passwordDefinida: !!cfg.password,
      // Nunca se devuelve la clave real; solo un marcador si hay una guardada.
      password: cfg.password ? PASSWORD_MASK : "",
      remitenteNombre: cfg.remitenteNombre ?? "",
      remitenteEmail: cfg.remitenteEmail ?? "",
      activo: cfg.activo,
    };
  }

  /**
   * Upsert de la config del tenant. Si `password` viene vacía, ausente o con el
   * marcador de enmascarado, se CONSERVA la clave existente (no se borra).
   */
  async guardarConfig(tenantId: string, d: GuardarConfigDto) {
    const actual = await this.prisma.configuracionCorreo.findUnique({
      where: { tenantId },
    });

    // Regla de la clave: solo se cambia si llega un valor nuevo y distinto del
    // marcador de enmascarado. En cualquier otro caso se preserva la actual.
    const passwordEntrante =
      d.password && d.password !== PASSWORD_MASK ? d.password : undefined;
    const passwordCifrada =
      passwordEntrante !== undefined ? passwordEntrante : (actual?.passwordCifrada ?? null);

    const datos = {
      host: d.host ?? actual?.host ?? null,
      puerto: d.puerto ?? actual?.puerto ?? 587,
      seguridad: d.seguridad ?? actual?.seguridad ?? "starttls",
      usuario: d.usuario ?? actual?.usuario ?? null,
      passwordCifrada,
      remitenteNombre: d.remitenteNombre ?? actual?.remitenteNombre ?? null,
      remitenteEmail: d.remitenteEmail ?? actual?.remitenteEmail ?? null,
      activo: d.activo ?? actual?.activo ?? false,
      updatedAt: new Date(),
    };

    await this.prisma.configuracionCorreo.upsert({
      where: { tenantId },
      create: { tenantId, ...datos },
      update: datos,
    });

    return this.obtenerConfigPublica(tenantId);
  }

  /** Construye el transporte nodemailer a partir de la config del tenant. */
  private transporte(cfg: ConfigCorreo, timeoutMs = 10_000): nodemailer.Transporter {
    // 'tls' => conexión cifrada desde el inicio (SMTPS, típico :465).
    // 'starttls' => conexión en claro que se promociona a TLS (típico :587).
    // 'none' => sin cifrado (solo válido en un relay interno de confianza).
    const secure = cfg.seguridad === "tls";
    return nodemailer.createTransport({
      host: cfg.host ?? undefined,
      port: cfg.puerto,
      secure,
      // Para 'none' desactivamos también STARTTLS; para 'starttls' se exige.
      requireTLS: cfg.seguridad === "starttls",
      ignoreTLS: cfg.seguridad === "none",
      auth:
        cfg.usuario && cfg.password
          ? { user: cfg.usuario, pass: cfg.password }
          : undefined,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });
  }

  /** Dirección "De:" a partir del remitente configurado. */
  private remitente(cfg: ConfigCorreo): string | undefined {
    if (!cfg.remitenteEmail) return undefined;
    return cfg.remitenteNombre
      ? `"${cfg.remitenteNombre}" <${cfg.remitenteEmail}>`
      : cfg.remitenteEmail;
  }

  /**
   * Envío reutilizable. Lo usarán los futuros correos de cotización / resultados.
   * Lanza si no hay config activa o si el SMTP falla; el llamador decide cómo
   * reportarlo.
   */
  async sendMail(
    tenantId: string,
    msg: {
      to: string | string[];
      subject: string;
      html: string;
      text?: string;
      attachments?: nodemailer.SendMailOptions["attachments"];
    },
  ): Promise<{ ok: true; messageId?: string }> {
    const cfg = await this.obtenerConfig(tenantId);
    if (!cfg) throw new Error("No hay configuración de correo para este tenant.");
    if (!cfg.activo) throw new Error("La configuración de correo está inactiva.");
    if (!cfg.host) throw new Error("Falta el host SMTP en la configuración.");

    const info = await this.transporte(cfg).sendMail({
      from: this.remitente(cfg),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments,
    });
    return { ok: true, messageId: info.messageId };
  }

  /**
   * Envía un correo de PRUEBA con la config guardada. No lanza: devuelve un
   * resultado controlado `{ ok, error? }` para que el formulario del admin pueda
   * mostrar el error del SMTP (conexión rechazada, auth, etc.) sin tumbar la
   * request. El mensaje de error se sanea para no filtrar credenciales.
   */
  async enviarPrueba(
    tenantId: string,
    destinatario: string,
  ): Promise<{ ok: boolean; error?: string; messageId?: string }> {
    const cfg = await this.obtenerConfig(tenantId);
    if (!cfg) return { ok: false, error: "No hay configuración de correo guardada." };
    if (!cfg.host) return { ok: false, error: "Falta el host SMTP en la configuración." };

    try {
      const info = await this.transporte(cfg).sendMail({
        from: this.remitente(cfg) ?? cfg.usuario ?? undefined,
        to: destinatario,
        subject: "LIMS IDIC · correo de prueba",
        text:
          "Este es un correo de prueba enviado desde la zona de configuración de " +
          "LIMS IDIC. Si lo recibe, el relay SMTP está correctamente configurado.",
        html:
          "<p>Este es un <b>correo de prueba</b> enviado desde la zona de configuración de " +
          "<b>LIMS IDIC</b>.</p><p>Si lo recibe, el relay SMTP está correctamente configurado.</p>",
      });
      return { ok: true, messageId: info.messageId };
    } catch (e: any) {
      return { ok: false, error: this.saneaError(e) };
    }
  }

  /**
   * Extrae un mensaje legible del error del SMTP sin filtrar la contraseña.
   * nodemailer no incluye la clave en `e.message`, pero por seguridad recortamos
   * a los campos conocidos (code/command/response) y limitamos la longitud.
   */
  private saneaError(e: any): string {
    const partes: string[] = [];
    if (e?.code) partes.push(String(e.code));
    if (e?.responseCode) partes.push(`SMTP ${e.responseCode}`);
    const texto = e?.response ?? e?.message ?? "Error desconocido al enviar";
    partes.push(String(texto));
    return partes.join(" · ").slice(0, 300);
  }
}

/* ========================================================================== */
/* Controller                                                                  */
/* ========================================================================== */

@ApiTags("config")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermiso(PERMISO_ADMIN)
@Controller("config/correo")
export class ConfiguracionCorreoController {
  constructor(private readonly svc: MailService) {}

  /** Config actual del tenant, SIN la contraseña (enmascarada). */
  @Get()
  async obtener(@Req() req: any) {
    return this.svc.obtenerConfigPublica(this.svc.tenantId(req));
  }

  /** Upsert de la config. Si la contraseña viene vacía, se conserva la existente. */
  @Put()
  async guardar(@Body() body: unknown, @Req() req: any) {
    const d = GuardarConfigSchema.parse(body);
    return this.svc.guardarConfig(this.svc.tenantId(req), d);
  }

  /** Envío de prueba con la config guardada. Devuelve { ok } o { ok:false, error }. */
  @Post("probar")
  async probar(@Body() body: unknown, @Req() req: any) {
    const { destinatario } = ProbarSchema.parse(body);
    return this.svc.enviarPrueba(this.svc.tenantId(req), destinatario);
  }
}

/* ========================================================================== */

@Module({
  controllers: [ConfiguracionCorreoController],
  providers: [MailService],
  // Exportado para que el futuro módulo de mensajería (cotización / resultados)
  // pueda inyectar MailService y llamar a sendMail().
  exports: [MailService],
})
export class ConfiguracionModule {}
