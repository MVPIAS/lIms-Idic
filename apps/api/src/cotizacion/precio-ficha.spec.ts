import { claveLibre, precioDeLinea } from "./precio-ficha";

describe("Cotización · precio desde la ficha de costos (EP-00 2.2, BL-149)", () => {
  const ens = { catEnsayoId: "e1", ensayoCodigo: "EN1214" };
  it("el ensayo toma el precio de su ficha", () => {
    expect(precioDeLinea(ens, 45000, 1)).toEqual({ precio: 45000 });
    expect(precioDeLinea({ ...ens, precioUnitario: 45000 }, 45000, 1)).toEqual({ precio: 45000 });
  });
  it("rechaza un precio manual distinto de la ficha", () => {
    expect(precioDeLinea({ ...ens, precioUnitario: 1000 }, 45000, 2).error).toMatch(/no admite un precio manual/);
  });
  it("un ensayo sin valor en su ficha bloquea la cotización", () => {
    expect(precioDeLinea({ ...ens, precioUnitario: 5000 }, null, 1).error).toMatch(/no tiene valor en su ficha/);
  });
  it("al editar, la línea ya cotizada conserva su precio aunque la ficha cambie", () => {
    const ex = { ensayos: new Map([["e1", 40000]]), libres: new Set<string>() };
    expect(precioDeLinea({ ...ens, precioUnitario: 40000 }, 45000, 1, ex)).toEqual({ precio: 40000 });
  });
  it("sin ensayo solo se aceptan gastos tipificados", () => {
    expect(precioDeLinea({ tipo: "viatico", descripcion: "Viático Arica 2 días", precioUnitario: 80000 }, null, 1)).toEqual({ precio: 80000 });
    expect(precioDeLinea({ descripcion: "Servicio libre", precioUnitario: 1000 }, null, 1).error).toMatch(/gasto tipificado/);
    expect(precioDeLinea({ tipo: "producto", descripcion: "Servicio libre", precioUnitario: 1000 }, null, 1).error).toMatch(/gasto tipificado/);
  });
  it("al editar, una línea libre heredada se conserva", () => {
    const ex = { ensayos: new Map(), libres: new Set([claveLibre("producto", "Servicio antiguo", 1000)]) };
    expect(precioDeLinea({ tipo: "producto", descripcion: "Servicio antiguo", precioUnitario: 1000 }, null, 1, ex)).toEqual({ precio: 1000 });
  });
});
