import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { tenantDe } from "../comun/bpch-comun.service";
import { CodificacionService, FiltroCodificacion } from "./codificacion.service";

/**
 * Codificación Única · /bpch/codificacion
 * Consulta: Banco de Pruebas y Comercial (registran casos). Mantenimiento:
 * solo la rama del Banco de Pruebas (Subdirección BPCH, Sección Certificación).
 */
@ApiTags("bpch-codificacion")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("bpch/codificacion")
export class CodificacionController {
  constructor(private readonly svc: CodificacionService) {}

  @Get()
  @RequierePermiso("bpch.codificacion.ver")
  @ApiOperation({ summary: "Listado de Codificación Única (?listado=EXPLOSIVOS|SUSTANCIAS_QUIMICAS&estado=VIGENTE|EN_RECESO&q=)" })
  listar(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.listar(req, FiltroCodificacion.parse(q ?? {}));
  }

  @Get("por-codigo")
  @RequierePermiso("bpch.codificacion.ver")
  @ApiOperation({ summary: "Busca un producto por su código CNC-DGMN (?cnc=)" })
  async porCodigo(@Query("cnc") cnc: string, @Req() req: any) {
    return { producto: cnc?.trim() ? await this.svc.porCnc(tenantDe(req), cnc) : null };
  }

  @Get(":id")
  @RequierePermiso("bpch.codificacion.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(req, id);
  }

  @Post()
  @RequierePermiso("bpch.codificacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Inscribe un producto en la Codificación Única" })
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(req, body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.codificacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Corrige los datos de un producto (cambiar el código exige motivo)" })
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(req, id, body);
  }

  @Post(":id/estado")
  @RequierePermiso("bpch.codificacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Pasa a receso o reactiva un producto { estado, motivo }" })
  estado(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.cambiarEstado(req, id, body);
  }

  @Post(":id/titular")
  @RequierePermiso("bpch.codificacion.gestionar")
  @AmbitoUnidad("BPCH")
  @ApiOperation({ summary: "Cambia el titular del producto { clienteId | fabricanteNombre, motivo }" })
  async titular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.svc.cambiarTitular(req, id, body);
    return this.svc.detalle(req, id);
  }
}
