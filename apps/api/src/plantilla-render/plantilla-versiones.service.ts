import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { ConfigInformeSchema, configEfectiva, configPorTipo } from "./config-informe";
import { PlantillaRenderService, type VersionPlantilla } from "./plantilla-render.service";
import { BLOQUES_MOTOR, diffLineas, motivoNoAprobable, motivoNoEditable } from "./plantilla-versiones";

/**
 * =============================================================================
 * REPOSITORIO DE PLANTILLAS CON VERSIONES · frente plantillas
 * -----------------------------------------------------------------------------
 * DDL: packages/db/align_plantilla_versiones.sql. Reglas: plantilla-versiones.ts.
 *
 *  · plantilla.ver        → historial, ver una versión, comparar, variables.
 *  · plantilla.gestionar  → redactar el BORRADOR (cuerpo, formato, motivo),
 *                           descartarlo, volver a una versión anterior
 *                           (= borrador copia) y duplicar la plantilla.
 *  · plantilla.aprobar    → el borrador pasa a VIGENTE y la anterior a
 *                           RETIRADA. Nunca quien lo redactó o modificó.
 *  · Vista previa con una OT real: plantilla.gestionar o plantilla.aprobar, y
 *    la OT dentro del alcance del usuario.
 *
 * Al aprobar se copian cuerpo y formato a plantilla_informe (espejo de la
 * vigente) para que el código que lee esas columnas vea lo vigente.
 * =============================================================================
 */

