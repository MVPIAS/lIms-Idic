import { Controller, Get, Module, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

/**
 * Consulta de la bitácora (RF-H04.3). Solo lectura: audit_log es append-only,
 * lo escribe AuditInterceptor y no se expone ningún endpoint de escritura,
 * modificación ni borrado.
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
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

@ApiTags("auditoria")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermiso("audit.ver")
@Controller("auditoria")
export class AuditoriaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar(@Query() query: unknown, @Req() req: any) {
    const q = ConsultaSchema.parse(query ?? {});
    const tenantId = req?.user?.tenantId;

    const where: any = {
      // La bitácora se aísla por tenant como el resto de entidades.
      ...(tenantId ? { tenantId } : {}),
      ...(q.recurso ? { entidadTipo: q.recurso } : {}),
      ...(q.usuarioId ? { usuarioId: q.usuarioId } : {}),
      ...(q.username ? { username: { contains: q.username, mode: "insensitive" } } : {}),
      ...(q.accion ? { accion: q.accion } : {}),
      ...(q.entidadId ? { entidadId: q.entidadId } : {}),
      ...(q.desde || q.hasta
        ? {
            ocurridoAt: {
              ...(q.desde ? { gte: q.desde } : {}),
              ...(q.hasta ? { lte: q.hasta } : {}),
            },
          }
        : {}),
    };

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
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  }
}

@Module({ controllers: [AuditoriaController] })
export class AuditoriaModule {}
