/**
 * Cierre de sesión por inactividad (contrato §4.7.6) · regla PURA, probada en
 * sesion.spec.ts. El valor vive en `parametro_sistema` (categoría «sesion»,
 * código «inactividad_minutos») y se edita en Parámetros del sistema.
 */

export const INACTIVIDAD_DEFECTO = 20;
export const INACTIVIDAD_MIN = 2;
export const INACTIVIDAD_MAX = 480;

/** Minutos de inactividad: el guardado si es un entero válido y la fila está activa; si no, 20. */
export function minutosInactividad(fila: { valor: string | null; activo?: boolean } | null | undefined): number {
  if (!fila || fila.activo === false) return INACTIVIDAD_DEFECTO;
  const s = String(fila.valor ?? "").trim();
  if (!/^\d{1,4}$/.test(s)) return INACTIVIDAD_DEFECTO;
  const n = Number(s);
  return n >= INACTIVIDAD_MIN && n <= INACTIVIDAD_MAX ? n : INACTIVIDAD_DEFECTO;
}
