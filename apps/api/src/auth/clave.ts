/**
 * Reglas mínimas de contraseña (cambio por el propio usuario y primer ingreso).
 *
 *   · 10 caracteres como mínimo y 200 como máximo.
 *   · Al menos una letra y al menos un número.
 *   · Distinta de la contraseña actual.
 *   · No puede contener el nombre de usuario.
 *
 * Función PURA: el servicio la aplica antes de calcular el hash.
 */
export const CLAVE_MIN = 10;
export const CLAVE_MAX = 200;

export const REGLAS_CLAVE_TEXTO =
  `Mínimo ${CLAVE_MIN} caracteres, con al menos una letra y un número; distinta de la actual y sin su nombre de usuario.`;

export function erroresNuevaClave(nueva: string, ctx: { actual?: string; username?: string } = {}): string[] {
  const e: string[] = [];
  const n = nueva ?? "";
  if (n.length < CLAVE_MIN) e.push(`La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`);
  if (n.length > CLAVE_MAX) e.push(`La contraseña no puede superar ${CLAVE_MAX} caracteres.`);
  if (!/\p{L}/u.test(n)) e.push("La contraseña debe incluir al menos una letra.");
  if (!/\d/.test(n)) e.push("La contraseña debe incluir al menos un número.");
  if (ctx.actual !== undefined && n === ctx.actual) e.push("La nueva contraseña debe ser distinta de la actual.");
  const u = (ctx.username ?? "").trim().toLowerCase();
  if (u.length >= 3 && n.toLowerCase().includes(u)) e.push("La contraseña no puede contener su nombre de usuario.");
  return e;
}
