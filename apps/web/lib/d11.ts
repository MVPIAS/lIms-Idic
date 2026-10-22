/**
 * d11.ts · Delegación Nº 11 · certificación de armas internadas (EP-11).
 * Tipos de la API /d11 y ayudas de las pantallas. Las reglas valen en el
 * servidor (apps/api/src/saec/d11/reglas-d11.ts); aquí solo se pintan.
 */
import { errorMensajeDe } from "@/lib/apiError";

export { pedir } from "../app/(app)/cotizaciones/_components/comercial";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const token = () => (typeof window !== "undefined" ? localStorage.getItem("lims_token") : null);

/** Sube una planilla (.xlsx o .csv) en multipart: campo «archivo». */
export async function subirPlanilla<T = any>(ruta: string, archivo: File): Promise<T> {
  const f = new FormData();
  f.append("archivo", archivo, archivo.name);
  const r = await fetch(`${API}${ruta}`, { method: "POST", headers: token() ? { Authorization: `Bearer ${token()}` } : {}, body: f });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(errorMensajeDe(j, r.status));
  return j as T;
}

export const TIPOS_ARMA: { valor: string; texto: string }[] = [
  { valor: "pistola", texto: "Pistola" },
  { valor: "revolver", texto: "Revólver" },
  { valor: "fusil", texto: "Fusil" },
  { valor: "carabina", texto: "Carabina" },
  { valor: "subfusil", texto: "Subfusil" },
  { valor: "escopeta", texto: "Escopeta" },
  { valor: "hechiza", texto: "Hechiza" },
  { valor: "otro", texto: "Otro" },
];
export const textoTipo = (t?: string | null) => TIPOS_ARMA.find((x) => x.valor === t)?.texto ?? t ?? "—";

export const CLASES = [
  { valor: "arma", texto: "Arma" },
  { valor: "accesorio", texto: "Accesorio (IT10)" },
  { valor: "maquina_recargadora", texto: "Máquina recargadora (IT12)" },
];

/** Color de la etapa del arma. */
export const PILL_ETAPA: Record<string, string> = {
  registrada: "gray",
  prohibida: "red",
  en_ensayo: "blue",
  por_revisar: "amber",
  no_cumple: "red",
  por_acunar: "blue",
  por_certificar: "teal",
  certificado_en_firma: "amber",
  certificada: "green",
  entregada: "green",
};

export interface Marca { id: string; nombre: string; pais: string | null; activo: boolean; origen: string }
export interface Modelo { id: string; marcaId: string; nombre: string; activo: boolean }
export interface Calibre { id: string; nombre: string; cip: boolean; activo: boolean }
export interface Catalogos { marcas: Marca[]; modelos: Modelo[]; calibres: Calibre[]; puedeEditar: boolean; puedeAgregar: boolean }

export interface PasoD11 { clave: string; titulo: string; boton: string; leToca: string; estado: "hecho" | "en_curso" | "pendiente"; detalle: string }

export interface ArmaOt {
  id: string;
  orden: number;
  resolucionArmaId: string | null;
  muestraId: string;
  muestra: string;
  codigoBarras: string;
  tipo: string;
  tipoNombre: string;
  marca: string | null;
  modelo: string | null;
  calibre: string | null;
  pais: string | null;
  serie: string | null;
  sinSerie: boolean;
  accesorios: string | null;
  lote: string | null;
  ubicacion: string | null;
  clase: string | null;
  claseNombre: string | null;
  permisibilidad: "permitida" | "prohibida" | null;
  camino: string | null;
  caminoNombre: string | null;
  ensayos: number;
  pendientes: number;
  aprobados: number;
  veredicto: string | null;
  acunacion: { numero: string; anio: number; fecha: string } | null;
  requiereAcunacion: boolean;
  certificado: { id: string; numero: string; estado: string; entregadoAt: string | null; vigenteHasta: string | null; vigenteDesde: string | null } | null;
  entregada: boolean;
  etapa: string;
  etapaNombre: string;
  puedeAcunar: boolean;
  puedeCertificar: boolean;
  motivoNoCertifica: string | null;
}

