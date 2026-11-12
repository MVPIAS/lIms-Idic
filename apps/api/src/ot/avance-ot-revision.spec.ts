import { textoRevision } from "./avance-ot";

/** F067 · La Ruta de la OT no da por revisado lo que se aprobó sin revisión previa. */
const r = (p: Partial<Parameters<typeof textoRevision>[0]> = {}) => ({
  total: 4, pendientes: 0, capturados: 0, revisados: 0, aprobados: 0, devueltos: 0, ...p,
});

describe("textoRevision (etapa Revisión de la Ruta)", () => {
  it("sin resultados no hay texto", () => {
    expect(textoRevision(r({ total: 0 }))).toBeNull();
  });
  it("cuenta como revisados los revisados y los aprobados tras revisión", () => {
    expect(textoRevision(r({ revisados: 1, aprobados: 3 }))).toBe("4 de 4 revisados");
  });
  it("los aprobados sin revisión previa se informan aparte", () => {
    expect(textoRevision(r({ aprobados: 4, aprobadosSinRevision: 4 }))).toBe("0 de 4 revisados · 4 aprobados sin revisión previa");
    expect(textoRevision(r({ revisados: 1, aprobados: 3, aprobadosSinRevision: 1 }))).toBe("3 de 4 revisados · 1 aprobado sin revisión previa");
  });
  it("no descuenta más aprobados de los que hay", () => {
    expect(textoRevision(r({ aprobados: 2, aprobadosSinRevision: 9 }))).toBe("0 de 4 revisados · 2 aprobados sin revisión previa");
  });
});
