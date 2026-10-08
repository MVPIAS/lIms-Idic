/**
 * Paridad de los motores contra los Excel reales del LMT (evidencia de
 * validación del software, ISO/IEC 17025 §7.11).
 *
 * Para cada caso de referencia calcula con el motor (sin correcciones) y
 * compara cada valor con la celda del Excel. Un valor es «idéntico» si la
 * diferencia es menor que la tolerancia (10⁻¹⁵, o 10⁻¹² donde el Excel
 * encadena más operaciones). Resultado esperado: 1531 de 1531.
 */
import { MOTORES } from "./index";
import casosJson from "./casos-referencia.json";

export interface CasoReferencia { caso: string; it: string; instrumento: string; datos: Record<string, any> }
export interface ParidadCaso { caso: string; it: string; instrumento: string; identicos: number; comparados: number; mayorDiferencia: number }

export const CASOS_REFERENCIA: CasoReferencia[] = (casosJson as { casos: CasoReferencia[] }).casos;

/** Claves con los valores del Excel (no son entradas). */
export const esClaveExcel = (k: string) => /^[xyzw]_/.test(k) || k === "x" || k === "xT";

class Contador {
  ok = 0; n = 0; gmax = 0;
  constructor(private tol: number) {}
  /** Un grupo de valores que se cuenta completo solo si todos coinciden (como una fila de la maqueta). */
  grupo(pares: [number, number][]) {
    const dm = Math.max(...pares.map(([a, b]) => Math.abs(a - b)));
    this.n += pares.length;
    this.gmax = Math.max(this.gmax, dm);
    if (dm < this.tol) this.ok += pares.length;
  }
  uno(a: number, b: number) { this.grupo([[a, b]]); }
}

const filas = (c: Contador, rows: any[], pts: any[], pares: [string, string][]) =>
  rows.forEach((r, i) => c.grupo(pares.map(([a, b]) => [r[a], pts[i][b]])));
const mismas = (cols: string) => cols.split("").map((k) => [k, "x_" + k] as [string, string]);

