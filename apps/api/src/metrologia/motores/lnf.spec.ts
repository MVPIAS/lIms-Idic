import { CASOS_LNF, verificarCasoLNF, verificarParidadLNF } from "./paridad-lnf";
import { calcularLNF, inversa } from "./lnf";
import { calcularConMotor, motorDeProceso } from "./index";

describe("Motor LNF · ISO 376 · paridad con la planilla LCPNF-010.26", () => {
  const caso = CASOS_LNF[0];

  it("todos los valores comparados son idénticos a la planilla", () => {
    const c = verificarCasoLNF(caso);
    expect(c.n).toBe(483);
    expect(c.ok).toBe(c.n);
  });

  it("verificarParidadLNF resume el caso real", () => {
    const p = verificarParidadLNF();
    expect(p.casos).toHaveLength(1);
    expect(p.identicos).toBe(p.comparados);
  });

  it("coeficientes impresos en el certificado (S = a·F + b·F² + c·F³)", () => {
    const r = calcularLNF(caso.datos);
    expect(r.coef.S3[0]).toBe(0.0017167343258588652);
    expect(r.coef.S3[2]).toBe(-6.59975053462201e-13);
    expect(r.coef.F3[0]).toBe(582.4989468061831);
  });

  it("clase 2 en todos los rangos; la CMC del patrón (0,1 %) es la que manda", () => {
    const r = calcularLNF(caso.datos);
    expect(r.rangos.every((x) => x.clase === "2")).toBe(true);
    expect(r.rows.every((x: any) => x.cls.ubmc === 2)).toBe(true);
  });

  it("U95 del primer punto = 0,1778 % con k = 1,96; con k = 2 (hallazgo G3) sube en proporción", () => {
    const a = calcularLNF(caso.datos), b = calcularLNF(caso.datos, { k2: true });
    expect(a.rows[0].U).toBeCloseTo(0.17782270567856304, 15);
    expect(b.rows[0].U / a.rows[0].U).toBeCloseTo(2 / 1.96, 12);
  });

  it("filas sin fuerza se ignoran; menos de 3 puntos es un error", () => {
    const d = structuredClone(caso.datos);
    d.pts.push({ F: null, s: [null, null, null, null, null, null] });
    expect(calcularLNF(d).rows).toHaveLength(10);
    d.pts = d.pts.slice(0, 2);
    expect(() => calcularLNF(d)).toThrow();
  });

  it("la inversa por LU con pivoteo devuelve la identidad", () => {
    const m = [[4, 3, 2], [3, 5, 1], [2, 1, 6]];
    const inv = inversa(m);
    const id = m.map((r, i) => inv[0].map((_, j) => r.reduce((s, x, k) => s + x * inv[k][j], 0)));
    id.forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 12)));
  });

  it("registrado como motor del proceso LCPNF-IT01 con resumen en %", () => {
    expect(motorDeProceso("LCPNF-IT01")?.it).toBe("LCPNF-IT01");
    const { resumen } = calcularConMotor("LCPNF-IT01", caso.datos);
    expect(resumen.puntos).toHaveLength(10);
    expect(resumen.puntos[0].clase).toBe("2");
    expect(resumen.uCert).toBeCloseTo(0.17782270567856304, 15);
  });
});
