import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { AntecedenteQuery, FiltroReinspecciones, ReinspeccionService } from "./reinspeccion.service";

/** Reinspección BPCH · /bpch/reinspecciones (solo la rama del Banco de Pruebas de Chile). */
@ApiTags("bpch-reinspecciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH")
@Controller("bpch/reinspecciones")
export class ReinspeccionController {
  constructor(private readonly svc: ReinspeccionService) {}

  @Get()
  @RequierePermiso("bpch.reinspeccion.ver")
  listar(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.listar(req, FiltroReinspecciones.parse(q ?? {}));
  }

  @Get("antecedente")
  @RequierePermiso("bpch.reinspeccion.ver")
  @ApiOperation({ summary: "Antecedentes que hereda la reinspección (?otId=&certificadoId=&codificacionId=&cnc=)" })
  antecedente(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.antecedente(req, AntecedenteQuery.parse(q ?? {}));
  }

  @Get(":id")
  @RequierePermiso("bpch.reinspeccion.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(req, id);
  }

  @Post()
  @RequierePermiso("bpch.reinspeccion.gestionar")
  @ApiOperation({ summary: "Registra la solicitud de reinspección y genera su OT" })
  registrar(@Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(req, body);
  }

  // La cabecera de la inspección y el lote los completa quien inspecciona en la
  // sucursal (inspector / jefe), no solo quien solicita la reinspección.
  @Patch(":id/inspeccion")
  @RequierePermiso("bpch.reinspeccion.ver", "resultado.crear")
  inspeccion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.inspeccion(req, id, body);
  }

  @Post(":id/lote")
  @RequierePermiso("bpch.reinspeccion.ver", "muestra.crear")
  @ApiOperation({ summary: "Registra el lote como muestra de la OT con sus ensayos" })
  lote(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.lote(req, id, body);
  }

  @Post(":id/trazabilidad")
  @RequierePermiso("bpch.reinspeccion.gestionar")
  @ApiOperation({ summary: "Registra la reinspección en el historial del producto (y, si se pide, el cambio de titular)" })
  trazabilidad(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.trazabilidad(req, id, body);
  }
}
