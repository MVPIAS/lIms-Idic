/**
 * Órdenes internas (D4 del ANALISIS_FLUJO_REAL): derivación de parte de una OT a
 * OTRO laboratorio, con los ensayos del catálogo que le corresponden.
 *
 * Reglas puras: orden-interna.reglas.ts. Alcance: quien crea, edita, borra o
 * anula debe tener la OT de origen en su alcance por laboratorio (una orden
 * interna da al laboratorio de destino acceso a la OT); quien consulta ve las
 * órdenes cuya OT de origen o cuyo laboratorio de destino están en su alcance.
 *
 * Rutas (permiso):
 *   GET    ordenes-internas                    · lista (ot.ver)          ?otId= ?estado= ?search=
 *   GET    ordenes-internas/:id                · detalle + historial (ot.ver)
 *   GET    ordenes-internas/ot/:otId           · las de una OT (ot.ver; OT en alcance)
 *   GET    ordenes-internas/destinos?otId=     · laboratorios a los que se puede derivar (ot.ver)
 *   GET    ordenes-internas/destinos/:familiaId/ensayos?otId=&q= · ensayos del destino (ot.ver)
 *   POST   ordenes-internas                    · crear (ot.crear)
 *   PATCH  ordenes-internas/:id                · editar mientras está abierta / avanzar estado (ot.crear)
 *   POST   ordenes-internas/:id/anular         · anular con motivo (ot.crear)
 *   DELETE ordenes-internas/:id                · borrar una abierta (ot.crear)
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { generarNumeroOrdenInterna } from "../common/correlativo";
import { AlcanceService } from "../rbac/alcance.service";
import {
  erroresContenido,
  motivoNoAnulable,
  motivoNoBorrable,
  motivoNoEditable,
  normalizarEnsayos,
  type CambioOi,
} from "./orden-interna.reglas";

const tenantDe = (req: any): string => req?.user?.tenantId ?? DEV_TENANT;
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La unidad del organigrama que corresponde a una familia del catálogo (por CODSUCDEL; admite «7003/7004»). */
const UNIDAD_DE_FAMILIA = `
  SELECT u.id, u.codigo, u.nombre
    FROM unidad u
   WHERE u.tenant_id = f.tenant_id AND u.activa
     AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
   ORDER BY (u.tipo = 'LABORATORIO') DESC, u.codigo
   LIMIT 1`;

/** Columnas de una orden interna para las pantallas (OT, destino, ensayos, quién). */
const SELECT_OI = `
  SELECT oi.id, oi.numero, oi.tipo, oi.estado, oi.detalle, oi.ensayos, oi.ot_id AS "otId",
         oi.destino_lab AS "destinoLab", oi.origen_lab AS "origenLab",
         oi.created_at AS "createdAt", oi.updated_at AS "updatedAt",
         oi.anulada_at AS "anuladaAt", oi.motivo_anulacion AS "motivoAnulacion",
         ot.codigo AS "otCodigo", ot.estado AS "otEstado", ot.unidad_principal AS "otUnidadId",
         uo.codigo AS "otUnidadCodigo",
         f.nombre AS "destinoNombre", f.codsucdel AS "destinoCodsucdel",
         ud.id AS "destinoUnidadId", ud.codigo AS "destinoUnidadCodigo", ud.nombre AS "destinoUnidadNombre",
         uc.nombre_completo AS "creadaPor",
         COALESCE(array_length(oi.ensayos, 1), 0)::int AS "nEnsayos",
         COALESCE((SELECT json_agg(json_build_object('id', e.id, 'codigo', e.codigo, 'nombre', e.nombre) ORDER BY e.nombre)
                     FROM cat_ensayo e WHERE e.id = ANY(oi.ensayos)), '[]'::json) AS "ensayosDetalle"
    FROM orden_interna oi
    JOIN orden_trabajo ot ON ot.id = oi.ot_id
    LEFT JOIN unidad uo ON uo.id = ot.unidad_principal
    LEFT JOIN cat_familia f ON f.id = oi.destino_lab
    LEFT JOIN LATERAL (${UNIDAD_DE_FAMILIA}) ud ON TRUE
    LEFT JOIN usuario uc ON uc.id = oi.created_by`;

export const OrdenInternaCreate = z
  .object({
    otId: z.string().uuid(),
    tipo: z.enum(["interna", "generica_interna", "muestreo"]).default("interna"),
    numero: z.string().max(40).optional(),
    origenLab: z.string().uuid().optional(),
    destinoLab: z.string().uuid().optional(),
    estado: z.enum(["abierta", "recibida", "cerrada"]).default("abierta"),
    ensayos: z.array(z.string().uuid()).max(200).optional(),
    detalle: z.string().max(4000).optional(),
  })
  .strict();
export const OrdenInternaUpdate = z
  .object({
    otId: z.string().uuid().optional(),
    tipo: z.enum(["interna", "generica_interna", "muestreo"]).optional(),
    origenLab: z.string().uuid().nullable().optional(),
    destinoLab: z.string().uuid().nullable().optional(),
    estado: z.enum(["abierta", "recibida", "cerrada", "anulada"]).optional(),
    ensayos: z.array(z.string().uuid()).max(200).optional(),
    detalle: z.string().max(4000).nullable().optional(),
  })
  .strict();
const Motivo = z.object({ motivo: z.string().trim().max(1000).default("") });

@Injectable()
export class OrdenInternaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "ordenInterna",
      search: ["numero", "tipo", "estado", "detalle"],
      orderBy: { createdAt: "desc" },
      tenant: true,
      softDelete: true,
    });
  }

  private async historial(tenantId: string, id: string, accion: string, detalle: unknown, usuarioId: string | null) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO orden_interna_historial (tenant_id, orden_interna_id, accion, detalle, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
      tenantId,
      id,
      accion,
      JSON.stringify(detalle ?? {}),
      usuarioId,
    );
  }

  /** Alta: numera OI-AAAA-NNNN (correlativo atómico), deja quién la creó y su historial. */
  override async crear(data: any, tenantId?: string, usuarioId: string | null = null) {
    const tid = tenantId ?? DEV_TENANT;
    const numero = data?.numero ?? (await generarNumeroOrdenInterna(this.prisma, tid));
    const oi: any = await super.crear({ ...data, numero, ...(usuarioId ? { createdBy: usuarioId } : {}) }, tenantId);
    if (oi?.id) await this.historial(tid, oi.id, "creada", { destinoLab: data?.destinoLab ?? null, ensayos: data?.ensayos ?? [] }, usuarioId);
    return oi;
  }

  override async actualizar(id: string, data: any, tenantId?: string, usuarioId: string | null = null) {
    const r = await super.actualizar(id, { ...data, updatedAt: new Date() }, tenantId);
    const soloEstado = Object.keys(data ?? {}).every((k) => k === "estado");
    await this.historial(tenantId ?? DEV_TENANT, id, soloEstado ? "estado" : "editada", data, usuarioId);
    return r;
  }

  override async eliminar(id: string, tenantId?: string, usuarioId: string | null = null) {
    const r = await super.eliminar(id, tenantId);
    await this.historial(tenantId ?? DEV_TENANT, id, "eliminada", {}, usuarioId);
    return r;
  }

  async anular(id: string, motivo: string, tenantId: string, usuarioId: string | null) {
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE orden_interna SET estado = 'anulada', anulada_at = now(), anulada_por = $3::uuid,
              motivo_anulacion = $4, updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL AND estado NOT IN ('anulada', 'cerrada')`,
      id,
      tenantId,
      usuarioId,
      motivo,
    );
    if (n !== 1) throw new ConflictException("La orden interna cambió de estado mientras tanto; recargue.");
    await this.historial(tenantId, id, "anulada", { motivo }, usuarioId);
    return this.ficha(id, tenantId);
  }

  /** Lista con OT, destino y ensayos. `filtro` = unidades visibles (null = todas). */
  async lista(tenantId: string, filtro: string[] | null, q: { otId?: string; estado?: string; search?: string; limit?: number }) {
    const conds = [`oi.tenant_id = $1::uuid`, `oi.deleted_at IS NULL`];
    const vals: unknown[] = [tenantId];
    if (filtro !== null) {
      vals.push(filtro);
      conds.push(`(ot.unidad_principal = ANY($${vals.length}::uuid[]) OR ud.id = ANY($${vals.length}::uuid[]))`);
    }
    if (q.otId) {
      vals.push(q.otId);
      conds.push(`oi.ot_id = $${vals.length}::uuid`);
    }
    if (q.estado) {
      vals.push(q.estado);
      conds.push(`oi.estado = $${vals.length}`);
    }
    if (q.search?.trim()) {
      vals.push(`%${q.search.trim()}%`);
      const p = `$${vals.length}`;
      conds.push(`(oi.numero ILIKE ${p} OR ot.codigo ILIKE ${p} OR COALESCE(oi.detalle, '') ILIKE ${p} OR COALESCE(f.nombre, '') ILIKE ${p} OR COALESCE(ud.codigo, '') ILIKE ${p})`);
    }
    vals.push(Math.min(500, Math.max(1, q.limit ?? 200)));
    return this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_OI} WHERE ${conds.join(" AND ")} ORDER BY oi.created_at DESC LIMIT $${vals.length}`,
      ...vals,
    );
  }

  async ficha(id: string, tenantId: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_OI} WHERE oi.id = $1::uuid AND oi.tenant_id = $2::uuid AND oi.deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!filas[0]) throw new NotFoundException(`Orden interna ${id} no encontrada`);
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.accion, h.detalle, h.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre"
         FROM orden_interna_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
        WHERE h.orden_interna_id = $1::uuid ORDER BY h.created_at`,
      id,
    );
    return { ...filas[0], historial };
  }

  /** Laboratorios del catálogo (familias con su unidad del organigrama) a los que se puede derivar. */
  async destinos(tenantId: string, excluirUnidad: string | null) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT f.id, f.codsucdel, f.nombre, u.id AS "unidadId", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre",
              (SELECT count(*) FROM cat_ensayo e WHERE e.familia_id = f.id AND e.deleted_at IS NULL AND e.activo)::int AS ensayos
         FROM cat_familia f
         JOIN LATERAL (${UNIDAD_DE_FAMILIA}) u ON TRUE
        WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL AND f.activo
          AND ($2::uuid IS NULL OR u.id <> $2::uuid)
          -- Sin ensayos vigentes en el catálogo no hay nada que derivarle.
          AND EXISTS (SELECT 1 FROM cat_ensayo e WHERE e.familia_id = f.id AND e.deleted_at IS NULL AND e.activo)
        ORDER BY u.codigo, f.nombre`,
      tenantId,
      excluirUnidad,
    );
  }

  /**
   * Ensayos vigentes de una familia de destino. Con `otId`, marca los que ya
   * figuran en la OT (resultados o líneas de su cotización) para proponerlos.
   */
  async ensayosDestino(tenantId: string, familiaId: string, otId: string | null, q: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.codigo, e.nombre,
              ($3::uuid IS NOT NULL AND (
                 EXISTS (SELECT 1 FROM resultado r JOIN muestra m ON m.id = r.muestra_id JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
                          WHERE COALESCE(r.ot_id, m.ot_id) = $3::uuid AND r.deleted_at IS NULL AND cm.ensayo_id = e.id)
                 OR EXISTS (SELECT 1 FROM orden_trabajo ot JOIN linea_cotizacion cl ON cl.cotizacion_id = ot.cotizacion_id
                             WHERE ot.id = $3::uuid AND cl.cat_ensayo_id = e.id))) AS "enOt"
         FROM cat_ensayo e
        WHERE e.tenant_id = $1::uuid AND e.familia_id = $2::uuid AND e.deleted_at IS NULL AND e.activo
          AND ($4 = '' OR e.nombre ILIKE '%' || $4 || '%' OR e.codigo ILIKE '%' || $4 || '%')
        ORDER BY 4 DESC, e.nombre
        LIMIT 400`,
      tenantId,
      familiaId,
      otId,
      q,
    );
  }

  /** Ids de ensayo vigentes de la familia (para validar lo que llega). */
  async idsEnsayosDe(tenantId: string, familiaId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM cat_ensayo WHERE tenant_id = $1::uuid AND familia_id = $2::uuid AND deleted_at IS NULL AND id = ANY($3::uuid[])`,
      tenantId,
      familiaId,
      ids,
    );
    return new Set(filas.map((f) => f.id));
  }

  /** ¿La familia de destino es la del laboratorio responsable de la OT? (y la familia de ese laboratorio, para origen). */
  async familias(tenantId: string, destinoLab: string | null, unidadOt: string | null) {
    const filas = await this.prisma.$queryRawUnsafe<{ destino_existe: boolean; destino_es_principal: boolean; origen: string | null }[]>(
      `SELECT EXISTS (SELECT 1 FROM cat_familia WHERE id = $2::uuid AND tenant_id = $1::uuid AND deleted_at IS NULL) AS destino_existe,
              EXISTS (SELECT 1 FROM cat_familia f JOIN unidad u ON u.id = $3::uuid
                       WHERE f.id = $2::uuid
                         AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))) AS destino_es_principal,
              (SELECT f.id FROM cat_familia f JOIN unidad u ON u.id = $3::uuid
                WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL
                  AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
                ORDER BY f.activo DESC, f.codsucdel LIMIT 1) AS origen`,
      tenantId,
      destinoLab,
      unidadOt,
    );
    return filas[0] ?? { destino_existe: false, destino_es_principal: false, origen: null };
  }
}

