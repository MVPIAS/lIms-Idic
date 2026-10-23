/**
 * Números en textos para personas (avisos, mensajes, bloques) · coma decimal de
 * Chile (B-083: «promedio 6.5», «1.5 %»). Reglas PURAS: numero-chile.spec.ts.
 * Los documentos tienen sus propios formateadores (fmtNum del motor de informes).
 */
export function numeroChile(v: unknown, maxDecimales = 2): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("es-CL", { maximumFractionDigits: maxDecimales, useGrouping: Math.abs(n) >= 10000 });
}

/** «1,5 %» (el valor ya en porcentaje). */
export function porcentajeChile(v: unknown, maxDecimales = 2): string {
  const t = numeroChile(v, maxDecimales);
  return t ? `${t} %` : "";
}
