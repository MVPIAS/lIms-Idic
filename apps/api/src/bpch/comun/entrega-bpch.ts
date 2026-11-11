/**
 * Sesión R4 (BPCH, 29-10-2026) · acreditación 17065: la sucursal emite el
 * certificado de control (Informe de Inspección), la casa matriz el
 * Certificado de Conformidad (o el Informe de Incumplimiento) y COMERCIAL lo
 * entrega al cliente. El documento final del BPCH se entrega solo después de
 * remitirlo a DCO y de que Comercial lo reciba. Regla pura (entrega-bpch.spec.ts).
 */

/** Documentos finales del BPCH que entrega Comercial. */
export const FINALES_BPCH = ["CERTIFICADO_CONFORMIDAD", "INFORME_INCUMPLIMIENTO"] as const;

export interface HechosEntregaBpch {
  tipoDocumento: string | null;
  /** La OT es de una unidad del BPCH (sin la D11). */
  esBpch: boolean;
  /** Origen de la OT: el dictamen del prototipo se entrega desde BPCH › Prototipos. */
  origen: string | null;
  despacho: { destino: string; recibidoAt: Date | string | null } | null;
}

/** null = se puede entregar; si no, el motivo para el usuario. */
export function errorEntregaBpch(h: HechosEntregaBpch): string | null {
  if (!h.esBpch || h.origen === "PROTOTIPO") return null;
  if (!h.tipoDocumento || !(FINALES_BPCH as readonly string[]).includes(h.tipoDocumento)) return null;
  if (!h.despacho || h.despacho.destino !== "DCO")
    return "El documento final del BPCH lo entrega Comercial: primero remítalo a DCO («Remitir a DCO»).";
  if (!h.despacho.recibidoAt) return "Comercial (DCO) aún no registra la recepción del documento: la entrega al cliente la hace Comercial al recibirlo.";
  return null;
}
