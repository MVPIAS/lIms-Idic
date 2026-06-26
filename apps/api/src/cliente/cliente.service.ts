import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class ClienteService {
  private prisma = new PrismaClient();

  async listar(opts: {
    page: number;
    limit: number;
    search?: string;
    tipo?: string;
  }) {
    const skip = (opts.page - 1) * opts.limit;
    const where: any = { deletedAt: null };
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

  async detalle(id: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id, deletedAt: null },
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

  async crear(data: any) {
    // tenantId vendrá del JWT en producción
    const tenantIdFromJWT = "00000000-0000-0000-0000-000000000000"; // placeholder
    return this.prisma.cliente.create({
      data: {
        ...data,
        tenantId: tenantIdFromJWT,
      },
    });
  }

  async actualizar(id: string, data: any) {
    await this.detalle(id); // valida que existe
    return this.prisma.cliente.update({
      where: { id },
      data,
    });
  }

  async bloquear(id: string, motivo: string) {
    return this.prisma.cliente.update({
      where: { id },
      data: { bloqueado: true, motivoBloqueo: motivo },
    });
  }

  async desbloquear(id: string, motivo: string) {
    // TODO: registrar en cliente_desbloqueo con autorización
    return this.prisma.cliente.update({
      where: { id },
      data: { bloqueado: false, motivoBloqueo: null },
    });
  }
}
