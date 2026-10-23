import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Module, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { ClienteModule } from "../cliente/cliente.module";
import { PlantillaRenderModule } from "../plantilla-render/plantilla-render.module";
import { OtDesdeProcesoService } from "./ot-desde-proceso.service";
import { ClasificacionController } from "./clasificacion/clasificacion.controller";
import { ClasificacionService } from "./clasificacion/clasificacion.service";
import { ProduccionNacionalController } from "./produccion-nacional/produccion-nacional.controller";
import { ProduccionNacionalService } from "./produccion-nacional/produccion-nacional.service";
import { PrototiposController } from "./prototipos/prototipos.controller";
import { PrototiposService } from "./prototipos/prototipos.service";
import { textoClasificacion } from "./clasificacion/reglas-clasificacion";
import { FlujoRealModule } from "../flujo-real/flujo-real.module";
import { RevisionDocumentalController, RevisionDocumentalService } from "./produccion-nacional/revision-documental.controller";
import { RequerimientoSucursalController, RequerimientoSucursalService } from "./produccion-nacional/requerimiento-sucursal.controller";

/**
 * Origen BPCH de una OT (Producción Nacional o Prototipo), para el aviso del
 * expediente de la OT. Exige ver la OT (alcance por laboratorio); no exige el
 * ámbito BPCH: quien ve la OT puede saber de dónde viene.
 */
@ApiTags("bpch")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("bpch/origen-ot")
export class OrigenOtBpchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly pn: ProduccionNacionalService,
    private readonly proto: PrototiposService,
  ) {}

  @Get(":otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "De qué proceso BPCH nace la OT (null si de ninguno)" })
  async origen(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      select: { id: true, codigo: true, unidadPrincipal: true, origenTrabajo: true },
    });
    if (!ot) throw new NotFoundException("OT no encontrada.");
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    if (ot.origenTrabajo === "PRODUCCION_NACIONAL") {
      const o = await this.pn.origenDeOt(otId);
      if (!o) return null;
      return {
        proceso: "PRODUCCION_NACIONAL",
        titulo: `Producción Nacional · O/C ${o.oc_numero} · RAF ${o.raf_numero}`,
        enlace: `/bpch/produccion-nacional/${o.oc_id}`,
        detalle: [
          `Inspección programada ${String(o.mes).padStart(2, "0")}/${o.anio}`,
          `Producto: ${o.producto}${o.lote ? ` · lote ${o.lote}` : ""}`,
          o.tipo_linea === "MOVIL" ? "Línea móvil (camión fábrica): SAC-PG01-IT10 no aplica el muestreo NCh 44" : "Línea fija",
          o.clas_id
            ? `Clasificación ${o.clas_codigo}: ${textoClasificacion({ explosiva: o.explosiva, claseDivision: o.clase_division, grupoCompatibilidad: o.grupo_compatibilidad, numeroOnu: o.numero_onu })}`
            : "",
        ].filter(Boolean),
      };
    }
    if (ot.origenTrabajo === "PROTOTIPO") {
      const p = await this.proto.origenDeOt(otId);
      if (!p) return null;
      return {
        proceso: "PROTOTIPO",
        titulo: `Prototipo ${p.codigo} · ${p.elemento}`,
        enlace: `/bpch/prototipos/${p.id}`,
        detalle: [`Etapa: ${p.etapa}`, `Solicitud DGMN: ${p.solicitudDgmn}`, "El dictamen (aprobación o rechazo del tipo) se emite desde BPCH › Prototipos"],
      };
    }
    return null;
  }
}

/**
 * BPCH · Producción Nacional, Prototipos y Clasificación de sustancias.
 * Reglas y casos de prueba: docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md.
 */
@Module({
  imports: [ClienteModule, PlantillaRenderModule, FlujoRealModule],
  controllers: [ClasificacionController, ProduccionNacionalController, PrototiposController, OrigenOtBpchController, RevisionDocumentalController, RequerimientoSucursalController],
  providers: [OtDesdeProcesoService, ClasificacionService, ProduccionNacionalService, PrototiposService, RevisionDocumentalService, RequerimientoSucursalService],
})
export class BpchProduccionPrototiposClasificacionModule {}
