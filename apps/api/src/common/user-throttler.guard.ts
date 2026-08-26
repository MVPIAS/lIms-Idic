import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Rate limiting por USUARIO, no por IP.
 *
 * El LIMS es on-premise: decenas de analistas salen por la misma IP pública
 * institucional (NAT), y además Caddy actúa de reverse-proxy por delante. Con el
 * ThrottlerGuard estándar todos ellos comparten un único cupo por `req.ip` (la IP
 * de Caddy), así que una pantalla que dispara varias peticiones —como /clientes—
 * agota el límite y devuelve `429 Too Many Requests` a todo el mundo.
 *
 * Solución: la clave de rate-limit es el `sub` del JWT (identidad del usuario).
 * Como el ThrottlerGuard se ejecuta ANTES que el JwtAuthGuard, `req.user` todavía
 * no existe; por eso extraemos el `sub` decodificando el payload del token de la
 * cabecera Authorization. NO verificamos la firma: solo lo usamos como clave de
 * cubeta. Un token inválido o ausente (login, health, peticiones anónimas) cae a
 * la IP real (X-Forwarded-For vía `trust proxy`), que es lo correcto para el
 * limitador estricto de /auth/login.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const sub = subFromAuthHeader(req?.headers?.authorization);
    if (sub) return `user:${sub}`;
    // Sin token → por IP (Express ya resuelve la IP real con trust proxy).
    return `ip:${req.ip ?? req.ips?.[0] ?? "desconocida"}`;
  }
}

/** Extrae el `sub` del payload de un Bearer JWT sin verificar la firma. */
function subFromAuthHeader(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const payload = JSON.parse(json) as { sub?: string };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
