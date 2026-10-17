/**
 * Motor ITV05 · instrumentos volumétricos accionados por pistón (micropipetas),
 * método gravimétrico. Reproduce la planilla LMT-PG01-P01-ITV05-FORM01 Rev. 19,
 * caso real V-5920 (micropipeta 20–200 µL, 3 puntos × 5 pesadas).
 *
 * Volumen a 20 °C:  V = Z · (m̄ − m_vacío),  m̄ = promedio − error de la balanza + evaporación
 *   Z = 1/(ρw − ρa) · (1 − ρa/ρB) · (1 − γ·(tw − 20))
 * Presupuesto por punto (EURAMET cg-19 / ISO 8655): pesadas, ρ agua, ρ aire, dilatación,
 * temperatura del agua, resolución, densidad de las pesas, repetibilidad y evaporación.
 * U = máx(2·uc, CMC);  CMC = √(a·V + 0,333·r²)  (tabla por rango de la planilla).
 * Certificado en µL con 2 decimales, redondeo hacia arriba (REDONDEAR.MAS).
 *
 * Opciones (desactivadas = planilla):
 *   evap  (V8)  evaporación con el signo que la suma a la masa medida (la planilla la resta)
 *   kBal  (V1)  k = 2 también en el balance del primer punto (la planilla usa 2,15 solo ahí)
 */
import { mean, stdev, xr, xru, type Datos, type Opciones } from "./util";

/** Coeficientes de dilatación cúbica (1/°C) por material, tabla O5:R18 de la planilla (ASTM E542 Tabla XI.1). */
export const MATERIALES_ITV05: Record<number, { nombre: string; gamma: number }> = {
  1: { nombre: "Fused Silica", gamma: 1.6e-6 }, 2: { nombre: "Borosilicato (Tipo I Clase A)", gamma: 1e-5 },
  3: { nombre: "Borosilicato (Tipo I Clase B)", gamma: 1.5e-5 }, 4: { nombre: "Soda - lime", gamma: 2.5e-5 },
  5: { nombre: "Polipropileno", gamma: 0.00024 }, 6: { nombre: "Policarbonato", gamma: 0.00045 },
  7: { nombre: "Poliestireno", gamma: 0.00021 }, 8: { nombre: "Hierro", gamma: 0.000355 }, 9: { nombre: "Aluminio", gamma: 6.9e-5 },
  10: { nombre: "Cobre", gamma: 0.000501 }, 11: { nombre: "Acero inoxidable", gamma: 4.77e-5 },
  12: { nombre: "Polimetilpenteno (PMP)", gamma: 0.00036 }, 13: { nombre: "Copolimero de perfluoroalcoxi (PFA)", gamma: 0.00039 },
};
/** CMC de la planilla (AC88:AE92): [desde mL, hasta mL, factor a]. */
export const CMC_ITV05: [number, number, number][] = [[0.0001, 10, 5.2e-9], [10, 100, 8.8e-8], [100, 1000, 1.8e-7]];
/** Constantes de Tanaka para la densidad del agua (a1…a5). */
export const TANAKA = [-3.983035, 301.797, 522528.9, 69.34881, 0.99997495];

const S3 = Math.sqrt(3);
const numeros = (a: any[]) => (a ?? []).filter((x) => typeof x === "number" && !isNaN(x)) as number[];

