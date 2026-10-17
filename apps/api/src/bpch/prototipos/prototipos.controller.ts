import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { DEV_TENANT } from "../../common/base-crud.service";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { PrototiposService } from "./prototipos.service";

const tenant = (req: any) => req?.user?.tenantId ?? DEV_TENANT;
const usuario = (req: any): string | null => req?.user?.sub ?? null;

@ApiTags("bpch · prototipos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH")
@Controller("bpch/prototipos")
export class PrototiposController {
  constructor(private readonly svc: PrototiposService) {}

  @Get()
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "Prototipos (?q=&estado=)" })
  listar(@Query("q") q: string, @Query("estado") estado: string, @Req() req: any) {
    return this.svc.listar(tenant(req), { q, estado });
  }

  @Get(":id")
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "Prototipo con su evaluación, dictamen, documento y lo que falta en cada paso" })
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(tenant(req), id);
  }

  @Post()
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Ingreso del prototipo (elemento nuevo, antecedentes técnicos, solicitud DGMN)" })
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(tenant(req), usuario(req), body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.prototipo.gestionar")
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(tenant(req), id, body);
  }

  @Post(":id/pronunciamiento-sac")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Pronunciamiento de la SAC sobre el tamaño de muestra (SAC-PG01-IT10)" })
  pronunciamiento(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.pronunciamientoSac(tenant(req), id, body);
  }

  @Post(":id/generar-ot")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Generar la OT del prototipo (origen Prototipo; sigue el flujo general)" })
  generarOt(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.generarOt(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/dictamen")
  @RequierePermiso("bpch.prototipo.dictaminar")
  @ApiOperation({ summary: "Dictaminar (aprobado / rechazado) y emitir el documento al circuito de firmas" })
  dictaminar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.dictaminar(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/codigo-cnc")
  @RequierePermiso("bpch.prototipo.dictaminar")
  @ApiOperation({ summary: "Registrar el código único CNC-DGMN del tipo aprobado" })
  codigo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrarCodigo(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/anular")
  @RequierePermiso("bpch.prototipo.gestionar")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(tenant(req), usuario(req), id, body);
  }
}
