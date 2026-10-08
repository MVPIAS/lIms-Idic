/**
 * Motor de VOLUMEN · ISO 4787 gravimétrico, validado contra los Excel reales del LMT.
 *   ITV02 · probeta graduada V-5878 (46/46), matraz aforado V-5881 (22/22), pipeta aforada V-5885 (22/22)
 * La misma función cubre graduado y aforado (simple o doble aforo) según `proc` y `tipo`.
 */
import { mean, nums, stdev, xr, xru, type Datos, type Opciones } from "./util";

/**
 * Opciones: `fixEv` (V8) signo de la evaporación y solo filas con datos; `fixBal` (V5) corrección de la
 * balanza en todos los puntos; `dRho` (V2) propaga dρw/dt al presupuesto.
 */
export function calcularITV02(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3), grad = /graduado/i.test(d.proc || "");
  const F29 = mean(nums(d.empty)) + (d.berr * -1);
  const tA = mean(nums(d.Ta)) + (d.thA.err * -1), tW = mean(nums(d.Tw)) + (d.thW.err * -1);
  const HR = mean(nums(d.HR)) + (d.hr.err * -1), P = mean(nums(d.P)) + (d.pr.err * -1);
  const rAk = ((0.34848 * P) - ((0.009 * HR) * Math.exp(0.061 * tA))) / (273.15 + tA), rA = rAk / 1000;
  const [a1, a2, a3, a4, a5] = d.tan as number[];
  const rW = a5 * (1 - ((tW + a1)) ** 2 * (tW + a2) / (a3 * (tW + a4)));
  const rB = d.rhoB, g = d.gam;
  const Z = 1 / (rW - rA) * (1 - rA / rB) * (1 - g * (tW - 20));
  const evs: number[] = opt.fixEv
    ? d.ev.filter((r: any[]) => r.some((x) => x != null && x !== "")).map((r: any[]) => (((r[2] || 0) - (r[3] || 0)) + ((r[0] || 0) - (r[1] || 0))) / 2)
    : d.ev.map((r: any[]) => ((r[0] || 0) - (r[1] || 0) - ((r[2] || 0) - (r[3] || 0))) / 2); // Excel: celdas vacías cuentan 0
  const evap = evs.length ? mean(evs) : 0;
  const pts = d.pts.map((p: any) => {
    const s = nums(p.s);
    const be = opt.fixBal ? d.berr : (p.berr || 0);
    const G = mean(s) + (be * -1) + evap, H = stdev(s) / Math.sqrt(s.length);
    return { nom: p.nom as number, s, G, H, rng: Math.max(...s) - Math.min(...s) };
  });
  const m1 = pts[0].G - F29; // AC47: masa del punto 1 (se usa en todos los bloques, hallazgo V6)
  const Kc = 1 / (rW - rA) * (1 - rA / rB);
  const Tw_c = d.Tw.map((x: number) => x - d.thW.err), Ta_c = d.Ta.map((x: number) => x - d.thA.err);
  const HR_c = d.HR.map((x: number) => x - d.hr.err), P_c = d.P.map((x: number) => x - d.pr.err);
  const AD8 = Math.sqrt((d.thA.U / 2) ** 2 + (Math.abs(Tw_c[0] - Tw_c[2]) / (2 * S3)) ** 2 + (d.thA.res / (2 * S3)) ** 2 + (Math.abs(tA - tW) / (8 * S3)) ** 2);
  const AE8 = m1 * Kc * (-g), AG8 = AD8 * AE8;
  const AD10 = rW * d.uEqW, AE10 = -m1 * (1 / (rW - rA) ** 2) * (1 - rA / rB) * (1 - g * (tW - 20)), AG10 = AD10 * AE10;
  const uW = Math.sqrt(AG8 * AG8 + AG10 * AG10); // AD12
  const AD21 = Math.sqrt((d.thW.U / 2) ** 2 + (Math.abs(Ta_c[0] - Ta_c[2]) / (2 * S3)) ** 2 + (d.thW.res / (2 * S3)) ** 2), AE21 = 0.34848 / (1000 * (273.15 + 20.3));
  const AD23 = Math.sqrt((d.hr.U / 2) ** 2 + (Math.abs(HR_c[0] - HR_c[2]) / (2 * S3)) ** 2 + (d.hr.res / (2 * S3)) ** 2), AE23 = (-0.009 * Math.E ** (0.061 * tA)) / (1000 * (273.1 + tA)) / 100;
  const Pf = d.P[2], Hf = d.HR[2];
  const AD25 = Math.sqrt((d.pr.U / 2) ** 2 + (Math.abs(P_c[0] - P_c[2]) / (2 * S3)) ** 2 + (d.pr.res / (2 * S3)) ** 2);
  const AE25 = ((-0.3488 * Pf) - (0.009 * (Hf / 100) * Math.E ** (0.061 * tA)) * (0.061 + (273.1 + tA) - 1)) / (1000 * ((273.1 + tA) ** 2));
  const AG27 = d.uEqA * 1 * rA;
  const AD29 = Math.sqrt((AD21 * AE21) ** 2 + (AD23 * AE23) ** 2 + (AD25 * AE25) ** 2 + AG27 ** 2);
  const AE29 = m1 * (1 / (rW - rA)) * (1 - g * (tW - 20)) * ((1 - rA / rB) * ((1 / (rW - rA)) - (1 / rB))), uA = AD29 * AE29; // AG30
  const empty = nums(d.empty);
  const AD37 = (Math.max(...empty) - Math.min(...empty)) / (2 * S3), AD41 = d.bal.U / 2, AD43 = d.bal.res / (2 * S3), AD45 = d.bal.der / (grad ? S3 : 2 * S3);
  const AG61 = d.ugam * (m1 * Kc * (-(tW - 20)));
  const AG63 = AG8; // temperatura del agua (repite AG8)
  let AD65: number;
  if (grad) AD65 = d.res / (2 * S3);
  else {
    const hn = nums(d.h || []);
    const Dm = hn.length ? Math.sqrt(d.hV / (0.7854 * ((mean(hn) + (d.hErr * -1)) / 10))) * 10 : d.D;
    AD65 = /doble aforo/i.test(d.tipo || "") ? (((Dm / 2) ** 2 * Math.PI * 0.1 * 0.001 / S3) * Math.SQRT2) : ((Dm / 2) ** 2 * Math.PI * 0.1 * 0.001 / S3);
  }
  const AG67 = d.urhoB * (m1 * (1 / (rW - rA)) * (1 - g * (tW - 20)) * (rA / (rB ** 2)));
  let uTw_dens = 0;
  if (opt.dRho) {
    const h = 1e-4, f = (t: number) => a5 * (1 - ((t + a1)) ** 2 * (t + a2) / (a3 * (t + a4)));
    uTw_dens = AD8 * (-m1 / (rW - rA) ** 2 * (1 - rA / rB) * (1 - g * (tW - 20))) * ((f(tW + h) - f(tW - h)) / (2 * h));
  }
  const cmcK = d.cmcK;
  const rows = pts.map((p: any) => {
    const AD47 = Math.sqrt((AD37 * Z) ** 2 + (p.rng / (2 * S3) * Z) ** 2 + (AD41 * Z) ** 2 + (AD43 * Z) ** 2 + (AD45 * Z) ** 2);
    const AG69 = p.H * Z, AG71 = evap / S3 * Z;
    const uc = Math.sqrt(AD47 ** 2 + uW ** 2 + uA ** 2 + AG61 ** 2 + AG63 ** 2 + AD65 ** 2 + AG67 ** 2 + AG69 ** 2 + AG71 ** 2 + uTw_dens ** 2);
    const I = Z * (p.G - F29), J = I - p.nom;
    const cmc = grad ? Math.sqrt((cmcK * p.nom) + (0.333 * d.res ** 2)) : Math.sqrt(cmcK * p.nom);
    const M = uc * 2 >= cmc ? uc * 2 : cmc;
    return { nom: p.nom, G: p.G, H: p.H, I, J, K: -J, L: uc, M, AD47, cmc, Dcert: xr(I, d.dec), Ucert: xru(M, d.dec) };
  });
  return { rows, F29, tA, tW, HR, P, rA, rAk, rW, Z, evap, m1, uW, uA, AD8, AD29, AD65, AG61, AG63, AG67, AD37, AD41, AD43, AD45, grad, uTw_dens };
}
