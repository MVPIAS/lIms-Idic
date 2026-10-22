/**
 * Equivalencias en el SI de la hoja 1 del certificado (respuesta del LMT del 21-10-2026,
 * observación 4: «mantener la información de la hoja Certificado de cada libro»).
 *
 * Los libros de presión (P-808: «4 bar (0,4 MPa)»), fuerza (F-1556: «200 kgf (1961,33 N)»)
 * y par (PT-0090: «100 lbf·ft 135,58 N·m») escriben junto a la capacidad, la resolución y
 * el rango su valor en el SI. En el LIMS esos datos son texto libre de la recepción: solo
 * se agrega la equivalencia cuando el texto es un número o un rango «a a b» (con o sin
 * paréntesis) en la unidad no SI del instrumento; si trae otra unidad o texto, se deja
 * tal cual. Funciones PURAS: equivalencias.spec.ts.
 */

/** Unidades no SI de los libros y su factor al SI (los mismos de las tablas «Resultados en SI»). */
export const UNIDAD_SI: Record<string, { unidad: string; factor: number }> = {
  bar: { unidad: "MPa", factor: 0.1 },
  kgf: { unidad: "N", factor: 9.80665 },
  "lbf·ft": { unidad: "N·m", factor: 1.3558179483314 },
};

const NUM = String.raw`[-+]?\d+(?:[.,]\d+)?`;
const UNIDADES = Object.keys(UNIDAD_SI).map((u) => u.replace(".", String.raw`\.`)).join("|");
/** «4», «0,5 a 4», «(10 a 100)», «200 kgf», «(0,5 a 4) bar». */
const PATRON = new RegExp(String.raw`^\(?\s*(${NUM})(?:\s*(?:a|-|–)\s*(${NUM}))?\s*\)?\s*(${UNIDADES})?\s*$`, "i");

const leer = (t: string) => Number(t.replace(",", "."));

/** |x| ≥ 1: hasta 2 decimales; |x| < 1: dos cifras significativas (como los libros). Coma decimal. */
export function formatoSI(x: number): string {
  if (!Number.isFinite(x)) return "--";
  if (x === 0) return "0";
  const a = Math.abs(x);
  const dec = a >= 1 ? 2 : Math.min(10, 1 - Math.floor(Math.log10(a)));
  const r = Number(x.toFixed(dec));
  return r.toLocaleString("es-CL", { maximumFractionDigits: dec, useGrouping: false });
}

/**
 * Texto del dato con su equivalencia en el SI, o null si no corresponde (unidad SI, otra
 * unidad, texto libre). `unidad` es la del instrumento según el motor de la IT.
 */
export function conEquivalenciaSI(texto: string | null | undefined, unidad: string | null | undefined): string | null {
  const t = String(texto ?? "").trim();
  if (!t) return null;
  const m = PATRON.exec(t);
  if (!m) return null;
  const u = (m[3] ? Object.keys(UNIDAD_SI).find((k) => k.toLowerCase() === m[3].toLowerCase()) : unidad) ?? "";
  const si = UNIDAD_SI[u];
  if (!si) return null;
  const a = leer(m[1]), b = m[2] != null ? leer(m[2]) : null;
  const base = m[3] ? t : `${t} ${u}`;
  const eq = b == null ? `${formatoSI(a * si.factor)} ${si.unidad}` : `${formatoSI(a * si.factor)} a ${formatoSI(b * si.factor)} ${si.unidad}`;
  return `${base} (${eq})`;
}

/**
 * Línea «Equivalencia en el SI» de la hoja 1: capacidad, resolución y rango que tienen
 * equivalencia, en una sola línea bajo la identificación del instrumento (así la hoja 1
 * sigue cabiendo en una página). null si ninguno la tiene.
 */
export function lineaEquivalenciasSI(datos: [string, string | null | undefined][], unidad: string | null | undefined): string | null {
  const partes = datos
    .map(([rotulo, texto]) => {
      const e = conEquivalenciaSI(texto, unidad);
      return e ? `${rotulo.toLowerCase()} ${e.replace(/ \(/, " = ").replace(/\)$/, "")}` : null;
    })
    .filter((x): x is string => !!x);
  return partes.length ? `Equivalencia en el SI: ${partes.join("; ")}.` : null;
}
