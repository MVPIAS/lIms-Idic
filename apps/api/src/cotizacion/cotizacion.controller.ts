import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { z } from "zod";
import { CotizacionService } from "./cotizacion.service";
import { CosteoService } from "./costeo.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { estadosValidos } from "../common/estados";

const CosteoSchema = z.object({
  lineas: z
    .array(
      z.object({
        tipo: z.enum([
          "viatico",
          "hora_hombre_civil",
          "hora_hombre_militar",
          "hora_maquina",
          "pasaje",
          "insumo",
          "otros",
        ]),
        descripcion: z.string().optional(),
        cantidad: z.number().nonnegative(),
        valorUnitario: z.number().nonnegative(),
      }),
    )
    .min(1),
  cfaPct: z.number().min(0).max(100).optional(),
  margenParticularPct: z.number().min(0).max(100).optional(),
  ivaPct: z.number().min(0).max(100).optional(),
  redondeoClp: z.number().min(0).optional(),
});

const TasaSchema = z.object({
  cifDivisa: z.number().positive(),
  paridad: z.number().positive(),
  divisa: z.string().optional(),
  tasaPct: z.number().min(0).max(100).optional(),
  ivaPct: z.number().min(0).max(100).optional(),
});

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

// El estado ya no es texto libre: solo se admiten los estados reales del
// dominio (common/estados.ts). La transición concreta la valida el servicio.
const ActualizarCotSchema = z.object({
  estado: z.enum(estadosValidos("cotizacion") as [string, ...string[]]).optional(),
  notas: z.string().optional(),
});

const CrearCotSchema = z.object({
  clienteId: z.string().uuid(),
  plantaId: z.string().uuid().optional(),
  formato: z.enum(["F1", "F2", "F3", "F4"]),
  formaPago: z.string().optional(),
  validezDias: z.number().int().positive().default(30),
  descuentoPct: z.number().min(0).max(100).default(0),
  // GAP-CHECK SIS_COMERCIAL: la cotización comercial del legacy NO aplica gastos
  // administrativos ni utilidad, y es IVA EXENTO (ADM/imprimir.php:337
  // "impresion cotizacion IVA EXENTO"). El total real = SUMA(líneas) − descuento%.
  // Por eso el default de IVA es 0 (exento); solo se calcula IVA si el llamador lo
  // pide explícitamente. Antes el default 19 divergía del original.
  gastosAdminPct: z.number().min(0).max(100).default(0),
  ivaPct: z.number().min(0).max(100).default(0),
  notas: z.string().optional(),
  lineas: z.array(LineaSchema).min(1),
});

@ApiTags("cotizaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("cotizaciones")
export class CotizacionController {
  constructor(
    private readonly svc: CotizacionService,
    private readonly costeo: CosteoService,
  ) {}

  /**
   * Costeo Ejército: CDT → CFA → CT → 3 precios. No persiste; sirve al simulador.
   * Exige `cotizacion.crear` (no `.ver`): es la herramienta de quien cotiza, y un
   * rol de solo lectura no tiene por qué ejecutar el costeo.
   */
  @Post("costeo")
  @RequierePermiso("cotizacion.crear")
  calcularCosteo(@Body() body: unknown) {
    const { lineas, ...params } = CosteoSchema.parse(body);
    return this.costeo.calcular(lineas, params);
  }

  /** Tasa de internación 1,5% (servicios ligados a importación). */
  @Post("tasa-internacion")
  @RequierePermiso("cotizacion.crear")
  calcularTasa(@Body() body: unknown) {
    const { cifDivisa, paridad, ...opts } = TasaSchema.parse(body);
    return this.costeo.tasaInternacion(cifDivisa, paridad, opts);
  }

  @Get()
  @RequierePermiso("cotizacion.ver")
  listar(@Req() req: any) {
    return this.svc.listar(req?.user?.tenantId);
  }

  @Get(":id")
  @RequierePermiso("cotizacion.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(id, req?.user?.tenantId);
  }

  @Post()
  @RequierePermiso("cotizacion.crear")
  crear(@Body() body: unknown, @Req() req: any) {
    const data = CrearCotSchema.parse(body);
    return this.svc.crear(data, req?.user?.tenantId);
  }

  @Patch(":id")
  @RequierePermiso("cotizacion.crear")
  actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const data = ActualizarCotSchema.parse(body);
    return this.svc.actualizar(id, data, req?.user?.tenantId);
  }

  /**
   * "Eliminar" = anular (estado 'anulada'); no hay borrado físico (referenciada por OT).
   * Es la operación más destructiva del dominio → el permiso más restrictivo
   * (`cotizacion.aprobar`: SUPERADMIN, ADMIN, DIRECTOR). Era la brecha verificada
   * en la auditoría: un LECTOR podía anular cotizaciones.
   */
  @Delete(":id")
  @RequierePermiso("cotizacion.aprobar")
  eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.anular(id, req?.user?.tenantId);
  }

  @Post(":id/enviar")
  @RequierePermiso("cotizacion.crear")
  enviar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cambiarEstado(id, "enviada", req?.user?.tenantId);
  }

  /** Aceptar = decisión comercial + genera la OT → `cotizacion.aprobar`. */
  @Post(":id/aceptar")
  @RequierePermiso("cotizacion.aprobar")
  aceptar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.aceptar(id, req?.user?.tenantId);
  }

  @Post(":id/rechazar")
  @RequierePermiso("cotizacion.aprobar")
  rechazar(@Param("id", ParseUUIDPipe) id: string, @Body() body: { motivo: string }, @Req() req: any) {
    return this.svc.rechazar(id, body.motivo, req?.user?.tenantId);
  }
}
