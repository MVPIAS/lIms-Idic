import { Body, Controller, Get, Module, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PlantillaRenderModule } from "../plantilla-render/plantilla-render.module";
import { registrarFuenteBandeja, type ItemBandeja } from "../rbac/bandeja.service";
import { SolicitudAdquisicionService } from "./solicitud-adquisicion.service";
import { MAX_ITEMS } from "./reglas-adquisicion";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const Item = z.object({
  cantidad: z.coerce.number().positive("La cantidad a adquirir debe ser mayor que 0"),
  unidadMedida: z.string().trim().max(40).nullable().optional(),
  descripcion: z.string().trim().min(3, "Describa el bien o servicio requerido").max(4000),
  valorUnitario: z.coerce.number().nonnegative("El valor unitario no puede ser negativo").max(999_999_999_999).nullable().optional(),
  consumibleId: z.string().uuid().nullable().optional(),
  equipoId: z.string().uuid().nullable().optional(),
});
const Solicitud = z.object({
  unidadId: z.string().uuid("Elija el laboratorio solicitante"),
  fecha: fecha.optional(),
  centroCosto: z.string().trim().min(3, "Indique el nombre y centro de costo del solicitante").max(200),
  solicitanteNombre: z.string().trim().min(3, "Indique el nombre del usuario solicitante").max(200),
  solicitanteCargo: z.string().trim().max(200).nullable().optional(),
  delegacionAtribuciones: z.boolean().optional(),
  objetivo: z.string().trim().min(5, "Indique el objetivo de la adquisición").max(4000),
  aplicaIva: z.boolean().optional(),
  otId: z.string().uuid().nullable().optional(),
  items: z.array(Item).min(1, "Agregue al menos un bien o servicio").max(MAX_ITEMS),
});
const Motivo = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres)").max(1000) });
const RecibirSab = z.object({ numeroSab: z.string().trim().max(60).nullable().optional() });
const OrdenCompra = z.object({
  numero: z.string().trim().min(1, "Indique el Nº de la orden de compra").max(60),
  fecha,
  proveedor: z.string().trim().min(2, "Indique el proveedor").max(200),
  estado: z.string().trim().max(120).nullable().optional(),
});
const RecibirBodega = z.object({ fecha: fecha.optional(), observacion: z.string().trim().max(1000).nullable().optional() });

/**
 * Solicitudes de adquisición (IDIC-PG06-IT02-FORM01). Devolver y anular no
 * llevan @RequierePermiso: los puede hacer la jefatura, el laboratorio o
 * Abastecimiento según el estado; el servicio lo decide con las reglas puras.
 */
@ApiTags("solicitudes-adquisicion")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("solicitudes-adquisicion")
export class SolicitudAdquisicionController {
  constructor(private readonly svc: SolicitudAdquisicionService) {}

  @Get()
  @RequierePermiso("adquisicion.ver")
  listar(
    @Req() req: any,
    @Query("estado") estado?: string,
    @Query("unidadId") unidadId?: string,
    @Query("vista") vista?: string,
    @Query("otId") otId?: string,
    @Query("q") q?: string,
  ) {
    const uuid = (x?: string) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : undefined);
    return this.svc.listar(req, { estado, unidadId: uuid(unidadId), vista, otId: uuid(otId), q });
  }

  @Get("opciones")
  @RequierePermiso("adquisicion.crear")
  opciones(@Req() req: any) {
    return this.svc.opciones(req);
  }

  @Get("buscar/consumibles")
  @RequierePermiso("adquisicion.crear")
  consumibles(@Req() req: any, @Query("q") q?: string) {
    return this.svc.buscarConsumibles(req, q);
  }

  @Get("buscar/equipos")
  @RequierePermiso("adquisicion.crear")
  equipos(@Req() req: any, @Query("q") q?: string, @Query("unidadId") unidadId?: string) {
    return this.svc.buscarEquipos(req, q, unidadId && /^[0-9a-f-]{36}$/i.test(unidadId) ? unidadId : undefined);
  }

  /** El detalle lo abre quien la creó, su laboratorio y Abastecimiento: el servicio comprueba el alcance. */
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
  @RequierePermiso("adquisicion.crear")
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(Solicitud.parse(body ?? {}) as any, req);
  }

  @Patch(":id")
  @RequierePermiso("adquisicion.crear")
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(id, Solicitud.parse(body ?? {}) as any, req);
  }

  @Post(":id/enviar")
  @RequierePermiso("adquisicion.crear")
  enviar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.enviar(id, req);
  }

  @Post(":id/visar")
  @RequierePermiso("adquisicion.visar")
  visar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.visar(id, req);
  }

  @Post(":id/devolver")
  devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.devolver(id, Motivo.parse(body ?? {}).motivo, req);
  }

  @Post(":id/recibir-sab")
  @RequierePermiso("adquisicion.gestionar")
  recibirSab(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recibirSab(id, RecibirSab.parse(body ?? {}), req);
  }

  @Post(":id/orden-compra")
  @RequierePermiso("adquisicion.gestionar")
  ordenCompra(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.registrarOc(id, OrdenCompra.parse(body ?? {}) as any, req);
  }

  @Post(":id/recibir-bodega")
  @RequierePermiso("adquisicion.gestionar")
  recibirBodega(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recibirBodega(id, RecibirBodega.parse(body ?? {}), req);
  }

  @Post(":id/anular")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(id, Motivo.parse(body ?? {}).motivo, req);
  }
}

