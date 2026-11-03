import { advertenciaNumerica, configResultados, debeReanalizar, motivoReanalisisAbierto, motivoReanalisisAutomatico } from "./advertencia";

describe("dictamen advertencia y re-análisis (§4.2.6 / §4.3.9)", () => {
  it("con Mín y Máx, el margen es un % del intervalo", () => {
    // Intervalo 6–8, margen 10 % = 0,2.
    expect(advertenciaNumerica(7, "6", "8", 10)).toBeNull();
    expect(advertenciaNumerica(7.85, "6", "8", 10)).toBe("Cumple, pero a 0,15 del Máx 8 (margen de advertencia 10 %).");
    expect(advertenciaNumerica(6.2, "6,0", "8,0", 10)).toMatch(/a 0,2 del Mín 6/);
    // Fuera de límites ya es No cumple: no es advertencia.
    expect(advertenciaNumerica(8.1, "6", "8", 10)).toBeNull();
  });

  it("con un solo límite, el margen es un % del límite", () => {
    expect(advertenciaNumerica(4.6, null, "5", 10)).toMatch(/a 0,4 del Máx 5/);
    expect(advertenciaNumerica(4.4, null, "5", 10)).toBeNull();
    expect(advertenciaNumerica(21, "20", null, 10)).toMatch(/del Mín 20/);
  });

  it("margen 0 o sin límites numéricos: sin advertencia; el margen del método manda", () => {
    expect(advertenciaNumerica(7.95, "6", "8", 0)).toBeNull();
    expect(advertenciaNumerica(7.95, "6", "8", 0, 5)).toMatch(/margen de advertencia 5 %/);
    expect(advertenciaNumerica(7.95, "6", "8", 10, 0)).toBeNull();
    expect(advertenciaNumerica(3, "Ausencia", null, 10)).toBeNull();
    expect(advertenciaNumerica(null, "6", "8", 10)).toBeNull();
  });

  it("re-análisis según el modo", () => {
    expect(debeReanalizar("no_cumple", false, "no_cumple")).toBe(true);
    expect(debeReanalizar("cumple", true, "no_cumple")).toBe(false);
    expect(debeReanalizar("cumple", true, "no_cumple_y_advertencia")).toBe(true);
    expect(debeReanalizar("no_cumple", false, "no")).toBe(false);
    expect(debeReanalizar("pendiente", true, "no_cumple_y_advertencia")).toBe(false);
  });

  it("parámetros con valores por defecto y fuera de rango", () => {
    expect(configResultados([])).toEqual({ margenPct: 10, reanalisis: "no_cumple", avisarAdvertencia: true });
    expect(
      configResultados([
        { codigo: "advertencia_margen_pct", valor: "7,5" },
        { codigo: "reanalisis_automatico", valor: "no" },
        { codigo: "advertencia_correo", valor: "no" },
      ]),
    ).toEqual({ margenPct: 7.5, reanalisis: "no", avisarAdvertencia: false });
    expect(configResultados([{ codigo: "advertencia_margen_pct", valor: "80" }]).margenPct).toBe(10);
    expect(configResultados([{ codigo: "reanalisis_automatico", valor: "no", activo: false }]).reanalisis).toBe("no_cumple");
  });

  it("motivo de bloqueo", () => {
    expect(motivoReanalisisAbierto(null)).toBeNull();
    expect(motivoReanalisisAbierto({ motivo: "No cumple: 9 > Máx 8", origen: "automatico" })).toMatch(/re-análisis automático pendiente/);
  });

  it("el motivo del re-análisis automático dice si fue un No cumple o una advertencia", () => {
    expect(motivoReanalisisAutomatico("no_cumple", null)).toMatch(/^Resultado No cumple/);
    expect(motivoReanalisisAutomatico("cumple", "Cumple, pero a 0,15 del Máx 8 (margen de advertencia 10 %).")).toBe(
      "Advertencia: Cumple, pero a 0,15 del Máx 8 (margen de advertencia 10 %).",
    );
    expect(motivoReanalisisAutomatico("cumple", null)).toMatch(/^Advertencia: /);
  });
});
