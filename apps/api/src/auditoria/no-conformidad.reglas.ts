import { diaChile, hoyChile } from "../common/fecha-chile";
/**
 * No conformidades (ISO/IEC 17025 §7.10 y §8.7) · reglas puras.
 *
 * Ciclo de vida:
 *
 *   abierta ──▶ en_proceso ──▶ verificacion ──▶ cerrada ──▶ reabierta
 *      │            ▲   │            │             ▲           │
 *      │            └───┼────────────┘             │           │
 *      └────────────────┴──────────────────────────┘ ◀─────────┘
 *
 *   · Pasar a «En proceso» exige responsable y plazo (quién y para cuándo).
 *   · Pasar a «En verificación» o cerrar exige causa raíz y acción correctiva.
 *   · Cerrar exige además la verificación de la eficacia.
 *   · Una cerrada solo puede reabrirse (con comentario).
 */
export const ESTADOS_NC = ["abierta", "en_proceso", "verificacion", "cerrada", "reabierta"] as const;
export type EstadoNc = (typeof ESTADOS_NC)[number];

export const ESTADOS_NC_ABIERTOS: readonly EstadoNc[] = ["abierta", "en_proceso", "verificacion", "reabierta"];

export const ETIQUETA_ESTADO_NC: Record<EstadoNc, string> = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  verificacion: "En verificación",
  cerrada: "Cerrada",
  reabierta: "Reabierta",
};

const TRANSICIONES_NC: Record<EstadoNc, readonly EstadoNc[]> = {
  abierta: ["en_proceso", "verificacion", "cerrada"],
  en_proceso: ["verificacion", "cerrada"],
  verificacion: ["cerrada", "en_proceso"],
  cerrada: ["reabierta"],
  reabierta: ["en_proceso", "verificacion", "cerrada"],
};

export const TIPOS_NC = ["ensayo", "equipo", "muestra", "proceso", "reclamo_cliente", "auditoria", "documental", "otro"] as const;
export const CRITICIDADES_NC = ["baja", "media", "alta", "critica"] as const;

/* ---------------------------------------- PNC / TNC · IDIC-PG12 (BL-165) --- */

/** NC general, producto no conforme (PNC) o trabajo no conforme (TNC). */
export const CLASES_NC = ["NC", "PNC", "TNC"] as const;
/** Formulario del procedimiento IDIC-PG12 con que se registra un PNC/TNC (EP-05 6.2). */
export const FORMULARIO_PG12 = "IDIC-PG12-FORM01";
/**
 * Acción del PNC/TNC: «reejecutar» devuelve los ensayos a la captura (conector B
 * del Anexo 01), «corregir_informe» va a corregir el documento (conector A) y
 * «volver_elaboracion» devuelve la calibración a su elaboración (EP-04 P6.3).
 */
export const ACCIONES_PNC = ["reejecutar", "corregir_informe", "volver_elaboracion"] as const;

export interface DatosPnc {
  clase?: string | null;
  accion?: string | null;
  otId?: string | null;
  resultadoIds?: string[];
  resultadoId?: string | null;
  calibracionId?: string | null;
  certificadoId?: string | null;
  costoNoCalidad?: number | null;
}

/** Errores de un PNC/TNC al registrarlo (lista vacía = se registra). */
export function erroresPnc(d: DatosPnc): string[] {
  const e: string[] = [];
  if (!d.clase || d.clase === "NC") {
    if (d.accion) e.push("La acción (reejecutar, corregir el informe…) es de un PNC o TNC.");
    return e;
  }
  if (!d.otId && !d.calibracionId) e.push("Un PNC/TNC se registra sobre una OT o una calibración.");
  if (!d.accion) e.push("Indique la acción del PNC/TNC: reejecutar, corregir el informe o volver a la elaboración.");
  if (d.accion === "reejecutar" && !(d.resultadoIds?.length || d.resultadoId)) e.push("Para reejecutar, indique los ensayos afectados.");
  if (d.accion === "volver_elaboracion" && !d.calibracionId) e.push("«Volver a la elaboración» es para una calibración.");
  if (d.costoNoCalidad != null && !(Number(d.costoNoCalidad) >= 0)) e.push("El costo de no calidad no puede ser negativo.");
  return e;
}

