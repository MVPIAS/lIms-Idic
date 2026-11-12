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
      error: `${etiqueta} no lleva toda la batería de ensayos del procedimiento de calidad (falta: ${lista}). Solo se quita un ensayo como excepción: escriba el motivo en «Motivo para quitar … ensayo(s) del panel» (lo autoriza la jefatura).`,
      excepcion: false,
    };
  if (!excepcion.permitido)
    return { faltan, error: `Quitar ensayos de la batería (${lista}) es una excepción que solo autoriza la jefatura de la Sección Certificación de la Conformidad o del Banco de Pruebas; pídale que registre el lote.`, excepcion: false };
  if ((excepcion.motivo ?? "").trim().length < 5) return { faltan, error: "Indique el motivo de la excepción (al menos 5 caracteres).", excepcion: false };
  return { faltan, error: null, excepcion: true };
}

/**
 * fx5-c · F007: «Quitar» un ensayo ya generado en «Captura y revisión por OT».
 * En una OT del BPCH, si el ensayo es de la batería del elemento, quitarlo es la
 * misma excepción controlada: solo con el permiso de excepción (el motivo ya es
 * obligatorio en «Quitar»). Fuera del BPCH o fuera de la batería no aplica.
 */
export function errorQuitarDeBateria(h: { esBpch: boolean; enBateria: boolean; permitido: boolean; ensayo?: string | null }): string | null {
  if (!h.esBpch || !h.enBateria || h.permitido) return null;
  return `${h.ensayo ? `«${h.ensayo}» es` : "El ensayo es"} parte de la batería de ensayos del procedimiento de calidad: solo lo quita, como excepción y con motivo, la jefatura de la Sección Certificación de la Conformidad o del Banco de Pruebas.`;
}
