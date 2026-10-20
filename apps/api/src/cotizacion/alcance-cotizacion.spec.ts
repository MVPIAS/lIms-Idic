import { cotizacionEnAlcance } from "./alcance-cotizacion";

describe("alcance de las escrituras sobre cotizaciones", () => {
  it("alcance global para el permiso (Comercial): todas", () => {
    expect(cotizacionEnAlcance(null, ["LQC"], "DCO")).toBe(true);
  });

  it("jefatura de un departamento técnico: solo las de sus laboratorios", () => {
    expect(cotizacionEnAlcance(["DQO", "SQU", "LQC"], ["LQC"], "DCO")).toBe(true);
    expect(cotizacionEnAlcance(["DSA", "SAM", "LMT"], ["LQC"], "DCO")).toBe(false);
  });

  it("jefatura del Departamento Comercial: todas (emite las cotizaciones)", () => {
    expect(cotizacionEnAlcance(["DCO", "SVT", "SPC"], ["LQC"], "DCO")).toBe(true);
    expect(cotizacionEnAlcance(["DCO"], [], "DCO")).toBe(true);
  });

  it("cotización sin laboratorio todavía: solo Comercial o alcance global", () => {
    expect(cotizacionEnAlcance(["LQC"], [], "DCO")).toBe(false);
    expect(cotizacionEnAlcance(["LQC"], [], null)).toBe(false);
  });
});
