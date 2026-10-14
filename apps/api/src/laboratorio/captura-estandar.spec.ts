import { calcularCaptura, CapturaError } from "./captura-estandar";

const num = (o: object = {}) => ({ tipoDato: "numerico" as const, ...o });

describe("captura estándar · numérico", () => {
  it("valor directo con coma decimal y doble cota", () => {
    const r = calcularCaptura(num({ limiteInf: "0", limiteSup: "10" }), { valor: "12,4" });
    expect(r).toMatchObject({ valorNumerico: 12.4, veredicto: "no_cumple" });
  });
  it("sin límites → informativo", () => {
    expect(calcularCaptura(num(), { valor: 7 }).veredicto).toBe("informativo");
  });
  it("límites con coma decimal en la especificación", () => {
    expect(calcularCaptura(num({ limiteInf: "4,5", limiteSup: "5,5" }), { valor: "5" }).veredicto).toBe("cumple");
  });
  it("réplicas en texto → promedio, DE y CV", () => {
    const r = calcularCaptura(num({ limiteSup: "13" }), { replicasTexto: "12,4 12,6" });
    expect(r.promedio).toBeCloseTo(12.5, 10);
    expect(r.replicas).toEqual([12.4, 12.6]);
    expect(r.veredicto).toBe("cumple");
  });
  it("fórmula sobre réplicas («promedio(RN)» del catálogo sembrado)", () => {
    const r = calcularCaptura(num({ formula: "PROMEDIO(RN) * 100" }), { replicas: [0.1, 0.2] });
    expect(r.resultadoFinal).toBeCloseTo(15, 10);
    expect(r.formulaAplicada).toBe("PROMEDIO(RN) * 100");
  });
  it("lecturas con los campos del método y fórmula traducida del LIMS antiguo", () => {
    const formula = ":IF Len(sSql)= 3; :IF Val(sSql[3,2]) <> 0 ; Acum := Acum + (( Val(sSql[1,2]) - Val(sSql[2,2])) / Val(sSql[3,2])) * 100; :ENDIF; :ENDIF;";
    const r = calcularCaptura(num({ formula, limiteSup: "50" }), {
      lecturas: [{ C1: "12,5", C2: "10", C3: "10" }, { C1: 13, C2: 10, C3: 10 }],
    });
    expect(r.replicas).toEqual([25, 30]);
    expect(r.valorNumerico).toBeCloseTo(27.5, 10);
    expect(r.formulaAplicada).toBe("(( C1 - C2) / C3) * 100");
    expect(r.lecturas).toEqual([{ C1: 12.5, C2: 10, C3: 10 }, { C1: 13, C2: 10, C3: 10 }]);
    expect(r.veredicto).toBe("cumple");
  });
  it("lecturas sin fórmula por campos → error claro", () => {
    expect(() => calcularCaptura(num(), { lecturas: [{ C1: 1 }] })).toThrow(CapturaError);
  });
  it("celda vacía o ambigua en una lectura → error que dice dónde", () => {
    expect(() => calcularCaptura(num({ formula: "C1 / C2" }), { lecturas: [{ C1: 1, C2: "" }] })).toThrow(/Lectura 1, campo 2/);
  });
  it("división por cero en la fórmula → error, no un valor inventado", () => {
    expect(() => calcularCaptura(num({ formula: "C1 / C2" }), { lecturas: [{ C1: 1, C2: 0 }] })).toThrow(CapturaError);
  });
  it("número ambiguo se rechaza", () => {
    expect(() => calcularCaptura(num(), { valor: "1.234,5" })).toThrow(CapturaError);
  });
  it("texto en numérico sin referencia → pendiente (lo decide el revisor)", () => {
    expect(calcularCaptura(num({ limiteInf: "1" }), { valor: "no medible" }).veredicto).toBe("pendiente");
  });
  it("las variables reservadas no se pueden redefinir", () => {
    expect(() => calcularCaptura(num(), { valor: 1, variables: { PROMEDIO: 3 } })).toThrow(CapturaError);
  });
  it("sin nada que capturar → error", () => {
    expect(() => calcularCaptura(num(), {})).toThrow(/Ingrese el valor/);
  });
});

describe("captura estándar · atributo", () => {
  const atr = { tipoDato: "atributo" as const };
  it("el analista elige Cumple", () => {
    expect(calcularCaptura(atr, { atributo: "cumple" })).toMatchObject({ veredicto: "cumple", valorTexto: "Cumple" });
  });
  it("No cumple exige observación", () => {
    expect(() => calcularCaptura(atr, { atributo: "no_cumple" })).toThrow(/observación/);
    expect(calcularCaptura(atr, { atributo: "no_cumple", observacion: "Costura abierta" })).toMatchObject({
      veredicto: "no_cumple",
      observacion: "Costura abierta",
    });
  });
  it("lo observado se guarda como valor", () => {
    expect(calcularCaptura(atr, { atributo: "cumple", valor: "Tafetán" }).valorTexto).toBe("Tafetán");
  });
  it("sin elección: compara con una referencia de texto corta", () => {
    expect(calcularCaptura({ ...atr, nominal: "Ausencia" }, { valor: "ausencia" }).veredicto).toBe("cumple");
    expect(() => calcularCaptura(atr, { valor: "algo" })).toThrow(/Cumple o No cumple/);
  });
});
