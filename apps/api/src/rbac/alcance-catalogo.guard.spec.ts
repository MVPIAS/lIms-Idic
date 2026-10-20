/**
 * AlcanceCatalogoGuard: una jefatura solo cambia (y abre por id) el catálogo de
 * SU laboratorio; Calidad y Administración, con alcance global, todo.
 */
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AlcanceCatalogoGuard,
  RECURSO_LABORATORIO_KEY,
  SIN_ALCANCE_ESCRITURA_KEY,
} from "./alcance-catalogo.guard";

const ID_LQC = "11111111-1111-4111-8111-111111111111";
const ID_LPN = "22222222-2222-4222-8222-222222222222";
const ID_COMUN = "33333333-3333-4333-8333-333333333333";
const FAM_LQC = "44444444-4444-4444-8444-444444444444";

function armar(opts: {
  metodo: string;
  meta?: Record<string, unknown>;
  permisosRuta: string[];
  global?: boolean;
  unidades?: string[];
  params?: Record<string, string>;
  body?: any;
}) {
  const reflector = { getAllAndOverride: jest.fn((k: string) => opts.meta?.[k]) } as unknown as Reflector;
  const alcance: any = {
    alcancePermisos: jest.fn(async () => ({
      esGlobal: !!opts.global,
      unidadIds: opts.global ? [] : opts.unidades ?? [],
      rolesGlobales: [],
      unidadesPropias: [],
    })),
  };
  // Familia de cada registro → unidad: LQC y LPN; el común no tiene familia.
  const prisma: any = {
    $queryRawUnsafe: jest.fn(async (sql: string, arg: any) => {
      if (sql.includes("JOIN unidad u")) return (arg as string[]).map((f) => ({ id: f === FAM_LQC ? "LQC" : "LPN" }));
      if (arg === ID_LQC) return [{ id: FAM_LQC }];
      if (arg === ID_LPN) return [{ id: "fam-lpn" }];
      if (arg === FAM_LQC) return [{ id: FAM_LQC }];
      if (arg === ID_COMUN) return [{ id: null }];
      return [];
    }),
  };
  const req = { method: opts.metodo, user: { sub: "u1" }, __permisosRuta: opts.permisosRuta, params: opts.params ?? {}, body: opts.body ?? {} };
  const ctx = {
    getType: () => "http",
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { guard: new AlcanceCatalogoGuard(reflector, alcance, prisma), ctx };
}

const ENSAYO = { [RECURSO_LABORATORIO_KEY]: "cat_ensayo" };

describe("AlcanceCatalogoGuard · escrituras", () => {
  it("jefe de LQC cambia el precio de un ensayo de LQC", async () => {
    const { guard, ctx } = armar({ metodo: "PATCH", meta: ENSAYO, permisosRuta: ["catalogo.gestionar"], unidades: ["LQC"], params: { id: ID_LQC } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("jefe de LPN NO cambia el precio de un ensayo de LQC (403)", async () => {
    const { guard, ctx } = armar({ metodo: "PATCH", meta: ENSAYO, permisosRuta: ["catalogo.gestionar"], unidades: ["LPN"], params: { id: ID_LQC } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("no puede mover un ensayo suyo a la familia de otro laboratorio", async () => {
    const { guard, ctx } = armar({
      metodo: "PATCH", meta: ENSAYO, permisosRuta: ["catalogo.gestionar"], unidades: ["LPN"],
      params: { id: ID_LPN }, body: { familiaId: FAM_LQC },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Fuera de su alcance/);
  });

  it("alta: el registro padre del cuerpo tiene que ser de su laboratorio; sin padre, solo alcance global", async () => {
    const ok = armar({ metodo: "POST", meta: ENSAYO, permisosRuta: ["catalogo.gestionar"], unidades: ["LQC"], body: { familiaId: FAM_LQC } });
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);
    const sinPadre = armar({ metodo: "POST", meta: ENSAYO, permisosRuta: ["catalogo.gestionar"], unidades: ["LQC"], body: {} });
    await expect(sinPadre.guard.canActivate(sinPadre.ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("tablas comunes (sin @RecursoDeLaboratorio): solo con alcance global", async () => {
    const jefe = armar({ metodo: "POST", permisosRuta: ["catalogo.gestionar"], unidades: ["LQC"] });
    await expect(jefe.guard.canActivate(jefe.ctx)).rejects.toThrow(/común a todo el instituto/);
    const calidad = armar({ metodo: "POST", permisosRuta: ["catalogo.gestionar"], global: true });
    await expect(calidad.guard.canActivate(calidad.ctx)).resolves.toBe(true);
  });

  it("rutas que solo validan (@SinAlcanceDeEscritura) y permisos con dimensión de laboratorio no se tocan", async () => {
    const validar = armar({ metodo: "POST", meta: { [SIN_ALCANCE_ESCRITURA_KEY]: true }, permisosRuta: ["catalogo.gestionar"], unidades: ["LQC"] });
    await expect(validar.guard.canActivate(validar.ctx)).resolves.toBe(true);
    const otro = armar({ metodo: "POST", permisosRuta: ["resultado.crear"], unidades: ["LQC"] });
    await expect(otro.guard.canActivate(otro.ctx)).resolves.toBe(true);
  });
});

describe("AlcanceCatalogoGuard · detalle por id", () => {
  it("analista de LPN no abre un ensayo de LQC; sí uno común o uno suyo", async () => {
    const ajeno = armar({ metodo: "GET", meta: ENSAYO, permisosRuta: ["muestra.ver"], unidades: ["LPN"], params: { id: ID_LQC } });
    await expect(ajeno.guard.canActivate(ajeno.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const comun = armar({ metodo: "GET", meta: ENSAYO, permisosRuta: ["muestra.ver"], unidades: ["LPN"], params: { id: ID_COMUN } });
    await expect(comun.guard.canActivate(comun.ctx)).resolves.toBe(true);
    const suyo = armar({ metodo: "GET", meta: ENSAYO, permisosRuta: ["muestra.ver"], unidades: ["LPN"], params: { id: ID_LPN } });
    await expect(suyo.guard.canActivate(suyo.ctx)).resolves.toBe(true);
  });

  it("alcance global (Comercial, Calidad): abre cualquiera", async () => {
    const { guard, ctx } = armar({ metodo: "GET", meta: ENSAYO, permisosRuta: ["muestra.ver"], global: true, params: { id: ID_LQC } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
