/**
 * Bloqueo de cuentas por intentos fallidos · LIMS IDIC.
 *
 * Tras N intentos fallidos consecutivos el inicio de sesión se rechaza durante
 * una ventana (auth.service.ts). Pasada la ventana se puede reintentar, pero un
 * nuevo fallo vuelve a bloquearla al instante: la cuenta sigue bloqueada por
 * intentos hasta que entra bien, un administrador la desbloquea o le restablece
 * la contraseña (todos ponen los intentos a 0). Por eso la tarjeta «Usuarios
 * bloqueados» y la lista de usuarios cuentan como bloqueada toda cuenta con
 * `intentos_fallidos >= MAX_INTENTOS_FALLIDOS`, además de las de estado «bloqueado».
 */
export const MAX_INTENTOS_FALLIDOS = Number(process.env.AUTH_MAX_INTENTOS ?? 5);
export const LOCK_MS = Number(process.env.AUTH_LOCK_MINUTES ?? 15) * 60_000;

/** ¿La cuenta está bloqueada (por el administrador o por intentos fallidos)? */
export function cuentaBloqueada(u: { estado?: string | null; intentosFallidos?: number | null }, max = MAX_INTENTOS_FALLIDOS): boolean {
  return u.estado === "bloqueado" || (u.intentosFallidos ?? 0) >= max;
}

/** Motivo legible del bloqueo (null si no está bloqueada). */
export function motivoBloqueo(u: { estado?: string | null; intentosFallidos?: number | null }, max = MAX_INTENTOS_FALLIDOS): string | null {
  if (u.estado === "bloqueado") return "Bloqueada por un administrador";
  if ((u.intentosFallidos ?? 0) >= max) return `Bloqueada por ${u.intentosFallidos} intentos fallidos de inicio de sesión`;
  return null;
}
