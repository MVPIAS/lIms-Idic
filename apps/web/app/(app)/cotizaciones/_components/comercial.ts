"use client";

/**
 * Helpers del módulo Comercial (cotizaciones · Comercial rondas 1 y 2, oct-2026).
 * Tipos, llamada HTTP con mensajes de validación legibles y catálogos fijos de
 * etiquetas (los combos editables vienen de GET /cotizaciones/config).
 */

export const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function cabeceras(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

/** Llamada a la API. Ante error lanza Error con el mensaje + los issues de zod. */
export async function pedir<T = any>(metodo: "GET" | "POST" | "PATCH", ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: cabeceras(),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (r.ok) return r.status === 204 ? (undefined as T) : r.json();
  const j: any = await r.json().catch(() => ({}));
  const issues: string[] = Array.isArray(j?.issues)
    ? j.issues.map((it: any) => {
        const campo = Array.isArray(it?.path) ? it.path.join(".") : it?.path;
        return campo ? `${campo}: ${it?.message}` : String(it?.message);
      })
    : [];
  const msg = Array.isArray(j?.message) ? j.message.join(", ") : j?.message ?? `Error ${r.status}`;
  throw new Error(issues.length ? `${msg} · ${issues.join(" · ")}` : msg);
}

export type Opcion = { codigo: string; etiqueta: string; valor?: string | null; activo?: boolean };

export type CentroCosto = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  grupo: string;
  laboratorio?: string | null;
  condicionesBase?: string | null;
  validezParticularDias?: number | null;
};

export type ConfigCotizacion = {
  parametros: Record<string, Opcion[]>;
  centrosCosto: CentroCosto[];
  validez: { particularDias: number; ejercitoMesesOctDic: number };
  condicionesMax: number;
};

export const GRUPOS_CC = ["Laboratorios", "Sucursales y Delegación BPCH"] as const;

/** Estados vigentes (R1) y su color; el resto es histórico de solo lectura. */
export const ESTADOS_VIGENTES = ["abierta", "aceptada", "anulada"] as const;
export const ESTADO_PILL: Record<string, string> = {
  abierta: "blue",
  aceptada: "green",
  anulada: "red",
};
export const ESTADO_LABEL: Record<string, string> = {
  abierta: "Abierta",
  aceptada: "Aceptada",
  anulada: "Anulada",
  borrador: "Borrador (histórico)",
  enviada: "Enviada (histórico)",
  rechazada: "Rechazada (histórico)",
  expirada: "Vencida (histórico)",
};

export const ACEPTACION_LABEL: Record<string, string> = {
  OPI_RESOLUCION: "OPI / Resolución (Ejército)",
  OC: "Orden de compra",
  CORREO: "Aprobación por correo (particular)",
  PAGO_ADELANTADO: "Comprobante de pago por adelantado",
  DISPOSICION_DIRECTOR: "Disposición del Director (sin OPI previa)",
};

export const ORIGEN_LABEL: Record<string, string> = {
  COTIZACION: "Cotización",
  INTERNACION: "Internación",
  DISPOSICION: "Disposición del Director",
  INTERLABORATORIO: "Interlaboratorio",
  OT_INTERNA: "OT interna",
};

export const hoyISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const etiquetaDe = (ops: Opcion[] | undefined, codigo?: string | null) =>
  (codigo && ops?.find((o) => o.codigo === codigo)?.etiqueta) || codigo || "—";
