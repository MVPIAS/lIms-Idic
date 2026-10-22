/**
 * informes.ts · tipos y textos del informe de ensayo (frontend).
 * Reglas del servidor: docs/FLUJO_INFORME_ENSAYO.md.
 */

export type Modalidad = "cumplimiento" | "solo_resultados";

export const MODALIDAD: Record<Modalidad, { texto: string; corto: string; ayuda: string }> = {
  cumplimiento: {
    texto: "Informe de cumplimiento",
    corto: "Cumplimiento",
    ayuda: "Con el requisito de cada ensayo y su veredicto (Cumple / No cumple), el veredicto de la muestra y las referencias de los No cumple.",
  },
  solo_resultados: {
    texto: "Informe de solo resultados",
    corto: "Solo resultados",
    ayuda: "Solo el valor de cada ensayo, sin requisito ni veredicto.",
  },
};

/** Etiqueta corta de la modalidad guardada en un documento (null en los anteriores a esta versión). */
export const textoModalidad = (m: string | null | undefined) =>
  m === "cumplimiento" || m === "solo_resultados" ? MODALIDAD[m].corto : null;

/** Portada del Informe de Verificación de Calidad (IVC). */
export interface Portada {
  proposito?: string | null;
  opiOc?: string | null;
  fechaOpi?: string | null;
  contrato?: string | null;
  fechaContrato?: string | null;
  proyecto?: string | null;
  proveedor?: string | null;
  item?: string | null;
  cantidad?: string | null;
  fabricante?: string | null;
  paisOrigen?: string | null;
}

export const CAMPOS_PORTADA: { clave: keyof Portada; etiqueta: string; max: number; ancho?: 2 }[] = [
  { clave: "proposito", etiqueta: "Propósito del documento", max: 300, ancho: 2 },
  { clave: "opiOc", etiqueta: "N.º OPI / orden de compra", max: 80 },
  { clave: "fechaOpi", etiqueta: "Fecha OPI", max: 40 },
  { clave: "contrato", etiqueta: "Contrato", max: 120 },
  { clave: "fechaContrato", etiqueta: "Fecha de contrato", max: 40 },
  { clave: "proyecto", etiqueta: "Nombre del proyecto", max: 200, ancho: 2 },
  { clave: "proveedor", etiqueta: "Proveedor", max: 200, ancho: 2 },
  { clave: "item", etiqueta: "Identificación del ítem", max: 240, ancho: 2 },
  { clave: "cantidad", etiqueta: "Cantidad", max: 60 },
  { clave: "fabricante", etiqueta: "Fabricante", max: 200 },
  { clave: "paisOrigen", etiqueta: "País de origen", max: 80 },
];

/** Formato del informe de una plantilla (config-informe.ts del servidor). */
export interface FormatoInforme {
  agrupacion: "muestra" | "seccion" | "unica";
  numeracion: string | null;
  columnaMetodo: boolean;
  columnaUnidad: boolean;
  estadisticas: "auto" | "siempre" | "nunca";
  referencias: boolean;
  anexoFotografico: boolean;
  conclusionFija: string | null;
  portada: "ninguna" | "ivc";
  etiquetas: {
    ensayo: string; metodo: string; unidad: string; requisito: string; resultado: string; veredicto: string;
    minimo: string; maximo: string; muestra: string;
  };
  /** texto = columna «Requisito»; min_max = columnas Mínimo / Máximo (LME). */
  columnasRequisito: "texto" | "min_max";
  unidadEnResultado: boolean;
  columnaMuestra: boolean;
  textoSinCota: string;
}

/** Lo que el servidor propone para el documento (POST /informes/propuesta). */
export interface Propuesta {
  formato: FormatoInforme;
  modalidad: Modalidad;
  conRequisito: number;
  totalEnsayos: number;
  portada: Portada | null;
  /** Cobertura que propone el laboratorio de la OT (docs/FLUJO_DOCUMENTOS_POR_OT.md). */
  cobertura?: { cobertura: string; porConfirmar: boolean; fuente: string | null } | null;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/**
 * PUT con JSON o POST multipart (fotos): el cliente `api` solo envía JSON por
 * GET/POST/PATCH/DELETE. Mismo token y mismo mensaje de error que `api`.
 */
export async function enviarInforme(ruta: string, metodo: "PUT" | "POST", cuerpo: object | FormData): Promise<any> {
  const token = typeof window === "undefined" ? null : localStorage.getItem("lims_token");
  const esForm = typeof FormData !== "undefined" && cuerpo instanceof FormData;
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { ...(esForm ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: esForm ? (cuerpo as FormData) : JSON.stringify(cuerpo),
  });
  if (r.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("lims_token");
    window.location.href = "/login";
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(", ") : j.message ?? `Error ${r.status}`);
  return j;
}

/**
 * Imagen protegida (p. ej. una foto de la OT: GET informes/fotos/:id/imagen)
 * pedida con la sesión. Devuelve una URL local (blob:) que quien la usa debe
 * liberar con URL.revokeObjectURL.
 */
export async function imagenConSesion(ruta: string): Promise<string> {
  const token = typeof window === "undefined" ? null : localStorage.getItem("lims_token");
  const r = await fetch(`${API}/${ruta.replace(/^\/+/, "")}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return URL.createObjectURL(await r.blob());
}
