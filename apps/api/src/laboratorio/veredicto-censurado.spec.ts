import { criterioIndeterminado, leerCensurado, veredictoCensurado } from "./veredicto";

describe("«< LD» frente al requisito (D02-03)", () => {
  it("lee «< 10», «<10 ufc/g», «≤ 1,8» y «> 2400 NMP/100 mL»", () => {
    expect(leerCensurado("< 10")).toEqual({ op: "<", limite: 10 });
    expect(leerCensurado("<10 ufc/g")).toEqual({ op: "<", limite: 10 });
    expect(leerCensurado("≤ 1,8")).toEqual({ op: "<=", limite: 1.8 });
    expect(leerCensurado("> 2400 NMP/100 mL")).toEqual({ op: ">", limite: 2400 });
    expect(leerCensurado("Ausencia")).toBeNull();
    expect(leerCensurado("< LD")).toBeNull();
    expect(leerCensurado("10")).toBeNull();
  });

  it("«< 10» frente a Máx 100 o Máx 10 cumple: todo valor posible está bajo el máximo", () => {
    expect(veredictoCensurado(leerCensurado("< 10")!, null, 100)).toBe("cumple");
    expect(veredictoCensurado(leerCensurado("< 10")!, null, 10)).toBe("cumple");
  });

  it("«< 10» frente a Máx 5 no se puede decidir: aplica el criterio configurado (por defecto pendiente)", () => {
    expect(veredictoCensurado(leerCensurado("< 10")!, null, 5)).toBe("pendiente");
    expect(veredictoCensurado(leerCensurado("< 10")!, null, 5, "no_cumple")).toBe("no_cumple");
    expect(veredictoCensurado(leerCensurado("< 10")!, null, 5, "cumple")).toBe("cumple");
  });

  it("frente a un mínimo: «< 10» con Mín 20 no cumple; con Mín 5 es indeterminado", () => {
    expect(veredictoCensurado(leerCensurado("< 10")!, 20, null)).toBe("no_cumple");
    expect(veredictoCensurado(leerCensurado("< 10")!, 10, null)).toBe("no_cumple");
    expect(veredictoCensurado(leerCensurado("< 10")!, 5, null)).toBe("pendiente");
  });

  it("«> L»: sobre el máximo no cumple; sobre el mínimo cumple", () => {
    expect(veredictoCensurado(leerCensurado("> 2400")!, null, 1000)).toBe("no_cumple");
    expect(veredictoCensurado(leerCensurado("> 2400")!, 100, null)).toBe("cumple");
    expect(veredictoCensurado(leerCensurado("> 2400")!, null, 5000)).toBe("pendiente");
  });

  it("sin requisito es informativo; el criterio desconocido vale «pendiente»", () => {
    expect(veredictoCensurado(leerCensurado("< 10")!, null, null)).toBe("informativo");
    expect(criterioIndeterminado("otra cosa")).toBe("pendiente");
    expect(criterioIndeterminado("no_cumple")).toBe("no_cumple");
  });
});
