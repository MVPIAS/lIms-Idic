import { erroresRegla, resolverReglaValidez, type ReglaValidezConfig } from "./validez-config";

const LMT = "cc-lmt";
const REGLAS: ReglaValidezConfig[] = [
  { tipoCliente: "ejercito", centroCostoId: null, regla: "FIN_ANIO" },
  { tipoCliente: "armada", centroCostoId: null, regla: "FIN_ANIO", mesesOctDic: 4 },
  { tipoCliente: null, centroCostoId: LMT, regla: "DIAS", dias: 60 },
  { tipoCliente: "particulares", centroCostoId: "cc-lrb", regla: "DIAS", dias: 90 },
  { tipoCliente: "pdi", centroCostoId: null, regla: "FIN_ANIO", activo: false },
];

describe("validez por tipo de cliente y laboratorio (reunión 2)", () => {
  it("Ejército: hasta el 31-12 aunque el laboratorio tenga 60 días", () => {
    expect(resolverReglaValidez(REGLAS, { tipoCliente: "ejercito", centroCostoId: LMT, base: "EJERCITO" })).toMatchObject({ regla: "EJERCITO", origen: "tipo" });
  });
  it("FF.AA. configuradas como Ejército aunque su parámetro diga Particular, con sus meses", () => {
    expect(resolverReglaValidez(REGLAS, { tipoCliente: "armada", centroCostoId: null, base: "PARTICULAR" })).toEqual({ regla: "EJERCITO", dias: null, meses: 4, origen: "tipo" });
  });
  it("particular en Metrología: 60 días del laboratorio", () => {
    expect(resolverReglaValidez(REGLAS, { tipoCliente: "particulares", centroCostoId: LMT, base: "PARTICULAR" })).toEqual({ regla: "PARTICULAR", dias: 60, meses: null, origen: "laboratorio" });
  });
  it("la regla tipo+laboratorio manda sobre las demás", () => {
    expect(resolverReglaValidez(REGLAS, { tipoCliente: "particulares", centroCostoId: "cc-lrb", base: "PARTICULAR" })).toMatchObject({ dias: 90, origen: "tipo_laboratorio" });
  });
  it("la regla del laboratorio no se aplica a un tipo que sigue la regla Ejército", () => {
    expect(resolverReglaValidez(REGLAS, { tipoCliente: "institucional", centroCostoId: LMT, base: "EJERCITO" })).toMatchObject({ regla: "EJERCITO", origen: "general" });
  });
  it("una regla inactiva no cuenta; sin regla rige lo general", () => {
    expect(resolverReglaValidez(REGLAS, { tipoCliente: "pdi", centroCostoId: null, base: "PARTICULAR" })).toEqual({ regla: "PARTICULAR", dias: null, meses: null, origen: "general" });
  });
  it("valida la regla antes de guardarla", () => {
    expect(erroresRegla({ regla: "DIAS", dias: 45 })).toEqual(["Indique el tipo de cliente, el laboratorio o ambos."]);
    expect(erroresRegla({ tipoCliente: "x", regla: "DIAS", dias: 0 })[0]).toMatch(/días/);
    expect(erroresRegla({ tipoCliente: "x", regla: "FIN_ANIO", mesesOctDic: 30 })[0]).toMatch(/meses/);
    expect(erroresRegla({ centroCostoId: "y", regla: "FIN_ANIO" })).toEqual([]);
  });
});
