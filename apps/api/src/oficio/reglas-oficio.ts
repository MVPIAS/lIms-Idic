/**
 * Oficio conductor · reglas PURAS (sin BD), probadas en reglas-oficio.spec.ts.
 * Contrato: docs/FLUJO_AVISOS_DESPACHO_OFICIO.md §4 (EP-00 3.1–3.3, EP-05 7.2).
 *
 *   borrador ──generar──▶ en_firma ──última firma──▶ firmado ──despachar──▶ despachado
 *                             │ devolver                                   (Oficina de partes)
 *                             ▼
 *                          devuelto ──corregir y generar──▶ en_firma
 *   borrador | devuelto | en_firma | firmado ──anular──▶ anulado
 */
import { escapeHtml } from "../plantilla-render/html.util";

export type EstadoOficio = "borrador" | "en_firma" | "devuelto" | "firmado" | "despachado" | "anulado";

const TRANSICIONES: Record<EstadoOficio, EstadoOficio[]> = {
  borrador: ["en_firma", "anulado"],
  en_firma: ["firmado", "devuelto", "anulado"],
  devuelto: ["en_firma", "anulado"],
  firmado: ["despachado", "anulado"],
  despachado: [],
  anulado: [],
};

const TEXTO_ESTADO: Record<EstadoOficio, string> = {
  borrador: "en borrador",
  en_firma: "en firma",
  devuelto: "devuelto",
  firmado: "firmado",
  despachado: "despachado",
  anulado: "anulado",
};

/** Error si el oficio no puede pasar de `de` a `a`; null si puede. */
export function errorTransicionOficio(de: string, a: EstadoOficio): string | null {
  const permitidas = TRANSICIONES[de as EstadoOficio];
  if (!permitidas) return `Estado desconocido del oficio: ${de}.`;
  if (permitidas.includes(a)) return null;
  return `El oficio está ${TEXTO_ESTADO[de as EstadoOficio]}: no se puede ${a === "en_firma" ? "enviar a firmas" : a === "firmado" ? "firmar" : a === "despachado" ? "despachar" : a === "devuelto" ? "devolver" : "anular"}.`;
}

/** Solo se corrige un oficio en borrador o devuelto. */
export const editable = (estado: string) => estado === "borrador" || estado === "devuelto";

export interface DatosOficio {
  destinatario: string;
  materia: string;
  documentos: string[];
  cotizacionId: string | null;
  otId: string | null;
  distribucion: { destinatario: string; ejemplares: number }[];
}

/** Errores del contenido del oficio antes de enviarlo a firmas. */
export function erroresOficio(o: DatosOficio): string[] {
  const e: string[] = [];
  if (!o.cotizacionId && !o.otId) e.push("El oficio conduce una cotización o documentos de una OT.");
  if (!o.cotizacionId && o.otId && !o.documentos.length) e.push("Elija el documento que conduce el oficio (IVC, Informe Técnico, Rechazo…).");
  if ((o.destinatario ?? "").trim().length < 3) e.push("Indique el destinatario.");
  if ((o.materia ?? "").trim().length < 3) e.push("Indique la materia del oficio.");
  for (const d of o.distribucion) {
    if (!d.destinatario?.trim()) e.push("Cada línea de distribución lleva su destinatario.");
    if (!Number.isInteger(d.ejemplares) || d.ejemplares < 1 || d.ejemplares > 50) e.push("Los ejemplares de la distribución van de 1 a 50.");
  }
  return [...new Set(e)];
}

/** Errores del despacho por la Oficina de partes (EP-00 3.3). */
export function erroresDespachoOficio(d: { numero: string; fecha: string; hoy: string }): string[] {
  const e: string[] = [];
  if (!d.numero?.trim()) e.push("Indique el Nº de despacho.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha ?? "")) e.push("Indique la fecha de despacho.");
  else if (d.fecha > d.hoy) e.push("La fecha de despacho no puede ser futura.");
  return e;
}

/* ------------------------------------------------------------------ HTML --- */

export interface VistaOficio {
  numero: string | null;
  unidad: { codigo: string; nombre: string };
  fecha: string; // dd-mm-aaaa
  destinatario: string;
  materia: string;
  cuerpo: string | null;
  referencias: string[];
  distribucion: { destinatario: string; ejemplares: number }[];
  despacho: { numero: string; fecha: string } | null;
}

/**
 * Cuerpo del oficio en el subconjunto de HTML del renderizador PDF (h1–h3, p,
 * table…). Todo dato del usuario va escapado. Las firmas y el sello van fuera
 * del cuerpo (pie del PDF), como en los informes.
 */
export function htmlOficio(v: VistaOficio): string {
  const p = (t: string) => `<p>${escapeHtml(t)}</p>`;
  const parrafos = (v.cuerpo ?? "")
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => p(x))
    .join("");
  return [
    `<h3>Instituto de Investigaciones y Control del Ejército de Chile</h3>`,
    p(`${v.unidad.nombre} (${v.unidad.codigo})`),
    `<h1>OFICIO ${escapeHtml(v.numero ?? "(sin número: borrador)")}</h1>`,
    p(`Santiago, ${v.fecha}`),
    `<table><tbody>`,
    `<tr><th>OBJ.</th><td>${escapeHtml(v.materia)}</td></tr>`,
    v.referencias.length ? `<tr><th>REF.</th><td>${escapeHtml(v.referencias.join("; "))}</td></tr>` : "",
    `<tr><th>A</th><td>${escapeHtml(v.destinatario)}</td></tr>`,
    `</tbody></table>`,
    parrafos || p("Remito a usted lo indicado en la referencia, para su conocimiento y fines que estime pertinentes."),
    v.distribucion.length
      ? `<h3>Distribución</h3><table><thead><tr><th>Destinatario</th><th class="num">Ejemplares</th></tr></thead><tbody>${v.distribucion
          .map((d) => `<tr><td>${escapeHtml(d.destinatario)}</td><td class="num">${d.ejemplares}</td></tr>`)
          .join("")}</tbody></table>`
      : "",
    v.despacho ? p(`Despachado por Oficina de partes: Nº ${v.despacho.numero} del ${v.despacho.fecha}.`) : "",
  ].join("");
}
