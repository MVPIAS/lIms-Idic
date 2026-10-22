/**
 * Munición de prueba de la D11 (EP-11 11.40 y 11.17; EP-05 2.5 y 3.4):
 * reglas PURAS del inventario por lote y de la orden interna LRB/LAM → D11,
 * probadas en municion.spec.ts.
 */
import { z } from "zod";

export const TIPOS_MOVIMIENTO = ["entrada", "entrega", "devolucion", "uso", "ajuste_baja"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export const NOMBRE_MOVIMIENTO: Record<TipoMovimiento, string> = {
  entrada: "Entrada al inventario",
  entrega: "Entrega a un laboratorio",
  devolucion: "Devolución de un laboratorio",
  uso: "Uso en prueba de fuego (D11)",
  ajuste_baja: "Baja por ajuste",
};

/** Entradas y devoluciones suman; entregas, usos y bajas restan. */
export const signo = (t: TipoMovimiento) => (t === "entrada" || t === "devolucion" ? 1 : -1);

export function saldo(movs: { tipo: TipoMovimiento; cantidad: number }[]): number {
  return movs.reduce((s, m) => s + signo(m.tipo) * m.cantidad, 0);
}

/** Una salida (entrega, uso o baja) no puede dejar el lote en negativo. */
export function erroresSalida(lote: { lote: string; activo: boolean; saldo: number }, cantidad: number): string[] {
  if (!Number.isInteger(cantidad) || cantidad < 1) return ["La cantidad de cartuchos debe ser un entero mayor que cero."];
  if (!lote.activo) return [`El lote ${lote.lote} está dado de baja.`];
  if (cantidad > lote.saldo) return [`El lote ${lote.lote} tiene ${lote.saldo} cartucho(s); no alcanza para ${cantidad}.`];
  return [];
}

/** Acta de cierre: lo entregado se reparte entre usados y devueltos, sin sobrantes ni faltantes. */
export function erroresCierre(entregados: number, usados: number, devueltos: number): string[] {
  const e: string[] = [];
  if (!Number.isInteger(usados) || usados < 0) e.push("Cartuchos usados: entero desde 0.");
  if (!Number.isInteger(devueltos) || devueltos < 0) e.push("Cartuchos devueltos: entero desde 0.");
  if (!e.length && usados + devueltos !== entregados)
    e.push(`No cuadra: se entregaron ${entregados} y se rinden ${usados} usados + ${devueltos} devueltos = ${usados + devueltos}.`);
  return e;
}

/** Estados de la orden interna y qué se puede hacer en cada uno. */
export const ESTADOS_SOLICITUD = ["solicitada", "entregada", "cerrada", "anulada"] as const;
export const NOMBRE_ESTADO_SOLICITUD: Record<(typeof ESTADOS_SOLICITUD)[number], string> = {
  solicitada: "Solicitada · espera entrega de la D11",
  entregada: "Entregada · espera el acta de usados y devueltos",
  cerrada: "Cerrada · cuadrada",
  anulada: "Anulada",
};

const num = (max: number) => z.number().finite().min(0).max(max).optional().nullable();
const txt = (max: number) => z.string().trim().max(max);

export const LoteBody = z.object({
  lote: txt(60).min(1, "Indique el lote de origen."),
  calibre: txt(80).min(1, "Indique el calibre."),
  descripcion: txt(200).optional().nullable(),
  norma: txt(80).optional().nullable(),
  nivel: txt(40).optional().nullable(),
  masaBalaG: num(1000),
  velocidadMs: num(3000),
  cantidad: z.number().int().min(1, "La cantidad inicial debe ser mayor que cero.").max(1_000_000),
});
export const MovimientoLoteBody = z.object({
  tipo: z.enum(["entrada", "ajuste_baja"]),
  cantidad: z.number().int().min(1).max(1_000_000),
  observaciones: txt(1000).optional().nullable(),
});
export const SolicitudBody = z.object({
  unidadId: z.string().uuid("Elija el laboratorio solicitante."),
  otId: z.string().uuid().optional().nullable(),
  itemHcp: txt(80).optional().nullable(),
  norma: txt(80).min(1, "Indique la norma del ensayo."),
  nivel: txt(40).optional().nullable(),
  calibre: txt(80).min(1, "Indique el calibre."),
  masaBalaG: num(1000),
  velocidadMs: num(3000),
  velocidadTolMs: num(500),
  cantidadPedida: z.number().int().min(1, "Indique cuántos cartuchos se piden.").max(100_000),
  observaciones: txt(1000).optional().nullable(),
});
export const EntregaBody = z.object({
  loteId: z.string().uuid("Elija el lote de origen."),
  cantidad: z.number().int().min(1).max(100_000),
  observaciones: txt(1000).optional().nullable(),
});
export const CierreBody = z.object({
  usados: z.number().int().min(0),
  devueltos: z.number().int().min(0),
  observaciones: txt(1000).optional().nullable(),
});
/** 11.17 · munición gastada en la prueba de fuego de un arma (opcional al guardar sus ensayos). */
export const UsoFuegoBody = z.object({ loteId: z.string().uuid("Elija el lote de munición."), cartuchos: z.number().int().min(1).max(10_000) });

/** El calibre del lote y el pedido deben coincidir (sin distinguir mayúsculas ni espacios). */
export const mismoCalibre = (a: string, b: string) => a.replace(/\s+/g, "").toUpperCase() === b.replace(/\s+/g, "").toUpperCase();
