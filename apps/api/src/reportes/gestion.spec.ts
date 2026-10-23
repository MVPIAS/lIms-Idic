import { hojasGestion, otPorLaboratorioEstado, plazosPorLaboratorio } from "./gestion";

describe("reporte de gestión (EP-00 9.4)", () => {
  it("cumplimiento de plazo, ciclo y atraso promedio por laboratorio", () => {
    const p = plazosPorLaboratorio([
      { laboratorio: "LQC", cerrada: true, dias: 10, dentro: true, vencidaAbierta: false, diasAtraso: -2 },
      { laboratorio: "LQC", cerrada: true, dias: 20, dentro: false, vencidaAbierta: false, diasAtraso: 4 },
      { laboratorio: "LQC", cerrada: true, dias: 6, dentro: null, vencidaAbierta: false, diasAtraso: null },
      { laboratorio: "LQC", cerrada: false, dias: null, dentro: null, vencidaAbierta: true, diasAtraso: null },
      { laboratorio: "LPN", cerrada: false, dias: null, dentro: null, vencidaAbierta: false, diasAtraso: null },
    ]);
    expect(p.map((x) => x.laboratorio)).toEqual(["LPN", "LQC"]);
    expect(p[1]).toMatchObject({ cerradas: 3, conCompromiso: 2, dentro: 1, fuera: 1, pctDentro: 50, cicloPromedio: 12, atrasoPromedio: 4, vencidasAbiertas: 1 });
    expect(p[0]).toMatchObject({ cerradas: 0, pctDentro: null, cicloPromedio: null });
  });
  it("tabla cruzada laboratorio × estado con total", () => {
    const t = otPorLaboratorioEstado([
      { laboratorio: "LQC", estado: "cerrada", total: 3 },
      { laboratorio: "LQC", estado: "en_analisis", total: 1 },
      { laboratorio: "LPN", estado: "cerrada", total: 2 },
    ]);
    expect(t.estados).toEqual(["cerrada", "en_analisis"]);
    expect(t.filas).toEqual([
      { laboratorio: "LPN", porEstado: { cerrada: 2, en_analisis: 0 }, total: 2 },
      { laboratorio: "LQC", porEstado: { cerrada: 3, en_analisis: 1 }, total: 4 },
    ]);
  });
  it("el Excel lleva una hoja por sección con encabezados", () => {
    const h = hojasGestion({
      rango: { desde: "2026-01-01", hasta: null },
      otPorEstado: { estados: ["cerrada"], filas: [{ laboratorio: "LQC", porEstado: { cerrada: 1 }, total: 1 }] },
      plazos: [],
      facturacionCentroCosto: [{ centroCosto: "CC1", nombre: "LQC", facturas: 1, neto: 100, total: 119, pagado: 119, saldo: 0 }],
      sinCobro: [],
      encuestas: [{ laboratorio: "LQC", registradas: 1, pendientes: 0, promedio: 6.5 }],
      trazabilidad: [{ cotizacion: "2026-00001", ot: "OT-1", laboratorio: "LQC", estadoOt: "cerrada", factura: "F-1", estadoFactura: "pagada", total: 119 }],
    });
    expect(h.map((x) => x.nombre)).toContain("Facturación por centro de costo");
    expect(h[0].filas[0]).toEqual(["Laboratorio", "Cerrada", "Total"]);
    expect(h.find((x) => x.nombre === "Cotización-OT-factura")!.filas[1]).toEqual(["2026-00001", "OT-1", "LQC", "Cerrada", "F-1", "pagada", 119]);
    expect(h.find((x) => x.nombre === "Período")!.filas[1][0]).toBe("Período: 2026-01-01 a hoy");
  });
});
