/**
 * Motor GUM de metrología para la vista previa en vivo (espejo exacto del
 * backend apps/api/src/metrologia/metrologia.calc.ts). El servidor recalcula al
 * guardar; esto es solo para mostrar resultados mientras se escribe.
 */
export type Componente = { simbolo: string; nombre: string; distribucion: string; fuente: string; orden?: number };
export type Divisores = Record<string, number>;
export type Punto = { nominal: number; correccion: number; uPatron: number; deriva: number; lecturas: number[] };
export type CompCalc = Componente & { valor: number; divisor: number; ui: number };
export type PuntoCalc = Punto & {
  media: number; repetibilidad: number; referencia: number; error: number;
  uc: number; uExp: number; en: number; dentro: boolean; componentes: CompCalc[];
};

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

export function calcPunto(comps: Componente[], divs: Divisores, cond: Record<string, number>, p: Punto): PuntoCalc {
  const lect = (p.lecturas || []).map(Number).filter((x) => !Number.isNaN(x));
  const media = avg(lect);
  const rep = stdev(lect);
  const referencia = Number(p.nominal) + Number(p.correccion || 0);
  const error = media - referencia;
  const hist = lect.length >= 2 ? Math.abs(Math.max(...lect) - Math.min(...lect)) : 0;
  const src = (f: string): number =>
    f === "uPatron" ? Number(p.uPatron || 0)
    : f === "rep" ? rep
    : f === "deriva" ? Number(p.deriva || 0)
    : f === "hist" ? hist
    : Number(cond[f] || 0);
  const componentes: CompCalc[] = comps.map((c) => {
    const valor = src(c.fuente);
    const divisor = divs[c.distribucion] || 1;
    return { ...c, valor, divisor, ui: Math.abs(valor) / divisor };
  });
  const uc = Math.sqrt(componentes.reduce((a, c) => a + c.ui * c.ui, 0));
  const uExp = 2 * uc;
  const uPat = Number(p.uPatron || 0);
  const en = Math.abs(error) / Math.sqrt(uExp * uExp + uPat * uPat || 1e-30);
  const mpe = Number(cond.mpe);
  const dentro = Number.isFinite(mpe) && mpe > 0 ? Math.abs(error) + uExp <= mpe : true;
  return { ...p, media, repetibilidad: rep, referencia, error, uc, uExp, en, dentro, componentes };
}

export function calcularCalibracion(comps: Componente[], divs: Divisores, cond: Record<string, number>, puntos: Punto[]) {
  const res = puntos.map((p) => calcPunto(comps, divs, cond, p));
  const uMax = res.length ? Math.max(...res.map((r) => r.uExp)) : 0;
  const enMax = res.length ? Math.max(...res.map((r) => r.en)) : 0;
  const conforme = res.every((r) => r.dentro);
  return { puntos: res, uMax, enMax, conforme };
}

export const nd = (v: unknown) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isNaN(n) ? 0 : n; };
export const fmtN = (x: unknown, d = 3) =>
  x == null || Number.isNaN(Number(x)) ? "—" : Number(x).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });
