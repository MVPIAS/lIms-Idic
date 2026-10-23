import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { ConfiguracionModule } from "../configuracion/configuracion.module";
import { PlantillaRenderModule } from "../plantilla-render/plantilla-render.module";
import { DESTINOS_DESPACHO } from "../avisos/reglas-avisos";
import { SeguimientoService } from "./seguimiento.service";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const Despacho = z.object({
  destino: z.enum(DESTINOS_DESPACHO),
  unidadDestinoId: z.string().uuid().optional(),
  fecha: fecha.optional(),
  ejemplares: z.coerce.number().int().min(1).max(50),
  distribucion: z.array(z.object({ destinatario: z.string().trim().min(2).max(200), ejemplares: z.coerce.number().int().min(1).max(50) })).max(20).optional(),
  copiaArchivada: z.boolean().optional(),
  archivoUbicacion: z.string().trim().max(200).optional(),
  retencionMeses: z.coerce.number().int().min(1).max(600).optional(),
  oficioId: z.string().uuid().optional(),
  observacion: z.string().trim().max(1000).optional(),
});
const Plazo = z.object({
  medio: z.enum(["correo", "oficio", "telefono", "otro"]),
  destinatarios: z.array(z.string().trim().email("Correo no válido")).max(10).optional(),
  mensaje: z.string().max(2000).optional(),
});
const RecepcionDco = z.object({ fecha });
const Registro = z.object({
  tipo: z.enum(["CARTA", "OFICIO", "CERTIFICADO", "INFORME", "IVC", "PLANILLA", "ACTA", "OTRO"]),
  numero: z.string().trim().min(1, "Indique el Nº del documento").max(80),
  copias: z.coerce.number().int().min(0).max(50).optional(),
  fecha: fecha.optional(),
  descripcion: z.string().trim().max(500).optional(),
  archivo: z.object({ nombre: z.string().trim().min(1).max(200), mime: z.string().max(120), datos: z.string().max(7_000_000) }).optional(),
});
const Anular = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres)").max(500) });
const Envio = z.object({
  fecha: fecha.optional(),
  medio: z.enum(["correo", "mano", "libro", "oficio", "oficina_partes", "courier", "plataforma", "otro"]),
  destinatario: z.string().trim().min(2, "Indique a quién se envía").max(300),
  certificadoIds: z.array(z.string().uuid()).max(50).optional(),
  registroIds: z.array(z.string().uuid()).max(50).optional(),
  oficioIds: z.array(z.string().uuid()).max(20).optional(),
  facturaId: z.string().uuid().optional(),
  guia: z.string().trim().max(60).optional(),
  observacion: z.string().trim().max(1000).optional(),
  correo: z
    .object({ destinatarios: z.array(z.string().trim().email("Correo no válido")).min(1).max(10), mensaje: z.string().max(2000).optional() })
    .optional(),
});
const Archivar = z.object({ ubicacion: z.string().trim().max(200).optional() });

/**
 * Seguimiento de la OT y despacho de documentos (frente r4c,
 * docs/FLUJO_AVISOS_DESPACHO_OFICIO.md). Todas las rutas comprueban el alcance
 * de la OT o del documento en el servicio.
 */
@ApiTags("seguimiento")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller()
export class SeguimientoController {
  constructor(private readonly svc: SeguimientoService) {}

  @Get("ot/:id/seguimiento")
  @RequierePermiso("ot.ver")
  vista(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.vista(id, req);
  }

  @Post("ot/:id/notificar-plazo")
  @RequierePermiso("ot.seguimiento")
  notificarPlazo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.notificarPlazo(id, Plazo.parse(body ?? {}), req);
  }

  @Post("ot/:id/recepcion-dco")
  @RequierePermiso("ot.seguimiento")
  recepcionDco(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recepcionDco(id, RecepcionDco.parse(body ?? {}).fecha, req);
  }

  @Post("ot/:id/documentos-registro")
  @RequierePermiso("ot.carpeta")
  registrar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrarDocumento(id, Registro.parse(body ?? {}), req);
  }

  @Post("ot/:id/documentos-registro/:registroId/anular")
  @RequierePermiso("ot.carpeta")
  anular(@Param("id", ParseUUIDPipe) id: string, @Param("registroId", ParseUUIDPipe) registroId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anularDocumento(id, registroId, Anular.parse(body ?? {}).motivo, req);
  }

  @Get("ot/:id/documentos-registro/:registroId/archivo")
  @RequierePermiso("ot.ver")
  async archivo(@Param("id", ParseUUIDPipe) id: string, @Param("registroId", ParseUUIDPipe) registroId: string, @Req() req: any, @Res() res: Response) {
    const a = await this.svc.archivoDocumento(id, registroId, req);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(a.nombre)}"`);
    res.send(a.buffer);
  }

  @Post("ot/:id/envios")
  @RequierePermiso("ot.seguimiento")
  envio(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrarEnvio(id, Envio.parse(body ?? {}), req);
  }

  @Get("ot/:id/carpeta")
  @RequierePermiso("ot.ver")
  carpeta(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.carpeta(id, req);
  }

  @Post("ot/:id/carpeta/archivar")
  @RequierePermiso("ot.carpeta")
  archivar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.archivarCarpeta(id, Archivar.parse(body ?? {}).ubicacion, req);
  }

  @Post("informes/:id/despachar")
  @RequierePermiso("certificado.despachar")
  despachar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.despachar(id, Despacho.parse(body ?? {}), req);
  }

  @Post("informes/:id/despacho/recibir")
  @RequierePermiso("certificado.entregar")
  recibir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.recibirDespacho(id, req);
  }
}

@Module({
  imports: [ConfiguracionModule, PlantillaRenderModule],
  controllers: [SeguimientoController],
  providers: [SeguimientoService],
  exports: [SeguimientoService],
})
export class SeguimientoModule {}
