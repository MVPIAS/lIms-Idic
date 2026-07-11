import { Body, Controller, Get, Module, Param, Post, UseGuards, Injectable, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";

/* ===================== FACTURAS ===================== */
@Injectable()
export class FacturaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "factura",
      search: ["numero"],
      include: { lineas: true, pagos: true, notasCredito: true },
    });
  }
  /** Crea la factura con sus líneas, calculando neto/IVA/total. */
  async crearConLineas(dto: any, tenantId = DEV_TENANT) {
    const lineas = (dto.lineas ?? []).map((l: any) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad ?? 1,
      precioUnitario: l.precioUnitario,
      subtotal: (l.cantidad ?? 1) * l.precioUnitario,
    }));
    const neto = lineas.reduce((a: number, l: any) => a + Number(l.subtotal), 0);
    const ivaPct = dto.ivaPct ?? 19;
    const ivaMonto = Math.round((neto * ivaPct) / 100);
    return this.prisma.factura.create({
      data: {
        tenantId,
        numero: dto.numero,
        clienteId: dto.clienteId,
        otId: dto.otId ?? null,
        neto,
        ivaMonto,
        total: neto + ivaMonto,
        estado: dto.estado ?? "emitida",
        origen: dto.origen ?? "sistema",
        lineas: { create: lineas },
      },
      include: { lineas: true },
    });
  }
  /** Saldo pendiente = total − pagos + notas de crédito. */
  async saldo(id: string) {
    const f = await this.detalle(id);
    const pagado = f.pagos.reduce((a: number, p: any) => a + Number(p.monto), 0);
    const nc = f.notasCredito.reduce((a: number, n: any) => a + Number(n.monto), 0);
    return { total: Number(f.total), pagado, notasCredito: nc, saldo: Number(f.total) - pagado - nc };
  }
}
const LineaFacturaDto = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number().positive().default(1),
  precioUnitario: z.number().nonnegative(),
});
const FacturaCreate = z.object({
  numero: z.string().min(1).max(30),
  clienteId: z.string().uuid(),
  otId: z.string().uuid().optional(),
  ivaPct: z.number().min(0).max(100).default(19),
  estado: z.enum(["emitida", "pagada", "anulada"]).default("emitida"),
  origen: z.string().max(20).optional(),
  lineas: z.array(LineaFacturaDto).min(1),
});
@ApiTags("facturas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("facturas")
export class FacturaController extends BaseCrudController {
  protected updateSchema = z.object({ estado: z.enum(["emitida", "pagada", "anulada"]) });
  constructor(protected svc: FacturaService) { super(); }

  @Post()
  crear(@Body() body: unknown) {
    return this.svc.crearConLineas(FacturaCreate.parse(body));
  }
  @Get(":id/saldo")
  saldo(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.saldo(id);
  }
}

/* ===================== PAGOS ===================== */
@Injectable()
export class PagoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "pago", search: ["referencia"], tenant: false, softDelete: false, orderBy: { fecha: "desc" } });
  }
}
const PagoCreate = z.object({
  facturaId: z.string().uuid(),
  monto: z.number().positive(),
  medio: z.string().max(40).optional(),
  referencia: z.string().max(80).optional(),
});
@ApiTags("pagos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("pagos")
export class PagoController extends BaseCrudController {
  protected createSchema = PagoCreate;
  protected updateSchema = PagoCreate.partial();
  constructor(protected svc: PagoService) { super(); }
}

/* ===================== NOTAS DE CRÉDITO ===================== */
@Injectable()
export class NotaCreditoService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: "notaCredito", search: ["numero"], tenant: false, softDelete: false, orderBy: { fecha: "desc" } });
  }
}
const NotaCreditoCreate = z.object({
  facturaId: z.string().uuid(),
  numero: z.string().min(1).max(30),
  monto: z.number().positive(),
  motivo: z.string().optional(),
});
@ApiTags("notas-credito") @ApiBearerAuth() @UseGuards(AuthGuard("jwt")) @Controller("notas-credito")
export class NotaCreditoController extends BaseCrudController {
  protected createSchema = NotaCreditoCreate;
  protected updateSchema = NotaCreditoCreate.partial();
  constructor(protected svc: NotaCreditoService) { super(); }
}

@Module({
  controllers: [FacturaController, PagoController, NotaCreditoController],
  providers: [FacturaService, PagoService, NotaCreditoService],
})
export class FacturacionModule {}
