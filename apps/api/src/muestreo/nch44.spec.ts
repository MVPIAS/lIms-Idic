import {
  PlanError,
  indiceAql,
  letraCodigo,
  periodoExtraccion,
  planNormal,
  proponerPlan,
  seleccionSistematica,
  veredictoLote,
} from "./nch44";

describe("NCh 44 · tabla 1 (letra código)", () => {
  it("SVM: lote 70, nivel II → E (EP-05 §5.5)", () => {
    expect(letraCodigo(70, "II")).toBe("E");
  });
  it("límites de los tramos", () => {
    expect(letraCodigo(8, "II")).toBe("A");
    expect(letraCodigo(9, "II")).toBe("B");
    expect(letraCodigo(3200, "II")).toBe("K");
    expect(letraCodigo(3201, "II")).toBe("L");
    expect(letraCodigo(500001, "III")).toBe("R");
    expect(letraCodigo(1000, "S-1")).toBe("C");
    expect(letraCodigo(1000, "S-2")).toBe("C");
    expect(letraCodigo(20000, "S-4")).toBe("H");
  });
  it("rechaza lotes no válidos", () => {
    expect(() => letraCodigo(1, "II")).toThrow(PlanError);
    expect(() => letraCodigo(10.5, "II")).toThrow(PlanError);
  });
});

describe("NCh 44 · tabla 2-A (plan simple normal)", () => {
  it("ejemplos reales del IVC del LCC (EP-03 §5)", () => {
    expect(planNormal("J", "1,5")).toMatchObject({ letra: "J", n: 80, ac: 3, re: 4, flecha: null });
    expect(planNormal("D", 6.5)).toMatchObject({ letra: "D", n: 8, ac: 1, re: 2, flecha: null });
  });
  it("planes conocidos de la letra K (n = 125)", () => {
    expect(planNormal("K", 1)).toMatchObject({ ac: 3, re: 4 });
    expect(planNormal("K", 2.5)).toMatchObject({ ac: 7, re: 8 });
    expect(planNormal("K", 4)).toMatchObject({ ac: 10, re: 11 });
    expect(planNormal("K", 10)).toMatchObject({ ac: 21, re: 22 });
  });
  it("flecha ↓: E con AQL 2,5 pasa a F (n = 20, 1/2)", () => {
    expect(planNormal("E", "2,5")).toMatchObject({ letra: "F", n: 20, ac: 1, re: 2, flecha: "abajo" });
  });
  it("flecha ↑: E con AQL 1,5 pasa a D (n = 8, 0/1)", () => {
    expect(planNormal("E", 1.5)).toMatchObject({ letra: "D", n: 8, ac: 0, re: 1, flecha: "arriba" });
  });
  it("flecha ↓ a la izquierda del 0/1: A con AQL 0,65 baja hasta el primer 0/1", () => {
    expect(planNormal("A", 0.65)).toMatchObject({ letra: "F", n: 20, ac: 0, re: 1, flecha: "abajo" });
  });
  it("columnas de AQL ≤ 10 terminan en 21/22: L con AQL 10 sube a K", () => {
    expect(planNormal("L", 10)).toMatchObject({ letra: "K", ac: 21, re: 22, flecha: "arriba" });
  });
  it("columnas por 100 unidades admiten 30/31 y 44/45", () => {
    expect(planNormal("A", 1000)).toMatchObject({ ac: 30, re: 31 });
    expect(planNormal("B", 1000)).toMatchObject({ ac: 44, re: 45 });
    expect(planNormal("C", 1000)).toMatchObject({ letra: "B", ac: 44, re: 45, flecha: "arriba" });
  });
  it("AQL fuera de la tabla", () => {
    expect(indiceAql("3")).toBe(-1);
    expect(() => planNormal("E", 3)).toThrow(/no es una columna/);
  });
});

