/**
 * Tipos y schemas compartidos entre api y web.
 */
import { z } from "zod";

// ─── Enums (mirror del schema.sql) ────────────────────────────────────────────

// Comercial R1 (oct-2026): las cotizaciones nuevas solo usan abierta/aceptada/anulada.
// borrador, en_cotizacion, enviada, rechazada y expirada quedan para el histórico.
export const CotizacionEstado = z.enum([
  "abierta", "aceptada", "anulada",
  "borrador", "en_cotizacion", "enviada", "rechazada", "expirada",
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

// 'extension' y 'comprension' (Tipo cotización Extensión/Comprensión del Sistema
// Comercial) se conservan SOLO para datos heredados: la UI ya no los ofrece (SVT1).
export const LineaCotizacionTipo = z.enum([
  "producto", "viatico", "pasaje", "hora_hombre", "hora_maquina",
  "otros", "extension", "comprension",
]);
export type LineaCotizacionTipo = z.infer<typeof LineaCotizacionTipo>;

// R1: formatos vigentes NORMAL y PERSONALIZADO; F1–F6 solo en el histórico.
export const FormatoCotizacion = z.enum(["NORMAL", "PERSONALIZADO", "F1", "F2", "F3", "F4", "F5", "F6"]);
/**
 * Frente f5: el LIMS trabaja solo en CLP y USD (regla de la API en
 * apps/api/src/common/moneda.ts; lista de las pantallas en el parámetro
 * `moneda`). UF, EUR o CLF solo aparecen en datos históricos migrados.
 */
export const Moneda = z.enum(["CLP", "USD"]);
/** R1: la cotización solo se emite en CLP o USD. */
export const MonedaCotizacion = Moneda;

/** SVT6 · documento de aceptación de la cotización (IDIC-PG03 6.3 n / 6.4 g). */
export const AceptacionTipo = z.enum(["OPI_RESOLUCION", "OC", "CORREO", "PAGO_ADELANTADO", "DISPOSICION_DIRECTOR"]);
export type AceptacionTipo = z.infer<typeof AceptacionTipo>;

/** SVT7 / SPC2.2 · origen de la OT (orden_trabajo.origen_trabajo). */
export const OrigenOt = z.enum(["COTIZACION", "INTERNACION", "DISPOSICION", "INTERLABORATORIO", "OT_INTERNA"]);
export type OrigenOt = z.infer<typeof OrigenOt>;

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
