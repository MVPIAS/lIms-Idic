import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthModule } from "../auth/auth.module";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { FlujoRealModule } from "../flujo-real/flujo-real.module";
import { InstrumentosService, MAX_ARCHIVO_BYTES } from "./instrumentos.service";

// ===========================================================================
// Adquisición de datos desde instrumentos (contrato §4.4.6, §4.4.7): perfiles
// de lectura por instrumento, carga de archivos con vista previa, aplicación a
// los ensayos de la OT, historial con el archivo original y lectura automática
// de carpetas (instrumentos.service.ts).
// ===========================================================================

const UUID = new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 400 });
const SUBIDA = FileInterceptor("archivo", { limits: { fileSize: MAX_ARCHIVO_BYTES, files: 1, fields: 6 } });

@ApiTags("instrumentos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("instrumentos")
export class InstrumentosController {
  constructor(private readonly s: InstrumentosService) {}

  @Get("perfiles")
  @RequierePermiso("instrumento.importar")
  perfiles(@Req() req: any) {
    return this.s.listarPerfiles(req);
  }

  @Post("perfiles")
  @RequierePermiso("instrumento.configurar")
  crearPerfil(@Body() b: any, @Req() req: any) {
    return this.s.crearPerfil(req, b);
  }

  @Patch("perfiles/:id")
  @RequierePermiso("instrumento.configurar")
  editarPerfil(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.s.editarPerfil(req, id, b);
  }

  @Delete("perfiles/:id")
  @RequierePermiso("instrumento.configurar")
  borrarPerfil(@Param("id", UUID) id: string, @Req() req: any) {
    return this.s.borrarPerfil(req, id);
  }

  /** Lectura automática: una pasada inmediata por las carpetas de los perfiles. */
  @Post("carpetas/revisar")
  @RequierePermiso("instrumento.configurar")
  revisar() {
    return this.s.revisarCarpetas();
  }

  /** Carga el archivo y devuelve la vista previa fila a fila (no captura nada). */
  @Post("importaciones")
  @RequierePermiso("instrumento.importar", "resultado.crear")
  @UseInterceptors(SUBIDA)
  vistaPrevia(@Body() b: any, @UploadedFile() archivo: any, @Req() req: any) {
    return this.s.vistaPrevia(req, b, archivo);
  }

  @Get("importaciones")
  @RequierePermiso("instrumento.importar")
  historial(@Query("perfilId") perfilId: string | undefined, @Req() req: any) {
    return this.s.historial(req, perfilId);
  }

  @Get("importaciones/:id")
  @RequierePermiso("instrumento.importar")
  detalle(@Param("id", UUID) id: string, @Req() req: any) {
    return this.s.detalle(req, id);
  }

  @Post("importaciones/:id/aplicar")
  @RequierePermiso("instrumento.importar", "resultado.crear")
  aplicar(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.s.aplicar(req, id, b ?? {});
  }

  @Post("importaciones/:id/descartar")
  @RequierePermiso("instrumento.importar")
  descartar(@Param("id", UUID) id: string, @Req() req: any) {
    return this.s.descartar(req, id);
  }

  /** Archivo tal como llegó del instrumento (dato bruto). */
  @Get("importaciones/:id/original")
  @RequierePermiso("instrumento.importar")
  async original(@Param("id", UUID) id: string, @Req() req: any, @Res() res: any) {
    const a = await this.s.original(req, id);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.send(a.datos);
  }
}

@Module({
  imports: [FlujoRealModule, AuthModule],
  controllers: [InstrumentosController],
  providers: [InstrumentosService],
})
export class InstrumentosModule {}
