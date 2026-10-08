/**
 * Motores de LONGITUD · validados contra los Excel reales del LMT.
 *   ITL01 · pie de metro (caso L-4359)  → 98/98 valores idénticos
 *   ITL02 · micrómetro (caso L-4377)    → 64/64
 *   ITL06 · regla graduada (L-4352)     → 60/60
 *   ITL07 · flexómetro 30 m (L-4351)    → 236/236
 */
import { avgN, mean, nums, num, stdev, xr, xru, type Datos, type Opciones } from "./util";

/**
 * ITL01 · Tabla de resultados B56:J65 y balance A74:J85.
 * Opción `fixT` (L1): convierte a número las temperaturas escritas como texto («19,,8»).
 */
export function calcularITL01(d: Datos, opt: Opciones = {}) {
  const temps = d.temp.map((v: any) => (opt.fixT && typeof v === "string" ? num(v.replace(",,", ",")) : v));
  const Ta = avgN(temps), Tc = Ta + (d.et * -1), HRa = avgN(d.hum), HRc = HRa + (d.eh * -1);
  const tn = nums(temps), dT = Math.max(...tn) - Math.min(...tn);
  const coefT = dT === 0 ? 0 : 0.0000115 * dT; // I78
  const Up = Math.max(...d.pU); // C56 = F74
  const par = Math.max(...d.par) - Math.min(...d.par); // K37
  const ures = d.div === 0.01 ? d.res / 2 / Math.sqrt(3) : d.res / Math.sqrt(3); // J76
  const uep = par / 2 / Math.sqrt(3); // J77
  const parMu = ({ 0.01: 0, 0.02: (30 * 0.1 * 0.02) / (340 * 3) * 1000, 0.05: (30 * 0.1 * 0.05) / (340 * 3) * 1000 } as Record<number, number>)[d.div];
  const upar = (parMu === undefined ? 0 : parMu) / 1000 / Math.sqrt(3); // J79
  const uder = Math.max(...d.pDer) / Math.sqrt(3); // J80
  const rows = d.pts.map((p: any) => {
    const s = nums(p.s), D = mean(s), E = D - p.nom, F = E * -1;
    let G = stdev(s);
    G = G === 0 ? 0.00000000001 : G / Math.sqrt(3);
    const uDt = p.nom * coefT / Math.sqrt(3);
    const I = Math.sqrt((Up / 2) ** 2 + G * G + uDt * uDt + ures * ures + uep * uep + upar * upar + uder * uder), J = 2 * I;
    return { nom: p.nom, B: p.nom, C: Up, D, E, F, G, H: par, I, J, uDt, Uc: xru(J, 2), sd: stdev(s) };
  });
  const maxNom = Math.max(...d.pts.map((p: any) => p.nom));
  const intE: number[] = d.int.slice(1).map((v: number) => v - d.int[0]);
  const intIdx = intE.map(Math.abs).indexOf(Math.max(...intE.map(Math.abs)));
  return {
    rows, Ta, Tc, HRa, HRc, dT, coefT, Up, par, ures, uep, upar, uder, uDtMax: maxNom / Math.sqrt(3) * coefT, intE, intErr: intE[intIdx],
    profE: d.prof.map((r: number[]) => r[1] - r[0]), escE: d.esc[1] - d.esc[0],
  };
}

/**
 * ITL02 · Tabla de resultados H24:L34 (ISO 3611).
 * Opción `der` (L8): suma la deriva del patrón. Sin franjas del plano óptico (`fr`) usa la tolerancia ISO 3611.
 */
export function calcularITL02(d: Datos, opt: Opciones = {}) {
  const tn = nums(d.temp), Ta = mean(tn), Tc = Ta + (d.et * -1), HRa = avgN(d.hum), HRc = HRa + (d.eh * -1);
  const dT = Math.max(...tn) - Math.min(...tn), coefT = dT === 0 ? 0 : 0.0000173 * dT; // K65
  const Up = Math.max(...d.pU); // F24 = H60
  const ures = d.res / 2 / Math.sqrt(3); // L62
  const par = d.fr && d.fr.some((x: any) => x) ? Math.max(...d.fr.map((x: any) => (x || 0) * 0.6 / 2 / 1000)) : d.tolPar; // H63
  const uep = par / 2 / Math.sqrt(3), upla = d.tolPla / 2 / Math.sqrt(3); // L63, L64
  const upar = d.par / Math.sqrt(3); // L66
  const uder = Math.max(...d.der) / Math.sqrt(3); // L67
  const maxNom = Math.max(...d.pts.map((p: any) => p.nom));
  const rows = d.pts.map((p: any) => {
    const s = nums(p.s), H = mean(s), I = H - p.nom;
    let J = stdev(s);
    J = J === 0 ? 0.00000000001 : J / Math.sqrt(3);
    const uDt = p.nom * coefT / Math.sqrt(3);
    const K = Math.sqrt((Up / 2) ** 2 + uDt * uDt + (J / 1) ** 2 + ures * ures + uep * uep + upla * upla + upar * upar + (opt.der ? uder * uder : 0)), L = 2 * K;
    return { nom: p.nom, H, I, J, K, L, uDt, Uc: xru(L, 2) };
  });
  return { rows, Ta, Tc, HRa, HRc, dT, coefT, Up, ures, uep, upla, upar, uder, par, uDtMax: maxNom * coefT / Math.sqrt(3) };
}

