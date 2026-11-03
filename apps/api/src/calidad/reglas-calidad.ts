/**
 * Reglas PURAS de calidad (acreditación ISO/IEC 17025 y alícuotas) · probadas
 * en reglas-calidad.spec.ts.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Errores de una acreditación (número obligatorio; vigencia coherente). */
export function erroresAcreditacion(d: { numero: string | null; vigenteDesde: string | null; vigenteHasta: string | null }): string[] {
  const e: string[] = [];
  if (!d.numero) e.push("Indique el número de la acreditación (p. ej. LE 123).");
  if (d.vigenteDesde && !FECHA.test(d.vigenteDesde)) e.push("La fecha «vigente desde» debe ser AAAA-MM-DD.");
  if (d.vigenteHasta && !FECHA.test(d.vigenteHasta)) e.push("La fecha «vigente hasta» debe ser AAAA-MM-DD.");
  if (d.vigenteDesde && d.vigenteHasta && FECHA.test(d.vigenteDesde) && FECHA.test(d.vigenteHasta) && d.vigenteHasta < d.vigenteDesde)
    e.push("La vigencia termina antes de empezar.");
  return e;
}

/** Estado de una acreditación hoy (AAAA-MM-DD, hora de Chile). */
export function estadoAcreditacion(d: { vigenteDesde: string | null; vigenteHasta: string | null }, hoy: string, diasAviso = 60): "vigente" | "por_vencer" | "vencida" | "futura" {
  if (d.vigenteDesde && d.vigenteDesde > hoy) return "futura";
  if (d.vigenteHasta && d.vigenteHasta < hoy) return "vencida";
  if (d.vigenteHasta) {
    const dias = Math.round((Date.parse(`${d.vigenteHasta}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
    if (dias <= diasAviso) return "por_vencer";
  }
  return "vigente";
}

/* --------------------------------------------------------------- alícuotas --- */

/** Siguiente código libre «<muestra>-A<n>». */
export function codigoAlicuota(muestra: string, usados: string[]): string {
  const re = new RegExp(`^${muestra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-A(\\d+)$`);
  const max = usados.reduce((m, c) => {
    const x = re.exec(c);
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `${muestra}-A${max + 1}`;
}

export const TIPOS_MOVIMIENTO = ["consumo", "traslado", "estado"] as const;
export const ESTADOS_ALICUOTA = ["disponible", "en_uso", "consumida", "descartada"] as const;

export interface MovimientoAlicuota {
  tipo: string;
  cantidad: number | null;
  estado: string | null;
  ubicacionId: string | null;
  detalle: string | null;
}

export function erroresMovimientoAlicuota(m: MovimientoAlicuota, a: { estado: string; restante: number | null }): string[] {
  const e: string[] = [];
  if (!(TIPOS_MOVIMIENTO as readonly string[]).includes(m.tipo)) return ["El movimiento es consumo, traslado o cambio de estado."];
  if (a.estado === "consumida" || a.estado === "descartada") return [`La alícuota está ${a.estado}: no admite más movimientos.`];
  if (m.tipo === "consumo") {
    if (m.cantidad == null || !(m.cantidad > 0)) e.push("Indique la cantidad consumida (mayor que cero).");
    else if (a.restante != null && m.cantidad > a.restante + 1e-9) e.push(`Solo quedan ${String(a.restante).replace(".", ",")}: no se puede consumir más.`);
  }
  if (m.tipo === "traslado" && !m.ubicacionId) e.push("Elija la ubicación de destino.");
  if (m.tipo === "estado") {
    if (!m.estado || !(ESTADOS_ALICUOTA as readonly string[]).includes(m.estado)) e.push("Elija el nuevo estado.");
    else if (m.estado === a.estado) e.push("La alícuota ya está en ese estado.");
    if (m.estado === "descartada" && (!m.detalle || m.detalle.length < 5)) e.push("Indique el motivo del descarte (mínimo 5 caracteres).");
  }
  return e;
}

/** Estado y cantidad que quedan tras el movimiento (válido). */
export function planMovimientoAlicuota(m: MovimientoAlicuota, a: { estado: string; restante: number | null }): { estado: string; restante: number | null } {
  if (m.tipo === "consumo") {
    const restante = a.restante == null ? null : Math.max(0, Math.round((a.restante - (m.cantidad ?? 0)) * 1e6) / 1e6);
    return { estado: restante === 0 ? "consumida" : "en_uso", restante };
  }
  if (m.tipo === "estado") return { estado: m.estado!, restante: m.estado === "consumida" || m.estado === "descartada" ? 0 : a.restante };
  return { estado: a.estado, restante: a.restante };
}
