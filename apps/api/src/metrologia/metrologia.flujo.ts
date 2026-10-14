/**
 * Reglas del circuito del Certificado de Calibración (puras, sin base de datos).
 *
 *   borrador ──enviar──▶ en_revision ──emitir──▶ emitida
 *      ▲                     │
 *      └──────devolver───────┘ (con motivo)
 *
 * Según el flujo del LMT (LMT-PG01-Anexo 01) y del LNF (Bizagi 4.2.10): el
 * metrólogo elabora y firma (envía), el jefe del laboratorio revisa, valida y
 * firma (emite) o devuelve para corregir. Coincide con la matriz de firmas
 * CERTIFICADO_CALIBRACION (ELABORA metrólogo → FIRMA jefe de laboratorio).
 *
 *  - Solo quien elaboró la calibración la edita y la envía (mientras es borrador).
 *  - Emite o devuelve quien tiene `metrologia.emitir` y NO la elaboró
 *    (la revisión la hace una persona distinta del autor).
 *  - Una calibración emitida no cambia.
 */
export type EstadoCal = "borrador" | "en_revision" | "emitida";
export type AccionCal = "EDITAR" | "ENVIAR" | "DEVOLVER" | "EMITIR";

export interface ContextoCal {
  estado: string;
  esAutor: boolean;
  puedeCrear: boolean;
  puedeEmitir: boolean;
  /** Calibración con resultado completo (sin él no se envía ni se emite). */
  calculada: boolean;
}

/** Normaliza estados antiguos («calculada» = borrador guardado). */
export const estadoDe = (e: string | null | undefined): EstadoCal =>
  e === "emitida" ? "emitida" : e === "en_revision" ? "en_revision" : "borrador";

/** Motivo por el que la acción no procede, o null si procede. */
export function motivoRechazo(accion: AccionCal, c: ContextoCal): string | null {
  const e = estadoDe(c.estado);
  if (e === "emitida") return "La calibración ya fue emitida y no admite cambios";
  switch (accion) {
    case "EDITAR":
      if (e !== "borrador") return "Solo se edita una calibración en borrador (si está en revisión, el revisor debe devolverla)";
      if (!c.puedeCrear) return "No tiene permiso para registrar calibraciones";
      if (!c.esAutor) return "Solo quien elaboró la calibración puede editarla";
      return null;
    case "ENVIAR":
      if (e !== "borrador") return "Solo se envía a revisión una calibración en borrador";
      if (!c.puedeCrear) return "No tiene permiso para registrar calibraciones";
      if (!c.esAutor) return "Solo quien elaboró la calibración puede enviarla a revisión";
      if (!c.calculada) return "La calibración no tiene resultado calculado";
      return null;
    case "DEVOLVER":
    case "EMITIR":
      if (e !== "en_revision") return "La calibración debe estar enviada a revisión";
      if (!c.puedeEmitir) return "No tiene permiso para emitir certificados de calibración";
      if (c.esAutor) return "Quien elaboró la calibración no puede revisarla ni emitirla: debe hacerlo otra persona";
      if (accion === "EMITIR" && !c.calculada) return "La calibración no tiene resultado calculado";
      return null;
  }
}

/** Estado al que lleva cada acción. */
export const ESTADO_TRAS: Record<AccionCal, EstadoCal> = {
  EDITAR: "borrador", ENVIAR: "en_revision", DEVOLVER: "borrador", EMITIR: "emitida",
};

/** Acciones disponibles para mostrar en la lista. */
export function accionesDisponibles(c: ContextoCal): AccionCal[] {
  return (["EDITAR", "ENVIAR", "DEVOLVER", "EMITIR"] as AccionCal[]).filter((a) => motivoRechazo(a, c) === null);
}

/** Fecha de calibración válida (AAAA-MM-DD) o la de hoy en Chile. */
export function fechaCalibracion(fecha?: string | null, hoy: Date = new Date()): string {
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(fecha + "T12:00:00Z"))) return fecha;
  return hoy.toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
}

/** Código correlativo por año: el año sale de la fecha de calibración. */
export const codigoCalibracion = (fecha: string, n: number) => `CAL-${fecha.slice(0, 4)}-${String(n).padStart(4, "0")}`;

/**
 * Formulario vacío a partir de la estructura de un caso: números → null,
 * textos → "", conserva la forma (filas, series, columnas) para poder escribir.
 */
export function plantillaVacia(v: any): any {
  if (Array.isArray(v)) return v.map(plantillaVacia);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plantillaVacia(x)]));
  if (typeof v === "number") return null;
  if (typeof v === "string") return "";
  return v ?? null;
}
