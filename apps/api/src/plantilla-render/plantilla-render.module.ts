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
import { QcModule } from "../qc/qc.module";
import { RbacModule } from "../rbac/rbac.module";
import { ConfiguracionModule } from "../configuracion/configuracion.module";
import { AlcanceService } from "../rbac/alcance.service";
import { TIPOS_DOCUMENTO } from "../rbac/rbac.constants";
import { FirmaDocumentoController } from "./firma-documento.controller";
import { FirmaDocumentoService } from "./firma-documento.service";
import { FirmasImagenController } from "../rbac/firmas-imagen.controller";
import { InformeDatosController, InformeDatosService } from "./informe-datos.controller";
import { NumeracionController, NumeracionService } from "./numeracion.service";

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
/** Portada del IVC: lo que la OT no sabe y se indica al emitir. */
const PortadaSchema = z
  .object({
    proposito: texto(300),
    opiOc: texto(80),
    fechaOpi: texto(40),
    contrato: texto(120),
    fechaContrato: texto(40),
    proyecto: texto(200),
    proveedor: texto(200),
    item: texto(240),
    cantidad: texto(60),
    fabricante: texto(200),
    paisOrigen: texto(80),
  })
  .strict();
/** Datos propios del documento (certificado.datos_informe). */
const DatosInformeSchema = z.object({ conclusion: texto(4000), portada: PortadaSchema.nullable().optional() }).strict();
const OtPlantilla = z.object({ otId: z.string().uuid(), plantillaId: z.string().uuid() });
const PreviewSchema = OtPlantilla.extend({
  /** cumplimiento (con requisito y veredicto) | solo_resultados. Sin valor: el sugerido. */
  modalidad: z.enum(["cumplimiento", "solo_resultados"]).optional(),
  datosInforme: DatosInformeSchema.optional(),
});
/**
 * `codigo` YA NO se acepta: el correlativo lo genera el sistema
 * (`PlantillaRenderService.siguienteNumero`, RF F02.1). Antes lo aportaba el
 * llamador de la API, que podía numerar a mano y colisionar.
 * `tipoDocumento` (opcional): tipo de la matriz de firmas si no es el que
 * corresponde por defecto a la plantilla (p. ej. CERTIFICADO_CALIBRACION).
 */
const EmitirSchema = PreviewSchema.extend({ tipoDocumento: z.enum(TIPOS_DOCUMENTO).optional() });

@ApiTags("informes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("informes")
export class PlantillaRenderController {
  constructor(
    private readonly svc: PlantillaRenderService,
    private readonly alcance: AlcanceService,
  ) {}

  /**
   * Abrir un documento (PDF o HTML) exige el mismo alcance que verlo en el listado:
   * la unidad del documento (o la del laboratorio de su OT) dentro del alcance del
   * usuario. Dirección y quien tiene alcance global lo ven todo; quien es
   * responsable de un paso de su firma también (como en el circuito). La
   * verificación pública por código no pasa por aquí.
   */
  private async exigirAlcanceDocumento(certificadoId: string, req: any) {
    const d = await this.svc.alcanceDocumento(certificadoId, req?.user?.tenantId);
    if (req?.user?.sub && d.responsables.includes(req.user.sub)) return;
    await this.alcance.exigirUnidad(req, d.unidadId, `el documento ${d.etiqueta}`);
  }

  /** La OT debe estar dentro del alcance por laboratorio de quien emite. */
  private async exigirAlcanceOt(otId: string, req: any) {
    const ctx = await this.svc.contexto(otId, req?.user?.tenantId);
    await this.alcance.exigirUnidad(req, ctx.ot.unidadPrincipal, `la OT ${ctx.ot.codigo}`);
  }

  /**
   * Qué falta para poder emitir (resultados aprobados, QC, laboratorio, matriz
   * de firmas, documento duplicado) y los pasos de firma que tendrá. No escribe.
   */
  @Post("condiciones")
  @RequierePermiso("certificado.emitir")
  async condiciones(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId, tipoDocumento } = EmitirSchema.parse(body);
    await this.exigirAlcanceOt(otId, req);
    return this.svc.condicionesEmision(otId, plantillaId, req?.user?.tenantId, { tipoDocumento });
  }

  /**
   * Lo que se propone para el documento: formato de la plantilla, modalidad
   * sugerida (cumplimiento si algún ensayo tiene requisito) y portada del IVC
   * con los datos de la OT. No escribe.
   */
  @Post("propuesta")
  @RequierePermiso("certificado.emitir")
  async propuesta(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId } = OtPlantilla.parse(body);
    await this.exigirAlcanceOt(otId, req);
    return this.svc.propuestaDocumento(otId, plantillaId, req?.user?.tenantId);
  }

  /** Contexto de datos de una OT (para el autorelleno). Solo lee datos de la OT. */
  @Post("contexto/:otId")
  @RequierePermiso("plantilla.ver")
  async contexto(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    // También aquí rige el alcance por laboratorio: el contexto trae resultados.
    await this.exigirAlcanceOt(otId, req);
    return this.svc.contexto(otId, req?.user?.tenantId);
  }

  /**
   * Previsualiza el informe relleno (HTML + HASH), sin emitir.
   * Exige `certificado.emitir`: era la brecha verificada (un LECTOR obtenía 201).
   */
  @Post("previsualizar")
  @RequierePermiso("certificado.emitir")
  async previsualizar(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId, modalidad, datosInforme } = PreviewSchema.parse(body);
    // Antes no comprobaba el alcance: cualquier emisor previsualizaba OTs de otro laboratorio.
    await this.exigirAlcanceOt(otId, req);
    return this.svc.previsualizar(otId, plantillaId, req?.user?.tenantId, { modalidad, datos: datosInforme });
  }

  /** Emite el informe/certificado: rellena, sella con HASH, numera y registra Certificado. */
  @Post("emitir")
  @RequierePermiso("certificado.emitir")
  async emitir(@Body() body: unknown, @Req() req: any) {
    const { otId, plantillaId, tipoDocumento, modalidad, datosInforme } = EmitirSchema.parse(body);
    await this.exigirAlcanceOt(otId, req);
    // El Certificado se crea con el tenant del usuario autenticado (no DEV_TENANT),
    // EN FIRMA: será oficial cuando firme el último paso de la matriz.
    return this.svc.emitir(otId, plantillaId, req?.user?.tenantId, req?.user?.sub ?? req?.user?.id, {
      tipoDocumento,
      modalidad,
      datosInforme,
    });
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
    await this.exigirAlcanceDocumento(certificadoId, req);
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
  async html(@Param("certificadoId", ParseUUIDPipe) certificadoId: string, @Req() req: any) {
    await this.exigirAlcanceDocumento(certificadoId, req);
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
  // RbacModule exporta FirmasMatrizService (resolver de la matriz de firmas);
  // ConfiguracionModule exporta MailService (envío del PDF por correo).
  imports: [QcModule, RbacModule, ConfiguracionModule],
  // FirmasImagenController (/mi-firma, imagen de firma del usuario) vive en
  // rbac/ pero se registra aquí, junto al circuito de firma que la estampa.
  controllers: [
    PlantillaRenderController,
    InformeDatosController,
    FirmaDocumentoController,
    FirmasImagenController,
    VerificacionController,
    NumeracionController,
  ],
  providers: [PlantillaRenderService, FirmaDocumentoService, InformeDatosService, NumeracionService],
  exports: [PlantillaRenderService, NumeracionService],
})
export class PlantillaRenderModule {}
