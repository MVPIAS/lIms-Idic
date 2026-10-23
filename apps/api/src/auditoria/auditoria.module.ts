import { Controller, Get, Module, Query, Req, UseGuards } from "@nestjs/common";
import { LaboratorioModule } from "../laboratorio/laboratorio.module";
import { ReclamoController } from "./reclamo.controller";
import { ApelacionController } from "./apelacion.controller";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { finDelDia, whereAuditoria } from "./filtro-auditoria";
import { NoConformidadController } from "./no-conformidad.controller";

/**
 * Consulta de la bitácora (RF-H04.3). Solo lectura: audit_log es append-only,
 * lo escribe AuditInterceptor y no se expone ningún endpoint de escritura,
 * modificación ni borrado.
 *
 * Alcance: los perfiles globales ven toda la bitácora; una jefatura acotada a
 * unidades (jefe de laboratorio, sección o departamento) solo ve lo hecho por
 * las personas de sus unidades visibles y lo suyo (filtro-auditoria.ts).
 */
const ConsultaSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  /** Filtra por recurso: el primer segmento de la ruta (p. ej. 'cotizaciones'). */
  recurso: z.string().max(60).optional(),
  usuarioId: z.string().uuid().optional(),
  username: z.string().max(80).optional(),
  accion: z.string().max(60).optional(),
  entidadId: z.string().uuid().optional(),
  /** Código legible de la entidad (p. ej. COT-2026-0004, OT-…). */
  entidadCodigo: z.string().max(60).optional(),
  desde: z.coerce.date().optional(),
  /** 'AAAA-MM-DD' = hasta el final de ese día. */
  hasta: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.coerce.date()]).optional(),
});

@ApiTags("auditoria")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermiso("audit.ver")
@Controller("auditoria")
export class AuditoriaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  /** null = ve todo; string[] = ids de las personas cuyas acciones puede ver. */
  private async usuariosDeAlcance(req: any): Promise<string[] | null> {
    const unidades = await this.alcance.filtroUnidades(req);
    if (unidades === null) return null;
    const filas = unidades.length
      ? await this.prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT DISTINCT ur.usuario_id AS id FROM usuario_rol ur WHERE ur.unidad_id = ANY($1::uuid[])`,
          unidades,
        )
      : [];
    const ids = new Set(filas.map((f) => f.id));
    if (req?.user?.sub) ids.add(req.user.sub);
    return [...ids];
  }

  @Get()
  async listar(@Query() query: unknown, @Req() req: any) {
    const q = ConsultaSchema.parse(query ?? {});
    const tenantId = req?.user?.tenantId;
    const alcance = await this.usuariosDeAlcance(req);
    const where = whereAuditoria(
      { ...q, hasta: q.hasta !== undefined ? finDelDia(q.hasta as any) : undefined },
      tenantId,
      alcance,
    );

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { ocurridoAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
        // Para que la pantalla explique por qué ve menos filas.
        acotada: alcance !== null,
      },
    };
  }

  /** Valores para los filtros de la pantalla (recursos y acciones registradas). */
  @Get("opciones")
  async opciones(@Req() req: any) {
    const tenantId = req?.user?.tenantId ?? null;
    const [recursos, acciones] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ v: string }[]>(
        `SELECT DISTINCT entidad_tipo AS v FROM audit_log
          WHERE tenant_id = COALESCE($1::uuid, tenant_id) AND ocurrido_at > now() - interval '365 days'
          ORDER BY 1 LIMIT 200`,
        tenantId,
      ),
      this.prisma.$queryRawUnsafe<{ v: string }[]>(
        `SELECT DISTINCT accion AS v FROM audit_log
          WHERE tenant_id = COALESCE($1::uuid, tenant_id) AND ocurrido_at > now() - interval '365 days'
          ORDER BY 1 LIMIT 100`,
        tenantId,
      ),
    ]);
    return { recursos: recursos.map((r) => r.v), acciones: acciones.map((a) => a.v) };
  }
}

@Module({ imports: [LaboratorioModule], controllers: [AuditoriaController, NoConformidadController, ReclamoController, ApelacionController] })
export class AuditoriaModule {}
