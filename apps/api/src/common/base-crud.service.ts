import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Tenant por defecto en desarrollo; en producción sale del JWT (req.user.tenantId). */
export const DEV_TENANT = "00000000-0000-0000-0000-000000000000";

export interface CrudOpts {
  /** Nombre del modelo Prisma en camelCase (p. ej. "proveedor"). */
  model: string;
  /** Campos de texto sobre los que aplica el buscador ?search=. */
  search?: string[];
  /** include por defecto en listar/detalle. */
  include?: any;
  /** Orden por defecto. */
  orderBy?: any;
  /** ¿El modelo tiene columna deleted_at? (soft delete). */
  softDelete?: boolean;
  /** ¿El modelo tiene tenant_id? (se inyecta al crear). */
  tenant?: boolean;
}

/**
 * Servicio CRUD reutilizable sobre cualquier modelo Prisma.
 * Cada entidad extiende esta clase y pasa su configuración.
 */
export abstract class BaseCrudService {
  constructor(protected readonly prisma: PrismaService, protected readonly o: CrudOpts) {}

  protected get d(): any {
    return (this.prisma as any)[this.o.model];
  }

  async listar(q: { page?: number; limit?: number; search?: string; where?: any } = {}) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const where: any = { ...(q.where ?? {}) };
    if (this.o.softDelete !== false) where.deletedAt = null;
    if (q.search && this.o.search?.length) {
      where.OR = this.o.search.map((f) => ({ [f]: { contains: q.search, mode: "insensitive" } }));
    }
    const [data, total] = await Promise.all([
      this.d.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: this.o.include,
        orderBy: this.o.orderBy ?? { createdAt: "desc" },
      }),
      this.d.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async detalle(id: string) {
    const r = await this.d.findFirst({
      where: { id, ...(this.o.softDelete !== false ? { deletedAt: null } : {}) },
      include: this.o.include,
    });
    if (!r) throw new NotFoundException(`${this.o.model} ${id} no encontrado`);
    return r;
  }

  async crear(data: any, tenantId: string = DEV_TENANT) {
    return this.d.create({
      data: { ...(this.o.tenant !== false ? { tenantId } : {}), ...data },
    });
  }

  async actualizar(id: string, data: any) {
    await this.detalle(id);
    return this.d.update({ where: { id }, data });
  }

  async eliminar(id: string) {
    await this.detalle(id);
    return this.o.softDelete !== false
      ? this.d.update({ where: { id }, data: { deletedAt: new Date() } })
      : this.d.delete({ where: { id } });
  }
}