@Module({
  imports: [PlantillaRenderModule],
  controllers: [SolicitudAdquisicionController],
  providers: [SolicitudAdquisicionService],
})
export class SolicitudAdquisicionModule implements OnModuleInit {
  constructor(private readonly svc: SolicitudAdquisicionService) {}

  /** Mi bandeja: por dar V°B° (jefatura), por gestionar (SAB) y devueltas a quien las creó. */
  onModuleInit() {
    registrarFuenteBandeja(async (req) => {
      if (!req?.user?.tenantId) return [];
      const permisos: string[] = req.user.permisos ?? [];
      const sup = (req.user.roles ?? []).includes("SUPERADMIN");
      const out: ItemBandeja[] = [];
      const tarjeta = (clave: string, titulo: string, descripcion: string, ruta: string, filas: any[], severidad: "info" | "warn" | "alta") => {
        if (!filas.length) return;
        out.push({
          clave, titulo, descripcion, cantidad: filas.length, ruta, severidad,
          elementos: filas.slice(0, 5).map((s) => ({
            id: s.id,
            texto: `Solicitud ${s.numero ?? "(borrador)"} · ${s.unidad}`,
            detalle: String(s.objetivo ?? "").slice(0, 120),
            ruta: `/solicitudes-adquisicion/${s.id}`,
            fecha: s.fecha,
          })),
        });
      };
      if (sup || permisos.includes("adquisicion.visar")) {
        const r = await this.svc.listar(req, { vista: "por_visar" }).catch(() => ({ data: [] as any[] }));
        tarjeta("adquisicion_por_visar", "Solicitudes de adquisición por visar", "Solicitudes de su laboratorio que esperan su V°B° (o devuélvalas con motivo)", "/solicitudes-adquisicion?vista=por_visar", r.data, "warn");
      }
      if (sup || permisos.includes("adquisicion.gestionar")) {
        const r = await this.svc.listar(req, { vista: "por_gestionar" }).catch(() => ({ data: [] as any[] }));
        tarjeta("adquisicion_por_recibir", "Solicitudes de adquisición por recibir", "Con V°B° de la jefatura: recíbalas y anote su Nº de registro interno SAB", "/solicitudes-adquisicion?vista=por_gestionar", r.data.filter((s) => s.estado === "visada"), "warn");
        tarjeta("adquisicion_en_compra", "Solicitudes de adquisición en compra", "Recibidas o con O/C: anote la orden de compra y la recepción en bodega", "/solicitudes-adquisicion?vista=por_gestionar", r.data.filter((s) => s.estado !== "visada"), "info");
      }
      if (sup || permisos.includes("adquisicion.crear")) {
        const r = await this.svc.listar(req, { vista: "mias", estado: "devuelta" }).catch(() => ({ data: [] as any[] }));
        tarjeta("adquisicion_devueltas", "Solicitudes de adquisición devueltas", "Le devolvieron estas solicitudes: corríjalas y vuelva a enviarlas", "/solicitudes-adquisicion?vista=mias&estado=devuelta", r.data, "alta");
      }
      return out;
    });
  }
}
