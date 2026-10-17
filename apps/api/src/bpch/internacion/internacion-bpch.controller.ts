import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { FiltroInternaciones, InternacionBpchService } from "./internacion-bpch.service";

/**
 * Internación BPCH · /bpch/internaciones (IDIC-PG 24 Anexo 03).
 * Rama: Banco de Pruebas de Chile o Comercial (registra la resolución y la tasa).
 */
@ApiTags("bpch-internaciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("bpch/internaciones")
export class InternacionBpchController {
  constructor(private readonly svc: InternacionBpchService) {}

  @Get()
  @RequierePermiso("bpch.internacion.ver")
  @ApiOperation({ summary: "Expedientes de internación (?estado=&q=&page=&limit=)" })
  listar(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.listar(req, FiltroInternaciones.parse(q ?? {}));
  }

  @Get("cnc")
  @RequierePermiso("bpch.internacion.ver")
  @ApiOperation({ summary: "¿El código CNC-DGMN está en la Codificación Única? (?cnc=)" })
  cnc(@Query("cnc") cnc: string, @Req() req: any) {
    return this.svc.buscarCnc(req, cnc ?? "");
  }

  @Get(":id")
  @RequierePermiso("bpch.internacion.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(req, id);
  }

  @Post()
  @RequierePermiso("bpch.internacion.registrar")
  @ApiOperation({ summary: "Registra la internación desde la resolución DGMN (sin cotización)" })
  registrar(@Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(req, body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.internacion.registrar")
  @ApiOperation({ summary: "Corrige el registro (solo antes de generar la OT)" })
  corregir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.corregir(req, id, body);
  }

  @Post(":id/anular")
  @RequierePermiso("bpch.internacion.registrar")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(req, id, body);
  }

  @Post(":id/analisis")
  @RequierePermiso("bpch.internacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Análisis técnico: incompleta → solicitud a DGMN; completa → OT automática" })
  analizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.analizar(req, id, body);
  }

  @Post(":id/solicitudes/:sid/respuesta")
  @RequierePermiso("bpch.internacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Registra la respuesta de DGMN a una solicitud de antecedentes" })
  responder(@Param("id", ParseUUIDPipe) id: string, @Param("sid", ParseUUIDPipe) sid: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.responderSolicitud(req, id, sid, body);
  }

  @Post(":id/documentacion")
  @RequierePermiso("bpch.internacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Documentación administrativa para la tasa { accion: solicitar|recibir|conforme|no_conforme }" })
  documentacion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.documentacion(req, id, body);
  }

  @Patch(":id/inspeccion")
  @RequierePermiso("bpch.internacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Programa la inspección: lugar, fecha, inspectores, lotes y tamaños" })
  inspeccion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.inspeccion(req, id, body);
  }

  @Post(":id/lotes")
  @RequierePermiso("bpch.internacion.gestionar", "muestra.crear")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Registra cada lote como muestra de la OT con sus ensayos" })
  lotes(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.lotes(req, id, body);
  }

  @Post(":id/tasa")
  @RequierePermiso("bpch.tasa.gestionar")
  @ApiOperation({ summary: "Calcula la tasa: CIF US$ × paridad × % afecto × % tasa (+ IVA)" })
  tasa(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.calcularTasa(req, id, body);
  }

  @Post(":id/remitir-facturacion")
  @RequierePermiso("bpch.tasa.gestionar")
  @ApiOperation({ summary: "Remite la tasa a facturación (factura pendiente de la OT)" })
  remitir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.remitirFacturacion(req, id);
  }

  @Post(":id/codificacion")
  @RequierePermiso("bpch.codificacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Inscribe / actualiza los productos certificados en la Codificación Única" })
  codificacion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.actualizarCodificacion(req, id, body);
  }
}
