/**
 * Motores de TEMPERATURA · validados contra los Excel reales del LMT.
 *   ITT01 · termómetro por comparación (caso T-2887)          → 49/49 valores idénticos
 *   ITT02 · caracterización de medios isotermos (baño T-2890) → 52/52
 */
import { mean, nums, stdev, xr, type Datos, type Opciones } from "./util";

/**
 * ITT01 · Tabla de resultados C34:N41.
 * Opción `fixAmb` (T1): resta el error del termohigrómetro (el Excel lo suma).
 */
export function calcularITT01(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3), S12 = Math.sqrt(12);
  const H46 = mean(nums(d.hi)) - mean(nums(d.hf));
  const tAvg = mean(nums(d.temp)), hAvg = mean(nums(d.hum));
  const tC = opt.fixAmb ? tAvg - d.et : tAvg - (d.et * -1), hC = opt.fixAmb ? hAvg - d.eh : hAvg - (d.eh * -1);
  const rows = d.pts.map((p: any) => {
    const s = nums(p.s), pp = nums(p.p);
    const G = mean(s), H = mean(pp), I = G - H; // inmersión «Total» sin corrección de columna emergente (hallazgo T2a)
    const C = stdev(s) / Math.sqrt(s.length), D = stdev(pp) / Math.sqrt(pp.length), E = d.der / (2 * S3), F = d.rad / S12, Gg = d.ax / S12;
    const Hs = d.stab / S12, Ir = d.res / (2 * S3), K = d.pU / 2, L = H46 / (2 * S3);
    const M = Math.sqrt(C * C + D * D + E * E + F * F + Gg * Gg + Hs * Hs + Ir * Ir + K * K + L * L), N = M * 2;
    return { nom: p.nom, G, H, I, C, D, E, F, Gg, Hs, Ir, K, L, M, N, Ucert: xr(N, 0), Gc: xr(G, 0), Hc: xr(H, 0) };
  });
  return { rows, H46, tAvg, tC, hAvg, hC, Lt: xr(tC, 1), Lh: xr(hC, 1) };
}

/**
 * ITT02 · baño: 16 lecturas × (display, termocupla centro, auxiliar) por punto.
 * Opción `corr` (T5a): gradiente y estabilidad con lecturas corregidas por el error de las termocuplas.
 */
export function calcularITT02(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3);
  const tE = xr(mean(nums(d.temp)), 1), hE = xr(mean(nums(d.hum)), 1), tG = tE + (d.et * -1), hG = hE + (d.eh * -1);
  const rows = d.blocks.map((b: any) => {
    const E = nums(b.E), G = nums(b.G), B = nums(b.B);
    const E42 = mean(E) - b.eE, G42 = mean(G) - b.eG;
    const Rr = E.map((e, i) => (opt.corr ? (e - b.eE) - (G[i] - b.eG) : e - G[i]));
    const grad = Math.max(Math.abs(Math.max(...Rr)), Math.abs(Math.min(...Rr)));
    const AA = E.map((e) => (opt.corr ? E42 - (e - b.eE) : E42 - e)).concat(G.map((x) => (opt.corr ? G42 - (x - b.eG) : G42 - x)));
    const stab = Math.abs(Math.max(Math.abs(Math.max(...AA)), Math.abs(Math.min(...AA))));
    const Bm = mean(B), C = E42, D = Bm - C;
    const uE = stdev(B) / Math.sqrt(B.length), uF = d.res / (2 * S3), uG = d.pU / 2, uH = d.der / (2 * S3), uI = grad / S3, uJ = stab / S3, uK = 0;
    const L = Math.sqrt(uE * uE + uF * uF + uG * uG + uH * uH + uI * uI + uJ * uJ + uK * uK), M = 2 * L;
    return { nom: b.nom, B: Bm, C, D, E: uE, F: uF, G: uG, H: uH, I: uI, J: uJ, K: uK, L, M, E42, G42, grad, stab, sp: G42 - E42 };
  });
  return { rows, tE, hE, tG, hG, Kt: xr(tG, 1) };
}
