import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { AlcanceService } from "./alcance.service";
import { BandejaService } from "./bandeja.service";
import { descendientes } from "./alcance";

/**
 * Ámbitos que usan los módulos (rbac.constants.ts › AMBITOS) y el menú.
 * BPCH_ASIGNADO solo existe en el menú: la rama BPCH sin la Delegación Nº 11,
 * más las unidades que tienen trabajo asignado en un proceso BPCH (la D11 ve
 * «Internaciones» si inspecciona alguna).
 */
const AMBITOS_DE_MODULO = ["D11", "BPCH", "BPCH_CERT", "BPCH_ASIGNADO", "DCO", "SAM"];

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
    const permisosJwt: string[] = req.user?.permisos ?? [];
    // Solo cuentan las unidades de la rama BPCH (la D11 incluida).
    const raizBpch = arbol.porCodigo.get("BPCH");
    const ramaBpch = new Set(raizBpch ? descendientes(arbol, raizBpch.id, true) : []);
    const asignadas = (await this.unidadesConTrabajoBpch(tenantId)).filter((id) => ramaBpch.has(id));
    const ambitos: Record<string, boolean> = {};
    const permisosPorAmbito: Record<string, string[]> = {};
    for (const codigo of AMBITOS_DE_MODULO) {
      const [def, extra] = codigo === "BPCH_ASIGNADO" ? ["BPCH_CERT", asignadas] : [codigo, []];
      const conAlguno = await this.alcance.entraEnAmbito(req, def, [], extra);
      // Sin la raíz en el organigrama no se puede evaluar: no se oculta nada.
      ambitos[codigo] = conAlguno ? conAlguno.entra : true;
      const ps: string[] = [];
      for (const p of permisosJwt) {
        const r = await this.alcance.entraEnAmbito(req, def, p, extra);
        if (!r || r.entra) ps.push(p);
      }
      permisosPorAmbito[codigo] = ps;
    }
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
      // (@AmbitoUnidad). El menú las usa para no ofrecer lo que daría 403:
      //   ambitos[c]            · entra con alguno de sus roles;
      //   permisosPorAmbito[c]  · permisos que valen dentro de la rama c (alcance
      //                           por asignación: el rol que concede el permiso
      //                           tiene que llegar a la rama).
      ambitos,
      permisosPorAmbito,
      // Campos adicionales (no rompen el contrato):
      jefaturas: ctx.jefaturas.map((j) => {
        const n = arbol.porId.get(j.unidadId);
        return { rol: j.rol, unidad: n ? { id: n.id, codigo: n.codigo, nombre: n.nombre, tipo: n.tipo } : null };
      }),
      permisos: req.user?.permisos ?? [],
    };
  }

  /** Unidades que inspeccionan (o llevan) algún expediente BPCH con unidad: trabajo asignado. */
  private async unidadesConTrabajoBpch(tenantId?: string): Promise<string[]> {
    try {
      const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT unidad_inspeccion_id AS id FROM bpch_internacion WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
         UNION SELECT unidad_inspeccion_id FROM bpch_reinspeccion WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
         UNION SELECT unidad_id FROM bpch_prototipo WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
         UNION SELECT o.unidad_principal FROM bpch_clasificacion c JOIN orden_trabajo o ON o.id = c.ot_id
                WHERE ($1::uuid IS NULL OR c.tenant_id = $1::uuid)`,
        tenantId ?? null,
      );
      return filas.map((f) => f.id).filter(Boolean);
    } catch {
      // Instalación sin las tablas BPCH: no hay trabajo asignado.
      return [];
    }
  }

  @Get("bandeja")
  async miBandeja(@Req() req: any) {
    const ctx = await this.alcance.paraRequest(req);
    return this.bandeja.construir(ctx, ctx.perfil, req.user?.tenantId, req.user?.permisos ?? [], req.user?.roles ?? []);
  }
}
