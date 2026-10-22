/**
 * Inspección por atributos · NCh 44 (equivalente a ISO 2859-1) · reglas PURAS.
 * Probadas en aql.spec.ts. Las usan la «Inspección por atributos» del IVC
 * (EP-03 3.7, LCC y LTX), la regla de lote de la HCP del SVM (EP-05 5.3) y la
 * configuración de «Parámetros de la operación» (nivel y AQL por clase).
 *
 *   · Tabla I: tamaño del lote + nivel de inspección → letra código.
 *   · Tabla II-A: muestreo simple, inspección normal: letra + AQL → tamaño de
 *     muestra n, número de aceptación Ac y de rechazo Re. Las flechas de la
 *     tabla se resuelven como dice la norma: «↓» usa el primer plan de abajo
 *     (letra siguiente) y «↑» el primero de arriba; el tamaño de muestra es el
 *     de la letra cuyo plan se usa. Si n ≥ lote, se inspecciona el 100 %.
 *   · Acepta si defectuosos ≤ Ac; rechaza si defectuosos ≥ Re.
 *
 * La norma no depende del IDIC; sí el nivel y el AQL que se apliquen a cada
 * inspección o clase de defecto (EP-03 P5, EP-05 P15): van como parámetros.
 */

export const NIVELES = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"] as const;
export type Nivel = (typeof NIVELES)[number];

export const LETRAS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"] as const;
export type Letra = (typeof LETRAS)[number];

/** Tamaño de muestra de cada letra código (tabla II-A). */
export const N_POR_LETRA: Record<Letra, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50, J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

/** AQL de la tabla II-A, con coma decimal como se escriben en los informes. */
export const AQLS = [
  "0,010", "0,015", "0,025", "0,040", "0,065", "0,10", "0,15", "0,25", "0,40", "0,65", "1,0", "1,5", "2,5", "4,0", "6,5",
  "10", "15", "25", "40", "65", "100", "150", "250", "400", "650", "1000",
] as const;

/** Límite superior de cada tramo de tamaño de lote (tabla I); el último no tiene tope. */
const TRAMOS_LOTE = [8, 15, 25, 50, 90, 150, 280, 500, 1200, 3200, 10000, 35000, 150000, 500000, Infinity];

/** Tabla I: una fila por nivel, una letra por tramo de lote. */
const TABLA_I: Record<Nivel, string> = {
  "S-1": "AAAABBBBCCCCDDD",
  "S-2": "AAABBBCCCDDDEEE",
  "S-3": "AABBCCDDEEFFGGH",
  "S-4": "AABCCDEEFGGHJJK",
  I: "AABCCDEFGHJKLMN",
  II: "ABCDEFGHJKLMNPQ",
  III: "BCDEFGHJKLMNPQR",
};

/** Pares Ac/Re de la tabla II-A, en el orden en que aparecen a lo largo de una fila. */
const SECUENCIA: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [5, 6], [7, 8], [10, 11], [14, 15], [21, 22], [30, 31], [44, 45],
];

export class AqlError extends Error {}

/** Normaliza un AQL escrito por una persona («2.5», «2,5», «2,50») al texto de la tabla. */
export function normalizarAql(valor: unknown): string | null {
  const t = String(valor ?? "").trim().replace(".", ",");
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return AQLS.find((a) => Math.abs(Number(a.replace(",", ".")) - n) < 1e-9) ?? null;
}

export function esNivel(v: unknown): v is Nivel {
  return typeof v === "string" && (NIVELES as readonly string[]).includes(v);
}

/** Tabla I: letra código para un tamaño de lote y un nivel de inspección. */
export function letraCodigo(tamanoLote: number, nivel: Nivel): Letra {
  if (!Number.isInteger(tamanoLote) || tamanoLote < 2)
    throw new AqlError("El tamaño del lote debe ser un número entero de 2 o más unidades.");
  if (!esNivel(nivel)) throw new AqlError(`Nivel de inspección desconocido: ${String(nivel)}.`);
  const i = TRAMOS_LOTE.findIndex((tope) => tamanoLote <= tope);
  return TABLA_I[nivel][i] as Letra;
}

type Celda = { ac: number; re: number } | "abajo" | "arriba";

/**
 * Celda de la tabla II-A para una letra y un AQL (sin resolver flechas). La
 * tabla tiene una diagonal: el primer plan de cada fila (0/1) cae en el AQL
 * cuyo índice es 14 − índice de la letra; a su derecha vienen «↑», «↓» y la
 * secuencia 1/2, 2/3, 3/4, 5/6… Los AQL ≤ 10 (porcentaje defectuoso) llegan
 * hasta 21/22; los mayores (defectos por cien unidades), hasta 44/45.
 */
