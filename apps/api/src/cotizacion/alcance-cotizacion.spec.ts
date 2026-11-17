import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { cotizacionEnAlcance, exigirCotizacionPorCosteo, leeSoloPorCosteo } from "./alcance-cotizacion";

describe("alcance de las escrituras sobre cotizaciones", () => {
  it("alcance global para el permiso (Comercial): todas", () => {
    expect(cotizacionEnAlcance(null, ["LQC"], "DCO")).toBe(true);
  });

  it("jefatura de un departamento técnico: solo las de sus laboratorios", () => {
    expect(cotizacionEnAlcance(["DQO", "SQU", "LQC"], ["LQC"], "DCO")).toBe(true);
    expect(cotizacionEnAlcance(["DSA", "SAM", "LMT"], ["LQC"], "DCO")).toBe(false);
  });

  it("jefatura del Departamento Comercial: todas (emite las cotizaciones)", () => {
    expect(cotizacionEnAlcance(["DCO", "SVT", "SPC"], ["LQC"], "DCO")).toBe(true);
    expect(cotizacionEnAlcance(["DCO"], [], "DCO")).toBe(true);
  });

  it("cotización sin laboratorio todavía: solo Comercial o alcance global", () => {
    expect(cotizacionEnAlcance(["LQC"], [], "DCO")).toBe(false);
    expect(cotizacionEnAlcance(["LQC"], [], null)).toBe(false);
  });
});

describe("lectura de la cotización por costeo (COM-09)", () => {
  it("solo quien no tiene cotizacion.ver (ni es SUPERADMIN) lee por costeo", () => {
    expect(leeSoloPorCosteo({ roles: ["ANALISTA"], permisos: ["cotizacion.costear"] })).toBe(true);
    expect(leeSoloPorCosteo({ roles: ["JEFE_LAB"], permisos: ["cotizacion.costear", "cotizacion.ver"] })).toBe(false);
    expect(leeSoloPorCosteo({ roles: ["SUPERADMIN"], permisos: [] })).toBe(false);
  });

  const req = { user: { tenantId: "t1", roles: ["ANALISTA"], permisos: ["cotizacion.costear"] } };
  const alcance = { filtroUnidades: jest.fn(async () => ["LQC"]) };

  it("con solicitud a su laboratorio pasa; sin ella 403; inexistente 404", async () => {
    const con = { cotizacion: { findFirst: jest.fn(async () => ({ id: "c1", codigo: "COT-1" })) }, $queryRawUnsafe: jest.fn(async () => [{ "?column?": 1 }]) };
    await expect(exigirCotizacionPorCosteo(con, alcance, req, "c1")).resolves.toBeUndefined();
    expect(con.$queryRawUnsafe.mock.calls[0][2]).toEqual(["LQC"]);
    expect(alcance.filtroUnidades).toHaveBeenCalledWith(req, "cotizacion.costear");
    const sin = { cotizacion: { findFirst: jest.fn(async () => ({ id: "c1", codigo: "COT-1" })) }, $queryRawUnsafe: jest.fn(async () => []) };
    await expect(exigirCotizacionPorCosteo(sin, alcance, req, "c1")).rejects.toBeInstanceOf(ForbiddenException);
    const nada = { cotizacion: { findFirst: jest.fn(async () => null) }, $queryRawUnsafe: jest.fn() };
    await expect(exigirCotizacionPorCosteo(nada, alcance, req, "c1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
