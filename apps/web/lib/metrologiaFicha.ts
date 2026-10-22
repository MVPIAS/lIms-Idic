/**
 * Vista previa en pantalla de las condiciones ambientales corregidas (EP-04 P3.4):
 * la misma regla que aplica el servidor al guardar (apps/api/src/metrologia/ficha.reglas.ts):
 * promedio de las lecturas − error del certificado del equipo auxiliar (R15 T1: se resta),
 * redondeado a un decimal, con la U del certificado. El servidor recalcula y manda.
 */
export type Correccion = { error: number | null; U: number | null } | null | undefined;
export type Correcciones = { temp?: Correccion; hum?: Correccion; pres?: Correccion } | null | undefined;

export function corregida(lecturas: (number | null | undefined)[], c: Correccion): { corregido: number; U: number | null; sinCorreccion: boolean } | null {
  const v = lecturas.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const error = c?.error ?? 0;
  return { corregido: Math.round((m - error) * 10) / 10, U: c?.U ?? null, sinCorreccion: c?.error == null };
}

/** Texto con coma decimal a número (vacío o inválido → null). */
export const numeroOVacio = (t: string): number | null => {
  const s = String(t ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
