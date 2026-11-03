import { ConversionError, aUnidadConsumo, cantidadPorCaptura, enEnvases } from "./conversion";

describe("consumibles · unidad de compra y de consumo (§4.4.4, §4.4.5)", () => {
  it("convierte envases a unidad de consumo", () => {
    expect(aUnidadConsumo(3, 500, true)).toBe(1500);
    expect(aUnidadConsumo(0.5, "1000", true)).toBe(500);
    expect(aUnidadConsumo(12, null, false)).toBe(12);
    expect(() => aUnidadConsumo(1, null, true)).toThrow(ConversionError);
    expect(() => aUnidadConsumo(1, 0, true)).toThrow(/factor de conversión/);
  });

  it("stock en envases y resto", () => {
    expect(enEnvases(1150, 500)).toEqual({ envases: 2, resto: 150 });
    expect(enEnvases(1000, 500)).toEqual({ envases: 2, resto: 0 });
    expect(enEnvases(10, null)).toBeNull();
  });

  it("cantidad por captura: por ensayo o por réplica", () => {
    expect(cantidadPorCaptura(2.5, "ensayo", 3)).toBe(2.5);
    expect(cantidadPorCaptura(2.5, "replica", 3)).toBe(7.5);
    expect(cantidadPorCaptura(0.1, "replica", 0)).toBe(0.1);
  });
});
