/**
 * Firma Electrónica Avanzada (FEA) del Estado en el PDF final · API
 * (docs/FLUJO_FEA_DOCUMENTOS.md). Sin conexión a FirmaGob: el PDF se firma
 * fuera del LIMS y se sube aquí.
 *
 *   GET  /fea/pendientes?todos=1&soloExigidos=1   documentos emitidos sin versión FEA (del firmante; todos=1 jefatura)
 *   GET  /fea/:origen/:id                         estado FEA de la ficha (origen: informe | metrologia)
 *   GET  /fea/:origen/:id/original                PDF emitido para firmar (congelado: siempre los mismos bytes)
 *   GET  /fea/:origen/:id/firmado                 versión firmada vigente
 *   POST /fea/:origen/:id/firmado                 sube el PDF firmado (multipart «archivo», «motivoExcepcion» opcional)
 *
 * Sin @RequierePermiso: la autorización es del documento (firmante, alcance
 * por laboratorio y documento.fea.gestionar para las jefaturas), en el servicio.
 */
import { BadRequestException, Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PermisoGuard } from "../auth/permiso.guard";
import { PlantillaRenderModule } from "../plantilla-render/plantilla-render.module";
import { FeaService } from "./fea.service";
import { MAX_BYTES_FEA, ORIGENES_FEA, type OrigenFea } from "./fea.reglas";

function origenDe(o: string): OrigenFea {
  if (!(ORIGENES_FEA as readonly string[]).includes(o)) throw new BadRequestException("Tipo de documento no válido: use «informe» o «metrologia».");
  return o as OrigenFea;
}

function enviarPdf(res: Response, buffer: Buffer, nombre: string) {
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${nombre}"`,
    "Content-Length": String(buffer.length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buffer);
}

@ApiTags("fea")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("fea")
export class FeaController {
  constructor(private readonly svc: FeaService) {}

  @Get("pendientes")
  @ApiOperation({ summary: "Documentos emitidos pendientes de firma FEA (del firmante; todos=1 para la jefatura con permiso)" })
  pendientes(@Req() req: any, @Query("todos") todos?: string, @Query("soloExigidos") soloExigidos?: string) {
    return this.svc.pendientes(req, { todos: todos === "1" || todos === "true", soloExigidos: soloExigidos === "1" || soloExigidos === "true" });
  }

  @Get(":origen/:id")
  @ApiOperation({ summary: "Estado FEA del documento: PDF emitido congelado, versión firmada, historial y qué puede hacer el usuario" })
  estado(@Param("origen") origen: string, @Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.estado(origenDe(origen), id, req);
  }

  @Get(":origen/:id/original")
  @ApiOperation({ summary: "PDF emitido para firmar con FEA (los mismos bytes en cada descarga)" })
  async original(@Param("origen") origen: string, @Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const { buffer, nombre } = await this.svc.original(origenDe(origen), id, req);
    enviarPdf(res, buffer, nombre);
  }

  @Get(":origen/:id/firmado")
  @ApiOperation({ summary: "Versión firmada con FEA vigente" })
  async firmado(@Param("origen") origen: string, @Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const { buffer, nombre } = await this.svc.firmado(origenDe(origen), id, req);
    enviarPdf(res, buffer, nombre);
  }

  @Post(":origen/:id/firmado")
  @ApiOperation({ summary: "Sube la versión firmada con FEA (multipart: archivo; motivoExcepcion solo jefatura si no corresponde)" })
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_BYTES_FEA, files: 1, fields: 2 } }))
  subir(
    @Param("origen") origen: string,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() archivo: { buffer: Buffer; originalname?: string } | undefined,
    @Body() body: { motivoExcepcion?: string },
    @Req() req: any,
  ) {
    const motivo = typeof body?.motivoExcepcion === "string" ? body.motivoExcepcion.slice(0, 1000) : null;
    return this.svc.subir(origenDe(origen), id, archivo, motivo, req);
  }
}

@Module({
  imports: [PlantillaRenderModule],
  controllers: [FeaController],
  providers: [FeaService],
})
export class FeaModule {}
