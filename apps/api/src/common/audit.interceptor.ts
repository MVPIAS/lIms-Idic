import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { PrismaService } from "./prisma.service";

/** Solo se audita lo que muta estado. */
const MUTACIONES = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Verbo → acción, con el vocabulario del comentario de audit_log (schema.sql:1253). */
const ACCION_POR_VERBO: Record<string, string> = {
  POST: "crear",
  PATCH: "modificar",
  PUT: "modificar",
  DELETE: "eliminar",
};

/**
 * Claves que NUNCA se escriben en la bitácora, en cualquier nivel del payload.
 * La comparación es en minúsculas y por inclusión, para cazar variantes
 * (password, passwordHash, newPassword, refreshToken, totpSecret…).
 */
const CLAVES_SECRETAS = ["password", "token", "secret", "authorization", "cookie", "apikey"];

const REDACTADO = "[REDACTADO]";
/** Corta payloads gigantes: la bitácora es una traza, no un almacén de blobs. */
const MAX_DIFF_CHARS = 8_000;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (ctx.getType() !== "http") return next.handle();

    const req = ctx.switchToHttp().getRequest();
    if (!MUTACIONES.has(req.method)) return next.handle();

    return next.handle().pipe(
      // Solo el flujo `next` → solo se audita la mutación que terminó BIEN.
      // Si el handler lanza, no se escribe nada (lo rechazado no mutó nada).
      tap({
        next: (data) => {
          const status = ctx.switchToHttp().getResponse()?.statusCode;
          // Sin await: la auditoría no debe añadir latencia ni tumbar la respuesta.
          void this.registrar(req, data, status);
        },
      }),
    );
  }

  /** Escribe la fila en audit_log. Nunca lanza: si falla, se registra y se sigue. */
  private async registrar(req: any, data: any, statusCode?: number): Promise<void> {
    try {
      const user = req.user;
      const tenantId = user?.tenantId;
      // audit_log.tenant_id es NOT NULL y no hay tenant fiable sin usuario
      // (p. ej. POST /auth/login, que es público). Ver nota en el README del cambio.
      if (!tenantId) return;

      const ruta = this.rutaPatron(req);
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          usuarioId: this.uuidOrNull(user?.sub),
          username: user?.username ?? null,
          ip: this.ipValida(req),
          userAgent: this.texto(req.headers?.["user-agent"], 500),
          accion: this.accion(req),
          entidadTipo: this.entidadTipo(req),
          entidadId: this.uuidOrNull(data?.id) ?? this.uuidOrNull(req.params?.id),
          entidadCodigo: this.texto(data?.codigo ?? data?.numero, 60),
          diff: this.diff(req, data),
          metadata: { ruta, metodo: req.method, statusCode: statusCode ?? null },
        },
      });
    } catch (e) {
      // Un fallo de auditoría no puede romper la petición (ya respondida), pero
      // tampoco puede pasar en silencio: es un requisito 17025.
      this.log.error(
        `No se pudo escribir audit_log para ${req.method} ${req.originalUrl}: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }

  /**
   * Acción registrada. En las rutas de negocio con sub-acción explícita
   * (POST /cotizaciones/:id/aceptar, /firmar, /aprobar…) se guarda esa sub-acción,
   * que es más informativa que 'crear' y es justo lo que audita la 17025.
   */
  private accion(req: any): string {
    const patron: string = req.route?.path ?? "";
    const ultimo = patron.split("/").filter(Boolean).pop();
    if (req.method === "POST" && ultimo && !ultimo.startsWith(":")) return ultimo.slice(0, 60);
    return ACCION_POR_VERBO[req.method] ?? req.method.toLowerCase();
  }

  /** Recurso afectado = primer segmento de la ruta tras el prefijo /api. */
  private entidadTipo(req: any): string {
    const segmentos = String(req.originalUrl ?? "")
      .split("?")[0]
      .split("/")
      .filter(Boolean);
    const i = segmentos[0] === "api" ? 1 : 0;
    return (segmentos[i] ?? "desconocido").slice(0, 60);
  }

  /** Ruta como patrón (sin ids) para agrupar en las consultas. */
  private rutaPatron(req: any): string {
    return req.route?.path ? `${req.method} ${req.route.path}` : `${req.method} ${req.originalUrl}`;
  }

  /**
   * Payload de la mutación, saneado. En DELETE no hay cuerpo: se deja constancia
   * del id afectado.
   *
   * NOTA: `antes`/`después` (valor previo vs. nuevo, RF-H04.2) NO se puede
   * construir desde un interceptor genérico: requiere leer la fila antes de la
   * mutación, lo que solo sabe hacer cada servicio. Aquí se registra el cambio
   * solicitado (`después`); el `antes` queda pendiente y está anotado como tal.
   */
  private diff(req: any, data: any): any {
    const body = this.sanear(req.body);
    const despues = body && Object.keys(body).length ? body : undefined;
    const payload: any = {};
    if (despues !== undefined) payload.despues = despues;
    if (req.method === "DELETE") payload.eliminado = req.params?.id ?? null;
    if (!Object.keys(payload).length) return undefined;

    // Salvaguarda de tamaño: si el payload es enorme, se guarda un resumen.
    const json = JSON.stringify(payload);
    if (json.length > MAX_DIFF_CHARS) {
      return { truncado: true, bytes: json.length, claves: Object.keys(despues ?? {}) };
    }
    return payload;
  }

  /** Copia profunda con las claves sensibles redactadas. */
  private sanear(valor: any, prof = 0): any {
    if (valor === null || valor === undefined) return valor;
    if (prof > 6) return REDACTADO;
    if (Array.isArray(valor)) return valor.slice(0, 100).map((v) => this.sanear(v, prof + 1));
    if (typeof valor !== "object") return valor;

    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(valor)) {
      const clave = k.toLowerCase();
      out[k] = CLAVES_SECRETAS.some((s) => clave.includes(s)) ? REDACTADO : this.sanear(v, prof + 1);
    }
    return out;
  }

  /**
   * IP en formato admisible por la columna INET. Express puede entregar
   * '::ffff:10.0.0.1' (IPv4 mapeada) — válido en PostgreSQL, pero se normaliza a
   * IPv4. Cualquier valor no reconocible se guarda como NULL antes que reventar
   * el INSERT.
   */
  private ipValida(req: any): string | null {
    const cruda: string | undefined = req.ip ?? req.socket?.remoteAddress;
    if (!cruda) return null;
    const ip = cruda.startsWith("::ffff:") ? cruda.slice(7) : cruda;
    const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const v6 = /^[0-9a-fA-F:]+$/;
    if (v4.test(ip) && ip.split(".").every((o) => Number(o) <= 255)) return ip;
    if (ip.includes(":") && v6.test(ip)) return ip;
    return null;
  }

  private texto(v: any, max: number): string | null {
    return typeof v === "string" && v.length ? v.slice(0, max) : null;
  }

  private uuidOrNull(v: any): string | null {
    return typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
      ? v
      : null;
  }
}
