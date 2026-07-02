import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { FlujoService } from "./flujo.service";

@Controller("flujos")
export class FlujoController {
  constructor(private readonly flujos: FlujoService) {}

  /** Catálogo de flujos (defs con su última versión). */
  @Get()
  listar() {
    return this.flujos.listarDefs();
  }

  /** Detalle de un flujo por código (versión vigente con pasos y transiciones). */
  @Get("codigo/:codigo")
  porCodigo(@Param("codigo") codigo: string) {
    return this.flujos.detallePorCodigo(codigo);
  }

  /** Detalle de una versión concreta. */
  @Get("version/:versionId")
  version(@Param("versionId") versionId: string) {
    return this.flujos.detalleVersion(versionId);
  }

  /** Guarda un borrador desde el diseñador visual (pasos + transiciones). */
  @Post()
  guardar(@Body() body: any) {
    return this.flujos.guardarBorrador(body);
  }

  /** Publica una versión (archiva la publicada anterior). */
  @Post("version/:versionId/publicar")
  publicar(@Param("versionId") versionId: string) {
    return this.flujos.publicar(versionId);
  }

  /** Instancia un flujo publicado (p. ej. al crear una OT). */
  @Post("version/:versionId/instanciar")
  instanciar(@Param("versionId") versionId: string, @Body() body: any) {
    return this.flujos.instanciar(versionId, body ?? {});
  }

  /** Estado e historial de una instancia. */
  @Get("instancia/:id")
  instancia(@Param("id") id: string) {
    return this.flujos.estadoInstancia(id);
  }

  /** Bandeja de tareas pendientes (opcionalmente por usuario). */
  @Get("tareas/bandeja")
  bandeja(@Query("usuario") usuario?: string) {
    return this.flujos.bandeja(usuario);
  }

  /** Completa una tarea humana y avanza el flujo. */
  @Post("tareas/:pasoEjecucionId/completar")
  completar(@Param("pasoEjecucionId") id: string, @Body() body: any) {
    return this.flujos.completarTarea(id, body ?? {});
  }
}
