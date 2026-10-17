/**
 * Datos del informe de ensayo que no son resultados: fotos para el anexo
 * fotográfico, estructura (sección y componente de cada ensayo) y formato de
 * la plantilla. Reglas: docs/FLUJO_INFORME_ENSAYO.md.
 *
 * Permisos (sin permisos nuevos; los existentes del flujo):
 *   · ver fotos / estructura ........ resultado.ver o certificado.emitir
 *   · subir, editar y quitar fotos .. resultado.crear o certificado.emitir
 *   · fijar la estructura ........... certificado.emitir o resultado.aprobar
 *   · formato de la plantilla ....... ver: plantilla.ver · cambiar: plantilla.gestionar
 * Todo lo de una OT exige además que la OT sea del alcance por laboratorio del
 * usuario (403) y del tenant (404).
 */
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
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { createHash } from "crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { ConfigInformeSchema, configEfectiva, configPorTipo } from "./config-informe";
import { armarInforme } from "./filas-informe";
import { PlantillaRenderService } from "./plantilla-render.service";
import { tipoImagen } from "./reglas-fotos";

/** Fichero que entrega multer (FileInterceptor, almacenamiento en memoria). */
type ArchivoSubido = { buffer: Buffer; originalname?: string; size?: number; mimetype?: string };

/** Tamaño máximo de una foto (bytes). La pantalla las reduce antes de subirlas. */
export const MAX_FOTO_BYTES = 2 * 1024 * 1024;
/** Fotos como máximo por OT (vigentes). */
export const MAX_FOTOS_OT = 60;

function exigirAlguno(req: any, permisos: string[]) {
  const roles: string[] = req?.user?.roles ?? [];
  if (roles.includes("SUPERADMIN")) return;
  const tiene: string[] = req?.user?.permisos ?? [];
  if (!permisos.some((p) => tiene.includes(p)))
    throw new ForbiddenException(`Permiso insuficiente. Requiere uno de: ${permisos.join(", ")}`);
}
const tenantDe = (req: any): string => req?.user?.tenantId;
const usuarioDe = (req: any): string | null => req?.user?.sub ?? req?.user?.id ?? null;

const uuidOpcional = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : v === undefined ? undefined : null));

const FotoMeta = z.object({
  pie: z.string().trim().max(500).optional(),
  muestraId: uuidOpcional,
  resultadoId: uuidOpcional,
  enInforme: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === "true" || v === "1")),
  orden: z.coerce.number().int().min(0).max(9999).optional(),
});

const EstructuraBody = z.object({
  filas: z
    .array(
      z.object({
        resultadoId: z.string().uuid(),
        seccion: z.string().trim().max(120).nullable().optional(),
        componente: z.string().trim().max(160).nullable().optional(),
        orden: z.number().int().min(0).max(99999).nullable().optional(),
      }),
    )
    .max(2000),
});

