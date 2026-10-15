import {
  Body, Controller, Get, Module, Param, Patch, Post, Put, Query, Req, UseGuards, Injectable, ParseUUIDPipe,
  ConflictException, ForbiddenException, Delete, BadRequestException, NotFoundException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import {
  ESTADOS_FACTURA,
  esNumeroBorrador,
  estadoPorPagos,
  lineasDesdeCotizacion,
  numeroBorrador,
  totales,
  validarNotaCredito,
  validarPago,
} from "./reglas-factura";

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
        ivaPct,
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
    return { total: Number(f.total), pagado, notasCredito: nc, saldo: Number(f.total) - pagado - nc, estado: f.estado };
  }
  /** ¿Otra factura del tenant ya usa ese número? (UNIQUE(tenant_id, numero)). */
  async numeroOcupado(numero: string, exceptoId: string, tenantId?: string) {
    const otra = await this.prisma.factura.findFirst({
      where: { tenantId: tenantId ?? DEV_TENANT, numero, NOT: { id: exceptoId } },
      select: { id: true },
    });
    return !!otra;
  }

  /**
   * Listado para Finanzas con filtro por estado (?estado=pendiente = «Pendiente
   * de facturar», ?estado=por_cobrar = emitidas y con pago parcial) y, por fila,
   * cliente, OT, lo pagado y el saldo.
   */
  async listarFinanzas(q: { page?: number; limit?: number; search?: string; estado?: string }, tenantId?: string) {
    const where: any = {};
    if (q.estado) where.estado = q.estado === "por_cobrar" ? { in: ["emitida", "parcial"] } : q.estado;
    const r = await this.listar({ page: q.page, limit: q.limit, search: q.search, where }, tenantId);
    const clienteIds = [...new Set(r.data.map((f: any) => f.clienteId).filter(Boolean))] as string[];
    const otIds = [...new Set(r.data.map((f: any) => f.otId).filter(Boolean))] as string[];
    const [clientes, ots] = await Promise.all([
      clienteIds.length
        ? this.prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, razonSocial: true, rut: true } })
        : Promise.resolve([] as { id: string; razonSocial: string; rut: string | null }[]),
      otIds.length
        ? this.prisma.ordenTrabajo.findMany({ where: { id: { in: otIds } }, select: { id: true, codigo: true } })
        : Promise.resolve([] as { id: string; codigo: string }[]),
    ]);
    const cli = new Map<string, any>(clientes.map((c) => [c.id, c]));
    const otm = new Map<string, any>(ots.map((o) => [o.id, o]));
    return {
      ...r,
      data: r.data.map((f: any) => {
        const pagado = (f.pagos ?? []).reduce((a: number, p: any) => a + Number(p.monto), 0);
        const nc = (f.notasCredito ?? []).reduce((a: number, x: any) => a + Number(x.monto), 0);
        return {
          ...f,
          cliente: cli.get(f.clienteId) ?? null,
          ot: f.otId ? otm.get(f.otId) ?? null : null,
          pagado,
          saldo: Number(f.total) - pagado - nc,
        };
      }),
    };
  }

  /**
   * Factura en BORRADOR («pendiente») al cerrar una OT con cobro. Va dentro de
   * la transacción del cierre (`tx`). Importes, moneda, IVA y centro de costo
   * salen de la cotización ACEPTADA de la OT; si la OT no tiene cotización (o
   * no está aceptada) el borrador nace sin líneas y Finanzas las completa antes
   * de emitir. Idempotente: si ya existe la factura del cierre de esa OT, la devuelve.
   */
  async crearBorradorDesdeOt(
    tx: any,
    ot: { id: string; codigo: string; tenantId: string; clienteId: string; cotizacionId: string | null; centroCostoId: string | null },
    usuarioId: string | null,
  ) {
    const existente = await tx.factura.findFirst({
      where: { otId: ot.id, origen: "cierre_ot", deletedAt: null, NOT: { estado: "anulada" } },
      include: { lineas: true },
    });
    if (existente) return existente;

    const cot = ot.cotizacionId
      ? await tx.cotizacion.findFirst({ where: { id: ot.cotizacionId, tenantId: ot.tenantId }, include: { lineas: true } })
      : null;
    const aceptada = cot && cot.estado === "aceptada" ? cot : null;
    const moneda = aceptada?.moneda ?? "CLP";
    const ivaPct = aceptada ? Number(aceptada.ivaPct) : 19;
    const lineas = aceptada ? lineasDesdeCotizacion(aceptada) : [];
    const t = totales(lineas, ivaPct, moneda);
    const obs = aceptada
      ? `Generada al cerrar la OT ${ot.codigo} con los importes de la cotización ${aceptada.codigo}.`
      : cot
        ? `Generada al cerrar la OT ${ot.codigo}. La cotización ${cot.codigo} no está aceptada (${cot.estado}): complete las líneas antes de emitir.`
        : `Generada al cerrar la OT ${ot.codigo}, que no tiene cotización: complete las líneas antes de emitir.`;
    return tx.factura.create({
      data: {
        tenantId: ot.tenantId,
        numero: numeroBorrador(ot.codigo),
        clienteId: ot.clienteId,
        otId: ot.id,
        cotizacionId: cot?.id ?? null,
        centroCostoId: ot.centroCostoId ?? aceptada?.centroCostoId ?? null,
        moneda,
        ivaPct,
        neto: t.neto,
        ivaMonto: t.ivaMonto,
        total: t.total,
        estado: "pendiente",
        origen: "cierre_ot",
        observaciones: obs,
        creadaPor: usuarioId,
        lineas: { create: lineas },
      },
      include: { lineas: true },
    });
  }

  /** Finanzas revisa el borrador y lo EMITE con el folio real. */
  async emitir(id: string, dto: { numero: string; fechaEmision?: Date }, tenantId: string | undefined, usuarioId: string | null) {
    const f = await this.detalle(id, tenantId);
    if (f.estado !== "pendiente")
      throw new ConflictException(`La factura ${f.numero} no está pendiente de emitir (estado: ${f.estado}).`);
    if (esNumeroBorrador(dto.numero))
      throw new BadRequestException("Indique el folio real de la factura (no el provisional PEND-).");
    if (!f.lineas.length || Number(f.total) <= 0)
      throw new ConflictException("La factura no tiene importes: complete las líneas antes de emitirla.");
    if (await this.numeroOcupado(dto.numero, id, tenantId))
      throw new ConflictException(`Ya existe otra factura con el número ${dto.numero}`);
    return this.prisma.factura.update({
      where: { id },
      data: {
        numero: dto.numero,
        fechaEmision: dto.fechaEmision ?? new Date(),
        estado: "emitida",
        emitidaPor: usuarioId,
        emitidaAt: new Date(),
      },
      include: { lineas: true, pagos: true, notasCredito: true },
    });
  }

  /** Corrige las líneas de un borrador (solo «pendiente»): recalcula neto, IVA y total. */
  async reemplazarLineas(
    id: string,
    dto: { lineas: { descripcion: string; cantidad: number; precioUnitario: number }[]; ivaPct?: number; observaciones?: string },
    tenantId?: string,
  ) {
    const f = await this.detalle(id, tenantId);
    if (f.estado !== "pendiente")
      throw new ConflictException(`Solo se corrigen las líneas de una factura pendiente de emitir (estado: ${f.estado}).`);
    const lineas = dto.lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      subtotal: l.cantidad * l.precioUnitario,
    }));
    const ivaPct = dto.ivaPct ?? Number(f.ivaPct ?? 19);
    const t = totales(lineas, ivaPct, f.moneda);
    return this.prisma.$transaction(async (tx) => {
      await tx.lineaFactura.deleteMany({ where: { facturaId: id } });
      return tx.factura.update({
        where: { id },
        data: {
          ivaPct,
          neto: t.neto,
          ivaMonto: t.ivaMonto,
          total: t.total,
          ...(dto.observaciones !== undefined ? { observaciones: dto.observaciones } : {}),
          lineas: { create: lineas },
        },
        include: { lineas: true, pagos: true, notasCredito: true },
      });
    });
  }

  /** Recalcula el estado de una factura emitida según sus pagos y notas de crédito. */
  async recalcularEstado(facturaId: string, tx: any = this.prisma) {
    const f = await tx.factura.findUnique({ where: { id: facturaId }, include: { pagos: true, notasCredito: true } });
    if (!f || !["emitida", "parcial", "pagada"].includes(f.estado)) return f;
    const pagado = f.pagos.reduce((a: number, p: any) => a + Number(p.monto), 0);
    const nc = f.notasCredito.reduce((a: number, x: any) => a + Number(x.monto), 0);
    const estado = estadoPorPagos(Number(f.total), pagado, nc);
    if (estado !== f.estado) await tx.factura.update({ where: { id: facturaId }, data: { estado } });
    return { ...f, estado };
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
  // Una factura manual nace emitida (o pendiente, como borrador). Los estados
  // parcial/pagada los fija el registro de pagos, no el alta.
  estado: z.enum(["pendiente", "emitida"]).default("emitida"),
  origen: z.string().max(20).optional(),
  lineas: z.array(LineaFacturaDto).min(1),
});
const FacturaEmitir = z.object({
  numero: z.string().trim().min(1, "Indique el folio de la factura").max(30),
  fechaEmision: z.coerce.date().optional(),
});
/** Las líneas de ajuste (descuento) pueden ser negativas. */
const FacturaLineas = z.object({
  lineas: z
    .array(z.object({ descripcion: z.string().trim().min(1), cantidad: z.number().positive(), precioUnitario: z.number() }))
    .min(1, "La factura necesita al menos una línea"),
  ivaPct: z.number().min(0).max(100).optional(),
  observaciones: z.string().max(2000).optional(),
});
/**
 * PATCH /facturas/:id · datos SEGUROS del documento (nunca montos: neto/IVA/total
 * se derivan de las líneas al emitir).
 *   - `estado` → solo «anulada» (acto de cobranza: `factura.cobrar`). Emitir va
 *     por POST /facturas/:id/emitir; parcial/pagada los calcula el registro de pagos.
 *   - `numero`, `fechaEmision`, `origen` → corrección del documento emitido:
 *     exige ADEMÁS `factura.emitir` (quien cobra no reescribe el folio).
 */
