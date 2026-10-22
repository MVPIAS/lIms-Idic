/**
 * Requisitos que no caben en un Mín ≤ valor ≤ Máx · LIMS IDIC. Funciones PURAS
 * (sin BD): requisito-compuesto.spec.ts. Las usa la captura estándar
 * (captura-estandar.ts) cuando el ensayo trae, desde la especificación técnica
 * del cliente (E.T.) o desde la especificación de la orden:
 *
 *   · Plan de 2 o 3 clases (n, c, m, M) del RSA (EP-02 §5 LMB, BL-045):
 *     n unidades de muestra; No cumple si alguna supera M (3 clases) o si más
 *     de c unidades superan m. En 2 clases no hay M: No cumple si más de c
 *     superan m. Cada réplica capturada es una unidad.
 *   · Segunda condición en la misma fila (EP-03 3.6, BL-049): «X kgf con Y mm»
 *     son dos condiciones; el ensayo cumple solo si cumplen las dos. El valor de
 *     la segunda se captura junto al resultado.
 */
import { veredictoNumerico, type Veredicto } from "./veredicto";

export interface PlanClases {
  /** Unidades de muestra. */
  n: number;
  /** Unidades que se aceptan entre m y M (o sobre m en 2 clases). */
  c: number;
  /** Límite inferior de la zona marginal (aceptable hasta m). */
  m: number;
  /** Límite superior (3 clases); null = plan de 2 clases. */
  M?: number | null;
}

const entero = (v: unknown) => typeof v === "number" && Number.isInteger(v);

/** Errores de un plan (para la biblioteca de E.T. y la especificación de la orden). */
export function erroresPlanClases(p: Partial<PlanClases> | null | undefined, donde = "Plan de clases"): string[] {
  const e: string[] = [];
  if (!p) return [`${donde}: indique n, c y m.`];
  if (!entero(p.n) || p.n! < 1 || p.n! > 100) e.push(`${donde}: n debe ser un entero entre 1 y 100.`);
  if (!entero(p.c) || p.c! < 0) e.push(`${donde}: c debe ser un entero de 0 o más.`);
  else if (entero(p.n) && p.c! > p.n!) e.push(`${donde}: c (${p.c}) no puede superar n (${p.n}).`);
  if (typeof p.m !== "number" || !Number.isFinite(p.m)) e.push(`${donde}: m debe ser un número.`);
  if (p.M != null) {
    if (typeof p.M !== "number" || !Number.isFinite(p.M)) e.push(`${donde}: M debe ser un número.`);
    else if (typeof p.m === "number" && p.M <= p.m) e.push(`${donde}: M debe ser mayor que m.`);
  }
  return e;
}

export interface EvaluacionPlan {
  veredicto: Veredicto;
  /** Unidades sobre M (3 clases). */
  sobreM: number;
  /** Unidades en la zona marginal (m < x ≤ M) o sobre m (2 clases). */
  marginales: number;
  /** Unidades que faltan por capturar. */
  faltan: number;
  explicacion: string;
}

const fmt = (x: number) => String(x).replace(".", ",");

/**
 * Evalúa las unidades contra el plan. Decide No cumple en cuanto el resultado
 * ya no puede mejorar (una unidad sobre M, o más de c marginales); si faltan
 * unidades y nada lo decide aún, Pendiente.
 */
