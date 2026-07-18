/**
 * Tests del guard RBAC (`permiso.guard.ts`).
 *
 * Es la última línea de defensa de autorización y objeto directo del pentesting:
 * bypass SUPERADMIN, denegación sin permiso, resolución método > clase > mapa CRUD
 * por verbo HTTP, rutas @Public y el fallo-cerrado cuando no hay usuario.
 *
 * Patrón estándar de test de guards Nest: se mockea Reflector y ExecutionContext.
 */
import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermisoGuard } from "./permiso.guard";
import { PERMISOS_CRUD_KEY, PERMISOS_KEY, PermisosCrud } from "./permisos.decorator";
import { PUBLIC_KEY } from "./public.decorator";

/** Metadata que el Reflector "verá" en esta prueba, por clave. */
interface Meta {
  [PUBLIC_KEY]?: boolean;
  [PERMISOS_KEY]?: string[];
  [PERMISOS_CRUD_KEY]?: PermisosCrud;
}

/**
 * Construye un guard con un Reflector falso que devuelve la metadata indicada,
 * y un ExecutionContext falso con el request (method + user) dado.
 */
function armar(meta: Meta, req: { method?: string; user?: any }) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (meta as any)[key]),
  } as unknown as Reflector;

  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ method: req.method ?? "GET", ...req }),
    }),
  } as unknown as ExecutionContext;

  return { guard: new PermisoGuard(reflector), ctx };
}

describe("PermisoGuard · rutas públicas y sin metadata", () => {
  it("deja pasar una ruta @Public sin evaluar usuario", () => {
    const { guard, ctx } = armar({ [PUBLIC_KEY]: true }, {});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("sin metadata de permisos, solo exige autenticación (pasa)", () => {
    const { guard, ctx } = armar({}, { user: { sub: "u1" } });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe("PermisoGuard · SUPERADMIN", () => {
  it("SUPERADMIN pasa aunque no tenga el permiso concreto", () => {
    const { guard, ctx } = armar(
      { [PERMISOS_KEY]: ["cliente.crear"] },
      { user: { roles: ["SUPERADMIN"], permisos: [] } },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe("PermisoGuard · @RequierePermiso explícito", () => {
  it("concede si el usuario tiene TODOS los permisos requeridos", () => {
    const { guard, ctx } = armar(
      { [PERMISOS_KEY]: ["cliente.ver", "cliente.crear"] },
      { user: { roles: ["ADMIN"], permisos: ["cliente.ver", "cliente.crear", "otro"] } },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("deniega (403) si le falta alguno de los requeridos", () => {
    const { guard, ctx } = armar(
      { [PERMISOS_KEY]: ["cliente.ver", "cliente.crear"] },
      { user: { roles: ["ADMIN"], permisos: ["cliente.ver"] } },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("deniega (403) si el usuario no tiene permisos", () => {
    const { guard, ctx } = armar(
      { [PERMISOS_KEY]: ["cliente.crear"] },
      { user: { roles: ["LECTOR"] } }, // permisos undefined → []
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

describe("PermisoGuard · fallo cerrado sin usuario", () => {
  it("si la ruta exige permisos pero no hay req.user → 401 (nunca abierto)", () => {
    const { guard, ctx } = armar({ [PERMISOS_KEY]: ["cliente.crear"] }, { user: undefined });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});

describe("PermisoGuard · @RequierePermisoCrud por verbo HTTP", () => {
  const crud: PermisosCrud = {
    ver: "cliente.ver",
    crear: "cliente.crear",
    editar: "cliente.editar",
    eliminar: "cliente.eliminar",
  };

  it.each([
    ["GET", "cliente.ver"],
    ["POST", "cliente.crear"],
    ["PATCH", "cliente.editar"],
    ["PUT", "cliente.editar"],
    ["DELETE", "cliente.eliminar"],
  ])("%s exige el permiso %s", (method, permiso) => {
    const conceder = armar(
      { [PERMISOS_CRUD_KEY]: crud },
      { method, user: { roles: [], permisos: [permiso] } },
    );
    expect(conceder.guard.canActivate(conceder.ctx)).toBe(true);

    const denegar = armar(
      { [PERMISOS_CRUD_KEY]: crud },
      { method, user: { roles: [], permisos: [] } },
    );
    expect(() => denegar.guard.canActivate(denegar.ctx)).toThrow(ForbiddenException);
  });

  it("un verbo sin permiso declarado en el mapa CRUD solo exige autenticación", () => {
    const soloVer: PermisosCrud = { ver: "cliente.ver" }; // sin 'crear'
    const { guard, ctx } = armar(
      { [PERMISOS_CRUD_KEY]: soloVer },
      { method: "POST", user: { roles: [], permisos: [] } },
    );
    // POST → crear, que no está en el mapa → requeridos vacío → pasa.
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("@RequierePermiso explícito GANA sobre el mapa CRUD", () => {
    const { guard, ctx } = armar(
      { [PERMISOS_KEY]: ["especial.accion"], [PERMISOS_CRUD_KEY]: crud },
      { method: "GET", user: { roles: [], permisos: ["cliente.ver"] } },
    );
    // Debe exigir 'especial.accion' (explícito), que el usuario NO tiene.
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