const FacturaUpdate = z
  .object({
    estado: z.enum(["anulada"]).optional(),
    numero: z.string().trim().min(1).max(30).optional(),
    fechaEmision: z.coerce.date().optional(),
    origen: z.string().max(20).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Nada que actualizar: indique estado, número, fecha u origen",
  });

/** ¿El usuario del request tiene el permiso? (SUPERADMIN siempre). */
function tienePermiso(req: any, codigo: string): boolean {
  const u = req?.user ?? {};
  return (u.roles ?? []).includes("SUPERADMIN") || (u.permisos ?? []).includes(codigo);
}

/**
 * `editar` usa `factura.cobrar`: el PATCH de estado (anular) es un acto de
 * cobranza. Ver FacturaUpdate para los campos del documento.
 *
 * NOTA: el escalamiento de cobranza (aviso_1 → aviso_2 → aviso_3 → prejudicial
 * → cde, schema.sql:981, RF-B06.3 / flujo F18) sigue fuera del producto.
 */
@ApiTags("facturas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard) @Controller("facturas")
@RequierePermisoCrud({
  ver: "factura.ver",
  crear: "factura.emitir",
  editar: "factura.cobrar",
  eliminar: "factura.emitir",
})
export class FacturaController extends BaseCrudController {
  protected updateSchema = FacturaUpdate;
  constructor(protected svc: FacturaService) { super(); }

  /** Listado con filtro por estado (?estado=pendiente | por_cobrar | emitida | parcial | pagada | anulada). */
  @Get()
  @RequierePermiso("factura.ver")
  listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Req() req?: any,
    @Query("estado") estado?: string,
  ) {
    const e = estado && ([...ESTADOS_FACTURA, "por_cobrar"] as string[]).includes(estado) ? estado : undefined;
    return this.svc.listarFinanzas({ page: parseInt(page), limit: parseInt(limit), search, estado: e }, req?.user?.tenantId);
  }

  @Patch(":id")
  @RequierePermiso("factura.cobrar")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = FacturaUpdate.parse(body);
    const tocaDocumento = dto.numero !== undefined || dto.fechaEmision !== undefined || dto.origen !== undefined;
    if (tocaDocumento && !tienePermiso(req, "factura.emitir")) {
      throw new ForbiddenException("Corregir número, fecha u origen de una factura requiere factura.emitir");
    }
    const tenantId = req?.user?.tenantId;
    if (dto.numero !== undefined) {
      // UNIQUE(tenant_id, numero): se responde 409 legible en vez de un 500 de Prisma.
      if (await this.svc.numeroOcupado(dto.numero, id, tenantId)) {
        throw new ConflictException(`Ya existe otra factura con el número ${dto.numero}`);
      }
    }
    if (dto.estado === "anulada") {
      const s = await this.svc.saldo(id, tenantId);
      if (s.pagado > 0)
        throw new ConflictException("La factura tiene pagos registrados: no se anula. Emita una nota de crédito.");
    }
    return this.svc.actualizar(id, dto, tenantId);
  }

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

  /** Finanzas emite el borrador «Pendiente de facturar» con el folio real. */
  @Post(":id/emitir")
  @RequierePermiso("factura.emitir")
  emitir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.emitir(id, FacturaEmitir.parse(body ?? {}), req?.user?.tenantId, req?.user?.sub ?? null);
  }

  /** Corrige las líneas de un borrador antes de emitirlo. */
  @Put(":id/lineas")
  @RequierePermiso("factura.emitir")
  lineas(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.reemplazarLineas(id, FacturaLineas.parse(body ?? {}), req?.user?.tenantId);
  }
}

