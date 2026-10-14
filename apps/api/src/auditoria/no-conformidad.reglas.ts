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
  const p = typeof nc.plazoCierre === "string" ? new Date(`${nc.plazoCierre.slice(0, 10)}T00:00:00Z`) : nc.plazoCierre;
  const h = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()) < h;
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
