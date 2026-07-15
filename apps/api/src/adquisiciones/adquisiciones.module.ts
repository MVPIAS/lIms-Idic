import { Body, Controller, Module, Post, Req, UseGuards, Injectable, BadRequestException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";

/* ===================== ÓRDENES DE COMPRA ===================== */
/**
 * ⚠️ DIVERGENCIA DE ESQUEMA (documentada, no inventada) ⚠️
 * Este servicio opera contra el MODELO PRISMA `OrdenCompra`/`LineaOrdenCompra`,
 * que NO coincide con la BD que construye `provision.sh`
 * (`packages/db/schema.sql` + `align_schema_to_prisma.sql`):
 *
 *   - `orden_compra` real:  codigo, tipo, proyecto_id, fecha_emision, moneda,
 *                           precio_idic_clp, rut_receptor, ... (SIN proveedor_id,
 *                           SIN numero, SIN fecha, SIN deleted_at).
 *   - Modelo Prisma:        numero, proveedor_id, fecha, deleted_at.
 *   - `linea_orden_compra`: NO EXISTE como tabla en la BD real y
 *                           `align_schema_to_prisma.sql` tampoco la crea.
 *
 * Es la misma clase de deriva ya documentada en `apps/api/SECURITY_AUDIT.md`
 * para proveedor/metodo/factura/lista_precio. Como `packages/db` queda fuera del
 * dominio de edición, aquí se implementa el contrato Prisma (única forma de
 * expresar proveedor + líneas) y se deja constancia: hasta aplicar la migración
 * de alineación, POST/GET de OC devolverán 500 contra la BD provisionada.
 *
 * NO se persisten `moneda` ni el IVA: el modelo Prisma no declara esas columnas.
 * `monto` almacena el NETO (suma de subtotales); el IVA/total se derivan en UI.
 */
@Injectable()
export class OrdenCompraService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "ordenCompra", search: ["numero", "detalle"], include: { proveedor: true, lineas: true } });
  }

  async crearConLineas(dto: any, tenantIdArg?: string) {
    const tenantId = tenantIdArg ?? DEV_TENANT;

    // El proveedor debe pertenecer al tenant del solicitante: evita emitir una
    // OC contra un proveedor de otro tenant (IDOR de escritura).
    const proveedor = await this.prisma.proveedor.findFirst({
      where: { id: dto.proveedorId, tenantId },
      select: { id: true },
    });
    if (!proveedor) throw new BadRequestException("proveedorId no existe o no pertenece al tenant");

    // Totales calculados SIEMPRE en servidor: el cliente nunca fija subtotal/monto.
    const lineas = (dto.lineas ?? []).map((l: any) => {
      const cantidad = Number(l.cantidad ?? 1);
      const precioUnitario = Number(l.precioUnitario);
      return { descripcion: l.descripcion, cantidad, precioUnitario, subtotal: cantidad * precioUnitario };
    });
    const monto = lineas.reduce((a: number, l: any) => a + l.subtotal, 0);

    const numero = dto.numero ?? (await this.generarNumero(tenantId));

    return this.prisma.ordenCompra.create({
      data: {
        tenantId, // forzado desde el JWT; nunca se lee del body
        numero,
        proveedorId: dto.proveedorId,
        // `notas` es el alias de entrada de la columna real `detalle`.
        detalle: dto.notas ?? dto.detalle ?? null,
        ...(dto.fecha ? { fecha: dto.fecha } : {}),
        monto,
        estado: dto.estado ?? "emitida",
        lineas: { create: lineas },
      },
      include: { lineas: true, proveedor: true },
    });
  }

  /** Genera 'OC-2026-NNNN' con secuencia por tenant y año (UNIQUE(tenant_id, numero)). */
  private async generarNumero(tenantId: string): Promise<string> {
    const anio = new Date().getFullYear();
    const ultima = await this.prisma.ordenCompra.findFirst({
      where: { tenantId, numero: { startsWith: `OC-${anio}-` } },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });
    const n = ultima ? parseInt(ultima.numero.split("-")[2] ?? "0", 10) + 1 : 1;
    return `OC-${anio}-${String(n).padStart(4, "0")}`;
  }
}

