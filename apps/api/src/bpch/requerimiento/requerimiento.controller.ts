import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { FiltroRequerimientos, RequerimientoBpchService } from "./requerimiento.service";

/** Requerimiento BPCH (OT sin cotización) · /bpch/requerimientos. */
@ApiTags("bpch-requerimientos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH")
@Controller("bpch/requerimientos")
export class RequerimientoBpchController {
  constructor(private readonly svc: RequerimientoBpchService) {}

  @Get()
  @RequierePermiso("bpch.requerimiento.ver")
  listar(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.listar(req, FiltroRequerimientos.parse(q ?? {}));
  }

  @Get(":id")
  @RequierePermiso("bpch.requerimiento.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(req, id);
  }

  @Post()
  @RequierePermiso("bpch.requerimiento.crear")
  @ApiOperation({ summary: "Elabora el requerimiento (borrador)" })
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(req, body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.requerimiento.crear")
  actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.actualizar(req, id, body);
  }

  @Post(":id/validar")
  @RequierePermiso("bpch.requerimiento.validar")
  @ApiOperation({ summary: "Valida el requerimiento y genera la OT derivada a la sucursal" })
  validar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.validar(req, id);
  }

  @Post(":id/anular")
  @RequierePermiso("bpch.requerimiento.crear")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: { motivo?: string }, @Req() req: any) {
    return this.svc.anular(req, id, body?.motivo ?? "");
  }
}
