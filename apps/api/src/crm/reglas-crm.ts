/**
 * Reglas puras del CRM (EP-00 0.3, BL-173) · probadas en reglas-crm.spec.ts.
 */

/** Código OPP-AAAA-NNNN con el año en curso (antes estaba fijo en 2026). */
export function siguienteCodigoOportunidad(ultimo: string | null | undefined, anio: number): string {
  const m = ultimo ? /^OPP-(\d{4})-(\d+)$/.exec(ultimo) : null;
  const n = m && Number(m[1]) === anio ? Number(m[2]) + 1 : 1;
  return `OPP-${anio}-${String(n).padStart(4, "0")}`;
}

/**
 * ¿Ve (o actúa sobre) la oportunidad? `visibles` null = alcance global. Quien
 * tiene el Departamento Comercial (DCO) en su alcance las ve todas, como las
 * cotizaciones; el resto, solo las de sus laboratorios. Una oportunidad sin
 * laboratorio es solo de Comercial.
 */
export function oportunidadEnAlcance(visibles: string[] | null, unidadId: string | null | undefined, dcoId: string | null): boolean {
  if (visibles === null) return true;
  if (dcoId && visibles.includes(dcoId)) return true;
  return !!unidadId && visibles.includes(unidadId);
}

/** Etapa y estado de la oportunidad cuando su cotización avanza. */
export function etapaPorCotizacion(evento: "creada" | "aceptada" | "anulada"): { etapa: string; estado: string } {
  if (evento === "aceptada") return { etapa: "ganada", estado: "ganada" };
  if (evento === "anulada") return { etapa: "negociacion", estado: "viva" };
  return { etapa: "propuesta", estado: "viva" };
}

/* ------------------------------------------ historial del cliente (§4.1.2) --- */

export const TIPOS_INTERACCION = ["llamada", "reunion", "correo", "visita", "nota"] as const;
export type TipoInteraccion = (typeof TIPOS_INTERACCION)[number];
export const ETIQUETA_INTERACCION: Record<TipoInteraccion, string> = {
  llamada: "Llamada",
  reunion: "Reunión",
  correo: "Correo",
  visita: "Visita",
  nota: "Nota",
};

/** Clases de hito de la línea de tiempo del cliente. */
export type ClaseHito = "interaccion" | "oportunidad" | "cotizacion" | "ot" | "correo" | "documento";

export interface HitoCliente {
  clase: ClaseHito;
  id: string;
  /** Instante ISO del hito (fecha de la interacción, de creación de la cotización…). */
  fecha: string;
  titulo: string;
  detalle: string | null;
  /** Subtipo (llamada, aceptada, enviado…) para el icono y el filtro. */
  subtipo: string | null;
  responsable: string | null;
  ruta: string | null;
}

/**
 * Une los hitos de distintas fuentes en UNA línea de tiempo, del más reciente
 * al más antiguo; a igual instante, primero las interacciones registradas a
 * mano. Descarta los que no tienen fecha válida y repetidos (misma clase e id).
 */
export function lineaTiempo(fuentes: HitoCliente[][], limite = 300): HitoCliente[] {
  const orden: Record<ClaseHito, number> = { interaccion: 0, oportunidad: 1, cotizacion: 2, ot: 3, correo: 4, documento: 5 };
  const vistos = new Set<string>();
  const todos: (HitoCliente & { t: number })[] = [];
  for (const h of fuentes.flat()) {
    const t = Date.parse(h.fecha);
    const clave = `${h.clase}:${h.id}`;
    if (!Number.isFinite(t) || vistos.has(clave)) continue;
    vistos.add(clave);
    todos.push({ ...h, t });
  }
  todos.sort((a, b) => b.t - a.t || orden[a.clase] - orden[b.clase]);
  return todos.slice(0, Math.max(1, limite)).map(({ t: _t, ...h }) => h);
}

/** Errores de una interacción (fecha no futura más allá de hoy, próxima acción con fecha). */
export function erroresInteraccion(i: { fecha: Date | null; proximaAccion?: string | null; proximaFecha?: string | null }, ahora: Date): string[] {
  const e: string[] = [];
  if (!i.fecha || Number.isNaN(i.fecha.getTime())) e.push("Indique la fecha de la interacción.");
  else if (i.fecha.getTime() > ahora.getTime() + 24 * 3600 * 1000) e.push("La fecha de la interacción no puede ser futura: registre lo que ya ocurrió y deje lo pendiente como «Próxima acción».");
  if (i.proximaFecha && !i.proximaAccion?.trim()) e.push("Indique la próxima acción de esa fecha.");
  return e;
}