@Injectable()
export class InformeDatosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly render: PlantillaRenderService,
  ) {}

  /** OT del tenant y del alcance del usuario. */
  private async ot(otId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: tenantDe(req) },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true, tenantId: true },
    });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  /** Comprueba que la muestra y el ensayo indicados son de la OT. */
  private async validarVinculos(otId: string, muestraId?: string | null, resultadoId?: string | null) {
    if (muestraId) {
      const m = await this.prisma.muestra.findFirst({ where: { id: muestraId, otId, deletedAt: null }, select: { id: true } });
      if (!m) throw new BadRequestException("La muestra indicada no pertenece a esta OT.");
    }
    if (resultadoId) {
      const r = await this.prisma.resultado.findFirst({
        where: { id: resultadoId, deletedAt: null, OR: [{ otId }, { muestra: { otId } }] },
        select: { id: true, muestraId: true },
      });
      if (!r) throw new BadRequestException("El ensayo indicado no pertenece a esta OT.");
      return r.muestraId;
    }
    return muestraId ?? null;
  }

  /* ------------------------------------------------------------- fotos --- */

  async fotos(otId: string, req: any) {
    await this.ot(otId, req);
    const filas = await this.prisma.$queryRaw<any[]>`
      SELECT f.id, f.nombre, f.mime, f.bytes, f.datos, f.pie, f.en_informe, f.orden, f.created_at,
             f.muestra_id, m.codigo AS muestra_codigo, f.resultado_id,
             COALESCE(ca.nombre, a.nombre) AS ensayo, u.nombre_completo AS subida_por
        FROM ot_foto f
        LEFT JOIN muestra m    ON m.id = f.muestra_id
        LEFT JOIN resultado r  ON r.id = f.resultado_id
        LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id
        LEFT JOIN analito a    ON a.id = r.analito_id
        LEFT JOIN usuario u    ON u.id = f.subida_por
       WHERE f.ot_id = ${otId}::uuid AND f.deleted_at IS NULL
       ORDER BY f.orden, f.created_at`;
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      bytes: f.bytes,
      pie: f.pie,
      enInforme: f.en_informe,
      orden: f.orden,
      creadaAt: f.created_at,
      muestraId: f.muestra_id,
      muestraCodigo: f.muestra_codigo,
      resultadoId: f.resultado_id,
      ensayo: f.ensayo,
      subidaPor: f.subida_por,
      dataUrl: `data:${f.mime};base64,${f.datos}`,
    }));
  }

  async subirFoto(otId: string, archivo: ArchivoSubido | undefined, cuerpo: unknown, req: any) {
    const ot = await this.ot(otId, req);
    if (ot.estado === "anulada") throw new ConflictException(`La OT ${ot.codigo} está anulada.`);
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte una foto (PNG o JPEG).");
    if (archivo.buffer.length > MAX_FOTO_BYTES)
      throw new BadRequestException(`La foto no puede superar ${MAX_FOTO_BYTES / 1024 / 1024} MB.`);
    const mime = tipoImagen(archivo.buffer);
    if (!mime) throw new BadRequestException("El archivo no es una imagen PNG o JPEG válida.");
    const meta = FotoMeta.parse(cuerpo ?? {});
    const muestraId = await this.validarVinculos(otId, meta.muestraId, meta.resultadoId);

    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ot_foto WHERE ot_id = ${otId}::uuid AND deleted_at IS NULL`;
    if (n >= MAX_FOTOS_OT) throw new ConflictException(`La OT ya tiene ${MAX_FOTOS_OT} fotos: quite alguna antes de subir otra.`);

    const nombre = (archivo.originalname ?? "foto").replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 200);
    const hash = createHash("sha256").update(archivo.buffer).digest("hex");
    const filas = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO ot_foto (tenant_id, ot_id, muestra_id, resultado_id, nombre, mime, bytes, datos, hash_sha256, pie, en_informe, orden, subida_por)
      VALUES (${ot.tenantId}::uuid, ${otId}::uuid, ${muestraId}::uuid, ${meta.resultadoId ?? null}::uuid, ${nombre}, ${mime},
              ${archivo.buffer.length}, ${archivo.buffer.toString("base64")}, ${hash}, ${meta.pie || null},
              ${meta.enInforme ?? true}, ${meta.orden ?? n}, ${usuarioDe(req)}::uuid)
      RETURNING id`;
    return { id: filas[0].id, mime, bytes: archivo.buffer.length, hash };
  }

  private async fotoDelTenant(id: string, req: any) {
    const f = await this.prisma.$queryRaw<{ id: string; ot_id: string }[]>`
      SELECT id, ot_id FROM ot_foto WHERE id = ${id}::uuid AND tenant_id = ${tenantDe(req)}::uuid AND deleted_at IS NULL`;
    if (!f[0]) throw new NotFoundException(`Foto ${id} no encontrada`);
    await this.ot(f[0].ot_id, req);
    return f[0];
  }

  async editarFoto(id: string, cuerpo: unknown, req: any) {
    const f = await this.fotoDelTenant(id, req);
    const meta = FotoMeta.parse(cuerpo ?? {});
    let muestraId: string | null | undefined;
    if (meta.muestraId !== undefined || meta.resultadoId !== undefined)
      muestraId = await this.validarVinculos(f.ot_id, meta.muestraId ?? null, meta.resultadoId ?? null);
    await this.prisma.$executeRaw`
      UPDATE ot_foto SET
        pie        = CASE WHEN ${meta.pie !== undefined} THEN ${meta.pie || null} ELSE pie END,
        en_informe = COALESCE(${meta.enInforme ?? null}::boolean, en_informe),
        orden      = COALESCE(${meta.orden ?? null}::int, orden),
        muestra_id = CASE WHEN ${muestraId !== undefined} THEN ${muestraId ?? null}::uuid ELSE muestra_id END,
        resultado_id = CASE WHEN ${meta.resultadoId !== undefined} THEN ${meta.resultadoId ?? null}::uuid ELSE resultado_id END
      WHERE id = ${id}::uuid`;
    return { ok: true };
  }

  async quitarFoto(id: string, req: any) {
    await this.fotoDelTenant(id, req);
    await this.prisma.$executeRaw`UPDATE ot_foto SET deleted_at = now() WHERE id = ${id}::uuid`;
    return { ok: true };
  }

  /* --------------------------------------------------------- estructura --- */

  /**
   * Ensayos de la OT con su sección / componente / orden y el punto que
   * tendrían en un informe numerado desde 4 (vista previa de la numeración).
   */
  async estructura(otId: string, req: any) {
    await this.ot(otId, req);
    const ctx = await this.render.contexto(otId, tenantDe(req));
    const cfg = { ...configPorTipo(null), agrupacion: "seccion" as const, numeracion: "4" };
    const est = armarInforme(ctx.paraInforme, cfg, "cumplimiento");
    return {
      filas: ctx.paraInforme.map((r) => ({
        resultadoId: r.id,
        muestraId: r.muestraId,
        muestraCodigo: r.muestraCodigo,
        ensayo: r.ensayo,
        seccion: r.seccion ?? null,
        componente: r.componente ?? null,
        orden: r.orden ?? null,
        punto: est.puntoDe[r.id]?.punto ?? null,
      })),
    };
  }

  async guardarEstructura(otId: string, cuerpo: unknown, req: any) {
    const ot = await this.ot(otId, req);
    const { filas } = EstructuraBody.parse(cuerpo ?? {});
    if (!filas.length) return { guardadas: 0 };
    const ids = [...new Set(filas.map((f) => f.resultadoId))];
    const propios = await this.prisma.resultado.findMany({
      where: { id: { in: ids }, deletedAt: null, OR: [{ otId }, { muestra: { otId } }] },
      select: { id: true },
    });
    if (propios.length !== ids.length) throw new BadRequestException("Hay ensayos que no pertenecen a esta OT.");
    const usuario = usuarioDe(req);
    await this.prisma.$transaction(
      filas.map(
        (f) => this.prisma.$executeRaw`
          INSERT INTO resultado_informe (resultado_id, tenant_id, ot_id, seccion, componente, orden, updated_by, updated_at)
          VALUES (${f.resultadoId}::uuid, ${ot.tenantId}::uuid, ${otId}::uuid, ${f.seccion || null}, ${f.componente || null},
                  ${f.orden ?? null}::int, ${usuario}::uuid, now())
          ON CONFLICT (resultado_id) DO UPDATE SET
            seccion = EXCLUDED.seccion, componente = EXCLUDED.componente, orden = EXCLUDED.orden,
            updated_by = EXCLUDED.updated_by, updated_at = now()`,
      ),
    );
    return { guardadas: filas.length };
  }

  /* ------------------------------------------------- formato de plantilla --- */

  private async plantilla(id: string, req: any) {
    const p = await this.prisma.plantillaInforme.findFirst({
      where: { id, tenantId: tenantDe(req) },
      select: { id: true, repid: true, nombre: true, tipo: true },
    });
    if (!p) throw new NotFoundException(`Plantilla ${id} no encontrada`);
    return p;
  }

  async formato(id: string, req: any) {
    const p = await this.plantilla(id, req);
    const f = await this.prisma.$queryRaw<{ config_informe: unknown }[]>`
      SELECT config_informe FROM plantilla_informe WHERE id = ${id}::uuid`;
    const guardado = f[0]?.config_informe ?? null;
    return { plantilla: p, guardado, efectivo: configEfectiva(p.tipo, guardado), porTipo: configPorTipo(p.tipo) };
  }

  /** Guarda el formato (solo lo que cambia respecto al tipo). `null` vuelve al del tipo. */
  async guardarFormato(id: string, cuerpo: unknown, req: any) {
    await this.plantilla(id, req);
    const crudo = (cuerpo as any)?.formato;
    const valor = crudo === null ? null : ConfigInformeSchema.parse(crudo ?? {});
    const json = valor === null ? null : JSON.stringify(valor);
    await this.prisma.$executeRaw`UPDATE plantilla_informe SET config_informe = ${json}::jsonb WHERE id = ${id}::uuid`;
    return this.formato(id, req);
  }
}

