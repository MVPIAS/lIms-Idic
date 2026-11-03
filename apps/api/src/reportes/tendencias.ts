/**
 * Tendencias (contrato §4.5.7: «consulta en tiempo real e histórica; análisis de
 * comportamiento y detección de tendencias») · funciones PURAS, probadas en
 * tendencias.spec.ts. El controlador trae las cuentas por mes y laboratorio; aquí
 * se completan los meses sin datos, se calcula la media móvil y la pendiente de
 * la recta de mínimos cuadrados, y se dice si la serie sube, baja o está estable.
 */

export type Sentido = "sube" | "baja" | "estable" | "sin_datos";

export interface Tendencia {
  /** Pendiente de la recta (unidades de la serie por mes). */
  pendiente: number | null;
  /** Cambio relativo de la recta entre el primer y el último mes, en % de la media. */
  cambioPct: number | null;
  sentido: Sentido;
  /** Media móvil de `ventana` meses (null hasta tener la ventana completa). */
  mediaMovil: (number | null)[];
  /** Último valor fuera de la banda media ± 2 desviaciones de los meses anteriores. */
  atipico: boolean;
}

/** Meses «AAAA-MM» de `desde` a `hasta`, ambos incluidos (máximo 120). */
export function mesesEntre(desde: string, hasta: string): string[] {
  const a = /^(\d{4})-(\d{2})/.exec(desde);
  const b = /^(\d{4})-(\d{2})/.exec(hasta);
  if (!a || !b) return [];
  let y = Number(a[1]);
  let m = Number(a[2]);
  const fin = Number(b[1]) * 12 + Number(b[2]);
  const salida: string[] = [];
  while (y * 12 + m <= fin && salida.length < 120) {
    salida.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return salida;
}

/** Serie completa: cada mes con su valor o `relleno` (0 para cuentas, null para tasas). */
export function completarSerie(meses: string[], filas: { mes: string; valor: number | null }[], relleno: number | null): (number | null)[] {
  const m = new Map(filas.map((f) => [f.mes, f.valor]));
  return meses.map((x) => (m.has(x) ? m.get(x) ?? relleno : relleno));
}

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Tendencia de una serie mensual. Los null (meses sin base para una tasa) no
 * cuentan en la recta. «Estable» si la recta cambia menos de `umbralPct` % de
 * la media en todo el periodo; hacen falta al menos 3 meses con dato.
 */
export function tendencia(serie: (number | null)[], opts: { ventana?: number; umbralPct?: number } = {}): Tendencia {
  const ventana = Math.max(2, opts.ventana ?? 3);
  const umbral = opts.umbralPct ?? 10;
  const mediaMovil = serie.map((_, i) => {
    if (i + 1 < ventana) return null;
    const v = serie.slice(i + 1 - ventana, i + 1);
    if (v.some((x) => x == null)) return null;
    return redondear((v as number[]).reduce((s, x) => s + x, 0) / ventana);
  });
  const puntos = serie.map((y, x) => ({ x, y })).filter((p): p is { x: number; y: number } => p.y != null && Number.isFinite(p.y));
  if (puntos.length < 3) return { pendiente: null, cambioPct: null, sentido: "sin_datos", mediaMovil, atipico: false };
  const n = puntos.length;
  const mx = puntos.reduce((s, p) => s + p.x, 0) / n;
  const my = puntos.reduce((s, p) => s + p.y, 0) / n;
  const sxx = puntos.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const sxy = puntos.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const pendiente = sxx ? sxy / sxx : 0;
  const tramo = puntos[n - 1].x - puntos[0].x;
  const cambioPct = my !== 0 ? (pendiente * tramo * 100) / Math.abs(my) : pendiente === 0 ? 0 : null;
  const sentido: Sentido = cambioPct == null ? (pendiente > 0 ? "sube" : "baja") : Math.abs(cambioPct) < umbral ? "estable" : pendiente > 0 ? "sube" : "baja";
  // Atípico: el último dato frente a los anteriores (al menos 3).
  let atipico = false;
  if (n >= 4) {
    const prev = puntos.slice(0, -1).map((p) => p.y);
    const m = prev.reduce((s, y) => s + y, 0) / prev.length;
    const de = Math.sqrt(prev.reduce((s, y) => s + (y - m) ** 2, 0) / (prev.length - 1));
    const ultimo = puntos[n - 1].y;
    atipico = de > 0 ? Math.abs(ultimo - m) > 2 * de : ultimo !== m;
  }
  return { pendiente: redondear(pendiente, 3), cambioPct: cambioPct == null ? null : redondear(cambioPct, 1), sentido, mediaMovil, atipico };
}

/** Porcentaje 0–100 con 1 decimal; null sin denominador. */
export function porcentaje(num: number, den: number): number | null {
  return den ? Math.round((num / den) * 1000) / 10 : null;
}
