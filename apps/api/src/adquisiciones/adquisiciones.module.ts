import { Body, Controller, Module, Post, Req, UseGuards, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";

/* ===================== ÓRDENES DE COMPRA ===================== */
@Injectable()
export class OrdenCompraService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "ordenCompra", search: ["numero", "detalle"], include: { proveedor: true, lineas: true } });
  }
  async crearConLineas(dto: any, tenantId: string = DEV_TENANT) {
    tenantId = tenantId ?? DEV_TENANT;
    const lineas = (dto.lineas ?? []).map((l: any) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad ?? 1,
      precioUnitario: l.precioUnitario,
      subtotal: (l.cantidad ?? 1) * l.precioUnitario,
    }));
    const monto = lineas.reduce((a: number, l: any) => a + Number(l.subtotal), 0);
    return this.prisma.ordenCompra.create({
      data: {
        tenantId, numero: dto.numero, proveedorId: dto.proveedorId,
        detalle: dto.detalle ?? null, monto, estado: dto.estado ?? "emitida",
        lineas: { create: lineas },
      },
      include: { lineas: true, proveedor: true },
    });
  }
}
const OCLinea = z.object({ descripcion: z.string().min(1), cantidad: z.number().positive().default(1), precioUnitario: z.number().nonnegative() });
const OCCreate = z.object({
  numero: z.string().min(1).max(30),
  proveedorId: z.string().uuid(),
  detalle: z.string().optional(),
  estado: z.enum(["emitida", "en_curso", "recibida", "anulada"]).default("emitida"),
  lineas: z.array(OCLinea).min(1),
});
@ApiTags("ordenes-compra") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("ordenes-compra")
export class OrdenCompraController extends BaseCrudController {
  protected updateSchema = z.object({ estado: z.enum(["emitida", "en_curso", "recibida", "anulada"]), detalle: z.string().optional() });
  constructor(protected svc: OrdenCompraService) { super(); }
  @Post()
  crear(@Body() body: unknown, @Req() req: any) { return this.svc.crearConLineas(OCCreate.parse(body), req?.user?.tenantId); }
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
@ApiTags("viaticos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("viaticos")
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
