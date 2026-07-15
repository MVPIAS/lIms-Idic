import { Body, Controller, Get, Module, Param, Post, Req, UseGuards, Injectable, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";

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
  async crearConLineas(dto: any, tenantId: string = DEV_TENANT) {
    tenantId = tenantId ?? DEV_TENANT;
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
  async saldo(id: string, tenantId?: string) {
    const f = await this.detalle(id, tenantId); // scope por tenant (404 si es de otro)
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
/**
 * `editar` usa `factura.cobrar`: el PATCH de una factura solo cambia su estado
 * (emitida/pagada/anulada), que es el acto de cobranza.
 *
 * NOTA: la máquina de estados de factura (emitida → pagada | aviso_1 → aviso_2 →
 * aviso_3 → prejudicial → cde, schema.sql:981) NO se implementa aquí: el enum Zod
 * vigente solo admite emitida/pagada/anulada y el escalamiento de cobranza a CDE
 * (RF-B06.3 / flujo F18) está ausente del producto. Ampliarlo es trabajo aparte;
 * este cambio no toca ese contrato para no romper lo que hoy funciona.
 */
@ApiTags("facturas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("facturas")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "factura.emitir",
  editar: "factura.cobrar",
  eliminar: "factura.emitir",
})
export class FacturaController extends BaseCrudController {
  protected updateSchema = z.object({ estado: z.enum(["emitida", "pagada", "anulada"]) });
  constructor(protected svc: FacturaService) { super(); }

  @Post()
  @RequierePermiso("factura.emitir")
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearConLineas(FacturaCreate.parse(body), req?.user?.tenantId);
  }
  @Get(":id/saldo")
  @RequierePermiso("factura.ver")
  saldo(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.saldo(id, req?.user?.tenantId);
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
@ApiTags("pagos") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("pagos")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "factura.cobrar",
  editar: "factura.cobrar",
  eliminar: "factura.cobrar",
})
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
/**
 * OJO con `nc.gestionar`: NO es "nota de crédito". Está asignado a DIRECTOR,
 * JEFE_LAB y CALIDAD (perfiles de calidad, no de finanzas), luego es
 * "No Conformidad" (17025). Por eso la nota de crédito se protege con
 * `factura.emitir` y no con `nc.gestionar`. Hoy `nc.gestionar` no protege ningún
 * controlador porque el módulo de No Conformidades no existe: anotado.
 */
@ApiTags("notas-credito") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("notas-credito")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "factura.emitir",
  editar: "factura.emitir",
  eliminar: "factura.emitir",
})
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
