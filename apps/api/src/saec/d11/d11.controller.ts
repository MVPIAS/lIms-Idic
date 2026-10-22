import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { D11Service, type ArchivoSubido } from "./d11.service";
import { MAX_BYTES_ARCHIVO } from "../../common/tabla-archivo";

const SUBIDA = FileInterceptor("archivo", { limits: { fileSize: MAX_BYTES_ARCHIVO, files: 1, fields: 2 } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delegación Nº 11 · Certificación de armas internadas (EP-11, camino A) ·
 * /d11. Compartimento propio (11.41): solo la D11, la jefatura del BPCH y los
 * perfiles globales admitidos por el ámbito D11 (Dirección, Subdirección y
 * Lector/Auditor, este en solo lectura porque solo tiene arma.ver).
 * Contrato: docs/FLUJO_D11_ARMAS.md.
 */
@ApiTags("d11-armas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("D11")
@Controller("d11")
export class D11Controller {
  constructor(private readonly svc: D11Service) {}

  @Get("ot")
  @RequierePermiso("arma.ver")
  @ApiOperation({ summary: "OT de armas de la Delegación Nº 11" })
  listar(@Req() req: any) {
    return this.svc.listar(req);
  }

  @Get("ot/:otId")
  @RequierePermiso("arma.ver")
  @ApiOperation({ summary: "Expediente D11 de la OT: pasos, armas, verificación, certificados y entregas" })
  expediente(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.expediente(req, otId);
  }

  @Put("ot/:otId/programacion")
  @RequierePermiso("arma.programar")
  @ApiOperation({ summary: "11.4 · Programar la recepción con el importador { fecha, lugar, responsableId }" })
  programar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.programar(req, otId, body);
  }

  @Put("ot/:otId/llegada")
  @RequierePermiso("arma.registrar")
  @ApiOperation({ summary: "11.5 · Aviso de llegada { fecha, transportista, bultos, avisoPrevio }" })
  llegada(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.llegada(req, otId, body);
  }

  @Post("ot/:otId/acta")
  @RequierePermiso("arma.registrar")
  @ApiOperation({ summary: "11.6 · Firmar el acta de recepción e inventario { bultos, cantidad, ubicacion, responsableId }" })
  acta(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.acta(req, otId, body);
  }

  @Post("planilla")
  @RequierePermiso("arma.registrar")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(SUBIDA)
  @ApiOperation({ summary: "Carga masiva: lee la planilla del importador (.xlsx o .csv, campo «archivo») y propone el catálogo" })
  planilla(@UploadedFile() archivo: ArchivoSubido | undefined, @Req() req: any) {
    return this.svc.leerPlanilla(req, archivo);
  }

  @Post("ot/:otId/armas")
  @RequierePermiso("arma.registrar")
  @ApiOperation({ summary: "11.8 · Registrar armas como muestras de la OT (y su entrada en custodia)" })
  registrar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrarArmas(req, otId, body);
  }

  @Post("ot/:otId/clasificacion")
  @RequierePermiso("arma.registrar")
  @ApiOperation({ summary: "11.11 / 11.12 · Clasificar (IT05) y elegir el camino; carga los ensayos del camino" })
  clasificar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.clasificar(req, otId, body);
  }

  @Get("armas/:id")
  @RequierePermiso("arma.ver")
  @ApiOperation({ summary: "Ficha del arma en la OT: ensayos (con su forma de captura) y custodia" })
  ficha(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.fichaArmaOt(req, id);
  }

  @Post("armas/:id/ensayos")
  @RequierePermiso("arma.registrar", "resultado.crear")
  @ApiOperation({ summary: "11.15 / 11.20 · Captura explícita de los ensayos del arma (sin valores por defecto)" })
  ensayos(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrarEnsayos(req, id, body);
  }

  @Post("armas/:id/movimientos")
  @RequierePermiso("arma.registrar")
  @ApiOperation({ summary: "11.7 · Cambio de ubicación en bodega (movimiento de custodia inmutable)" })
  movimiento(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.movimiento(req, id, body);
  }

  @Post("ot/:otId/acunacion")
  @RequierePermiso("arma.registrar")
  @ApiOperation({ summary: "11.22 · Acuñación BPCH (IT08) de las armas que cumplen { items: [{ armaOtId, numero, anio }] }" })
  acunar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.acunar(req, otId, body);
  }

  @Post("ot/:otId/certificados/condiciones")
  @RequierePermiso("certificado.emitir")
  @ApiOperation({ summary: "Qué falta para certificar cada arma" })
  condiciones(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.condicionesCertificados(req, otId, body);
  }

  @Post("ot/:otId/certificados")
  @RequierePermiso("certificado.emitir")
  @ApiOperation({ summary: "11.23 · Emitir en bloque los certificados por arma (rango de numeración) → firma" })
  certificados(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.emitirCertificados(req, otId, body);
  }

  /** Sin @RequierePermiso de firma: autoriza la matriz (solo el responsable del paso actual firma). */
  @Post("emisiones/:id/firmar")
  @RequierePermiso("arma.ver")
  @ApiOperation({ summary: "Firmar todos los certificados en firma de un rango (según la matriz de firmas)" })
  firmarRango(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.firmarEmision(req, id);
  }

  @Get("ot/:otId/etiquetas")
  @RequierePermiso("arma.ver")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "11.7 · Etiquetas con código de barras de las armas (?ids=uuid,uuid)" })
  etiquetas(@Param("otId", ParseUUIDPipe) otId: string, @Query("ids") ids: string | undefined, @Req() req: any) {
    const lista = (ids ?? "").split(",").map((x) => x.trim()).filter((x) => UUID.test(x));
    return this.svc.etiquetas(req, otId, lista);
  }

  @Post("ot/:otId/entrega")
  @RequierePermiso("arma.registrar")
  @ApiOperation({ summary: "11.27 · Registrar la entrega de armas por código de barras (guía + salida de custodia)" })
  entrega(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.entregar(req, otId, body);
  }

  @Get("entregas/:id/guia")
  @RequierePermiso("arma.ver")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Guía de entrega de armas (imprimible)" })
  guia(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.guiaEntrega(req, id);
  }

  @Get("catalogos")
  @RequierePermiso("arma.ver")
  @ApiOperation({ summary: "Catálogos del arma: marcas (con país), modelos y calibres" })
  catalogos(@Req() req: any) {
    return this.svc.catalogos(req);
  }

  @Post("catalogos/marcas")
  @RequierePermiso("arma.registrar")
  crearMarca(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearMarca(req, body);
  }

  @Post("catalogos/modelos")
  @RequierePermiso("arma.registrar")
  crearModelo(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearModelo(req, body);
  }

  @Post("catalogos/calibres")
  @RequierePermiso("arma.registrar")
  crearCalibre(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearCalibre(req, body);
  }

  @Patch("catalogos/marcas/:id")
  @RequierePermiso("arma.catalogo")
  editarMarca(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarCatalogo(req, "marca", id, body);
  }

  @Patch("catalogos/modelos/:id")
  @RequierePermiso("arma.catalogo")
  editarModelo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarCatalogo(req, "modelo", id, body);
  }

  @Patch("catalogos/calibres/:id")
  @RequierePermiso("arma.catalogo")
  editarCalibre(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarCatalogo(req, "calibre", id, body);
  }
}

/**
 * Planilla del listado de armas de la resolución (EP-11 11.1): la lee quien
 * registra la internación (Comercial, SCC), que no entra al compartimento D11.
 */
@ApiTags("d11-armas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("bpch/resolucion-armas")
export class ResolucionArmasController {
  constructor(private readonly svc: D11Service) {}

  @Post("leer")
  @RequierePermiso("bpch.internacion.registrar")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(SUBIDA)
  @ApiOperation({ summary: "Lee la planilla del listado de armas (.xlsx o .csv, campo «archivo») para la resolución" })
  leer(@UploadedFile() archivo: ArchivoSubido | undefined, @Req() req: any) {
    return this.svc.leerPlanilla(req, archivo);
  }
}
