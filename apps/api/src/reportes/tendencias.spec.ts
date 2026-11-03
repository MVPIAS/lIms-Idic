import { completarSerie, mesesEntre, porcentaje, tendencia } from "./tendencias";

describe("reportes · tendencias (§4.5.7)", () => {
  it("meses entre dos fechas, cruzando el año", () => {
    expect(mesesEntre("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(mesesEntre("2026-03", "2026-01")).toEqual([]);
    expect(mesesEntre("x", "2026-01")).toEqual([]);
  });

  it("completa los meses sin datos", () => {
    expect(completarSerie(["2026-01", "2026-02", "2026-03"], [{ mes: "2026-02", valor: 5 }], 0)).toEqual([0, 5, 0]);
    expect(completarSerie(["2026-01", "2026-02"], [{ mes: "2026-01", valor: 40 }], null)).toEqual([40, null]);
  });

  it("detecta subida, bajada y estabilidad con la recta de mínimos cuadrados", () => {
    const sube = tendencia([10, 12, 14, 16, 18]);
    expect(sube.pendiente).toBe(2);
    expect(sube.sentido).toBe("sube");
    expect(sube.cambioPct).toBe(57.1); // 2 × 4 meses / media 14
    expect(tendencia([20, 18, 15, 12, 10]).sentido).toBe("baja");
    expect(tendencia([100, 101, 99, 100, 102]).sentido).toBe("estable");
  });

  it("media móvil de 3 meses y meses sin base", () => {
    expect(tendencia([3, 6, 9, 12]).mediaMovil).toEqual([null, null, 6, 9]);
    expect(tendencia([3, null, 9, 12]).mediaMovil).toEqual([null, null, null, null]);
    expect(tendencia([5, null, 7]).sentido).toBe("sin_datos");
    expect(tendencia([5, null, 7, 9]).sentido).toBe("sube");
  });

  it("marca el último mes atípico (fuera de media ± 2 DE)", () => {
    expect(tendencia([10, 11, 9, 10, 30]).atipico).toBe(true);
    expect(tendencia([10, 11, 9, 10, 11]).atipico).toBe(false);
    expect(tendencia([0, 0, 0, 0, 4]).atipico).toBe(true);
  });

  it("porcentaje con un decimal", () => {
    expect(porcentaje(1, 3)).toBe(33.3);
    expect(porcentaje(0, 0)).toBeNull();
  });
});
