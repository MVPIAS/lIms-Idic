import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISOS_CRUD_KEY, PERMISOS_KEY, PermisosCrud } from "./permisos.decorator";
import { PUBLIC_KEY } from "./public.decorator";
import { CODIGO_CAMBIO_CLAVE, PERMITE_CAMBIO_CLAVE_KEY } from "./cambio-clave.decorator";

/** Verbo HTTP → clave del mapa @RequierePermisoCrud. */
const VERBO_A_ACCION: Record<string, keyof PermisosCrud> = {
  GET: "ver",
  POST: "crear",
  PATCH: "editar",
  PUT: "editar",
  DELETE: "eliminar",
};

/**
 * Guard RBAC. Registrado como APP_GUARD global en app.module.ts, DESPUÉS de
 * JwtAuthGuard (que es quien puebla `req.user` con los permisos del JWT).
 *
 * Resuelve el permiso exigido en este orden:
 *   1. @RequierePermiso del método (gana siempre).
 *   2. @RequierePermiso de la clase.
 *   3. @RequierePermisoCrud de la clase, según el verbo HTTP (controladores
 *      que heredan sus rutas de BaseCrudController).
 *
 * Sin metadata de permisos → deja pasar (la ruta solo exige estar autenticado).
 * SUPERADMIN pasa siempre.
 *
 * Deja los permisos exigidos en `req.__permisosRuta`: con ellos AlcanceService
 * calcula el alcance POR ASIGNACIÓN (cada permiso vale en las unidades del rol
 * que lo concede, no en la unión de todas las del usuario).
 */
@Injectable()
export class PermisoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // Las rutas públicas (login/health) no tienen usuario ni permisos que evaluar.
    const esPublica = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublica) return true;

    // Contraseña temporal (alta o restablecimiento): hasta cambiarla, el usuario
    // solo puede usar las rutas marcadas con @PermiteCambioClavePendiente.
    const usuario = ctx.switchToHttp().getRequest()?.user;
    if (usuario?.cambioClave) {
      const permitida = this.reflector.getAllAndOverride<boolean>(PERMITE_CAMBIO_CLAVE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (!permitida) {
        throw new ForbiddenException({
          statusCode: 403,
          codigo: CODIGO_CAMBIO_CLAVE,
          message: "Debe cambiar su contraseña temporal antes de continuar (Mi perfil › Cambiar contraseña).",
        });
      }
    }

    const requeridos = this.resolverRequeridos(ctx);
    const req = ctx.switchToHttp().getRequest();
    // Alcance por asignación: los servicios filtran con el alcance de las
    // asignaciones cuyo rol concede ESTOS permisos (AlcanceService).
    if (req) req.__permisosRuta = requeridos;
    if (requeridos.length === 0) return true;

    const user = req.user;
    // Si la ruta exige permisos pero no hay usuario, el guard JWT no corrió
    // (orden de guards mal configurado). Se falla cerrado, nunca abierto.
    if (!user) throw new UnauthorizedException("No autenticado");

    const roles: string[] = user.roles ?? [];
    if (roles.includes("SUPERADMIN")) return true;

    const permisos: string[] = user.permisos ?? [];
    const ok = requeridos.every((p) => permisos.includes(p));
    if (!ok) {
      throw new ForbiddenException(`Permiso insuficiente. Requiere: ${requeridos.join(", ")}`);
    }
    return true;
  }

  /** Permisos exigidos por la ruta (método > clase > mapa CRUD por verbo). */
  private resolverRequeridos(ctx: ExecutionContext): string[] {
    const explicitos = this.reflector.getAllAndOverride<string[]>(PERMISOS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (explicitos?.length) return explicitos;

    const crud = this.reflector.getAllAndOverride<PermisosCrud>(PERMISOS_CRUD_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!crud) return [];

    const metodo: string = ctx.switchToHttp().getRequest().method;
    const codigo = crud[VERBO_A_ACCION[metodo]];
    return codigo ? [codigo] : [];
  }
}
