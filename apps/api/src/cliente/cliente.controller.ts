import {
  Body, Controller, Get, Param, Patch, Post, Query, UseGuards, ParseUUIDPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { z } from "zod";

import { ClienteService } from "./cliente.service";
import { validaRut } from "../common/rut.validator";

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
@UseGuards(AuthGuard("jwt"))
@Controller("clientes")
export class ClienteController {
  constructor(private readonly svc: ClienteService) {}

  @Get()
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Query("tipo") tipo?: string,
  ) {
    return this.svc.listar({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      tipo,
    });
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.detalle(id);
  }

  @Post()
  async crear(@Body() body: unknown) {
    const data = CrearClienteSchema.parse(body);
    return this.svc.crear(data);
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = CrearClienteSchema.partial().parse(body);
    return this.svc.actualizar(id, data);
  }

  @Post(":id/bloquear")
  async bloquear(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { motivo: string },
  ) {
    return this.svc.bloquear(id, body.motivo);
  }

  @Post(":id/desbloquear")
  async desbloquear(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { motivo: string },
  ) {
    return this.svc.desbloquear(id, body.motivo);
  }
}
