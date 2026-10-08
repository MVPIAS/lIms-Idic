/**
 * Motores de PRESIÓN · validados contra los Excel reales del LMT.
 *   ITP02 · manómetro vs manómetro patrón (caso P-808)       → 66/66 valores idénticos
 *   ITP01 · manómetro patrón con balanza de pesos muertos (P-807) → 229/229 valores idénticos
 */
import { avgN, mean, xr, xru, type Datos, type Opciones } from "./util";

/** Densidad del medio de transmisión, kg/m³ (Tabla de resultados L26). */
export const DENSIDAD_MEDIO: Record<string, number> = { Alcohol: 789, Aceite: 866, "Nitrógeno": 1.15 };

/**
 * ITP02 · Tabla de resultados B58:L68.
 * Opciones: `der` (P2) suma la deriva del patrón; `dh` (P3) aplica el divisor √3 a la diferencia de altura.
 * `d.mcm` es la mejor capacidad de medición del patrón (bar).
 */
export function calcularITP02(d: Datos, opt: Opciones = {}) {
  const fac = d.fac, res = d.tipo === "Digital" ? d.div / 2 : d.div;
  const t = xr(mean(d.temp) - d.et, 1), h = xr(mean(d.hum) - d.eh, 1), patm = xr(mean(d.patm) - d.ebar, 1);
  const rair = ((0.34848 * patm) - ((0.009 * h) * Math.exp(0.061 * t))) / (273.15 + t);
  const rfl = DENSIDAD_MEDIO[d.medio];
  const mcm = d.mcm ?? 0.05;
  let uDh = ((rfl - rair) * d.gl * (d.uAlt / 2) * 0.00001) * fac;
  if (opt.dh) uDh = uDh / Math.sqrt(3);
  const presB = d.pres * fac, uresP = d.tipo === "Análogo" ? presB / Math.sqrt(3) : presB / Math.sqrt(12);
  const uder = opt.der ? (d.der * fac) * 1 / Math.sqrt(3) : 0;
  const f0 = Math.abs(d.pi0 - d.pts[0].nom);
  const dhm = (d.hI - d.hP) / 1000, corrAlt = ((dhm * rfl * d.gl * 0.00001) / 10) * fac;
  const rows = d.pts.map((p: any) => {
    const B = mean([p.asc, p.desc]) * fac - (p.perr * fac), C = (p.nom / fac) * fac, Dm = C - B, E = Math.abs(p.desc - p.asc) * fac;
    const G = Math.sqrt(1 / 3 * (((2 * res) / 2) ** 2)), H = Math.sqrt(1 / 3 * ((f0 / 2) ** 2)), I = Math.sqrt(1 / 3 * ((E / 2) ** 2)), J = p.pU * fac;
    const K = Math.sqrt(I * I + (J / 2) ** 2 + G * G + H * H + uDh * uDh + uder * uder + uresP * uresP), L = K * 2;
    return { nom: p.nom, B, C, D: Dm, E, G, H, I, J, K, L, Uc: Math.max(xr(L, 3), mcm), mcmOk: xr(L, 3) <= mcm };
  });
  return { rows, t, h, patm, rair, rfl, uDh, uresP, uder, res, f0, dhm, corrAlt, mcm };
}

/**
 * ITP01 · Tabla de resultados C63:J89 (presión generada por la balanza de pesos muertos).
 * Opción `altBal` (P10): usa la incertidumbre de altura de 1 mm del balance.
 */
export function calcularITP01(d: Datos, opt: Opciones = {}) {
  const G29 = 0.1, J7 = d.div / 2;
  const t = xr(xr(avgN(d.temp), 1) - d.et, 1), h = xr(xr(avgN(d.hum), 1) - d.eh, 1), patm = xr(avgN(d.patm) - d.ebar, 1);
  const rair = ((0.34848 * patm) - ((0.009 * h) * Math.exp(0.061 * t))) / (273.15 + t);
  const D28 = d.gl * (1 - rair / d.rhoM), tp = avgN(d.tp), G28 = 1 + d.alpha * (tp - 20), L22 = (d.hP - d.hI) / 1000;
  const p0 = d.pts[0].r, I63 = Math.max(Math.abs(p0[1] - p0[0]), Math.abs(p0[3] - p0[2]), 0);
  const uder = (d.der * G29) / (2 * Math.sqrt(3));
  const uAltDiv = opt.altBal ? (1 / 1000) : (d.uAlt / 2);
  const rows = d.pts.map((p: any, i: number) => {
    const m = p.comp.reduce((s: number, k: string) => s + (d.pieces[k] || 0), 0);
    const K = p.nom / G29;
    const L = d.rhoN2 * ((((patm * 0.001) + K) * (d.tr + 273.15)) / (d.patmRef * (t + 273.15)));
    const Jb = m === 0 ? 0 : ((m * D28 / (d.A0 * (1 + d.lam * K) * G28)) + ((L - rair) * d.gl * L22)) / 100000;
    const B = Jb * G29, r = p.r;
    const C = i === 0 ? mean(r) : ((r[0] - p0[0]) + (r[2] - p0[2]) + (r[1] - p0[0]) + (r[3] - p0[2])) / 4;
    const Dm = C - B;
    const F = 1 / 2 * (Math.abs((r[1] - p0[0]) - (r[0] - p0[0])) + Math.abs((r[3] - p0[2]) - (r[2] - p0[2])));
    const Gb = Math.max(Math.abs((r[2] - p0[2]) - (r[0] - p0[0])), Math.abs((r[3] - p0[2]) - (r[1] - p0[0])));
    const Hb = Math.max(Math.abs(0 - (r[0] - p0[0])), Math.abs(0 - (r[1] - p0[1]))); // serie adicional vacía (Excel, hallazgo P9)
    const uA = ((L - rair) * d.gl * uAltDiv * 0.00001) * G29;
    const uB = Math.sqrt(1 / 3 * ((Gb / 2) ** 2)), uC = Math.sqrt(1 / 3 * ((F / 2) ** 2)), uD = Math.sqrt(1 / 3 * ((I63 / 2) ** 2)), uE = Math.sqrt(1 / 3 * (((2 * J7) / 2) ** 2));
    const Jd = Jb * d.urel, Iu = d.umin, Fp = (Jd < Iu ? Iu : Jd) * G29;
    const Gc = Math.sqrt(uA * uA + uB * uB + uC * uC + uD * uD + uE * uE + uder * uder + (Fp / 2) ** 2), Hc = Gc * 2;
    return { nom: p.nom, m, K, L, Jb, B, C, D: Dm, E: 0, F, G: Gb, H: Hb, uA, uB, uC, uD, uE, Fp, Gc, Hc, Jd, Iu, Uc: xru(Hc, 4) };
  });
  const last = rows[rows.length - 1].B;
  rows.forEach((r: any) => (r.E = r.D / last * 100));
  return { rows, t, h, patm, rair, D28, tp, G28, L22, I63, uder, J7 };
}
