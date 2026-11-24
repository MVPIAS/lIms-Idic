import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { Public } from "../../auth/public.decorator";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { PrismaService } from "../../common/prisma.service";
import { cabecerasAdjunto, leerAdjunto, type ArchivoAdjunto } from "../../common/adjuntos";
import { ENTIDAD_ADJUNTO, IntegracionArmasService, type DatosManuales } from "./integracion-armas.service";
import { verificarHmac } from "./reglas-armas";

export const PERMISO_ARMAS_GESTIONAR = "integracion.armas.gestionar";
export const PERMISO_ARMAS_ESTADO = "integracion.armas.estado";

/** Datos que la persona puede corregir antes de enviar (si la OT no los tiene). */
const ManualSchema = z
  .object({
    tipoOrden: z.union([z.literal(1), z.literal(2)]).optional(),
    resolucionNumero: z.string().trim().min(1).max(60).optional(),
    resolucionFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    solicitanteRut: z.string().trim().min(7).max(15).optional(),
    solicitanteEmail: z.string().trim().email().max(160).optional(),
    cantidadArmas: z.number().int().positive().max(100000).optional(),
    observaciones: z.string().max(4000).optional(),
  })
  .strict();

/**
 * Pantallas del LIMS (D11, BPCH y Comercial):
 *   GET  /integracion/armas/bandeja                    envíos y avisos recientes
 *   GET  /integracion/armas/ot/:otId                   estado externo, historial, enlaces y adjuntos de la OT
 *   POST /integracion/armas/ot/:otId/previsualizar     JSON que se enviaría (sin enviar)
 *   POST /integracion/armas/ot/:otId/enviar            encola el envío al BPCH
 *   POST /integracion/armas/ot/:otId/adjuntos          PDF de la resolución que acompaña a la OT
 *   GET  /integracion/armas/ot/:otId/adjuntos/:id      descarga (resolución o acta de cierre)
 *   POST /integracion/armas/ot/:otId/enlaces           pide ahora al BPCH los enlaces de la OT
 *   POST /integracion/armas/envios/:id/reintentar      vuelve a intentar un envío en error
 *   POST /integracion/armas/procesar                   recorre la cola y consulta estados ahora
 */
@ApiTags("integracion-armas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@AmbitoUnidad("BPCH", "DCO")
@Controller("integracion/armas")
export class IntegracionArmasController {
  constructor(
    private readonly svc: IntegracionArmasService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("bandeja")
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "Bandeja de la integración con el software de armas del BPCH (envíos y avisos recibidos)" })
  bandeja(@Query("estado") estado: string | undefined, @Query("limite") limite: string | undefined, @Req() req: any) {
    return this.svc.bandeja(req.user.tenantId, { estado, limite: Number(limite) || undefined });
  }

  @Get("ot/:otId")
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "Estado de la OT en el software de armas: estado externo, historial, envíos, enlaces y adjuntos" })
  estado(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.estadoOt(req.user.tenantId, otId);
  }

  @Post("ot/:otId/previsualizar")
  @HttpCode(200)
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "JSON que se enviaría al BPCH y lo que falta (no envía nada)" })
  previsualizar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.previsualizar(req.user.tenantId, otId, ManualSchema.parse(body ?? {}) as DatosManuales);
  }

  @Post("ot/:otId/enviar")
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "Encolar el envío de la OT al software de armas del BPCH", description: "Se envía en segundo plano; reintenta si el BPCH no responde." })
  enviar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.encolar(req.user.tenantId, otId, req.user.sub ?? null, ManualSchema.parse(body ?? {}) as DatosManuales);
  }

  @Post("ot/:otId/adjuntos")
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 1 } }))
  @ApiOperation({ summary: "Adjuntar el PDF de la resolución que el BPCH descargará con la OT" })
  adjuntar(@Param("otId", ParseUUIDPipe) otId: string, @UploadedFile() archivo: ArchivoAdjunto | undefined, @Req() req: any) {
    return this.svc.adjuntar(req.user.tenantId, otId, archivo, req.user.sub ?? null);
  }

  @Get("ot/:otId/adjuntos/:id")
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "Descargar un adjunto de la integración (resolución enviada o acta de cierre recibida)" })
  async adjunto(@Param("otId", ParseUUIDPipe) otId: string, @Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const a = await leerAdjunto(this.prisma as any, req.user.tenantId, [ENTIDAD_ADJUNTO], id);
    if (a.entidadId !== otId) throw new NotFoundException("Adjunto no encontrado.");
    res.set(cabecerasAdjunto(a));
    res.end(a.datos);
  }

  @Post("ot/:otId/enlaces")
  @HttpCode(200)
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "Pedir ahora al BPCH los enlaces de la OT (ruta por confirmar con el BPCH)" })
  enlaces(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.pedirEnlaces(req.user.tenantId, otId);
  }

  @Post("envios/:id/reintentar")
  @HttpCode(200)
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "Reintentar un envío en error" })
  reintentar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.reintentar(req.user.tenantId, id);
  }

  @Post("procesar")
  @HttpCode(200)
  @RequierePermiso(PERMISO_ARMAS_GESTIONAR)
  @ApiOperation({ summary: "Enviar ahora lo pendiente y consultar los estados de las OT abiertas" })
  async procesar() {
    const envio = await this.svc.procesarCola();
    const consulta = await this.svc.consultarEstados(true);
    return { ...envio, ...consulta };
  }
}