const OC_ESTADOS = ["emitida", "en_curso", "recibida", "anulada"] as const;
const OCLinea = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number().positive().default(1),
  precioUnitario: z.number().nonnegative(),
});
const OCCreate = z.object({
  numero: z.string().min(1).max(30).optional(), // autogenerado (OC-AAAA-NNNN) si falta
  proveedorId: z.string().uuid(),
  fecha: z.coerce.date().optional(),
  // `moneda` se acepta por compatibilidad de contrato pero NO se persiste:
  // el modelo Prisma OrdenCompra no declara la columna (ver nota de divergencia).
  moneda: z.string().max(10).optional(),
  notas: z.string().optional(),
  detalle: z.string().optional(),
  estado: z.enum(OC_ESTADOS).default("emitida"),
  lineas: z.array(OCLinea).min(1, "La OC debe tener al menos una línea"),
});

/**
 * GET /ordenes-compra        · listar (paginado, ?search) — heredado
 * GET /ordenes-compra/:id    · detalle con { proveedor, lineas } — heredado (include del servicio)
 * PATCH /ordenes-compra/:id  · estado/notas — heredado
 * POST /ordenes-compra       · alta con líneas (override)
 */
// Sin permisos `compra.*` sembrados: se usan los del dominio económico
// (`factura.ver` para leer, `factura.emitir` para comprometer gasto). Anotado.
@ApiTags("ordenes-compra") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("ordenes-compra")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "factura.emitir",
  editar: "factura.emitir",
  eliminar: "factura.emitir",
})
export class OrdenCompraController extends BaseCrudController {
  // Ambos campos opcionales, pero al menos uno presente (un PATCH vacío es un error del cliente).
  protected updateSchema = z
    .object({
      estado: z.enum(OC_ESTADOS).optional(),
      notas: z.string().optional(),
      detalle: z.string().optional(),
    })
    .refine((d) => d.estado !== undefined || d.notas !== undefined || d.detalle !== undefined, {
      message: "Nada que actualizar: indique estado y/o notas",
    })
    // `notas` → columna real `detalle`. Se compara con undefined (no por
    // truthiness) para permitir limpiar el detalle enviando "".
    .transform(({ notas, detalle, ...rest }) => {
      const texto = notas !== undefined ? notas : detalle;
      return { ...rest, ...(texto !== undefined ? { detalle: texto } : {}) };
    });

  constructor(protected svc: OrdenCompraService) { super(); }

  @Post()
  @RequierePermiso("factura.emitir")
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearConLineas(OCCreate.parse(body), req?.user?.tenantId);
  }
}

/* ===================== VIÁTICOS ===================== */
@Injectable()
export class ViaticoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "viatico", search: ["funcionario", "destino"] });
  }
}
const ViaticoCreate = z.object({
  funcionario: z.string().min(1).max(160),
  destino: z.string().max(120).optional(),
  dias: z.number().int().positive().default(1),
  tipo: z.string().max(20).optional(),
  monto: z.number().nonnegative(),
  otId: z.string().uuid().optional(),
});
@ApiTags("viaticos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("viaticos")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "factura.emitir",
  editar: "factura.emitir",
  eliminar: "factura.emitir",
})
export class ViaticoController extends BaseCrudController {
  protected createSchema = ViaticoCreate;
  protected updateSchema = ViaticoCreate.partial();
  constructor(protected svc: ViaticoService) { super(); }
}

@Module({
  controllers: [OrdenCompraController, ViaticoController],
  providers: [OrdenCompraService, ViaticoService],
})
export class AdquisicionesModule {}
