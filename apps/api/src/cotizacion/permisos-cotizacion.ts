/**
 * Reglas de la cotización que no dependen de la BD (docs/FLUJO_COMERCIAL_USUARIOS.md).
 *
 * Permisos (Comercial R2: la Sección Ventas registra la aceptación y con ella
 * nace la OT):
 *   · `cotizacion.crear`   → cotizar y editar una Abierta (Ventas y Planificación).
 *   · `cotizacion.aceptar` → registrar la aceptación (OC, OPI/resolución, correo,
 *                            pago adelantado, disposición del Director). Genera la OT.
 *   · `cotizacion.anular`  → anular una Abierta (con motivo) o rechazar una histórica.
 *   · `cotizacion.aprobar` → se conserva para jefaturas/dirección; quien lo tenía
 *                            recibe también aceptar y anular (align_comercial_usuarios.sql).
 */
import { ESTADOS_QUE_VENCEN, estaVencida, fechaLegible } from "./validez";

export const PERMISO_ACEPTAR = "cotizacion.aceptar";
export const PERMISO_ANULAR = "cotizacion.anular";

export function mensajeVencida(codigo: string | null | undefined, validaHasta: Date | string): string {
  return (
    `La cotización ${codigo ?? ""} venció el ${fechaLegible(validaHasta)} y ya no se puede aceptar. ` +
    "Emita una nueva cotización (o anúlela si el cliente desistió)."
  ).replace(/\s+/g, " ");
}

export interface CotizacionVigencia {
  estado: string;
  codigo?: string | null;
  validaHasta?: Date | string | null;
  expiraAt?: Date | string | null;
}

export type ResultadoAceptacion = { ok: true } | { ok: false; vencida: true; mensaje: string };

/**
 * ¿Se puede registrar la aceptación por vigencia? Solo mira el vencimiento;
 * el resto de transiciones lo sigue validando `validarTransicion` (common/estados.ts).
 *   · 'expirada' (Vencida) → nunca.
 *   · 'abierta' / 'enviada' con la validez terminada → no (y el servicio la pasa a Vencida).
 */
export function puedeRegistrarAceptacion(cot: CotizacionVigencia, hoy: Date): ResultadoAceptacion {
  const fecha = cot.validaHasta ?? cot.expiraAt ?? null;
  if (cot.estado === "expirada") {
    return {
      ok: false,
      vencida: true,
      mensaje: fecha ? mensajeVencida(cot.codigo, fecha) : `La cotización ${cot.codigo ?? ""} está vencida y ya no se puede aceptar.`,
    };
  }
  if ((ESTADOS_QUE_VENCEN as readonly string[]).includes(cot.estado) && fecha && estaVencida(fecha, hoy)) {
    return { ok: false, vencida: true, mensaje: mensajeVencida(cot.codigo, fecha) };
  }
  return { ok: true };
}
