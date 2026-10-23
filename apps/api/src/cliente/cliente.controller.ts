import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, ParseUUIDPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { z } from "zod";

import { ClienteService } from "./cliente.service";
import { validaRut } from "../common/rut.validator";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

/** Texto opcional: "" (campo vacío del formulario) se trata como «no informado». */
const opcional = (max?: number) =>
  z.preprocess((v) => (v === "" ? undefined : v), (max ? z.string().max(max) : z.string()).optional());

/**
 * `tipo` es un código de la lista parametrizable `parametro_sistema` /
 * tipo_cliente (Ley 17.798, Ejército, …). Aquí solo se valida la forma; que sea
 * un valor vigente lo comprueba el servicio contra la lista (tipo-cliente.ts).
 */
const CrearClienteSchema = z.object({
  rut: z.string().refine((r) => validaRut(r), {
    message: "RUT chileno inválido (no pasa módulo 11)",
  }),
  razonSocial: z.string().trim().min(1, "Indique la razón social.").max(200),
  nombreFantasia: opcional(200),
  giro: opcional(200),
  tipo: z.string({ required_error: "Indique el tipo de cliente." }).trim().min(1, "Indique el tipo de cliente.").max(30),
  direccion: opcional(),
  ciudad: opcional(80),
  region: opcional(80),
  telefono: opcional(40),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().email("Correo no válido").optional()),
  diasCredito: z.number().int().positive().default(30),
  // EP-00 0.1 (recorrido MP-02, D02-16): forma de pago habitual y contacto principal.
  formaPagoHabitual: opcional(30),
  contactoNombre: opcional(160),
  contactoCargo: opcional(120),
  contactoEmail: z.preprocess((v) => (v === "" ? undefined : v), z.string().email("Correo del contacto no válido").max(160).optional()),
  contactoTelefono: opcional(40),
});
/** Planta del cliente (EP-00 0.1: «Planta(s) [nombre, dirección]»). */
const PlantaSchema = z.object({
  codigo: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(20).regex(/^[A-Za-z0-9_-]+$/, "El código solo admite letras, dígitos, - y _.").optional()),
  nombre: z.string({ required_error: "Indique el nombre de la planta." }).trim().min(1, "Indique el nombre de la planta.").max(200),
  direccion: opcional(300),
  ciudad: opcional(80),
  region: opcional(80),
  telefono: opcional(40),
});
const PlantaActualizarSchema = PlantaSchema.omit({ codigo: true }).partial().extend({ activa: z.boolean().optional() });
const TipoSchema = z.object({ tipo: CrearClienteSchema.shape.tipo });
const ActualizarClienteSchema = CrearClienteSchema.partial().extend({
  // En la edición diasCredito no debe volver al valor por defecto si no viene.
  diasCredito: z.number().int().positive().optional(),
});

@ApiTags("clientes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("clientes")
export class ClienteController {
  constructor(private readonly svc: ClienteService) {}

  @Get()
  @RequierePermiso("cliente.ver")
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Query("tipo") tipo?: string,
    @Req() req?: any,
  ) {
    return this.svc.listar({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      tipo,
      tenantId: req?.user?.tenantId,
    });
  }

  @Get(":id")
  @RequierePermiso("cliente.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(id, req?.user?.tenantId);
  }

  @Post()
  @RequierePermiso("cliente.crear")
  async crear(@Body() body: unknown, @Req() req: any) {
    const data = CrearClienteSchema.parse(body);
    return this.svc.crear(data, req?.user?.tenantId);
  }

  @Patch(":id")
  @RequierePermiso("cliente.editar")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const data = ActualizarClienteSchema.parse(body);
    return this.svc.actualizar(id, data, req?.user?.tenantId);
  }

  /**
   * Reclasificar SOLO el tipo de cliente desde la cotización (Comercial R2: si el
   * cliente tiene un tipo antiguo, la pantalla de cotización permite corregirlo).
   * Exige `cotizacion.crear` y no `cliente.editar`: es parte de cotizar y no da
   * acceso al resto de la ficha. El nuevo tipo debe estar vigente.
   */
  @Patch(":id/tipo")
  @RequierePermiso("cotizacion.crear")
  async cambiarTipo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { tipo } = TipoSchema.parse(body ?? {});
    return this.svc.actualizar(id, { tipo }, req?.user?.tenantId);
  }

  /** Bloqueo/desbloqueo comercial = modificar la ficha del cliente → cliente.editar. */
  @Post(":id/bloquear")
  @RequierePermiso("cliente.editar")
  async bloquear(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { motivo: string },
    @Req() req: any,
  ) {
    return this.svc.bloquear(id, body.motivo, req?.user?.tenantId);
  }

  @Post(":id/desbloquear")
  @RequierePermiso("cliente.editar")
  async desbloquear(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { motivo: string },
    @Req() req: any,
  ) {
    return this.svc.desbloquear(id, body.motivo, req?.user?.tenantId);
  }

  /* --- Plantas del cliente (EP-00 0.1, BL-172) --- */

  @Get(":id/plantas")
  @RequierePermiso("cliente.ver")
  async plantas(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.plantas(id, req?.user?.tenantId);
  }

  @Post(":id/plantas")
  @RequierePermiso("cliente.editar")
  async crearPlanta(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.crearPlanta(id, PlantaSchema.parse(body ?? {}), req?.user?.tenantId);
  }

  @Patch(":id/plantas/:plantaId")
  @RequierePermiso("cliente.editar")
  async actualizarPlanta(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("plantaId", ParseUUIDPipe) plantaId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return this.svc.actualizarPlanta(id, plantaId, PlantaActualizarSchema.parse(body ?? {}), req?.user?.tenantId);
  }
}
