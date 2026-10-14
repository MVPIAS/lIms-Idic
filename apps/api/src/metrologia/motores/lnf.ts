/**
 * Motor del LABORATORIO NACIONAL DE FUERZA (LNF) · ISO 376:2011.
 *
 * Reproduce la planilla LCPN-F-PG01-P01-IT01 FORM 00 Rev. 19 (libro del
 * certificado LCPNF-010.26): hojas TID (ingreso), TR (resultados 1 y 2),
 * S=f(F) y F=f(S) (ajuste por mínimos cuadrados sin término independiente) y
 * la tabla de interpolación del certificado. Validado celda a celda contra la
 * planilla real (ver paridad-lnf.ts).
 *
 * Secuencia ISO 376: I1 e I2 ascendentes a 0°, I3 asc + I4 desc a 120°,
 * I5 asc + I6 desc a 240°. Deflexión X = lectura − cero inicial de la serie
 * (I4 usa el cero de I3; I6 el de I5).
 *
 * Opciones (hallazgos del documento de brechas del LNF; apagadas = planilla):
 *   k2      (G3) k = 2, como declara el texto del certificado (la planilla usa 1,96).
 *   creep   (G4) fluencia estimada = v/(3·√3), sin el /100 adicional de la planilla.
 *   umin    (G6) U mínima por clase leída de la fila correcta de la tabla de límites.
 */
import { mean, nums, stdev, xr, type Datos, type Opciones } from "./util";

/** Límites ISO 376 de la planilla (TR!D43:L46), por clase 00 / 0,5 / 1 / 2. */
export const LIMITES_ISO376 = {
  b: [0.05, 0.1, 0.2, 0.4], bp: [0.025, 0.05, 0.1, 0.2], fc: [0.025, 0.05, 0.1, 0.2], f0: [0.012, 0.025, 0.05, 0.1],
  v: [0.07, 0.15, 0.3, 0.5], c: [0.025, 0.05, 0.1, 0.2], ubmc: [0.01, 0.02, 0.05, 0.1], u: [0.06, 0.12, 0.24, 0.45],
};
/** TR!L42 (el encabezado de la columna «rel u», que la planilla usa como U mínima de la clase 00). */
const L42 = 0.05;

/** Clase por criterio: 0 = «00», 0,5, 1, 2; 3 = no clasificable. */
export const claseISO376 = (x: number, l: number[]) => (x > l[3] ? 3 : x > l[2] ? 2 : x > l[1] ? 1 : x > l[0] ? 0.5 : 0);
/** Etiqueta del certificado (TR!X27). */
export const etiquetaClase = (c: number) => (c > 2 ? "N/C" : c === 0 ? "00" : String(c).replace(".", ","));

/** Inversa por LU con pivoteo parcial (la que reproduce MINVERSE de Excel bit a bit). */
export function inversa(m: number[][]): number[][] {
  const n = m.length, A = m.map((r) => [...r]), P = [...Array(n).keys()];
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    [A[k], A[p]] = [A[p], A[k]];
    [P[k], P[p]] = [P[p], P[k]];
    for (let i = k + 1; i < n; i++) {
      A[i][k] /= A[k][k];
      for (let j = k + 1; j < n; j++) A[i][j] -= A[i][k] * A[k][j];
    }
  }
  const inv = m.map(() => Array(n).fill(0));
  for (let col = 0; col < n; col++) {
    const b = P.map((p) => (p === col ? 1 : 0)), y: number[] = [];
    for (let i = 0; i < n; i++) { let s = b[i]; for (let j = 0; j < i; j++) s -= A[i][j] * y[j]; y[i] = s; }
    const x = Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
    for (let i = 0; i < n; i++) inv[i][col] = x[i];
  }
  return inv;
}
const mmult = (M: number[][], v: number[]) => M.map((r) => r.reduce((a, x, j) => a + x * v[j], 0));

/**
 * Ajuste y = a·x + b·x² + c·x³ (y grados 2 y 1) sin término independiente, con
 * las sumas y la matriz normal de las hojas S=f(F) / F=f(S).
 */
