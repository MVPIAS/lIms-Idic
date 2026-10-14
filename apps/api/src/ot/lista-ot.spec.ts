import { OT_TERMINADAS, filtroListaOt, paginacion } from "./lista-ot";

const hoy = new Date("2026-10-14T15:00:00Z");
const ctx = { tenantId: "T", unidadesVisibles: null as string[] | null, hoy };
const and = (w: any) => (w.AND ?? []) as any[];

describe("lista de OT · filtroListaOt", () => {
  it("siempre acota al tenant; sin alcance global, a las unidades visibles", () => {
    expect(and(filtroListaOt({}, ctx))).toEqual([{ tenantId: "T" }]);
    expect(and(filtroListaOt({}, { ...ctx, unidadesVisibles: ["U1"] }))).toContainEqual({ unidadPrincipal: { in: ["U1"] } });
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

  it("vencidas = abiertas con compromiso anterior a hoy; por vencer = hoy a +3 días", () => {
    const hoy0 = new Date("2026-10-14T00:00:00Z");
    expect(and(filtroListaOt({ vencidas: true }, ctx))).toContainEqual({
      estado: { notIn: OT_TERMINADAS },
      fechaCompromiso: { lt: hoy0 },
    });
    expect(and(filtroListaOt({ porVencer: true }, ctx))).toContainEqual({
      estado: { notIn: OT_TERMINADAS },
      fechaCompromiso: { gte: hoy0, lte: new Date("2026-10-17T00:00:00Z") },
    });
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
