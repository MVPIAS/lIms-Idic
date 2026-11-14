/**
 * fea.ts · Firma Electrónica Avanzada (FEA) del Estado en el PDF final.
 * El LIMS no se conecta a FirmaGob: el firmante descarga el PDF emitido, lo
 * firma en su equipo y sube el archivo firmado. Reglas del servidor:
 * apps/api/src/fea/fea.reglas.ts · docs/FLUJO_FEA_DOCUMENTOS.md.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const token = () => (typeof window === "undefined" ? null : localStorage.getItem("lims_token"));

export type OrigenFea = "informe" | "metrologia";

export interface EstadoFea {
  origen: OrigenFea;
  documentoId: string;
  numero: string;
  tipoDocumento: string | null;
  tipoDocumentoNombre: string;
  estado: string;
  oficial: boolean;
  exigeFea: boolean;
  entregado: boolean;
  firmantes: string[];
  original: { id: string; hash: string; bytes: number; congeladoAt: string } | null;
  firmado: FirmadoFea | null;
  anteriores: FirmadoFea[];
  historial: { accion: string; detalle: string | null; createdAt: string; usuario: string | null }[];
  puedo: { descargar: boolean; subir: boolean; aceptarExcepcion: boolean };
  soyFirmante: boolean;
}

export interface FirmadoFea {
  id: string;
  nombre: string;
  bytes: number;
  hash: string;
  firmanteNombre: string | null;
  firmaFecha: string | null;
  firmaFechaTexto: string | null;
  firmas: number;
  integridad: "comprobada" | "sin_comprobar" | "no_cuadra";
  corresponde: boolean;
  excepcionMotivo: string | null;
  excepcionPor: string | null;
  subidoPor: string | null;
  subidoAt: string;
  leyenda: string;
}

export const ACCION_FEA: Record<string, string> = {
  DESCARGA_PARA_FIRMAR: "Descargó el PDF para firmar",
  SUBIDO: "Subió la versión firmada",
  EXCEPCION: "Aceptó un PDF con excepción",
  RECHAZADO: "Archivo rechazado",
};

/** Error de la API con los datos del 409 «requiere excepción». */
export class ErrorFea extends Error {
  constructor(mensaje: string, readonly requiereExcepcion = false, readonly puedeAceptar = false) {
    super(mensaje);
  }
}

async function errorDe(r: Response): Promise<ErrorFea> {
  const j = await r.json().catch(() => ({}) as any);
  const m = Array.isArray(j?.message) ? j.message.join(", ") : j?.message ?? `Error ${r.status}`;
  return new ErrorFea(m, !!j?.requiereExcepcion, !!j?.puedeAceptar);
}

/** Descarga un PDF protegido con el nombre indicado. */
async function bajar(ruta: string, nombre: string) {
  const r = await fetch(`${API}${ruta}`, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
  if (!r.ok) throw await errorDe(r);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const archivo = (numero: string, fea: boolean) => `${String(numero || "documento").replace(/[^A-Za-z0-9._-]/g, "_")}${fea ? "_FEA" : ""}.pdf`;

export const descargarParaFirmar = (origen: OrigenFea, id: string, numero: string) => bajar(`/fea/${origen}/${id}/original`, archivo(numero, false));
export const descargarFirmado = (origen: OrigenFea, id: string, numero: string) => bajar(`/fea/${origen}/${id}/firmado`, archivo(numero, true));

export async function estadoFea(origen: OrigenFea, id: string): Promise<EstadoFea> {
  const r = await fetch(`${API}/fea/${origen}/${id}`, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
  if (!r.ok) throw await errorDe(r);
  return r.json();
}

export async function subirFirmado(origen: OrigenFea, id: string, pdf: File, motivoExcepcion?: string): Promise<EstadoFea> {
  const f = new FormData();
  f.append("archivo", pdf, pdf.name);
  if (motivoExcepcion?.trim()) f.append("motivoExcepcion", motivoExcepcion.trim());
  const r = await fetch(`${API}/fea/${origen}/${id}/firmado`, { method: "POST", headers: token() ? { Authorization: `Bearer ${token()}` } : {}, body: f });
  if (!r.ok) throw await errorDe(r);
  return r.json();
}

export const TEXTO_INTEGRIDAD: Record<string, string> = {
  comprobada: "la firma cuadra con el contenido del PDF",
  sin_comprobar: "la integridad de la firma no se pudo comprobar en el LIMS (compruébela en el lector de PDF)",
  no_cuadra: "la firma NO cuadra con el contenido",
};
