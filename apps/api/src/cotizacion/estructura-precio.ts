/**
 * Estructura oficial del precio de un servicio del IDIC (lista de precios 2026,
 * «LISTA DE PRECIO 2026 (COSTOS ENSAYOS)», 22-10-2026). Regla PURA, probada en
 * estructura-precio.spec.ts.
 *
 *   costo indirecto (CI)  = % CI del costo directo (CD)          · 20 %
 *   costo total (CT)      = CD + CI                               · precio Ejército
 *   recargo               = % recargo del CT                      · 30 %
 *   neto                  = CT + recargo                          · precio particular sin IVA
 *   IVA                   = % IVA del neto                        · 19 %
 *   precio particular     = neto + IVA
 *
 * Los porcentajes son parámetros (`circuito_cotizacion.cfa_pct`,
 * `.margen_particular_pct` e `.iva_pct`). Como la planilla del IDIC, cada
 * importe se calcula sin redondear la cadena y se redondea al peso al mostrarlo.
 *
 * La lista 2026 se calculó HACIA ATRÁS desde el precio particular (sus 619 filas
 * cuadran con `desdePrecioParticular`): su costo directo tiene decimales que la
 * planilla oculta. Por eso, partiendo del costo directo entero que muestra la
 * lista, `desdeCostoDirecto` puede diferir en 1 peso en alguna columna.
 */

export interface PctEstructura {
  /** Costo indirecto, % del costo directo. */
  ciPct: number;
  /** Recargo del precio particular, % del costo total. */
  recargoPct: number;
  /** IVA, % del neto. */
  ivaPct: number;
}

export const PCT_OFICIAL_2026: PctEstructura = { ciPct: 20, recargoPct: 30, ivaPct: 19 };

export interface Estructura {
  costoDirecto: number;
  costoIndirecto: number;
  costoTotal: number;
  recargo: number;
  neto: number;
  iva: number;
  precioIvaIncluido: number;
}

/** Redondeo al peso, inmune al ruido binario (x,4999999 → x,5). */
export const alPeso = (x: number) => Math.round(Math.round(x * 1e6) / 1e6);

function cadena(cd: number, p: PctEstructura): Estructura {
  const ci = cd * (p.ciPct / 100);
  const ct = cd + ci;
  const recargo = ct * (p.recargoPct / 100);
  const neto = ct + recargo;
  const iva = neto * (p.ivaPct / 100);
  return {
    costoDirecto: alPeso(cd),
    costoIndirecto: alPeso(ci),
    costoTotal: alPeso(ct),
    recargo: alPeso(recargo),
    neto: alPeso(neto),
    iva: alPeso(iva),
    precioIvaIncluido: alPeso(neto + iva),
  };
}

/** Del costo directo a todas las columnas (FORM05 y simulador). */
export function desdeCostoDirecto(cd: number, p: PctEstructura = PCT_OFICIAL_2026): Estructura {
  return cadena(Number(cd) || 0, p);
}

/** Factor que lleva del costo directo al precio particular con IVA. */
export const factorParticular = (p: PctEstructura) => (1 + p.ciPct / 100) * (1 + p.recargoPct / 100) * (1 + p.ivaPct / 100);

/** Del precio particular con IVA hacia atrás (como se armó la lista 2026). */
export function desdePrecioParticular(total: number, p: PctEstructura = PCT_OFICIAL_2026): Estructura {
  return cadena((Number(total) || 0) / factorParticular(p), p);
}

const COLUMNAS: (keyof Estructura)[] = ["costoDirecto", "costoIndirecto", "costoTotal", "recargo", "neto", "iva", "precioIvaIncluido"];

/**
 * ¿Los siete importes mostrados (redondeados al peso) salen de UN costo directo
 * real con la fórmula? Cada columna es k·CD; basta con que los intervalos
 * [valor ± 0,5] / k tengan un punto en común.
 */
export function cuadraConFormula(e: Estructura, p: PctEstructura = PCT_OFICIAL_2026): boolean {
  const ci = p.ciPct / 100;
  const r = p.recargoPct / 100;
  const iv = p.ivaPct / 100;
  const k: Record<keyof Estructura, number> = {
    costoDirecto: 1,
    costoIndirecto: ci,
    costoTotal: 1 + ci,
    recargo: (1 + ci) * r,
    neto: (1 + ci) * (1 + r),
    iva: (1 + ci) * (1 + r) * iv,
    precioIvaIncluido: (1 + ci) * (1 + r) * (1 + iv),
  };
  let lo = -Infinity;
  let hi = Infinity;
  for (const c of COLUMNAS) {
    if (!(k[c] > 0)) {
      if (Math.abs(e[c]) > 0.5) return false;
      continue;
    }
    lo = Math.max(lo, (e[c] - 0.5) / k[c]);
    hi = Math.min(hi, (e[c] + 0.5) / k[c]);
  }
  return lo <= hi + 1e-9;
}

/** Columnas en que dos estructuras difieren, con la diferencia (b − a). */
export function diferencias(a: Estructura, b: Estructura): Partial<Record<keyof Estructura, number>> {
  const d: Partial<Record<keyof Estructura, number>> = {};
  for (const c of COLUMNAS) if (a[c] !== b[c]) d[c] = b[c] - a[c];
  return d;
}
