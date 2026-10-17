import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { DEV_TENANT } from "../../common/base-crud.service";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { ClasificacionService } from "./clasificacion.service";

const tenant = (req: any) => req?.user?.tenantId ?? DEV_TENANT;
const usuario = (req: any): string | null => req?.user?.sub ?? null;

@ApiTags("bpch · clasificación de sustancias")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH")
@Controller("bpch/clasificaciones")
export class ClasificacionController {
  constructor(private readonly svc: ClasificacionService) {}

  @Get("config")
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Listas ONU vigentes (clase/división, grupo de compatibilidad) y constantes de las IT" })
  config(@Req() req: any) {
    return this.svc.config(tenant(req));
  }

  @Get()
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Clasificaciones (?q=&estado=&vigentes=1)" })
  listar(@Query("q") q: string, @Query("estado") estado: string, @Query("vigentes") vigentes: string, @Query("limit") limit: string, @Req() req: any) {
    return this.svc.listar(tenant(req), { q, estado, vigentes: vigentes === "1" || vigentes === "true", limit: Number(limit) || undefined });
  }

  @Get(":id")
  @RequierePermiso("bpch.clasificacion.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(tenant(req), id);
  }

  @Get(":id/documento")
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Documento de clasificación (HTML sellado)" })
  async documento(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const html = await this.svc.html(tenant(req), id);
    res.set({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
    res.send(html);
  }

  @Get(":id/pdf")
  @RequierePermiso("bpch.clasificacion.ver")
  @ApiOperation({ summary: "Documento de clasificación (PDF)" })
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
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
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(tenant(req), usuario(req), body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.clasificacion.registrar")
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(tenant(req), id, body);
  }

  @Post(":id/registrar")
  @RequierePermiso("bpch.clasificacion.registrar")
  @ApiOperation({ summary: "Registrar la clasificación (queda «registrada», a la espera de aprobación)" })
  registrar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.registrar(tenant(req), id, usuario(req));
  }

  @Post(":id/reclasificar")
  @RequierePermiso("bpch.clasificacion.registrar")
  @ApiOperation({ summary: "Nueva versión (borrador) de una clasificación aprobada" })
  reclasificar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.reclasificar(tenant(req), id, usuario(req));
  }

  @Post(":id/aprobar")
  @RequierePermiso("bpch.clasificacion.aprobar")
  @ApiOperation({ summary: "Aprobar (no quien clasificó) y generar el documento sellado" })
  aprobar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.aprobar(tenant(req), id, usuario(req));
  }

  @Post(":id/devolver")
  @RequierePermiso("bpch.clasificacion.aprobar")
  devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.devolver(tenant(req), id, usuario(req), body);
  }

  @Post(":id/anular")
  @RequierePermiso("bpch.clasificacion.aprobar")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(tenant(req), id, usuario(req), body);
  }
}
