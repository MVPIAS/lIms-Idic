/**
 * Tokens de integración (cuentas de servicio) · contrato §4.7.4 · reglas PURAS
 * (sin BD), probadas en token-integracion.reglas.spec.ts.
 *
 * El token es un JWT firmado por el servidor (HS256, la misma clave que las
 * sesiones) con `type: "integracion"` y `jti` = id de la fila en
 * `token_integracion`. Así pasa por los mismos guards que una sesión normal
 * (JwtAuthGuard global y los AuthGuard("jwt") de cada controlador) y el
 * limitador de peticiones le da su propia cubeta. Además de la firma, cada
 * petición comprueba en la BD que el token no esté revocado ni vencido y que su
 * SHA-256 coincida con el guardado: el token en claro no se guarda nunca.
 */
import { createHash, timingSafeEqual } from "crypto";

/** Valor de `type` en el JWT de un token de integración. */
export const TIPO_TOKEN_INTEGRACION = "integracion";

/** Permiso que todo token de integración recibe además de los de su rol. */
export const PERMISO_DOCUMENTACION = "integracion.documentacion";

/** Permiso para crear y revocar tokens. */
export const PERMISO_TOKENS = "integracion.tokens";

/** Estado de la cuenta de servicio en `usuario` (no puede iniciar sesión en la web). */
export const ESTADO_CUENTA_SERVICIO = "servicio";

/** Plazos de vigencia que ofrece la pantalla (días). */
export const VIGENCIAS_DIAS = [30, 90, 180, 365, 730] as const;
export const VIGENCIA_MIN_DIAS = 1;
export const VIGENCIA_MAX_DIAS = 730;

/** Roles que nunca se pueden dar a un token (acceso total sin control de permisos). */
export const ROLES_PROHIBIDOS_TOKEN = ["SUPERADMIN"];

/** SHA-256 en hexadecimal del token completo. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Comparación en tiempo constante de dos hashes hexadecimales. */
export function mismoHash(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a.trim()), Buffer.from(b.trim()));
}

/** Últimos caracteres del token, para reconocerlo en la lista sin mostrarlo. */
export function sufijoToken(token: string): string {
  return token.slice(-6);
}

/**
 * Nombre de usuario de la cuenta de servicio a partir del nombre del token:
 * «ERP Finanzas (SIGFE)» → «api.erp-finanzas-sigfe». Sin tildes, en minúsculas,
 * solo letras, números y guiones; como mucho 50 caracteres.
 */
export function usernameServicio(nombre: string): string {
  const base = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44)
    .replace(/-+$/g, "");
  return `api.${base || "integracion"}`;
}

/** Fecha de expiración a `dias` de `desde`. */
export function expiracion(desde: Date, dias: number): Date {
  return new Date(desde.getTime() + dias * 86_400_000);
}

export type EstadoToken = "vigente" | "vencido" | "revocado";

/** Estado de un token según su fila. */
export function estadoToken(
  fila: { revocadoAt?: Date | string | null; expiraAt: Date | string },
  ahora: Date = new Date(),
): EstadoToken {
  if (fila.revocadoAt) return "revocado";
  return new Date(fila.expiraAt).getTime() <= ahora.getTime() ? "vencido" : "vigente";
}

/** Motivo de rechazo de un token presentado (null = válido). Frases para el 401. */
export function motivoRechazo(
  fila:
    | {
        usuarioId: string;
        tokenHash: string;
        revocadoAt?: Date | string | null;
        expiraAt: Date | string;
        usuarioEstado?: string | null;
        usuarioBorrado?: boolean;
      }
    | null
    | undefined,
  presentado: { sub?: string | null; hash: string },
  ahora: Date = new Date(),
): string | null {
  if (!fila) return "El token de integración no existe.";
  if (fila.usuarioId !== presentado.sub || !mismoHash(fila.tokenHash, presentado.hash)) {
    return "El token de integración no es válido.";
  }
  const estado = estadoToken(fila, ahora);
  if (estado === "revocado") return "El token de integración fue revocado.";
  if (estado === "vencido") return "El token de integración está vencido.";
  if (fila.usuarioBorrado || fila.usuarioEstado !== ESTADO_CUENTA_SERVICIO) {
    return "La cuenta de servicio del token está desactivada.";
  }
  return null;
}

/** Permisos efectivos del token: los de su rol más la documentación de la API. */
export function permisosToken(permisosRol: readonly string[]): string[] {
  return [...new Set([...permisosRol, PERMISO_DOCUMENTACION])].sort();
}

/** Lee el Bearer en claro de la cabecera Authorization. */
export function bearerDe(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
