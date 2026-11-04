import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthModule } from "../auth/auth.module";
import { PermisoGuard } from "../auth/permiso.guard";
import { Public } from "../auth/public.decorator";
import { RequierePermiso } from "../auth/permisos.decorator";
import { FlujoRealModule } from "../flujo-real/flujo-real.module";
import { InstrumentosService, MAX_ARCHIVO_BYTES } from "./instrumentos.service";

// ===========================================================================
// Adquisición de datos desde instrumentos (contrato §4.4.6, §4.4.7): perfiles
// de lectura por instrumento, carga de archivos con vista previa, aplicación a
// los ensayos de la OT, historial con el archivo original y lectura automática
// de carpetas (instrumentos.service.ts). Comunicación serie (RS-232) y
// Ethernet: alta y revocación de dispositivos aquí; las lecturas del agente
// entran por AgenteInstrumentosController (token de dispositivo, no de usuario).
// ===========================================================================

const UUID = new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 400 });
const SUBIDA = FileInterceptor("archivo", { limits: { fileSize: MAX_ARCHIVO_BYTES, files: 1, fields: 6 } });

@ApiTags("instrumentos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("instrumentos")
export class InstrumentosController {
  constructor(private readonly s: InstrumentosService) {}

  /**
   * Perfiles: los ve quien importa o quien configura (Calidad configura sin
   * capturar). Sin @RequierePermiso: el servicio exige uno de los dos y filtra
   * por la unión de sus alcances.
   */
  @Get("perfiles")
  perfiles(@Req() req: any) {
    return this.s.listarPerfiles(req);
  }

  /** Laboratorios, equipos y usuarios para el formulario de perfil. */
  @Get("perfiles/opciones")
  @RequierePermiso("instrumento.configurar")
  opciones(@Req() req: any) {
    return this.s.opcionesPerfil(req);
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
  historial(@Query("perfilId") perfilId: string | undefined, @Query("pendientes") pendientes: string | undefined, @Req() req: any) {
    return this.s.historial(req, perfilId, pendientes === "1" || pendientes === "true");
  }

  /* --- dispositivos conectados por puerto serie o Ethernet (§4.4.7) --- */

  @Get("dispositivos")
  @RequierePermiso("instrumento.configurar")
  dispositivos(@Req() req: any) {
    return this.s.listarDispositivos(req);
  }

  /** Alta: la respuesta trae el token, que no vuelve a mostrarse. */
  @Post("dispositivos")
  @RequierePermiso("instrumento.configurar")
  crearDispositivo(@Body() b: any, @Req() req: any) {
    return this.s.crearDispositivo(req, b);
  }

  @Post("dispositivos/:id/revocar")
  @RequierePermiso("instrumento.configurar")
  revocarDispositivo(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.s.revocarDispositivo(req, id, b);
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

/**
 * Entrada del agente de instrumentos (tools/agente-instrumentos). @Public para
 * el JWT: se autentica con el token del dispositivo (Authorization: Bearer
 * lims_disp_…), que el servicio verifica en cada petición. El límite de
 * peticiones va por IP (el token no es un JWT).
 */
@ApiTags("instrumentos")
@Public()
@Controller("instrumentos/agente")
export class AgenteInstrumentosController {
  constructor(private readonly s: InstrumentosService) {}

  /** Saludo del agente al arrancar: confirma el token y entrega el perfil del instrumento. */
  @Get("yo")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async yo(@Req() req: any) {
    return this.s.infoDispositivo(await this.s.autenticarDispositivo(req));
  }

  /** Lote de tramas leídas del puerto serie o del socket TCP. */
  @Post("lecturas")
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async lecturas(@Body() b: any, @Req() req: any) {
    const d = await this.s.autenticarDispositivo(req);
    // Para la bitácora (AuditInterceptor): el tenant y quién envió, sin usuario.
    req.user = { tenantId: d.tenant_id, username: `dispositivo: ${d.nombre}` };
    return this.s.ingestar(d, b);
  }
}

@Module({
  imports: [FlujoRealModule, AuthModule],
  controllers: [AgenteInstrumentosController, InstrumentosController],
  providers: [InstrumentosService],
})
export class InstrumentosModule {}
