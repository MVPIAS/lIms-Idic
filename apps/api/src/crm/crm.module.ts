import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Módulo CRM · Oportunidades comerciales del LIMS.
// Permite registrar una oferta/oportunidad SIN crear una cotización formal,
// gestionarla por etapas/estados y convertirla (hook) a cotización u OT.
//
// La tabla `oportunidad` (packages/db/crm_oportunidad.sql) todavía no está en
// el schema de Prisma, por lo que este controlador usa SQL crudo tipado sobre
// un PrismaClient propio (mismo patrón de aislamiento por tenant que ot.controller).
// ---------------------------------------------------------------------------

const ETAPAS = ["prospecto", "calificada", "propuesta", "negociacion", "ganada", "perdida"] as const;
const ESTADOS = ["viva", "ganada", "perdida", "cerrada"] as const;

const emptyToNull = (v: unknown) => (v === "" ? null : v);

const CrearOportunidadSchema = z.object({
  titulo: z.string().min(1).max(200),
  clienteId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  contacto: z.preprocess(emptyToNull, z.string().max(160).nullable().optional()),
  montoEstimado: z.coerce.number().nonnegative().optional(),
  moneda: z.string().length(3).optional(),
  probabilidad: z.coerce.number().int().min(0).max(100).optional(),
  etapa: z.enum(ETAPAS).optional(),
  estado: z.enum(ESTADOS).optional(),
  origen: z.preprocess(emptyToNull, z.string().max(60).nullable().optional()),
  fechaCierreEstimada: z.preprocess(emptyToNull, z.string().nullable().optional()),
  notas: z.preprocess(emptyToNull, z.string().nullable().optional()),
});

const ActualizarOportunidadSchema = CrearOportunidadSchema.partial();

type OportunidadInput = z.infer<typeof CrearOportunidadSchema>;

// Mapa campo (JSON camelCase) -> columna (snake_case) para el PATCH dinámico.
const COLS: Record<string, string> = {
  titulo: "titulo",
  clienteId: "cliente_id",
  contacto: "contacto",
  montoEstimado: "monto_estimado",
  moneda: "moneda",
  probabilidad: "probabilidad",
  etapa: "etapa",
  estado: "estado",
  origen: "origen",
  fechaCierreEstimada: "fecha_cierre_estimada",
  notas: "notas",
};

@ApiTags("oportunidades")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("oportunidades")
export class OportunidadController {
  private prisma = new PrismaClient();

  // --- helpers -------------------------------------------------------------

  private tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  private async cargarPropia(id: string, tenantId: string): Promise<any> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.*, to_jsonb(c.*) AS cliente
         FROM oportunidad o
         LEFT JOIN cliente c ON c.id = o.cliente_id
        WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid AND o.deleted_at IS NULL
        LIMIT 1`,
      id,
      tenantId,
    );
    if (!rows.length) throw new NotFoundException("Oportunidad no encontrada");
    return rows[0];
  }

  private async cambiarEstado(id: string, tenantId: string, estado: string, etapa?: string): Promise<any> {
    await this.cargarPropia(id, tenantId); // valida pertenencia (404 si no es del tenant)
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE oportunidad
          SET estado = $3,
              etapa = COALESCE($4, etapa)
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      id,
      tenantId,
      estado,
      etapa ?? null,
    );
    return rows[0];
  }

  // --- endpoints -----------------------------------------------------------

  @Get()
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "100",
    @Query("estado") estado: string | undefined,
    @Req() req: any,
  ) {
    const tenantId = this.tenantId(req);
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit) || 100));
    const offset = (p - 1) * l;

    const filtroEstado = estado ? " AND o.estado = $4" : "";
    const args: any[] = [tenantId, l, offset];
    if (estado) args.push(estado);

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.*, to_jsonb(c.*) AS cliente
         FROM oportunidad o
         LEFT JOIN cliente c ON c.id = o.cliente_id
        WHERE o.tenant_id = $1::uuid AND o.deleted_at IS NULL${filtroEstado}
        ORDER BY o.etapa ASC, o.created_at DESC
        LIMIT $2 OFFSET $3`,
      ...args,
    );

    const totalArgs: any[] = [tenantId];
    if (estado) totalArgs.push(estado);
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total
         FROM oportunidad o
        WHERE o.tenant_id = $1::uuid AND o.deleted_at IS NULL${estado ? " AND o.estado = $2" : ""}`,
      ...totalArgs,
    );
    const total = Number(totalRows[0]?.total ?? 0);

    return { data, meta: { page: p, limit: l, total } };
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.cargarPropia(id, this.tenantId(req));
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d: OportunidadInput = CrearOportunidadSchema.parse(body);

    // Genera OPP-2026-NNNN a partir del mayor correlativo del tenant.
    const nextRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(split_part(codigo, '-', 3)::int), 0) + 1 AS next
         FROM oportunidad
        WHERE tenant_id = $1::uuid AND codigo LIKE 'OPP-2026-%'`,
      tenantId,
    );
    const next = Number(nextRows[0]?.next ?? 1);
    const codigo = `OPP-2026-${String(next).padStart(4, "0")}`;

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO oportunidad
         (tenant_id, codigo, titulo, cliente_id, contacto, monto_estimado, moneda,
          probabilidad, etapa, estado, origen, fecha_cierre_estimada, notas)
       VALUES
         ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12::date, $13)
       RETURNING *`,
      tenantId,
      codigo,
      d.titulo,
      d.clienteId ?? null,
      d.contacto ?? null,
      d.montoEstimado ?? 0,
      d.moneda ?? "CLP",
      d.probabilidad ?? 50,
      d.etapa ?? "prospecto",
      d.estado ?? "viva",
      d.origen ?? null,
      d.fechaCierreEstimada ?? null,
      d.notas ?? null,
    );
    return rows[0];
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = ActualizarOportunidadSchema.parse(body) as Record<string, unknown>;
    await this.cargarPropia(id, tenantId); // valida pertenencia

    const sets: string[] = [];
    const args: any[] = [id, tenantId];
    for (const [key, col] of Object.entries(COLS)) {
      if (key in d) {
        args.push(d[key] ?? null);
        const cast = col === "cliente_id" ? "::uuid" : col === "fecha_cierre_estimada" ? "::date" : "";
        sets.push(`${col} = $${args.length}${cast}`);
      }
    }
    if (!sets.length) return this.cargarPropia(id, tenantId);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE oportunidad
          SET ${sets.join(", ")}
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      ...args,
    );
    return rows[0];
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    await this.cargarPropia(id, tenantId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE oportunidad SET deleted_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantId,
    );
    return { ok: true };
  }

  @Post(":id/ganar")
  async ganar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.cambiarEstado(id, this.tenantId(req), "ganada", "ganada");
  }

  @Post(":id/perder")
  async perder(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.cambiarEstado(id, this.tenantId(req), "perdida", "perdida");
  }

  @Post(":id/convertir")
  async convertir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    // Marca la oportunidad como ganada. Hook para el futuro: al enlazar con
    // una cotización u OT reales, setear cotizacion_id / ot_id aquí.
    return this.cambiarEstado(id, tenantId, "ganada", "ganada");
  }
}

@Module({
  controllers: [OportunidadController],
})
export class CrmModule {}
