import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { DEV_TENANT } from "../../common/base-crud.service";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { PrototiposService } from "./prototipos.service";
import { ProduccionNacionalService } from "../produccion-nacional/produccion-nacional.service";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";

const tenant = (req: any) => req?.user?.tenantId ?? DEV_TENANT;
const usuario = (req: any): string | null => req?.user?.sub ?? null;

@ApiTags("bpch · prototipos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH")
@Controller("bpch/prototipos")
export class PrototiposController {
  constructor(
    private readonly svc: PrototiposService,
    private readonly pn: ProduccionNacionalService,
    private readonly comun: OtDesdeProcesoService,
  ) {}

  /**
   * Alcance por unidad (frente L · C8): las sucursales y la Delegación Nº 11
   * ven y gestionan solo los prototipos de su unidad (la de su OT); la Sección
   * Certificación de la Conformidad y la jefatura del BPCH, todos. Se aplica al
   * listado, al detalle y a todas las escrituras.
   */
  private async exigir(req: any, id: string) {
    await this.comun.exigirExpediente(req, await this.svc.unidadDe(tenant(req), id), "el prototipo");
  }

  @Get()
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "Prototipos (?q=&estado=)" })
  async listar(@Query("q") q: string, @Query("estado") estado: string, @Req() req: any) {
    return this.svc.listar(tenant(req), { q, estado }, await this.comun.filtroExpedientes(req));
  }

  @Get(":id")
  @RequierePermiso("bpch.prototipo.ver")
  @ApiOperation({ summary: "Prototipo con su evaluación, dictamen, documento y lo que falta en cada paso" })
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.detalle(tenant(req), id);
  }

  @Post()
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Ingreso del prototipo (elemento nuevo, antecedentes técnicos, solicitud DGMN)" })
  async crear(@Body() body: unknown, @Req() req: any) {
    // Un prototipo nace sin unidad (se elige al generar la OT): lo ingresan quienes ven todos.
    if ((await this.comun.filtroExpedientes(req)) !== null)
      throw new ForbiddenException(
        "Fuera de su alcance: el ingreso de prototipos lo hacen la Sección Certificación de la Conformidad y la jefatura del BPCH.",
      );
    return this.svc.crear(tenant(req), usuario(req), body);
  }

  @Post("fabricantes")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Alta del fabricante del prototipo (se registra como cliente; mismas reglas que en Producción Nacional)" })
  crearFabricante(@Body() body: unknown, @Req() req: any) {
    return this.pn.crearFabricante(tenant(req), body);
  }

  @Patch(":id")
  @RequierePermiso("bpch.prototipo.gestionar")
  async editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.editar(tenant(req), id, body);
  }

  @Post(":id/pronunciamiento-sac")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Pronunciamiento de la SAC sobre el tamaño de muestra (SAC-PG01-IT10)" })
  async pronunciamiento(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.pronunciamientoSac(tenant(req), id, body);
  }

  @Post(":id/generar-ot")
  @RequierePermiso("bpch.prototipo.gestionar")
  @ApiOperation({ summary: "Generar la OT del prototipo (origen Prototipo; sigue el flujo general)" })
  async generarOt(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.generarOt(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/dictamen")
  @RequierePermiso("bpch.prototipo.dictaminar")
  @ApiOperation({ summary: "Dictaminar (aprobado / rechazado) y emitir el documento al circuito de firmas" })
  async dictaminar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.dictaminar(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/codigo-cnc")
  @RequierePermiso("bpch.prototipo.dictaminar")
  @ApiOperation({ summary: "Registrar el código único CNC-DGMN del tipo aprobado" })
  async codigo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.registrarCodigo(req, tenant(req), usuario(req), id, body);
  }

  @Post(":id/anular")
  @RequierePermiso("bpch.prototipo.gestionar")
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.exigir(req, id);
    return this.svc.anular(tenant(req), usuario(req), id, body);
  }
}
