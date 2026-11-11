/**
 * Sesión R4 (BPCH, 29-10-2026): «la batería de ensayos sale del procedimiento de
 * calidad; ni sucursal ni laboratorio deben poder quitar ensayos, salvo
 * excepción controlada». La batería es el panel del elemento en el catálogo
 * (cat_panel). Quitar un ensayo exige el permiso bpch.bateria.excepcion y un
 * motivo, y queda en el historial de la OT. Regla pura (bateria.spec.ts).
 */

export interface MetodoBateria {
  id: string;
  codigo: string;
  nombre: string;
}

export interface RevisionBateria {
  /** Ensayos de la batería que no se eligieron. */
  faltan: MetodoBateria[];
  /** Mensaje para el usuario si no se puede registrar (null = se puede). */
  error: string | null;
  /** Hay excepción válida (para dejarla en el historial). */
  excepcion: boolean;
}

export function revisarBateria(
  bateria: MetodoBateria[],
  elegidos: string[],
  excepcion: { motivo?: string | null; permitido: boolean } | null,
  etiqueta = "El lote",
): RevisionBateria {
  const set = new Set(elegidos);
  const faltan = bateria.filter((m) => !set.has(m.id));
  if (!faltan.length) return { faltan, error: null, excepcion: false };
  const lista = faltan.map((m) => m.codigo || m.nombre).join(", ");
  if (!excepcion || !(excepcion.motivo ?? "").trim())
    return {
      faltan,
      error: `${etiqueta} no lleva toda la batería de ensayos del procedimiento de calidad (falta: ${lista}). Solo se quita un ensayo como excepción, con motivo y autorización de la jefatura.`,
      excepcion: false,
    };
  if (!excepcion.permitido)
    return { faltan, error: `Quitar ensayos de la batería (${lista}) es una excepción que autoriza la jefatura de la SCC (permiso bpch.bateria.excepcion).`, excepcion: false };
  if ((excepcion.motivo ?? "").trim().length < 5) return { faltan, error: "Indique el motivo de la excepción (al menos 5 caracteres).", excepcion: false };
  return { faltan, error: null, excepcion: true };
}