function celda(iLetra: number, iAql: number): Celda {
  const k = iAql + iLetra - 14;
  if (k < 0) return "abajo";
  if (k === 0) return { ac: 0, re: 1 };
  if (k === 1) return "arriba";
  if (k === 2) return "abajo";
  const par = SECUENCIA[k - 3];
  const tope = iAql <= AQLS.indexOf("10") ? 7 : SECUENCIA.length - 1;
  if (!par || k - 3 > tope) return "arriba";
  return { ac: par[0], re: par[1] };
}

export interface PlanMuestreo {
  /** Letra que da la tabla I. */
  letra: Letra;
  /** Letra cuyo plan se usa tras seguir las flechas (si difiere, cambia n). */
  letraPlan: Letra;
  aql: string;
  nivel: Nivel;
  /** Tamaño de muestra a inspeccionar (≤ lote). */
  n: number;
  ac: number;
  re: number;
  /** n de la tabla era ≥ lote: se inspecciona el lote completo. */
  inspeccionTotal: boolean;
  /** Explicación legible del plan («Letra E · n = 13 · Ac 1 / Re 2»). */
  texto: string;
}

/** Tabla II-A, muestreo simple, inspección normal, con las flechas resueltas. */
export function planSimpleNormal(letra: Letra, aqlEntrada: string): { letraPlan: Letra; n: number; ac: number; re: number } {
  const aql = normalizarAql(aqlEntrada);
  if (!aql) throw new AqlError(`AQL no válido: «${aqlEntrada}». Use uno de la tabla (p. ej. 1,5 · 2,5 · 6,5).`);
  const iAql = AQLS.indexOf(aql as (typeof AQLS)[number]);
  let i = LETRAS.indexOf(letra);
  if (i < 0) throw new AqlError(`Letra código desconocida: ${letra}.`);
  let sentido: "abajo" | "arriba" | null = null;
  for (let pasos = 0; pasos < LETRAS.length + 2; pasos++) {
    const c = celda(i, iAql);
    if (typeof c === "object") return { letraPlan: LETRAS[i], n: N_POR_LETRA[LETRAS[i]], ...c };
    // Una flecha se sigue siempre en el sentido en que apunta la primera.
    sentido ??= c;
    const j = sentido === "abajo" ? i + 1 : i - 1;
    if (j < 0 || j >= LETRAS.length) {
      // Borde de la tabla: el plan más cercano de la misma fila.
      for (let d = 1; d < AQLS.length; d++) {
        for (const a of [iAql + d, iAql - d]) {
          if (a < 0 || a >= AQLS.length) continue;
          const x = celda(i, a);
          if (typeof x === "object") return { letraPlan: LETRAS[i], n: N_POR_LETRA[LETRAS[i]], ...x };
        }
      }
      break;
    }
    i = j;
  }
  throw new AqlError(`No hay plan en la tabla para la letra ${letra} y AQL ${aql}.`);
}

/** Plan completo: lote + nivel + AQL → letra, n, Ac, Re (n nunca supera el lote). */
export function planAql(tamanoLote: number, nivel: Nivel, aqlEntrada: string): PlanMuestreo {
  const aql = normalizarAql(aqlEntrada);
  if (!aql) throw new AqlError(`AQL no válido: «${aqlEntrada}».`);
  const letra = letraCodigo(tamanoLote, nivel);
  const p = planSimpleNormal(letra, aql);
  const inspeccionTotal = p.n >= tamanoLote;
  const n = inspeccionTotal ? tamanoLote : p.n;
  const cambio = p.letraPlan !== letra ? ` (flecha a la letra ${p.letraPlan})` : "";
  return {
    letra,
    letraPlan: p.letraPlan,
    aql,
    nivel,
    n,
    ac: p.ac,
    re: p.re,
    inspeccionTotal,
    texto: `Nivel ${nivel} · letra ${letra}${cambio} · AQL ${aql} · n = ${n}${inspeccionTotal ? " (100 % del lote)" : ""} · Ac ${p.ac} / Re ${p.re}`,
  };
}

export type Decision = "acepta" | "rechaza";

/** Acepta si defectuosos ≤ Ac; rechaza si ≥ Re (en simple, Re = Ac + 1). */
export function decidir(defectuosos: number, ac: number, re: number): Decision {
  if (!Number.isInteger(defectuosos) || defectuosos < 0) throw new AqlError("El número de defectuosos debe ser un entero de 0 o más.");
  if (!Number.isInteger(ac) || !Number.isInteger(re) || ac < 0 || re <= ac)
    throw new AqlError("Ac y Re deben ser enteros con Re mayor que Ac.");
  if (defectuosos <= ac) return "acepta";
  return "rechaza";
}

