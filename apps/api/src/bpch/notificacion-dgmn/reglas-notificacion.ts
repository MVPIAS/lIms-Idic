/**
 * EP-10 10.15 · Informar el incumplimiento a DGMN y al internador. Reglas
 * PURAS, probadas en reglas-notificacion.spec.ts. Contrato:
 * docs/FLUJO_D11_ARMAS.md §«Notificación a DGMN».
 *
 *   · Toda OT con un Informe de Incumplimiento OFICIAL exige su notificación
 *     registrada (sin ella la OT no se cierra).
 *   · Destinatarios fijos según la distribución del documento (no se teclean).
 *   · Medio, fecha de envío (no futura), Nº de oficio (texto) y copia al
 *     internador (sí/no, obligatorio).
 */

/** Distribución del Informe de Incumplimiento (EP-10 10.15): 1. DGMN DCAE · 2. AF (C/I) · 3. BPCH SCC ESCINT (Arch). */
export const DESTINATARIOS_DGMN: readonly string[] = [
  "DGMN · Departamento Control de Armas y Explosivos (DCAE)",
  "Autoridad Fiscalizadora (C/I)",
  "BPCH · SCC · Escalón Internaciones (archivo)",
];

export const MEDIOS_NOTIFICACION = ["oficina_partes", "correo", "integracion"] as const;
export type MedioNotificacion = (typeof MEDIOS_NOTIFICACION)[number];
export const NOMBRE_MEDIO: Record<MedioNotificacion, string> = {
  oficina_partes: "Oficina de partes",
  correo: "Correo electrónico",
  integracion: "Integración DGMN",
};

/** Documentos que obligan a notificar a DGMN. */
export const TIPOS_INCUMPLIMIENTO = ["INFORME_INCUMPLIMIENTO", "INFORME_INCUMPLIMIENTO_ARMA"] as const;

const OFICIAL = new Set(["oficial", "emitido"]);

export interface DocIncumplimiento {
  numero: string;
  estado: string;
  notificado: boolean;
}

/** Qué falta para cerrar: un incumplimiento oficial sin su notificación a DGMN. */
export function faltantesNotificacion(docs: DocIncumplimiento[]): string[] {
  return docs
    .filter((d) => OFICIAL.has(d.estado) && !d.notificado)
    .map((d) => `Falta registrar la notificación a DGMN del Informe de Incumplimiento ${d.numero} (EP-10 10.15): la registra la Subdirección BPCH.`);
}

export interface NotificacionPedida {
  documento: { estado: string; tipo: string | null } | null;
  yaNotificado: boolean;
  medio: string;
  fechaEnvio: string;
  hoy: string;
  copiaInternador: boolean | null | undefined;
  oficioNumero?: string | null;
}

export function erroresNotificacion(n: NotificacionPedida): string[] {
  const e: string[] = [];
  if (!n.documento || !TIPOS_INCUMPLIMIENTO.includes(n.documento.tipo as any))
    return ["El documento no es un Informe de Incumplimiento de esta OT."];
  if (!OFICIAL.has(n.documento.estado)) e.push("El Informe de Incumplimiento aún no es oficial: fírmelo antes de notificar a DGMN.");
  if (n.yaNotificado) e.push("La notificación a DGMN de este informe ya está registrada.");
  if (!(MEDIOS_NOTIFICACION as readonly string[]).includes(n.medio)) e.push("Indique el medio de envío.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.fechaEnvio)) e.push("Indique la fecha de envío.");
  else if (n.fechaEnvio > n.hoy) e.push("La fecha de envío no puede ser futura.");
  if (typeof n.copiaInternador !== "boolean") e.push("Indique si se envió copia al internador.");
  if (n.medio === "oficina_partes" && !n.oficioNumero?.trim()) e.push("Por oficina de partes indique el Nº de oficio.");
  return e;
}
