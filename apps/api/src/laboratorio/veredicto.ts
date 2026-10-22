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

/* -------------------------------------------------------------------------- */
/* Resultados bajo o sobre el límite de detección / cuantificación («< 10»)    */
/* (EP-02 §5 LMB «< 10», «< 1,8», «< 2»; recorrido MP-02, D02-03)               */
/* -------------------------------------------------------------------------- */

/** Qué hacer cuando el «< LD» no se puede decidir contra el requisito (Catálogo › Parámetros · captura_ld.indeterminado). */
export type CriterioIndeterminado = "pendiente" | "no_cumple" | "cumple";

export function criterioIndeterminado(v: string | null | undefined): CriterioIndeterminado {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "no_cumple" || s === "cumple" ? s : "pendiente";
}

export interface ValorCensurado {
  /** «<» o «≤»: el valor real está por debajo; «>» o «≥»: por encima. */
  op: "<" | "<=" | ">" | ">=";
  limite: number;
}

/**
 * Lee «< 10», «<10 ufc/g», «≤ 1,8», «> 2400 NMP/100 mL». null si el texto no es
 * de esa forma (p. ej. «Ausencia» o «< LD» sin número).
 */
export function leerCensurado(texto: string | null | undefined): ValorCensurado | null {
  const m = /^\s*(<=|>=|≤|≥|<|>)\s*([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))(?:\s*[a-zA-ZµÁÉÍÓÚáéíóúñ%°/][\wµÁÉÍÓÚáéíóúñ%°/. ]*)?\s*$/.exec(String(texto ?? ""));
  if (!m) return null;
  const op = m[1] === "≤" ? "<=" : m[1] === "≥" ? ">=" : (m[1] as ValorCensurado["op"]);
  return { op, limite: Number(m[2].replace(",", ".")) };
}

/**
 * Veredicto de un valor censurado frente a Mín/Máx. Se decide solo cuando TODO
 * valor posible cae del mismo lado:
 *   «< 10» frente a Máx 100 (o Máx 10) → cumple (cualquier valor < 10 es ≤ Máx);
 *   «< 10» frente a Mín 20             → no cumple;
 *   «< 10» frente a Máx 5              → indeterminado (podría ser 3 o 7): `criterio`.
 * Sin Mín ni Máx → informativo.
 */
export function veredictoCensurado(
  c: ValorCensurado,
  inf: number | null | undefined,
  sup: number | null | undefined,
  criterio: CriterioIndeterminado = "pendiente",
): Veredicto {
  if (inf == null && sup == null) return "informativo";
  const T = TOL_NUMERICA;
  const debajo = c.op === "<" || c.op === "<=";
  const estricto = c.op === "<" || c.op === ">";
  let indeterminado = false;
  if (debajo) {
    // Valor real en (-∞, L) o (-∞, L].
    if (sup != null && !(estricto ? c.limite <= sup + T : c.limite <= sup + T)) indeterminado = true;
    if (inf != null) {
      if (estricto ? c.limite <= inf + T : c.limite < inf - T) return "no_cumple";
      indeterminado = true;
    }
  } else {
    // Valor real en (L, +∞) o [L, +∞).
    if (sup != null) {
      if (estricto ? c.limite >= sup - T : c.limite > sup + T) return "no_cumple";
      indeterminado = true;
    }
    if (inf != null && !(c.limite >= inf - T)) indeterminado = true;
  }
  return indeterminado ? criterio : "cumple";
}
