import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { JwtService } from "@nestjs/jwt";
import { getJwtSecret } from "./jwt-secret";

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
 * no existe; por eso se VERIFICA aquí el token (misma clave y algoritmo HS256 que
 * JwtStrategy) y solo un token válido da cubeta por usuario. Un token inválido,
 * falsificado sin firma o ausente (login, health, verificación pública) cae a la IP
 * real (X-Forwarded-For vía `trust proxy`): antes bastaba un JWT inventado con un
 * `sub` distinto en cada petición para tener cupo nuevo (revisión de seguridad r3).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return claveLimitador(req);
  }
}

let verificador: JwtService | null = null;

/** `sub` de un Bearer JWT con la firma VERIFICADA (HS256, sin caducar); null si no es válido. */
export function subVerificado(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  try {
    verificador ??= new JwtService({ secret: getJwtSecret() });
    const payload = verificador.verify<{ sub?: string; type?: string }>(m[1].trim(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Clave del limitador: el usuario si el token es válido; si no, la IP. */
export function claveLimitador(req: Record<string, any>): string {
  const sub = subVerificado(req?.headers?.authorization);
  if (sub) return `user:${sub}`;
  return `ip:${req?.ip ?? req?.ips?.[0] ?? "desconocida"}`;
}
