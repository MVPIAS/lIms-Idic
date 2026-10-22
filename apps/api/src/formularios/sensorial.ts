/**
 * LES · panel sensorial: plan de sesión, cartillas por juez y consolidación
 * con su estadístico (EP-02 3.6–3.8, §5) · reglas PURAS (sensorial.spec.ts).
 *
 * Variante que se activa por método; queda inactiva hasta EP-02 P1. Nivel α,
 * jueces mínimos y rangos por atributo son parámetros (Listado LES, P4).
 *
 *   · Plan: código aleatorio de 3 dígitos por muestra (sin repetir) y orden de
 *     presentación por juez (rotación, como un cuadrado latino).
 *   · Escala (aceptabilidad, categoría): media, mediana y DE por atributo de
 *     los jueces válidos; un juez se excluye con motivo (la pantalla sugiere
 *     los atípicos a más de 2 DE de la media).
 *   · Triangular (ISO 4120): binomial con p = 1/3; hay diferencia significativa
 *     si P(X ≥ correctas) ≤ α. Se informa el mínimo de respuestas correctas.
 *   · Cocción: cumple si «Blandas».
 */

export type PruebaSensorial = "escala" | "triangular" | "coccion";
export type Veredicto = "cumple" | "no_cumple" | "pendiente" | "informativo";

/** Generador determinista (semilla) para que el plan se pueda reproducir. */
function aleatorio(semilla: number) {
  let s = semilla >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Códigos de 3 dígitos (100–999), distintos, uno por muestra. */
export function codigosAleatorios(n: number, semilla: number): string[] {
  const r = aleatorio(semilla);
  const out = new Set<string>();
  while (out.size < Math.min(n, 900)) out.add(String(100 + Math.floor(r() * 900)));
  return [...out];
}

/** Orden de presentación por juez: rotación de los códigos (cuadrado latino). */
export function ordenPorJuez(codigos: string[], jueces: number): string[][] {
  return Array.from({ length: jueces }, (_, j) => codigos.map((_, i) => codigos[(i + j) % codigos.length]));
}

/* -------------------------------------------------------- escala --- */

export interface Cartilla {
  juez: string;
  excluido?: boolean;
  motivoExclusion?: string | null;
  /** Escala: atributo → puntaje (1–9). */
  puntajes?: Record<string, number | null>;
  /** Triangular: ¿identificó la muestra distinta? */
  correcta?: boolean | null;
  /** Cocción: blandas | duras. */
  coccion?: "blandas" | "duras" | null;
  comentario?: string | null;
}

export interface EstadisticaAtributo {
  atributo: string;
  n: number;
  media: number | null;
  mediana: number | null;
  de: number | null;
  /** Jueces a más de 2 DE de la media (sugerencia de exclusión). */
  atipicos: string[];
}

const redondear = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function estadisticaEscala(cartillas: Cartilla[], atributos: string[]): EstadisticaAtributo[] {
  const validas = cartillas.filter((c) => !c.excluido);
  return atributos.map((a) => {
    const pares = validas.map((c) => ({ juez: c.juez, v: c.puntajes?.[a] })).filter((x): x is { juez: string; v: number } => typeof x.v === "number" && Number.isFinite(x.v));
    const vs = pares.map((p) => p.v).sort((x, y) => x - y);
    if (!vs.length) return { atributo: a, n: 0, media: null, mediana: null, de: null, atipicos: [] };
    const media = vs.reduce((s, x) => s + x, 0) / vs.length;
    const mediana = vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
    const de = vs.length > 1 ? Math.sqrt(vs.reduce((s, x) => s + (x - media) ** 2, 0) / (vs.length - 1)) : 0;
    const atipicos = de > 0 ? pares.filter((p) => Math.abs(p.v - media) > 2 * de).map((p) => p.juez) : [];
    return { atributo: a, n: vs.length, media: redondear(media), mediana: redondear(mediana), de: redondear(de), atipicos };
  });
}

/* ---------------------------------------------------------- triangular --- */

function combinaciones(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** P(X ≥ k) con X ~ Binomial(n, p). */
export function colaBinomial(n: number, k: number, p: number): number {
  let s = 0;
  for (let i = k; i <= n; i++) s += combinaciones(n, i) * p ** i * (1 - p) ** (n - i);
  return Math.min(1, s);
}

/** Mínimo de respuestas correctas para concluir diferencia (ISO 4120, p = 1/3). */
export function minimoCorrectas(n: number, alfa: number): number | null {
  for (let k = 0; k <= n; k++) if (colaBinomial(n, k, 1 / 3) <= alfa) return k;
  return null;
}

export function triangular(cartillas: Cartilla[], alfa: number) {
  const validas = cartillas.filter((c) => !c.excluido && typeof c.correcta === "boolean");
  const n = validas.length;
  const correctas = validas.filter((c) => c.correcta).length;
  const minimo = n ? minimoCorrectas(n, alfa) : null;
  const p = n ? colaBinomial(n, correctas, 1 / 3) : null;
  const hay = minimo != null && correctas >= minimo;
  return {
    n,
    correctas,
    minimo,
    p: p == null ? null : redondear(p, 4),
    diferencia: hay,
    conclusion: n ? `${hay ? "Existen" : "No existen"} diferencias significativas (α = ${String(alfa).replace(".", ",")}): ${correctas} de ${n} respuestas correctas${minimo != null ? `, mínimo ${minimo}` : ""}.` : "",
  };
}

/* ------------------------------------------------------------- rangos --- */

export interface Rango {
  prueba: string;
  atributo: string;
  min: number;
  max: number;
}

export function leerRangos(json: string | null | undefined): Rango[] {
  try {
    const f = JSON.parse(json ?? "[]");
    return Array.isArray(f)
      ? f.map((x: any) => ({ prueba: String(x?.prueba ?? ""), atributo: String(x?.atributo ?? ""), min: Number(x?.min), max: Number(x?.max) })).filter((r: Rango) => r.atributo && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max >= r.min)
      : [];
  } catch {
    return [];
  }
}

/** Veredicto de una media contra el rango del atributo (sin rango: informativo). */
export function veredictoRango(media: number | null, rango: Rango | undefined): Veredicto {
  if (media == null) return "pendiente";
  if (!rango) return "informativo";
  return media >= rango.min && media <= rango.max ? "cumple" : "no_cumple";
}

/** Errores de una cartilla (puntajes 1–9, juez con nombre, motivo de exclusión). */
export function erroresCartillas(prueba: PruebaSensorial, cartillas: Cartilla[], atributos: string[]): string[] {
  const e: string[] = [];
  const jueces = new Set<string>();
  for (const c of cartillas) {
    if (!c.juez?.trim()) e.push("Cada cartilla lleva el código del juez.");
    if (jueces.has(c.juez)) e.push(`El juez ${c.juez} está repetido.`);
    jueces.add(c.juez);
    if (c.excluido && (c.motivoExclusion ?? "").trim().length < 5) e.push(`Juez ${c.juez}: indique el motivo de la exclusión.`);
    if (prueba === "escala")
      for (const a of atributos) {
        const v = c.puntajes?.[a];
        if (v != null && (!Number.isFinite(v) || v < 0 || v > 9)) e.push(`Juez ${c.juez} · ${a}: el puntaje va de 0 a 9.`);
      }
  }
  return e;
}