export interface ExpedienteD11 {
  ot: { id: string; codigo: string; estado: string; cliente: string | null; clienteRut: string | null; resolucion: string | null; origen: string | null; abierta: boolean };
  internacion: { id: string; numero: string; resolucion: string; resolucionFecha: string } | null;
  listado: { id: string; orden: number; tipo: string; marca: string; modelo: string | null; calibre: string | null; serie: string | null; accesorios: string | null; cantidad: number }[];
  segunResolucion: number | null;
  expediente: {
    programacion: { fecha: string; lugar: string; responsableId: string; responsable: string | null; registradaAt: string } | null;
    llegada: { fecha: string; transportista: string; bultos: number; avisoPrevio: boolean; observaciones: string | null; registradaAt: string } | null;
    acta: {
      bultos: number; cantidad: number; segunResolucion: number | null; resultado: "concuerda" | "diferencia" | null; ubicacion: string;
      responsable: string | null; observaciones: string | null; firmadaAt: string; firmadaPor: string | null;
    } | null;
  };
  armas: ArmaOt[];
  verificacion: { segunResolucion: number; registradas: number; concuerda: boolean; diferencias: { tipo: string; detalle: string }[] } | null;
  avance: { pasos: PasoD11[]; actual: number; completo: boolean };
  emisiones: { id: string; desde: string; hasta: string; cantidad: number; createdAt: string; emitidaPor: string | null; enFirma: number; oficiales: number; entregados: number; anulados: number }[];
  entregas: { id: string; numero: string; receptorNombre: string; receptorDocumento: string | null; fecha: string; armas: number; registradaPor: string | null; createdAt: string }[];
  personal: { id: string; nombre: string }[];
  config: { acunacionCip: boolean; vigenciaAnios: number };
  puedo: { programar: boolean; registrar: boolean; catalogo: boolean; emitir: boolean; aprobar: boolean; entregarCertificados: boolean };
}

export interface EnsayoFicha {
  resultadoId: string;
  estado: string;
  analito: string;
  metodoCodigo: string | null;
  metodoNombre: string | null;
  norma: string | null;
  limiteInf: string | null;
  limiteSup: string | null;
  valor: string | null;
  veredicto: string | null;
  unidad: string | null;
  entrada: "defecto" | "valor" | "texto" | "atributo";
  grupo: string;
  grupoNombre: string | null;
}

export interface FichaArma {
  id: string;
  otId: string;
  otCodigo: string;
  muestra: string;
  descripcion: string;
  serie: string | null;
  calibre: string | null;
  camino: string | null;
  caminoNombre: string | null;
  veredicto: string | null;
  etapa: string;
  etapaNombre: string;
  ensayos: EnsayoFicha[];
  /** 11.17 · prueba de fuego: métodos que gastan munición y cartuchos ya descontados. */
  fuego: { requiere: boolean; metodos: string[]; usos: { cantidad: number; lote: string; calibre: string; createdAt: string; usuario: string | null }[] };
  movimientos: { id: string; evento: string; fecha: string; ubicacion: string | null; motivo: string; receptor: string | null; responsable: string | null; entrega: string | null }[];
}

export const EVENTO_CUSTODIA: Record<string, string> = { entrada: "Entrada a bodega", cambio_ubicacion: "Cambio de ubicación", salida: "Salida · entrega" };

/** Fecha AAAA-MM-DD de hoy en Chile (para los campos de fecha). */
export function hoyChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Acción del expediente: llama a la API, avisa y refresca la pantalla (null si falló). */
export type Accion = (metodo: "POST" | "PUT", ruta: string, cuerpo: unknown, okTexto: string) => Promise<any | null>;

/** Descarga un adjunto protegido por JWT (un <a href> plano daría 401). */
export async function descargarAdjunto(ruta: string, nombre: string): Promise<void> {
  const r = await fetch(`${API}${ruta}`, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error(errorMensajeDe(j, r.status));
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
