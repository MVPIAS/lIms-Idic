import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { FlujoService } from "./flujo.service";

@ApiTags("flujos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("flujos")
export class FlujoController {
  constructor(private readonly flujos: FlujoService) {}

  /** Catálogo de flujos (defs con su última versión). */
  @Get()
  listar(@Req() req: any) {
    return this.flujos.listarDefs(req?.user?.tenantId);
  }

  /** Detalle de un flujo por código (versión vigente con pasos y transiciones). */
  @Get("codigo/:codigo")
  porCodigo(@Param("codigo") codigo: string, @Req() req: any) {
    return this.flujos.detallePorCodigo(codigo, req?.user?.tenantId);
  }

  /** Detalle de una versión concreta. */
  @Get("version/:versionId")
  version(@Param("versionId") versionId: string, @Req() req: any) {
    return this.flujos.detalleVersion(versionId, req?.user?.tenantId);
  }

  /** Guarda un borrador desde el diseñador visual (pasos + transiciones). */
  @Post()
  guardar(@Body() body: any, @Req() req: any) {
    return this.flujos.guardarBorrador(body, req?.user?.tenantId);
  }

  /** Publica una versión (archiva la publicada anterior). */
  @Post("version/:versionId/publicar")
  publicar(@Param("versionId") versionId: string, @Req() req: any) {
    return this.flujos.publicar(versionId, req?.user?.tenantId);
  }

  /** Instancia un flujo publicado (p. ej. al crear una OT). */
  @Post("version/:versionId/instanciar")
  instanciar(@Param("versionId") versionId: string, @Body() body: any, @Req() req: any) {
    return this.flujos.instanciar(versionId, body ?? {}, req?.user?.tenantId);
  }

  /** Estado e historial de una instancia. */
  @Get("instancia/:id")
  instancia(@Param("id") id: string, @Req() req: any) {
    return this.flujos.estadoInstancia(id, req?.user?.tenantId);
  }

  /** Bandeja de tareas pendientes (opcionalmente por usuario). */
  @Get("tareas/bandeja")
  bandeja(@Req() req: any, @Query("usuario") usuario?: string) {
    return this.flujos.bandeja(usuario, req?.user?.tenantId);
  }

  /** Completa una tarea humana y avanza el flujo. */
  @Post("tareas/:pasoEjecucionId/completar")
  completar(@Param("pasoEjecucionId") id: string, @Body() body: any, @Req() req: any) {
    return this.flujos.completarTarea(id, body ?? {}, req?.user?.tenantId);
  }
}
