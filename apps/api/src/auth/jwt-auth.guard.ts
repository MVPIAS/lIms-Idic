import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { PUBLIC_KEY } from "./public.decorator";

/**
 * Guard JWT GLOBAL (APP_GUARD en app.module.ts).
 *
 * ¿Por qué existe? El RBAC se aplica con PermisoGuard, también global. Nest
 * ejecuta los guards en este orden: GLOBALES → controlador → ruta. Si PermisoGuard
 * fuese el único guard global, correría ANTES del `@UseGuards(AuthGuard('jwt'))`
 * que cada controlador declara: `req.user` aún no existiría y TODA petición
 * (incluida la del SUPERADMIN) sería rechazada con 403.
 *
 * Por eso la autenticación se eleva a global y se registra ANTES que PermisoGuard
 * (el orden del array `providers` fija el orden de ejecución). Los
 * `@UseGuards(AuthGuard('jwt'))` de cada controlador se mantienen: son
 * redundantes pero inofensivos, y conservan el comportamiento si alguien
 * retirase el guard global.
 *
 * Las rutas marcadas con @Public() (login, refresh, health) quedan exentas.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    const esPublica = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublica) return true;
    return super.canActivate(ctx);
  }
}
