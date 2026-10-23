import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_BYTES_ADJUNTO, cabecerasAdjunto, type ArchivoAdjunto } from "../../common/adjuntos";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { DEV_TENANT } from "../../common/base-crud.service";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { ClasificacionService } from "./clasificacion.service";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";

const tenant = (req: any) => req?.user?.tenantId ?? DEV_TENANT;
const usuario = (req: any): string | null => req?.user?.sub ?? null;

@ApiTags("bpch · clasificación de sustancias")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH")
@Controller("bpch/clasificaciones")
export class ClasificacionController {
  constructor(
    private readonly svc: ClasificacionService,
    private readonly comun: OtDesdeProcesoService,
  ) {}

  /**
   * Alcance por unidad (frente L · C8): las sucursales y la Delegación Nº 11 ven
   * y gestionan solo las clasificaciones de su unidad (la de su OT o la de los
   * prototipos que la usan); la Sección Certificación de la Conformidad y la
   * jefatura del BPCH, todas. Listado, detalle, documentos y escrituras.
   */
  private async exigir(req: any, id: string) {
    const filtro = await this.comun.filtroExpedientes(req);
    if (filtro === null) return;
    const unidades = await this.svc.unidadesDe(tenant(req), id);
    if (!unidades.some((u) => filtro.includes(u)))
      throw new ForbiddenException(
        unidades.length
          ? "Fuera de su alcance: la clasificación es de una unidad que usted no tiene asignada."
          : "Fuera de su alcance: la clasificación no tiene unidad; la gestionan la Sección Certificación de la Conformidad y la jefatura del BPCH.",
      );
  }

  /** Al crear o vincular una OT: la OT tiene que ser de su alcance (sin OT, solo quien ve todo). */
  private async exigirOt(req: any, body: unknown, obligatoria: boolean) {
    const filtro = await this.comun.filtroExpedientes(req);
    if (filtro === null) return;
    const otId = body && typeof body === "object" ? (body as { otId?: unknown }).otId : undefined;
    if (!otId) {
      if (obligatoria)
        throw new ForbiddenException(
          "Fuera de su alcance: indique la OT de su unidad; una clasificación sin OT la registran la Sección Certificación de la Conformidad y la jefatura del BPCH.",
        );
      return;
    }
    const unidad = typeof otId === "string" && /^[0-9a-f-]{36}$/i.test(otId) ? await this.svc.unidadDeOt(tenant(req), otId) : null;
    if (!unidad || !filtro.includes(unidad))
      throw new ForbiddenException("Fuera de su alcance: la OT indicada es de una unidad que usted no tiene asignada.");
  }

  @Get("config")
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Listas ONU vigentes (clase/división, grupo de compatibilidad) y constantes de las IT" })
  config(@Req() req: any) {
    return this.svc.config(tenant(req));
  }

  @Get()
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Clasificaciones (?q=&estado=&vigentes=1)" })
  async listar(@Query("q") q: string, @Query("estado") estado: string, @Query("vigentes") vigentes: string, @Query("limit") limit: string, @Req() req: any) {
    return this.svc.listar(
      tenant(req),
      { q, estado, vigentes: vigentes === "1" || vigentes === "true", limit: Number(limit) || undefined },
      await this.comun.filtroExpedientes(req),
    );
  }

  @Get(":id")
  @RequierePermiso("bpch.clasificacion.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.detalle(tenant(req), id);
  }

  @Get(":id/documento")
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Documento de clasificación (HTML sellado)" })
  async documento(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    await this.exigir(req, id);
    const html = await this.svc.html(tenant(req), id);
    res.set({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
    res.send(html);
  }

  @Get(":id/pdf")
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Documento de clasificación (PDF)" })
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    await this.exigir(req, id);
    const { buffer, nombre } = await this.svc.pdf(tenant(req), id);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Content-Length": String(buffer.length),
    });
    res.end(buffer);
  }

  @Post()
  @RequierePermiso("bpch.clasificacion.registrar")
  @ApiOperation({ summary: "Nueva sustancia (borrador) con sus pruebas ONU" })
  async crear(@Body() body: unknown, @Req() req: any) {
    await this.exigirOt(req, body, true);
    return this.svc.crear(tenant(req), usuario(req), body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.clasificacion.registrar")
  async editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    await this.exigirOt(req, body, false);
    return this.svc.editar(tenant(req), id, body);
  }

  @Post(":id/registrar")
  @RequierePermiso("bpch.clasificacion.registrar")
  @ApiOperation({ summary: "Registrar la clasificación (queda «registrada», a la espera de aprobación)" })
  async registrar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.registrar(tenant(req), id, usuario(req));
  }

  @Post(":id/reclasificar")
  @RequierePermiso("bpch.clasificacion.registrar")
  @ApiOperation({ summary: "Nueva versión (borrador) de una clasificación aprobada" })
  async reclasificar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.reclasificar(tenant(req), id, usuario(req));
  }

  @Post(":id/aprobar")
  @RequierePermiso("bpch.clasificacion.aprobar")
  @ApiOperation({ summary: "Aprobar (no quien clasificó) y generar el documento sellado" })
  async aprobar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.aprobar(tenant(req), id, usuario(req));
  }

  @Post(":id/devolver")
  @RequierePermiso("bpch.clasificacion.aprobar")
  async devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.devolver(tenant(req), id, usuario(req), body);
  }

  @Post(":id/adjuntos")
  @RequierePermiso("bpch.clasificacion.registrar")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_BYTES_ADJUNTO, files: 1, fields: 2 } }))
  @ApiOperation({ summary: "Adjuntar la curva tiempo/presión del MCU (IT23) o el registro de la prueba IT21 · multipart: archivo + clase=curva_it23|registro_it21" })
  async adjuntar(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() archivo: ArchivoAdjunto | undefined, @Body() body: any, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.adjuntar(tenant(req), id, usuario(req), String(body?.clase ?? ""), archivo);
  }

  @Get(":id/adjuntos/:adjuntoId")
  @RequierePermiso("bpch.clasificacion.ver")
  async adjunto(@Param("id", ParseUUIDPipe) id: string, @Param("adjuntoId", ParseUUIDPipe) adjuntoId: string, @Req() req: any, @Res() res: Response) {
    await this.exigir(req, id);
    const a = await this.svc.adjunto(tenant(req), id, adjuntoId);
    res.set(cabecerasAdjunto(a));
    res.end(a.datos);
  }

  @Post(":id/anular")
  @RequierePermiso("bpch.clasificacion.aprobar")
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.anular(tenant(req), id, usuario(req), body);
  }
}
