/**
 * Veredicto único del resultado · LIMS IDIC.
 *
 * Antes convivían dos vocabularios: la captura por réplicas guardaba
 * «Cumple / No cumple / Informativo» y la captura por OT «cumple / no_cumple /
 * pendiente». Los reportes ya contaban `no_cumple`, así que un «No cumple» de
 * réplicas no aparecía en ninguna estadística. Ahora hay UN vocabulario,
 * guardado en minúsculas:
 *
 *   cumple       · el valor está dentro de la especificación.
 *   no_cumple    · el valor está fuera de la especificación.
 *   informativo  · no hay especificación contra la que contrastar: el valor se
 *                  informa tal cual (no bloquea la OT).
 *   pendiente    · aún sin valor, o con un valor que no se puede contrastar
 *                  automáticamente (p. ej. texto frente a límites numéricos):
 *                  lo decide el revisor.
 *
 * Funciones PURAS (sin BD): veredicto.spec.ts.
 */

export const VEREDICTOS = ["cumple", "no_cumple", "informativo", "pendiente"] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

export const ETIQUETA_VEREDICTO: Record<Veredicto, string> = {
  cumple: "Cumple",
  no_cumple: "No cumple",
  informativo: "Informativo",
  pendiente: "Pendiente",
};

/**
 * Lleva cualquier forma heredada al vocabulario único. Devuelve null si el
 * texto no es un veredicto reconocible (no se inventa uno).
 */
export function normalizarVeredicto(v: string | null | undefined): Veredicto | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, "_");
  if (s === "") return null;
  if (s === "cumple" || s === "conforme") return "cumple";
  if (s === "no_cumple" || s === "nocumple" || s === "no_conforme") return "no_cumple";
  if (s === "informativo") return "informativo";
  if (s === "pendiente") return "pendiente";
  return null;
}

/** Texto legible para pantallas e informes («No cumple»); el original si no se reconoce. */
export function etiquetaVeredicto(v: string | null | undefined): string {
  const n = normalizarVeredicto(v);
  return n ? ETIQUETA_VEREDICTO[n] : (v ?? "");
}

/** Tolerancia para las comparaciones de cota (evita falsos no_cumple por coma flotante). */
export const TOL_NUMERICA = 1e-9;

/**
 * Veredicto numérico contra una o dos cotas. Sin ninguna cota → informativo.
 *   [inf, sup] → cumple si inf ≤ valor ≤ sup
 *   solo inf   → cumple si valor ≥ inf
 *   solo sup   → cumple si valor ≤ sup
 */
export function veredictoNumerico(valor: number, inf?: number | null, sup?: number | null): Veredicto {
  if (inf == null && sup == null) return "informativo";
  if (inf != null && valor < inf - TOL_NUMERICA) return "no_cumple";
  if (sup != null && valor > sup + TOL_NUMERICA) return "no_cumple";
  return "cumple";
}
