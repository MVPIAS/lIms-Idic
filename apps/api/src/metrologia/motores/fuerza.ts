/**
 * Motores de FUERZA · NCh 2598/1, validados contra los Excel reales del LMT.
 *   ITF01 · máquina de ensayos con transductor mV/V (caso F-1556) → 195/195 valores idénticos
 *   ITF03 · dinamómetro con pesos muertos (caso F-1563)          → 185/185
 */
import { mean, mx, nums, stdev, xr, xru, type Datos, type Opciones } from "./util";

/** Límites NCh 2598/1 por clase: [clase, q, b, v, a, f0] en %. */
export const CLASES_NCH2598: number[][] = [
  [0.5, 0.5, 0.5, 0.75, 0.25, 0.05], [1, 1, 1, 1.5, 0.5, 0.1], [2, 2, 2, 3, 1, 0.2], [3, 3, 3, 4.5, 1.5, 0.3],
];
/** Clase que cumple un criterio (col = 1 q, 2 b, 3 v, 4 a, 5 f0). `textBug` reproduce el «4» como texto del Excel (F4). */
export function claseDe(x: number, col: number, textBug = false): number | string {
  const a = Math.abs(x), CLS = CLASES_NCH2598;
  if (a > CLS[3][col]) return textBug ? "4" : 4;
  if (a > CLS[2][col]) return 3;
  if (a > CLS[1][col]) return 2;
  if (a > CLS[0][col]) return 1;
  return 0.5;
}

/**
 * ITF01 · conversión mV/V → kgf con 2 curvas del transductor; q, b, a, f0 y presupuesto D84:P93.
 * Opciones: `absF0` (F3) error de cero en valor absoluto; `derSet` (F1/T4) deriva de la curva usada;
 * `fixCls` (F4) clase «4» numérica.
 */
export function calcularITF01(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3);
  const poly = (x: number, c: number[]) => x * c[0] + x ** 2 * c[1] + x ** 3 * c[2];
  const f0vals = nums(d.f0), M41 = (opt.absF0 ? Math.max(...f0vals.map(Math.abs)) : Math.max(...f0vals)) / d.cap * 100;
  const uder = Math.max(...d.der) / S3;
  const rows: any[] = d.pts.map((p: any) => {
    const W = p.nom * d.k, set = W < d.thr ? d.c1 : d.c2;
    const kgf: number[] = p.s.map((x: number, k: number) => poly(x - d.zero[k], set) / d.F21);
    const H = mean(kgf), I = p.nom - H, L = (p.nom - H) / H * 100, M = Math.abs((Math.max(...kgf) - Math.min(...kgf)) / H * 100), O = p.res / p.nom * 100;
    const ud = opt.derSet ? (W < d.thr ? d.der[0] : d.der[1]) / S3 : uder, up = p.UP / 2, F = Math.sqrt(up * up + ud * ud);
    let G = stdev(kgf);
    G = G === 0 ? 0.0000000001 : G / S3 / (p.nom / 100);
    const Ha = O / (2 * S3), Iv = 0, J = M41 / (2 * S3), K = Math.sqrt(G * G + Ha * Ha + Iv * Iv + J * J), Lc = Math.sqrt(F * F + K * K), Mu = 2 * Lc;
    const cmc = W <= d.thr ? d.cmc1 : d.cmc2, P = Mu < cmc ? cmc : Mu;
    return {
      nom: p.nom, W, set: W < d.thr ? 1 : 2, kgf, D: kgf[0], E: kgf[1], F_: kgf[2], H, I, L, M, O, up, uder: ud, Fp: F, G, Ha, J, K, Lc, Mu, P, cmc,
      cq: claseDe(L, 1, !opt.fixCls), cb: claseDe(M, 2), ca: claseDe(O, 4), cf: claseDe(M41, 5), pcl: p.pcl,
    };
  });
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    r.Lmax = mx([r.cq, r.cb, r.ca, r.cf]);
    r.Mcum = i === rows.length - 1 ? r.Lmax : (r.Lmax > rows[i + 1].Mcum ? r.Lmax : rows[i + 1].Mcum);
    r.N = r.Mcum > 3 ? "N/C" : r.Mcum;
    r.cls = r.N < r.pcl ? r.pcl : r.N;
  }
  const tA = xr(mean(nums(d.temp)), 1), hA = xr(mean(nums(d.hum)), 1);
  return { rows, M41, uder, tA, hA, M9: xru(tA - d.et, 1), M10: xru(hA - d.eh, 1) };
}

/**
 * ITF03 · dinamómetro con pesos muertos; control de fuerza aplicada ±0,1 % y presupuesto B62:Q71.
 * Opciones: `realMass` (F9) masas calibradas; `absF` (F8) control en valor absoluto; `units` (F10) divide por la fuerza en N.
 */
export function calcularITF03(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3), buoy = 1 - d.ra / d.rm;
  const K41 = Math.max(...nums(d.pts.at(-1).s)), I24 = Math.max(...nums(d.zero)) / K41 * 100;
  const rows: any[] = d.pts.map((p: any) => {
    const E = opt.realMass ? (p.nom + p.dev) * d.gl * buoy : (p.nom * d.gl) * buoy;
    const s = nums(p.s), J = mean(s), L = (J - E) / E * 100, M = (Math.max(...s) - Math.min(...s)) / E * 100, N = p.res / E * 100;
    const A = (E * 0.1019716) / 1, Kd = A - p.nom, Ld = (100 * Kd) / p.nom, ok = opt.absF ? Math.abs(Ld) <= 0.1 : Ld <= 0.1;
    const Dk = (p.Up / 10 ** 6) * (d.gl / d.g) * buoy;
    const den = opt.units ? E : p.nom;
    const F = (((Dk * d.J21) / 2) * 100) / den, G = ((d.der * d.J21) * 100) / den, H = Math.sqrt(F * F + G * G);
    let Jb = stdev(s);
    Jb = Jb === 0 ? 0.0000000001 : Jb / S3 / (den / 100);
    const Ka = N / (2 * S3), Lv = 0, Mf = (I24 * d.J21) / (2 * S3), Nn = Math.sqrt(Jb * Jb + Ka * Ka + Lv * Lv + Mf * Mf), P = Math.sqrt(H * H + Nn * Nn), Q = 2 * P;
    return { nom: p.nom, E, J, L, M, N, A, Kd, Ld, ok, D: Dk, F, G, H, Jb, Ka, Mf, Nn, P, Q, cq: claseDe(L, 1), cb: claseDe(M, 2), ca: claseDe(N, 4), cf: claseDe(I24, 5) };
  });
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    r.G_ = mx([r.cq, r.cb, r.ca, r.cf]);
    r.Hc = i === rows.length - 1 ? r.G_ : (r.G_ > rows[i + 1].Hc ? r.G_ : rows[i + 1].Hc);
    r.cls = r.Hc > 3 ? "N/C" : r.Hc;
  }
  const tA = xr(mean(nums(d.temp)), 1), hA = xr(mean(nums(d.hum)), 1);
  return { rows, I24, K41, tA, hA, O9: xru(tA - d.et, 1), O10: xru(hA - d.eh, 1) };
}