/**
 * Consultas con ruta estática (`destinos`, `ot/:otId`): controlador PROPIO
 * declarado ANTES del CRUD para que su ruta gane a `@Get(":id")`.
 */
@ApiTags("ordenes-internas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ordenes-internas")
export class OrdenInternaConsultaController {
  constructor(
    private readonly svc: OrdenInternaService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async otEnAlcance(otId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: tenantDe(req) },
      select: { id: true, codigo: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  @Get("destinos")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Laboratorios a los que se puede derivar (?otId= excluye el responsable de la OT)" })
  async destinos(@Query("otId") otId: string | undefined, @Req() req: any) {
    const ot = otId && UUID_RE.test(otId) ? await this.otEnAlcance(otId, req) : null;
    return this.svc.destinos(tenantDe(req), ot?.unidadPrincipal ?? null);
  }

  @Get("destinos/:familiaId/ensayos")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Ensayos del laboratorio de destino (?otId= marca los que ya figuran en la OT; ?q=)" })
  async ensayos(
    @Param("familiaId", ParseUUIDPipe) familiaId: string,
    @Query("otId") otId: string | undefined,
    @Query("q") q: string | undefined,
    @Req() req: any,
  ) {
    const ot = otId && UUID_RE.test(otId) ? await this.otEnAlcance(otId, req) : null;
    return this.svc.ensayosDestino(tenantDe(req), familiaId, ot?.id ?? null, String(q ?? "").trim().slice(0, 100));
  }

  @Get("ot/:otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Órdenes internas de una OT (la OT debe estar en el alcance)" })
  async deOt(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    const ot = await this.otEnAlcance(otId, req);
    return this.svc.lista(tenantDe(req), null, { otId: ot.id, limit: 500 });
  }
}

@ApiTags("ordenes-internas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ordenes-internas")
@RequierePermisoCrud({
  ver: "ot.ver",
  crear: "ot.crear",
  editar: "ot.crear",
  eliminar: "ot.crear",
})
export class OrdenInternaController extends BaseCrudController {
  protected createSchema = OrdenInternaCreate;
  protected updateSchema = OrdenInternaUpdate;
  constructor(
    protected svc: OrdenInternaService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {
    super();
  }

  /**
   * Una orden interna da al laboratorio de destino acceso a la OT (planillas de
   * cálculos y de costos): solo la crea o cambia quien tiene la OT de origen en
   * su alcance por laboratorio (revisión de seguridad r3). 404 si es de otro tenant.
   */
  private async exigirAlcanceOt(otId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      select: { codigo: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  private async ordenDe(id: string, req: any): Promise<{ otId: string; estado?: string; destinoLab?: string | null; ensayos?: string[] }> {
    const oi = await this.prisma.ordenInterna.findFirst({
      where: { id, deletedAt: null, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      select: { otId: true, estado: true, destinoLab: true, ensayos: true },
    });
    if (!oi) throw new NotFoundException(`Orden interna ${id} no encontrada`);
    return oi;
  }

  /** Destino y ensayos válidos para la OT (400 con los motivos). Devuelve la familia de origen sugerida. */
  private async validarContenido(tenantId: string, unidadOt: string | null, destinoLab: string | null | undefined, ensayos: string[]) {
    if (!destinoLab && !ensayos.length) return { origen: null as string | null };
    const fam = destinoLab ? await this.svc.familias(tenantId, destinoLab, unidadOt) : { destino_existe: false, destino_es_principal: false, origen: null };
    if (destinoLab && !fam.destino_existe) throw new BadRequestException("El laboratorio de destino no existe en el catálogo.");
    const delDestino = destinoLab && ensayos.length ? await this.svc.idsEnsayosDe(tenantId, destinoLab, ensayos) : null;
    const errores = erroresContenido({ destinoLab, ensayos, destinoEsPrincipal: fam.destino_es_principal, ensayosDelDestino: delDestino });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    return { origen: fam.origen };
  }

  @Get()
  @RequierePermiso("ot.ver")
  override async listar(
    @Query("page") _page = "1",
    @Query("limit") limit = "200",
    @Query("search") search?: string,
    @Req() req?: any,
  ) {
    const filtro = await this.alcance.filtroUnidades(req);
    const q = req?.query ?? {};
    const otId = typeof q.otId === "string" && UUID_RE.test(q.otId) ? q.otId : undefined;
    const estado = typeof q.estado === "string" && ["abierta", "recibida", "cerrada", "anulada"].includes(q.estado) ? q.estado : undefined;
    const tope = parseInt(limit) || 200;
    const data = await this.svc.lista(tenantDe(req), filtro, { otId, estado, search, limit: tope });
    return { data, meta: { page: 1, limit: tope, total: data.length, totalPages: 1 } };
  }

  @Get(":id")
  @RequierePermiso("ot.ver")
  override async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const f = await this.svc.ficha(id, tenantDe(req));
    const filtro = await this.alcance.filtroUnidades(req);
    if (filtro !== null && !filtro.includes(f.otUnidadId) && !(f.destinoUnidadId && filtro.includes(f.destinoUnidadId)))
      throw new NotFoundException(`Orden interna ${id} no encontrada`);
    return f;
  }

  @Post()
  override async crear(@Body() body: unknown, @Req() req: any) {
    const dto = OrdenInternaCreate.parse(body);
    const ot = await this.exigirAlcanceOt(dto.otId, req);
    const ensayos = normalizarEnsayos(dto.ensayos);
    const { origen } = await this.validarContenido(tenantDe(req), ot.unidadPrincipal ?? null, dto.destinoLab, ensayos);
    // El número lo da siempre el correlativo (OI-AAAA-NNNN): no se acepta uno escrito a mano.
    const { numero: _numero, ...datos } = dto;
    return this.svc.crear(
      { ...datos, ensayos, ...(dto.origenLab || !origen ? {} : { origenLab: origen }) },
      tenantDe(req),
      usuarioDe(req),
    );
  }

  @Patch(":id")
  override async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OrdenInternaUpdate.parse(body);
    const oi = await this.ordenDe(id, req);
    const ot = await this.exigirAlcanceOt(oi.otId, req);
    const motivo = motivoNoEditable(oi.estado, dto as CambioOi);
    if (motivo) throw new ConflictException(motivo);
    const cambio: any = { ...dto };
    if (dto.ensayos !== undefined || dto.destinoLab !== undefined) {
      const destino = dto.destinoLab !== undefined ? dto.destinoLab : oi.destinoLab ?? null;
      const ensayos = normalizarEnsayos(dto.ensayos ?? oi.ensayos ?? []);
      // Cambiar el destino sin indicar ensayos los vacía (eran del laboratorio anterior).
      const finales = dto.ensayos === undefined && dto.destinoLab !== undefined && dto.destinoLab !== oi.destinoLab ? [] : ensayos;
      await this.validarContenido(tenantDe(req), ot.unidadPrincipal ?? null, destino, finales);
      cambio.ensayos = finales;
    }
    return this.svc.actualizar(id, cambio, tenantDe(req), usuarioDe(req));
  }

  @Post(":id/anular")
  @RequierePermiso("ot.crear")
  @ApiOperation({ summary: "Anular la orden interna con motivo (deja de dar acceso a la OT al laboratorio de destino)" })
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { motivo } = Motivo.parse(body ?? {});
    const oi = await this.ordenDe(id, req);
    await this.exigirAlcanceOt(oi.otId, req);
    const m = motivoNoAnulable(oi.estado, motivo);
    if (m) throw (oi.estado === "anulada" || oi.estado === "cerrada" ? new ConflictException(m) : new BadRequestException(m));
    return this.svc.anular(id, motivo, tenantDe(req), usuarioDe(req));
  }

  @Delete(":id")
  override async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const oi = await this.ordenDe(id, req);
    await this.exigirAlcanceOt(oi.otId, req);
    const m = motivoNoBorrable(oi.estado);
    if (m) throw new ConflictException(m);
    return this.svc.eliminar(id, tenantDe(req), usuarioDe(req));
  }
}
