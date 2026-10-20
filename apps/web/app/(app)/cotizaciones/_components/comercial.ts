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
export async function pedir<T = any>(metodo: "GET" | "POST" | "PATCH" | "PUT", ruta: string, cuerpo?: unknown): Promise<T> {
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

/**
 * Estados vigentes y su color; el resto es histórico de solo lectura.
 * 'expirada' (Vencida) la pone el SISTEMA cuando una Abierta supera su validez
 * (ya no se puede aceptar; sí anular).
 */
export const ESTADOS_VIGENTES = ["abierta", "aceptada", "anulada", "expirada"] as const;
export const ESTADO_PILL: Record<string, string> = {
  abierta: "blue",
  aceptada: "green",
  anulada: "red",
  expirada: "amber",
};
export const ESTADO_LABEL: Record<string, string> = {
  abierta: "Abierta",
  aceptada: "Aceptada",
  anulada: "Anulada",
  borrador: "Borrador (histórico)",
  enviada: "Enviada (histórico)",
  rechazada: "Rechazada (histórico)",
  expirada: "Vencida",
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
  REINSPECCION: "Reinspección (BPCH)",
  PRODUCCION_NACIONAL: "Producción Nacional",
  PROTOTIPO: "Prototipo",
};

export const hoyISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** ¿La validez ya terminó? (valida_hasta es inclusive). Fechas AAAA-MM-DD comparables como texto. */
export const fueraDeValidez = (c: { validaHasta?: string | null; expiraAt?: string | null }) => {
  const f = String(c.validaHasta ?? c.expiraAt ?? "").slice(0, 10);
  return !!f && f < hoyISO();
};

/** Vence entre hoy y dentro de `dias` días (seguimiento comercial). */
export const porVencer = (c: { estado: string; validaHasta?: string | null; expiraAt?: string | null }, dias = 7) => {
  if (c.estado !== "abierta") return false;
  const f = String(c.validaHasta ?? c.expiraAt ?? "").slice(0, 10);
  if (!f) return false;
  const limite = new Date();
  limite.setDate(limite.getDate() + dias);
  const p = (n: number) => String(n).padStart(2, "0");
  const lim = `${limite.getFullYear()}-${p(limite.getMonth() + 1)}-${p(limite.getDate())}`;
  return f >= hoyISO() && f <= lim;
};

export const etiquetaDe = (ops: Opcion[] | undefined, codigo?: string | null) =>
  (codigo && ops?.find((o) => o.codigo === codigo)?.etiqueta) || codigo || "—";

/** GET que devuelve texto (vista previa HTML del documento). */
export async function pedirTexto(ruta: string): Promise<string> {
  const r = await fetch(`${API}${ruta}`, { headers: cabeceras() });
  if (!r.ok) {
    const j: any = await r.json().catch(() => ({}));
    throw new Error(j?.message ?? `Error ${r.status}`);
  }
  return r.text();
}

/** Descarga el PDF de la cotización (protegido por JWT: un <a href> plano daría 401). */
export async function descargarPdfCotizacion(id: string, codigo: string): Promise<void> {
  const r = await fetch(`${API}/cotizaciones/${id}/pdf`, { headers: cabeceras() });
  if (!r.ok) {
    const j: any = await r.json().catch(() => ({}));
    throw new Error(j?.message ?? `Error ${r.status} al generar el PDF`);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `Cotizacion-${codigo.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
