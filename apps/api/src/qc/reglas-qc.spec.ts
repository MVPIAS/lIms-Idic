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
