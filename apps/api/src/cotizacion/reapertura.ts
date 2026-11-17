/**
 * Reabrir una cotización aceptada · COM-02 (respuesta IDIC 17-11-2026).
 *
 * «Valor cotizado → valor finalmente trabajado. Autoriza el Jefe DCO o su
 * subrogante. Se reabre la cotización y se detalla el motivo (es obligatorio
 * indicar por qué se modifica): Ejecutivo de Ventas → Jefe DCO y subrogante.»
 *
 * Ciclo (tabla cotizacion_reapertura, align_tercer_envio_comercial.sql):
 *   1. solicitada  · el Ejecutivo (permiso cotizacion.crear) pide reabrir una
 *                    cotización Aceptada con un motivo obligatorio;
 *   2. autorizada  · el Jefe DCO o su subrogante (permiso cotizacion.reabrir) la
 *                    autoriza: se guarda la versión vigente (líneas y totales) y
 *                    la cotización pasa a «Reabierta», editable;
 *      rechazada   · o la rechaza con un comentario; la cotización sigue Aceptada;
 *   3. cerrada     · el Ejecutivo registra el valor final: la cotización vuelve a
 *                    Aceptada, la OT conserva su número y toma el valor final, y la
 *                    factura pendiente (borrador) se rehace con el valor final.
 *
 * Reglas PURAS (sin BD), probadas en reapertura.spec.ts.
 */

export const PERMISO_REABRIR = "cotizacion.reabrir";
export const ESTADO_REABIERTA = "reabierta";
export const MOTIVO_REAPERTURA_MIN = 10;

export type EstadoReapertura = "solicitada" | "autorizada" | "rechazada" | "cerrada";
export const REAPERTURA_VIVA: EstadoReapertura[] = ["solicitada", "autorizada"];

export interface ReaperturaResumen {
  id: string;
  estado: EstadoReapertura | string;
}

/** ¿Se puede pedir la reapertura? Devuelve el motivo del rechazo o null. */
export function errorSolicitarReapertura(
  cot: { codigo?: string | null; estado: string },
  viva: ReaperturaResumen | null | undefined,
  motivo: string | null | undefined,
): string | null {
  if (cot.estado !== "aceptada")
    return `Solo se reabre una cotización Aceptada (la ${cot.codigo ?? ""} está «${cot.estado}»).`.replace(/\s+/g, " ");
  if (viva) return viva.estado === "solicitada" ? "Ya hay una solicitud de reapertura esperando la autorización del Jefe DCO." : "La cotización ya está reabierta.";
  if ((motivo ?? "").trim().length < MOTIVO_REAPERTURA_MIN)
    return `Indique el motivo de la reapertura (mínimo ${MOTIVO_REAPERTURA_MIN} caracteres): es obligatorio explicar por qué se modifica.`;
  return null;
}

/** ¿Se puede resolver (autorizar o rechazar) la solicitud? */
export function errorResolverReapertura(
  viva: ReaperturaResumen | null | undefined,
  autorizar: boolean,
  comentario: string | null | undefined,
): string | null {
  if (!viva || viva.estado !== "solicitada") return "No hay una solicitud de reapertura pendiente de autorizar.";
  if (!autorizar && (comentario ?? "").trim().length < 5) return "Para rechazar la reapertura indique el motivo (mínimo 5 caracteres).";
  return null;
}

/** ¿Se puede registrar el valor final y cerrar la reapertura? */
export function errorCerrarReapertura(cot: { estado: string; lineas?: number }, viva: ReaperturaResumen | null | undefined): string | null {
  if (!viva || viva.estado !== "autorizada" || cot.estado !== ESTADO_REABIERTA)
    return "La cotización no está reabierta: no hay valor final que registrar.";
  if (cot.lineas !== undefined && cot.lineas < 1) return "La cotización reabierta no tiene líneas: agregue al menos una antes de registrar el valor final.";
  return null;
}

/** Siguiente versión de la cotización (la 1 es la aceptada originalmente). */
export function siguienteVersion(versiones: number[]): number {
  return (versiones.length ? Math.max(...versiones) : 1) + 1;
}

/**
 * Copia de la versión vigente antes de reabrirla: cabecera económica y líneas.
 * Es lo que queda en la bitácora para comparar «cotizado → final».
 */
export function fotoCotizacion(cot: any): Record<string, unknown> {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    codigo: cot.codigo ?? null,
    moneda: cot.moneda ?? null,
    dolarValor: num(cot.dolarValor),
    neto: num(cot.neto),
    descuentoPct: num(cot.descuentoPct),
    descuentoMonto: num(cot.descuentoMonto),
    gastosAdminPct: num(cot.gastosAdminPct),
    gastosAdminMonto: num(cot.gastosAdminMonto),
    ivaPct: num(cot.ivaPct),
    ivaMonto: num(cot.ivaMonto),
    total: num(cot.total),
    lineas: (cot.lineas ?? []).map((l: any) => ({
      orden: l.orden ?? null,
      catEnsayoId: l.catEnsayoId ?? null,
      ensayoCodigo: l.ensayoCodigo ?? null,
      descripcion: l.descripcion ?? null,
      tipo: l.tipo ?? null,
      cantidad: num(l.cantidad),
      precioUnitario: num(l.precioUnitario),
      subtotal: num(l.subtotal),
    })),
  };
}

/** Solo la factura PENDIENTE (borrador) toma el valor final; una emitida se corrige con nota de crédito. */
export function facturaTomaValorFinal(estado: string | null | undefined): boolean {
  return estado === "pendiente";
}
