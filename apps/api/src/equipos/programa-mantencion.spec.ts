import { erroresPrograma, motivoProgramaCerrado, periodoPrograma, puedeTransitarPrograma } from "./plan-mantencion";

describe("Programas de mantención auditables (Químico, R5)", () => {
  it("borrador → aprobado → cerrado, sin volver atrás", () => {
    expect(puedeTransitarPrograma("borrador", "aprobado")).toBe(true);
    expect(puedeTransitarPrograma("aprobado", "cerrado")).toBe(true);
    expect(puedeTransitarPrograma("aprobado", "borrador")).toBe(false);
    expect(puedeTransitarPrograma("cerrado", "aprobado")).toBe(false);
    expect(puedeTransitarPrograma("borrador", "cerrado")).toBe(false);
  });
  it("aprobado o cerrado ya no se modifica (es evidencia)", () => {
    expect(motivoProgramaCerrado("borrador")).toBeNull();
    expect(motivoProgramaCerrado("aprobado")).toMatch(/aprobado/);
    expect(motivoProgramaCerrado("cerrado")).toMatch(/evidencia/);
  });
  it("valida código, nombre y año", () => {
    expect(erroresPrograma({ codigo: "PRUEBA-PM-2026", nombre: "PRUEBA programa", anio: 2026 })).toEqual([]);
    expect(erroresPrograma({ codigo: "", nombre: "x", anio: 1999 })).toHaveLength(3);
    expect(periodoPrograma(2026)).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
  });
});
