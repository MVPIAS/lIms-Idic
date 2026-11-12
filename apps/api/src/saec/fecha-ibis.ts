/**
 * fx5-c · F038 · Fecha del XML de IBIS (LastAcquisitionDate / CreationDate) · regla PURA
 * (fecha-ibis.spec.ts).
 *
 * IBIS escribe la hora LOCAL de la estación, sin zona («2026-11-12 10:15:00»).
 * `new Date(texto)` la interpretaba en la zona del SERVIDOR, así que la fecha de
 * disparo salía corrida unas horas. Ahora una hora sin zona es hora de Chile
 * (America/Santiago, con su horario de verano); si el texto trae zona (Z o
 * ±hh:mm) se respeta tal cual.
 */
import { instanteDeHoraChile } from "../common/fecha-chile";

const SIN_ZONA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/** Instante ISO (UTC) de una fecha de IBIS, o null si no se entiende. */
export function fechaEsi(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const m = SIN_ZONA.exec(t);
  if (m) {
    const d = instanteDeHoraChile(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
    return new Date(d.getTime() + (m[6] ? +m[6] * 1000 : 0)).toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
