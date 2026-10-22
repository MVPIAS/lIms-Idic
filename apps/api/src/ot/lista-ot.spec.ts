import { OT_TERMINADAS, filtroListaOt, paginacion, semaforoPedido } from "./lista-ot";

const hoy = new Date("2026-10-14T15:00:00Z");
const ctx = { tenantId: "T", unidadesVisibles: null as string[] | null, hoy };
const and = (w: any) => (w.AND ?? []) as any[];

describe("lista de OT · filtroListaOt", () => {
  it("siempre acota al tenant; sin alcance global, a las unidades visibles", () => {
    expect(and(filtroListaOt({}, ctx))).toEqual([{ tenantId: "T" }]);
    expect(and(filtroListaOt({}, { ...ctx, unidadesVisibles: ["U1"] }))).toContainEqual({ unidadPrincipal: { in: ["U1"] } });
  });

  it("?derivadas=1 suma al alcance las OT con ensayos derivados a sus laboratorios (D02-25)", () => {
    const w = and(filtroListaOt({}, { ...ctx, unidadesVisibles: ["LMB"], idsDerivadas: ["ot-lqa"] }));
    expect(w).toContainEqual({ OR: [{ unidadPrincipal: { in: ["LMB"] } }, { id: { in: ["ot-lqa"] } }] });
    // Sin derivadas, el alcance de siempre; con alcance global no se acota.
    expect(and(filtroListaOt({}, { ...ctx, unidadesVisibles: ["LMB"], idsDerivadas: [] }))).toContainEqual({ unidadPrincipal: { in: ["LMB"] } });
    expect(and(filtroListaOt({}, { ...ctx, idsDerivadas: ["ot-lqa"] }))).toEqual([{ tenantId: "T" }]);
  });

  it("búsqueda por código, cotización, cliente o laboratorio (sin distinguir mayúsculas)", () => {
    const or = and(filtroListaOt({ q: " lqc " }, ctx)).find((c) => c.OR)?.OR;
    expect(or).toContainEqual({ codigo: { contains: "lqc", mode: "insensitive" } });
    expect(or).toContainEqual({ cliente: { razonSocial: { contains: "lqc", mode: "insensitive" } } });
    expect(or).toContainEqual({ unidad: { codigo: { contains: "lqc", mode: "insensitive" } } });
  });

  it("estado «abiertas» excluye las terminadas", () => {
    expect(and(filtroListaOt({ estado: "abiertas" }, ctx))).toContainEqual({ estado: { notIn: OT_TERMINADAS } });
    expect(and(filtroListaOt({ estado: "en_analisis" }, ctx))).toContainEqual({ estado: "en_analisis" });
  });

  it("laboratorio y «sin laboratorio»", () => {
    expect(and(filtroListaOt({ unidadId: "U9" }, ctx))).toContainEqual({ unidadPrincipal: "U9" });
    expect(and(filtroListaOt({ unidadId: "U9", sinLaboratorio: true }, ctx))).toContainEqual({ unidadPrincipal: null });
  });

  it("semáforo de plazo con los cortes de la bandeja: no cerradas ni anuladas, «hoy» en Chile", () => {
    const hoy0 = new Date("2026-10-14T00:00:00Z");
    const abiertas = { estado: { notIn: ["cerrada", "anulada"] } };
    expect(and(filtroListaOt({ semaforo: "vencida" }, ctx))).toContainEqual({ ...abiertas, fechaCompromiso: { lt: hoy0 } });
    expect(and(filtroListaOt({ semaforo: "por_vencer" }, ctx))).toContainEqual({
      ...abiertas,
      fechaCompromiso: { gte: hoy0, lte: new Date("2026-10-17T00:00:00Z") },
    });
    expect(and(filtroListaOt({ semaforo: "en_plazo" }, ctx))).toContainEqual({ ...abiertas, fechaCompromiso: { gt: new Date("2026-10-17T00:00:00Z") } });
    expect(and(filtroListaOt({ semaforo: "sin_fecha" }, ctx))).toContainEqual({ ...abiertas, fechaCompromiso: null });
  });

  it("«vencidas» y «porVencer» son alias del semáforo; el día es el de Chile, no el UTC", () => {
    expect(filtroListaOt({ vencidas: true }, ctx)).toEqual(filtroListaOt({ semaforo: "vencida" }, ctx));
    expect(filtroListaOt({ porVencer: true }, ctx)).toEqual(filtroListaOt({ semaforo: "por_vencer" }, ctx));
    expect(semaforoPedido({ semaforo: "x" as any, vencidas: true })).toBe("vencida");
    // 02:00 UTC del 15 = 23:00 del 14 en Chile (UTC−3): «hoy» sigue siendo el 14.
    const noche = { ...ctx, hoy: new Date("2026-10-15T02:00:00Z") };
    expect(and(filtroListaOt({ semaforo: "vencida" }, noche))).toContainEqual({
      estado: { notIn: ["cerrada", "anulada"] },
      fechaCompromiso: { lt: new Date("2026-10-14T00:00:00Z") },
    });
  });

  it("«listas para cerrar» y «cerradas sin factura» por ids precalculados", () => {
    expect(and(filtroListaOt({ idsListasCierre: ["x"] }, ctx))).toContainEqual({ id: { in: ["x"] } });
    expect(and(filtroListaOt({ idsSinFactura: [] }, ctx))).toContainEqual({ id: { in: [] } });
  });

  it("«Mis OT» y «sin analista» por ids precalculados", () => {
    expect(and(filtroListaOt({ idsMias: ["a", "b"] }, ctx))).toContainEqual({ id: { in: ["a", "b"] } });
    expect(and(filtroListaOt({ idsMias: [] }, ctx))).toContainEqual({ id: { in: [] } });
    expect(and(filtroListaOt({ idsConAnalista: ["a"] }, ctx))).toContainEqual({ id: { notIn: ["a"] } });
  });
});

describe("lista de OT · paginacion", () => {
  it("valores por defecto y límites", () => {
    expect(paginacion()).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(paginacion("3", "50")).toEqual({ page: 3, limit: 50, skip: 100 });
    expect(paginacion("0", "100000")).toEqual({ page: 1, limit: 200, skip: 0 });
    expect(paginacion("x", "-5")).toEqual({ page: 1, limit: 1, skip: 0 });
  });
});
