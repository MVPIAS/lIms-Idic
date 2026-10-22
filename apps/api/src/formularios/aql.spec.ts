import { decidir, evaluarInspeccion, letraCodigo, normalizarAql, planAql, planDeClase, planSimpleNormal } from "./aql";

describe("NCh 44 · tabla I (letra código)", () => {
  it("lote 70, nivel II → E (caso SVM del IVC 78772)", () => expect(letraCodigo(70, "II")).toBe("E"));
  it("tramos de borde", () => {
    expect(letraCodigo(8, "II")).toBe("A");
    expect(letraCodigo(9, "II")).toBe("B");
    expect(letraCodigo(1200, "II")).toBe("J");
    expect(letraCodigo(1201, "II")).toBe("K");
    expect(letraCodigo(600000, "III")).toBe("R");
    expect(letraCodigo(336, "S-3")).toBe("D");
  });
  it("lote inválido", () => expect(() => letraCodigo(1, "II")).toThrow(/2 o más/));
});

describe("NCh 44 · tabla II-A (simple, normal)", () => {
  it("ejemplos del IVC real del LCC (EP-03 §5)", () => {
    expect(planSimpleNormal("J", "1,5")).toEqual({ letraPlan: "J", n: 80, ac: 3, re: 4 });
    expect(planSimpleNormal("D", "6,5")).toEqual({ letraPlan: "D", n: 8, ac: 1, re: 2 });
    expect(planSimpleNormal("C", "2,5")).toEqual({ letraPlan: "C", n: 5, ac: 0, re: 1 });
  });
  it("diagonal 0/1 de cada letra", () => {
    expect(planSimpleNormal("E", "1,0")).toMatchObject({ n: 13, ac: 0, re: 1 });
    expect(planSimpleNormal("K", "0,10")).toMatchObject({ n: 125, ac: 0, re: 1 });
    expect(planSimpleNormal("Q", "0,010")).toMatchObject({ n: 1250, ac: 0, re: 1 });
  });
  it("flecha ↓ usa la letra siguiente y su n", () => {
    // E y AQL 2,5: ↓ → F (n = 20) 1/2.
    expect(planSimpleNormal("E", "2,5")).toEqual({ letraPlan: "F", n: 20, ac: 1, re: 2 });
    // A y AQL 1,0: ↓ hasta E (n = 13) 0/1.
    expect(planSimpleNormal("A", "1,0")).toEqual({ letraPlan: "E", n: 13, ac: 0, re: 1 });
  });
  it("flecha ↑ usa la letra anterior", () => {
    // L y AQL 0,10: ↑ → K (n = 125) 0/1.
    expect(planSimpleNormal("L", "0,10")).toEqual({ letraPlan: "K", n: 125, ac: 0, re: 1 });
    // L y AQL 10: pasado 21/22 → ↑ → K 21/22.
    expect(planSimpleNormal("L", "10")).toEqual({ letraPlan: "K", n: 125, ac: 21, re: 22 });
  });
  it("secuencia a lo largo de la fila J", () => {
    const fila = ["0,15", "0,65", "1,0", "1,5", "2,5", "4,0", "6,5", "10"].map((a) => planSimpleNormal("J", a));
    expect(fila.map((p) => `${p.ac}/${p.re}`)).toEqual(["0/1", "1/2", "2/3", "3/4", "5/6", "7/8", "10/11", "14/15"]);
    expect(fila.every((p) => p.n === 80)).toBe(true);
    // 0,25 = ↑ (H, n = 50, 0/1) y 0,40 = ↓ (K, n = 125, 1/2).
    expect(planSimpleNormal("J", "0,25")).toEqual({ letraPlan: "H", n: 50, ac: 0, re: 1 });
    expect(planSimpleNormal("J", "0,40")).toEqual({ letraPlan: "K", n: 125, ac: 1, re: 2 });
  });
  it("AQL mal escrito", () => {
    expect(normalizarAql("2.5")).toBe("2,5");
    expect(normalizarAql("2,50")).toBe("2,5");
    expect(normalizarAql("3")).toBeNull();
    expect(() => planSimpleNormal("E", "3")).toThrow(/AQL no válido/);
  });
});

describe("plan completo y decisión", () => {
  it("SVM: lote 70, nivel II, AQL 1,0 → E, n = 13, 0/1", () => {
    const p = planAql(70, "II", "1,0");
    expect(p).toMatchObject({ letra: "E", letraPlan: "E", n: 13, ac: 0, re: 1, inspeccionTotal: false });
    expect(p.texto).toContain("letra E");
  });
  it("n no supera el lote: inspección del 100 %", () => {
    const p = planAql(10, "II", "0,10"); // B → ↓ … n de la tabla > 10
    expect(p.n).toBe(10);
    expect(p.inspeccionTotal).toBe(true);
  });
  it("acepta si defectuosos ≤ Ac, rechaza si ≥ Re", () => {
    expect(decidir(3, 3, 4)).toBe("acepta");
    expect(decidir(4, 3, 4)).toBe("rechaza");
    expect(() => decidir(-1, 0, 1)).toThrow();
  });
});

describe("inspección por atributos del IVC (EP-03 3.7)", () => {
  it("evalúa cada inspección y el lote", () => {
    const r = evaluarInspeccion(1000, [
      { inspeccion: "Numeración", aql: "1,5", nivel: "II", defectuosos: 3 },
      { inspeccion: "Terminación", aql: "2,5", nivel: "II", defectuosos: 6 },
    ]);
    expect(r.errores).toEqual([]);
    expect(r.filas[0]).toMatchObject({ ac: 3, re: 4, cumplimiento: "cumple" });
    expect(r.filas[1]).toMatchObject({ ac: 5, re: 6, cumplimiento: "no_cumple" });
    expect(r.cumple).toBe(false);
  });
  it("pendiente sin defectuosos; error si superan n", () => {
    const r = evaluarInspeccion(1000, [{ inspeccion: "Embalaje", aql: "6,5", nivel: "II", defectuosos: null }]);
    expect(r.cumple).toBeNull();
    expect(r.filas[0].cumplimiento).toBe("pendiente");
    const e = evaluarInspeccion(20, [{ inspeccion: "Embalaje", aql: "6,5", nivel: "II", defectuosos: 50 }]);
    expect(e.errores.join(" ")).toMatch(/más defectuosos/);
  });
  it("Ac/Re manual exige motivo", () => {
    const sin = evaluarInspeccion(1000, [{ inspeccion: "X", aql: "1,5", nivel: "II", defectuosos: 1, acManual: 0, reManual: 1 }]);
    expect(sin.errores.join(" ")).toMatch(/motivo/);
    const con = evaluarInspeccion(1000, [{ inspeccion: "X", aql: "1,5", nivel: "II", defectuosos: 1, acManual: 0, reManual: 1, motivoManual: "Plan del contrato" }]);
    expect(con.filas[0]).toMatchObject({ ac: 0, re: 1, cumplimiento: "no_cumple" });
  });
  it("sin lote ni filas", () => {
    expect(evaluarInspeccion(0, []).errores.length).toBe(2);
  });
});

describe("AQL por clase de defecto", () => {
  it("«0» = una unidad rechaza (clase A)", () => expect(planDeClase(70, "II", "0")).toMatchObject({ ac: 0, re: 1 }));
  it("clase B con AQL 2,5 en lote 70", () => expect(planDeClase(70, "II", "2,5")).toMatchObject({ ac: 1, re: 2, n: 20 }));
});
