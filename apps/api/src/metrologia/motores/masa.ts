/**
 * Motores de MASA · validados contra los Excel reales del LMT.
 *   ITM02 · instrumentos de pesar (caso M-3889, balanza analítica)  → 88/88 valores idénticos
 *   ITM01 · masas patrón por comparación p-m-m-p (caso M-3859)      → 33/33 valores idénticos
 */
import { mean, stdev, xr, type Datos, type Opciones } from "./util";

/** Juego de masas E2 15884 (U, corrección y deriva en mg) · hoja «Patrones» del Excel. */
export const PATRONES_15884: Record<string, { U: number; c: number; d: number }> = {
  "20 mg E2": { U: 0.003, c: -0.004, d: 0.001 }, "50 mg E2": { U: 0.004, c: -0.001, d: 0.001 },
  "100 mg E2": { U: 0.005, c: -0.003, d: 0 }, "500 mg E2": { U: 0.008, c: -0.001, d: 0 },
  "1 g E2": { U: 0.01, c: -0.003, d: 0 }, "2 g E2": { U: 0.012, c: -0.021, d: 0.017 },
  "5 g E2": { U: 0.016, c: -0.031, d: 0.007 }, "10 g E2": { U: 0.02, c: 0.029, d: 0.02 },
  "20 g E2": { U: 0.025, c: -0.053, d: 0.021 }, "50 g E2": { U: 0.03, c: -0.05, d: 0.01 },
};
/** Mejor capacidad de medición de balanzas: [desde g, hasta g, CMC mg]. */
export const CMC_BALANZA: [number, number, number][] = [
  [0.001, 5, 0.017], [5, 10, 0.021], [10, 20, 0.026], [20, 50, 0.03], [50, 100, 0.05], [100, 200, 0.15], [200, 500, 0.26],
];

/**
 * ITM02 · Tabla de resultados B41:O51.
 * Opción `fix` (hallazgo M1): la fila de 50 g usa la deriva de su propia masa (el Excel usa la deriva promedio).
 */
export function calcularITM02(d: Datos, opt: Opciones = {}) {
  const PAT = d.pat ?? PATRONES_15884, MCM: [number, number, number][] = d.mcm ?? CMC_BALANZA;
  const S3 = 2 * Math.sqrt(3);
  const ud = d.res / S3;
  const A = d.ecc[0], eccmax = Math.max(...d.ecc.slice(1).map((v: number) => Math.abs(A - v)));
  const uecc = eccmax / S3, drest = Math.max(...d.cero) - Math.min(...d.cero), urest = drest / S3;
  const ders = d.pts.filter((p: any) => p.comp).map((p: any) => PAT[p.comp].d), derAvg = mean(ders);
  const maxNom = Math.max(...d.pts.map((p: any) => p.nom));
  const mr = MCM.find((r) => maxNom > r[0] && maxNom <= r[1]);
  const mcm = mr ? mr[2] / 1000 : 0;
  const last = d.pts.length - 1;
  const rows = d.pts.map((p: any, i: number) => {
    const P = p.comp ? PAT[p.comp] : null;
    const B = mean(p.s), C = p.nom + (P ? P.c : 0) / 1000, E = B - C;
    const F = P ? P.U / 1000 / 2 : 0;
    let G = stdev(p.s) / Math.sqrt(5);
    if (!G) G = 1e-10;
    const der = i === 0 || (i === last && !opt.fix) ? derAvg : P ? P.d : 0;
    const K = der / S3 / 1000;
    const M = Math.sqrt(F * F + G * G + ud * ud + uecc * uecc + urest * urest + K * K), O = 2 * M;
    const T = xr(O, 4), Uc = Math.max(T, mcm);
    return { nom: p.nom, comp: p.comp, C, B, E, F, G, H: ud, I: uecc, J: urest, K, der, M, O, T, Uc, mcmOk: T >= mcm, sd: stdev(p.s) };
  });
  const tAvg = xr(mean(d.temp), 1), hAvg = xr(mean(d.hum), 1);
  return { rows, eccmax, drest, derAvg, mcm, maxNom, tAvg, hAvg, tC: xr(tAvg - d.tcorr, 1), hC: xr(hAvg - d.hcorr, 1) };
}

