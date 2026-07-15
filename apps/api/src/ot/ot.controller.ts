import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DEV_TENANT } from "../common/base-crud.service";

const PrioridadEnum = z.enum(["baja", "normal", "alta", "urgente"]);

/**
 * Crear OT directamente (con o sin cotización de respaldo).
 * `fechaIngreso` se persiste en la columna real `fecha_recepcion`.
 * `flujoInstanciaId` (opcional) asocia la OT a una instancia de flujo ya existente.
 */
const OtCreate = z.object({
  clienteId: z.string().uuid(),
  cotizacionId: z.string().uuid().optional(),
  prioridad: PrioridadEnum.optional(),
  notas: z.string().optional(),
  fechaIngreso: z.coerce.date().optional(),
  flujoInstanciaId: z.string().uuid().optional(),
});

const OtUpdate = z.object({
  estado: z.string().min(1).max(40).optional(),
  prioridad: PrioridadEnum.optional(),
  notas: z.string().optional(),
});

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("ot")
export class OtController {
  private prisma = new PrismaClient();

  @Get()
  async listar(@Req() req: any) {
    return this.prisma.ordenTrabajo.findMany({
      // OrdenTrabajo tiene tenant_id: solo se listan las OT del tenant del usuario.
      where: { ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { cliente: true },
    });
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    // findFirst con tenant compuesto: si la OT es de otro tenant, no se revela (null).
    return this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      include: { cliente: true },
    });
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = OtCreate.parse(body);
    const tenantId = req.user?.tenantId ?? DEV_TENANT;

    // El cliente debe pertenecer al tenant del solicitante (evita adjuntar clientes de otro tenant).
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, tenantId },
      select: { id: true },
    });
    if (!cliente) throw new BadRequestException("clienteId no existe o no pertenece al tenant");

    // Si viene cotización, debe ser del mismo tenant.
    if (dto.cotizacionId) {
      const cot = await this.prisma.cotizacion.findFirst({
        where: { id: dto.cotizacionId, tenantId },
        select: { id: true },
      });
      if (!cot) throw new BadRequestException("cotizacionId no existe o no pertenece al tenant");
    }

    const codigo = await this.generarCodigo(tenantId);

    return this.prisma.ordenTrabajo.create({
      data: {
        tenantId,
        codigo,
        clienteId: dto.clienteId,
        cotizacionId: dto.cotizacionId ?? null,
        flujoInstanciaId: dto.flujoInstanciaId ?? null,
        prioridad: dto.prioridad ?? "normal",
        estado: "recepcionada",
        fechaRecepcion: dto.fechaIngreso ?? new Date(),
        notas: dto.notas ?? null,
      },
      include: { cliente: true },
    });
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtUpdate.parse(body);
    const tenantId = req.user?.tenantId;
    // Verifica existencia + pertenencia al tenant antes de actualizar.
    const actual = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!actual) throw new NotFoundException(`OT ${id} no encontrada`);

    return this.prisma.ordenTrabajo.update({
      where: { id },
      data: dto,
      include: { cliente: true },
    });
  }

  /** Genera 'OT-2026-NNNN' con secuencia por tenant y año (UNIQUE(tenant_id, codigo)). */
  private async generarCodigo(tenantId: string): Promise<string> {
    const anio = new Date().getFullYear();
    const ultima = await this.prisma.ordenTrabajo.findFirst({
      where: { tenantId, codigo: { startsWith: `OT-${anio}-` } },
      orderBy: { codigo: "desc" },
      select: { codigo: true },
    });
    let n = 1;
    if (ultima) {
      const partes = ultima.codigo.split("-");
      n = parseInt(partes[2] ?? "0", 10) + 1;
    }
    return `OT-${anio}-${String(n).padStart(4, "0")}`;
  }
}
