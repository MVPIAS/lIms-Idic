import { Controller, Get, Module, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AmbitoUnidad } from "../rbac/ambito-unidad.guard";
import { FlujoRealModule } from "../flujo-real/flujo-real.module";
import { BpchComunService, tenantDe } from "./comun/bpch-comun.service";
import { CodificacionController } from "./codificacion/codificacion.controller";
import { CodificacionService } from "./codificacion/codificacion.service";
import { InternacionBpchController } from "./internacion/internacion-bpch.controller";
import { InternacionBpchService } from "./internacion/internacion-bpch.service";
import { ReinspeccionController } from "./reinspeccion/reinspeccion.controller";
import { ReinspeccionService } from "./reinspeccion/reinspeccion.service";

/** Datos de apoyo de los formularios BPCH: unidades, parámetros, plantillas y panel del catálogo. */
@ApiTags("bpch")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("bpch")
export class BpchConfigController {
  constructor(private readonly comun: BpchComunService) {}

  @Get("config")
  @RequierePermiso("bpch.internacion.ver")
  @ApiOperation({ summary: "Unidades que inspeccionan, parámetros (tasa, motivos) y plantillas de los documentos BPCH" })
  async config(@Req() req: any) {
    const tenantId = tenantDe(req);
    const [unidades, parametros, plantillas] = await Promise.all([
      this.comun.unidadesInspeccion(tenantId),
      this.comun.parametros(tenantId),
      this.comun.plantillas(tenantId),
    ]);
    return { unidades, parametros, plantillas };
  }

  @Get("panel")
  @RequierePermiso("bpch.internacion.ver")
  @ApiOperation({ summary: "Panel de ensayos (métodos) del elemento del catálogo (?catElementoId=)" })
  panel(@Query("catElementoId", ParseUUIDPipe) catElementoId: string, @Req() req: any) {
    return this.comun.panel(tenantDe(req), catElementoId);
  }
}

/**
 * Procesos BPCH de este frente: Internación (IDIC-PG 24 Anexo 03),
 * Reinspección y Codificación Única. Se apoyan en la OT y el flujo general.
 */
@Module({
  imports: [FlujoRealModule],
  controllers: [BpchConfigController, CodificacionController, InternacionBpchController, ReinspeccionController],
  providers: [BpchComunService, CodificacionService, InternacionBpchService, ReinspeccionService],
})
export class BpchModule {}
