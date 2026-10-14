import { calcularPuntos } from "./puntos";
import { calcularConMotor, motorDeProceso } from "./index";

const base = () => ({
  unidad: "V", series: 3, kPatron: 2,
  pts: [{ funcion: "VDC", nominal: 10, unidad: "V", res: 0.001, Upat: 0.0004, emp: 0.01, inst: [10.002, 10.003, 10.001], pat: [10, 10, 10] }],
});

describe("Formulario estándar por puntos (eléctrica, tiempo y reserva)", () => {
  it("error = promedio(instrumento − patrón); u_A = s/√n; U = 2·√(u_A² + u_p² + u_r²)", () => {
    const r = calcularPuntos(base()).rows[0];
    expect(r.err).toBeCloseTo(0.002, 12);
    const uA = 0.001 / Math.sqrt(3), uP = 0.0002, uR = 0.001 / (2 * Math.sqrt(3));
    expect(r.uA).toBeCloseTo(uA, 15);
    expect(r.uP).toBeCloseTo(uP, 15);
    expect(r.uR).toBeCloseTo(uR, 15);
    expect(r.U).toBeCloseTo(2 * Math.sqrt(uA * uA + uP * uP + uR * uR), 15);
  });

  it("veredicto con incertidumbre por defecto (|ē| + U ≤ EMP) y regla simple opcional", () => {
    const d: any = base();
    d.pts[0].emp = 0.0025; // |ē| = 0,002 cumple solo sin sumar U
    expect(calcularPuntos(d).rows[0].conforme).toBe(false);
    expect(calcularPuntos({ ...d, regla: "simple" }).rows[0].conforme).toBe(true);
  });

  it("sin tolerancia no hay veredicto (queda vacío y editable)", () => {
    const d: any = base();
    d.pts[0].emp = null;
    const r = calcularConMotor("ITME01", d).resumen;
    expect(r.puntos[0].conforme).toBeNull();
    expect(r.conforme).toBeNull();
  });

  it("sin resolución no se suma u_r", () => {
    const d: any = base();
    d.pts[0].res = null;
    expect(calcularPuntos(d).rows[0].uR).toBe(0);
  });

  it("exige lecturas completas y la U del patrón; ignora filas vacías", () => {
    const d: any = base();
    d.pts.push({ nominal: null, inst: [null, null, null], pat: [null, null, null] });
    expect(calcularPuntos(d).rows).toHaveLength(1);
    d.pts[0].inst[2] = null;
    expect(() => calcularPuntos(d)).toThrow(/Faltan lecturas/);
    const e: any = base();
    e.pts[0].Upat = null;
    expect(() => calcularPuntos(e)).toThrow(/incertidumbre del patrón/);
    expect(() => calcularPuntos({ pts: [] })).toThrow(/al menos un punto/);
  });

  it("eléctrica (ITME01), tiempo (ITE03) y la reserva PTS01 usan este formulario", () => {
    for (const p of ["ITME01", "ITE03", "PTS01"]) expect(motorDeProceso(p)?.it).toBe("PUNTOS");
  });
});
