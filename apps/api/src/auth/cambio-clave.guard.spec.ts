/**
 * Cambio de contraseña obligatorio (claim `cambioClave` del JWT): PermisoGuard
 * solo deja usar las rutas marcadas con @PermiteCambioClavePendiente.
 */
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermisoGuard } from "./permiso.guard";
import { PERMISOS_KEY } from "./permisos.decorator";
import { PUBLIC_KEY } from "./public.decorator";
import { CODIGO_CAMBIO_CLAVE, PERMITE_CAMBIO_CLAVE_KEY } from "./cambio-clave.decorator";

function armar(meta: Record<string, unknown>, user: any) {
  const reflector = { getAllAndOverride: jest.fn((k: string) => meta[k]) } as unknown as Reflector;
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ method: "GET", user }) }),
  } as unknown as ExecutionContext;
  return { guard: new PermisoGuard(reflector), ctx };
}

describe("PermisoGuard · contraseña temporal pendiente", () => {
  it("bloquea cualquier ruta con 403 CAMBIO_CLAVE_REQUERIDO, aunque tenga el permiso", () => {
    const { guard, ctx } = armar({ [PERMISOS_KEY]: ["ot.ver"] }, { sub: "u1", permisos: ["ot.ver"], cambioClave: true });
    try {
      guard.canActivate(ctx);
      fail("debió lanzar");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.getResponse().codigo).toBe(CODIGO_CAMBIO_CLAVE);
    }
  });

  it("bloquea también rutas sin permiso declarado (solo autenticadas)", () => {
    const { guard, ctx } = armar({}, { sub: "u1", cambioClave: true });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("deja pasar las rutas marcadas para el cambio (me, logout, cambiar-password)", () => {
    const { guard, ctx } = armar({ [PERMITE_CAMBIO_CLAVE_KEY]: true }, { sub: "u1", cambioClave: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("incluso un SUPERADMIN con contraseña temporal debe cambiarla primero", () => {
    const { guard, ctx } = armar({ [PERMISOS_KEY]: ["admin.usuarios"] }, { sub: "u1", roles: ["SUPERADMIN"], cambioClave: true });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("sin la marca, todo sigue igual", () => {
    const { guard, ctx } = armar({ [PERMISOS_KEY]: ["ot.ver"] }, { sub: "u1", permisos: ["ot.ver"] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("las rutas públicas no se ven afectadas", () => {
    const { guard, ctx } = armar({ [PUBLIC_KEY]: true }, { sub: "u1", cambioClave: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
