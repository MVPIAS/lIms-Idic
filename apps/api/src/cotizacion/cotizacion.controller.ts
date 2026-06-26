import { Body, Controller, Get, Param, Post, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { z } from "zod";
import { CotizacionService } from "./cotizacion.service";

const LineaSchema = z.object({
  tipo: z.enum(["producto", "viatico", "pasaje", "hora_hombre", "hora_maquina", "otros", "extension"]),
  descripcion: z.string().optional(),
  categoria: z.string().optional(),
  cantidad: z.number().int().positive().default(1),
  diasOHoras: z.number().optional(),
  precioUnitario: z.number().positive(),
  descuentoPct: z.number().min(0).max(100).default(0),
  tramo: z.string().optional(),
});

const CrearCotSchema = z.object({
  clienteId: z.string().uuid(),
  plantaId: z.string().uuid().optional(),
  formato: z.enum(["F1", "F2", "F3", "F4"]),
  formaPago: z.string().optional(),
  validezDias: z.number().int().positive().default(30),
  descuentoPct: z.number().min(0).max(100).default(0),
  gastosAdminPct: z.number().min(0).max(100).default(0),
  ivaPct: z.number().min(0).max(100).default(19),
  notas: z.string().optional(),
  lineas: z.array(LineaSchema).min(1),
});

@ApiTags("cotizaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("cotizaciones")
export class CotizacionController {
  constructor(private readonly svc: CotizacionService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  @Get(":id")
  detalle(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.detalle(id);
  }

  @Post()
  crear(@Body() body: unknown) {
    const data = CrearCotSchema.parse(body);
    return this.svc.crear(data);
  }

  @Post(":id/enviar")
  enviar(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.cambiarEstado(id, "enviada");
  }

  @Post(":id/aceptar")
  aceptar(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.aceptar(id);
  }

  @Post(":id/rechazar")
  rechazar(@Param("id", ParseUUIDPipe) id: string, @Body() body: { motivo: string }) {
    return this.svc.rechazar(id, body.motivo);
  }
}
