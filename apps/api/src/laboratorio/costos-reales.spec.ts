import { comparar, erroresCierrePlanilla, erroresLineas, estimacionDeCotizacion, estimacionDelLaboratorio, laboratorioDeResultado, resumenCostos, totalLinea, type LineaCostoReal } from "./costos-reales";

const CARGOS = new Set(["jefe_laboratorio", "analista"]);
// Horas del ejemplo real de la maqueta LQC (NCh 409): 0,40 h Jefe de Laboratorio y
// 15 h Analista. Las tarifas son de prueba (las reales no constan en las fuentes).
const lineas: LineaCostoReal[] = [
  { categoria: "horas_hombre", cargo: "jefe_laboratorio", cantidad: 0.4, costoUnitario: 20000 },
  { categoria: "horas_hombre", cargo: "analista", cantidad: 15, costoUnitario: 1000 },
  { categoria: "reactivos", descripcion: "HCl 37 %", cantidad: 0.5, unidad: "L", costoUnitario: 3000 },
  { categoria: "equipos", descripcion: "EAA", cantidad: 2, costoUnitario: 1500 },
  { categoria: "otros", descripcion: "Traslado de muestra", cantidad: 1, costoUnitario: 863 },
];

describe("planilla de costos reales", () => {
  it("total por línea y resumen por bloque", () => {
    expect(totalLinea({ cantidad: 0.4, costoUnitario: 20000 })).toBe(8000);
    const r = resumenCostos(lineas);
    expect(r.porCategoria.horas_hombre).toEqual({ cantidad: 15.4, total: 23000, lineas: 2 });
    expect(r.horasHombre).toBe(15.4);
    expect(r.horasMaquina).toBe(2);
    expect(r.total).toBe(23000 + 1500 + 3000 + 863);
  });
  it("valida cargo, descripciones y signos", () => {
    expect(erroresLineas(lineas, CARGOS)).toEqual([]);
    const e = erroresLineas(
      [
        { categoria: "horas_hombre", cantidad: 1, costoUnitario: 1 },
        { categoria: "horas_hombre", cargo: "astronauta", cantidad: 1, costoUnitario: 1 },
        { categoria: "reactivos", cantidad: -1, costoUnitario: 1 },
        { categoria: "otros", cantidad: 1, costoUnitario: -5 },
      ],
      CARGOS,
    ).join(" ");
    expect(e).toMatch(/Línea 1: indique el cargo/);
    expect(e).toMatch(/Línea 2: el cargo «astronauta»/);
    expect(e).toMatch(/Línea 3: la cantidad no puede ser negativa/);
    expect(e).toMatch(/Línea 3: indique el reactivo/);
    expect(e).toMatch(/Línea 4: el costo unitario/);
  });
  it("estimación: costeo consolidado > estimación del laboratorio > costo estimado de la OT", () => {
    expect(estimacionDeCotizacion({ costosDirectosTotal: 30000, solicitudes: [{ horasHombre: 10, costoDirecto: 25000 }] })).toMatchObject({
      costoDirecto: 30000, fuenteCosto: "costeo_consolidado", horasHombre: 10, fuenteHoras: "estimacion_laboratorio",
    });
    expect(estimacionDeCotizacion({ solicitudes: [{ horasHombre: 0, costoDirecto: 25000 }], otHorasHombre: 12 })).toMatchObject({
      costoDirecto: 25000, fuenteCosto: "estimacion_laboratorio", horasHombre: 12, fuenteHoras: "horas_ot",
    });
    expect(estimacionDeCotizacion({ otCostoEstimado: 9000 })).toMatchObject({ costoDirecto: 9000, fuenteCosto: "costo_estimado_ot" });
    expect(estimacionDeCotizacion({})).toMatchObject({ costoDirecto: null, fuenteCosto: null, horasHombre: null, neto: null });
  });
  it("horas de las líneas de la cotización y precio cotizado por bloque", () => {
    const e = estimacionDeCotizacion({
      lineasCotizacion: [
        { tipo: "hora_hombre", cantidad: 2, diasOHoras: 4, subtotal: 80000 },
        { tipo: "hora_maquina", cantidad: 1, subtotal: 15000 },
        { tipo: "viatico", cantidad: 1, subtotal: 5000 },
        { tipo: "producto", cantidad: 3, subtotal: 90000 },
      ],
      neto: 190000,
    });
    expect(e.horasHombre).toBe(8);
    expect(e.fuenteHoras).toBe("lineas_cotizacion");
    expect(e.cotizadoPorCategoria).toEqual({ horas_hombre: 80000, reactivos: 0, equipos: 15000, otros: 5000 });
    expect(e.neto).toBe(190000);
  });
  it("compara lo real con lo estimado", () => {
    const c = comparar(resumenCostos(lineas), estimacionDeCotizacion({ costosDirectosTotal: 26863, otHorasHombre: 15.57, neto: 50000 }));
    expect(c.costoReal).toBe(28363);
    expect(c.diferencia).toBe(1500);
    expect(c.desviacionPct).toBeCloseTo(5.58, 2);
    expect(c.diferenciaHoras).toBe(-0.17);
    expect(c.margen).toBe(21637);
    expect(comparar(resumenCostos([]), estimacionDeCotizacion({}))).toMatchObject({ diferencia: null, desviacionPct: null, margen: null });
  });
  it("cierre: con costos, con horas hombre y con el trabajo del laboratorio aprobado", () => {
    expect(erroresCierrePlanilla({ estado: "borrador", lineas, resultadosSinAprobar: 0 })).toEqual([]);
    expect(erroresCierrePlanilla({ estado: "borrador", lineas: [], resultadosSinAprobar: 0 })).toHaveLength(2);
    expect(erroresCierrePlanilla({ estado: "borrador", lineas, resultadosSinAprobar: 2 })[0]).toMatch(/2 ensayo/);
    expect(erroresCierrePlanilla({ estado: "cerrada", lineas, resultadosSinAprobar: 0 })[0]).toMatch(/ya está cerrada/);
  });
});

