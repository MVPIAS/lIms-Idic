import { codigosSucdel, deducirLaboratorio, mensajeLaboratorioRequerido } from "./laboratorio-ot";

describe("laboratorio responsable · deducirLaboratorio", () => {
  it("sin pistas → hay que elegirlo", () => {
    const d = deducirLaboratorio([]);
    expect(d).toMatchObject({ unidadId: null, motivo: "sin_pistas" });
    expect(mensajeLaboratorioRequerido(d)).toMatch(/Indique el laboratorio responsable/);
  });

  it("todas las pistas apuntan al mismo laboratorio → deducido", () => {
    const d = deducirLaboratorio([
      { unidadId: "LQC", fuente: "ensayo" },
      { unidadId: "LQC", fuente: "elemento" },
      { unidadId: "LQC", fuente: "metodo" },
    ]);
    expect(d).toMatchObject({ unidadId: "LQC", motivo: "deducido" });
    expect(d.fuentes.sort()).toEqual(["elemento", "ensayo", "metodo"]);
  });

  it("ensayos de laboratorios distintos y sin centro de costo → ambiguo, se exige elegir", () => {
    const d = deducirLaboratorio([
      { unidadId: "LQC", fuente: "ensayo" },
      { unidadId: "LPN", fuente: "ensayo" },
    ]);
    expect(d).toMatchObject({ unidadId: null, motivo: "ambiguo" });
    expect(d.candidatos.sort()).toEqual(["LPN", "LQC"]);
    expect(mensajeLaboratorioRequerido(d)).toMatch(/2 laboratorios distintos/);
  });

  it("el centro de costo de la cotización manda sobre las familias de los ensayos", () => {
    const d = deducirLaboratorio([
      { unidadId: "LQC", fuente: "centro_costo" },
      { unidadId: "LPN", fuente: "ensayo" },
    ]);
    expect(d).toMatchObject({ unidadId: "LQC", motivo: "deducido", fuentes: ["centro_costo"] });
  });

  it("dos centros de costo distintos no deciden: se mira el conjunto", () => {
    const d = deducirLaboratorio([
      { unidadId: "LQC", fuente: "centro_costo" },
      { unidadId: "LPN", fuente: "centro_costo" },
    ]);
    expect(d.motivo).toBe("ambiguo");
  });

  it("ignora pistas vacías", () => {
    expect(deducirLaboratorio([{ unidadId: "", fuente: "ensayo" }]).motivo).toBe("sin_pistas");
  });
});

describe("laboratorio responsable · codigosSucdel", () => {
  it("separa los CODSUCDEL compuestos de una unidad (Delegación Nº 11 = 3009/3008)", () => {
    expect(codigosSucdel("3009/3008")).toEqual(["3009", "3008"]);
    expect(codigosSucdel(" 7003 ")).toEqual(["7003"]);
    expect(codigosSucdel(null)).toEqual([]);
  });
});
