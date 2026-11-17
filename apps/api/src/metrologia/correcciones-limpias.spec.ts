import { correccionesLimpias } from "./metrologia.module";

describe("correccionesLimpias (maestro de auxiliares)", () => {
  it("sin valores guarda NULL, no una estructura vacía", () => {
    expect(correccionesLimpias({ temp: { error: null, U: null }, hum: { error: null, U: null }, pres: { error: null, U: null } })).toBeNull();
    expect(correccionesLimpias(null)).toBeNull();
  });
  it("guarda solo las magnitudes con algún valor", () => {
    expect(JSON.parse(correccionesLimpias({ temp: { error: -0.2, U: 0.6 }, hum: { error: null, U: null }, pres: { error: null, U: 0.2 } })!)).toEqual({
      temp: { error: -0.2, U: 0.6 },
      pres: { error: null, U: 0.2 },
    });
  });
});
