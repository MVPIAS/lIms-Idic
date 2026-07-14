import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { DEV_TENANT } from "../common/base-crud.service";

@Injectable()
export class CotizacionService {
  private prisma = new PrismaClient();

  async listar(tenantId?: string) {
    return this.prisma.cotizacion.findMany({
      // Cotizacion tiene tenant_id: solo las del tenant del usuario.
      where: { ...(tenantId ? { tenantId } : {}) },
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { cliente: true, lineas: true },
    });
  }

  async detalle(id: string, tenantId?: string) {
    const cot = await this.prisma.cotizacion.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: {
        cliente: true,
        lineas: true,
        ejecutivo: true,
      },
    });
    if (!cot) throw new NotFoundException();
    return cot;
  }

  /**
   * Crea cotización + sus líneas + recalcula totales.
   * Replica los cálculos del legacy comercial:
   *   subtotal = SUMA(linea.subtotal)
   *   neto = subtotal - descuentoMonto + gastosAdminMonto
   *   iva = neto * (ivaPct / 100)
   *   total = neto + iva
   */
  async crear(data: any, tenantId?: string) {
    const tenantIdFromJWT = tenantId ?? DEV_TENANT;
    const codigo = await this.generarCodigo();

    // Calcular subtotales y totales
    const lineasConSubtotal = data.lineas.map((l: any, i: number) => {
      const subtotal = (l.cantidad ?? 1) * l.precioUnitario;
      return { ...l, orden: i + 1, subtotal };
    });

    const subtotal = lineasConSubtotal.reduce(
      (acc: number, l: any) => acc + l.subtotal,
      0,
    );
    const descuentoMonto = subtotal * (data.descuentoPct / 100);
    const subtotalNeto = subtotal - descuentoMonto;
    const gastosAdminMonto = subtotalNeto * (data.gastosAdminPct / 100);
    const neto = subtotalNeto + gastosAdminMonto;
    const ivaMonto = neto * (data.ivaPct / 100);
    const total = neto + ivaMonto;

    return this.prisma.cotizacion.create({
      data: {
        tenantId: tenantIdFromJWT,
        codigo,
        clienteId: data.clienteId,
        plantaId: data.plantaId,
        formato: data.formato,
        formaPago: data.formaPago,
        validezDias: data.validezDias,
        subtotal,
        descuentoPct: data.descuentoPct,
        descuentoMonto,
        gastosAdminPct: data.gastosAdminPct,
        gastosAdminMonto,
        neto,
        ivaPct: data.ivaPct,
        ivaMonto,
        total,
        notas: data.notas,
        estado: "borrador",
        lineas: {
          create: lineasConSubtotal,
        },
      },
      include: { lineas: true },
    });
  }

  async cambiarEstado(id: string, nuevoEstado: string, tenantId?: string) {
    await this.detalle(id, tenantId); // valida pertenencia al tenant
    return this.prisma.cotizacion.update({
      where: { id },
      data: { estado: nuevoEstado },
    });
  }

  /**
   * Al aceptar una cotización:
   * 1. Cambia su estado a 'aceptada'
   * 2. Dispara la generación de OT (placeholder · en producción dispara workflow BPM)
   */
  async aceptar(id: string, tenantId?: string) {
    const cot = await this.detalle(id, tenantId);

    await this.prisma.cotizacion.update({
      where: { id },
      data: { estado: "aceptada" },
    });

    // TODO: disparar workflow F03 que crea la OT
    // await this.workflowService.dispararEvento('cotizacion.aceptada', { cotizacionId: id });

    return { ok: true, cotizacion: cot, mensaje: "Cotización aceptada. OT se generará automáticamente." };
  }

  async rechazar(id: string, motivo: string, tenantId?: string) {
    await this.detalle(id, tenantId); // valida pertenencia al tenant
    return this.prisma.cotizacion.update({
      where: { id },
      data: { estado: "rechazada", notas: motivo },
    });
  }

  private async generarCodigo(): Promise<string> {
    const año = new Date().getFullYear();
    const ultima = await this.prisma.cotizacion.findFirst({
      where: { codigo: { startsWith: `COT-${año}-` } },
      orderBy: { codigo: "desc" },
      select: { codigo: true },
    });
    let n = 1;
    if (ultima) {
      const partes = ultima.codigo.split("-");
      n = parseInt(partes[2] ?? "0", 10) + 1;
    }
    return `COT-${año}-${String(n).padStart(4, "0")}`;
  }
}
