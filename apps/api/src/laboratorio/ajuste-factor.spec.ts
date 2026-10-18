import { MOTIVO_VALOR_DIRECTO, planAjusteFactor } from "./ajuste-factor";

describe("ajuste del factor sobre ensayos ya capturados (revisión r3, hallazgo 9)", () => {
  const x10 = { valor: 10, operacion: "multiplicar" as const };
  const base = { tipoDato: "numerico", limiteInf: "0", limiteSup: "5" };

  it("captura antigua sin valor sin factor pero con réplicas: recalcula desde las réplicas", () => {
    const p = planAjusteFactor({ ...base, replicas: [0.3, 0.3], valorNumerico: "0.3", promedio: "0.3", valorSinFactor: null }, x10);
    expect(p.accion).toBe("recalcular");
    if (p.accion !== "recalcular") return;
    expect(p.datos.valorNumerico).toBeCloseTo(3, 12);
    expect(p.datos.valorSinFactor).toBeCloseTo(0.3, 12);
    expect(p.datos.formulaAplicada).toBe("PROMEDIO(RN) * 10");
    expect(p.datos.veredicto).toBe("cumple");
    expect("lecturas" in p.datos).toBe(false);
  });
  it("con lecturas y fórmula por campos: recalcula desde las lecturas", () => {
    const p = planAjusteFactor({ ...base, limiteSup: "100", formula: "C1 - C2", lecturas: [{ C1: 5, C2: 1 }, { C1: 6, C2: 2 }], valorNumerico: 4 }, x10);
    expect(p.accion === "recalcular" && p.datos.valorNumerico).toBe(40);
  });
  it("valor ingresado directo: el factor no se aplica y se devuelve como omitido con el motivo", () => {
    expect(planAjusteFactor({ ...base, valorNumerico: "7.4", valorTexto: "7.4" }, x10)).toEqual({ accion: "omitir", motivo: MOTIVO_VALOR_DIRECTO });
  });
  it("sin lecturas ni réplicas pero con el valor antes del factor: recalcula desde él", () => {
    const p = planAjusteFactor({ ...base, valorNumerico: "0.6", valorSinFactor: "0.3" }, { valor: 2, operacion: "dividir" });
    expect(p.accion === "recalcular" && p.datos.valorNumerico).toBeCloseTo(0.15, 12);
  });
  it("sin valor aún o atributo: solo se fija el factor (se aplicará al capturar)", () => {
    expect(planAjusteFactor({ ...base }, x10)).toEqual({ accion: "solo_factor" });
    expect(planAjusteFactor({ tipoDato: "atributo", valorTexto: "Cumple" }, x10)).toEqual({ accion: "solo_factor" });
  });
  it("quitar el factor recalcula sin él", () => {
    const p = planAjusteFactor({ ...base, replicas: [2, 4], valorNumerico: 6 }, null);
    expect(p.accion === "recalcular" && p.datos.valorNumerico).toBe(3);
  });
});