/* ===================== PAGOS ===================== */
@Injectable()
export class PagoService extends BaseCrudService {
  constructor(
    prisma: PrismaService,
    private readonly facturas: FacturaService,
  ) {
    super(prisma, { model: "pago", search: ["referencia"], include: { factura: true }, tenant: false, softDelete: false, orderBy: { fecha: "desc" } });
  }

  /** `pago` no tiene tenant_id: se acota por el tenant de su factura. */
  async listar(q: { page?: number; limit?: number; search?: string; where?: any } = {}, tenantId?: string) {
    return super.listar({ ...q, where: { ...(q.where ?? {}), ...(tenantId ? { factura: { tenantId } } : {}) } });
  }
  async detalle(id: string, tenantId?: string) {
    const p = await super.detalle(id);
    if (tenantId && p.factura?.tenantId !== tenantId) throw new NotFoundException(`pago ${id} no encontrado`);
    return p;
  }

  /**
   * Registra un pago: la factura debe estar emitida (o con pago parcial) y el
   * monto no puede superar el saldo. Actualiza el estado (parcial / pagada).
   */
  async registrar(dto: { facturaId: string; monto: number; medio?: string; referencia?: string; fecha?: Date }, tenantId?: string) {
    const s = await this.facturas.saldo(dto.facturaId, tenantId); // 404 si es de otro tenant
    const motivo = validarPago(s.estado, s.saldo, dto.monto);
    if (motivo) throw new ConflictException(motivo);
    return this.prisma.$transaction(async (tx) => {
      const pago = await tx.pago.create({
        data: {
          facturaId: dto.facturaId,
          monto: dto.monto,
          medio: dto.medio ?? null,
          referencia: dto.referencia ?? null,
          ...(dto.fecha ? { fecha: dto.fecha } : {}),
        },
      });
      const factura = await this.facturas.recalcularEstado(dto.facturaId, tx);
      return { ...pago, factura: factura ? { id: factura.id, numero: factura.numero, estado: factura.estado } : null };
    });
  }

