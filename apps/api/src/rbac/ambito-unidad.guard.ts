import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PUBLIC_KEY } from "../auth/public.decorator";
import { AlcanceService } from "./alcance.service";

export const AMBITO_UNIDAD_KEY = "ambito_unidad";

/**
 * Declara que un módulo PERTENECE a una rama del organigrama.
 *
 *   @AmbitoUnidad("D11")          // SAEC: solo la Delegación Nº 11
 *   @AmbitoUnidad("BPCH", "DCO")  // internaciones: BPCH o Comercial
 *
 * El permiso (PermisoGuard) responde «¿este ROL puede hacer esto?»; el ámbito
 * responde «¿esta PERSONA trabaja donde vive este módulo?». Los permisos van
 * por rol, no por unidad: sin el ámbito, un analista del laboratorio químico
 * —que comparte rol con el de la Delegación Nº 11— veía las evidencias de armas.
 *
 * Pasa quien, con los roles que conceden el permiso de la ruta, tiene alcance
 * global o alguna unidad de la rama (la raíz o lo que cuelga de ella). Un jefe
 * de departamento, por tanto, entra en los módulos de sus laboratorios.
 * Los ámbitos se definen en rbac.constants.ts (AMBITOS): «D11» es estricto (el
 * alcance global solo vale a Superadministración, Dirección, Subdirección y
 * Lector/Auditor) y «BPCH_CERT» es la rama BPCH sin la Delegación Nº 11.
 */
export const AmbitoUnidad = (...codigos: string[]) => SetMetadata(AMBITO_UNIDAD_KEY, codigos);

/** Guard global, registrado en app.module.ts después de PermisoGuard. */
@Injectable()
export class AmbitoUnidadGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly alcance: AlcanceService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const destino = [ctx.getHandler(), ctx.getClass()];
    const codigos = this.reflector.getAllAndOverride<string[]>(AMBITO_UNIDAD_KEY, destino);
    if (!codigos?.length) return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, destino)) return true;

    const req = ctx.switchToHttp().getRequest();
    // Sin usuario no hay nada que acotar: la autenticación la exige JwtAuthGuard.
    if (!req?.user?.sub) return true;

    // Alcance por asignación: cuenta solo lo que dan los roles que conceden los
    // permisos de la ruta. Los ámbitos estrictos (D11) no se pasan por tener un
    // rol global, salvo los roles que la definición del ámbito admite.
    const nombres: string[] = [];
    for (const codigo of codigos) {
      const r = await this.alcance.entraEnAmbito(req, codigo);
      if (!r) continue;
      nombres.push(r.nombre);
      if (r.entra) return true;
    }
    // Instalación sin esas unidades en el organigrama: el ámbito no se puede
    // evaluar y no se bloquea (queda el control por permiso).
    if (nombres.length === 0) return true;

    throw new ForbiddenException(`Fuera de su alcance: este módulo pertenece a ${nombres.join(" / ")}`);
  }
}
