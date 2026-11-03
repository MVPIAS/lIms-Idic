import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { CalidadService } from "./calidad.service";

// ===========================================================================
// Calidad del laboratorio (bloque A del contrato): re-análisis (§4.2.6/§4.3.9),
// POE y margen de advertencia por método (§4.3.1), acreditación ISO/IEC 17025
// (§4.3.5) y alícuotas (§4.2.1). Reglas en calidad.service.ts y reglas-calidad.ts.
// ===========================================================================

const UUID = new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 400 });

@ApiTags("calidad")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("calidad")
export class CalidadController {
  constructor(private readonly c: CalidadService) {}

  /* re-análisis */
  @Get("reanalisis")
  @RequierePermiso("resultado.ver")
  reanalisis(@Query("estado") estado: string | undefined, @Req() req: any) {
    return this.c.reanalisis(req, estado);
  }

  @Post("resultados/:id/reanalisis")
  @RequierePermiso("resultado.revisar")
  solicitar(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.solicitarReanalisis(req, id, b);
  }

  @Post("reanalisis/:id/descartar")
  @RequierePermiso("resultado.aprobar")
  descartar(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.descartarReanalisis(req, id, b);
  }

  /* métodos: POE y margen de advertencia */
  @Get("metodos")
  @RequierePermiso("resultado.ver")
  metodos(@Query("q") q: string | undefined, @Req() req: any) {
    return this.c.buscarMetodos(req, q);
  }

  @Get("metodos/:id")
  @RequierePermiso("resultado.ver")
  metodo(@Param("id", UUID) id: string, @Req() req: any) {
    return this.c.poeDeMetodo(req, id);
  }

  @Get("documentos")
  @RequierePermiso("catalogo.gestionar")
  documentos(@Query("q") q: string | undefined, @Req() req: any) {
    return this.c.buscarDocumentos(req, q);
  }

  @Post("metodos/:id/poe")
  @RequierePermiso("catalogo.gestionar")
  vincular(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.vincularPoe(req, id, b);
  }

  @Delete("metodos/:id/poe/:documentoId")
  @RequierePermiso("catalogo.gestionar")
  desvincular(@Param("id", UUID) id: string, @Param("documentoId", UUID) documentoId: string, @Req() req: any) {
    return this.c.desvincularPoe(req, id, documentoId);
  }

  @Patch("metodos/:id/margen")
  @RequierePermiso("catalogo.gestionar")
  margen(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.margenMetodo(req, id, b);
  }

  /* acreditaciones ISO/IEC 17025 */
  @Get("acreditaciones")
  @RequierePermiso("resultado.ver")
  acreditaciones(@Req() req: any) {
    return this.c.acreditaciones(req);
  }

  @Post("acreditaciones")
  @RequierePermiso("acreditacion.gestionar")
  crearAcreditacion(@Body() b: any, @Req() req: any) {
    return this.c.crearAcreditacion(req, b);
  }

  @Patch("acreditaciones/:id")
  @RequierePermiso("acreditacion.gestionar")
  editarAcreditacion(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.editarAcreditacion(req, id, b);
  }

  @Delete("acreditaciones/:id")
  @RequierePermiso("acreditacion.gestionar")
  borrarAcreditacion(@Param("id", UUID) id: string, @Req() req: any) {
    return this.c.borrarAcreditacion(req, id);
  }

  @Post("acreditaciones/:id/alcance")
  @RequierePermiso("acreditacion.gestionar")
  agregarAlcance(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.agregarAlcance(req, id, b);
  }

  @Delete("acreditaciones/:id/alcance/:metodoId")
  @RequierePermiso("acreditacion.gestionar")
  quitarAlcance(@Param("id", UUID) id: string, @Param("metodoId", UUID) metodoId: string, @Req() req: any) {
    return this.c.quitarAlcance(req, id, metodoId);
  }

  /* alícuotas */
  @Get("muestras")
  @RequierePermiso("muestra.ver")
  muestras(@Query("q") q: string | undefined, @Req() req: any) {
    return this.c.buscarMuestras(req, q);
  }

  @Get("muestras/:id/alicuotas")
  @RequierePermiso("muestra.ver")
  alicuotas(@Param("id", UUID) id: string, @Req() req: any) {
    return this.c.alicuotas(req, id);
  }

  @Post("muestras/:id/alicuotas")
  @RequierePermiso("alicuota.gestionar")
  crearAlicuotas(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.crearAlicuotas(req, id, b);
  }

  @Post("alicuotas/:id/movimiento")
  @RequierePermiso("alicuota.gestionar")
  mover(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.c.moverAlicuota(req, id, b);
  }
}

@Module({
  controllers: [CalidadController],
  providers: [CalidadService],
})
export class CalidadModule {}
