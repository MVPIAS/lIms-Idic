import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { DEV_TENANT } from "../common/base-crud.service";

@Injectable()
export class ClienteService {
  private prisma = new PrismaClient();

  async listar(opts: {
    page: number;
    limit: number;
    search?: string;
    tipo?: string;
    tenantId?: string;
  }) {
    const skip = (opts.page - 1) * opts.limit;
    const where: any = { deletedAt: null };
    if (opts.tenantId) where.tenantId = opts.tenantId; // aislamiento por tenant
    if (opts.search) {
      where.OR = [
        { razonSocial: { contains: opts.search, mode: "insensitive" } },
        { rut: { contains: opts.search } },
      ];
    }
    if (opts.tipo) where.tipo = opts.tipo;

    const [data, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        skip,
        take: opts.limit,
        orderBy: { razonSocial: "asc" },
        include: {
          plantas: { take: 1 },
        },
      }),
      this.prisma.cliente.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: opts.page,
        limit: opts.limit,
        total,
        totalPages: Math.ceil(total / opts.limit),
      },
    };
  }

  async detalle(id: string, tenantId?: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      include: {
        plantas: true,
        cotizaciones: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
        ots: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!cliente) throw new NotFoundException(`Cliente ${id} no encontrado`);
    return cliente;
  }

  async crear(data: any, tenantId?: string) {
    // tenantId sale del JWT; se ignora cualquier tenantId del body.
    const { tenantId: _ignore, ...rest } = data ?? {};
    return this.prisma.cliente.create({
      data: {
        ...rest,
        tenantId: tenantId ?? DEV_TENANT,
      },
    });
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    await this.detalle(id, tenantId); // valida existencia + pertenencia al tenant
    const { tenantId: _ignore, ...rest } = data ?? {};
    return this.prisma.cliente.update({
      where: { id },
      data: rest,
    });
  }

  async bloquear(id: string, motivo: string, tenantId?: string) {
    await this.detalle(id, tenantId); // valida pertenencia al tenant
    return this.prisma.cliente.update({
      where: { id },
      data: { bloqueado: true, motivoBloqueo: motivo },
    });
  }

  async desbloquear(id: string, motivo: string, tenantId?: string) {
    await this.detalle(id, tenantId); // valida pertenencia al tenant
    // TODO: registrar en cliente_desbloqueo con autorización
    return this.prisma.cliente.update({
      where: { id },
      data: { bloqueado: false, motivoBloqueo: null },
    });
  }
}
