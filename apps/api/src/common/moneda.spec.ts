/**
 * Frente f5 · el LIMS trabaja solo en CLP y USD; lo histórico (UF, EUR…) se
 * reconoce para mostrarlo de solo lectura.
 */
import { MONEDAS_OPERACION, esMonedaHistorica, esMonedaOperacion, monedaDe, redondearMoneda, zMoneda } from "./moneda";

describe("monedas de la operación", () => {
  it("solo CLP y USD", () => {
    expect([...MONEDAS_OPERACION]).toEqual(["CLP", "USD"]);
  });

  it("zMoneda admite CLP y USD (sin importar mayúsculas ni espacios) y rechaza UF, EUR y CLF", () => {
    expect(zMoneda.parse("CLP")).toBe("CLP");
    expect(zMoneda.parse(" usd ")).toBe("USD");
    for (const m of ["UF", "EUR", "CLF", "", "PESO"]) {
      const r = zMoneda.safeParse(m);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toMatch(/solo en CLP .* y USD/);
    }
  });

  it("con default y opcional, como en los DTO", () => {
    expect(zMoneda.default("CLP").parse(undefined)).toBe("CLP");
    expect(zMoneda.optional().parse(undefined)).toBeUndefined();
    expect(zMoneda.nullable().optional().parse(null)).toBeNull();
  });

  it("histórica = guardada en otra moneda; vacía o nula no es histórica (vale CLP)", () => {
    expect(esMonedaOperacion("USD")).toBe(true);
    expect(esMonedaOperacion("UF")).toBe(false);
    expect(esMonedaHistorica("UF")).toBe(true);
    expect(esMonedaHistorica("EUR")).toBe(true);
    expect(esMonedaHistorica("CLP")).toBe(false);
    expect(esMonedaHistorica("usd")).toBe(false);
    expect(esMonedaHistorica(null)).toBe(false);
    expect(esMonedaHistorica("")).toBe(false);
  });
});

describe("frente f6 · redondeo por moneda", () => {
  it("CLP sin decimales; USD a 2 decimales; vacía = CLP", () => {
    expect(redondearMoneda(123_387.5, "CLP")).toBe(123_388);
    expect(redondearMoneda(129.8789, "USD")).toBe(129.88);
    expect(redondearMoneda(28.5, null)).toBe(29);
    expect(redondearMoneda(Number.NaN, "USD")).toBe(0);
    expect(monedaDe(" usd ")).toBe("USD");
    expect(monedaDe("")).toBe("CLP");
  });
});
