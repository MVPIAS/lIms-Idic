import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { zMoneda } from "../common/moneda";
import { TIPOS_SERVICIO } from "./form05";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { CircuitoCotizacionService } from "./circuito.service";
import { nombrePdfCotizacion } from "./cotizacion-documento";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const texto = (max: number) => z.string().trim().max(max);
const monto = z.number().nonnegative().max(1e12);

const SolicitarSchema = z.object({
  unidadId: z.string().uuid(),
  tipoServicio: z.enum(TIPOS_SERVICIO),
  comentario: texto(2000).nullable().optional(),
  conCopia: texto(500).nullable().optional(),
});

const ProgramaSchema = z.object({
  etapas: z
    .array(z.object({ actividad: texto(300).min(1, "Indique la actividad de cada etapa."), inicio: fecha.nullable().optional(), termino: fecha.nullable().optional(), recursos: texto(500).nullable().optional() }))
    .max(50)
    .default([]),
  fechaInicio: fecha.nullable().optional(),
  fechaTermino: fecha.nullable().optional(),
  plazoEntregaDias: z.number().int(),
  puntosEt: texto(2000).nullable().optional(),
  numItems: z.number().int().nullable().optional(),
});

const Form05Schema = z.object({
  viaticos: z
    .array(z.object({ ambito: z.enum(["nacional", "extranjero"]), zona: texto(120).min(1), grado: texto(120).min(1), dias: z.number().positive().max(365), montoDiario: monto, porcentaje: z.number().min(0).max(100) }))
    .max(50)
    .optional(),
  horasHombre: z
    .array(z.object({ tipo: z.enum(["civil", "militar"]), categoria: texto(120).min(1), horas: z.number().positive().max(100000), valorHora: monto }))
    .max(50)
    .optional(),
  servicios: z.array(z.object({ codigo: texto(40).min(1), descripcion: texto(300).optional(), cantidad: z.number().positive().max(100000), valorUnitario: monto })).max(100).optional(),
  horasMaquina: z.array(z.object({ equipo: texto(200).min(1), horas: z.number().positive().max(100000), valorHora: monto })).max(50).optional(),
  pasajes: z.array(z.object({ ambito: z.enum(["nacional", "extranjero"]), tramo: texto(200).min(1), cantidad: z.number().positive().max(1000), valorUnitario: monto })).max(50).optional(),
  otros: z.array(z.object({ descripcion: texto(300).min(1), monto, moneda: zMoneda.default("CLP") })).max(50).optional(),
  condiciones: texto(4000).nullable().optional(),
  dolar: z.number().positive().max(100000).nullable().optional(),
});

const ResponderSchema = z.object({
  respuesta: z.enum(["aceptar", "aceptar_con_comentario", "rechazar"]),
  comentario: texto(2000).nullable().optional(),
  programa: ProgramaSchema.nullable().optional(),
  costeo: Form05Schema.nullable().optional(),
});

const VbSchema = z.object({ accion: z.enum(["dar", "devolver"]), comentario: texto(2000).nullable().optional() });
const MotivoSchema = z.object({ motivo: texto(1000).min(3, "Indique el motivo.") });
const EnviarClienteSchema = z.object({
  medio: z.enum(["correo", "mano", "courier", "oficio", "oficina_partes"]),
  destinatarios: z.array(z.string().trim().email("Correo inválido").max(200)).max(20).optional(),
  observacion: texto(1000).nullable().optional(),
  plantilla: z.string().max(60).optional(),
});

/**
 * Circuito de la cotización (EP-00 F2–F3): consulta al laboratorio (fechas y
 * costeo FORM05/FORM06), V°B°, firma del Jefe DCO, documento y envío.
 * Va antes que CotizacionController en el módulo para que las rutas fijas
 * (`solicitudes-laboratorio`) no caigan en `GET /cotizaciones/:id`.
 */
@ApiTags("cotizaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("cotizaciones")
export class CircuitoCotizacionController {
  constructor(private readonly svc: CircuitoCotizacionService) {}

  /**
   * Bandeja del laboratorio. Basta ver cotizaciones: cada uno ve las solicitudes
   * de los laboratorios de su alcance (el Jefe de Laboratorio, las suyas; los
   * perfiles globales, todas). Responder exige `cotizacion.costear`.
   */
  @Get("solicitudes-laboratorio")
  @RequierePermiso("cotizacion.ver")
  @ApiOperation({ summary: "Bandeja del laboratorio: ?estado=por_responder|vb|todas" })
  bandeja(@Query("estado") estado: string | undefined, @Req() req: any) {
    return this.svc.bandejaLaboratorio(req, { estado });
  }

  @Post("solicitudes-laboratorio/:sid/responder")
  @RequierePermiso("cotizacion.costear")
  @ApiOperation({ summary: "El laboratorio responde: programa (FORM06) y costeo (FORM05)" })
  responder(@Param("sid", ParseUUIDPipe) sid: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.responder(req, sid, ResponderSchema.parse(body ?? {}) as any);
  }

  @Post("solicitudes-laboratorio/:sid/vb")
  @RequierePermiso("cotizacion.vb")
  @ApiOperation({ summary: "V°B° del laboratorio o del departamento (dar / devolver)" })
  vb(@Param("sid", ParseUUIDPipe) sid: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.vb(req, sid, VbSchema.parse(body ?? {}));
  }

  @Post("solicitudes-laboratorio/:sid/retirar")
  @RequierePermiso("cotizacion.crear")
  retirar(@Param("sid", ParseUUIDPipe) sid: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.retirar(req, sid, MotivoSchema.parse(body ?? {}).motivo);
  }

  @Get(":id/circuito")
  @RequierePermiso("cotizacion.ver")
  @ApiOperation({ summary: "Ruta de la cotización, solicitudes al laboratorio, V°B°, firma, envío y bitácora" })
  circuito(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.estado(req, id);
  }

  @Get(":id/html")
  @RequierePermiso("cotizacion.ver")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'")
  html(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.html(req, id);
  }

  @Get(":id/pdf")
  @RequierePermiso("cotizacion.ver")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const { pdf, codigo } = await this.svc.pdf(req, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nombrePdfCotizacion(codigo)}"`);
    res.end(pdf);
  }

  @Post(":id/solicitudes-laboratorio")
  @RequierePermiso("cotizacion.crear")
  @ApiOperation({ summary: "Solicitar fechas (estándar) o abrir el formulario de costeo (no estándar) al laboratorio" })
  solicitar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.solicitar(req, id, SolicitarSchema.parse(body ?? {}));
  }

  @Post(":id/enviar-a-firma")
  @RequierePermiso("cotizacion.crear")
  enviarAFirma(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.enviarAFirma(req, id);
  }

  @Post(":id/firmar")
  @RequierePermiso("cotizacion.firmar")
  firmar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.firmar(req, id);
  }

  @Post(":id/devolver-firma")
  @RequierePermiso("cotizacion.firmar")
  devolverFirma(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.devolverFirma(req, id, MotivoSchema.parse(body ?? {}).motivo);
  }

  @Post(":id/enviar-cliente")
  @RequierePermiso("cotizacion.crear")
  enviarCliente(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.enviarCliente(req, id, EnviarClienteSchema.parse(body ?? {}));
  }
}
