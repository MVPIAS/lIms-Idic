import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { FlujoService } from "./flujo.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

@ApiTags("flujos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujos")
export class FlujoController {
  constructor(private readonly flujos: FlujoService) {}

  /** Catálogo de flujos (defs con su última versión). */
  @Get()
  @RequierePermiso("flujo.ver")
  listar(@Req() req: any) {
    return this.flujos.listarDefs(req?.user?.tenantId);
  }

  /** Detalle de un flujo por código (versión vigente con pasos y transiciones). */
  @Get("codigo/:codigo")
  @RequierePermiso("flujo.ver")
  porCodigo(@Param("codigo") codigo: string, @Req() req: any) {
    return this.flujos.detallePorCodigo(codigo, req?.user?.tenantId);
  }

  /** Detalle de una versión concreta. */
  @Get("version/:versionId")
  @RequierePermiso("flujo.ver")
  version(@Param("versionId") versionId: string, @Req() req: any) {
    return this.flujos.detalleVersion(versionId, req?.user?.tenantId);
  }

  /** Guarda un borrador desde el diseñador visual (pasos + transiciones). */
  @Post()
  @RequierePermiso("flujo.editar")
  guardar(@Body() body: any, @Req() req: any) {
    return this.flujos.guardarBorrador(body, req?.user?.tenantId);
  }

  /** Publica una versión (archiva la publicada anterior). */
  @Post("version/:versionId/publicar")
  @RequierePermiso("flujo.publicar")
  publicar(@Param("versionId") versionId: string, @Req() req: any) {
    return this.flujos.publicar(versionId, req?.user?.tenantId);
  }

  /**
   * Instancia un flujo publicado (p. ej. al crear una OT). Es un acto de
   * ejecución, no de diseño: se exige `ot.crear` (quien puede abrir una OT puede
   * arrancar su flujo), no `flujo.editar`, que es del diseñador.
   */
  @Post("version/:versionId/instanciar")
  @RequierePermiso("ot.crear")
  instanciar(@Param("versionId") versionId: string, @Body() body: any, @Req() req: any) {
    return this.flujos.instanciar(versionId, body ?? {}, req?.user?.tenantId);
  }

  /** Estado e historial de una instancia. */
  @Get("instancia/:id")
  @RequierePermiso("ot.ver")
  instancia(@Param("id") id: string, @Req() req: any) {
    return this.flujos.estadoInstancia(id, req?.user?.tenantId);
  }

  /**
   * Bandeja de tareas pendientes y cierre de tareas.
   *
   * Se protegen con `ot.ver` y NO con `flujo.ver` a propósito: los roles que
   * ejecutan las tareas (ANALISTA, ANALISTA_SR, TECNICO, RECEPCION) NO tienen
   * ningún permiso `flujo.*` en el RBAC sembrado — `flujo.ver` es de los perfiles
   * de diseño/supervisión. Exigirlo aquí dejaría a los analistas sin acceso a su
   * propia bandeja y rompería el motor BPM. `ot.ver` sí lo tienen todos, y la
   * tarea siempre pertenece a una OT. Anotado como deuda del RBAC: lo correcto a
   * futuro es un permiso `tarea.ver`/`tarea.completar` propio.
   */
  @Get("tareas/bandeja")
  @RequierePermiso("ot.ver")
  bandeja(@Req() req: any, @Query("usuario") usuario?: string) {
    return this.flujos.bandeja(usuario, req?.user?.tenantId);
  }

  /** Completa una tarea humana y avanza el flujo. */
  @Post("tareas/:pasoEjecucionId/completar")
  @RequierePermiso("ot.ver")
  completar(@Param("pasoEjecucionId") id: string, @Body() body: any, @Req() req: any) {
    return this.flujos.completarTarea(id, body ?? {}, req?.user?.tenantId);
  }
}