describe("planilla de costos por laboratorio (revisión r3, hallazgos 7 y 8)", () => {
  const fuentes = {
    costosDirectosTotal: 1_000_000,
    solicitudes: [{ horasHombre: 40, costoDirecto: 800_000 }, { horasHombre: 10, costoDirecto: 200_000 }],
    neto: 1_500_000,
  };
  const lpn = [{ horasHombre: 10, costoDirecto: 200_000 }];
  const real = resumenCostos([{ categoria: "horas_hombre", cargo: "analista", cantidad: 10, costoUnitario: 20_000 }]);

  it("OT de un solo laboratorio: se compara con la cotización completa (como antes)", () => {
    const e = estimacionDelLaboratorio(fuentes, { multiLaboratorio: false, solicitudesDelLaboratorio: [] });
    expect([e.costoDirecto, e.alcance, e.neto]).toEqual([1_000_000, "ot", 1_500_000]);
  });
  it("OT multilaboratorio: la planilla de LPN (200.000) se compara con SU solicitud de costeo, sin margen del total", () => {
    const e = estimacionDelLaboratorio(fuentes, { multiLaboratorio: true, solicitudesDelLaboratorio: lpn });
    expect([e.costoDirecto, e.horasHombre, e.fuenteCosto, e.alcance, e.neto]).toEqual([200_000, 10, "estimacion_laboratorio", "laboratorio", null]);
    const c = comparar(real, e);
    expect(c.desviacionPct).toBe(0);
    expect(c.margen).toBeNull();
  });
  it("OT multilaboratorio sin estimación del laboratorio: no compara con el total y lo dice", () => {
    const e = estimacionDelLaboratorio(fuentes, { multiLaboratorio: true, solicitudesDelLaboratorio: [] });
    expect([e.costoDirecto, e.alcance]).toEqual([null, "sin_estimacion_laboratorio"]);
    expect(e.aviso).toMatch(/no se compara con el total/);
    const c = comparar(real, e);
    expect([c.diferencia, c.desviacionPct, c.margen]).toEqual([null, null, null]);
  });
  it("cada ensayo es del laboratorio de su método; si no se sabe, del responsable", () => {
    const [LQC, LPN, LCC] = ["lqc", "lpn", "lcc"];
    expect(laboratorioDeResultado([LPN], [LQC, LPN, LCC], LQC)).toBe(LPN);
    expect(laboratorioDeResultado([LQC, LPN], [LQC, LPN], LQC)).toBe(LQC);
    expect(laboratorioDeResultado([], [LQC, LPN], LQC)).toBe(LQC);
    expect(laboratorioDeResultado(["otro"], [LQC, LPN], LQC)).toBe(LQC);
  });
});