/* ----------------------------------------------- inspección por atributos --- */

/** Una fila de la «Inspección por atributos · lote» (EP-03 3.7). */
export interface FilaInspeccionAql {
  /** Nombre de la inspección (numeración, terminación, embalaje…). */
  inspeccion: string;
  aql: string;
  nivel: Nivel;
  defectuosos: number | null;
  /** Ac/Re fijados a mano (con motivo) cuando el plan del contrato difiere de la tabla. */
  acManual?: number | null;
  reManual?: number | null;
  motivoManual?: string | null;
  /** Resultado de la OT al que se lleva el cumplimiento (opcional). */
  resultadoId?: string | null;
}

export interface FilaEvaluada extends FilaInspeccionAql {
  plan: PlanMuestreo;
  ac: number;
  re: number;
  decision: Decision | null;
  /** «Cumple» / «No cumple» / «Pendiente» para el informe. */
  cumplimiento: "cumple" | "no_cumple" | "pendiente";
}

/** Valida y evalúa una inspección por atributos completa (lote + filas). */
export function evaluarInspeccion(tamanoLote: number, filas: FilaInspeccionAql[]): { filas: FilaEvaluada[]; errores: string[]; cumple: boolean | null } {
  const errores: string[] = [];
  if (!Number.isInteger(tamanoLote) || tamanoLote < 2) errores.push("Indique el tamaño del lote (entero de 2 o más).");
  if (!filas.length) errores.push("Agregue al menos una inspección (numeración, terminación, embalaje…).");
  const evaluadas: FilaEvaluada[] = [];
  if (errores.length) return { filas: evaluadas, errores, cumple: null };
  filas.forEach((f, i) => {
    const donde = `Inspección ${i + 1}${f.inspeccion ? ` (${f.inspeccion})` : ""}`;
    if (!f.inspeccion?.trim()) errores.push(`${donde}: escriba qué se inspecciona.`);
    let plan: PlanMuestreo;
    try {
      plan = planAql(tamanoLote, f.nivel, f.aql);
    } catch (e) {
      errores.push(`${donde}: ${(e as Error).message}`);
      return;
    }
    const manual = f.acManual != null || f.reManual != null;
    let ac = plan.ac;
    let re = plan.re;
    if (manual) {
      if (f.acManual == null || f.reManual == null || !Number.isInteger(f.acManual) || !Number.isInteger(f.reManual) || f.acManual < 0 || f.reManual <= f.acManual)
        errores.push(`${donde}: Ac y Re manuales deben ser enteros, con Re mayor que Ac.`);
      else if ((f.motivoManual ?? "").trim().length < 5) errores.push(`${donde}: indique el motivo por el que Ac/Re difieren de la tabla (mínimo 5 caracteres).`);
      else {
        ac = f.acManual;
        re = f.reManual;
      }
    }
    let decision: Decision | null = null;
    if (f.defectuosos != null) {
      if (!Number.isInteger(f.defectuosos) || f.defectuosos < 0) errores.push(`${donde}: los defectuosos verificados son un entero de 0 o más.`);
      else if (f.defectuosos > plan.n) errores.push(`${donde}: hay más defectuosos (${f.defectuosos}) que unidades en la muestra (n = ${plan.n}).`);
      else decision = decidir(f.defectuosos, ac, re);
    }
    evaluadas.push({ ...f, plan, ac, re, decision, cumplimiento: decision === null ? "pendiente" : decision === "acepta" ? "cumple" : "no_cumple" });
  });
  const cumple = errores.length || evaluadas.some((f) => f.decision === null) ? null : evaluadas.every((f) => f.decision === "acepta");
  return { filas: evaluadas, errores, cumple };
}

/* ------------------------------------------------- AQL por clase de defecto --- */

/** Clase de defecto de la HCP del SVM (A crítico · B mayor · C menor). */
export type Clase = "A" | "B" | "C";

/**
 * AQL de una clase: un valor de la tabla o «0», que significa que una sola
 * unidad con ese defecto rechaza el lote (Ac 0 / Re 1), como la clase A.
 */
export function planDeClase(tamanoLote: number, nivel: Nivel, aqlClase: string): { ac: number; re: number; texto: string; n: number | null } {
  if (String(aqlClase).trim() === "0") return { ac: 0, re: 1, n: null, texto: "Una unidad no conforme rechaza el lote (Ac 0 / Re 1)" };
  const p = planAql(tamanoLote, nivel, aqlClase);
  return { ac: p.ac, re: p.re, n: p.n, texto: p.texto };
}