  /** Borrar un pago (corrección) recalcula el estado de la factura. */
  async eliminar(id: string, tenantId?: string) {
    const p = await this.detalle(id, tenantId);
    return this.prisma.$transaction(async (tx) => {
      await tx.pago.delete({ where: { id } });
      await this.facturas.recalcularEstado(p.facturaId, tx);
      return { ok: true, id };
    });
  }
}
const PagoCreate = z.object({
  facturaId: z.string().uuid(),
  monto: z.number().positive(),
  medio: z.string().max(40).optional(),
  referencia: z.string().max(80).optional(),
  fecha: z.coerce.date().optional(),
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

  @Post()
  @RequierePermiso("factura.cobrar")
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.registrar(PagoCreate.parse(body), req?.user?.tenantId);
  }

  /** Un pago no se edita (cambiaría el saldo sin rastro): se elimina y se registra de nuevo. */
  @Patch(":id")
  @RequierePermiso("factura.cobrar")
  actualizar(): never {
    throw new BadRequestException("Un pago no se modifica: elimínelo y regístrelo de nuevo.");
  }

  @Delete(":id")
  @RequierePermiso("factura.cobrar")
  eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.eliminar(id, req?.user?.tenantId);
  }
}

/* ===================== NOTAS DE CRÉDITO ===================== */
@Injectable()
export class NotaCreditoService extends BaseCrudService {
  constructor(prisma: PrismaService, private readonly facturas: FacturaService) {
    super(prisma, { model: "notaCredito", search: ["numero"], include: { factura: true }, tenant: false, softDelete: false, orderBy: { fecha: "desc" } });
  }

