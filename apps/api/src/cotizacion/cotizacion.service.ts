import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";
import { validarTransicion } from "../common/estados";
import { generarCodigoOt } from "../common/codigo";

@Injectable()
export class CotizacionService {
  constructor(private readonly prisma: PrismaService) {}

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

    // Réplica de SIS_COMERCIAL (ADM/imprimir.php:300-338):
    //   total_pagar = SUMA(líneas) − (SUMA × descuento%/100)   [IVA EXENTO]
    // El descuento se aplica sobre el gran total (suma de líneas), igual que el
    // legacy. Gastos administrativos e IVA son 0 salvo que se pidan (el original
    // no los tiene): así el total coincide 1:1 con la cotización original.
    const descuentoPct = Number(data.descuentoPct ?? 0);
    const gastosAdminPct = Number(data.gastosAdminPct ?? 0);
    const ivaPct = Number(data.ivaPct ?? 0);

    const subtotal = lineasConSubtotal.reduce(
      (acc: number, l: any) => acc + l.subtotal,
      0,
    );
    const descuentoMonto = subtotal * (descuentoPct / 100);
    const subtotalNeto = subtotal - descuentoMonto;
    const gastosAdminMonto = subtotalNeto * (gastosAdminPct / 100);
    const neto = subtotalNeto + gastosAdminMonto;
    const ivaMonto = neto * (ivaPct / 100);
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
        descuentoPct,
        descuentoMonto,
        gastosAdminPct,
        gastosAdminMonto,
        neto,
        ivaPct,
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

  /**
   * Editar campos permitidos (estado / notas) validando pertenencia al tenant.
   * Si el PATCH trae `estado`, se valida como transición: ya no se puede fijar
   * un estado arbitrario (era la brecha "PATCH {estado:'INVENTADO'} → 200").
   */
  async actualizar(id: string, data: { estado?: string; notas?: string }, tenantId?: string) {
    const actual = await this.detalle(id, tenantId); // valida existencia + pertenencia al tenant
    if (data.estado !== undefined) {
      validarTransicion("cotizacion", actual.estado, data.estado);
    }
    return this.prisma.cotizacion.update({ where: { id }, data });
  }

  /**
   * "Eliminar" cotización = anularla (estado 'anulada'). No se borra físicamente:
   * el modelo no tiene deleted_at y puede estar referenciada por una OT (cotizacion_id).
   */
  async anular(id: string, tenantId?: string) {
    return this.cambiarEstado(id, "anulada", tenantId);
  }

  async cambiarEstado(id: string, nuevoEstado: string, tenantId?: string) {
    const actual = await this.detalle(id, tenantId); // valida pertenencia al tenant
    validarTransicion("cotizacion", actual.estado, nuevoEstado);
    return this.prisma.cotizacion.update({
      where: { id },
      data: { estado: nuevoEstado },
    });
  }

  /**
   * Aceptar una cotización (RF-B04.1 · flujo F03). En UNA transacción:
   *   1. Valida la transición  → 'aceptada'.
   *   2. Marca la cotización aceptada.
   *   3. CREA la Orden de Trabajo asociada (esto era el `// TODO` que dejaba la
   *      cadena Cotización → OT → Expediente rota: la OT había que crearla a mano).
   *
   * La OT hereda cliente, planta y tenant de la cotización, y queda enlazada por
   * `cotizacionId`. El código se genera con el mismo helper que usa `POST /ot`.
   *
   * Idempotencia: si la cotización YA tiene una OT, no se crea una segunda; se
   * devuelve la existente. Evita duplicar OT si se reintenta la petición.
   *
   * NOTA: no se instancia el flujo BPM aquí. `POST /ot` solo instancia flujo
   * cuando el llamador indica flujoDefId/flujoVersionId, y no hay en el modelo
   * ninguna regla `{laboratorio, tipoEnsayo} → flujo` que permita resolverlo
   * automáticamente (el `resolverFlujoPlantilla` del diseño no existe en la BD).
   * La OT queda lista para adjuntarle su flujo con `POST /ot/:id/flujo`.
   */
  async aceptar(id: string, tenantId?: string) {
    const cot = await this.detalle(id, tenantId);
    validarTransicion("cotizacion", cot.estado, "aceptada");

    const tenantIdOt = cot.tenantId ?? tenantId ?? DEV_TENANT;

    const { cotizacion, ot } = await this.prisma.$transaction(async (tx) => {
      const existente = await tx.ordenTrabajo.findFirst({
        where: { cotizacionId: id, tenantId: tenantIdOt },
        include: { cliente: true },
      });

      const cotizacion = await tx.cotizacion.update({
        where: { id },
        data: { estado: "aceptada" },
        include: { cliente: true, lineas: true },
      });

      if (existente) return { cotizacion, ot: existente };

      const ot = await tx.ordenTrabajo.create({
        data: {
          tenantId: tenantIdOt,
          codigo: await generarCodigoOt(tx, tenantIdOt),
          clienteId: cot.clienteId,
          plantaId: cot.plantaId ?? null,
          cotizacionId: cot.id,
          prioridad: "normal",
          estado: "recepcionada", // estado inicial real (default del modelo)
          fechaRecepcion: new Date(),
          notas: `Generada automáticamente al aceptar la cotización ${cot.codigo}.`,
        },
        include: { cliente: true },
      });

      return { cotizacion, ot };
    });

    return {
      ok: true,
      cotizacion,
      ot,
      mensaje: `Cotización aceptada. Orden de trabajo ${ot.codigo} creada.`,
    };
  }

  async rechazar(id: string, motivo: string, tenantId?: string) {
    const actual = await this.detalle(id, tenantId); // valida pertenencia al tenant
    validarTransicion("cotizacion", actual.estado, "rechazada");
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
