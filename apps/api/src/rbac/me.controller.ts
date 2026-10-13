import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { AlcanceService } from "./alcance.service";
import { BandejaService } from "./bandeja.service";
import { descendientes } from "./alcance";

/** Raíces de ámbito que usan los módulos (SAEC, internaciones, Metrología). */
const AMBITOS_DE_MODULO = ["D11", "BPCH", "DCO", "SAM"];

/**
 * Contexto del usuario autenticado: alcance por unidad, perfil y bandeja de
 * pendientes. Abierto a cualquier usuario autenticado (no exige permisos).
 */
@ApiTags("me")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("me")
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly bandeja: BandejaService,
  ) {}

  @Get("alcance")
  async miAlcance(@Req() req: any) {
    const ctx = await this.alcance.paraRequest(req);
    const tenantId: string | undefined = req.user?.tenantId;
    const [usuario, arbol] = await Promise.all([
      this.prisma.usuario.findUnique({
        where: { id: req.user.sub },
        select: { id: true, nombreCompleto: true, username: true },
      }),
      this.alcance.arbol(tenantId),
    ]);
    const nodos = ctx.esGlobal
      ? [...arbol.porId.values()].filter((n) => n.activa !== false)
      : ctx.unidadIds.map((id) => arbol.porId.get(id)!).filter(Boolean);
    const unidadesVisibles = nodos
      .map((n) => ({ id: n.id, codigo: n.codigo, nombre: n.nombre, tipo: n.tipo }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    return {
      usuario: {
        id: usuario?.id ?? req.user.sub,
        nombre: usuario?.nombreCompleto ?? req.user.username,
        username: usuario?.username ?? req.user.username,
      },
      roles: ctx.asignacionesVigentes.map((a) => ({
        codigo: a.rolCodigo,
        nombre: a.rolNombre,
        nivel: a.nivel ?? null,
        unidad: a.unidad,
      })),
      perfil: ctx.perfil,
      esGlobal: ctx.esGlobal,
      unidadesVisibles,
      // Ramas del organigrama a las que pertenecen módulos enteros
      // (@AmbitoUnidad). El menú las usa para no ofrecer lo que daría 403.
      ambitos: Object.fromEntries(
        AMBITOS_DE_MODULO.map((codigo) => {
          const raiz = arbol.porCodigo.get(codigo);
          const dentro =
            ctx.esGlobal || !raiz || descendientes(arbol, raiz.id, true).some((id) => ctx.unidadIds.includes(id));
          return [codigo, dentro];
        }),
      ),
      // Campos adicionales (no rompen el contrato):
      jefaturas: ctx.jefaturas.map((j) => {
        const n = arbol.porId.get(j.unidadId);
        return { rol: j.rol, unidad: n ? { id: n.id, codigo: n.codigo, nombre: n.nombre, tipo: n.tipo } : null };
      }),
      permisos: req.user?.permisos ?? [],
    };
  }

  @Get("bandeja")
  async miBandeja(@Req() req: any) {
    const ctx = await this.alcance.paraRequest(req);
    return this.bandeja.construir(ctx, ctx.perfil, req.user?.tenantId);
  }
}
