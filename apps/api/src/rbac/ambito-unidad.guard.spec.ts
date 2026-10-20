/**
 * AmbitoUnidadGuard con alcance por asignación: el ámbito se evalúa con los
 * roles que conceden el permiso de la ruta, y «D11» (SAEC) es estricto.
 */
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AlcanceService } from "./alcance.service";
import { AMBITO_UNIDAD_KEY, AmbitoUnidadGuard } from "./ambito-unidad.guard";

const N = (id: string, padreId: string | null, tipo: string) => ({ id, padreId, codigo: id, nombre: `Unidad ${id}`, tipo, activa: true });
const NODOS = [
  N("DIR", null, "DIRECCION"),
  N("DQO", "DIR", "DEPARTAMENTO"),
  N("LPN", "DQO", "LABORATORIO"),
  N("BPCH", "DIR", "DEPARTAMENTO"),
  N("SANTOF", "BPCH", "SUCURSAL"),
  N("D11", "BPCH", "DELEGACION"),
];

const fila = (codigo: string, alcance: string, unidadId: string | null, permisos: string[], nivel = "OPERATIVO") => ({
  id: `${codigo}-${unidadId}`,
  rolId: `rol-${codigo}`,
  unidadId,
  vigenteDesde: new Date("2026-01-01"),
  vigenteHasta: null,
  rol: { id: `rol-${codigo}`, codigo, nombre: codigo, nivel, alcance, aliasDe: null, rolPermisos: permisos.map((c) => ({ permiso: { codigo: c } })) },
  unidad: unidadId ? { id: unidadId, codigo: unidadId, nombre: unidadId, tipo: "LABORATORIO" } : null,
});

function armar(codigos: string[], filas: any[], permisosRuta: string[], roles: string[] = []) {
  const prisma: any = {
    unidad: { findMany: jest.fn().mockResolvedValue(NODOS) },
    usuarioRol: { findMany: jest.fn().mockResolvedValue(filas) },
    unidadJefe: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const alcance = new AlcanceService(prisma);
  const reflector = { getAllAndOverride: jest.fn((k: string) => (k === AMBITO_UNIDAD_KEY ? codigos : undefined)) } as unknown as Reflector;
  const req = { user: { sub: "u1", tenantId: "t1", roles }, __permisosRuta: permisosRuta };
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { guard: new AmbitoUnidadGuard(reflector, alcance), ctx };
}

describe("AmbitoUnidadGuard · alcance por asignación", () => {
  it("D11: Recepción (global) ya no entra en SAEC", async () => {
    const { guard, ctx } = armar(["D11"], [fila("RECEPCION", "GLOBAL", null, ["evidencia.ver"])], ["evidencia.ver"]);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("D11: Dirección y Lector/Auditor entran", async () => {
    for (const rol of ["DIRECTOR", "LECTOR"]) {
      const { guard, ctx } = armar(["D11"], [fila(rol, "GLOBAL", null, ["evidencia.ver"])], ["evidencia.ver"]);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });

  it("D11: superadministración (rol en el token) entra", async () => {
    const { guard, ctx } = armar(["D11"], [], ["evidencia.ver"], ["SUPERADMIN"]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("D11: la unidad de la Delegación entra; un analista de LPN con rol comercial no", async () => {
    const perito = armar(["D11"], [fila("PERITO_SAEC", "UNIDAD", "D11", ["evidencia.ver"])], ["evidencia.ver"]);
    await expect(perito.guard.canActivate(perito.ctx)).resolves.toBe(true);
    const mixto = armar(
      ["D11"],
      [fila("ANALISTA", "UNIDAD", "LPN", ["evidencia.ver"]), fila("COMERCIAL", "GLOBAL", null, ["ot.ver"])],
      ["evidencia.ver"],
    );
    await expect(mixto.guard.canActivate(mixto.ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("BPCH_CERT: la D11 no entra; una sucursal sí", async () => {
    const d11 = armar(["BPCH_CERT"], [fila("INSPECTOR", "UNIDAD", "D11", ["bpch.pn.ver"])], ["bpch.pn.ver"]);
    await expect(d11.guard.canActivate(d11.ctx)).rejects.toThrow(/Fuera de su alcance/);
    const suc = armar(["BPCH_CERT"], [fila("INSPECTOR", "UNIDAD", "SANTOF", ["bpch.pn.ver"])], ["bpch.pn.ver"]);
    await expect(suc.guard.canActivate(suc.ctx)).resolves.toBe(true);
  });

  it("BPCH (procesos con unidad): la D11 entra (luego el listado la acota a lo suyo)", async () => {
    const { guard, ctx } = armar(["BPCH"], [fila("INSPECTOR", "UNIDAD", "D11", ["bpch.internacion.ver"])], ["bpch.internacion.ver"]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("no estricto: el permiso concedido por un rol global entra", async () => {
    const { guard, ctx } = armar(["BPCH"], [fila("COMERCIAL", "GLOBAL", null, ["bpch.internacion.ver"])], ["bpch.internacion.ver"]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("el permiso de la ruta lo concede solo el rol de fuera de la rama → 403", async () => {
    // Analista de LPN (con bpch.internacion.ver por error) + jefe de una sucursal sin ese permiso
    const { guard, ctx } = armar(
      ["BPCH"],
      [fila("ANALISTA", "UNIDAD", "LPN", ["bpch.internacion.ver"]), fila("JEFE_LAB", "UNIDAD", "SANTOF", ["ot.ver"], "JEFATURA")],
      ["bpch.internacion.ver"],
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("raíz inexistente en el organigrama: no se bloquea", async () => {
    const { guard, ctx } = armar(["NOEXISTE"], [fila("ANALISTA", "UNIDAD", "LPN", ["x"])], ["x"]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
