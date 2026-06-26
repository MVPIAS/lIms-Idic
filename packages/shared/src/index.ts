/**
 * Tipos y schemas compartidos entre api y web.
 */
import { z } from "zod";

// ─── Enums (mirror del schema.sql) ────────────────────────────────────────────

export const CotizacionEstado = z.enum([
  "borrador", "en_cotizacion", "enviada", "aceptada", "rechazada", "expirada",
]);
export type CotizacionEstado = z.infer<typeof CotizacionEstado>;

export const OtEstado = z.enum([
  "en_proceso", "sin_plazo", "cerrada", "anulada", "aprobada",
  "en_revision", "atrasada", "bloqueada",
]);
export type OtEstado = z.infer<typeof OtEstado>;

export const OrdenCompraEstado = z.enum([
  "borrador", "aprobada", "en_proceso", "recibida", "cerrada", "anulada",
]);
export type OrdenCompraEstado = z.infer<typeof OrdenCompraEstado>;

export const LineaCotizacionTipo = z.enum([
  "producto", "viatico", "pasaje", "hora_hombre", "hora_maquina",
  "otros", "extension", "comprension",
]);
export type LineaCotizacionTipo = z.infer<typeof LineaCotizacionTipo>;

export const FormatoCotizacion = z.enum(["F1", "F2", "F3", "F4", "F5", "F6"]);
export const Moneda = z.enum(["CLP", "USD", "UF", "EUR", "CLF"]);

// ─── DTOs ────────────────────────────────────────────────────────────────────

export const ClienteDTO = z.object({
  id: z.string().uuid(),
  codigo: z.string().nullable(),
  rut: z.string(),
  razonSocial: z.string(),
  tipo: z.string().nullable(),
  bloqueado: z.boolean(),
  saldoActual: z.number(),
});
export type ClienteDTO = z.infer<typeof ClienteDTO>;

export const LineaCotizacionDTO = z.object({
  tipo: LineaCotizacionTipo,
  descripcion: z.string().optional(),
  categoria: z.string().optional(),
  cantidad: z.number().int().positive().default(1),
  precioUnitario: z.number().positive(),
  subtotal: z.number(),
});
export type LineaCotizacionDTO = z.infer<typeof LineaCotizacionDTO>;

// ─── Validadores chilenos ────────────────────────────────────────────────────

export function validaRut(rut: string | null | undefined): boolean {
  if (!rut) return false;
  const cleaned = rut.replace(/[^0-9Kk]/g, "").toUpperCase();
  if (cleaned.length < 2) return false;
  const numbers = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  let s = 0, m = 2;
  for (let i = numbers.length - 1; i >= 0; i--) {
    s += parseInt(numbers[i], 10) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const resto = 11 - (s % 11);
  const expected = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === expected;
}
