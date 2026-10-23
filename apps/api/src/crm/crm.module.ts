import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { anioChile } from "../common/fecha-chile";
import { oportunidadEnAlcance, siguienteCodigoOportunidad } from "./reglas-crm";

// ---------------------------------------------------------------------------
// Módulo CRM · Oportunidades comerciales del LIMS (EP-00 0.3).
// Registra una oportunidad SIN cotización formal, la gestiona por etapas y la
// convierte en cotización («Crear cotización →»): la cotización se enlaza al
// guardarla (cotizacion_id) y, al aceptarse, la oportunidad pasa a «ganada» con
// su OT (ot_id). Lo hace cotizacion.service.
//
// Alcance por laboratorio (reglas-crm.ts): Comercial (DCO en su alcance) las ve
// todas; una jefatura técnica, las de sus laboratorios (unidad_id).
// La tabla `oportunidad` no está en el schema de Prisma: SQL crudo tipado.
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
  /** Laboratorio o centro de costo (EP-00 0.3): define quién ve la oportunidad. */
  unidadId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
});

const ActualizarOportunidadSchema = CrearOportunidadSchema.partial();
const PerderSchema = z.object({ motivo: z.string().trim().min(3, "Indique el motivo de la pérdida.").max(1000) });

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
  unidadId: "unidad_id",
};

/** Lectura: la oportunidad con su cliente, su laboratorio y la cotización y OT enlazadas. */
const SELECT_OPP = `SELECT o.*, to_jsonb(c.*) AS cliente,
         un.codigo AS unidad_codigo, un.nombre AS unidad_nombre,
         co.codigo AS cotizacion_codigo, co.estado AS cotizacion_estado, ot.codigo AS ot_codigo
    FROM oportunidad o
    LEFT JOIN cliente c ON c.id = o.cliente_id
    LEFT JOIN unidad un ON un.id = o.unidad_id
    LEFT JOIN cotizacion co ON co.id = o.cotizacion_id
    LEFT JOIN orden_trabajo ot ON ot.id = o.ot_id`;

/**
 * El CRM no tiene permisos propios: se gobierna con el dominio comercial,
 * `cotizacion.*`, y con el alcance por laboratorio.
 */
@ApiTags("oportunidades")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermisoCrud({
  ver: "cotizacion.ver",
  crear: "cotizacion.crear",
  editar: "cotizacion.crear",
  eliminar: "cotizacion.crear",
})
@Controller("oportunidades")
export class OportunidadController {
  private prisma = new PrismaClient();
  constructor(private readonly alcance: AlcanceService) {}

  // --- helpers -------------------------------------------------------------

  private tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  /** Unidades visibles (null = todas) y el DCO, para la regla de alcance. */
  private async ambito(req: any, permiso: string): Promise<{ visibles: string[] | null; dco: string | null }> {
    const visibles = await this.alcance.filtroUnidades(req, permiso);
    const dco = visibles === null ? null : (await this.alcance.arbol(req?.user?.tenantId)).porCodigo.get("DCO")?.id ?? null;
    return { visibles, dco };
  }

  private async exigirAlcance(req: any, opp: { unidad_id?: string | null; codigo?: string }, permiso = "cotizacion.crear") {
    const { visibles, dco } = await this.ambito(req, permiso);
    if (!oportunidadEnAlcance(visibles, opp.unidad_id ?? null, dco))
      throw new ForbiddenException(`Fuera de su alcance: la oportunidad ${opp.codigo ?? ""} es de un laboratorio que usted no tiene asignado.`);
  }

  private async exigirUnidadPropia(req: any, unidadId: string | null | undefined) {
    const { visibles, dco } = await this.ambito(req, "cotizacion.crear");
    if (!oportunidadEnAlcance(visibles, unidadId ?? null, dco))
      throw new ForbiddenException(unidadId ? "Solo puede registrar oportunidades de laboratorios de su alcance." : "Indique el laboratorio de la oportunidad.");
  }