@ApiTags("informes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("informes")
export class InformeDatosController {
  constructor(private readonly svc: InformeDatosService) {}

  @Get("ot/:otId/fotos")
  fotos(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    exigirAlguno(req, ["resultado.ver", "certificado.emitir"]);
    return this.svc.fotos(otId, req);
  }

  /** multipart/form-data: `archivo` (PNG o JPEG) + pie, muestraId, resultadoId, enInforme. */
  @Post("ot/:otId/fotos")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_FOTO_BYTES, files: 1, fields: 10 } }))
  subirFoto(
    @Param("otId", ParseUUIDPipe) otId: string,
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    exigirAlguno(req, ["resultado.crear", "certificado.emitir"]);
    return this.svc.subirFoto(otId, archivo, body, req);
  }

  @Patch("fotos/:id")
  editarFoto(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    exigirAlguno(req, ["resultado.crear", "certificado.emitir"]);
    return this.svc.editarFoto(id, body, req);
  }

  @Delete("fotos/:id")
  quitarFoto(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    exigirAlguno(req, ["resultado.crear", "certificado.emitir"]);
    return this.svc.quitarFoto(id, req);
  }

  @Get("ot/:otId/estructura")
  estructura(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    exigirAlguno(req, ["resultado.ver", "certificado.emitir"]);
    return this.svc.estructura(otId, req);
  }

  @Put("ot/:otId/estructura")
  guardarEstructura(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    exigirAlguno(req, ["certificado.emitir", "resultado.aprobar"]);
    return this.svc.guardarEstructura(otId, body, req);
  }

  @Get("plantillas/:id/formato")
  @RequierePermiso("plantilla.ver")
  formato(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.formato(id, req);
  }

  @Put("plantillas/:id/formato")
  @RequierePermiso("plantilla.gestionar")
  guardarFormato(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.guardarFormato(id, body, req);
  }
}
