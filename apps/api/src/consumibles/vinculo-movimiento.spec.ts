import { VinculoError, actividadDelMovimiento, otDelMovimiento, resumenConsumos } from "./vinculo-movimiento";

describe("consumibles · vínculo del movimiento con OT, muestra, método y actividad (§4.4.5)", () => {
  const muestra = { id: "m1", codigo: "M-1", otId: "ot1", otCodigo: "OT-2026-0001" };

  it("la OT sale de la muestra si no se indicó", () => {
    expect(otDelMovimiento(null, muestra)).toBe("ot1");
    expect(otDelMovimiento("ot1", muestra)).toBe("ot1");
    expect(otDelMovimiento("ot9", null)).toBe("ot9");
    expect(otDelMovimiento(undefined, null)).toBeNull();
  });

  it("rechaza una muestra de otra OT", () => {
    expect(() => otDelMovimiento("ot2", muestra)).toThrow(VinculoError);
    expect(() => otDelMovimiento("ot2", muestra)).toThrow("La muestra M-1 es de la OT OT-2026-0001, no de la OT elegida.");
  });

  it("actividad: la indicada, «análisis» si hay muestra o método, o ninguna", () => {
    expect(actividadDelMovimiento("limpieza", { muestraId: "m1" })).toBe("limpieza");
    expect(actividadDelMovimiento(null, { muestraId: "m1" })).toBe("analisis");
    expect(actividadDelMovimiento("", { catMetodoId: "x" })).toBe("analisis");
    expect(actividadDelMovimiento(undefined, {})).toBeNull();
    expect(() => actividadDelMovimiento("fiesta", {})).toThrow("Actividad desconocida «fiesta». Elija una de la lista.");
  });
});

describe("consumibles · resumen de consumos de la OT", () => {
  it("suma solo los consumos, por consumible", () => {
    const base = { consumible_nombre: "Ácido", unidad_medida: "mL" };
    expect(
      resumenConsumos([
        { ...base, tipo: "consumo", cantidad: "1.5", consumible_codigo: "R1" },
        { ...base, tipo: "consumo", cantidad: 0.1, consumible_codigo: "R1" },
        { ...base, tipo: "ajuste", cantidad: 5, consumible_codigo: "R1" },
        { ...base, tipo: "consumo", cantidad: 2, consumible_codigo: "A0", consumible_nombre: "Agua" },
      ]),
    ).toEqual([
      { consumible: "A0 · Agua", unidad: "mL", cantidad: 2, movimientos: 1 },
      { consumible: "R1 · Ácido", unidad: "mL", cantidad: 1.6, movimientos: 2 },
    ]);
  });
});