  private async cargarPropia(id: string, tenantId: string): Promise<any> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_OPP}
        WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid AND o.deleted_at IS NULL
        LIMIT 1`,
      id,
      tenantId,
    );
    if (!rows.length) throw new NotFoundException("Oportunidad no encontrada");
    return rows[0];
  }

  private async cambiarEstado(req: any, id: string, estado: string, etapa?: string, motivo?: string | null): Promise<any> {
    const tenantId = this.tenantId(req);
    const opp = await this.cargarPropia(id, tenantId);
    await this.exigirAlcance(req, opp);
    await this.prisma.$executeRawUnsafe(
      `UPDATE oportunidad
          SET estado = $3,
              etapa = COALESCE($4, etapa),
              motivo_perdida = CASE WHEN $3 = 'perdida' THEN $5 ELSE motivo_perdida END
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantId,
      estado,
      etapa ?? null,
      motivo ?? null,
    );
    return this.cargarPropia(id, tenantId);
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
    // Comercial (DCO) las ve todas; un laboratorio, las suyas.
    const { visibles, dco } = await this.ambito(req, "cotizacion.ver");
    const unidades = visibles === null || (dco && visibles.includes(dco)) ? null : visibles;

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_OPP}
        WHERE o.tenant_id = $1::uuid AND o.deleted_at IS NULL
          AND ($4::text IS NULL OR o.estado = $4)
          AND ($5::uuid[] IS NULL OR o.unidad_id = ANY($5::uuid[]))
        ORDER BY o.etapa ASC, o.created_at DESC
        LIMIT $2 OFFSET $3`,
      tenantId,
      l,
      offset,
      estado ?? null,
      unidades,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total
         FROM oportunidad o
        WHERE o.tenant_id = $1::uuid AND o.deleted_at IS NULL
          AND ($2::text IS NULL OR o.estado = $2)
          AND ($3::uuid[] IS NULL OR o.unidad_id = ANY($3::uuid[]))`,
      tenantId,
      estado ?? null,
      unidades,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const opp = await this.cargarPropia(id, this.tenantId(req));
    await this.exigirAlcance(req, opp, "cotizacion.ver");
    return opp;
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d: OportunidadInput = CrearOportunidadSchema.parse(body);
    await this.exigirUnidadPropia(req, d.unidadId);

    // OPP-AAAA-NNNN con el año en curso (Chile), correlativo por año.
    const anio = anioChile();
    const ult = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT codigo FROM oportunidad WHERE codigo ~ $1
        ORDER BY split_part(codigo, '-', 3)::int DESC LIMIT 1`,
      `^OPP-${anio}-[0-9]+$`,
    );
    const codigo = siguienteCodigoOportunidad(ult[0]?.codigo ?? null, anio);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO oportunidad
         (tenant_id, codigo, titulo, cliente_id, contacto, monto_estimado, moneda,
          probabilidad, etapa, estado, origen, fecha_cierre_estimada, notas, unidad_id)
       VALUES
         ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14::uuid)
       RETURNING id`,
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
      d.unidadId ?? null,
    );
    return this.cargarPropia(rows[0].id, tenantId);
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = ActualizarOportunidadSchema.parse(body) as Record<string, unknown>;
    const actual = await this.cargarPropia(id, tenantId);
    await this.exigirAlcance(req, actual);
    if ("unidadId" in d) await this.exigirUnidadPropia(req, d.unidadId as string | null);

    const sets: string[] = [];
    const args: any[] = [id, tenantId];
    for (const [key, col] of Object.entries(COLS)) {
      if (key in d) {
        args.push(d[key] ?? null);
        const cast = col === "cliente_id" || col === "unidad_id" ? "::uuid" : col === "fecha_cierre_estimada" ? "::date" : "";
        sets.push(`${col} = $${args.length}${cast}`);
      }
    }
    if (!sets.length) return actual;

    await this.prisma.$executeRawUnsafe(
      `UPDATE oportunidad
          SET ${sets.join(", ")}
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      ...args,
    );
    return this.cargarPropia(id, tenantId);
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    await this.exigirAlcance(req, await this.cargarPropia(id, tenantId));
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
    return this.cambiarEstado(req, id, "ganada", "ganada");
  }

  /** «Perder» exige el motivo (EP-00 0.3). */
  @Post(":id/perder")
  async perder(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { motivo } = PerderSchema.parse(body ?? {});
    return this.cambiarEstado(req, id, "perdida", "perdida", motivo);
  }

  /**
   * «Crear cotización →» (EP-00 0.3): no crea la cotización aquí (le faltan
   * líneas y centro de costo); comprueba que se puede y devuelve con qué
   * precargar «Nueva cotización». La cotización se enlaza al guardarla con
   * `oportunidadId` (cotizacion.service).
   */
  @Post(":id/convertir")
  async convertir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const opp = await this.cargarPropia(id, tenantId);
    await this.exigirAlcance(req, opp);
    if (opp.estado === "perdida") throw new BadRequestException("La oportunidad está perdida: no se cotiza.");
    if (opp.cotizacion_id && opp.cotizacion_estado !== "anulada")
      throw new BadRequestException(`La oportunidad ya tiene la cotización ${opp.cotizacion_codigo}.`);
    if (!opp.cliente_id) throw new BadRequestException("Indique el cliente de la oportunidad antes de cotizar.");
    return { oportunidadId: opp.id, clienteId: opp.cliente_id, ruta: `/cotizaciones/nueva?oportunidad=${opp.id}&cliente=${opp.cliente_id}` };
  }
}

@Module({
  controllers: [OportunidadController],
})
export class CrmModule {}