  /**
   * Alta de nota de crédito: la factura debe estar emitida (o con pagos) y la
   * nota no puede superar el saldo. Recalcula el estado de la factura en la
   * misma transacción (una factura saldada solo con notas queda «pagada»).
   */
  async crear(data: any, tenantId?: string) {
    const s = await this.facturas.saldo(data.facturaId, tenantId); // 404 si es de otro tenant
    const motivo = validarNotaCredito(s.estado, s.saldo, Number(data.monto));
    if (motivo) throw new ConflictException(motivo);
    return this.prisma.$transaction(async (tx) => {
      const nc = await tx.notaCredito.create({ data: { facturaId: data.facturaId, numero: data.numero, monto: data.monto, motivo: data.motivo ?? null } });
      await this.facturas.recalcularEstado(data.facturaId, tx);
      return nc;
    });
  }

  /** Editar el monto o la factura revalida el saldo y recalcula ambas facturas. */
  async actualizar(id: string, data: any, tenantId?: string) {
    const actual: any = await this.detalle(id, tenantId);
    const facturaId = data.facturaId ?? actual.facturaId;
    const monto = data.monto !== undefined ? Number(data.monto) : Number(actual.monto);
    const s = await this.facturas.saldo(facturaId, tenantId);
    // El saldo ya descuenta la propia nota si sigue en la misma factura.
    const saldoSinEsta = s.saldo + (facturaId === actual.facturaId ? Number(actual.monto) : 0);
    const motivo = validarNotaCredito(s.estado, saldoSinEsta, monto);
    if (motivo) throw new ConflictException(motivo);
    return this.prisma.$transaction(async (tx) => {
      const { tenantId: _t, ...rest } = data ?? {};
      const nc = await tx.notaCredito.update({ where: { id }, data: rest });
      await this.facturas.recalcularEstado(facturaId, tx);
      if (facturaId !== actual.facturaId) await this.facturas.recalcularEstado(actual.facturaId, tx);
      return nc;
    });
  }

  /** Eliminar una nota de crédito (corrección) recalcula el estado de su factura. */
  async eliminar(id: string, tenantId?: string) {
    const actual: any = await this.detalle(id, tenantId);
    return this.prisma.$transaction(async (tx) => {
      await tx.notaCredito.delete({ where: { id } });
      await this.facturas.recalcularEstado(actual.facturaId, tx);
      return { ok: true, id };
    });
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
  // El cierre de la OT (ot/ot-cierre.controller.ts) crea el borrador de factura.
  exports: [FacturaService],
})
export class FacturacionModule {}
