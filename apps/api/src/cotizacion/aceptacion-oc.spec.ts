import { revisarOc } from "./aceptacion-oc";

describe("Aceptación · O/C vs cotización (EP-00 4.2, BL-150)", () => {
  it("sin O/C o sin monto no se compara", () => {
    expect(revisarOc({ tipo: "CORREO", montoOc: 10, totalCotizado: 20, tolerancia: 0 }).aplica).toBe(false);
    expect(revisarOc({ tipo: "OC", totalCotizado: 20, tolerancia: 0 }).aplica).toBe(false);
  });
  it("monto igual (o dentro de la tolerancia): sin discrepancia", () => {
    expect(revisarOc({ tipo: "OC", montoOc: 100000, totalCotizado: 100000, tolerancia: 0 })).toMatchObject({ hayDiscrepancia: false, error: null });
    expect(revisarOc({ tipo: "OC", montoOc: 100500, totalCotizado: 100000, tolerancia: 1000 }).hayDiscrepancia).toBe(false);
  });
  it("monto distinto exige registrar la discrepancia", () => {
    const r = revisarOc({ tipo: "OC", montoOc: 90000, totalCotizado: 100000, tolerancia: 0 });
    expect(r.diferencia).toBe(-10000);
    expect(r.error).toMatch(/difiere del total cotizado/);
    expect(revisarOc({ tipo: "OC", montoOc: 90000, totalCotizado: 100000, tolerancia: 0, discrepancia: "El cliente excluye un ensayo" }).error).toBeNull();
  });
});
