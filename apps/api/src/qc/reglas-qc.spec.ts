import { motivoNoRevisable, resultadoAlRegistrar } from "./reglas-qc";

describe("control de calidad · independencia", () => {
  it("un control que cumple el criterio queda pendiente de aprobación; uno que no, rechazado", () => {
    expect(resultadoAlRegistrar("aprobado")).toBe("pendiente");
    expect(resultadoAlRegistrar("rechazado")).toBe("rechazado");
    expect(resultadoAlRegistrar("pendiente")).toBe("pendiente");
  });

  it("quien registró el control no lo aprueba (409)", () => {
    expect(motivoNoRevisable("aprobado", { registradoPor: "u1" }, "u1", true)?.codigo).toBe(409);
  });

  it("aprobar exige resultado.revisar (403)", () => {
    expect(motivoNoRevisable("aprobado", { registradoPor: "u1" }, "u2", false)?.codigo).toBe(403);
  });

  it("otra persona con resultado.revisar sí aprueba; también los controles antiguos sin registrante", () => {
    expect(motivoNoRevisable("aprobado", { registradoPor: "u1" }, "u2", true)).toBeNull();
    expect(motivoNoRevisable("aprobado", { registradoPor: null }, "u1", true)).toBeNull();
  });

  it("rechazar o volver a pendiente no exige independencia", () => {
    expect(motivoNoRevisable("rechazado", { registradoPor: "u1" }, "u1", false)).toBeNull();
    expect(motivoNoRevisable("pendiente", { registradoPor: "u1" }, "u1", false)).toBeNull();
  });
});

describe("QC por método · tipos MRC y patrón, criterios por método (BL-167)", () => {
  const { criterioAplicable, tiposQcFaltantes, erroresConfigQc } = require("./reglas-qc") as typeof import("./reglas-qc");
  it("el criterio del control manda; si no, el del método; si no, el por defecto", () => {
    expect(criterioAplicable("mrc", "95-105", { mrc: "90-110" })).toBe("95-105");
    expect(criterioAplicable("mrc", null, { mrc: "97,5-102,5" })).toBe("97.5-102.5");
    expect(criterioAplicable("mrc", null, null)).toBe("90-110");
    expect(criterioAplicable("patron", undefined, {})).toBe("95-105");
    expect(criterioAplicable("blanco", null, null)).toBeNull();
  });
  it("con tipos exigidos falta uno aprobado de cada tipo; sin tipos basta uno cualquiera", () => {
    expect(tiposQcFaltantes(["blanco", "mrc"], ["blanco"])).toEqual(["mrc"]);
    expect(tiposQcFaltantes(["blanco", "mrc"], ["mrc", "blanco"])).toEqual([]);
    expect(tiposQcFaltantes([], [])).toEqual(["cualquiera"]);
    expect(tiposQcFaltantes([], ["curva"])).toEqual([]);
  });
  it("valida la configuración del método", () => {
    expect(erroresConfigQc({ qcTipos: ["mrc", "foo"] })).toEqual(["Tipo de control desconocido: foo."]);
    expect(erroresConfigQc({ qcCriterios: { mrc: "alto" } })[0]).toMatch(/número o un rango/);
    expect(erroresConfigQc({ qcTipos: ["mrc"], qcCriterios: { mrc: "90-110" } })).toEqual([]);
  });
});