/**
 * ITL06 · regla graduada, Tabla de resultados H23:L32.
 * Opción `fixHR` (T1): resta la corrección del termohigrómetro (el Excel la suma).
 */
export function calcularITL06(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3), tn = nums(d.temp), Ta = mean(tn) - d.et, HRa = mean(nums(d.hum)), HRc = opt.fixHR ? HRa - d.eh : HRa + d.eh;
  const dT = Math.max(...tn) - Math.min(...tn), coefT = dT === 0 ? 0 : 0.0000173 * dT;
  const Up = d.pU, ures = d.res / 2 / S3, ualin = (d.alin / 2) / (S3 * 1), uder = d.der / S3, urep = 0.0000000001;
  const maxNom = Math.max(...d.pts.map((p: any) => p.nom));
  const rows = d.pts.map((p: any) => {
    const s = nums(p.s), H = mean(s), I = p.nom - H, uDt = p.nom * coefT / S3;
    const K = Math.sqrt((Up / 2) ** 2 + uDt * uDt + urep * urep + ures * ures + ualin * ualin + uder * uder), L = 2 * K;
    return { nom: p.nom, H, I, J: urep, K, L, uDt };
  });
  const Kmax = Math.sqrt((Up / 2) ** 2 + urep ** 2 + ures ** 2 + ualin ** 2 + (maxNom * coefT / S3) ** 2 + uder ** 2), U = 2 * Kmax;
  const dec = 0, K64 = U <= 0.5 ? 0.5 : xru(U, dec); // K64 «aproximada a la resolución»
  return { rows, Ta, HRc, dT, coefT, ures, ualin, uder, uDtMax: maxNom * coefT / S3, Kmax, U, K64, synth: xr(Math.max(...rows.map((r: any) => r.L)), dec) };
}

/**
 * ITL07 · flexómetro, tramos de 3 m con error arrastrado (F24:J101).
 * Opciones: `sqrt` (L17) suma los empalmes en cuadratura; `full` (L18) incluye alineación y deriva.
 */
export function calcularITL07(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3), tn = nums(d.temp), Ta = mean(tn) - d.et, HRa = mean(nums(d.hum)), HRc = HRa + d.eh;
  const dT = Math.max(...tn) - Math.min(...tn), coefT = dT === 0 ? 0 : 0.0000173 * dT;
  const up1 = d.pU / 2, up2 = d.pU2 / 2, urep = 0.00000000000000001 / 2 / 1, ures = d.res / 2 / S3, ualin = (d.alin / 2) / S3, uder = d.der / S3;
  const G: Record<number, number> = {};
  const rows = d.pts.map((p: any) => {
    const sg = p.nom <= 3000 ? 0 : Math.floor((p.nom - 1) / 3000), ref = sg * 3000;
    const D = d.pU, E = mean([p.c]), F = sg === 0 ? E + p.n : E + p.n + G[ref];
    const Gc = F - p.nom;
    G[p.nom] = Gc;
    const H = 0.000000000000001, uDt = p.nom * coefT / S3;
    const emp = sg === 0 ? null : (opt.sqrt ? (d.alin / 2) * Math.sqrt(sg) / S3 : (d.alin / 2) * sg / S3);
    const terms = [D / 2, uDt].concat(emp == null ? [] : [emp]).concat([up2, urep, ures, 0]).concat(opt.full ? [ualin * (sg === 0 ? 1 : 0), uder] : []);
    const I = Math.sqrt(terms.reduce((s, x) => s + x * x, 0)), J = 2 * I;
    return { nom: p.nom, sg, D, E, F, G: Gc, H, I, J, emp, uDt, Ucert: xru(J, 0), Ecert: xr(p.nom, 0) - xr(F, 0) };
  });
  const uc = Math.sqrt(up1 ** 2 + up2 ** 2 + urep ** 2 + ures ** 2 + ualin ** 2 + (3000 * coefT / S3) ** 2 + 0 + uder ** 2), U = 2 * uc;
  return { rows, Ta, HRc, dT, coefT, up1, up2, ures, ualin, uder, uDt3: 3000 * coefT / S3, uc, U, Ubal: xru(U, 0), synth: Math.max(...rows.map((r: any) => r.Ucert)) };
}
