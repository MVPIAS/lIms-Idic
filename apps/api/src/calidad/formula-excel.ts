/**
 * Fórmulas importadas desde una planilla Excel (contrato §4.3.4) · funciones
 * PURAS, probadas en formula-excel.spec.ts.
 *
 * La planilla tiene una fila de cabecera y una fila por analito:
 *
 *   | Método | Analito | Fórmula             | C1 masa (g) | C2 volumen (mL) | C3 normalidad |
 *   | 403    | PROT    | =(E2*F2*1,4)/D2     |      1,0    |       12,3      |      0,1      |
 *
 * La fórmula puede ser una fórmula de Excel de esa misma fila (las celdas se
 * traducen a la variable que nombra la cabecera de su columna: E2 → C2) o un
 * texto con la sintaxis del motor («(C2*C3*1,4)/C1»). Las funciones de Excel
 * se traducen a las del motor (AVERAGE/PROMEDIO → PROMEDIO, SQRT/RAIZ → RAIZ…)
 * y el resultado se valida con el motor de fórmulas antes de guardarlo.
 */
import { validarFormula } from "../common/formula";

/** Letra de columna → índice (A = 0). */
export function indiceColumna(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function letraColumna(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Variable que declara una cabecera («C1 masa (g)» → C1; «RN2» → RN2; «factor» → factor); null si no es una variable. */
export function variableDeCabecera(cabecera: string): string | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\b/.exec(cabecera ?? "");
  if (!m) return null;
  const v = m[1];
  if (/^(C|RN)\d+$/i.test(v)) return v.toUpperCase();
  // Solo identificadores de una palabra (no «Fórmula», «Método»…): la cabecera entera debe ser el nombre.
  return cabecera.trim() === v ? v : null;
}

const FUNCIONES_EXCEL: Record<string, string> = {
  AVERAGE: "PROMEDIO",
  PROMEDIO: "PROMEDIO",
  SUM: "SUMA",
  SUMA: "SUMA",
  MIN: "MIN",
  MAX: "MAX",
  ABS: "ABS",
  SQRT: "RAIZ",
  RAIZ: "RAIZ",
  LOG10: "LOG",
  LOG: "LOG",
  LN: "LN",
  POWER: "POTENCIA",
  POTENCIA: "POTENCIA",
  ROUND: "REDONDEAR",
  REDONDEAR: "REDONDEAR",
};

export interface FormulaTraducida {
  formula: string | null;
  error: string | null;
}

/**
 * Traduce la fórmula de una fila. `variables` da, por índice de columna, la
 * variable de su cabecera (null si la columna no es una variable).
 */
export function formulaDesdeExcel(texto: string, variables: (string | null)[]): FormulaTraducida {
  let t = String(texto ?? "").trim().replace(/^=/, "").trim();
  if (!t) return { formula: null, error: "Sin fórmula." };
  if (/!/.test(t)) return { formula: null, error: "La fórmula usa otra hoja: solo se admiten celdas de la misma fila." };
  if (/"/.test(t)) return { formula: null, error: "La fórmula usa textos: solo se admiten cálculos numéricos." };
  // Separador de argumentos «;» (Excel en español escrito a mano): la coma es decimal.
  if (t.includes(";")) t = t.replace(/(\d),(\d)/g, "$1.$2").replace(/;/g, ",");
  // Sin «;», una coma entre dígitos fuera de los argumentos de una función es decimal («(C1*1,4)/C2»).
  else t = comasDecimales(t);
  t = t.replace(/\$/g, "");
  const faltan: string[] = [];
  const variable = (col: string) => {
    const v = variables[indiceColumna(col)] ?? null;
    if (!v) faltan.push(col);
    return v ?? col;
  };
  // Una sola pasada: rangos A2:C2 → C1,C2,C3 y celdas E2 → variable de la columna E.
  // Un «C1» o «RN2» cuya columna no es variable se deja tal cual (sintaxis del motor).
  t = t.replace(/\b([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?\b/gi, (m, c1: string, _f1, c2?: string) => {
    if (c2) {
      const a = indiceColumna(c1);
      const b = indiceColumna(c2);
      const cols: string[] = [];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) cols.push(variable(letraColumna(i)));
      return cols.join(",");
    }
    if (!variables[indiceColumna(c1)] && /^(C|RN)\d+$/i.test(m)) return m.toUpperCase();
    return variable(c1);
  });
  if (faltan.length) return { formula: null, error: `La columna ${[...new Set(faltan)].join(", ")} no tiene variable en la cabecera (C1, C2… o un nombre).` };
  // Funciones de Excel → motor.
  let desconocida: string | null = null;
  t = t.replace(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g, (_, f: string) => {
    const m = FUNCIONES_EXCEL[f.toUpperCase()];
    if (!m) desconocida = f;
    return `${m ?? f}(`;
  });
  if (desconocida) return { formula: null, error: `La función ${desconocida} de Excel no está disponible en el LIMS.` };
  const v = validarFormula(t);
  if (!v.ok) return { formula: null, error: v.error ?? "Fórmula no válida." };
  return { formula: t.replace(/\s+/g, ""), error: null };
}

/** Coma decimal entre dígitos cuando no está separando argumentos de una función. */
function comasDecimales(t: string): string {
  const pila: boolean[] = []; // true = paréntesis de una función
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "(") pila.push(/[A-Za-z0-9_]$/.test(t.slice(0, i).trimEnd()) && /[A-Za-z_][A-Za-z0-9_.]*$/.test(t.slice(0, i).trimEnd()));
    else if (ch === ")") pila.pop();
    else if (ch === "," && !pila[pila.length - 1] && /\d/.test(t[i - 1] ?? "") && /\d/.test(t[i + 1] ?? "")) {
      out += ".";
      continue;
    }
    out += ch;
  }
  return out;
}

export interface FilaFormula {
  fila: number;
  metodo: string;
  analito: string;
  formulaExcel: string;
  formula: string | null;
  error: string | null;
}

/**
 * Lee la planilla (filas de texto; las fórmulas de celda vienen con «=»).
 * Columnas obligatorias por nombre: Método, Analito y Fórmula.
 */
export function filasDePlanilla(filas: string[][]): { filas: FilaFormula[]; error: string | null } {
  if (filas.length < 2) return { filas: [], error: "La planilla no tiene filas de datos." };
  const cab = filas[0];
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const iM = cab.findIndex((c) => /^metodo/.test(norm(c)));
  const iA = cab.findIndex((c) => /^analito/.test(norm(c)));
  const iF = cab.findIndex((c) => /^formula/.test(norm(c)));
  if (iM < 0 || iA < 0 || iF < 0) return { filas: [], error: "La cabecera debe tener las columnas «Método», «Analito» y «Fórmula» (use la plantilla)." };
  const variables = cab.map((c, i) => (i === iM || i === iA || i === iF ? null : variableDeCabecera(c)));
  const salida: FilaFormula[] = [];
  for (let n = 1; n < filas.length; n++) {
    const f = filas[n];
    const metodo = (f[iM] ?? "").trim();
    const analito = (f[iA] ?? "").trim();
    const formulaExcel = (f[iF] ?? "").trim();
    if (!metodo && !analito && !formulaExcel) continue;
    const tr = formulaExcel ? formulaDesdeExcel(formulaExcel, variables) : { formula: null, error: "Sin fórmula." };
    salida.push({ fila: n + 1, metodo, analito, formulaExcel, formula: tr.formula, error: !metodo || !analito ? "Indique el método y el analito." : tr.error });
  }
  return { filas: salida, error: salida.length ? null : "La planilla no tiene filas de datos." };
}