export function calcularITV05(d: Datos, opt: Opciones = {}) {
  const mat = MATERIALES_ITV05[Number(d.material)];
  if (!mat) throw new Error("Indique el material del contenedor (1 a 13, tabla de la planilla)");
  const g = mat.gamma, ug = ((5 * g) / 100) / S3;
  const rB = d.rhoB ?? 8, urB = d.urhoB ?? 0.023;
  const tan = Array.isArray(d.tan) && d.tan.length === 5 && d.tan.every((x: any) => typeof x === "number") ? d.tan : TANAKA;
  const [a1, a2, a3, a4, a5] = tan as number[];
  const uEqW = d.uEqW ?? 2.8e-6, uEqA = d.uEqA ?? 0.00024;
  const bal = d.bal, thA = d.thA, thW = d.thW, hr = d.hr, pr = d.pr;
  if (!bal || !thA || !thW || !hr || !pr) throw new Error("Faltan los datos de la balanza, los termómetros, el higrómetro o el barómetro");
  const empty = numeros(d.empty);
  const F29 = empty.length ? (empty[0] !== 0 ? mean(empty) - (bal.err ?? 0) : mean(empty)) : 0;
  const Ta = numeros(d.Ta), Tw = numeros(d.Tw), HRr = numeros(d.HR), Pr = numeros(d.P);
  if (!Ta.length || !Tw.length || !HRr.length || !Pr.length) throw new Error("Registre la temperatura del aire y del agua, la humedad y la presión");
  const tA = mean(Ta) + ((thA.err ?? 0) * -1), tW = mean(Tw) + ((thW.err ?? 0) * -1);
  const HRc = mean(HRr) + ((hr.err ?? 0) * -1), Pc = mean(Pr) + ((pr.err ?? 0) * -1);
  const rAk = ((0.34848 * Pc) - ((0.009 * HRc) * Math.exp(0.061 * tA))) / (273.15 + tA), rA = rAk / 1000;
  const rW = a5 * (1 - ((tW + a1)) ** 2 * (tW + a2) / (a3 * (tW + a4)));
  const Z = 1 / (rW - rA) * (1 - rA / rB) * (1 - g * (tW - 20));
  // Evaporación (K54:M54 y K55): ((inicial − 20 s) − (final − 20 s adicionales)) / 2, celdas vacías = 0.
  const ev: any[][] = d.ev ?? [];
  const evs = ev.map((r) => (((r[0] || 0) - (r[1] || 0)) - ((r[2] || 0) - (r[3] || 0))) / 2);
  const K55 = evs.length ? mean(evs) : 0;
  const evap = opt.evap ? -K55 : K55; // la planilla suma K55 (negativo cuando el agua se evapora): resta la evaporación
  const berr = bal.err ?? 0;
  // Lecturas corregidas por el error de cada instrumento (C54:E55, C63:E64).
  const Ta_c = Ta.map((x) => x - (thA.err ?? 0)), Tw_c = Tw.map((x) => x - (thW.err ?? 0));
  const HR_c = HRr.map((x) => x - (hr.err ?? 0)), P_c = Pr.map((x) => x - (pr.err ?? 0));
  const AD8 = Math.sqrt((thA.U / 2) ** 2 + (Math.abs(Tw_c[0] - Tw_c[Tw_c.length - 1]) / (2 * S3)) ** 2 + (thA.res / (2 * S3)) ** 2 + (Math.abs(tA - tW) / (8 * S3)) ** 2);
  const AD21 = Math.sqrt((thW.U / 2) ** 2 + (Math.abs(Ta_c[0] - Ta_c[Ta_c.length - 1]) / (2 * S3)) ** 2 + (thW.res / (2 * S3)) ** 2);
  const AE21 = 0.34848 / (1000 * (273.15 + 20.3));
  const AD23 = Math.sqrt((hr.U / 2) ** 2 + (Math.abs(HR_c[0] - HR_c[HR_c.length - 1]) / (2 * S3)) ** 2 + (hr.res / (2 * S3)) ** 2);
  const AE23 = (-0.009 * Math.E ** (0.061 * tA)) / (1000 * (273.1 + tA)) / 100;
  const AD25 = Math.sqrt((pr.U / 2) ** 2 + (Math.abs(P_c[0] - P_c[P_c.length - 1]) / (2 * S3)) ** 2 + (pr.res / (2 * S3)) ** 2);
  const Pf = Pr[Pr.length - 1], Hf = HRr[HRr.length - 1];
  const AE25 = ((-0.3488 * Pf) - (0.009 * (Hf / 100) * Math.E ** (0.061 * tA)) * (0.061 + (273.1 + tA) - 1)) / (1000 * ((273.1 + tA) ** 2));
  const AG27 = uEqA * 1 * rA;
  const AD29 = Math.sqrt((AD21 * AE21) ** 2 + (AD23 * AE23) ** 2 + (AD25 * AE25) ** 2 + AG27 ** 2);
  const AD37 = empty.length ? (Math.max(...empty) - Math.min(...empty)) / (2 * S3) : 0;
  const AD41 = bal.U / 2, AD43 = bal.res / (2 * S3), AD45 = (bal.der ?? 0) / (2 * S3);
  const cmcT: [number, number, number][] = d.cmcTabla ?? CMC_ITV05;
  const dec = d.dec ?? 2;

  const pts = (d.pts ?? []).filter((p: any) => p && p.nom != null && numeros(p.s).length >= 2);
  if (!pts.length) throw new Error("Registre al menos un punto con dos o más pesadas");
  const rows = pts.map((p: any, i: number) => {
    const s = numeros(p.s);
    const G = mean(s) - berr + evap;
    const H = stdev(s) / Math.sqrt(s.length);
    const m = G - F29; // AC47: masa del punto
    const I = Z * (G - F29), J = I - p.nom, K = (stdev(s) / I) * 100;
    // Presupuesto del punto (columnas Z:AG, AN:AU, AW:BD …)
    const AG8 = AD8 * (m * (1 / (rW - rA)) * (1 - rA / rB) * (-g));
    const AG10 = (rW * uEqW) * (-m * (1 / (rW - rA) ** 2) * (1 - rA / rB) * (1 - g * (tW - 20)));
    const uW = Math.sqrt(AG8 ** 2 + AG10 ** 2); // AD12
    const AE29 = m * (1 / (rW - rA)) * (1 - g * (tW - 20)) * ((1 - rA / rB) * ((1 / (rW - rA)) - (1 / rB)));
    const uA = AD29 * AE29; // AG30
    const AD47 = Math.sqrt((AD37 * Z) ** 2 + (((Math.max(...s) - Math.min(...s)) / (2 * S3)) * Z) ** 2 + (AD41 * Z) ** 2 + (AD43 * Z) ** 2 + (AD45 * Z) ** 2);
    const AG59 = ug * (m * (1 / (rW - rA)) * (1 - rA / rB) * (-(tW - 20)));
    const AG61 = AG8; // temperatura del agua (repite el término de la densidad, como la planilla)
    const AG63 = d.res / 2 / S3;
    const AG65 = urB * (m * (1 / (rW - rA)) * (1 - g * (tW - 20)) * (rA / (rB ** 2)));
    const AG67 = H * Z;
    const AG69 = (K55 / S3) * Z;
    const L = Math.sqrt(AD47 ** 2 + uW ** 2 + uA ** 2 + AG59 ** 2 + AG61 ** 2 + AG63 ** 2 + AG65 ** 2 + AG67 ** 2 + AG69 ** 2);
    const fila = [...cmcT].reverse().find((r) => p.nom >= r[0]) ?? cmcT[0];
    const CMC = Math.sqrt((fila[2] * p.nom) + (0.333 * d.res ** 2));
    const M = L * 2 >= CMC ? L * 2 : CMC;
    const Ubal = L * (i === 0 && !opt.kBal ? 2.15 : 2);
    // Certificado en µL (×1000), N14 decimales, REDONDEAR.MAS.
    const cC = xru(I * 1000, dec), cD = xru(p.nom * 1000, dec);
    const cE = xru(cC, dec) - xr(cD, dec), cF = xru(M * 1000, dec), cG = (cE / cD) * 100, cH = xr(K, dec);
    return { nom: p.nom, s, G, H, I, J, K, L, M, CMC, uW, uA, AD47, Ubal, cC, cD, cE, cF, cG, cH };
  });
  return {
    rows, F29, Z, gamma: g, ugamma: ug, rA, rAk, rW, tA, tW, HRc, Pc, K55, AD8, AD29,
    // Condiciones del certificado (D31:D33): promedio corregido ± U del instrumento.
    amb: { t: xr(tA, 1), tU: thA.U, h: xr(HRc, 1), hU: hr.U, p: xr(Pc, 1), pU: pr.U },
    sintesis: rows.length ? Math.max(...rows.map((r: any) => r.cF)) : null,
  };
}
