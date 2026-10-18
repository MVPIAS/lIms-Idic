"use client";

/**
 * Helpers de las pantallas BPCH (Internación, Reinspección, Codificación Única).
 * API: /bpch/* · reglas en docs/FLUJO_BPCH_INTERNACION_REINSPECCION_CODIFICACION.md
 */
export { pedir } from "../../cotizaciones/_components/comercial";

export type Unidad = { id: string; codigo: string; nombre: string; tipo: string | null };
export type PlantillaBpch = { id: string; repid: string; nombre: string };
export type ConfigBpch = {
  unidades: Unidad[];
  parametros: { tasaPct: number | null; ivaPct: number | null; motivosReinspeccion: { codigo: string; etiqueta: string }[] };
  plantillas: Record<"INFORME_INSPECCION" | "CERTIFICADO_CONFORMIDAD" | "INFORME_INCUMPLIMIENTO", PlantillaBpch[]>;
};

export type Fase = { clave: string; titulo: string; estado: "hecho" | "en_curso" | "pendiente" | "no_aplica"; detalle: string | null };

export const LISTADOS: Record<string, string> = { EXPLOSIVOS: "Explosivos", SUSTANCIAS_QUIMICAS: "Sustancias químicas" };
export const ESTADO_COD: Record<string, { l: string; c: string }> = {
  VIGENTE: { l: "Vigente", c: "green" },
  EN_RECESO: { l: "En receso", c: "amber" },
};

export const ESTADO_INTERNACION: Record<string, { l: string; c: string }> = {
  registrada: { l: "Registrada · por analizar", c: "blue" },
  antecedentes_pendientes: { l: "Antecedentes pedidos a DGMN", c: "amber" },
  ot_generada: { l: "OT generada", c: "teal" },
  anulada: { l: "Anulada", c: "gray" },
};

export const DOC_ADM: Record<string, string> = {
  no_aplica: "No aplica (sin tasa)",
  pendiente: "Pendiente de solicitar",
  solicitada: "Solicitada al importador",
  recibida: "Recibida · por revisar",
  conforme: "Conforme",
  no_conforme: "No conforme · volver a solicitar",
};

export const CONDICION: Record<string, { l: string; c: string }> = {
  cumple: { l: "CUMPLE", c: "green" },
  no_cumple: { l: "NO CUMPLE", c: "red" },
  pendiente: { l: "PENDIENTE", c: "gray" },
};

export const hoy = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** "2026-10-17T00:00:00.000Z" → "2026-10-17" para un <input type="date">. */
export const dia = (v: unknown) => (v ? String(v).slice(0, 10) : "");

/** Número de un input («1.482» o «1482,5») o null. */
export function numero(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}
