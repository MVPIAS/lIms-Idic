import { consolidarOt, erroresLineas, semaforo, tarifaVigente, umbralesDesde, UMBRALES_POR_DEFECTO } from "./costos-reales";
import { tarifaDeEquipo } from "./costo-real-datos";

describe("costo real · semáforo de lo cotizado frente a lo real (S4)", () => {
  it("verde bajo el umbral amarillo (también si se gastó menos), amarillo y rojo sobre los umbrales", () => {
    expect(semaforo(90_000, 100_000)).toEqual({ color: "verde", desviacionPct: -10 });
    expect(semaforo(109_999, 100_000).color).toBe("verde");
    expect(semaforo(110_000, 100_000)).toEqual({ color: "amarillo", desviacionPct: 10 });
    expect(semaforo(119_000, 100_000).color).toBe("amarillo");
    expect(semaforo(125_148, 100_000)).toEqual({ color: "rojo", desviacionPct: 25.15 });
  });
  it("sin estimación o sin costos no hay semáforo", () => {
    expect(semaforo(10_000, null).color).toBe("sin_dato");
    expect(semaforo(10_000, 0).color).toBe("sin_dato");
    expect(semaforo(0, 100_000).color).toBe("sin_dato");
  });
  it("lee los umbrales de los parámetros (con coma) y vuelve a los de ejemplo si no cuadran", () => {
    expect(umbralesDesde([{ codigo: "semaforo_amarillo_pct", valor: "5,5" }, { codigo: "semaforo_rojo_pct", valor: "15" }])).toEqual({ amarilloPct: 5.5, rojoPct: 15 });
    expect(umbralesDesde([])).toEqual(UMBRALES_POR_DEFECTO);
    expect(umbralesDesde([{ codigo: "semaforo_amarillo_pct", valor: "30" }, { codigo: "semaforo_rojo_pct", valor: "10" }])).toEqual(UMBRALES_POR_DEFECTO);
    expect(umbralesDesde([{ codigo: "semaforo_rojo_pct", valor: "x" }])).toEqual(UMBRALES_POR_DEFECTO);
    expect(semaforo(106, 100, { amarilloPct: 5, rojoPct: 15 }).color).toBe("amarillo");
  });
});

describe("costo real · OT completa (todos los laboratorios)", () => {
  // Ejemplo de la planilla «Control de gastos por OT» del IDIC: costo real 125.148 con una OT interna de Pinturas.
  const planillas = [
    { unidadId: "lcc", unidad: "LCC", estado: "cerrada", total: 108_130, horasHombre: 8 },
    { unidadId: "lpn", unidad: "LPN", estado: "borrador", total: 17_018, horasHombre: 2 },
  ];
  it("suma los laboratorios y compara con la cotización completa", () => {
    const c = consolidarOt(planillas, { costoDirecto: 100_000, neto: 156_000, laboratorios: 2 });
    expect(c.costoReal).toBe(125_148);
    expect(c.horasHombre).toBe(10);
    expect(c.diferencia).toBe(25_148);
    expect(c.semaforo).toBe("rojo");
    expect(c.margen).toBe(30_852);
    expect(c.cerradas).toBe(1);
    expect(c.completo).toBe(false);
  });
  it("es definitivo cuando todas las planillas están cerradas", () => {
    const c = consolidarOt(planillas.map((p) => ({ ...p, estado: "cerrada" })), { costoDirecto: null, neto: null, laboratorios: 2 });
    expect(c.completo).toBe(true);
    expect(c.semaforo).toBe("sin_dato");
  });
});

describe("costo real · tarifas de Tablas maestras", () => {
  const filas = [
    { categoria: "A", vigenteDesde: "2025-01-01", vigenteHasta: "2025-12-31", activo: true, valor: 1 },
    { categoria: "A", vigenteDesde: "2026-01-01", vigenteHasta: null, activo: true, valor: 2 },
    { categoria: "A", vigenteDesde: "2026-06-01", vigenteHasta: null, activo: false, valor: 3 },
    { categoria: "A", vigenteDesde: "2027-01-01", vigenteHasta: null, activo: true, valor: 4 },
  ];
  it("toma la tarifa vigente a la fecha (activa, la de inicio más reciente)", () => {
    expect(tarifaVigente(filas, "2026-11-11")?.valor).toBe(2);
    expect(tarifaVigente(filas, "2025-03-01")?.valor).toBe(1);
    expect(tarifaVigente(filas, "2024-01-01")).toBeNull();
  });
  it("la tarifa HM de un equipo se busca por el equipo o por su código EQ###; si no hay, Pendiente del IDIC (null)", () => {
    const hm = [
      { equipoId: "e1", codigo: null, descripcion: null, valorHora: 184 },
      { equipoId: null, codigo: "EQ010", descripcion: null, valorHora: 500 },
    ];
    expect(tarifaDeEquipo(hm, { id: "e1", codigo: "X" })).toBe(184);
    expect(tarifaDeEquipo(hm, { id: "e2", codigo: "eq010" })).toBe(500);
    expect(tarifaDeEquipo(hm, { id: "e3", codigo: "EQ999" })).toBeNull();
  });
  it("una categoría de Tarifas HH sirve de cargo de las horas hombre; el vehículo institucional es un gasto de comisión", () => {
    const cargos = new Set(["analista", "HH:TU"]);
    expect(erroresLineas([{ categoria: "horas_hombre", cargo: "HH:TU", cantidad: 8, costoUnitario: 9051 }], cargos)).toEqual([]);
    expect(erroresLineas([{ categoria: "horas_hombre", cargo: "HH:ZZ", cantidad: 8, costoUnitario: 1 }], cargos)).toHaveLength(1);
    expect(erroresLineas([{ categoria: "comision", tipoGasto: "vehiculo", descripcion: "Camioneta PRUEBA", cantidad: 120, costoUnitario: 350 }], cargos)).toEqual([]);
  });
});
