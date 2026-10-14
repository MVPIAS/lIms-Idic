/**
 * Paridad del motor ISO 376 del LNF contra la planilla real (LCPN-F-PG01-P01-IT01
 * Rev. 19, libro del certificado LCPNF-010.26). Evidencia de validación del
 * software (ISO/IEC 17025 §7.11), separada de la paridad del LMT para no mezclar
 * los recuentos de laboratorios distintos.
 *
 * Un valor es «idéntico» si la diferencia relativa con la celda de la planilla
 * es menor que 10⁻¹² (los ceros deben coincidir exactamente). Las clases y los
 * textos se comparan por igualdad.
 */
import casoJson from "./caso-lnf.json";
import { calcularLNF, etiquetaClase } from "./lnf";
import type { CasoReferencia, ParidadCaso } from "./paridad";

export const CASOS_LNF: CasoReferencia[] = (casoJson as { casos: CasoReferencia[] }).casos;

const TOL = 1e-12;
class Contador {
  ok = 0; n = 0; gmax = 0;
  num(a: number, b: number) {
    const d = b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b);
    this.n++; this.gmax = Math.max(this.gmax, d);
    if (d < TOL || a === b) this.ok++;
  }
  igual(a: unknown, b: unknown) { this.n++; if (a === b) this.ok++; }
}

/** Valor de clase de la planilla (0 = «00»; el texto «2.0» se lee como 2). */
const claseExcel = (v: unknown) => (v === "00" ? 0 : v === "N/C" ? 3 : Number(v));

export function verificarCasoLNF(caso: CasoReferencia): Contador {
  const O = caso.datos, V = calcularLNF(O, {}), X = O.x, c = new Contador();
  V.rows.forEach((r: any, i: number) => {
    const t = O.pts[i].x_tr, y = O.pts[i].y_c, z = O.pts[i].z_d;
    // Deflexiones X1..X6 (TR!H:M, filas 10-19)
    "HIJKLM".split("").forEach((col, j) => { if (t["d" + col] != null) c.num(r.X[j], t["d" + col]); });
    // Resultados 1 (TR!B:L, filas 27-36)
    ([["B", r.Xr], ["C", r.Xwr], ["D", r.Xa3], ["E", r.Xa2], ["F", r.Xa1], ["G", r.b], ["H", r.bp], ["I", r.fc], ["J", r.v1], ["K", r.v2], ["L", r.v]] as [string, number][])
      .forEach(([k, v]) => { if (t[k] != null) c.num(v, t[k]); });
    // Clasificación (TR!N:W) y etiqueta (X)
    ([["N", r.cls.b], ["O", r.cls.bp], ["P", r.cls.fc], ["Q", r.cls.f0], ["R", r.cls.v], ["S", r.cls.c], ["T", r.cls.u], ["U", r.cls.ubmc], ["V", r.clase], ["W", r.claseRango]] as [string, number][])
      .forEach(([k, v]) => { if (t[k] != null) c.igual(v, t[k]); });
    c.igual(r.etiqueta, etiquetaClase(claseExcel(t.X)));
    // Caso C (TR!B:L y Q, filas 57-66)
    ([["B", r.urot], ["C", r.urep], ["D", r.uinp], ["E", r.urev], ["F", r.ures], ["G", r.uc], ["H", r.nef], ["I", r.k], ["J", r.U], ["K", r.UN], ["L", r.Umin], ["Q", r.creep]] as [string, number][])
      .forEach(([k, v]) => { if (y[k] != null) c.num(v, y[k]); });
    // Caso D (TR!G, J, K, filas 88-97)
    c.num(r.ucD, z.G); c.num(r.UD, z.J); c.num(r.UDN, z.K);
  });
  V.f0.forEach((v: number, i: number) => c.num(v, X.f0[i]));
  c.num(V.f0max, X.f0max); c.num(V.r, X.r); c.num(V.ucreep, X.ucreep);
  V.pre.forEach((v: number, i: number) => c.num(v, X.pre[i]));
  c.num(V.tMed!, X.tMed); c.num(V.tRan!, X.tRan); c.igual(V.tEstado, X.tEstado);
  Object.entries(X.gen as Record<string, number>).forEach(([k, v]) => c.num(V.gen[k], v));
  V.coef.S3.forEach((v: number, i: number) => c.num(v, X.S3[i]));
  V.coef.S2.forEach((v: number, i: number) => c.num(v, X.S2[i]));
  c.num(V.coef.S1, X.S1);
  V.coef.F3.forEach((v: number, i: number) => c.num(v, X.F3[i]));
  V.coef.F2.forEach((v: number, i: number) => c.num(v, X.F2[i]));
  c.num(V.coef.F1, X.F1);
  (X.interp as number[][]).forEach((fila, i) => fila.forEach((v, j) => c.num(V.tabla[i].S[j], v)));
  return c;
}

export function verificarParidadLNF(): { casos: ParidadCaso[]; identicos: number; comparados: number } {
  const casos = CASOS_LNF.map((k) => {
    const c = verificarCasoLNF(k);
    return { caso: k.caso, it: k.it, instrumento: k.instrumento, identicos: c.ok, comparados: c.n, mayorDiferencia: c.gmax };
  });
  return { casos, identicos: casos.reduce((s, c) => s + c.identicos, 0), comparados: casos.reduce((s, c) => s + c.comparados, 0) };
}
