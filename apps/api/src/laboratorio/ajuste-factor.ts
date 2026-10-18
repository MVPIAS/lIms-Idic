/**
 * Ajuste del factor de un ensayo ya registrado en la OT · LIMS IDIC.
 * Regla PURA (sin BD): ajuste-factor.spec.ts. La usa
 * PATCH /flujo/resultado/:id/factor (también con «todo el método»).
 *
 * Nunca se muestra un factor que no se aplicó (revisión r3, hallazgo 9):
 *  · sin valor capturado → se fija el factor (se aplicará al capturar);
 *  · con lecturas o réplicas guardadas → se RECALCULA el resultado desde ellas
 *    con el factor nuevo (fórmula, promedio, veredicto);
 *  · con el valor antes del factor guardado (y sin lecturas ni réplicas) → se
 *    recalcula desde ese valor;
 *  · con un valor ingresado directo (o una captura antigua sin datos de
 *    origen) → el factor NO se aplica y el ensayo se devuelve como omitido con
 *    el motivo: su resultado y su factor quedan como estaban.
 */
import { calcularCaptura, CapturaError, type CalculoCaptura } from "./captura-estandar";
import { aplicarFactor, expresionConFactor, type Factor } from "./factor";
import { traducirFormula } from "./formula-legado";
import { veredictoNumerico } from "./veredicto";
import type { TipoDato } from "./especificacion";

export interface ResultadoParaFactor {
  tipoDato?: string | null;
  limiteInf?: string | null;
  nominal?: string | null;
  limiteSup?: string | null;
  formula?: string | null;
  valorSinFactor?: unknown;
  valorNumerico?: unknown;
  valorTexto?: string | null;
  resultadoFinal?: unknown;
  promedio?: unknown;
  replicas?: unknown;
  lecturas?: unknown;
  variables?: unknown;
}

/** Campos del resultado que cambian al recalcularlo con el factor nuevo. */
export type DatosRecalculo = Partial<Omit<CalculoCaptura, "observacion" | "factorAplicado">>;

export type PlanFactor =
  | { accion: "solo_factor" }
  | { accion: "recalcular"; datos: DatosRecalculo }
  | { accion: "omitir"; motivo: string };

const lleno = (v: unknown) => v != null && String(v).trim() !== "";
const numeros = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : [];
const objeto = (v: unknown): Record<string, number> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length ? (v as Record<string, number>) : undefined;
const num = (v?: string | null) => (v != null && /^\s*[+-]?(\d+([.,]\d+)?|[.,]\d+)\s*$/.test(v) ? Number(v.replace(",", ".")) : null);

export const MOTIVO_VALOR_DIRECTO =
  "El valor se ingresó directo (sin réplicas ni lecturas): el factor no se aplica a este resultado y se deja como estaba. Si corresponde, vuelva a capturarlo con las réplicas o lecturas.";

/** Qué hacer con un ensayo al cambiar su factor por `nuevo` (null = quitarlo). */
export function planAjusteFactor(r: ResultadoParaFactor, nuevo: Factor | null): PlanFactor {
  const tipoDato: TipoDato = r.tipoDato === "atributo" ? "atributo" : "numerico";
  if (tipoDato === "atributo") return { accion: "solo_factor" };
  const tieneValor = lleno(r.valorNumerico) || lleno(r.valorTexto) || lleno(r.resultadoFinal) || lleno(r.promedio);
  if (!tieneValor) return { accion: "solo_factor" };

  const espec = { tipoDato, limiteInf: r.limiteInf, nominal: r.nominal, limiteSup: r.limiteSup, formula: r.formula, factor: nuevo };
  const lecturas = Array.isArray(r.lecturas) && r.lecturas.length ? (r.lecturas as Record<string, number>[]) : null;
  const replicas = numeros(r.replicas);
  if (lecturas || replicas.length) {
    try {
      const c = calcularCaptura(espec, lecturas ? { lecturas, variables: objeto(r.variables) } : { replicas, variables: objeto(r.variables) });
      const { observacion: _o, factorAplicado: _f, lecturas: lect, ...resto } = c;
      // Las lecturas se reescriben solo si el cálculo salió de ellas.
      const datos: DatosRecalculo = lect ? { ...resto, lecturas: lect } : resto;
      return { accion: "recalcular", datos };
    } catch (e) {
      if (e instanceof CapturaError) return { accion: "omitir", motivo: `No se pudo recalcular con el factor nuevo: ${e.message}` };
      throw e;
    }
  }
  if (r.valorSinFactor != null && Number.isFinite(Number(r.valorSinFactor))) {
    const valor = aplicarFactor(Number(r.valorSinFactor), nuevo);
    const expr = r.formula ? traducirFormula(r.formula).expr : null;
    return {
      accion: "recalcular",
      datos: {
        valorNumerico: valor,
        valorTexto: String(valor),
        resultadoFinal: valor,
        formulaAplicada: expr || nuevo ? expresionConFactor(expr ?? "PROMEDIO(RN)", nuevo) : null,
        veredicto: veredictoNumerico(valor, num(r.limiteInf), num(r.limiteSup)),
      },
    };
  }
  return { accion: "omitir", motivo: MOTIVO_VALOR_DIRECTO };
}
