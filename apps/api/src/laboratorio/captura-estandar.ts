/**
 * Formulario de captura estándar · cálculo del resultado de UN ensayo.
 * Función PURA (sin BD): captura-estandar.spec.ts. La usa
 * POST /flujo/resultado/:id/valor para todos los laboratorios.
 *
 * Entrada según el tipo de ensayo:
 *   · ATRIBUTO  → el analista elige Cumple / No cumple (con observación, que es
 *                 obligatoria si no cumple). Opcionalmente anota lo observado.
 *   · NUMÉRICO  → una de estas tres formas:
 *       - lecturas: los campos del método (C1..Cn, `paso_metodo`) de cada
 *         lectura; se aplica la fórmula a cada lectura y el valor es el promedio;
 *       - réplicas: RN1..RNn → promedio, DE, CV; si hay fórmula que no usa
 *         campos (p. ej. «PROMEDIO(RN) * 100») se aplica sobre ellas;
 *       - valor directo (número, con coma decimal) o texto cualitativo.
 *     Veredicto: Mín ≤ valor ≤ Máx; sin límites → «informativo».
 *   · FACTOR (factor.ts): si el ensayo lleva factor, multiplica o divide el
 *     valor CALCULADO (lecturas o réplicas). El valor directo no se toca.
 *     `valorSinFactor` guarda el valor antes del factor para recalcular si el
 *     factor cambia después.
 */
import { evaluarFormula, FormulaError } from "../common/formula";
import { leerReplicas } from "./replicas";
import { traducirFormula } from "./formula-legado";
import { esNumeroTexto, type TipoDato } from "./especificacion";
import { veredictoNumerico, type Veredicto } from "./veredicto";
import { aplicarFactor, expresionConFactor, type Factor } from "./factor";

export class CapturaError extends Error {}

export interface EspecCaptura {
  tipoDato: TipoDato;
  limiteInf?: string | null;
  nominal?: string | null;
  limiteSup?: string | null;
  formula?: string | null;
  factor?: Factor | null;
}

export interface EntradaCaptura {
  valor?: number | string;
  replicas?: number[];
  replicasTexto?: string;
  lecturas?: Record<string, number | string | null>[];
  variables?: Record<string, number>;
  atributo?: "cumple" | "no_cumple";
  observacion?: string;
}

export interface CalculoCaptura {
  valorNumerico: number | null;
  valorTexto: string | null;
  replicas: number[];
  promedio: number | null;
  desviacion: number | null;
  cv: number | null;
  resultadoFinal: number | null;
  formulaAplicada: string | null;
  lecturas: Record<string, number>[] | null;
  observacion: string | null;
  veredicto: Veredicto;
  /** Valor calculado antes del factor (NULL si no es un valor calculado). */
  valorSinFactor: number | null;
  /** ¿Se aplicó el factor del ensayo? */
  factorAplicado: boolean;
}

const num = (v: string | null | undefined): number | null =>
  esNumeroTexto(v) ? Number(String(v).trim().replace(",", ".")) : null;

const texto = (v: string | null | undefined): string | null => {
  const s = String(v ?? "").trim();
  return s && !esNumeroTexto(s) ? s.toLowerCase() : null;
};

function estadistica(rep: number[]) {
  const n = rep.length;
  const m = rep.reduce((a, b) => a + b, 0) / n;
  const s = n > 1 ? Math.sqrt(rep.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { promedio: m, desviacion: s, cv: m ? (s / Math.abs(m)) * 100 : 0 };
}

/** Número de una celda escrita a mano (admite coma decimal). */
function numeroCelda(v: number | string | null | undefined, donde: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!esNumeroTexto(s)) throw new CapturaError(`${donde}: «${s || "vacío"}» no es un número (use coma o punto decimal).`);
  return Number(s.replace(",", "."));
}

function evaluar(expr: string, ctx: Record<string, number | number[]>, donde: string): number {
  try {
    return evaluarFormula(expr, ctx);
  } catch (e) {
    if (e instanceof FormulaError) throw new CapturaError(`${donde}: no se pudo aplicar la fórmula (${expr}): ${e.message}`);
    throw e;
  }
}

function sinVariablesReservadas(vars: Record<string, number> | undefined) {
  for (const k of Object.keys(vars ?? {}))
    if (/^(RN\d*|REPLICAS|PROMEDIO|DE|CV|N|C\d+)$/i.test(k))
      throw new CapturaError(`La variable «${k}» está reservada (RN, RN1..RNn, REPLICAS, PROMEDIO, DE, CV, N, C1..Cn).`);
}

