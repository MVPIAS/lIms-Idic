import { evaluarFormula } from "../common/formula";
import { filasDePlanilla, formulaDesdeExcel, indiceColumna, letraColumna, variableDeCabecera } from "./formula-excel";

describe("fórmulas desde Excel (§4.3.4)", () => {
  // Columnas: A Método · B Analito · C Fórmula · D C1 · E C2 · F C3
  const vars = [null, null, null, "C1", "C2", "C3"];

  it("columnas y cabeceras", () => {
    expect(indiceColumna("A")).toBe(0);
    expect(indiceColumna("AA")).toBe(26);
    expect(letraColumna(27)).toBe("AB");
    expect(variableDeCabecera("C1 masa (g)")).toBe("C1");
    expect(variableDeCabecera("rn2")).toBe("RN2");
    expect(variableDeCabecera("factor")).toBe("factor");
    expect(variableDeCabecera("Masa de la muestra")).toBeNull();
  });

  it("fórmula de celda de la misma fila → variables de la cabecera", () => {
    const r = formulaDesdeExcel("=(E2*F2*1.4)/D2", vars);
    expect(r).toEqual({ formula: "(C2*C3*1.4)/C1", error: null });
    expect(evaluarFormula(r.formula!, { C1: 1, C2: 12.3, C3: 0.1 })).toBeCloseTo(1.722, 6);
    expect(formulaDesdeExcel("=$D$2*100", vars).formula).toBe("C1*100");
  });

  it("funciones de Excel (inglés o español), rangos y separador «;» con coma decimal", () => {
    expect(formulaDesdeExcel("=AVERAGE(D2:F2)", vars).formula).toBe("PROMEDIO(C1,C2,C3)");
    expect(formulaDesdeExcel("=ROUND(SQRT(D2),2)", vars).formula).toBe("REDONDEAR(RAIZ(C1),2)");
    expect(formulaDesdeExcel("=REDONDEAR(D2*0,5;2)", vars).formula).toBe("REDONDEAR(C1*0.5,2)");
    expect(formulaDesdeExcel("(C2*C3*1,4)/C1", vars).formula).toBe("(C2*C3*1.4)/C1");
  });

  it("errores claros", () => {
    expect(formulaDesdeExcel("=Hoja2!A1*2", vars).error).toMatch(/otra hoja/);
    expect(formulaDesdeExcel("=VLOOKUP(D2,A1:B9,2)", vars).error).toMatch(/columna|VLOOKUP/);
    expect(formulaDesdeExcel("=IF(D2>1,1,0)", vars).error).toMatch(/IF/);
    expect(formulaDesdeExcel("=G2*2", vars).error).toMatch(/columna G/);
    expect(formulaDesdeExcel("=(D2*", vars).error).toBeTruthy();
    expect(formulaDesdeExcel("", vars).error).toBe("Sin fórmula.");
  });

  it("planilla completa", () => {
    const p = filasDePlanilla([
      ["Método", "Analito", "Fórmula", "C1 masa (g)", "C2 volumen (mL)", "C3 normalidad"],
      ["403", "PROT", "=(E2*F2*1.4)/D2", "1", "12,3", "0,1"],
      ["", "", "", "", "", ""],
      ["395", "", "=D4*2", "", "", ""],
      ["395", "HUM", "=SIN(D5)", "", "", ""],
    ]);
    expect(p.error).toBeNull();
    expect(p.filas.map((f) => [f.fila, f.formula, f.error])).toEqual([
      [2, "(C2*C3*1.4)/C1", null],
      [4, "C1*2", "Indique el método y el analito."],
      [5, null, "La función SIN de Excel no está disponible en el LIMS."],
    ]);
    expect(filasDePlanilla([["Código", "Fórmula"], ["1", "=2"]]).error).toMatch(/Método/);
  });
});