export function ajustePolinomio(x: number[], y: number[]) {
  const S = (p: number) => x.reduce((a, v) => a + v ** p, 0);
  const SY = (p: number) => x.reduce((a, v, i) => a + v ** p * y[i], 0);
  const s2 = S(2), s3 = S(3), s4 = S(4), s5 = S(5), s6 = S(6), v1 = SY(1), v2 = SY(2), v3 = SY(3);
  const g3 = mmult(inversa([[s2, s3, s4], [s3, s4, s5], [s4, s5, s6]]), [v1, v2, v3]);
  const g2 = mmult(inversa([[s2, s3], [s3, s4]]), [v1, v2]);
  const g1 = (1 / s2) * v1;
  return { g3, g2, g1 };
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const SQ = (a: unknown[]) => Math.sqrt(nums(a).reduce((s, v) => s + v * v, 0));

export function calcularLNF(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3), S6 = Math.sqrt(6);
  const dec: number = esNum(d.dec) ? d.dec : 6;
  const grado: number = esNum(d.grado) ? d.grado : 3;
  const interp = String(d.interp ?? "SI").trim().toUpperCase() !== "NO";
  // Solo los puntos con fuerza informada (el formulario puede traer filas vacías).
  const pts: any[] = (d.pts ?? []).filter((p: any) => esNum(p?.F));
  if (pts.length < 3) throw new Error("ISO 376: se requieren al menos 3 puntos de fuerza");
  const z0: number[] = d.z0, zf: number[] = d.zf;
  if (!z0?.every(esNum) || !zf?.every(esNum)) throw new Error("ISO 376: faltan los ceros de las series");

  // Resolución en unidades de fuerza (TID!G16) y temperatura (TR!R41:R42).
  const r = xr(d.fmax / d.div, d.decRes) * d.conv;
  const temps = nums(d.temp ?? []);
  const tMed = temps.length ? xr(mean(temps), 1) : null;
  const tRan = temps.length ? xr((Math.max(...temps) - Math.min(...temps)) / 2, 1) : null;
  const tEstado = tRan == null ? null : tRan > 1 ? "SUSPENDER Y REPETIR CALIBRACIÓN" : "OK";
  // Desvío relativo de las precargas (TID!B43:F43), informativo.
  const pre: number[] = Array.isArray(d.pre) && d.pre.length === 3
    ? d.pre[0].map((_: any, j: number) => (d.pre[0][j] - d.pre[2][j]) / d.pre[1][j] * 100) : [];

  // Deflexiones (TR!H10:M19).
  const filas = pts.map((p: any) => {
    const s = p.s as (number | null)[];
    const X = [s[0]! - z0[0], s[1]! - z0[1], s[2]! - z0[2], esNum(s[3]) ? s[3] - z0[2] : null, s[4]! - z0[3], esNum(s[5]) ? s[5] - z0[3] : null];
    if (![X[0], X[1], X[2], X[4]].every(esNum)) throw new Error(`ISO 376: faltan lecturas ascendentes en ${p.F}`);
    return { F: p.F as number, X };
  });
  const ult = filas[filas.length - 1].X;
  // Error de cero por serie (TR!B22, C22, D22, F22) y máximo (H22).
  const f0 = [(zf[0] - z0[0]) / ult[0]! * 100, (zf[1] - z0[1]) / ult[1]! * 100, (zf[2] - z0[2]) / ult[2]! * 100, (zf[3] - z0[3]) / ult[4]! * 100];
  const f0max = Math.max(...f0.map(Math.abs));

  // Promedios (TR!B27, C27) y curva S = f(F).
  const Xr = filas.map(({ X }) => xr((X[0]! + X[2]! + X[4]!) / 3, dec));
  const Xwr = filas.map(({ X }) => xr((X[0]! + X[1]!) / 2, dec));
  const F = filas.map((f) => f.F);
  const S = ajustePolinomio(F, Xr), Finv = ajustePolinomio(Xr, F);
  const [a, b, c] = S.g3;
  const cmc = d.urelSmp * 100; // «Mejor capacidad de medición» (TR!F39), %

  const rows: any[] = filas.map(({ F: f, X }, i) => {
    const Xa3 = xr(a * f + b * f ** 2 + c * f ** 3, dec), Xa2 = xr(S.g2[0] * f + S.g2[1] * f ** 2, dec), Xa1 = xr(S.g1 * f, dec);
    const Xa = grado === 3 ? Xa3 : grado === 2 ? Xa2 : Xa1;
    const rot = [X[0]!, X[2]!, X[4]!];
    const bR = Math.abs((Math.max(...rot) - Math.min(...rot)) / Xr[i] * 100);
    const bp = Math.abs(X[1]! - X[0]!) / Xwr[i] * 100;
    const fc = (Xr[i] - Xa) / Xa * 100;
    const v1 = esNum(X[3]) ? Math.abs((X[3] - X[2]!) / X[2]!) * 100 : null;
    const v2 = esNum(X[5]) ? Math.abs((X[5] - X[4]!) / X[4]!) * 100 : null;
    const v = v1 != null && v2 != null ? (v1 + v2) / 2 : null;
    const creep = v == null ? null : opt.creep ? v / (3 * S3) : v / (100 * 3 * S3); // TR!Q57
    return { F: f, X, Xr: Xr[i], Xwr: Xwr[i], Xa, Xa3, Xa2, Xa1, b: bR, bp, fc, v1, v2, v, creep };
  });
  const ucreep = Math.max(...rows.map((x) => x.creep).filter(esNum)); // TR!Q66
  const k = opt.k2 ? 2 : 1.96; // nef ≥ 9·10⁹ siempre (grados de libertad fijados en 9·10⁹) ⇒ 1,96 (hallazgo G3)
  const NU = 9e9;

  rows.forEach((x) => {
    const rot = [x.X[0], x.X[2], x.X[4]];
    // Caso C (TR!A57:L66): con fluencia estimada, sin reversibilidad.
    const urot = stdev(rot) / mean(rot) / S3 * 100;
    const urep = x.bp === 0 ? 0.0000000001 : x.bp / S3;
    const uinp = interp ? x.fc / 1 : 0;
    const urev = x.v == null ? null : x.v / S3;
    const ures = r / S6 / x.F * 100;
    const uc = SQ([urot, urep, uinp, ures, f0max, cmc / 2, ucreep]);
    const nef = uc ** 4 / (urot ** 4 / NU + urep ** 4 / NU);
    const U = k * uc;
    const ucD = SQ([urot, urep, uinp, urev, ures, f0max, cmc / 2]); // Caso D (TR!G88): con reversibilidad, sin fluencia
    Object.assign(x, { urot, urep, uinp, urev, ures, uc, nef, k, U, UN: x.F * U / 100 * 1000, ucD, UD: k * ucD, UDN: x.F * k * ucD / 100 * 1000 });
  });

  // Clasificación (TR!N27:X36): peor clase de cada criterio y, por rango, desde el punto hasta Fmax.
  const L = LIMITES_ISO376;
  rows.forEach((x) => {
    x.cls = {
      b: claseISO376(x.b, L.b), bp: claseISO376(x.bp, L.bp), fc: interp ? claseISO376(Math.abs(x.fc), L.fc) : null,
      f0: claseISO376(f0max, L.f0), v: x.v == null ? null : claseISO376(x.v, L.v), c: x.creep == null ? null : claseISO376(x.creep, L.c),
      u: claseISO376(x.U, L.u), ubmc: claseISO376(cmc, L.ubmc),
    };
    x.clase = Math.max(...Object.values(x.cls).filter(esNum) as number[]);
  });
  for (let i = rows.length - 1; i >= 0; i--) rows[i].claseRango = i === rows.length - 1 ? rows[i].clase : Math.max(rows[i].clase, rows[i + 1].claseRango);
  rows.forEach((x) => {
    x.etiqueta = etiquetaClase(x.claseRango);
    // U mínima por clase (TR!L57). La planilla lee L42..L45 para 00/0,5/1/2 (hallazgo G6).
    const lim = opt.umin ? L.u : [L42, ...L.u.slice(0, 3)];
    const c = x.claseRango, um = c === 0 ? lim[0] : c === 0.5 ? lim[1] : c === 1 ? lim[2] : c === 2 ? lim[3] : L.u[3];
    x.Umin = x.U < um ? um : x.U;
  });

  // Balance general informativo (TR!A71:K82).
  const mx = (k2: string) => Math.max(...rows.map((x) => x[k2]).filter(esNum));
  const gen = {
    wrot: mx("urot") / S3, wrep: mx("urep") / S3, winp: mx("uinp") / 1, wrev: mx("urev") / S3, wres: mx("ures") / S6,
    wzer: f0max, wcreep: mx("urev") / S3 * 3, wbmc: cmc / 2,
  } as Record<string, number>;
  gen.uc = SQ([gen.wrot, gen.wrep, gen.winp, gen.wrev, gen.wres, gen.wzer, gen.wcreep]);
  gen.U = 2 * gen.uc;

  // Tabla de interpolación del certificado: desde Fmin en pasos de Fmin/2, columnas +0..+4·Fmin/10, 5 decimales.
  const f1 = F[0], tabla: { F: number; S: number[] }[] = [];
  for (let base = f1, n = 0; base <= F[F.length - 1] + 1e-9 && n < 200; base = f1 / 2 + base, n++) {
    tabla.push({ F: base, S: [0, 1, 2, 3, 4].map((j) => { const ff = base + (j === 0 ? 0 : f1 / 10 * j); return xr(a * ff + b * ff ** 2 + c * ff ** 3, 5); }) });
  }

  return {
    rows, r, f0, f0max, ucreep, cmc, k, gen, tMed, tRan, tEstado, pre,
    coef: { S3: S.g3, S2: S.g2, S1: S.g1, F3: Finv.g3, F2: Finv.g2, F1: Finv.g1 },
    tabla, clase: etiquetaClase(rows[0].claseRango),
    rangos: rows.map((x) => ({ desde: x.F, hasta: F[F.length - 1], clase: x.etiqueta })),
  };
}
