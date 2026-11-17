import { abreReanalisisAutomatico } from "./reanalisis";

describe("F045 · re-análisis automático", () => {
  const base = { yaHubo: false, veredicto: "no_cumple", advertencia: false, modo: "no_cumple" as const };
  it("un No cumple abre el re-análisis una sola vez", () => {
    expect(abreReanalisisAutomatico(base)).toBe(true);
    expect(abreReanalisisAutomatico({ ...base, yaHubo: true })).toBe(false);
  });
  it("la permisibilidad «Prohibida» del arma (IT05) no abre re-análisis ni aviso de repetir", () => {
    expect(abreReanalisisAutomatico({ ...base, sinReanalisis: true })).toBe(false);
  });
  it("un Cumple no abre re-análisis en el modo «No cumple»", () => {
    expect(abreReanalisisAutomatico({ ...base, veredicto: "cumple" })).toBe(false);
  });
});
