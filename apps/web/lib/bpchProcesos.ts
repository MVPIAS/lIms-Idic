/**
 * bpchProcesos.ts · piezas comunes de las pantallas BPCH de Producción Nacional,
 * Prototipos y Clasificación de sustancias (docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md).
 * Las reglas valen en el servidor; aquí solo se pintan los estados y se abren
 * los documentos protegidos por JWT.
 */
import { errorMensajeDe } from "@/lib/apiError";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const token = () => (typeof window !== "undefined" ? localStorage.getItem("lims_token") : null);

/** Abre en una pestaña nueva un documento (HTML o PDF) que exige el JWT. */
export async function abrirDocumento(ruta: string): Promise<void> {
  // La pestaña se abre antes de la espera para que el navegador no la bloquee.
  const ventana = window.open("", "_blank");
  const r = await fetch(`${API}${ruta}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) {
    ventana?.close();
    const b = await r.json().catch(() => null);
    throw new Error(errorMensajeDe(b, r.status));
  }
  const url = URL.createObjectURL(await r.blob());
  if (ventana) ventana.location.href = url;
  else window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const ESTADO_LINEA: Record<string, { texto: string; pill: string }> = {
  planificada: { texto: "Planificada", pill: "gray" },
  en_curso: { texto: "OT en curso", pill: "blue" },
  ejecutada: { texto: "Ejecutada", pill: "green" },
  ot_anulada: { texto: "OT anulada", pill: "amber" },
  anulada: { texto: "Anulada", pill: "red" },
};

export const ESTADO_OC: Record<string, { texto: string; pill: string }> = {
  vigente: { texto: "Vigente", pill: "green" },
  cerrada: { texto: "Cerrada", pill: "gray" },
  anulada: { texto: "Anulada", pill: "red" },
};

export const ESTADO_CLASIFICACION: Record<string, { texto: string; pill: string }> = {
  borrador: { texto: "Borrador", pill: "gray" },
  registrada: { texto: "Por aprobar", pill: "blue" },
  aprobada: { texto: "Aprobada", pill: "green" },
  reemplazada: { texto: "Reemplazada", pill: "amber" },
  anulada: { texto: "Anulada", pill: "red" },
};

export const ESTADO_PROTOTIPO: Record<string, { texto: string; pill: string }> = {
  ingresado: { texto: "Ingresado", pill: "gray" },
  en_evaluacion: { texto: "En evaluación", pill: "blue" },
  dictaminado: { texto: "Dictaminado", pill: "green" },
  anulado: { texto: "Anulado", pill: "red" },
};

export const RESULTADO_PRUEBA: Record<string, { texto: string; pill: string }> = {
  positivo: { texto: "Positivo (+)", pill: "red" },
  negativo: { texto: "Negativo (−)", pill: "green" },
  incompleto: { texto: "Incompleto", pill: "amber" },
  no_aplica: { texto: "No aplica", pill: "gray" },
};

export const ESTADO_CORRELACION: Record<string, { texto: string; pill: string }> = {
  borrador: { texto: "En análisis", pill: "gray" },
  emitido: { texto: "Informe emitido", pill: "blue" },
  remitido: { texto: "Remitido a DCO", pill: "green" },
};

/** «1.240,5» con hasta 3 decimales. */
export const cant = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("es-CL", { maximumFractionDigits: 3 });

/** Fecha AAAA-MM-DD → dd-mm-aaaa, sin cambio de zona. */
export const dia = (v?: string | null) => (v ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}` : "—");

/**
 * Número escrito en es-CL: «12,5» y «1.240,5» con coma decimal; un solo punto
 * sin coma se lee como decimal («12.5»). Devuelve NaN si no se entiende.
 */
export function numeroCl(s: string): number {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if ((t.match(/\./g) ?? []).length > 1) return Number(t.replace(/\./g, ""));
  return Number(t);
}

/** Pide a la API un fichero generado (POST con cuerpo JSON) y lo descarga con el nombre que da el servidor. */
export async function descargarGenerado(ruta: string, cuerpo: unknown, nombrePorDefecto: string): Promise<string> {
  const r = await fetch(`${API}${ruta}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error(errorMensajeDe(b, r.status));
  }
  const nombre = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? nombrePorDefecto;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return nombre;
}
