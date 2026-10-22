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

import {
  AQLS as AQLS_TABLA,
  LETRAS,
  NIVELES,
  PlanError,
  TAMANO_LETRA,
  letraCodigo as letraTabla,
  planNormal,
  textoAql,
  type Letra,
  type Nivel,
} from "../muestreo/nch44";

/*
 * Las tablas 1 y 2-A son las de `muestreo/nch44.ts`, fuente única en el LIMS
 * (la usa también el «Muestreo del lote» de la OT). Aquí solo se conserva la
 * forma en que esta pantalla escribe y valida los AQL (texto con coma decimal)
 * y sus mensajes de error.
 */
export { LETRAS, NIVELES };
export type { Letra, Nivel };

/** Tamaño de muestra de cada letra código (tabla 2-A). */
export const N_POR_LETRA: Record<Letra, number> = TAMANO_LETRA;

/** AQL de la tabla 2-A, con coma decimal como se escriben en los informes. */
export const AQLS: readonly string[] = AQLS_TABLA.map(textoAql);

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

/** Tabla 1: letra código para un tamaño de lote y un nivel de inspección. */
export function letraCodigo(tamanoLote: number, nivel: Nivel): Letra {
  if (!Number.isInteger(tamanoLote) || tamanoLote < 2)
    throw new AqlError("El tamaño del lote debe ser un número entero de 2 o más unidades.");
  if (!esNivel(nivel)) throw new AqlError(`Nivel de inspección desconocido: ${String(nivel)}.`);
  return letraTabla(tamanoLote, nivel);
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

/** Tabla 2-A, muestreo simple, inspección normal, con las flechas resueltas. */
export function planSimpleNormal(letra: Letra, aqlEntrada: string): { letraPlan: Letra; n: number; ac: number; re: number } {
  const aql = normalizarAql(aqlEntrada);
  if (!aql) throw new AqlError(`AQL no válido: «${aqlEntrada}». Use uno de la tabla (p. ej. 1,5 · 2,5 · 6,5).`);
  if (!LETRAS.includes(letra)) throw new AqlError(`Letra código desconocida: ${letra}.`);
  try {
    const p = planNormal(letra, aql, { borde: "plan_mas_cercano" });
    return { letraPlan: p.letra, n: p.n, ac: p.ac, re: p.re };
  } catch (e) {
    if (e instanceof PlanError) throw new AqlError(`No hay plan en la tabla para la letra ${letra} y AQL ${aql}.`);
    throw e;
  }
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
