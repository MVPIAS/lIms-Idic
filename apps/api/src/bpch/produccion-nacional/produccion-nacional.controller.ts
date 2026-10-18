import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { DEV_TENANT } from "../../common/base-crud.service";
import { AmbitoUnidad } from "../../rbac/ambito-unidad.guard";
import { ProduccionNacionalService } from "./produccion-nacional.service";

const tenant = (req: any) => req?.user?.tenantId ?? DEV_TENANT;
const usuario = (req: any): string | null => req?.user?.sub ?? null;
const uuidOpcional = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/**
 * Producción Nacional (BPCH). Lectura: ámbito BPCH y Comercial (DCO recibe el
 * informe técnico, base de la tasa). Escrituras: solo la rama BPCH (el ámbito del
 * método manda sobre el de la clase), además de su permiso.
 */
@ApiTags("bpch · producción nacional")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@AmbitoUnidad("BPCH", "DCO")
@Controller("bpch/pn")
export class ProduccionNacionalController {
  constructor(private readonly svc: ProduccionNacionalService) {}

  @Get("config")
  @RequierePermiso("bpch.pn.ver")
  @ApiOperation({ summary: "Unidades de BPCH (sucursales, SCC, D11) y tipos de cliente vigentes" })
  config(@Req() req: any) {
    return this.svc.config(tenant(req));
  }

  /* ------------------------------------------------------------ fabricantes */

  @Get("fabricantes")
  @RequierePermiso("bpch.pn.ver")
  @ApiOperation({ summary: "Fabricantes con RAF, o búsqueda de clientes (?q= RUT o razón social)" })
  fabricantes(@Query("q") q: string, @Req() req: any) {
    return this.svc.fabricantes(tenant(req), q);
  }

  @Post("fabricantes")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  @ApiOperation({ summary: "Alta del fabricante (se registra como cliente)" })
  crearFabricante(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearFabricante(tenant(req), body);
  }

  /* -------------------------------------------------------------------- RAF */

  @Get("rafs")
  @RequierePermiso("bpch.pn.ver")
  rafs(@Query("clienteId") clienteId: string, @Query("q") q: string, @Req() req: any) {
    return this.svc.rafs(tenant(req), { clienteId: uuidOpcional(clienteId), q });
  }

  @Post("rafs")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  @ApiOperation({ summary: "Registrar la RAF DGMN (línea fija o móvil) con sus documentos legales" })
  crearRaf(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearRaf(tenant(req), usuario(req), body);
  }

  @Patch("rafs/:id")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  editarRaf(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarRaf(tenant(req), id, body);
  }

  @Post("rafs/:id/anular")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  anularRaf(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anularRaf(tenant(req), id, usuario(req), body);
  }

  /* ------------------------------------------------------------------- O/C */

  @Get("oc")
  @RequierePermiso("bpch.pn.ver")
  @ApiOperation({ summary: "O/C operativas con el resumen de su programa (?anio=&clienteId=&estado=&q=)" })
  ocs(@Query() q: Record<string, string>, @Req() req: any) {
    return this.svc.ocs(tenant(req), {
      anio: q.anio ? Number(q.anio) || undefined : undefined,
      clienteId: uuidOpcional(q.clienteId),
      estado: ["vigente", "cerrada", "anulada"].includes(q.estado) ? q.estado : undefined,
      q: q.q,
    });
  }

  @Get("oc/:id")
  @RequierePermiso("bpch.pn.ver")
  @ApiOperation({ summary: "O/C: productos, programa (estado de cada inspección y su OT), resumen, consumo y correlaciones" })
  oc(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.ocDetalle(tenant(req), id);
  }

  @Post("oc")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  @ApiOperation({ summary: "Registrar la O/C operativa anual (vigencia, cobro, productos y cantidades)" })
  crearOc(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearOc(tenant(req), usuario(req), body);
  }

  @Patch("oc/:id")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  editarOc(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarOc(tenant(req), id, body);
  }

  @Post("oc/:id/productos")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  agregarProducto(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.agregarProducto(tenant(req), id, body);
  }

  @Patch("oc/:id/productos/:productoId")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  editarProducto(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("productoId", ParseUUIDPipe) productoId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return this.svc.editarProducto(tenant(req), id, productoId, body);
  }

  @Post("oc/:id/cerrar")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  cerrarOc(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cerrarOc(tenant(req), id, usuario(req));
  }

  @Post("oc/:id/anular")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  anularOc(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anularOc(tenant(req), id, usuario(req), body);
  }

  /* -------------------------------------------------------------- programa */

  @Post("oc/:id/programa")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.programar")
  @ApiOperation({ summary: "Programar inspecciones (mes, unidad, producto, lugar, lote, cantidad)" })
  agregarLineas(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.agregarLineas(req, tenant(req), usuario(req), id, body);
  }

  @Patch("programa/:lineaId")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.programar")
  editarLinea(@Param("lineaId", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarLinea(req, tenant(req), id, body);
  }

  @Post("programa/:lineaId/anular")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.programar")
  anularLinea(@Param("lineaId", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anularLinea(req, tenant(req), id, usuario(req), body);
  }

  @Post("programa/:lineaId/generar-ot")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.programar")
  @ApiOperation({ summary: "Generar la OT de la inspección (origen Producción Nacional; sigue el flujo general)" })
  generarOt(@Param("lineaId", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.generarOt(req, tenant(req), usuario(req), id);
  }

  /* ----------------------------------------------------------- correlación */

  @Post("oc/:id/correlaciones")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  @ApiOperation({ summary: "Registrar la relación de ventas de un período (correlación con lo inspeccionado)" })
  crearCorrelacion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.crearCorrelacion(tenant(req), usuario(req), id, body);
  }

  @Get("correlaciones/:id")
  @RequierePermiso("bpch.pn.ver")
  correlacion(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.correlacion(tenant(req), id);
  }

  @Patch("correlaciones/:id")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  editarCorrelacion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editarCorrelacion(tenant(req), id, body);
  }

  @Post("correlaciones/:id/emitir-informe")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  @ApiOperation({ summary: "Emitir y sellar el informe técnico de Producción Nacional" })
  emitirInforme(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.emitirInforme(tenant(req), usuario(req), id);
  }

  @Post("correlaciones/:id/remitir-dco")
  @AmbitoUnidad("BPCH")
  @RequierePermiso("bpch.pn.gestionar")
  remitirDco(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.remitirDco(tenant(req), usuario(req), id);
  }

  @Get("correlaciones/:id/informe")
  @RequierePermiso("bpch.pn.ver")
  async informe(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const html = await this.svc.informeHtml(tenant(req), id);
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    });
    res.send(html);
  }

  @Get("correlaciones/:id/informe.pdf")
  @RequierePermiso("bpch.pn.ver")
  async informePdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const { buffer, nombre } = await this.svc.informePdf(tenant(req), id);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Content-Length": String(buffer.length),
    });
    res.end(buffer);
  }
}