export function veredictoPlanClases(valores: number[], p: PlanClases): EvaluacionPlan {
  const tres = p.M != null;
  const sobreM = tres ? valores.filter((v) => v > p.M! + 1e-9).length : 0;
  const marginales = valores.filter((v) => v > p.m + 1e-9 && (!tres || v <= p.M! + 1e-9)).length;
  const faltan = Math.max(0, p.n - valores.length);
  const plan = tres ? `n = ${p.n}, c = ${p.c}, m = ${fmt(p.m)}, M = ${fmt(p.M!)}` : `n = ${p.n}, c = ${p.c}, m = ${fmt(p.m)}`;
  if (sobreM > 0)
    return { veredicto: "no_cumple", sobreM, marginales, faltan, explicacion: `${sobreM} unidad(es) sobre M (${plan}).` };
  if (marginales > p.c)
    return {
      veredicto: "no_cumple", sobreM, marginales, faltan,
      explicacion: `${marginales} unidad(es) ${tres ? "entre m y M" : "sobre m"}; se aceptan ${p.c} (${plan}).`,
    };
  if (faltan > 0)
    return { veredicto: "pendiente", sobreM, marginales, faltan, explicacion: `Faltan ${faltan} de ${p.n} unidades (${plan}).` };
  return {
    veredicto: "cumple", sobreM, marginales, faltan,
    explicacion: `${marginales} unidad(es) ${tres ? "entre m y M" : "sobre m"} (se admiten ${p.c})${tres ? ", ninguna sobre M" : ""} (${plan}).`,
  };
}

export interface Condicion2 {
  /** Qué se mide en la segunda condición («Alargamiento», «Deformación»). */
  etiqueta: string;
  inf?: number | null;
  sup?: number | null;
  unidad?: string | null;
}

/** Errores de la definición de la segunda condición. */
export function erroresCondicion2(c: Partial<Condicion2> | null | undefined, donde = "Segunda condición"): string[] {
  if (!c) return [];
  const e: string[] = [];
  if (!c.etiqueta?.trim()) e.push(`${donde}: indique qué se mide (p. ej. «Alargamiento»).`);
  if (c.inf == null && c.sup == null) e.push(`${donde}: indique el mínimo, el máximo o ambos.`);
  if (c.inf != null && c.sup != null && c.inf > c.sup) e.push(`${donde}: el mínimo no puede superar al máximo.`);
  return e;
}

/** Veredicto de la segunda condición: Pendiente si aún no tiene valor. */
export function veredictoCondicion2(valor: number | null | undefined, c: Condicion2): Veredicto {
  if (valor == null || !Number.isFinite(valor)) return "pendiente";
  return veredictoNumerico(valor, c.inf ?? null, c.sup ?? null);
}

/** Texto de la segunda condición para pantallas e informes: «con Alargamiento ≥ 12 mm». */
export function textoCondicion2(c: Condicion2): string {
  const u = c.unidad ? ` ${c.unidad}` : "";
  if (c.inf != null && c.sup != null) return `con ${c.etiqueta} ${fmt(c.inf)}–${fmt(c.sup)}${u}`;
  if (c.inf != null) return `con ${c.etiqueta} ≥ ${fmt(c.inf)}${u}`;
  return `con ${c.etiqueta} ≤ ${fmt(c.sup!)}${u}`;
}

/** Une dos veredictos de la misma fila: No cumple manda; luego Pendiente; Informativo solo si ambos lo son. */
export function combinarVeredictos(a: Veredicto, b: Veredicto): Veredicto {
  if (a === "no_cumple" || b === "no_cumple") return "no_cumple";
  if (a === "pendiente" || b === "pendiente") return "pendiente";
  if (a === "informativo" && b === "informativo") return "informativo";
  return "cumple";
}

/** Lee un plan guardado (JSON de la base) o null si no es válido. */
export function leerPlanClases(v: unknown): PlanClases | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x.replace(",", ".")) : NaN);
  const p: PlanClases = { n: num(o.n), c: num(o.c), m: num(o.m), M: o.M == null || o.M === "" ? null : num(o.M) };
  return erroresPlanClases(p).length ? null : p;
}

/** Lee una segunda condición guardada (JSON de la base) o null. */
export function leerCondicion2(v: unknown): Condicion2 | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) =>
    x == null || x === "" ? null : typeof x === "number" ? x : Number(String(x).replace(",", "."));
  const c: Condicion2 = { etiqueta: String(o.etiqueta ?? "").trim(), inf: num(o.inf), sup: num(o.sup), unidad: o.unidad ? String(o.unidad) : null };
  if ((c.inf != null && !Number.isFinite(c.inf)) || (c.sup != null && !Number.isFinite(c.sup))) return null;
  return erroresCondicion2(c).length ? null : c;
}
