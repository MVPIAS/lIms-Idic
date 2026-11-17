import { CrearOc, EditarOc, PN_CON_COBRO } from "./produccion-nacional.service";

const oc = {
  rafId: "00000000-0000-4000-8000-000000000001",
  numero: "OC PRUEBA 1",
  anio: 2026,
  vigenciaDesde: "2026-01-01",
  vigenciaHasta: "2026-12-31",
  productos: [{ producto: "ANFO PRUEBA", unidadMedida: "t", cantidadAutorizada: 10 }],
};

describe("BPCH-03 · Producción Nacional siempre sin cobro", () => {
  it("la O/C se registra sin elegir cobro", () => {
    expect(PN_CON_COBRO).toBe(false);
    expect(CrearOc.safeParse(oc).success).toBe(true);
    expect(CrearOc.safeParse({ ...oc, conCobro: false }).success).toBe(true);
  });
  it("no admite marcar la O/C con cobro", () => {
    const r = CrearOc.safeParse({ ...oc, conCobro: true });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/no se cobran/);
    expect(EditarOc.safeParse({ conCobro: true }).success).toBe(false);
  });
});