function tenantDe(req: any): string {
  return req?.user?.tenantId ?? DEV_TENANT;
}
function usuarioDe(req: any): string | null {
  return req?.user?.sub ?? null;
}
function tiene(req: any, permiso: string): boolean {
  return (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(permiso);
}

const CUERPO_MAX = 400_000;

const BorradorSchema = z
  .object({
    cuerpoHtml: z.string().max(CUERPO_MAX).nullable().optional(),
    /** Formato (config_informe). null = el del tipo. */
    configInforme: z.unknown().optional(),
    motivo: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
const AprobarSchema = z.object({ motivo: z.string().trim().max(1000).optional() }).strict();
const DuplicarSchema = z
  .object({
    repid: z.string().trim().min(1).max(20),
    nombre: z.string().trim().min(3).max(160),
  })
  .strict();
const PreviaSchema = z.object({ otId: z.string().uuid(), formato: z.enum(["html", "pdf"]).optional() }).strict();

export interface FilaVersion {
  id: string;
  plantillaId: string;
  tenantId: string;
  numero: number;
  estado: string;
  cuerpoHtml: string | null;
  configInforme: unknown;
  motivo: string | null;
  origen: string;
  creadoPor: string | null;
  editores: string[] | null;
}

const SELECT_VERSION = `
  SELECT v.id, v.plantilla_id AS "plantillaId", v.tenant_id AS "tenantId", v.numero, v.estado,
         v.cuerpo_html AS "cuerpoHtml", v.config_informe AS "configInforme", v.motivo, v.origen,
         v.creado_por AS "creadoPor", v.editores, v.creado_en AS "creadoEn",
         v.actualizado_en AS "actualizadoEn", v.aprobado_en AS "aprobadoEn", v.retirado_en AS "retiradoEn",
         v.basada_en_id AS "basadaEnId", v.aprobado_por AS "aprobadoPor",
         uc.nombre_completo AS "creadoPorNombre", ua.nombre_completo AS "actualizadoPorNombre",
         ap.nombre_completo AS "aprobadoPorNombre",
         (SELECT b.numero FROM plantilla_informe_version b WHERE b.id = v.basada_en_id) AS "basadaEnNumero",
         (SELECT count(*) FROM certificado c WHERE c.plantilla_version_id = v.id)::int AS documentos
    FROM plantilla_informe_version v
    LEFT JOIN usuario uc ON uc.id = v.creado_por
    LEFT JOIN usuario ua ON ua.id = v.actualizado_por
    LEFT JOIN usuario ap ON ap.id = v.aprobado_por`;

@Injectable()
export class PlantillaVersionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: PlantillaRenderService,
  ) {}

  async plantilla(id: string, tenantId: string) {
    const p = await this.prisma.plantillaInforme.findFirst({
      where: { id, tenantId },
      select: { id: true, repid: true, nombre: true, tipo: true, version: true, tenantId: true },
    });
    if (!p) throw new NotFoundException(`Plantilla ${id} no encontrada`);
    return p;
  }

  async version(vid: string, tenantId: string): Promise<FilaVersion & Record<string, unknown>> {
    const f = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT_VERSION} WHERE v.id = $1::uuid AND v.tenant_id = $2::uuid`, vid, tenantId);
    if (!f[0]) throw new NotFoundException(`Versión ${vid} no encontrada`);
    return f[0];
  }

  /** Historial de la plantilla (sin cuerpos: se piden por versión). */
  async historial(plantillaId: string, tenantId: string) {
    const plantilla = await this.plantilla(plantillaId, tenantId);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_VERSION} WHERE v.plantilla_id = $1::uuid ORDER BY v.numero DESC`,
      plantillaId,
    );
    const versiones = filas.map(({ cuerpoHtml, configInforme, ...v }) => ({ ...v, largoCuerpo: (cuerpoHtml ?? "").length, conFormato: configInforme != null }));
    return {
      plantilla,
      vigente: versiones.find((v) => v.estado === "VIGENTE") ?? null,
      borrador: versiones.find((v) => v.estado === "BORRADOR") ?? null,
      versiones,
    };
  }

  private async borradorDe(plantillaId: string, db: any = this.prisma): Promise<FilaVersion | null> {
    const f = await db.$queryRawUnsafe(`${SELECT_VERSION} WHERE v.plantilla_id = $1::uuid AND v.estado = 'BORRADOR'`, plantillaId);
    return (f as FilaVersion[])[0] ?? null;
  }

  /** Base de un borrador nuevo: la vigente; si no hay, la última; si no, las columnas de la plantilla. */
  private async baseDe(plantillaId: string, db: any) {
    const f = (await db.$queryRawUnsafe(
      `SELECT id, cuerpo_html AS "cuerpoHtml", config_informe AS "configInforme" FROM plantilla_informe_version
        WHERE plantilla_id = $1::uuid ORDER BY (estado = 'VIGENTE') DESC, numero DESC LIMIT 1`,
      plantillaId,
    )) as any[];
    if (f[0]) return f[0] as { id: string | null; cuerpoHtml: string | null; configInforme: unknown };
    const p = (await db.$queryRawUnsafe(
      `SELECT cuerpo_html AS "cuerpoHtml", config_informe AS "configInforme" FROM plantilla_informe WHERE id = $1::uuid`,
      plantillaId,
    )) as any[];
    return { id: null, cuerpoHtml: p[0]?.cuerpoHtml ?? null, configInforme: p[0]?.configInforme ?? null };
  }

  private async nuevaVersion(
    db: any,
    p: { tenantId: string; plantillaId: string; cuerpoHtml: string | null; configInforme: unknown; motivo: string | null; origen: string; basadaEnId: string | null; usuarioId: string | null },
  ): Promise<string> {
    const f = (await db.$queryRawUnsafe(
      `INSERT INTO plantilla_informe_version
         (tenant_id, plantilla_id, numero, cuerpo_html, config_informe, estado, motivo, origen, basada_en_id, creado_por, editores)
       VALUES ($1::uuid, $2::uuid,
               (SELECT COALESCE(MAX(numero), 0) + 1 FROM plantilla_informe_version WHERE plantilla_id = $2::uuid),
               $3, $4::jsonb, 'BORRADOR', $5, $6, $7::uuid, $8::uuid,
               CASE WHEN $8::uuid IS NULL THEN '{}'::uuid[] ELSE ARRAY[$8::uuid] END)
       RETURNING id`,
      p.tenantId,
      p.plantillaId,
      p.cuerpoHtml,
      p.configInforme == null ? null : JSON.stringify(p.configInforme),
      p.motivo,
      p.origen,
      p.basadaEnId,
      p.usuarioId,
    )) as { id: string }[];
    return f[0].id;
  }

  /**
   * Escribe en el BORRADOR de la plantilla (lo crea copiando la vigente si no
   * existe). Nunca toca la versión vigente.
   */
  async guardarBorrador(plantillaId: string, tenantId: string, usuarioId: string | null, cuerpo: unknown) {
    await this.plantilla(plantillaId, tenantId);
    const d = BorradorSchema.parse(cuerpo ?? {});
    const config = d.configInforme === undefined ? undefined : d.configInforme === null ? null : ConfigInformeSchema.parse(d.configInforme);
    const id = await this.prisma.$transaction(async (tx) => {
      let b = await this.borradorDe(plantillaId, tx);
      if (!b) {
        const base = await this.baseDe(plantillaId, tx);
        const nuevo = await this.nuevaVersion(tx, {
          tenantId,
          plantillaId,
          cuerpoHtml: base.cuerpoHtml,
          configInforme: base.configInforme,
          motivo: null,
          origen: "pantalla",
          basadaEnId: base.id,
          usuarioId,
        });
        b = { id: nuevo } as FilaVersion;
      }
      await tx.$executeRawUnsafe(
        `UPDATE plantilla_informe_version SET
           cuerpo_html    = CASE WHEN $2::boolean THEN $3::text ELSE cuerpo_html END,
           config_informe = CASE WHEN $4::boolean THEN $5::jsonb ELSE config_informe END,
           motivo         = CASE WHEN $6::boolean THEN $7::text ELSE motivo END,
           actualizado_por = $8::uuid, actualizado_en = now(),
           editores = CASE WHEN $8::uuid IS NULL OR $8::uuid = ANY(editores) THEN editores ELSE array_append(editores, $8::uuid) END
         WHERE id = $1::uuid AND estado = 'BORRADOR'`,
        b.id,
        d.cuerpoHtml !== undefined,
        d.cuerpoHtml ?? null,
        config !== undefined,
        config == null ? null : JSON.stringify(config),
        d.motivo !== undefined,
        d.motivo ?? null,
        usuarioId,
      );
      return b.id;
    });
    return this.version(id, tenantId);
  }

  /** Edita un borrador concreto por su id. */
  async editarVersion(vid: string, tenantId: string, usuarioId: string | null, cuerpo: unknown) {
    const v = await this.version(vid, tenantId);
    const m = motivoNoEditable(v);
    if (m) throw new ConflictException(m);
    return this.guardarBorrador(v.plantillaId, tenantId, usuarioId, cuerpo);
  }

  /** Descarta el borrador (nunca fue vigente ni lo usó ningún documento). */
  async descartar(vid: string, tenantId: string) {
    const v = await this.version(vid, tenantId);
    const m = motivoNoEditable(v);
    if (m) throw new ConflictException(m);
    await this.prisma.$executeRawUnsafe(`DELETE FROM plantilla_informe_version WHERE id = $1::uuid AND estado = 'BORRADOR'`, vid);
    return { descartado: true, numero: v.numero };
  }

  /** Aprueba el borrador: VIGENTE; la vigente anterior, RETIRADA; espejo en plantilla_informe. */
  async aprobar(vid: string, tenantId: string, usuarioId: string | null, cuerpo: unknown) {
    const d = AprobarSchema.parse(cuerpo ?? {});
    await this.prisma.$transaction(async (tx) => {
      const f = (await tx.$queryRawUnsafe(
        `SELECT id, plantilla_id AS "plantillaId", estado, creado_por AS "creadoPor", editores, motivo,
                cuerpo_html AS "cuerpoHtml", config_informe AS "configInforme"
           FROM plantilla_informe_version WHERE id = $1::uuid AND tenant_id = $2::uuid FOR UPDATE`,
        vid,
        tenantId,
      )) as any[];
      const v = f[0];
      if (!v) throw new NotFoundException(`Versión ${vid} no encontrada`);
      const no = motivoNoAprobable(v, usuarioId);
      if (no) throw no.codigo === 403 ? new ForbiddenException(no.mensaje) : new ConflictException(no.mensaje);
      const motivo = d.motivo || v.motivo;
      if (!motivo || !String(motivo).trim()) throw new BadRequestException("Indique el motivo del cambio antes de aprobar.");
      await tx.$executeRawUnsafe(
        `UPDATE plantilla_informe_version SET estado = 'RETIRADA', retirado_en = now()
          WHERE plantilla_id = $1::uuid AND estado = 'VIGENTE'`,
        v.plantillaId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE plantilla_informe_version SET estado = 'VIGENTE', aprobado_por = $2::uuid, aprobado_en = now(), motivo = $3
          WHERE id = $1::uuid`,
        vid,
        usuarioId,
        motivo,
      );
      await tx.$executeRawUnsafe(
        `UPDATE plantilla_informe SET cuerpo_html = $2, config_informe = $3::jsonb WHERE id = $1::uuid`,
        v.plantillaId,
        v.cuerpoHtml,
        v.configInforme == null ? null : JSON.stringify(v.configInforme),
      );
    });
    return this.version(vid, tenantId);
  }

  /** Volver a una versión anterior: nuevo BORRADOR copia de aquella (la vigente no cambia hasta aprobar). */
  async restaurar(vid: string, tenantId: string, usuarioId: string | null) {
    const v = await this.version(vid, tenantId);
    if (v.estado === "BORRADOR") throw new ConflictException("Esta versión ya es el borrador.");
    if (await this.borradorDe(v.plantillaId))
      throw new ConflictException("La plantilla ya tiene un borrador: apruébelo o descártelo antes de volver a otra versión.");
    const id = await this.nuevaVersion(this.prisma, {
      tenantId,
      plantillaId: v.plantillaId,
      cuerpoHtml: v.cuerpoHtml,
      configInforme: v.configInforme,
      motivo: `Vuelta a la versión ${v.numero}.`,
      origen: "restaurada",
      basadaEnId: v.id,
      usuarioId,
    });
    return this.version(id, tenantId);
  }

  /**
   * Duplica una plantilla (p. ej. para otro laboratorio): mismos metadatos con
   * otro REPID y nombre, y su versión 1 en BORRADOR copia de la vigente. Hasta
   * que se apruebe no tiene vigente: si se usa, rinde el cuerpo por defecto del tipo.
   */
  async duplicar(plantillaId: string, tenantId: string, usuarioId: string | null, cuerpo: unknown) {
    const d = DuplicarSchema.parse(cuerpo ?? {});
    await this.plantilla(plantillaId, tenantId);
    const nueva = await this.prisma.$transaction(async (tx) => {
      const existe = (await tx.$queryRawUnsafe(
        `SELECT 1 FROM plantilla_informe WHERE tenant_id = $1::uuid AND repid = $2 AND nombre = $3`,
        tenantId,
        d.repid,
        d.nombre,
      )) as any[];
      if (existe.length) throw new ConflictException(`Ya existe la plantilla ${d.repid} · ${d.nombre}.`);
      const f = (await tx.$queryRawUnsafe(
        `INSERT INTO plantilla_informe (tenant_id, repid, nombre, tipo, emision, archivo_ref, activo, version, tipo_documento)
         SELECT tenant_id, $2, $3, tipo, emision, archivo_ref, true, version, tipo_documento
           FROM plantilla_informe WHERE id = $1::uuid
         RETURNING id`,
        plantillaId,
        d.repid,
        d.nombre,
      )) as { id: string }[];
      const base = await this.baseDe(plantillaId, tx);
      await this.nuevaVersion(tx, {
        tenantId,
        plantillaId: f[0].id,
        cuerpoHtml: base.cuerpoHtml,
        configInforme: base.configInforme,
        motivo: "Plantilla duplicada: revisar membrete, textos y firmas antes de aprobar.",
        origen: "duplicada",
        basadaEnId: base.id,
        usuarioId,
      });
      return f[0].id;
    });
    return this.historial(nueva, tenantId);
  }

  /** Diferencia entre dos versiones de la misma plantilla (cuerpo por líneas y formato). */
  async comparar(a: string, b: string, tenantId: string) {
    const [va, vb] = await Promise.all([this.version(a, tenantId), this.version(b, tenantId)]);
    if (va.plantillaId !== vb.plantillaId) throw new BadRequestException("Las versiones son de plantillas distintas.");
    const json = (x: unknown) => (x == null ? "" : JSON.stringify(x, null, 2));
    return {
      a: { id: va.id, numero: va.numero, estado: va.estado },
      b: { id: vb.id, numero: vb.numero, estado: vb.estado },
      cuerpo: diffLineas(va.cuerpoHtml, vb.cuerpoHtml),
      formato: diffLineas(json(va.configInforme), json(vb.configInforme)),
    };
  }

  /** Formato de una versión (efectivo con el del tipo). */
  formatoDe(tipo: string, config: unknown) {
    return { guardado: config ?? null, efectivo: configEfectiva(tipo, config ?? null), porTipo: configPorTipo(tipo) };
  }

  /** Variables del motor: con OT, las reales; sin OT, solo los bloques fijos. */
  async variables(plantillaId: string, tenantId: string, otId?: string) {
    await this.plantilla(plantillaId, tenantId);
    const bloquesFijos = Object.entries(BLOQUES_MOTOR).map(([clave, descripcion]) => ({ clave, descripcion }));
    if (!otId) return { conOt: false, datos: [] as string[], bloques: bloquesFijos };
    const r = await this.render.variablesConOt(otId, plantillaId, tenantId);
    return {
      conOt: true,
      datos: r.datos,
      bloques: r.bloques.map((clave) => ({ clave, descripcion: BLOQUES_MOTOR[clave] ?? "Bloque de otro módulo" })),
    };
  }

  async previa(vid: string, tenantId: string, otId: string, formato: "html" | "pdf") {
    const v = await this.version(vid, tenantId);
    const version: VersionPlantilla = { id: v.id, numero: v.numero, cuerpoHtml: v.cuerpoHtml, configInforme: v.configInforme ?? null };
    return this.render.previsualizarVersion(otId, v.plantillaId, tenantId, version, formato);
  }
}

@ApiTags("plantillas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("informes/plantillas")
export class PlantillaVersionesController {
  constructor(
    private readonly svc: PlantillaVersionesService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  @Get(":id/versiones")
  @RequierePermiso("plantilla.ver")
  historial(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.historial(id, tenantDe(req));
  }

  @Get(":id/variables")
  @RequierePermiso("plantilla.ver")
  async variables(@Param("id", ParseUUIDPipe) id: string, @Query("otId") otId: string | undefined, @Req() req: any) {
    if (otId) {
      if (!z.string().uuid().safeParse(otId).success) throw new BadRequestException("otId inválido.");
      await this.exigirOt(otId, req);
    }
    return this.svc.variables(id, tenantDe(req), otId || undefined);
  }

  @Post(":id/borrador")
  @RequierePermiso("plantilla.gestionar")
  borrador(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.guardarBorrador(id, tenantDe(req), usuarioDe(req), body);
  }

  @Post(":id/duplicar")
  @RequierePermiso("plantilla.gestionar")
  duplicar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.duplicar(id, tenantDe(req), usuarioDe(req), body);
  }

  @Get("versiones/:vid")
  @RequierePermiso("plantilla.ver")
  async version(@Param("vid", ParseUUIDPipe) vid: string, @Req() req: any) {
    const v = await this.svc.version(vid, tenantDe(req));
    const p = await this.svc.plantilla(v.plantillaId, tenantDe(req));
    return { ...v, plantilla: p, formato: this.svc.formatoDe(p.tipo, v.configInforme) };
  }

  @Get("versiones/:vid/comparar/:otra")
  @RequierePermiso("plantilla.ver")
  comparar(@Param("vid", ParseUUIDPipe) vid: string, @Param("otra", ParseUUIDPipe) otra: string, @Req() req: any) {
    return this.svc.comparar(otra, vid, tenantDe(req));
  }

  @Put("versiones/:vid")
  @RequierePermiso("plantilla.gestionar")
  editar(@Param("vid", ParseUUIDPipe) vid: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarVersion(vid, tenantDe(req), usuarioDe(req), body);
  }

  @Delete("versiones/:vid")
  @RequierePermiso("plantilla.gestionar")
  descartar(@Param("vid", ParseUUIDPipe) vid: string, @Req() req: any) {
    return this.svc.descartar(vid, tenantDe(req));
  }

  @Post("versiones/:vid/aprobar")
  @RequierePermiso("plantilla.aprobar")
  aprobar(@Param("vid", ParseUUIDPipe) vid: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.aprobar(vid, tenantDe(req), usuarioDe(req), body);
  }

  @Post("versiones/:vid/restaurar")
  @RequierePermiso("plantilla.gestionar")
  restaurar(@Param("vid", ParseUUIDPipe) vid: string, @Req() req: any) {
    return this.svc.restaurar(vid, tenantDe(req), usuarioDe(req));
  }

  /**
   * Vista previa de una versión (borrador incluido) con una OT real: HTML o PDF
   * con marca de borrador. Para quien redacta o aprueba plantillas, con la OT en su alcance.
   */
  @Post("versiones/:vid/previsualizar")
  @RequierePermiso("plantilla.ver")
  async previsualizar(@Param("vid", ParseUUIDPipe) vid: string, @Body() body: unknown, @Req() req: any, @Res() res: Response) {
    if (!tiene(req, "plantilla.gestionar") && !tiene(req, "plantilla.aprobar"))
      throw new ForbiddenException("La vista previa de una versión es para quien redacta o aprueba plantillas.");
    const { otId, formato } = PreviaSchema.parse(body ?? {});
    await this.exigirOt(otId, req);
    const r = await this.svc.previa(vid, tenantDe(req), otId, formato ?? "html");
    if ("pdf" in r && r.pdf) {
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="vista-previa.pdf"', "Cache-Control": "private, no-store" });
      res.end(r.pdf);
      return;
    }
    res.json(r);
  }

  private async exigirOt(otId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId: tenantDe(req) }, select: { codigo: true, unidadPrincipal: true } });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
  }
}
