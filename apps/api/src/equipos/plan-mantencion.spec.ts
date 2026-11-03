import { cumplimiento, erroresEjecucion, erroresPlan, estadoPlazo, ocurrencias, siguienteFecha, sumarDias } from "./plan-mantencion";

describe("plan de mantención preventiva (§4.4.3)", () => {
  it("valida el plan y la ejecución", () => {
    expect(erroresPlan({ equipoId: "x", tipo: "preventiva", descripcion: "Cambio de filtros", frecuenciaDias: 180, proximaFecha: "2026-12-01" })).toEqual([]);
    expect(erroresPlan({ equipoId: null, tipo: "otra", descripcion: "", frecuenciaDias: 0, proximaFecha: "01-12-2026" })).toHaveLength(5);
    expect(erroresEjecucion({ fecha: "2026-11-03" }, "2026-11-02")[0]).toMatch(/futura/);
    expect(erroresEjecucion({ fecha: "2026-11-02", resultado: "conforme", costo: 120000 }, "2026-11-02")).toEqual([]);
    expect(erroresEjecucion({ fecha: "2026-11-02", costo: -1 }, "2026-11-02")).toHaveLength(1);
  });

  it("fechas: siguiente, plazo y ocurrencias", () => {
    expect(sumarDias("2026-12-30", 3)).toBe("2027-01-02");
    expect(siguienteFecha("2026-11-02", 90)).toBe("2027-01-31");
    expect(estadoPlazo("2026-11-01", "2026-11-02")).toBe("vencido");
    expect(estadoPlazo("2026-11-20", "2026-11-02")).toBe("por_vencer");
    expect(estadoPlazo("2027-03-01", "2026-11-02")).toBe("al_dia");
    expect(estadoPlazo(null, "2026-11-02")).toBe("sin_fecha");
    expect(ocurrencias("2026-11-10", 30, "2026-11-01", "2027-01-31")).toEqual(["2026-11-10", "2026-12-10", "2027-01-09"]);
    // Próxima anterior al rango: salta a la primera dentro.
    expect(ocurrencias("2026-01-01", 100, "2026-10-01", "2026-12-31")).toEqual(["2026-10-28"]);
    expect(ocurrencias("2026-01-01", 100, "2026-11-01", "2026-12-31")).toEqual([]);
    expect(ocurrencias("2026-11-01", 7, "2026-11-01", "2026-11-01")).toEqual(["2026-11-01"]);
  });

  it("cumplimiento del plan", () => {
    const c = cumplimiento(
      [
        { fecha: "2026-10-05", fechaProgramada: "2026-10-01", costo: 1000 },
        { fecha: "2026-10-20", fechaProgramada: "2026-10-01", costo: null },
        { fecha: "2026-10-03", fechaProgramada: null, costo: 500 },
      ],
      1,
    );
    expect(c).toEqual({ programadas: 3, ejecutadas: 2, aTiempo: 1, atrasadas: 1, pendientes: 1, porcentaje: 33.3, costo: 1500 });
    expect(cumplimiento([], 0).porcentaje).toBeNull();
  });
});
