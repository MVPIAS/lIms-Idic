import { balancePorPunto } from "./balance";
import { REGISTRO_MOTORES, calcularConMotor } from "./index";
import { CASOS_REFERENCIA, verificarParidad } from "./paridad";
import { CASOS_1510, verificarParidad1510 } from "./paridad-1510";
import { CASOS_LNF, verificarParidadLNF } from "./paridad-lnf";

/** Todas las combinaciones útiles de correcciones: ninguna (planilla), las «aplicar» y todas (incluidas las rechazadas). */
function variantes(it: string): Record<string, boolean>[] {
  const m = REGISTRO_MOTORES[it];
  const todas = Object.fromEntries(m.opciones.map((o) => [o.clave, true]));
  const aplicar = Object.fromEntries(m.opciones.filter((o) => o.decision === "aplicar").map((o) => [o.clave, true]));
  return [{}, aplicar, todas];
}

const relativo = (a: number, b: number) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b));

describe("Balance de incertidumbre por punto (EP-04 P5.2): una vista del cálculo validado", () => {
  const casos = [...CASOS_REFERENCIA, ...CASOS_1510, ...CASOS_LNF];

  it("cubre los 19 casos reales y todos los motores con planilla", () => {
    expect(casos).toHaveLength(19);
    const its = new Set(casos.map((c) => c.it));
    for (const it of Object.keys(REGISTRO_MOTORES).filter((k) => k !== "PUNTOS")) expect(its.has(it)).toBe(true);
  });

  it.each(casos.map((c) => [c.caso, c.it, c] as const))("%s (%s): √Σuᵢ² = uc del motor en cada punto, con y sin correcciones", (_caso, it, caso) => {
    for (const opt of variantes(it)) {
      const r = calcularConMotor(it, caso.datos, opt).resultado;
      const b = balancePorPunto(it, r, caso.datos, opt)!;
      expect(b).not.toBeNull();
      expect(b.puntos.length).toBeGreaterThan(0);
      for (const p of b.puntos) {
        expect(Number.isFinite(p.uc)).toBe(true);
        expect(relativo(p.uc, p.ucMotor)).toBeLessThan(1e-9);
        // Los aportes suman 100 % y cada uᵢ es una incertidumbre (≥ 0).
        expect(p.componentes.reduce((s, x) => s + x.aporte, 0)).toBeCloseTo(100, 9);
        for (const x of p.componentes) {
          expect(x.ui).toBeGreaterThanOrEqual(0);
          expect(x.nombre.length).toBeGreaterThan(3);
          expect(x.formula.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("U del balance = k·uc del motor (k = 2; LNF con su k de la planilla)", () => {
    const p808 = CASOS_REFERENCIA.find((c) => c.caso === "P-808")!;
    const r = calcularConMotor("ITP02", p808.datos).resultado;
    const b = balancePorPunto("ITP02", r, p808.datos, {})!;
    b.puntos.forEach((p, i) => expect(relativo(p.U, r.rows[i].L)).toBeLessThan(1e-12));
    const lnf = CASOS_LNF[0];
    const rl = calcularConMotor("LCPNF-IT01", lnf.datos).resultado;
    const bl = balancePorPunto("LCPNF-IT01", rl, lnf.datos, {})!;
    bl.puntos.forEach((p, i) => { expect(p.k).toBe(rl.rows[i].k); expect(relativo(p.U, rl.rows[i].U)).toBeLessThan(1e-12); });
  });

  it("formulario por puntos: u_A, u_p y u_r", () => {
    const d = { unidad: "V", series: 3, kPatron: 2, pts: [{ funcion: "VDC", nominal: 10, unidad: "V", res: 0.001, Upat: 0.0004, inst: [10.002, 10.003, 10.001], pat: [10, 10, 10] }] };
    const r = calcularConMotor("ITME01", d).resultado;
    const b = balancePorPunto("PUNTOS", r, d, {})!;
    expect(b.unidad).toBe("V");
    expect(b.puntos[0].componentes.map((x) => x.simbolo)).toEqual(["u_A", "u_p", "u_r"]);
    expect(relativo(b.puntos[0].uc, r.rows[0].uc)).toBeLessThan(1e-12);
  });

  it("sin motor, sin resultado o con un resultado ajeno no inventa un balance", () => {
    expect(balancePorPunto(null, {}, {}, {})).toBeNull();
    expect(balancePorPunto("ITM02", null, {}, {})).toBeNull();
    expect(balancePorPunto("NO_EXISTE", { rows: [] }, {}, {})).toBeNull();
    expect(balancePorPunto("ITM02", { rows: [] }, {}, {})).toBeNull();
  });

  it("no altera la paridad: 1531/1531, M-3947 y V-5920, y LCPNF-010.26 siguen idénticos", () => {
    const lmt = verificarParidad(), l1510 = verificarParidad1510(), lnf = verificarParidadLNF();
    expect(lmt.identicos).toBe(1531);
    expect(lmt.comparados).toBe(1531);
    expect(l1510.identicos).toBe(l1510.comparados);
    expect(lnf.identicos).toBe(lnf.comparados);
  });
});
