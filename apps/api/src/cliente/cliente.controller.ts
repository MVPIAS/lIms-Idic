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

const CrearClienteSchema = z.object({
  rut: z.string().refine((r) => validaRut(r), {
    message: "RUT chileno inválido (no pasa módulo 11)",
  }),
  razonSocial: z.string().min(1).max(200),
  nombreFantasia: z.string().max(200).optional(),
  giro: z.string().max(200).optional(),
  tipo: z.enum(["institucional", "externo", "gubernamental", "laboratorio_asociado"]),
  direccion: z.string().optional(),
  ciudad: z.string().max(80).optional(),
  region: z.string().max(80).optional(),
  telefono: z.string().max(40).optional(),
  email: z.string().email().optional(),
  diasCredito: z.number().int().positive().default(30),
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
    const data = CrearClienteSchema.partial().parse(body);
    return this.svc.actualizar(id, data, req?.user?.tenantId);
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
}
