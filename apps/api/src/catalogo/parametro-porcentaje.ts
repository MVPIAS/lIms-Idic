/**
 * Parámetros numéricos (porcentajes) de «Parámetros del sistema» · reglas PURAS
 * (sin BD), probadas en parametro-porcentaje.spec.ts.
 *
 * Hoy: tasa de internación (`bpch_tasa.tasa_pct`, IDIC-PG 24 Anexo 03; 1,5 %
 * según lo levantado) e IVA aplicado a la tasa (`bpch_tasa.iva_pct`, 19 %).
 * Se guardan en `parametro_sistema.valor` como texto con punto decimal («1.5»),
 * que es lo que lee BpchComunService; en pantalla se muestran con coma.
 */

export interface DefPorcentaje {
  categoria: string;
  codigo: string;
  /** ¿Admite 0? (la tasa no: sin tasa no hay cobro; el IVA sí). */
  admiteCero: boolean;
}

export const PORCENTAJES: DefPorcentaje[] = [
  { categoria: "bpch_tasa", codigo: "tasa_pct", admiteCero: false },
  { categoria: "bpch_tasa", codigo: "iva_pct", admiteCero: true },
];

/** Categorías cuyo `valor` solo cambia por la acción con motivo e historial. */
export const CATEGORIAS_CON_HISTORIAL = [...new Set(PORCENTAJES.map((p) => p.categoria))];

export const defPorcentaje = (categoria: string, codigo: string) =>
  PORCENTAJES.find((p) => p.categoria === categoria && p.codigo === codigo) ?? null;

/**
 * Lee un porcentaje escrito en pantalla: admite coma o punto decimal y el
 * signo «%» al final («1,5», «1.5», «19 %»). No admite separador de miles.
 * Devuelve NaN si no es un número.
 */
export function leerPorcentaje(v: unknown): number {
  if (typeof v === "number") return v;
  const t = String(v ?? "").trim().replace(/\s*%$/, "").trim();
  if (!/^\d{1,3}([.,]\d{1,4})?$/.test(t)) return NaN;
  return Number(t.replace(",", "."));
}

/** Errores del nuevo valor (lista vacía = válido). */
export function erroresPorcentaje(def: DefPorcentaje, valor: number, motivo: string | null | undefined): string[] {
  const e: string[] = [];
  if (!Number.isFinite(valor)) e.push("Escriba el porcentaje como número, con coma decimal (p. ej. 1,5).");
  else {
    if (valor < 0 || valor > 100) e.push("El porcentaje debe estar entre 0 y 100.");
    else if (valor === 0 && !def.admiteCero) e.push("La tasa de internación no puede ser 0.");
    if (Math.abs(valor * 10000 - Math.round(valor * 10000)) > 1e-6) e.push("Como máximo 4 decimales.");
  }
  if ((motivo ?? "").trim().length < 5) e.push("Indique el motivo del cambio (mínimo 5 caracteres).");
  return e;
}

/** Texto con el que se guarda (punto decimal, sin ceros sobrantes). */
export const valorGuardado = (n: number) => String(Number(n.toFixed(4)));
