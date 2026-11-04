import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { FlujoService } from "./flujo.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { codigoCanonico } from "../rbac/rbac.constants";

@ApiTags("flujos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("flujos")
export class FlujoController {
  constructor(
    private readonly flujos: FlujoService,
    private readonly alcance: AlcanceService,
  ) {}

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

  /** Historial de versiones de un flujo. */
  @Get("codigo/:codigo/versiones")
  @RequierePermiso("flujo.ver")
  versiones(@Param("codigo") codigo: string, @Req() req: any) {
    return this.flujos.versiones(codigo, req?.user?.tenantId);
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
   * Simulación del diseñador (borrador o publicada) con datos PRUEBA: sin OT y
   * sin tareas en bandejas. `variables` = valores iniciales para las decisiones.
   */
  @Post("version/:versionId/simular")
  @RequierePermiso("flujo.editar")
  simular(@Param("versionId", ParseUUIDPipe) versionId: string, @Body() body: any, @Req() req: any) {
    const variables = body?.variables && typeof body.variables === "object" && !Array.isArray(body.variables) ? body.variables : {};
    return this.flujos.simular(versionId, variables, req?.user?.sub, req?.user?.tenantId);
  }

  /** Completa un paso de una simulación (con el resultado que elige el diseñador). */
  @Post("simulacion/:pasoEjecucionId/completar")
  @RequierePermiso("flujo.editar")
  completarSimulacion(@Param("pasoEjecucionId", ParseUUIDPipe) id: string, @Body() body: any, @Req() req: any) {
    const resultado = body?.resultado && typeof body.resultado === "object" && !Array.isArray(body.resultado) ? body.resultado : {};
    return this.flujos.completarSimulacion(id, resultado, req?.user?.tenantId);
  }

  /**
   * Instancia un flujo publicado (p. ej. al crear una OT). Es un acto de
   * ejecución, no de diseño: se exige `ot.crear` (quien puede abrir una OT puede
   * arrancar su flujo), no `flujo.editar`, que es del diseñador.
   */
  @Post("version/:versionId/instanciar")
  @RequierePermiso("ot.crear")
  instanciar(@Param("versionId") versionId: string, @Body() body: any, @Req() req: any) {
    // El usuario autenticado es quien inicia la instancia y recibe la 1ª tarea.
    // Sin esto `iniciadoPor` quedaba null y la tarea se asignaba a un UUID
    // inexistente (violación de FK → 500 al simular).
    return this.flujos.instanciar(
      versionId,
      { ...(body ?? {}), usuarioId: body?.usuarioId ?? req?.user?.sub },
      req?.user?.tenantId,
    );
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

  /**
   * Completa una tarea humana y avanza el flujo. `ot.ver` solo deja llegar aquí:
   * además se exige el permiso del paso (permiso-paso.ts: aprobar, revisar,
   * registrar muestras, capturar, cotizar…), el rol responsable si el paso lo
   * define y que la OT sea del alcance del usuario. Así el perfil de solo
   * lectura ya no hace avanzar un flujo.
   */
  @Post("tareas/:pasoEjecucionId/completar")
  @RequierePermiso("ot.ver")
  async completar(@Param("pasoEjecucionId") id: string, @Body() body: any, @Req() req: any) {
    const tenantId = req?.user?.tenantId;
    const r = await this.flujos.requisitosParaCompletar(id, tenantId);
    const roles: string[] = (req?.user?.roles ?? []).map((x: string) => codigoCanonico(x));
    const superadmin = roles.includes("SUPERADMIN");
    if (!superadmin && !(req?.user?.permisos ?? []).includes(r.permiso))
      throw new ForbiddenException(`El paso «${r.actividad}» lo completa quien tiene el permiso «${r.permiso}».`);
    if (!superadmin && r.rol && !roles.includes(codigoCanonico(r.rol.codigo)))
      throw new ForbiddenException(`El paso «${r.actividad}» le corresponde al rol «${r.rol.nombre}».`);
    // Alcance por asignación: el permiso del paso tiene que valer en la unidad de la OT.
    if (r.ot) await this.alcance.exigirUnidad(req, r.ot.unidadPrincipal, `la OT ${r.ot.codigo}`, superadmin ? null : r.permiso);
    // Quien completa queda registrado (no lo elige el cliente).
    return this.flujos.completarTarea(id, { ...(body ?? {}), usuarioId: req?.user?.sub }, tenantId);
  }
}
