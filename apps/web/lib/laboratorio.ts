/**
 * laboratorio.ts · piezas compartidas del flujo de laboratorio en la web:
 * llamadas a la API con mensaje de error legible, vocabulario de estados y
 * veredictos, y lectura de réplicas con coma decimal.
 *
 * Reglas de negocio: docs/FLUJO_LABORATORIO.md. La que vale siempre es la del
 * servidor; aquí solo se pinta y se avisa antes de enviar.
 */
import { errorMensajeDe } from "@/lib/apiError";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function cabeceras(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

/** Llamada a la API. Lanza Error con el mensaje del servidor (en español). */
export async function llamar<T = any>(metodo: "GET" | "POST" | "PATCH" | "PUT", ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: cabeceras(),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (r.ok) return r.status === 204 ? (undefined as T) : r.json();
  const j: any = await r.json().catch(() => null);
  if (Array.isArray(j?.message)) throw new Error(j.message.join(", "));
  throw new Error(errorMensajeDe(j, r.status));
}

/** Arma una query string omitiendo vacíos. */
export function qs(p: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    u.set(k, v === true ? "1" : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export interface Paginado<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface Unidad {
  id: string;
  codigo: string;
  nombre: string;
  tipo?: string | null;
}

/** Etiqueta corta de un laboratorio: «LQC · Laboratorio Químico Central». */
export const etiquetaUnidad = (u?: Unidad | null) => (u ? `${u.codigo} · ${u.nombre}` : "—");

/** Ciclo de vida del resultado (vocabulario de apps/api/src/common/estados.ts). */
export const ESTADO_RESULTADO: Record<string, { texto: string; pill: string }> = {
  pendiente: { texto: "Por capturar", pill: "gray" },
  capturado: { texto: "Por revisar", pill: "blue" },
  revisado_n1: { texto: "Revisado · por aprobar", pill: "teal" },
  aprobado: { texto: "Aprobado", pill: "green" },
  devuelto: { texto: "Devuelto", pill: "amber" },
  rechazado: { texto: "Rechazado", pill: "red" },
};

/** Veredicto único (apps/api/src/laboratorio/veredicto.ts). */
export const VEREDICTO: Record<string, { texto: string; pill: string }> = {
  cumple: { texto: "Cumple", pill: "green" },
  no_cumple: { texto: "No cumple", pill: "red" },
  informativo: { texto: "Informativo", pill: "gray" },
  pendiente: { texto: "Pendiente", pill: "amber" },
};

/** Normaliza también los veredictos antiguos («Cumple», «No cumple», «Informativo»). */
export function veredictoInfo(v?: string | null): { texto: string; pill: string } {
  const s = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return VEREDICTO[s] ?? (v ? { texto: String(v), pill: "gray" } : { texto: "—", pill: "gray" });
}

/**
 * Lectura de réplicas · MISMA regla que apps/api/src/laboratorio/replicas.ts:
 * la coma entre dígitos es decimal (12,4 = doce coma cuatro); separan réplicas
 * los espacios, saltos de línea, el punto y coma y la coma seguida de espacio.
 * Lo ambiguo («12,4,5», «1.234,5») se marca como inválido, no se adivina.
 */
export function leerReplicas(texto: string): { valores: number[]; invalidos: string[] } {
  const valores: number[] = [];
  const invalidos: string[] = [];
  const trozos = String(texto ?? "")
    .replace(/,(?=\s|$)/g, " ")
    .split(/[\s;]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  for (const t of trozos) {
    if (!/^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(t)) {
      invalidos.push(t);
      continue;
    }
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) valores.push(n);
    else invalidos.push(t);
  }
  return { valores, invalidos };
}