export function calcularCaptura(espec: EspecCaptura, e: EntradaCaptura): CalculoCaptura {
  const base: CalculoCaptura = {
    valorNumerico: null, valorTexto: null, replicas: [], promedio: null, desviacion: null, cv: null,
    resultadoFinal: null, formulaAplicada: null, lecturas: null, observacion: e.observacion?.trim() || null, veredicto: "pendiente",
    valorSinFactor: null, factorAplicado: false,
  };
  const factor = espec.factor ?? null;

  /* ---------------- ATRIBUTO ---------------- */
  if (espec.tipoDato === "atributo") {
    const observado = e.valor != null && String(e.valor).trim() !== "" ? String(e.valor).trim() : null;
    if (e.atributo) {
      if (e.atributo === "no_cumple" && !base.observacion)
        throw new CapturaError("Indique la observación: qué no cumple y por qué.");
      return { ...base, valorTexto: observado ?? (e.atributo === "cumple" ? "Cumple" : "No cumple"), veredicto: e.atributo };
    }
    // Sin elección explícita: si la especificación es un texto corto y lo
    // observado coincide, se decide solo (p. ej. «Ausencia» = «Ausencia»).
    const esperado = texto(espec.nominal) ?? texto(espec.limiteInf) ?? texto(espec.limiteSup);
    if (observado && esperado)
      return { ...base, valorTexto: observado, veredicto: observado.toLowerCase() === esperado ? "cumple" : "no_cumple" };
    throw new CapturaError("Elija Cumple o No cumple para este ensayo.");
  }

  /* ---------------- NUMÉRICO ---------------- */
  sinVariablesReservadas(e.variables);
  const inf = num(espec.limiteInf);
  const sup = num(espec.limiteSup);
  const trad = traducirFormula(espec.formula);
  let valor: number | null = null;
  const out = { ...base };

  if (e.lecturas?.length) {
    if (!trad.expr || trad.nCampos === 0)
      throw new CapturaError("Este ensayo no tiene una fórmula por campos: ingrese el valor final o las réplicas.");
    const lecturas: Record<string, number>[] = [];
    const valores = e.lecturas.map((l, i) => {
      const ctx: Record<string, number> = { ...(e.variables ?? {}) };
      const limpia: Record<string, number> = {};
      for (let c = 1; c <= trad.nCampos; c++) {
        const v = numeroCelda(l[`C${c}`] ?? l[`c${c}`], `Lectura ${i + 1}, campo ${c}`);
        ctx[`C${c}`] = v;
        limpia[`C${c}`] = v;
      }
      lecturas.push(limpia);
      return evaluar(trad.expr!, ctx, `Lectura ${i + 1}`);
    });
    const st = estadistica(valores);
    valor = aplicarFactor(st.promedio, factor);
    Object.assign(out, {
      replicas: valores, promedio: st.promedio, desviacion: st.desviacion, cv: st.cv,
      resultadoFinal: valor, formulaAplicada: expresionConFactor(trad.expr!, factor), lecturas,
      valorSinFactor: st.promedio, factorAplicado: !!factor,
    });
  } else if (e.replicas?.length || (e.replicasTexto ?? "").trim()) {
    let rep = e.replicas ?? [];
    if (!rep.length) {
      const r = leerReplicas(e.replicasTexto!);
      if (r.invalidos.length)
        throw new CapturaError(`No se entiende como número: ${r.invalidos.map((t) => `«${t}»`).join(", ")}. Use coma o punto decimal.`);
      rep = r.valores;
    }
    if (!rep.length) throw new CapturaError("Indique al menos una réplica.");
    const st = estadistica(rep);
    Object.assign(out, { replicas: rep, promedio: st.promedio, desviacion: st.desviacion, cv: st.cv });
    valor = st.promedio;
    // Fórmula sobre las réplicas (solo si no pide campos del método).
    if (trad.expr && trad.nCampos === 0) {
      const ctx: Record<string, number | number[]> = { ...(e.variables ?? {}), RN: rep, REPLICAS: rep, PROMEDIO: st.promedio, DE: st.desviacion, CV: st.cv, N: rep.length };
      rep.forEach((v, i) => (ctx[`RN${i + 1}`] = v));
      valor = evaluar(trad.expr, ctx, "Réplicas");
    }
    const sinFactor = valor as number;
    valor = aplicarFactor(sinFactor, factor);
    if (trad.expr && trad.nCampos === 0) Object.assign(out, { resultadoFinal: valor, formulaAplicada: expresionConFactor(trad.expr, factor) });
    else if (factor) Object.assign(out, { resultadoFinal: valor, formulaAplicada: expresionConFactor("PROMEDIO(RN)", factor) });
    Object.assign(out, { valorSinFactor: sinFactor, factorAplicado: !!factor });
  } else if (e.valor != null && String(e.valor).trim() !== "") {
    if (typeof e.valor === "number") valor = e.valor;
    else if (esNumeroTexto(e.valor)) valor = Number(e.valor.trim().replace(",", "."));
    else if (/^[\d\s.,+-]+$/.test(e.valor.trim()))
      throw new CapturaError(`No se entiende «${e.valor.trim()}» como número: use un solo separador decimal (coma o punto) y sin separador de miles.`);
    else {
      // Texto en un ensayo numérico: se compara con una referencia de texto si la
      // hay; si no, lo decide el revisor.
      const t = e.valor.trim();
      const esperado = texto(espec.nominal) ?? texto(espec.limiteInf) ?? texto(espec.limiteSup);
      return { ...out, valorTexto: t, veredicto: esperado ? (t.toLowerCase() === esperado ? "cumple" : "no_cumple") : "pendiente" };
    }
  } else {
    throw new CapturaError("Ingrese el valor, las réplicas o las lecturas del ensayo.");
  }

  return {
    ...out,
    valorNumerico: valor,
    valorTexto: valor != null ? String(valor) : null,
    veredicto: veredictoNumerico(valor!, inf, sup),
  };
}

/**
 * Variables que se guardan con la captura: las de ESTA captura o ninguna. Una
 * corrección sin variables las borra (no quedan las de una captura anterior en
 * la planilla auditable; revisión r3, hallazgo 12). null = vaciar la columna.
 */
export function variablesDeCaptura(v: Record<string, number> | null | undefined): Record<string, number> | null {
  return v && Object.keys(v).length ? v : null;
}