function verificar(caso: CasoReferencia): Contador {
  const O = caso.datos, V = MOTORES[caso.it].calcular(O, {});
  switch (caso.it) {
    case "ITM02": {
      const c = new Contador(1e-15);
      filas(c, V.rows, O.pts, [["B", "x_prom"], ["E", "x_err"], ["G", "x_uS"], ["H", "x_ud"], ["I", "x_uecc"], ["J", "x_urest"], ["M", "x_uc"], ["O", "x_U"]]);
      return c;
    }
    case "ITP02": {
      const c = new Contador(1e-15);
      filas(c, V.rows, O.pts, mismas("BCDEGHIJKL"));
      const g = new Contador(1e-12);
      [["t", "x_t"], ["h", "x_h"], ["patm", "x_patm"], ["rair", "x_rair"], ["uDh", "x_uDh"], ["uresP", "x_uresP"]].forEach(([a, b]) => g.uno(V[a], O[b]));
      return sumar(c, g);
    }
    case "ITP01": {
      const c = new Contador(1e-15);
      filas(c, V.rows, O.pts, [["B", "x_B"], ["C", "x_C"], ["D", "x_D"], ["E", "x_E"], ["F", "x_F"], ["G", "x_G"], ["H", "x_H"], ["Jb", "x_J"], ["K", "x_K"], ["L", "x_L"],
        ["uA", "y_A"], ["uB", "y_B"], ["uC", "y_C"], ["uD", "y_D"], ["uE", "y_E"], ["Fp", "y_F"], ["Gc", "y_G"], ["Hc", "y_H"], ["Iu", "y_I"], ["Jd", "y_J"]]);
      [["t", "x_J10"], ["h", "x_J11"], ["patm", "x_C29"], ["rair", "x_C27"], ["D28", "x_D28"], ["G28", "x_G28"], ["tp", "x_K29"], ["uder", "x_J102"], ["I63", "x_I63"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITL01": {
      const c = new Contador(1e-15);
      filas(c, V.rows, O.pts, mismas("BCDEFGHIJ"));
      [["Ta", "x_A69"], ["HRc", "x_F69"], ["coefT", "x_I78"], ["ures", "x_J76"], ["uep", "x_J77"], ["uDtMax", "x_J78"], ["upar", "x_J79"], ["uder", "x_J80"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITL02": {
      const c = new Contador(1e-15);
      filas(c, V.rows, O.pts, mismas("HIJKL"));
      [["Ta", "x_E55"], ["HRc", "x_J55"], ["coefT", "x_K65"], ["ures", "x_L62"], ["uep", "x_L63"], ["upla", "x_L64"], ["uDtMax", "x_L65"], ["upar", "x_L66"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      c.uno(V.rows.at(-1).Uc, O.x_L74);
      return c;
    }
    case "ITM01": {
      const c = new Contador(1e-15);
      V.dI1 = V.cyc[0].dI; V.dI2 = V.cyc[1].dI;
      [["ra1", "H24"], ["ra2", "I24"], ["ra", "J24"], ["C", "H25"], ["uRa", "L27"], ["dI1", "F34"], ["dI2", "F38"], ["dI", "F58"], ["s", "F59"], ["mc", "H34"], ["dev", "J58"],
        ["uP", "K87"], ["uI", "K88"], ["ud", "K89"], ["uC", "K90"], ["uD", "K91"], ["B97", "B97"], ["C97", "C97"], ["D97", "D97"], ["uc", "K93"], ["U", "K94"], ["mpe", "J79"], ["asig", "J80"]]
        .forEach(([a, b]) => c.uno(V[a], O["x_" + b]));
      c.grupo(["C34", "C35", "C36", "C37", "C38", "C39", "C40", "C41"].map((k, i) => [V.Cr[i], O["x_" + k]] as [number, number]));
      const cls = V.best === O.x_L78 && (V.ok ? "ok" : "Revisar") === O.x_M94;
      c.n += 2; if (cls) c.ok += 2;
      return c;
    }
    case "ITV02": {
      const c = new Contador(1e-15), X = O.x, T = O.xT;
      filas(c, V.rows, O.pts, mismas("GHIJLM"));
      ([[V.F29, X.F29], [V.Z, X.G22], [V.rA, X.L22], [V.rW, X.L24], [V.AD8, X.AD8], [V.uW, X.AD12], [V.AD29, X.AD29], [V.uA, X.AG30], [V.AD65, X.AD65],
        [V.rows[0].cmc, X.AB90], [V.rows[0].AD47, X.AD47], [V.tA, T.F54], [V.tW, T.F55], [V.HR, T.H63], [V.P, T.H64], [V.evap, T.K57]] as [number, number][])
        .forEach(([a, b]) => c.uno(a, b));
      return c;
    }
    case "ITL06": {
      const c = new Contador(1e-12);
      filas(c, V.rows, O.pts, mismas("HIJKL"));
      [["Ta", "x_I40"], ["HRc", "x_L40"], ["coefT", "x_J56"], ["ures", "x_K54"], ["ualin", "x_K55"], ["uDtMax", "x_K56"], ["uder", "x_K57"], ["Kmax", "x_K61"], ["U", "x_K63"], ["K64", "x_K64"]]
        .forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITL07": {
      const c = new Contador(1e-12);
      filas(c, V.rows, O.pts, mismas("DEFGHIJ"));
      [["Ta", "x_C105"], ["HRc", "x_F105"], ["coefT", "x_J116"], ["up1", "x_K111"], ["up2", "x_K112"], ["ures", "x_K114"], ["ualin", "x_K115"], ["uDt3", "x_K116"], ["uder", "x_K118"],
        ["uc", "x_K122"], ["U", "x_K124"], ["Ubal", "x_K125"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITT01": {
      const c = new Contador(1e-12);
      filas(c, V.rows, O.pts, [["G", "x_G"], ["H", "x_H"], ["I", "x_I"], ["C", "y_C"], ["D", "y_D"], ["E", "y_E"], ["F", "y_F"], ["Gg", "y_G"], ["Hs", "y_H"], ["Ir", "y_I"], ["K", "y_K"], ["L", "y_L"], ["M", "y_M"], ["N", "y_N"]]);
      [["tAvg", "x_M49"], ["tC", "x_O49"], ["hAvg", "x_M50"], ["hC", "x_O50"], ["H46", "x_H46"], ["Lt", "x_L7"], ["Lh", "x_L8"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITT02": {
      const c = new Contador(1e-12);
      filas(c, V.rows, O.blocks, [...mismas("BCDEFGHIJKLM"), ["E42", "x_E42"], ["G42", "x_G42"], ["grad", "x_grad"], ["stab", "x_stab"]]);
      [["tE", "x_E186"], ["tG", "x_G186"], ["hE", "x_E187"], ["hG", "x_G187"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITF01": {
      const c = new Contador(1e-12);
      filas(c, V.rows, O.pts, [["D", "x_D"], ["E", "x_E"], ["F_", "x_F"], ["H", "x_H"], ["I", "x_I"], ["L", "x_L"], ["M", "x_M"], ["O", "x_O"], ["up", "y_D"], ["uder", "y_E"], ["Fp", "y_F"],
        ["G", "y_G"], ["Ha", "y_H"], ["J", "y_J"], ["K", "y_K"], ["Lc", "y_L"], ["Mu", "y_M"], ["P", "y_P"], ["cls", "z_cls"]]);
      [["M41", "x_M41"], ["tA", "x_M75"], ["hA", "x_N75"], ["M9", "x_M9"], ["M10", "x_M10"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITF03": {
      const c = new Contador(1e-12);
      filas(c, V.rows, O.pts, [["A", "x_A"], ["E", "x_E"], ["J", "x_J"], ["L", "x_L"], ["M", "x_M"], ["N", "x_N"], ["D", "y_D"], ["F", "y_F"], ["G", "y_G"], ["H", "y_H"], ["Jb", "y_J"],
        ["Ka", "y_K"], ["Mf", "y_M"], ["Nn", "y_N"], ["P", "y_P"], ["Q", "y_Q"], ["cls", "z_cls"], ["Ld", "z_L"]]);
      [["I24", "x_I24"], ["tA", "x_P29"], ["hA", "x_Q29"], ["O9", "x_O9"], ["O10", "x_O10"]].forEach(([a, b]) => c.uno(V[a], O[b]));
      return c;
    }
    case "ITPT01": {
      const c = new Contador(1e-12);
      const K: [string, string][] = [["G", "y_G"], ["H", "y_H"], ["I", "y_I"], ["J", "y_J"], ["D", "z_D"], ["E", "z_E"], ["F", "z_F"], ["Gr", "z_G"], ["Hr", "z_H"], ["Io", "z_I"], ["Ji", "z_J"],
        ["Kl", "z_K"], ["Lr", "z_L"], ["M", "z_M"], ["N", "z_N"], ["as", "w_L"], ["Wp", "w_M"]];
      V.rows.forEach((r: any, i: number) => {
        const x = O.pts[i];
        c.grupo([...K.map(([a, b]) => [r[a], x[b]] as [number, number]), ...r.v.map((y: number, k: number) => [y, x["x_" + "DEFGH"[k]]] as [number, number])]);
      });
      ([[V.repC[0], O.x_D60], [V.repC[1], O.x_E60], [V.repC[2], O.x_F60], [V.repC[3], O.x_G60], [V.G61, O.x_G61], [V.J60, O.x_J60], [V.L60, O.x_L60], [V.M61, O.x_M61],
        ...V.geoC.map((x: number, k: number) => [x, O["x_" + "DEFG"[k] + "82"]]), ...V.itfC.map((x: number, k: number) => [x, O["x_" + "JKLM"[k] + "82"]]),
        [V.I83, O.x_I83], [V.O83, O.x_O83], [V.M10, O.x_M10], [V.M11, O.x_M11]] as [number, number][]).forEach(([a, b]) => c.uno(a, b));
      return c;
    }
    default:
      throw new Error(`Sin verificación de paridad para ${caso.it}`);
  }
}
function sumar(a: Contador, b: Contador) {
  a.ok += b.ok; a.n += b.n; a.gmax = Math.max(a.gmax, b.gmax);
  return a;
}

export function verificarParidad(): { casos: ParidadCaso[]; identicos: number; comparados: number } {
  const casos = CASOS_REFERENCIA.map((k) => {
    const c = verificar(k);
    return { caso: k.caso, it: k.it, instrumento: k.instrumento, identicos: c.ok, comparados: c.n, mayorDiferencia: c.gmax };
  });
  return { casos, identicos: casos.reduce((s, c) => s + c.identicos, 0), comparados: casos.reduce((s, c) => s + c.comparados, 0) };
}
