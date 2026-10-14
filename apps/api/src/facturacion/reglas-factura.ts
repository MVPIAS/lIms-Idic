/**
 * Reglas PURAS de la factura generada al cerrar la OT y del cobro (sin BD).
 * Probadas en reglas-factura.spec.ts. Contrato: docs/FLUJO_FIRMA_CIERRE.md.
 *
 * Estados: pendiente (borrador «Pendiente de facturar», lo crea el cierre de
 * la OT) → emitida (Finanzas la revisa y le da el folio) → parcial (pagos que
 * no cubren el total) → pagada; anulada. aviso_1..cde: cobranza heredada.
 */

export const ESTADOS_FACTURA = ["pendiente", "emitida", "parcial", "pagada", "anulada"] as const;

export interface LineaBorrador {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface CotizacionFactura {
  codigo: string;
  moneda?: string | null;
  neto: number | string | { toString(): string };
  ivaPct: number | string | { toString(): string };
  descuentoPct?: number | string | { toString(): string } | null;
  descuentoMonto?: number | string | { toString(): string } | null;
  gastosAdminPct?: number | string | { toString(): string } | null;
  gastosAdminMonto?: number | string | { toString(): string } | null;
  lineas: {
    descripcion?: string | null;
    categoria?: string | null;
    tipo?: string | null;
    ensayoCodigo?: string | null;
    cantidad: number;
    precioUnitario: number | string | { toString(): string };
    subtotal: number | string | { toString(): string };
    orden?: number | null;
  }[];
}

const n = (v: unknown): number => {
  const x = Number(typeof v === "object" && v !== null ? String(v) : v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Redondeo de importes: pesos sin decimales; otras monedas a 2 decimales. */
export function redondear(v: number, moneda: string | null | undefined): number {
  return (moneda ?? "CLP").toUpperCase() === "CLP" ? Math.round(v) : Math.round(v * 100) / 100;
}

const pct = (v: unknown) => {
  const x = n(v);
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(".", ",");
};

/**
 * Líneas de la factura a partir de la cotización ACEPTADA: una por línea de la
 * cotización, más el descuento y los gastos administrativos globales, y un
 * ajuste si aún quedara diferencia con el neto aceptado (redondeos, utilidad).
 * Garantiza que la suma de las líneas es exactamente el neto de la cotización.
 */
export function lineasDesdeCotizacion(cot: CotizacionFactura): LineaBorrador[] {
  const moneda = cot.moneda ?? "CLP";
  const lineas: LineaBorrador[] = [...cot.lineas]
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map((l) => {
      const cantidad = Math.max(1, Number(l.cantidad) || 1);
      const subtotal = redondear(n(l.subtotal), moneda);
      const desc = [l.ensayoCodigo, l.descripcion ?? l.categoria ?? l.tipo ?? "Servicio"].filter(Boolean).join(" · ");
      return { descripcion: desc, cantidad, precioUnitario: redondear(subtotal / cantidad, moneda), subtotal };
    });
  const descuento = redondear(n(cot.descuentoMonto), moneda);
  if (descuento > 0)
    lineas.push({ descripcion: `Descuento (${pct(cot.descuentoPct)} %)`, cantidad: 1, precioUnitario: -descuento, subtotal: -descuento });
  const gastos = redondear(n(cot.gastosAdminMonto), moneda);
  if (gastos > 0)
    lineas.push({ descripcion: `Gastos administrativos (${pct(cot.gastosAdminPct)} %)`, cantidad: 1, precioUnitario: gastos, subtotal: gastos });
  const suma = lineas.reduce((a, l) => a + l.subtotal, 0);
  const diff = redondear(n(cot.neto) - suma, moneda);
  if (Math.abs(diff) >= (moneda.toUpperCase() === "CLP" ? 1 : 0.01))
    lineas.push({ descripcion: `Ajuste según cotización ${cot.codigo}`, cantidad: 1, precioUnitario: diff, subtotal: diff });
  return lineas;
}

/** Neto, IVA y total de unas líneas. */
export function totales(lineas: { subtotal: number }[], ivaPct: number, moneda?: string | null) {
  const neto = redondear(lineas.reduce((a, l) => a + n(l.subtotal), 0), moneda);
  const ivaMonto = redondear((neto * ivaPct) / 100, moneda);
  return { neto, ivaMonto, total: redondear(neto + ivaMonto, moneda) };
}

/** Número provisional del borrador: Finanzas le asigna el folio real al emitirla. */
export function numeroBorrador(otCodigo: string): string {
  return `PEND-${otCodigo}`.slice(0, 30);
}
export const esNumeroBorrador = (numero: string) => /^PEND-/i.test(numero);

/** Estado de una factura emitida según lo pagado (y las notas de crédito). */
export function estadoPorPagos(total: number, pagado: number, notasCredito = 0): "emitida" | "parcial" | "pagada" {
  const saldo = total - pagado - notasCredito;
  if (saldo <= 0.005) return "pagada";
  if (pagado + notasCredito > 0) return "parcial";
  return "emitida";
}

/** ¿Se puede registrar este pago? Devuelve el motivo si no. */
export function validarPago(estado: string, saldo: number, monto: number): string | null {
  if (estado === "pendiente") return "La factura está pendiente de emitir: Finanzas debe emitirla antes de registrar pagos.";
  if (estado === "anulada") return "La factura está anulada.";
  if (estado === "pagada" || saldo <= 0.005) return "La factura ya está pagada.";
  if (!(monto > 0)) return "El monto del pago debe ser mayor que cero.";
  if (monto - saldo > 0.005) return `El pago (${monto}) supera el saldo pendiente (${saldo}).`;
  return null;
}
