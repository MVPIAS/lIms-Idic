import { SQL_ACEPTADA_SIN_OT, SQL_OT_LISTA_PARA_FACTURAR, estadoPlazoOpi, motivoNoAnularOt, sumarMesesIso } from "./avisos-comercial";

describe("avisos de Comercial (reuniones 1 y 2)", () => {
  it("suma meses de calendario", () => {
    expect(sumarMesesIso("2026-09-15", 2)).toBe("2026-11-15");
    expect(sumarMesesIso("2026-12-31", 2)).toBe("2027-02-28");
  });

  it("OPI pendiente: plazo de regularización de dos meses", () => {
    expect(estadoPlazoOpi({ opiPendiente: false, desde: "2026-09-01", hoy: "2026-11-11" })).toBeNull();
    expect(estadoPlazoOpi({ opiPendiente: true, desde: "2026-09-01", hoy: "2026-11-11" })).toEqual({ estado: "vencida", limite: "2026-11-01", diasRestantes: -10 });
    expect(estadoPlazoOpi({ opiPendiente: true, desde: "2026-09-15", hoy: "2026-11-11" })?.estado).toBe("por_vencer");
    expect(estadoPlazoOpi({ opiPendiente: true, desde: "2026-11-01", hoy: "2026-11-11" })?.estado).toBe("al_dia");
    expect(estadoPlazoOpi({ opiPendiente: true, desde: "2026-11-01", hoy: "2026-11-11", meses: 1 })?.limite).toBe("2026-12-01");
  });

  it("anular la OT cuando el cliente desiste, salvo cerrada, facturada u oficial", () => {
    expect(motivoNoAnularOt({ estado: "recepcionada" })).toBeNull();
    expect(motivoNoAnularOt({ estado: "anulada", codigo: "OT-1" })).toMatch(/ya está anulada/);
    expect(motivoNoAnularOt({ estado: "cerrada" })).toMatch(/cerrada/);
    expect(motivoNoAnularOt({ estado: "en_analisis", facturaEmitida: true })).toMatch(/factura emitida/);
    expect(motivoNoAnularOt({ estado: "finalizada", documentosOficiales: 1 })).toMatch(/oficiales/);
  });

  it("los filtros SQL excluyen las excepciones y lo ya facturado", () => {
    expect(SQL_ACEPTADA_SIN_OT).toMatch(/sin_ot_motivo IS NULL/);
    expect(SQL_OT_LISTA_PARA_FACTURAR).toMatch(/o\.con_cobro/);
    expect(SQL_OT_LISTA_PARA_FACTURAR).toMatch(/NOT IN \('pendiente', 'anulada'\)/);
  });
});