/** Ensayos a devolver al reejecutar: los indicados (sin repetir). */
export function ensayosAReejecutar(nc: { resultadoIds?: string[] | null; resultadoId?: string | null }): string[] {
  return [...new Set([...(nc.resultadoIds ?? []), ...(nc.resultadoId ? [nc.resultadoId] : [])])];
}

/** Cómo se devuelve cada ensayo según su estado: aprobado → reabrir; capturado o revisado → devolver; el resto ya está en captura. */
export function modoDevolucion(estado: string): "reabrir" | "devolver" | "nada" {
  if (estado === "aprobado") return "reabrir";
  if (estado === "capturado" || estado === "revisado_n1") return "devolver";
  return "nada";
}

export interface DatosNc {
  estado: string;
  responsableId?: string | null;
  plazoCierre?: Date | string | null;
  causaRaiz?: string | null;
  accionCorrectiva?: string | null;
  verificacion?: string | null;
}

const lleno = (v?: string | null) => !!v && v.trim().length > 0;

/** Errores que impiden pasar `nc` a `destino` (lista vacía = se puede). */
export function erroresTransicionNc(nc: DatosNc, destino: string, comentario?: string | null): string[] {
  const origen = nc.estado as EstadoNc;
  if (!(ESTADOS_NC as readonly string[]).includes(destino)) return [`Estado «${destino}» no válido.`];
  const permitidos = TRANSICIONES_NC[origen] ?? [];
  if (!permitidos.includes(destino as EstadoNc)) {
    return [
      `No se puede pasar de «${ETIQUETA_ESTADO_NC[origen] ?? origen}» a «${ETIQUETA_ESTADO_NC[destino as EstadoNc]}».`,
    ];
  }
  const e: string[] = [];
  if (destino === "en_proceso") {
    if (!nc.responsableId) e.push("Asigne un responsable antes de iniciar el tratamiento.");
    if (!nc.plazoCierre) e.push("Indique el plazo de cierre antes de iniciar el tratamiento.");
  }
  if (destino === "verificacion" || destino === "cerrada") {
    if (!lleno(nc.causaRaiz)) e.push("Registre la causa raíz.");
    if (!lleno(nc.accionCorrectiva)) e.push("Registre la acción correctiva.");
  }
  if (destino === "cerrada" && !lleno(nc.verificacion)) e.push("Registre la verificación de la eficacia de la acción.");
  if (destino === "reabierta" && !lleno(comentario)) e.push("Indique por qué se reabre.");
  return e;
}

/** ¿Venció el plazo sin cerrarse? */
export function ncVencida(nc: { estado: string; plazoCierre?: Date | string | null }, hoy: Date): boolean {
  if (!nc.plazoCierre || nc.estado === "cerrada") return false;
  // Frente f8: «hoy» es el día en Chile (a las 21:30 de Chile no vence la del día siguiente en UTC).
  const p = typeof nc.plazoCierre === "string" ? nc.plazoCierre.slice(0, 10) : diaChile(nc.plazoCierre);
  return !!p && p < hoyChile(hoy);
}

/** Código correlativo anual: NC-2026-0001. */
export function siguienteCodigoNc(ultimo: string | null | undefined, anio: number): string {
  const m = ultimo ? /^NC-(\d{4})-(\d+)$/.exec(ultimo) : null;
  const n = m && Number(m[1]) === anio ? Number(m[2]) + 1 : 1;
  return `NC-${anio}-${String(n).padStart(4, "0")}`;
}

/**
 * ¿Quién puede editar el análisis (causa, acciones, verificación)? Quien
 * gestiona NC (calidad, jefaturas) o el responsable asignado. Cerrar y
 * reabrir quedan solo para quien gestiona.
 */
export function puedeEditarAnalisis(opts: { gestiona: boolean; usuarioId: string; responsableId?: string | null }): boolean {
  return opts.gestiona || (!!opts.responsableId && opts.responsableId === opts.usuarioId);
}
