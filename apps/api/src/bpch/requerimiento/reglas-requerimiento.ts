/**
 * Requerimiento BPCH (OT sin cotización) · reglas puras (reglas-requerimiento.spec.ts).
 * Reunión 11 (BPCH y Delegaciones, 06-11-2026).
 */

export const ESCALONES = ["internaciones", "produccion_nacional", "scc", "delegacion_11"] as const;
export type Escalon = (typeof ESCALONES)[number];
export const ETIQUETA_ESCALON: Record<Escalon, string> = {
  internaciones: "Escalón Internaciones",
  produccion_nacional: "Escalón Producción Nacional",
  scc: "Sección Certificación de la Conformidad",
  delegacion_11: "Delegación 11",
};

export const ESTADOS_REQ = ["borrador", "validado", "anulado"] as const;
export type EstadoReq = (typeof ESTADOS_REQ)[number];

export interface DatosRequerimiento {
  docOrigenTipo: "oficio" | "rpi";
  docOrigenNumero: string;
  docOrigenFecha: string;
  conCobro: boolean;
  sinCobroComunicacion?: string | null;
  sinCobroNumero?: string | null;
  plantaIds: string[];
  /** Plantas de la empresa (para comprobar que las elegidas son suyas). */
  plantasEmpresa: string[];
}

const vacio = (v: string | null | undefined) => !v || !String(v).trim();

/** Errores del requerimiento antes de guardarlo (vacío = válido). `hoy` AAAA-MM-DD. */
export function erroresRequerimiento(d: DatosRequerimiento, hoy: string): string[] {
  const e: string[] = [];
  if (vacio(d.docOrigenNumero)) e.push(`Indique el número del ${d.docOrigenTipo === "rpi" ? "RPI" : "oficio"} de origen.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.docOrigenFecha ?? "")) e.push("Indique la fecha del documento de origen.");
  else if (d.docOrigenFecha > hoy) e.push("La fecha del documento de origen no puede ser posterior a hoy.");
  if (!d.conCobro) {
    if (vacio(d.sinCobroNumero)) e.push("OT sin cobro: indique el número de la comunicación que la autoriza.");
    if (vacio(d.sinCobroComunicacion)) e.push("OT sin cobro: resuma la comunicación que la autoriza.");
  }
  const ajenas = d.plantaIds.filter((p) => !d.plantasEmpresa.includes(p));
  if (ajenas.length) e.push("Alguna planta elegida no es de la empresa indicada.");
  return e;
}

/** Motivo por el que no se valida (null = se puede). Quien lo elaboró no lo valida. */
export function motivoNoValidable(r: { estado: string; createdBy: string | null }, usuarioId: string | null): string | null {
  if (r.estado === "validado") return "El requerimiento ya está validado y tiene su OT.";
  if (r.estado === "anulado") return "El requerimiento está anulado.";
  if (r.estado !== "borrador") return `Estado no reconocido (${r.estado}).`;
  if (usuarioId && r.createdBy && r.createdBy === usuarioId)
    return "Lo elaboró usted: lo valida otra jefatura (Jefe de Escalón).";
  return null;
}

/** Texto de la OT que nace del requerimiento (descripción del trabajo). */
export function descripcionOt(r: {
  numero: string;
  escalon: Escalon;
  docOrigenTipo: "oficio" | "rpi";
  docOrigenNumero: string;
  docOrigenFecha: string;
  asistenciaTecnica: boolean;
  instrucciones?: string | null;
  tecnico?: string | null;
}): string {
  const partes = [
    `Requerimiento ${r.numero} · ${ETIQUETA_ESCALON[r.escalon]}`,
    `${r.docOrigenTipo === "rpi" ? "RPI" : "Oficio"} ${r.docOrigenNumero.trim()} del ${r.docOrigenFecha}`,
    r.asistenciaTecnica ? "Con asistencia técnica" : "",
    r.tecnico?.trim() ? `Técnico: ${r.tecnico.trim()}` : "",
    r.instrucciones?.trim() ? `Instrucciones: ${r.instrucciones.trim()}` : "",
  ];
  return partes.filter(Boolean).join(" · ").slice(0, 4000);
}
