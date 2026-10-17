/**
 * Paridad de los motores ITM03 e ITV05 contra las planillas reales que el LMT
 * entregó el 15-10-2026 (M-3947-ITM03.xlsm y V-5920-ITV05.xlsx). Evidencia de
 * validación del software (ISO/IEC 17025 §7.11), separada de la de las 14
 * instrucciones originales para no alterar su recuento (1531/1531).
 *
 * Un número es idéntico si la diferencia relativa con la celda es < 10⁻¹²
 * (o la absoluta < 10⁻¹⁸ cuando la celda vale 0); los textos del certificado se
 * comparan carácter a carácter. Se calcula SIN correcciones (= planilla).
 */
import casosJson from "./casos-1510.json";
import { calcularITM03 } from "./masa-nn";
import { calcularITV05 } from "./micropipeta";
import type { CasoReferencia, ParidadCaso } from "./paridad";

export const CASOS_1510: (CasoReferencia & { control?: Record<string, any> })[] = (casosJson as any).casos;

const TOL = 1e-12;
class Contador {
  ok = 0; n = 0; gmax = 0; fallos: string[] = [];
  num(a: number, b: number, que: string) {
    const d = b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b);
    this.n++; this.gmax = Math.max(this.gmax, d);
    if (d < TOL || (b === 0 && Math.abs(a) < 1e-18)) this.ok++; else this.fallos.push(`${que}: ${a} ≠ ${b}`);
  }
  igual(a: unknown, b: unknown, que: string) {
    this.n++;
    if (a === b) this.ok++; else this.fallos.push(`${que}: ${String(a)} ≠ ${String(b)}`);
  }
}

/** «(19,2 ± 0,6) ºC» como lo arma la planilla: el número sin ceros finales y coma decimal. */
const exc = (x: number) => String(x).replace(".", ",");

export function verificarCaso1510(caso: CasoReferencia): Contador {
  const O = caso.datos, c = new Contador();
  if (caso.it === "ITM03") {
    const V = calcularITM03(O, {});
    V.rows.forEach((r: any, i: number) => {
      const x = O.items[i], t = `ítem ${i + 1}`;
      r.C.forEach((v: number, k: number) => c.num(v, x.x_C[k], `${t} C${34 + k}`));
      r.ciclos.forEach((cy: any, k: number) => c.num(cy.dI, x.x_F[k], `${t} F${34 + 4 * k}`));
      ([["F58", "F58"], ["F59", "F59"], ["H24", "H24"], ["I24", "I24"], ["J24", "J24"], ["H25", "H25"], ["L27", "L27"], ["H28", "H28"], ["J28", "J28"],
        ["K26", "K26"], ["K27", "K27"], ["H34", "H34"], ["J58", "J58"], ["B97", "B97"], ["C97", "C97"], ["D97", "D97"], ["F97", "F97"],
        ["K87", "K87"], ["K88", "K88"], ["K89", "K89"], ["K90", "K90"], ["K91", "K91"], ["I88", "I88"], ["K93", "K93"], ["K94", "K94"], ["L77", "L77"]] as [string, string][])
        .forEach(([a, b]) => c.num(r[a], x["x_" + b], `${t} ${b}`));
      // Clase y U asignada (J79, J80): «--» en la planilla cuando el nominal no está en la tabla.
      c.igual(r.J79 ?? "--", x.x_J79, `${t} J79`);
      c.igual(r.J80 ?? "--", x.x_J80, `${t} J80`);
      // Certificado: masa convencional (D88…) y U asignada en texto (F88…).
      c.num(r.L77, x.x_certMasa, `${t} certificado masa`);
      c.igual(r.certU, x.x_certU, `${t} certificado U`);
    });
    c.num(V.Y5, O.x_Y5, "Y5"); c.num(V.Y6, O.x_Y6, "Y6"); c.num(V.Y7, O.x_Y7, "Y7");
    c.igual(`(${exc(Math.round(V.Y5 * 10) / 10)} ± ${exc(V.tU)}) ºC`, O.x_D30, "D30");
    c.igual(`(${exc(Math.round(V.Y6 * 10) / 10)} ± ${exc(V.hU)}) %`, O.x_D31, "D31");
    c.igual(`(${exc(V.Y7)} ± ${exc(V.pU)}) hPa`, O.x_D32, "D32");
    c.igual(V.fechaCalibracion, O.x_D29, "D29");
    return c;
  }
  if (caso.it === "ITV05") {
    const V = calcularITV05(O, {}), X = O.x;
    ([[V.F29, "F29"], [V.Z, "G22"], [V.gamma, "G23"], [V.ugamma, "G24"], [V.rA, "L22"], [V.rW, "L24"], [V.rAk, "AJ20"], [V.K55, "K55"],
      [V.tA, "F52"], [V.tW, "F53"], [V.HRc, "H61"], [V.Pc, "H62"], [V.AD8, "AD8"], [V.AD29, "AD29"]] as [number, string][])
      .forEach(([a, b]) => c.num(a, X[b], b));
    V.rows.forEach((r: any, i: number) => {
      const x = O.pts[i], t = `punto ${i + 1}`;
      ([["G", "G"], ["H", "H"], ["I", "I"], ["J", "J"], ["K", "K"], ["L", "L"], ["M", "M"], ["CMC", "CMC"], ["uW", "uW"], ["uA", "uA"], ["AD47", "AD47"], ["Ubal", "Ubal"],
        ["cC", "cC"], ["cD", "cD"], ["cE", "cE"], ["cF", "cF"], ["cG", "cG"], ["cH", "cH"]] as [string, string][])
        .forEach(([a, b]) => c.num(r[a], x["x_" + b], `${t} ${b}`));
    });
    const C = O.x_cert;
    c.igual(`(${exc(V.amb.t)} ± ${exc(V.amb.tU)}) °C`, C.D31, "D31");
    c.igual(`(${exc(V.amb.h)} ± ${exc(V.amb.hU)}) %`, C.D32, "D32");
    c.igual(`(${exc(V.amb.p)} ± ${exc(V.amb.pU)}) hPa`, C.D33, "D33");
    c.igual(`la corrección respectiva es de  ±  ${exc(V.sintesis)}  μL, para un nivel de confianza del 95%`, C.D52, "D52");
    return c;
  }
  throw new Error(`Sin verificación de paridad para ${caso.it}`);
}

export function verificarParidad1510(): { casos: (ParidadCaso & { fallos: string[] })[]; identicos: number; comparados: number } {
  const casos = CASOS_1510.map((k) => {
    const c = verificarCaso1510(k);
    return { caso: k.caso, it: k.it, instrumento: k.instrumento, identicos: c.ok, comparados: c.n, mayorDiferencia: c.gmax, fallos: c.fallos };
  });
  return { casos, identicos: casos.reduce((s, c) => s + c.identicos, 0), comparados: casos.reduce((s, c) => s + c.comparados, 0) };
}
