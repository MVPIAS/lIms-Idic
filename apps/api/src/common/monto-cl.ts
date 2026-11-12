/**
 * Lectura de montos y cantidades escritos a la chilena (fx5-c · F001).
 *
 * Regla: el punto separa miles y la coma los decimales.
 *   «184.500» → 184500 · «1.234.567,5» → 1234567,5 · «950,25» → 950,25
 * Tolerancias: un número sin coma con un solo punto que NO forma grupos de miles
 * («950.25», «184.5») se lee con el punto decimal; se aceptan el símbolo «$»,
 * «US$» y espacios. Cualquier otra cosa («1.23.4», «12a») devuelve null.
 *
 * ESPEJO EXACTO de apps/web/lib/monto-cl.ts; la prueba monto-cl.spec.ts
 * ejecuta la misma tabla sobre ambos.
 */
export function montoCl(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[\s ]/g, "").replace(/^(US\$|USD|CLP|\$)/i, "");
  if (!s) return null;
  let signo = 1;
  if (s.startsWith("-")) { signo = -1; s = s.slice(1); }
  let norm: string;
  if (s.includes(",")) {
    if (!/^(\d+|[1-9]\d{0,2}(\.\d{3})+)(,\d+)$/.test(s)) return null;
    norm = s.replace(/\./g, "").replace(",", ".");
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    norm = s.replace(/\./g, "");
  } else if (/^\d+(\.\d+)?$/.test(s)) {
    norm = s;
  } else {
    return null;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? signo * n : null;
}

/** Valor numérico para volver a un <input> en formato chileno, sin miles: «184500,5». */
export function montoAInput(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : montoCl(v);
  return n === null ? String(v) : String(n).replace(".", ",");
}

/**
 * Preprocesador para zod: si la pantalla manda el monto como texto («184.500»),
 * se lee a la chilena; un texto ilegible queda como NaN para que zod lo rechace.
 */
export function preMontoCl(v: unknown): unknown {
  if (typeof v !== "string") return v;
  if (v.trim() === "") return null;
  const n = montoCl(v);
  return n === null ? Number.NaN : n;
}
