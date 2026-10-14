import { esNumeroTexto, planEdicion, tipoDatoDe, veredictoMuestra } from "./especificacion";

describe("especificación · tipoDatoDe", () => {
  it("numérico si alguna cota es número (coma o punto)", () => {
    expect(tipoDatoDe({ limiteInf: "0,5", limiteSup: "10" })).toBe("numerico");
    expect(tipoDatoDe({ nominal: "3.5" })).toBe("numerico");
  });
  it("atributo si la especificación es de texto", () => {
    expect(tipoDatoDe({ requisito: "Tafetán, tipo oxford." })).toBe("atributo");
    expect(tipoDatoDe({ nominal: "Ausencia" })).toBe("atributo");
  });
  it("sin especificación → numérico (informativo hasta que alguien ponga límites)", () => {
    expect(tipoDatoDe({})).toBe("numerico");
  });
  it("esNumeroTexto", () => {
    expect(esNumeroTexto(" 12,4 ")).toBe(true);
    expect(esNumeroTexto("1.234,5")).toBe(false);
    expect(esNumeroTexto("Grado 4")).toBe(false);
  });
});

describe("especificación · veredicto de la muestra (lote)", () => {
  it("No cumple si algún ensayo no cumple (aunque falten otros)", () => {
    expect(veredictoMuestra(["cumple", "no_cumple", "pendiente"])).toBe("no_cumple");
  });
  it("Pendiente si falta alguno", () => {
    expect(veredictoMuestra(["cumple", "pendiente"])).toBe("pendiente");
    expect(veredictoMuestra(["cumple", null])).toBe("pendiente");
  });
  it("Cumple si todos cumplen; los informativos no cuentan en contra", () => {
    expect(veredictoMuestra(["cumple", "Cumple", "informativo"])).toBe("cumple");
  });
  it("todos informativos → informativo; sin ensayos → pendiente", () => {
    expect(veredictoMuestra(["informativo", "informativo"])).toBe("informativo");
    expect(veredictoMuestra([])).toBe("pendiente");
  });
});

describe("especificación · planEdicion (de la orden)", () => {
  const catalogoVacio = {};
  const catalogoLleno = { limiteInf: "0", limiteSup: "10", unidad: "%", tipoDato: "numerico" };

  it("rellenar lo que el catálogo no trae lo hace quien captura", () => {
    const p = planEdicion({}, catalogoVacio, { limiteInf: "5", limiteSup: "8,5", unidad: "MPa" });
    expect(p.requiereJefatura).toBe(false);
    expect(p.cambios).toEqual({ limiteInf: "5", limiteSup: "8,5", unidad: "MPa" });
  });
  it("cambiar un valor que vino del catálogo exige jefatura", () => {
    expect(planEdicion(catalogoLleno, catalogoLleno, { limiteSup: "12" }).requiereJefatura).toBe(true);
  });
  it("la fórmula siempre la cambia la jefatura", () => {
    expect(planEdicion({}, catalogoVacio, { formula: "C1 * 9.81" }).requiereJefatura).toBe(true);
  });
  it("el tipo de dato: libre si el catálogo no traía especificación; jefatura si la traía", () => {
    expect(planEdicion({ tipoDato: "numerico" }, { tipoDato: "numerico" }, { tipoDato: "atributo" }).requiereJefatura).toBe(false);
    expect(planEdicion(catalogoLleno, catalogoLleno, { tipoDato: "atributo" }).requiereJefatura).toBe(true);
  });
  it("sin cambios reales no hay nada que guardar", () => {
    const p = planEdicion(catalogoLleno, catalogoLleno, { limiteInf: " 0 ", unidad: "%" });
    expect(p.campos).toEqual([]);
  });
  it("vaciar un campo que vino del catálogo también exige jefatura", () => {
    expect(planEdicion(catalogoLleno, catalogoLleno, { limiteInf: "" })).toMatchObject({ requiereJefatura: true, cambios: { limiteInf: null } });
  });
});
