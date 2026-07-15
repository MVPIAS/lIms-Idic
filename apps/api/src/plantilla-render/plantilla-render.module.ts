import {
  Body,
  Controller,
  Get,
  Header,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PlantillaRenderService } from "./plantilla-render.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { Public } from "../auth/public.decorator";

const PreviewSchema = z.object({ otId: z.string().uuid(), plantillaId: z.string().uuid() });
/**
 * `codigo` YA NO se acepta: el correlativo lo genera el sistema
 * (`PlantillaRenderService.siguienteNumero`, RF F02.1). Antes lo aportaba el
 * llamador de la API, que podía numerar a mano y colisionar.
 */
const EmitirSchema = PreviewSchema;

@ApiTags("informes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("informes")
export class PlantillaRenderController {
  constructor(private readonly svc: PlantillaRenderService) {}

  /** Contexto de datos de una OT (para el autorelleno). Solo lee datos de la OT. */
  @Post("contexto/:otId")
  @RequierePermiso("plantilla.ver")
  contexto(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.contexto(otId, req?.user?.tenantId);
  }

  /**
   * Previsualiza el informe relleno (HTML + HASH), sin emitir.
   * Exige `certificado.emitir`: era la brecha verificada (un LECTOR obtenía 201).
   */
  @Post("previsualizar")
  @RequierePermiso("certificado.emitir")
  previsualizar(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId } = PreviewSchema.parse(body);
    return this.svc.previsualizar(otId, plantillaId, req?.user?.tenantId);
  }

  /** Emite el informe/certificado: rellena, sella con HASH, numera y registra Certificado. */
  @Post("emitir")
  @RequierePermiso("certificado.emitir")
  emitir(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId } = EmitirSchema.parse(body);
    // El Certificado se crea con el tenant del usuario autenticado (no DEV_TENANT).
    return this.svc.emitir(otId, plantillaId, req?.user?.tenantId, req?.user?.sub ?? req?.user?.id);
  }

  /**
   * PDF del certificado emitido. Se regenera desde el HTML sellado en la BD, así
   * que descargarlo dos veces da byte a byte el mismo documento.
   *
   * `plantilla.ver` (no `certificado.emitir`): descargar un informe ya emitido es
   * una LECTURA; quien consulta el expediente no tiene por qué poder emitir.
   */
  @Get(":certificadoId/pdf")
  @RequierePermiso("plantilla.ver")
  async pdf(
    @Param("certificadoId", ParseUUIDPipe) certificadoId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const { buffer, nombre } = await this.svc.pdf(certificadoId, req?.user?.tenantId);
    res.set({
      "Content-Type": "application/pdf",
      // `inline`: el navegador lo abre en su visor y el usuario decide si guarda.
      // `nombre` va saneado a [A-Za-z0-9._-] en el servicio, así que no puede
      // inyectar comillas ni CRLF en la cabecera.
      "Content-Disposition": `inline; filename="${nombre}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(buffer);
  }

  /**
   * Mismo documento en HTML imprimible (`@media print` A4). Alternativa al PDF
   * para quien prefiera imprimir desde el navegador.
   */
  @Get(":certificadoId/html")
  @RequierePermiso("plantilla.ver")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "private, no-store")
  html(@Param("certificadoId", ParseUUIDPipe) certificadoId: string, @Req() req: any) {
    return this.svc.html(certificadoId, req?.user?.tenantId);
  }
}

/**
 * Verificación anti-repudio de un certificado impreso.
 *
 * Controller SEPARADO a propósito: la clase de arriba lleva
 * `@UseGuards(AuthGuard('jwt'), PermisoGuard)` a nivel de clase, y esos guards
 * de controlador NO miran @Public(). Colgar aquí la ruta pública evitaría el
 * 401 solo por accidente de orden; en una clase propia queda explícito que esta
 * ruta no pasa por ellos.
 *
 * Es `@Public()` porque quien recibe un certificado en papel (una fiscalía, un
 * cliente, una aduana) no tiene usuario en el LIMS. Los guards globales
 * (JwtAuthGuard y PermisoGuard) sí respetan @Public y la dejan pasar; el
 * ThrottlerGuard global sigue aplicando y limita el ritmo de intentos, que es
 * justo lo que se quiere en un endpoint anónimo consultable por código.
 *
 * NO devuelve datos sensibles: solo lo que ya está impreso en el papel que
 * tiene delante quien verifica (número, fecha, código de OT y hash). Sin
 * cliente, sin RUT, sin resultados, sin ids internos.
 */
@ApiTags("informes")
@Controller("informes")
export class VerificacionController {
  constructor(private readonly svc: PlantillaRenderService) {}

  @Get("verificar/:codigo")
  @Public()
  verificar(@Param("codigo") codigo: string) {
    // Sin ParseUUIDPipe: el código es corto (Crockford base32), no un UUID. El
    // servicio valida el formato y Prisma parametriza la consulta (sin interpolar).
    return this.svc.verificar(codigo);
  }
}

@Module({
  controllers: [PlantillaRenderController, VerificacionController],
  providers: [PlantillaRenderService],
})
export class PlantillaRenderModule {}
