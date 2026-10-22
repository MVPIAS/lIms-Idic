/**
 * Módulo de formularios especializados (T10), preparación de muestras (T29) y
 * preparación del trabajo del DSA (T26) · frente r2a.
 * Contrato: docs/FLUJO_FORMULARIOS_ESPECIALIZADOS.md.
 */
import { Body, Controller, Delete, ForbiddenException, Get, Module, Param, ParseUUIDPipe, Post, Put, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { FlujoRealModule } from "../flujo-real/flujo-real.module";
import { PlantillaRenderModule } from "../plantilla-render/plantilla-render.module";
import { FormulariosDatos } from "./formularios.datos";
import { FormulariosService } from "./formularios.service";
import { MAX_ADJUNTO_BYTES, PreparacionService } from "./preparacion.service";
import { MicroSensorialService } from "./micro-sensorial.service";

const UUID = new ParseUUIDPipe();

function exigirAlguno(req: any, permisos: string[]) {
  if ((req?.user?.roles ?? []).includes("SUPERADMIN")) return;
  const tiene: string[] = req?.user?.permisos ?? [];
  if (!permisos.some((p) => tiene.includes(p))) throw new ForbiddenException(`Permiso insuficiente. Requiere uno de: ${permisos.join(", ")}`);
}

@ApiTags("formularios")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("formularios")
export class FormulariosController {
  constructor(
    private readonly svc: FormulariosService,
    private readonly prep: PreparacionService,
    private readonly ms: MicroSensorialService,
  ) {}

  /* ---------------------------------------------------------- resumen --- */

  @Get("ot/:otId")
  @RequierePermiso("resultado.ver")
  @ApiOperation({ summary: "Variante de captura de cada ensayo de la OT y los formularios especializados que aplican" })
  resumen(@Param("otId", UUID) otId: string, @Req() req: any) {
    return this.svc.resumen(otId, req);
  }

  @Get("registro/:id/eventos")
  @RequierePermiso("resultado.ver")
  @ApiOperation({ summary: "Bitácora de un registro (quién, cuándo, qué y por qué)" })
  eventos(@Param("id", UUID) id: string, @Req() req: any) {
    return this.prep.eventosRegistro(id, req);
  }

  /* -------------------------------------------- LRB · registro de disparos --- */

  @Get("ot/:otId/disparos")
  @RequierePermiso("resultado.ver")
  lrbVer(@Param("otId", UUID) otId: string, @Req() req: any) {
    return this.svc.lrbVer(otId, req);
  }

  @Put("ot/:otId/disparos")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Lote, nómina por talla y unidades muestreadas con sus paneles (EP-05 3.2/4.1)" })
  lrbCabecera(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.lrbCabecera(otId, body ?? {}, req);
  }

  @Post("ot/:otId/disparos/disparo")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Guardar disparo → siguiente disparo (corregir exige motivo)" })
  lrbDisparo(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.lrbDisparo(otId, body ?? {}, req);
  }

  @Post("ot/:otId/disparos/cerrar-panel")
  @RequierePermiso("resultado.crear")
  lrbCerrarPanel(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.lrbCerrarPanel(otId, body ?? {}, req);
  }

  @Post("ot/:otId/disparos/concluir")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Concluir lote → documento: veredicto del lote a los ensayos" })
  lrbConcluir(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.lrbConcluir(otId, body ?? {}, req);
  }

  @Post("ot/:otId/disparos/reabrir")
  @RequierePermiso("resultado.crear")
  lrbReabrir(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.lrbReabrir(otId, body ?? {}, req);
  }

  /* --------------------------------------------------- SVM · HCP --- */

  @Get("ot/:otId/hcp")
  @RequierePermiso("resultado.ver")
  hcpVer(@Param("otId", UUID) otId: string, @Req() req: any) {
    return this.svc.hcpVer(otId, req);
  }

  @Put("ot/:otId/hcp/lote")
  @RequierePermiso("resultado.crear")
  hcpLote(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.hcpLote(otId, body ?? {}, req);
  }

  @Put("ot/:otId/hcp/vehiculo/:muestraId")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Guardar vehículo → siguiente vehículo (HCP por vehículo, EP-05 4.6)" })
  hcpVehiculo(@Param("otId", UUID) otId: string, @Param("muestraId", UUID) muestraId: string, @Body() body: any, @Req() req: any) {
    return this.svc.hcpVehiculo(otId, muestraId, body ?? {}, req);
  }

  @Put("ot/:otId/hcp/acciones")
  @RequierePermiso("resultado.crear")
  hcpAcciones(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.hcpAcciones(otId, body ?? {}, req);
  }

  @Post("ot/:otId/hcp/acta")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Emitir acta de novedades → evaluación del lote (EP-05 4.8)" })
  hcpActa(@Param("otId", UUID) otId: string, @Req() req: any) {
    return this.svc.hcpActa(otId, req);
  }

  @Get("ot/:otId/hcp/acta")
  @RequierePermiso("resultado.ver")
  async hcpActaHtml(@Param("otId", UUID) otId: string, @Req() req: any, @Res() res: any) {
    const html = await this.svc.hcpActaHtml(otId, req);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.send(html);
  }

  /* ------------------------------------------------ AQL (IVC) --- */

  @Get("ot/:otId/aql")
  @RequierePermiso("resultado.ver")
  aqlVer(@Param("otId", UUID) otId: string, @Req() req: any) {
    return this.svc.aqlVer(otId, req);
  }

  @Put("ot/:otId/aql")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Evaluar AQL → informe (inspección por atributos, EP-03 3.7)" })
  aqlGuardar(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.svc.aqlGuardar(otId, body ?? {}, req);
  }

  /* ------------------------------------------ LMB · microbiología (R3) --- */

  @Get("resultado/:resultadoId/micro")
  @RequierePermiso("resultado.ver")
  microVer(@Param("resultadoId", UUID) id: string, @Req() req: any) {
    return this.ms.microVer(id, req);
  }

  @Put("resultado/:resultadoId/micro")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Siembra, incubación y lecturas programadas; resultado UFC/g o NMP y plan n, c, m, M (EP-02 3.3–3.5)" })
  microGuardar(@Param("resultadoId", UUID) id: string, @Body() body: any, @Req() req: any) {
    return this.ms.microGuardar(id, body ?? {}, req);
  }

  /* ------------------------------------------ LES · panel sensorial (R3) --- */

  @Get("resultado/:resultadoId/sensorial")
  @RequierePermiso("resultado.ver")
  sensorialVer(@Param("resultadoId", UUID) id: string, @Req() req: any) {
    return this.ms.sensorialVer(id, req);
  }

  @Put("resultado/:resultadoId/sensorial")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Plan de sesión, cartillas por juez y consolidación del panel (EP-02 3.6–3.8)" })
  sensorialGuardar(@Param("resultadoId", UUID) id: string, @Body() body: any, @Req() req: any) {
    return this.ms.sensorialGuardar(id, body ?? {}, req);
  }

  /* ---------------------------------- preparación de muestras (T29) --- */

  @Get("ot/:otId/preparacion")
  @RequierePermiso("resultado.ver")
  muestrasVer(@Param("otId", UUID) otId: string, @Req() req: any) {
    return this.prep.muestrasVer(otId, req);
  }

  @Put("ot/:otId/preparacion/:muestraId")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "Registrar preparación → análisis (campos del laboratorio; bloqueos de captura)" })
  muestraGuardar(@Param("otId", UUID) otId: string, @Param("muestraId", UUID) muestraId: string, @Body() body: any, @Req() req: any) {
    return this.prep.muestraGuardar(otId, muestraId, body ?? {}, req);
  }

  /* ----------------------------------- preparación del trabajo DSA (T26) --- */

  @Get("ot/:otId/trabajo")
  @RequierePermiso("ot.ver")
  trabajoVer(@Param("otId", UUID) otId: string, @Req() req: any) {
    return this.prep.trabajoVer(otId, req);
  }

  @Put("ot/:otId/trabajo/comision")
  @RequierePermiso("ot.asignar")
  @ApiOperation({ summary: "Asignar → preparar documentación: Jefe de Comisión, inspectores y equipos reservados (EP-05 2.1)" })
  trabajoComision(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.prep.trabajoComision(otId, body ?? {}, req);
  }

  @Put("ot/:otId/trabajo")
  @ApiOperation({ summary: "Guardar la documentación del trabajo (EP-05 2.2)" })
  trabajoGuardar(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    exigirAlguno(req, ["resultado.crear", "ot.asignar"]);
    return this.prep.trabajoDocumentacion(otId, body ?? {}, req, false);
  }

  @Post("ot/:otId/trabajo/enviar")
  @ApiOperation({ summary: "Enviar a aprobación → Jefe (EP-05 2.2)" })
  trabajoEnviar(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    exigirAlguno(req, ["resultado.crear", "ot.asignar"]);
    return this.prep.trabajoDocumentacion(otId, body ?? {}, req, true);
  }

  @Post("ot/:otId/trabajo/validar")
  @RequierePermiso("ot.preparacion.aprobar")
  trabajoValidar(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.prep.trabajoDecidir(otId, "validar", body ?? {}, req);
  }

  @Post("ot/:otId/trabajo/aprobar")
  @RequierePermiso("ot.preparacion.aprobar")
  @ApiOperation({ summary: "Aprobar → ejecutar (EP-05 2.3)" })
  trabajoAprobar(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.prep.trabajoDecidir(otId, "aprobar", body ?? {}, req);
  }

  @Post("ot/:otId/trabajo/devolver")
  @RequierePermiso("ot.preparacion.aprobar")
  @ApiOperation({ summary: "Devolver con comentario (vuelve a 2.2)" })
  trabajoDevolver(@Param("otId", UUID) otId: string, @Body() body: any, @Req() req: any) {
    return this.prep.trabajoDecidir(otId, "devolver", body ?? {}, req);
  }

  @Post("ot/:otId/trabajo/adjuntos")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_ADJUNTO_BYTES, files: 1, fields: 5 } }))
  adjuntoSubir(@Param("otId", UUID) otId: string, @UploadedFile() archivo: any, @Req() req: any) {
    exigirAlguno(req, ["resultado.crear", "ot.asignar"]);
    return this.prep.adjuntoSubir(otId, archivo, req);
  }

  @Get("adjuntos/:id")
  @RequierePermiso("ot.ver")
  async adjuntoDescargar(@Param("id", UUID) id: string, @Req() req: any, @Res() res: any) {
    const a = await this.prep.adjuntoDescargar(id, req);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(a.datos);
  }

  @Delete("adjuntos/:id")
  adjuntoQuitar(@Param("id", UUID) id: string, @Req() req: any) {
    exigirAlguno(req, ["resultado.crear", "ot.asignar"]);
    return this.prep.adjuntoQuitar(id, req);
  }

  /** «Pendiente de tu aprobación» (Mi bandeja). */
  @Get("pendientes-aprobacion")
  pendientes(@Req() req: any) {
    return this.prep.pendientesAprobacion(req);
  }
}

@Module({
  imports: [FlujoRealModule, PlantillaRenderModule],
  controllers: [FormulariosController],
  providers: [FormulariosDatos, FormulariosService, PreparacionService, MicroSensorialService],
})
export class FormulariosModule {}
