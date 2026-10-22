import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { MAX_BYTES_ADJUNTO, cabecerasAdjunto, type ArchivoAdjunto } from "../../common/adjuntos";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { DEV_TENANT } from "../../common/base-crud.service";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { PrototiposService } from "./prototipos.service";
import { ProduccionNacionalService } from "../produccion-nacional/produccion-nacional.service";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";

const tenant = (req: any) => req?.user?.tenantId ?? DEV_TENANT;
const usuario = (req: any): string | null => req?.user?.sub ?? null;

@ApiTags("bpch · prototipos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH")
@Controller("bpch/prototipos")
export class PrototiposController {
  constructor(
    private readonly svc: PrototiposService,
    private readonly pn: ProduccionNacionalService,
    private readonly comun: OtDesdeProcesoService,
  ) {}

  /**
   * Alcance por unidad (frente L · C8): las sucursales y la Delegación Nº 11
   * ven y gestionan solo los prototipos de su unidad (la de su OT); la Sección
   * Certificación de la Conformidad y la jefatura del BPCH, todos. Se aplica al
   * listado, al detalle y a todas las escrituras.
   */
  private async exigir(req: any, id: string) {
    await this.comun.exigirExpediente(req, await this.svc.unidadDe(tenant(req), id), "el prototipo");
  }

  @Get()
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "Prototipos (?q=&estado=)" })
  async listar(@Query("q") q: string, @Query("estado") estado: string, @Req() req: any) {
    return this.svc.listar(tenant(req), { q, estado }, await this.comun.filtroExpedientes(req));
  }

  @Get("codificado")
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "8.8 · ¿Está codificado? (?elemento=): coincidencias en la Codificación Única y en el catálogo" })
  codificado(@Query("elemento") elemento: string, @Req() req: any) {
    return this.svc.codificado(tenant(req), elemento);
  }

  @Post(":id/adjuntos")
  @RequierePermiso("bpch.prototipo.gestionar")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_BYTES_ADJUNTO, files: 1, fields: 2 } }))
  @ApiOperation({ summary: "Ficha técnica u hoja de datos de seguridad · multipart: archivo + clase=ficha_tecnica|hoja_seguridad" })
  async adjuntar(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() archivo: ArchivoAdjunto | undefined, @Body() body: any, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.adjuntar(tenant(req), id, usuario(req), String(body?.clase ?? ""), archivo);
  }

  @Put(":id/parametros")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "8.11 · Panel del elemento (método, ensayo, Mín/Nom/Máx, unidad, fórmula)" })
  async guardarParametros(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.guardarParametros(tenant(req), usuario(req), id, body);
  }

  @Post(":id/parametros/enviar")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "8.11 · Enviar la parametrización a validación" })
  async enviarParametros(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.enviarParametros(tenant(req), usuario(req), id);
  }

  @Post(":id/parametros/validar")
  @RequierePermiso("bpch.prototipo.dictaminar")
  @ApiOperation({ summary: "8.11 · Validar la parametrización → ensayar (no quien la preparó)" })
  async validarParametros(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.validarParametros(tenant(req), usuario(req), id);
  }

  @Post(":id/parametros/devolver")
  @RequierePermiso("bpch.prototipo.dictaminar")
  async devolverParametros(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.devolverParametros(tenant(req), usuario(req), id, body);
  }

  @Post(":id/parametros/aplicar")
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "8.11 · Aplicar el panel validado como especificación de la OT (jefatura de la unidad de la OT)" })
  async aplicarParametros(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.aplicarParametros(req, tenant(req), id);
  }

  @Get(":id/adjuntos/:adjuntoId")
  @RequierePermiso("bpch.prototipo.ver")
  async adjunto(@Param("id", ParseUUIDPipe) id: string, @Param("adjuntoId", ParseUUIDPipe) adjuntoId: string, @Req() req: any, @Res() res: Response) {
    await this.exigir(req, id);
    const a = await this.svc.adjunto(tenant(req), id, adjuntoId);
    res.set(cabecerasAdjunto(a));
    res.end(a.datos);
  }

  @Get(":id")
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "Prototipo con su evaluación, dictamen, documento y lo que falta en cada paso" })
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.detalle(tenant(req), id);
  }

  @Post()
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Ingreso del prototipo (elemento nuevo, antecedentes técnicos, solicitud DGMN)" })
  async crear(@Body() body: unknown, @Req() req: any) {
    // Un prototipo nace sin unidad (se elige al generar la OT): lo ingresan quienes ven todos.
    if ((await this.comun.filtroExpedientes(req)) !== null)
      throw new ForbiddenException(
        "Fuera de su alcance: el ingreso de prototipos lo hacen la Sección Certificación de la Conformidad y la jefatura del BPCH.",
      );
    return this.svc.crear(tenant(req), usuario(req), body);
  }

  @Post("fabricantes")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Alta del fabricante del prototipo (se registra como cliente; mismas reglas que en Producción Nacional)" })
  crearFabricante(@Body() body: unknown, @Req() req: any) {
    return this.pn.crearFabricante(tenant(req), body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.prototipo.gestionar")
  async editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.editar(tenant(req), id, body);
  }

  @Post(":id/pronunciamiento-sac")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Pronunciamiento de la SAC sobre el tamaño de muestra (SAC-PG01-IT10)" })
  async pronunciamiento(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.pronunciamientoSac(tenant(req), id, body);
  }

  @Post(":id/generar-ot")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Generar la OT del prototipo (origen Prototipo; sigue el flujo general)" })
  async generarOt(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.generarOt(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/dictamen")
  @RequierePermiso("bpch.prototipo.dictaminar")
  @ApiOperation({ summary: "Dictaminar (aprobado / rechazado) y emitir el documento al circuito de firmas" })
  async dictaminar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.dictaminar(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/codigo-cnc")
  @RequierePermiso("bpch.prototipo.dictaminar")
  @ApiOperation({ summary: "Registrar el código único CNC-DGMN del tipo aprobado" })
  async codigo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.registrarCodigo(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/anular")
  @RequierePermiso("bpch.prototipo.gestionar")
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.anular(tenant(req), usuario(req), id, body);
  }
}