describe("Plan propuesto del lote", () => {
  it("SVM lote 70 nivel II: E, n = 13; con AQL por clase", () => {
    const p = proponerPlan({ tamanoLote: 70, nivel: "II", aql: { mayor: "4,0", menor: 6.5 } });
    expect(p.letra).toBe("E");
    expect(p.n).toBe(13);
    expect(p.clases.mayor).toMatchObject({ ac: 1, re: 2, n: 13 });
    expect(p.clases.menor).toMatchObject({ ac: 2, re: 3, n: 13 });
    expect(p.nExtraer).toBe(13);
    expect(p.inspeccion100).toBe(false);
  });
  it("la flecha agranda la muestra a extraer", () => {
    const p = proponerPlan({ tamanoLote: 70, nivel: "II", aql: { mayor: 2.5 } });
    expect(p.clases.mayor).toMatchObject({ letra: "F", n: 20 });
    expect(p.nExtraer).toBe(20);
    expect(p.avisos.join(" ")).toMatch(/letra F/);
  });
  it("n ≥ lote → 100 %", () => {
    const p = proponerPlan({ tamanoLote: 6, nivel: "III", aql: { mayor: 0.65 } });
    expect(p.inspeccion100).toBe(true);
    expect(p.nExtraer).toBe(6);
  });
  it("tablas 2-B y 2-C: solo la letra, con aviso", () => {
    const p = proponerPlan({ tamanoLote: 70, nivel: "II", tabla: "reducida", aql: { mayor: 4 } });
    expect(p.letra).toBe("E");
    expect(p.clases).toEqual({});
    expect(p.avisos[0]).toMatch(/no está cargada/);
  });
});

describe("NCh 43 · selección sistemática", () => {
  it("SVM: lote 70, muestra 13 → paso 5 desde la Nº 2", () => {
    expect(periodoExtraccion(70, 13)).toBe(5);
    expect(seleccionSistematica(70, 13, 2)).toEqual([2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57, 62]);
  });
  it("el inicio va de 1 al paso", () => {
    expect(() => seleccionSistematica(70, 13, 6)).toThrow(/entre 1 y 5/);
    expect(() => seleccionSistematica(70, 13, 0)).toThrow(PlanError);
  });
  it("un paso manual demasiado grande no alcanza", () => {
    expect(() => seleccionSistematica(70, 13, 1, 10)).toThrow(/solo se alcanzan/);
  });
});

describe("Veredicto del lote por clase de defecto", () => {
  it("acepta con defectuosas ≤ Ac y rechaza con ≥ Re", () => {
    expect(veredictoLote([{ clase: "mayor", defectuosas: 1, ac: 1, re: 2 }]).veredicto).toBe("acepta");
    expect(veredictoLote([{ clase: "mayor", defectuosas: 2, ac: 1, re: 2 }]).veredicto).toBe("rechaza");
  });
  it("sin plan: por defecto una NC rechaza", () => {
    expect(veredictoLote([{ clase: "menor", defectuosas: 1 }]).veredicto).toBe("rechaza");
  });
  it("sin plan con «crítica o mayor»: la menor se informa, la crítica rechaza", () => {
    expect(veredictoLote([{ clase: "menor", defectuosas: 3 }], { reglaSinPlan: "critica_o_mayor" }).veredicto).toBe("acepta");
    expect(veredictoLote([{ clase: "critico", defectuosas: 1 }], { reglaSinPlan: "critica_o_mayor" }).veredicto).toBe("rechaza");
  });
  it("pendiente si quedan ensayos sin decidir y nada rechaza", () => {
    expect(veredictoLote([{ clase: "mayor", defectuosas: 0, ac: 1, re: 2 }], { pendientes: 2 }).veredicto).toBe("pendiente");
    expect(veredictoLote([{ clase: "mayor", defectuosas: 2, ac: 1, re: 2 }], { pendientes: 2 }).veredicto).toBe("rechaza");
  });
});
