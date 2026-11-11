/**
 * Avisos de Comercial (reuniones 1 y 2 · 27 y 28-10-2026).
 *
 *  · OT por disposición sin OPI: la autoriza el jefe del departamento
 *    incumbente y la OPI debe regularizarse en DOS MESES (parámetro
 *    `ot_disposicion.meses_opi`). Pasado el plazo, la OT aparece como «OPI
 *    vencida» en Mi bandeja de Comercial y Planificación.
 *  · OT lista para facturar: OT con cobro, no anulada, sin factura emitida,
 *    cerrada o con sus documentos oficiales ya entregados.
 *  · Cotizaciones aceptadas sin OT, salvo las marcadas como excepción
 *    (con motivo) por Comercial.
 *
 * Funciones PURAS + fragmentos SQL compartidos por la bandeja y el listado.
 */
import { SQL_OT_LISTA_PARA_CERRAR } from "../ot/lista-cierre";

export const MESES_OPI_DEF = 2;
export const DIAS_AVISO_OPI = 7;

/** Suma meses de calendario a una fecha AAAA-MM-DD (31-ene + 1 mes → 28/29-feb). */
export function sumarMesesIso(fecha: string, meses: number): string {
  const [y, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

export type EstadoOpi = "al_dia" | "por_vencer" | "vencida";

/**
 * Estado del plazo de la OPI de una OT con OPI pendiente. `desde` = fecha en
 * que nació la OT (AAAA-MM-DD, Chile). Null si la OT no espera OPI.
 */
export function estadoPlazoOpi(e: { opiPendiente: boolean; desde: string | null; hoy: string; meses?: number }): { estado: EstadoOpi; limite: string; diasRestantes: number } | null {
  if (!e.opiPendiente || !e.desde) return null;
  const limite = sumarMesesIso(e.desde, e.meses && e.meses > 0 ? e.meses : MESES_OPI_DEF);
  const dias = Math.round((Date.parse(`${limite}T00:00:00Z`) - Date.parse(`${e.hoy.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return { estado: dias < 0 ? "vencida" : dias <= DIAS_AVISO_OPI ? "por_vencer" : "al_dia", limite, diasRestantes: dias };
}

/** Causas de anulación de una OT (la del cliente que desiste es la que pidió Comercial). */
export const CAUSAS_ANULACION_OT = {
  cliente_desiste: "El cliente desiste del servicio",
  error_registro: "Error de registro",
  otra: "Otra causa",
} as const;
export type CausaAnulacionOt = keyof typeof CAUSAS_ANULACION_OT;

/** ¿Se puede anular la OT? Devuelve el motivo si no. */
export function motivoNoAnularOt(ot: { estado: string; codigo?: string | null; facturaEmitida?: boolean; documentosOficiales?: number }): string | null {
  const c = ot.codigo ? `La OT ${ot.codigo}` : "La OT";
  if (ot.estado === "anulada") return `${c} ya está anulada.`;
  if (ot.estado === "cerrada") return `${c} está cerrada: no se anula.`;
  if (ot.facturaEmitida) return `${c} tiene una factura emitida: anule primero la factura (nota de crédito) en Facturación.`;
  if ((ot.documentosOficiales ?? 0) > 0) return `${c} ya tiene informes o certificados oficiales: no se anula.`;
  return null;
}

/**
 * Condición SQL «OT lista para facturar» sobre `orden_trabajo o` (Comercial,
 * reunión 1): con cobro, no anulada, sin factura emitida (un borrador pendiente
 * cuenta como «por facturar») y, además, cerrada o lista para cerrar (documentos
 * oficiales y entregados, mismo criterio que «OT listas para cerrar», lista-cierre.ts).
 */
export const SQL_OT_LISTA_PARA_FACTURAR = `
  o.con_cobro AND o.estado <> 'anulada'
  AND NOT EXISTS (SELECT 1 FROM factura f WHERE f.ot_id = o.id AND f.deleted_at IS NULL AND f.estado NOT IN ('pendiente', 'anulada'))
  AND (o.estado = 'cerrada' OR (${SQL_OT_LISTA_PARA_CERRAR}))`;

/** Condición SQL «aceptada sin OT» sobre `cotizacion c`, sin las excepciones marcadas por Comercial. */
export const SQL_ACEPTADA_SIN_OT = `
  c.estado = 'aceptada' AND c.sin_ot_motivo IS NULL
  AND NOT EXISTS (SELECT 1 FROM orden_trabajo o WHERE o.cotizacion_id = c.id)`;
