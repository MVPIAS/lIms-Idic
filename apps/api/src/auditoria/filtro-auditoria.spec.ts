import { finDelDia, whereAuditoria } from "./filtro-auditoria";

describe("Filtro de la bitácora", () => {
  it("perfil global: solo tenant y filtros pedidos", () => {
    const w = whereAuditoria({ recurso: "cotizaciones", accion: "crear" }, "t1", null);
    expect(w).toEqual({ AND: [{ tenantId: "t1" }, { entidadTipo: "cotizaciones" }, { accion: "crear" }] });
  });

  it("jefatura acotada: restringe a las personas de su alcance", () => {
    const w = whereAuditoria({}, "t1", ["u1", "u2"]);
    expect(w.AND).toContainEqual({ usuarioId: { in: ["u1", "u2"] } });
  });

  it("filtrar por un usuario fuera del alcance no amplía lo visible (se combinan con AND)", () => {
    const w = whereAuditoria({ usuarioId: "ajeno" }, "t1", ["u1"]);
    expect(w.AND).toContainEqual({ usuarioId: "ajeno" });
    expect(w.AND).toContainEqual({ usuarioId: { in: ["u1"] } });
  });

  it("rango de fechas: «hasta» con solo la fecha incluye todo el día", () => {
    const hasta = finDelDia("2026-10-14");
    expect(hasta.toISOString()).toBe("2026-10-14T23:59:59.999Z");
    const w = whereAuditoria({ desde: new Date("2026-10-01T00:00:00Z"), hasta }, undefined, null);
    expect(w).toEqual({ AND: [{ ocurridoAt: { gte: new Date("2026-10-01T00:00:00Z"), lte: hasta } }] });
  });

  it("sin filtros ni tenant: where vacío", () => {
    expect(whereAuditoria({}, undefined, null)).toEqual({});
  });
});
