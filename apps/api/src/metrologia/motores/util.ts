/**
 * Utilidades numéricas de los motores de Metrología.
 *
 * Reproducen el comportamiento de Excel (15 cifras significativas, REDONDEAR y
 * REDONDEAR.MAS con la mitad hacia arriba) para que el LIMS entregue los mismos
 * valores que los libros de trabajo del LMT, bit a bit.
 */
export type Datos = Record<string, any>;
export type Opciones = Record<string, boolean>;

export const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
export const stdev = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
/** REDONDEAR de Excel: 15 cifras significativas y mitad hacia arriba. */
export const xr = (x: number, d: number) => {
  const f = 10 ** d;
  return Math.round(Number((x * f).toPrecision(15))) / f;
};
/** REDONDEAR.MAS de Excel (alejándose de cero). */
export const xru = (x: number, d: number) => {
  const f = 10 ** d, y = Number((Math.abs(x) * f).toPrecision(15));
  return (Math.sign(x) * Math.ceil(y)) / f;
};
/** Solo las celdas numéricas (Excel ignora texto y vacíos en PROMEDIO/DESVEST). */
export const nums = (a: unknown[]): number[] => a.filter((v): v is number => typeof v === "number" && !isNaN(v));
export const avgN = (a: unknown[]) => mean(nums(a));
/** Número desde texto con coma decimal; null si no es numérico. */
export const num = (s: unknown): number | null => {
  const v = parseFloat(String(s).replace(",", "."));
  return isNaN(v) ? null : v;
};
export const mx = (a: unknown[]) => Math.max(...(a.filter((v) => typeof v === "number") as number[]));
