import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { FirmaDocumentoService, MEDIOS_ENTREGA } from "./firma-documento.service";

const Motivo = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres)").max(1000) });
const Firmar = z.object({ comentario: z.string().max(500).optional() });
const Entregar = z.object({
  fecha: z.coerce.date().optional(),
  medio: z.enum(MEDIOS_ENTREGA),
  destinatario: z.string().trim().min(2, "Indique a quién se entregó").max(200),
  observacion: z.string().max(1000).optional(),
  // EP-05 8.1 (frente r4c): guía, ejemplares, copias, oficio y devolución de muestras.
  guia: z.string().trim().max(60).optional(),
  ejemplares: z.coerce.number().int().min(1).max(50).optional(),
  copias: z.string().trim().max(200).optional(),
  oficioId: z.string().uuid().optional(),
  devolucionMuestras: z.boolean().optional(),
});
const Correo = z.object({
  destinatarios: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(/[,;\s]+/)))
    .pipe(z.array(z.string().trim().email("Correo no válido")).min(1, "Indique al menos un correo")),
  mensaje: z.string().max(2000).optional(),
});

/**
 * Circuito de firma de informes y certificados (docs/FLUJO_FIRMA_CIERRE.md).
 *
 * Firmar y devolver NO llevan @RequierePermiso a propósito: la autorización es
 * la MATRIZ DE FIRMAS (solo puede hacerlo un responsable del paso actual, lo
 * comprueba el servicio). `documento.firmar` solo gobierna la visibilidad de la
 * bandeja en el menú. Anular, reemitir y entregar sí llevan permiso propio.
 */
@ApiTags("informes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("informes")
export class FirmaDocumentoController {
  constructor(private readonly svc: FirmaDocumentoService) {}

  /** Documentos emitidos con su estado de firma y entrega (?otId, ?estado=en_firma|oficial|devuelto|anulado|por_entregar). */
  @Get("documentos")
  @RequierePermiso("ot.ver")
  listar(
    @Req() req: any,
    @Query("otId") otId?: string,
    @Query("estado") estado?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    if (otId && !z.string().uuid().safeParse(otId).success) otId = undefined;
    return this.svc.listar(req, { otId, estado, search, page, limit });
  }

  /** «Documentos por firmar»: aquellos cuyo paso actual tiene al usuario como responsable. */
  @Get("por-firmar")
  porFirmar(@Req() req: any) {
    return this.svc.porFirmar(req);
  }

  /** Detalle del circuito: pasos, firmas, paso actual y qué puede hacer el usuario. */
  @Get(":id/circuito")
  circuito(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.circuito(id, req);
  }

  @Post(":id/firmar")
  firmar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.firmar(id, req, Firmar.parse(body ?? {}).comentario);
  }

  @Post(":id/devolver")
  devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.devolver(id, Motivo.parse(body ?? {}).motivo, req);
  }

  @Post(":id/anular")
  @RequierePermiso("certificado.anular")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(id, Motivo.parse(body ?? {}).motivo, req);
  }

  /** Nueva versión de un documento devuelto o anulado (vuelve a pasar por las condiciones de emisión). */
  @Post(":id/reemitir")
  @RequierePermiso("certificado.emitir")
  reemitir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.reemitir(id, req);
  }

  @Post(":id/entregar")
  @RequierePermiso("certificado.entregar")
  entregar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.entregar(id, Entregar.parse(body ?? {}), req);
  }

  @Post(":id/enviar-correo")
  @RequierePermiso("certificado.entregar")
  enviarCorreo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.enviarCorreo(id, Correo.parse(body ?? {}), req);
  }
}
