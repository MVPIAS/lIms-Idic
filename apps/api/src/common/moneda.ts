/**
 * Monedas de la operación del LIMS (frente f5, Mapa de migración v2.1 ·
 * «Maestros y combos»): el IDIC trabaja SOLO en pesos chilenos y dólares.
 *
 * Es la regla única del backend. Todo lo que elige o valida una moneda (listas
 * de precio, cotización, gastos del costeo, OT, oportunidades, órdenes de
 * compra y la categoría `moneda` de «Parámetros del sistema») usa `zMoneda` o
 * `esMonedaOperacion`. La base lo impone con el disparador
 * `lims_moneda_operacion()` (align_f5_correcciones.sql) solo para lo nuevo: lo
 * que ya estaba guardado en UF, EUR u otra moneda (datos migrados) se conserva
 * tal cual, sin convertir, y se muestra como histórico de solo lectura.
 *
 * Las pantallas leen la lista del parámetro `moneda` (GET /parametros?categoria=moneda),
 * cuyas filas solo pueden ser estos códigos.
 */
import { z } from "zod";

export const MONEDAS_OPERACION = ["CLP", "USD"] as const;
export type MonedaOperacion = (typeof MONEDAS_OPERACION)[number];

export const MSJ_MONEDA = "El LIMS trabaja solo en CLP (pesos chilenos) y USD (dólares).";

/** Esquema zod de una moneda nueva: CLP o USD (en mayúsculas). */
export const zMoneda = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.enum(MONEDAS_OPERACION, { errorMap: () => ({ message: MSJ_MONEDA }) }),
);

/** ¿Es una moneda con la que se puede registrar algo nuevo? */
export function esMonedaOperacion(m: unknown): m is MonedaOperacion {
  return typeof m === "string" && (MONEDAS_OPERACION as readonly string[]).includes(m.trim().toUpperCase());
}

/** Moneda guardada antes de la regla (UF, EUR…): se muestra, no se edita. Vacía = CLP. */
export function esMonedaHistorica(m: unknown): boolean {
  return m != null && String(m).trim() !== "" && !esMonedaOperacion(m);
}
