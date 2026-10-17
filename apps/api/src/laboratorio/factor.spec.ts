import { aplicarFactor, erroresFactor, expresionConFactor, factorDe, puedeAjustarFactor, textoFactor } from "./factor";
import { calcularCaptura } from "./captura-estandar";

describe("factor de la fórmula", () => {
  it("lee el factor de las columnas; NULL, 0 u operación desconocida = sin factor", () => {
    expect(factorDe("10", "multiplicar")).toEqual({ valor: 10, operacion: "multiplicar", descripcion: null });
    expect(factorDe(null, "dividir")).toBeNull();
    expect(factorDe(0, "dividir")).toBeNull();
    expect(factorDe(2, "sumar")).toBeNull();
  });
  it("multiplica o divide", () => {
    expect(aplicarFactor(0.134, { valor: 10, operacion: "dividir" })).toBeCloseTo(0.0134, 10);
    expect(aplicarFactor(2.5, { valor: 4, operacion: "multiplicar" })).toBe(10);
    expect(aplicarFactor(7, null)).toBe(7);
  });
  it("valida lo pedido", () => {
    expect(erroresFactor({ valor: null, operacion: null })).toEqual([]);
    expect(erroresFactor({ valor: 0, operacion: "multiplicar" })).toHaveLength(1);
    expect(erroresFactor({ valor: 2, operacion: "sumar" })).toHaveLength(1);
    expect(erroresFactor({ valor: 1, operacion: "dividir" })[0]).toMatch(/no cambia/);
  });
  it("expresión y texto legibles", () => {
    expect(expresionConFactor("(C1 - C2) / C3 * 100", { valor: 10, operacion: "multiplicar" })).toBe("((C1 - C2) / C3 * 100) * 10");
    expect(expresionConFactor("PROMEDIO(RN)", { valor: 2.5, operacion: "dividir" })).toBe("PROMEDIO(RN) / 2.5");
    expect(textoFactor({ valor: 2.5, operacion: "dividir" })).toBe("÷ 2,5");
    expect(textoFactor(null)).toBe("sin factor");
  });
  it("regla parametrizable: quien tiene resultado.factor (la jefatura por defecto)", () => {
    expect(puedeAjustarFactor({ roles: ["JEFE_LAB"], permisos: ["resultado.factor"] })).toBe(true);
    expect(puedeAjustarFactor({ roles: ["ANALISTA"], permisos: ["resultado.crear"] })).toBe(false);
    expect(puedeAjustarFactor({ roles: ["ANALISTA"], permisos: ["resultado.crear", "resultado.factor"] })).toBe(true);
    expect(puedeAjustarFactor({ roles: ["SUPERADMIN"], permisos: [] })).toBe(true);
    expect(puedeAjustarFactor(undefined)).toBe(false);
  });
});

describe("factor en la captura", () => {
  const num = (o: object = {}) => ({ tipoDato: "numerico" as const, ...o });
  it("lecturas: el factor se aplica al promedio y queda en la fórmula aplicada", () => {
    const r = calcularCaptura(num({ formula: "C1 / C2", limiteSup: "0,05", factor: { valor: 10, operacion: "dividir" } }), {
      lecturas: [{ C1: "0,156", C2: "1" }],
    });
    expect(r.valorSinFactor).toBeCloseTo(0.156, 10);
    expect(r.valorNumerico).toBeCloseTo(0.0156, 10);
    expect(r.formulaAplicada).toBe("(C1 / C2) / 10");
    expect(r.factorAplicado).toBe(true);
    expect(r.veredicto).toBe("cumple");
  });
  it("réplicas sin fórmula: promedio por el factor", () => {
    const r = calcularCaptura(num({ factor: { valor: 2, operacion: "multiplicar" } }), { replicasTexto: "1 3" });
    expect(r.promedio).toBe(2);
    expect(r.valorNumerico).toBe(4);
    expect(r.formulaAplicada).toBe("PROMEDIO(RN) * 2");
  });
  it("réplicas con fórmula: la fórmula y luego el factor", () => {
    const r = calcularCaptura(num({ formula: "PROMEDIO(RN) * 100", factor: { valor: 4, operacion: "dividir" } }), { replicas: [0.1, 0.3] });
    expect(r.valorSinFactor).toBeCloseTo(20, 10);
    expect(r.valorNumerico).toBeCloseTo(5, 10);
  });
  it("el valor final ingresado directamente no se toca", () => {
    const r = calcularCaptura(num({ factor: { valor: 10, operacion: "multiplicar" } }), { valor: "7,2" });
    expect(r.valorNumerico).toBe(7.2);
    expect(r.factorAplicado).toBe(false);
    expect(r.valorSinFactor).toBeNull();
  });
});
