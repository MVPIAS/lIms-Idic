import { Controller, Get, Module, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { DEV_TENANT } from "../common/base-crud.service";
import { RecepcionService } from "./recepcion.service";

const tenantDe = (req: any): string => req?.user?.tenantId ?? DEV_TENANT;

/**
 * Recepción y custodia de la muestra (EP-01 §1.2–1.3, EP-02 §1.2, EP-03 §1.2,
 * EP-05 §3.1; LME 20-10-2026). El registro de las muestras sigue en
 * POST /flujo/ot/:id/muestras (flujo-real), que usa la configuración de aquí.
 *
 * Permisos: ver la configuración y los productos, muestra.ver; asignar el Nº
 * interno y la bandeja de entrada, muestra.crear. Todo con el alcance del
 * laboratorio de la OT (AlcanceService).
 */
@ApiTags("recepcion")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("recepcion")
export class RecepcionController {
  constructor(private readonly svc: RecepcionService) {}

  @Get("bandeja")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "Bandeja de entrada del laboratorio: OT y órdenes internas por recepcionar" })
  bandeja(@Req() req: any) {
    return this.svc.bandeja(tenantDe(req), req);
  }

  @Get("elemento/:elementoId/productos")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Productos con panel propio del laboratorio de un elemento genérico (Registrar OT, B-012)" })
  productosDeElemento(@Param("elementoId", ParseUUIDPipe) elementoId: string, @Req() req: any) {
    return this.svc.productosDeElemento(tenantDe(req), elementoId);
  }

  @Get("ot/:otId/productos")
  @RequierePermiso("muestra.ver")
  @ApiOperation({ summary: "Productos (matriz) del laboratorio de la OT; con ?search= también del catálogo" })
  productos(@Param("otId", ParseUUIDPipe) otId: string, @Query("search") search: string | undefined, @Req() req: any) {
    return this.svc.productos(otId, tenantDe(req), req, search);
  }

  @Get("ot/:otId/productos/:elementoId/panel")
  @RequierePermiso("muestra.ver")
  @ApiOperation({ summary: "Métodos del panel del producto (para registrar sus ensayos)" })
  panel(@Param("otId", ParseUUIDPipe) otId: string, @Param("elementoId", ParseUUIDPipe) elementoId: string, @Req() req: any) {
    return this.svc.panel(otId, elementoId, tenantDe(req), req);
  }

  @Get("clientes")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "Clientes del maestro para identificar la muestra (id y nombre)" })
  clientes(@Query("search") search: string | undefined, @Req() req: any) {
    return this.svc.clientes(tenantDe(req), search);
  }

  @Post("muestras/:id/numero")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "Asigna el Nº de muestra interno (correlativo; no cambia)" })
  asignarNumero(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.asignarNumero(id, tenantDe(req), req);
  }

  @Post("ot/:otId/numeros")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "Asigna el Nº interno a las muestras de la OT que no lo tienen" })
  asignarNumerosOt(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.asignarNumerosOt(otId, tenantDe(req), req);
  }

  @Get("retenciones")
  @RequierePermiso("muestra.ver")
  @ApiOperation({ summary: "Testigos, muestras en custodia y contramuestras con su plazo de retención" })
  retenciones(@Req() req: any) {
    return this.svc.retenciones(tenantDe(req), req);
  }
}

@Module({
  controllers: [RecepcionController],
  providers: [RecepcionService],
  exports: [RecepcionService],
})
export class RecepcionModule {}
