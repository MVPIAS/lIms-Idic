import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PUBLIC_KEY } from "../auth/public.decorator";
import { descendientes } from "./alcance";
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
 * Pasa quien tiene alcance global (dirección, administración, calidad…) y quien
 * tiene entre sus unidades visibles la unidad declarada o alguna de las que
 * cuelgan de ella. Un jefe de departamento, por tanto, entra en los módulos de
 * sus laboratorios.
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

    const contexto = await this.alcance.paraRequest(req);
    if (contexto.esGlobal) return true;

    const arbol = await this.alcance.arbol(req.user.tenantId);
    const visibles = new Set(contexto.unidadIds);
    const nombres: string[] = [];
    for (const codigo of codigos) {
      const raiz = arbol.porCodigo.get(codigo);
      if (!raiz) continue;
      nombres.push(raiz.nombre);
      if (descendientes(arbol, raiz.id, true).some((id) => visibles.has(id))) return true;
    }
    // Instalación sin esas unidades en el organigrama: el ámbito no se puede
    // evaluar y no se bloquea (queda el control por permiso).
    if (nombres.length === 0) return true;

    throw new ForbiddenException(`Fuera de su alcance: este módulo pertenece a ${nombres.join(" / ")}`);
  }
}
