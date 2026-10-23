import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { RbacModule } from "../rbac/rbac.module";
import { PlantillaRenderModule } from "../plantilla-render/plantilla-render.module";
import { OficioService } from "./oficio.service";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const Distribucion = z.array(z.object({ destinatario: z.string().trim().min(1).max(200), ejemplares: z.coerce.number().int().min(1).max(50) })).max(20);
const Crear = z
  .object({
    cotizacionId: z.string().uuid().optional(),
    otId: z.string().uuid().optional(),
    documentos: z.array(z.string().uuid()).max(20).optional(),
    destinatario: z.string().trim().min(3, "Indique el destinatario").max(300),
    materia: z.string().trim().min(3, "Indique la materia").max(500),
    cuerpo: z.string().max(8000).optional(),
    fecha: fecha.optional(),
    distribucion: Distribucion.optional(),
  })
  .refine((x) => !!x.cotizacionId !== !!x.otId, "El oficio conduce una cotización o documentos de una OT (uno de los dos).");
const Editar = z.object({
  documentos: z.array(z.string().uuid()).max(20).optional(),
  destinatario: z.string().trim().min(3).max(300).optional(),
  materia: z.string().trim().min(3).max(500).optional(),
  cuerpo: z.string().max(8000).optional(),
  fecha: fecha.optional(),
  distribucion: Distribucion.optional(),
});
const Firmar = z.object({ comentario: z.string().max(1000).optional() });
const Motivo = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres)").max(1000) });
const Despacho = z.object({ numero: z.string().trim().min(1, "Indique el Nº de despacho").max(60), fecha: fecha.optional() });

/**
 * Oficio conductor (docs/FLUJO_AVISOS_DESPACHO_OFICIO.md §4). Firmar y devolver
 * no llevan @RequierePermiso: los autoriza la matriz OFICIO (el responsable del
 * paso actual), igual que el circuito de los informes.
 */
@ApiTags("oficios")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("oficios")
export class OficioController {
  constructor(private readonly svc: OficioService) {}

  @Get()
  @RequierePermiso("oficio.ver")
  listar(@Req() req: any, @Query("estado") estado?: string, @Query("vista") vista?: string, @Query("otId") otId?: string, @Query("cotizacionId") cotizacionId?: string) {
    return this.svc.listar(req, { estado, vista, otId, cotizacionId });
  }

  /** Para firmar basta con ser responsable del paso: se ve el detalle sin oficio.ver. */
  @Get(":id")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(id, req);
  }

  @Get(":id/pdf")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const r = await this.svc.pdf(id, req);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${r.nombre}"`);
    res.send(r.buffer);
  }

  @Post()
  @RequierePermiso("oficio.crear")
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(Crear.parse(body ?? {}) as any, req);
  }

  @Patch(":id")
  @RequierePermiso("oficio.crear")
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(id, Editar.parse(body ?? {}), req);
  }

  @Post(":id/generar")
  @RequierePermiso("oficio.crear")
  generar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.generar(id, req);
  }

  @Post(":id/firmar")
  firmar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.firmar(id, Firmar.parse(body ?? {}).comentario, req);
  }

  @Post(":id/devolver")
  devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.devolver(id, Motivo.parse(body ?? {}).motivo, req);
  }

  @Post(":id/despachar")
  @RequierePermiso("oficio.despachar")
  despachar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.despachar(id, Despacho.parse(body ?? {}), req);
  }

  @Post(":id/anular")
  @RequierePermiso("oficio.crear")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(id, Motivo.parse(body ?? {}).motivo, req);
  }
}

@Module({
  imports: [RbacModule, PlantillaRenderModule],
  controllers: [OficioController],
  providers: [OficioService],
})
export class OficioModule {}
