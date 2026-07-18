/**
 * Tests del guard JWT global (`jwt-auth.guard.ts`).
 *
 * Su única responsabilidad propia: eximir las rutas @Public y delegar en el
 * AuthGuard('jwt') de Passport para el resto. Se espía la `canActivate` del
 * padre para no arrancar Passport real (sin red, determinista).
 */
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { PUBLIC_KEY } from "./public.decorator";

function armar(esPublica: boolean) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (key === PUBLIC_KEY ? esPublica : undefined)),
  } as unknown as Reflector;

  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;

  return { guard: new JwtAuthGuard(reflector), ctx };
}

/** Prototipo del AuthGuard('jwt') padre, donde vive la canActivate de Passport. */
const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);

describe("JwtAuthGuard", () => {
  afterEach(() => jest.restoreAllMocks());

  it("deja pasar una ruta @Public sin invocar a Passport", () => {
    const superSpy = jest.spyOn(parentProto, "canActivate");
    const { guard, ctx } = armar(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it("delega en el AuthGuard('jwt') del padre si la ruta NO es pública", () => {
    const superSpy = jest
      .spyOn(parentProto, "canActivate")
      .mockReturnValue("delegado" as any);
    const { guard, ctx } = armar(false);
    expect(guard.canActivate(ctx)).toBe("delegado");
    expect(superSpy).toHaveBeenCalledTimes(1);
    expect(superSpy).toHaveBeenCalledWith(ctx);
  });

  it("propaga la denegación del padre (token ausente/ inválido → false)", () => {
    jest.spyOn(parentProto, "canActivate").mockReturnValue(false as any);
    const { guard, ctx } = armar(false);
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
