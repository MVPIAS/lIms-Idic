/**
 * Fórmulas del catálogo heredado (STARLIMS) → motor de fórmulas del LIMS.
 *
 * El catálogo trae 755 analitos con fórmula, casi todas escritas en el
 * lenguaje de guiones del LIMS antiguo, no en el del motor (`common/formula.ts`).
 * 580 siguen el mismo patrón «por lectura»: cada lectura tiene n campos (los
 * pasos del método, `paso_metodo`), la fórmula acumula una expresión sobre
 * esos campos y el resultado es el PROMEDIO de las lecturas:
 *
 *   :IF Len(sSql)= 3; :IF Val(sSql[3,2]) <> 0 ;
 *      Acum := Acum + (( Val(sSql[1,2]) - Val(sSql[2,2])) / Val(sSql[3,2])) * 100;
 *   :ENDIF; …
 *     ⇒  ((C1 - C2) / C3) * 100       (C1..Cn = campos de la lectura, en orden)
 *
 * Aquí se traducen esas expresiones (incluidas las que usan variables
 * intermedias `form1 := …`). Lo que no sigue el patrón (guiones que leen
 * tablas, abren planillas Excel, `Acum := Acum - …`, etc.) NO se traduce: el
 * resultado queda sin fórmula y el analista ingresa el valor final, o la
 * jefatura define la fórmula para esa orden. Nunca se adivina.
 *
 * Función PURA: formula-legado.spec.ts.
 */
import { validarFormula } from "../common/formula";

export interface Traduccion {
  /** expresión del motor, o null si no se pudo traducir */
  expr: string | null;
  /** «motor» = ya estaba en la sintaxis del motor; «legado» = traducida; null = sin fórmula aplicable */
  origen: "motor" | "legado" | null;
  /** nº de campos por lectura (C1..Cn); 0 si la fórmula no usa campos */
  nCampos: number;
  /** por qué no se tradujo (para mostrarlo en la captura) */
  motivo?: string;
}

/** Variables que la captura pone a disposición de una fórmula del motor. */
export const VARIABLES_CAPTURA = ["RN", "REPLICAS", "PROMEDIO", "DE", "CV", "N"];

const VAL_CAMPO = /val\s*\(\s*ssql\s*\[\s*(\d+)\s*,\s*2\s*\]\s*\)/gi;

/** C1..Cn usados por una expresión del motor (para saber cuántos campos pide). */
export function camposDe(expr: string): number {
  let max = 0;
  for (const m of expr.matchAll(/\bC(\d+)\b/g)) max = Math.max(max, Number(m[1]));
  return max;
}

export function traducirFormula(texto: string | null | undefined): Traduccion {
  const t = String(texto ?? "").trim();
  if (!t) return { expr: null, origen: null, nCampos: 0 };

  // 1. ¿Ya es una fórmula del motor? (RN, RN1.., PROMEDIO, C1.. o variables libres)
  if (!/[:;\[\]"]/.test(t)) {
    const v = validarFormula(t);
    if (v.ok) return { expr: t, origen: "motor", nCampos: camposDe(t) };
  }

  // 2. Patrón «por lectura» del LIMS antiguo.
  // Los comentarios de SSL van de «/*» al siguiente «;».
  const sinComentarios = t.replace(/\/\*[^;]*;/g, " ");
  const sentencias = sinComentarios.split(";").map((s) => s.trim()).filter(Boolean);
  const locales = new Map<string, string>();
  let principal: string | null = null;
  for (const s of sentencias) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*([\s\S]+)$/.exec(s);
    if (!m) continue;
    const nombre = m[1];
    const valor = m[2].trim();
    if (/^acum$/i.test(nombre)) {
      // «Acum := 0»: inicialización o rama de guarda (denominador ≤ 0). El
      // motor ya rechaza la división por cero, que es lo más seguro.
      if (/^0+(\.0*)?$/.test(valor)) continue;
      const suma = /^acum\s*\+\s*([\s\S]+)$/i.exec(valor);
      if (!suma || principal !== null)
        return { expr: null, origen: null, nCampos: 0, motivo: "La fórmula del sistema anterior acumula de una forma que no se traduce automáticamente." };
      principal = suma[1];
    } else {
      locales.set(nombre.toLowerCase(), valor);
    }
  }
  if (principal === null)
    return { expr: null, origen: null, nCampos: 0, motivo: "La fórmula del sistema anterior no es de cálculo por lecturas (usa rutinas o tablas propias)." };

  // Sustituye variables intermedias (form1 := …) por su expresión, en orden.
  let expr = principal;
  for (let i = 0; i < 5; i++) {
    let cambio = false;
    for (const [n, v] of locales) {
      const re = new RegExp(`\\b${n}\\b`, "gi");
      if (re.test(expr)) {
        expr = expr.replace(re, `(${v})`);
        cambio = true;
      }
    }
    if (!cambio) break;
  }

  if (/val\s*\(\s*ssql\s*\[\s*\d+\s*,\s*1\s*\]/i.test(expr))
    return { expr: null, origen: null, nCampos: 0, motivo: "La fórmula del sistema anterior usa el código del campo, no su valor." };
  expr = expr.replace(VAL_CAMPO, (_m, i) => `C${Number(i)}`);
  expr = expr.replace(/\bsqrt\s*\(/gi, "RAIZ(").replace(/\s+/g, " ").trim();

  const v = validarFormula(expr);
  const soloCampos = (v.variables ?? []).every((x) => /^C\d+$/i.test(x));
  if (!v.ok || !soloCampos)
    return { expr: null, origen: null, nCampos: 0, motivo: "La fórmula del sistema anterior no se pudo traducir con seguridad." };
  return { expr, origen: "legado", nCampos: camposDe(expr) };
}
