import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISOS_KEY } from "./permisos.decorator";

/**
 * Guard RBAC. Lee los permisos exigidos por @RequierePermiso y los compara con
 * los permisos del usuario (que vienen en el JWT: req.user.permisos / req.user.roles).
 * Debe ir DESPUÉS del AuthGuard('jwt'):
 *   @UseGuards(AuthGuard('jwt'), PermisoGuard)
 *   @RequierePermiso('cliente.crear')
 * SUPERADMIN pasa siempre. Sin metadata de permisos → deja pasar (solo exige login).
 */
@Injectable()
export class PermisoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requeridos =
      this.reflector.getAllAndOverride<string[]>(PERMISOS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (requeridos.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user ?? {};
    const roles: string[] = user.roles ?? [];
    if (roles.includes("SUPERADMIN")) return true;

    const permisos: string[] = user.permisos ?? [];
    const ok = requeridos.every((p) => permisos.includes(p));
    if (!ok) {
      throw new ForbiddenException(`Permiso insuficiente. Requiere: ${requeridos.join(", ")}`);
    }
    return true;
  }
}
