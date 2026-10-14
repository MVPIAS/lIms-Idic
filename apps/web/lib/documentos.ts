/**
 * documentos.ts · utilidades del circuito de firma de informes/certificados,
 * de los plazos de la OT y de la facturación (frontend).
 * Reglas del servidor: docs/FLUJO_FIRMA_CIERRE.md.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const token = () => (typeof window === "undefined" ? null : localStorage.getItem("lims_token"));

/** Estado del documento → texto y color. */
export const ESTADO_DOC: Record<string, { texto: string; pill: string }> = {
  en_firma: { texto: "En firma", pill: "amber" },
  oficial: { texto: "Oficial", pill: "green" },
  emitido: { texto: "Oficial (previo)", pill: "green" },
  devuelto: { texto: "Devuelto", pill: "red" },
  anulado: { texto: "Anulado", pill: "gray" },
};

export const ACCION_FIRMA: Record<string, string> = {
  ELABORA: "Elabora",
  REVISA: "Revisa",
  APRUEBA: "Aprueba",
  FIRMA: "Firma",
  OFICIALIZA: "Oficializa",
  VB: "V.º B.º",
};

export const MEDIOS_ENTREGA: { valor: string; texto: string }[] = [
  { valor: "mano", texto: "En mano" },
  { valor: "correo", texto: "Correo electrónico" },
  { valor: "oficina_partes", texto: "Oficina de partes" },
  { valor: "courier", texto: "Courier / correo postal" },
  { valor: "plataforma", texto: "Plataforma del cliente" },
  { valor: "otro", texto: "Otro" },
];

export const textoMedio = (v?: string | null) => MEDIOS_ENTREGA.find((m) => m.valor === v)?.texto ?? v ?? "—";

/** Semáforo de la fecha de compromiso (mismos cortes que el servidor y la bandeja). */
export const SEMAFORO: Record<string, { texto: string; pill: string }> = {
  vencida: { texto: "Vencida", pill: "red" },
  por_vencer: { texto: "Por vencer", pill: "amber" },
  en_plazo: { texto: "En plazo", pill: "green" },
  sin_fecha: { texto: "Sin fecha", pill: "gray" },
  terminada: { texto: "—", pill: "gray" },
};

export const UMBRAL_POR_VENCER_DIAS = 3;

function hoyCl(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Semáforo calculado en el cliente a partir de la fecha de compromiso (columna DATE). */
export function semaforoDe(fechaCompromiso: unknown, estado?: string | null): { semaforo: string; dias: number | null } {
  if (estado === "cerrada" || estado === "anulada") return { semaforo: "terminada", dias: null };
  const m = fechaCompromiso ? String(fechaCompromiso).match(/^(\d{4}-\d{2}-\d{2})/) : null;
  if (!m) return { semaforo: "sin_fecha", dias: null };
  const dias = Math.round((Date.parse(`${m[1]}T00:00:00Z`) - Date.parse(`${hoyCl()}T00:00:00Z`)) / 86_400_000);
  if (dias < 0) return { semaforo: "vencida", dias };
  if (dias <= UMBRAL_POR_VENCER_DIAS) return { semaforo: "por_vencer", dias };
  return { semaforo: "en_plazo", dias };
}

export function textoDias(dias: number | null): string {
  if (dias === null) return "";
  if (dias === 0) return "vence hoy";
  if (dias === 1) return "vence mañana";
  if (dias > 0) return `faltan ${dias} días`;
  return dias === -1 ? "venció ayer" : `venció hace ${-dias} días`;
}

/** Estado de la factura → texto y color. */
export const ESTADO_FACTURA: Record<string, { texto: string; pill: string }> = {
  pendiente: { texto: "Pendiente de facturar", pill: "amber" },
  emitida: { texto: "Emitida", pill: "blue" },
  parcial: { texto: "Pago parcial", pill: "teal" },
  pagada: { texto: "Pagada", pill: "green" },
  anulada: { texto: "Anulada", pill: "red" },
};

/** Abre/descarga un PDF protegido por JWT (un <a href> plano daría 401). */
export async function abrirPdf(documentoId: string, nombre: string): Promise<void> {
  const r = await fetch(`${API}/informes/${documentoId}/pdf`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b?.message ?? `Error ${r.status} al generar el PDF`);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre || "informe"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** HTML imprimible del documento (vista previa con estado y firmas). */
export async function htmlDocumento(documentoId: string): Promise<string> {
  const r = await fetch(`${API}/informes/${documentoId}/html`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b?.message ?? `Error ${r.status}`);
  }
  return r.text();
}

/** Nombres de los responsables de un paso. */
export const nombresResponsables = (responsables: unknown): string =>
  Array.isArray(responsables)
    ? responsables.map((r: any) => r?.nombre + (r?.via === "subrogante" ? " (subrogante)" : "")).filter(Boolean).join(" · ")
    : "";