/**
 * ITM01 · masa patrón por comparación (ciclos p-m-m-p), OIML R111.
 * Opciones: `corr` (M6) corrige T/HR/P antes de la densidad del aire; `avg` (M7) usa la ρa promedio en el empuje.
 */
export function calcularITM01(d: Datos, opt: Opciones = {}) {
  const rhoA = (t: number, h: number, p: number) => ((0.34848 * p) - ((0.009 * h) * Math.exp(0.061 * t))) / (273.15 + t);
  const cT = opt.corr ? d.T.map((x: number) => x - d.corr[0]) : d.T;
  const cH = opt.corr ? d.H.map((x: number) => x - d.corr[1]) : d.H;
  const cP = opt.corr ? d.P.map((x: number) => x - d.corr[2]) : d.P;
  const ra1 = rhoA(cT[0], cH[0], cP[0]), ra2 = rhoA(cT[1], cH[1], cP[1]), ra = mean([ra1, ra2]);
  const raC = opt.avg ? ra : ra1; // Excel usa ρa inicial (H24)
  const C = (raC - d.rho0) * ((1 / d.rhoT) - (1 / d.rhoR)); // H25
  const uRa = (Math.max(ra1, ra2) - Math.min(ra1, ra2)) / Math.sqrt(12); // L27
  const Cr: number[] = d.L.map((x: number) => xr(x * 1000, d.dec)); // lecturas en mg
  const cyc: { p1: number; m1: number; m2: number; p2: number; m: number; p: number; dI: number }[] = [];
  for (let k = 0; k + 3 < Cr.length; k += 4) {
    const m = mean([Cr[k + 1], Cr[k + 2]]), p = mean([Cr[k + 3], Cr[k]]);
    cyc.push({ p1: Cr[k], m1: Cr[k + 1], m2: Cr[k + 2], p2: Cr[k + 3], m, p, dI: m - p });
  }
  const dI = mean(cyc.map((c) => c.dI)), s = stdev(cyc.map((c) => c.dI)), n = cyc.length;
  const mc = ((d.nomR * 1000 + d.dmp) * (1 + C) + dI), dev = mc - d.nomT * 1000;
  const B97 = (d.nomR * ((d.rhoR - d.rhoT) / (d.rhoR * d.rhoT)) * uRa) ** 2;
  const C97 = (d.nomR * (raC - d.rho0)) ** 2 * ((d.urt ** 2) / (d.rhoT ** 4));
  const D97 = (d.nomR) ** 2 * (raC - d.rhoAl) * ((raC - d.rhoAl) - 2 * (d.rhoAl - d.rhoAl)) * ((d.urr ** 2) / (d.rhoR ** 4));
  const uP = d.Up / 2, uI = s / Math.sqrt(n), ud = d.res / (2 * Math.sqrt(3)), uC = Math.sqrt(B97 + C97 + D97) * 1000, uD = d.der / Math.sqrt(3);
  const uc = Math.sqrt(uP * uP + uI * uI + ud * ud + uC * uC + uD * uD), U = 2 * uc;
  const order = ["Sin clase", "M3", "M2", "M1", "F2", "F1", "E2", "E1"];
  const mpe = d.mpe[d.cls], asig = d.mpe[order[order.indexOf(d.cls) + 1]];
  let best = "--";
  for (const c of order) if (d.mpe[c] >= Math.abs(dev)) best = c;
  return { ra1, ra2, ra, C, uRa, Cr, cyc, dI, s, n, mc, dev, B97, C97, D97, uP, uI, ud, uC, uD, uc, U, mpe, asig, best, ok: U <= asig / 3, cT, cH, cP };
}
