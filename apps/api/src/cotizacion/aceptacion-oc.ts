/**
 * Comparación «O/C vs cotización» al registrar la aceptación (EP-00 4.2, BL-150)
 * · regla PURA, probada en aceptacion-oc.spec.ts.
 *
 * Si el cliente acepta con una orden de compra cuyo monto difiere del total
 * cotizado (más allá de la tolerancia configurable), la OT no se crea hasta
 * registrar la discrepancia («Resolver → crear OT») o se anula la orden del
 * cliente («Anular orden del cliente», la cotización sigue Abierta). Ambas
 * cosas quedan como hitos de la cotización.
 */
export interface EntradaOc {
  tipo?: string | null;
  montoOc?: number | null;
  totalCotizado: number;
  tolerancia: number;
  discrepancia?: string | null;
}

export interface RevisionOc {
  aplica: boolean;
  diferencia: number | null;
  hayDiscrepancia: boolean;
  /** Mensaje si falta registrar la discrepancia (null = se puede crear la OT). */
  error: string | null;
}

const clp = (n: number) => Math.round(n).toLocaleString("es-CL");

export function revisarOc(e: EntradaOc): RevisionOc {
  if (e.tipo !== "OC" || e.montoOc == null) return { aplica: false, diferencia: null, hayDiscrepancia: false, error: null };
  const diferencia = Math.round((Number(e.montoOc) - Number(e.totalCotizado)) * 100) / 100;
  const hayDiscrepancia = Math.abs(diferencia) > Math.max(0, Number(e.tolerancia) || 0);
  const error =
    hayDiscrepancia && !(e.discrepancia && e.discrepancia.trim().length >= 5)
      ? `La O/C ($${clp(Number(e.montoOc))}) difiere del total cotizado ($${clp(Number(e.totalCotizado))}) en $${clp(diferencia)}. Registre la discrepancia para crear la OT o anule la orden del cliente.`
      : null;
  return { aplica: true, diferencia, hayDiscrepancia, error };
}