/**
 * Rutas que llama el software de armas del BPCH (prefijo global «api»):
 *   POST /api/v1/integracion/bpch/webhook          opción 2: aviso firmado (X-BPCH-Signature, X-Event-ID)
 *   POST /api/v1/integracion/bpch/estado           opción 1: POST directo con token de integración del LIMS
 *   GET  /api/v1/integracion/bpch/adjuntos/:token  descarga de la resolución por enlace firmado
 * El cuerpo crudo lo lee cuerpo-crudo.ts (main.ts) para verificar la firma.
 */
@ApiTags("integracion-armas")
@Controller("v1/integracion/bpch")
export class BpchEntradaController {
  constructor(private readonly svc: IntegracionArmasService) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  @ApiOperation({
    summary: "Webhook del software de armas del BPCH (cambio de estado de una OT)",
    description:
      "Sin sesión, pero con firma obligatoria: X-BPCH-Signature = sha256=<HMAC-SHA256 del cuerpo con la clave compartida BPCH_ARMAS_HMAC_SECRET>. X-Event-ID evita procesar dos veces el mismo aviso.",
  })
  async webhook(@Headers("x-bpch-signature") firma: string | undefined, @Headers("x-event-id") eventoId: string | undefined, @Req() req: any) {
    const secreto = process.env.BPCH_ARMAS_HMAC_SECRET?.trim();
    if (!secreto) throw new UnauthorizedException({ codigo: 401, error: "El LIMS no tiene configurada la clave de firma del BPCH." });
    if (!verificarHmac(req.rawBody, firma, secreto)) throw new UnauthorizedException({ codigo: 401, error: "Firma X-BPCH-Signature inválida." });
    return this.svc.recibirEstado(req.body, "webhook", { cabeceraEvento: eventoId ?? null, firmaValida: true });
  }

  @Post("estado")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"))
  @RequierePermiso(PERMISO_ARMAS_ESTADO)
  @ApiOperation({
    summary: "Cambio de estado de una OT informado por el BPCH (POST directo)",
    description: "Con el token de integración que el LIMS entrega al BPCH (Administración › API e integración), rol con el permiso integracion.armas.estado.",
  })
  estado(@Headers("x-event-id") eventoId: string | undefined, @Req() req: any) {
    return this.svc.recibirEstado(req.body, "post", { tenantId: req.user.tenantId, cabeceraEvento: eventoId ?? null });
  }

  @Public()
  @Get("adjuntos/:token")
  @ApiOperation({ summary: "Descarga de un PDF que acompaña a la OT (enlace firmado con vencimiento, sin sesión)" })
  async adjunto(@Param("token") token: string, @Res() res: Response) {
    const a = await this.svc.descargaPorEnlace(token);
    res.set(cabecerasAdjunto(a));
    res.end(a.datos);
  }
}
