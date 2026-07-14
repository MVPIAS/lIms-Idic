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
  /**
   * ¿El modelo tiene columna deleted_at? (soft delete). OPT-IN: por defecto NO
   * se filtra por deleted_at. Solo poner `true` en modelos cuya tabla realmente
   * tiene la columna deleted_at. Emitir `WHERE deleted_at IS NULL` contra una
   * tabla que no la tiene provoca un error SQL y que el endpoint devuelva 500
   * (era la causa de que el dashboard contara 0 en proveedores/métodos/etc.).
   */
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

  /** ¿Este modelo se aísla por tenant? (tiene columna tenant_id). */
  protected get isTenantScoped(): boolean {
    return this.o.tenant !== false;
  }

  /**
   * Fragmento `where` para el aislamiento por tenant. Solo se aplica a modelos
   * con columna tenant_id y cuando el tenant del usuario está presente (viene
   * del JWT). Emitirlo contra un modelo sin tenant_id provocaría un error SQL,
   * por eso se respeta el flag `tenant`.
   */
  protected tenantWhere(tenantId?: string): { tenantId: string } | Record<string, never> {
    return this.isTenantScoped && tenantId ? { tenantId } : {};
  }

  async listar(
    q: { page?: number; limit?: number; search?: string; where?: any } = {},
    tenantId?: string,
  ) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const where: any = { ...(q.where ?? {}), ...this.tenantWhere(tenantId) };
    if (this.o.softDelete === true) where.deletedAt = null;
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

  async detalle(id: string, tenantId?: string) {
    const r = await this.d.findFirst({
      where: {
        id,
        ...this.tenantWhere(tenantId),
        ...(this.o.softDelete === true ? { deletedAt: null } : {}),
      },
      include: this.o.include,
    });
    // Nota: si el registro existe pero pertenece a otro tenant, findFirst no lo
    // devuelve → 404 (no revelamos su existencia). Evita la fuga cross-tenant.
    if (!r) throw new NotFoundException(`${this.o.model} ${id} no encontrado`);
    return r;
  }

  async crear(data: any, tenantId?: string) {
    // Fuerza el tenant del usuario e ignora cualquier tenantId que venga en el body.
    const { tenantId: _ignore, ...rest } = data ?? {};
    const tid = tenantId ?? DEV_TENANT;
    return this.d.create({
      data: { ...(this.isTenantScoped ? { tenantId: tid } : {}), ...rest },
    });
  }

  async actualizar(id: string, data: any, tenantId?: string) {
    await this.detalle(id, tenantId); // valida existencia + pertenencia al tenant
    // Nunca se permite reasignar el tenant vía update.
    const { tenantId: _ignore, ...rest } = data ?? {};
    return this.d.update({ where: { id }, data: rest });
  }

  async eliminar(id: string, tenantId?: string) {
    await this.detalle(id, tenantId); // valida existencia + pertenencia al tenant
    return this.o.softDelete === true
      ? this.d.update({ where: { id }, data: { deletedAt: new Date() } })
      : this.d.delete({ where: { id } });
  }
}
