import { puedeVerDocumento } from "./alcance-documento";

describe("B-002 · quién abre un documento", () => {
  const LMB = "lmb", LQA = "lqa";
  const doc = { unidadId: LMB, otUnidadId: LQA, emitidoPor: "jefe-lqa", responsables: ["revisor-lmb"] };
  const ve = (labs: string[]) => (u: string | null) => !!u && labs.includes(u);

  it("el laboratorio del documento (LMB) lo abre", () => {
    expect(puedeVerDocumento(doc, "analista-lmb", ve([LMB]))).toBe(true);
  });
  it("el laboratorio responsable de la OT (LQA) abre el informe del LMB", () => {
    expect(puedeVerDocumento(doc, "otro-lqa", ve([LQA]))).toBe(true);
  });
  it("quien lo emitió lo abre aunque no tenga el laboratorio", () => {
    expect(puedeVerDocumento(doc, "jefe-lqa", ve([]))).toBe(true);
  });
  it("el responsable de un paso de la firma lo abre", () => {
    expect(puedeVerDocumento(doc, "revisor-lmb", ve([]))).toBe(true);
  });
  it("un laboratorio ajeno no lo abre", () => {
    expect(puedeVerDocumento(doc, "jefe-lpn", ve(["lpn"]))).toBe(false);
    expect(puedeVerDocumento({ ...doc, otUnidadId: null }, null, ve([LQA]))).toBe(false);
  });
});
