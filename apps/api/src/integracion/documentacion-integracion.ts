/**
 * Documentación adjunta de las integraciones (se descarga desde Administración ›
 * API e integración). Lista cerrada: solo se sirven estos archivos, por nombre
 * exacto, desde `apps/api/documentacion/<grupo>/`. No contienen secretos ni datos
 * reales (ejemplos con datos PRUEBA).
 */
import { existsSync, statSync } from "fs";
import { join, resolve } from "path";

export interface DocumentoIntegracion {
  grupo: string;
  archivo: string;
  titulo: string;
  descripcion: string;
  tipo: string;
}

export const GRUPO_ARMAS = "integracion-armas-bpch";

export const DOCUMENTOS_INTEGRACION: DocumentoIntegracion[] = [
  {
    grupo: GRUPO_ARMAS,
    archivo: "01_Documento_Funcional_Integracion_Armas_BPCH.docx",
    titulo: "Documento funcional",
    descripcion: "Qué hace cada sistema, recorrido de la OT, estados, acuerdos y puntos a confirmar, con hoja de validación.",
    tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    grupo: GRUPO_ARMAS,
    archivo: "02_Especificacion_Tecnica_Integracion_Armas_BPCH.docx",
    titulo: "Especificación técnica",
    descripcion: "Mensajes, seguridad (token y firma HMAC), reintentos, estados, enlaces, configuración, pasos para integrar y pruebas de aceptación.",
    tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    grupo: GRUPO_ARMAS,
    archivo: "03_Coleccion_Postman_LIMS_IDIC_integracion_armas.json",
    titulo: "Colección Postman",
    descripcion: "Rutas de entrada del LIMS con ejemplos PRUEBA y cálculo automático de la firma. Variables vacías: se completan por canal seguro.",
    tipo: "application/json",
  },
  {
    grupo: GRUPO_ARMAS,
    archivo: "04_Guia_Tecnica_INTEGRACION_ARMAS_BPCH.md",
    titulo: "Guía técnica (Markdown)",
    descripcion: "Guía de desarrollo y operación de la integración.",
    tipo: "text/markdown; charset=utf-8",
  },
];

/** Carpeta raíz de la documentación (funciona en src/ y en dist/). */
export function carpetaDocumentacion(): string {
  return resolve(__dirname, "..", "..", "documentacion");
}

/** Documento de la lista cerrada (null si el nombre no está o no existe). */
export function buscarDocumento(grupo: string, archivo: string): { doc: DocumentoIntegracion; ruta: string } | null {
  const doc = DOCUMENTOS_INTEGRACION.find((d) => d.grupo === grupo && d.archivo === archivo);
  if (!doc) return null;
  const ruta = join(carpetaDocumentacion(), doc.grupo, doc.archivo);
  return existsSync(ruta) ? { doc, ruta } : null;
}

/** Lista con el tamaño de cada archivo disponible. */
export function listarDocumentos(): Array<DocumentoIntegracion & { bytes: number }> {
  return DOCUMENTOS_INTEGRACION.flatMap((d) => {
    const ruta = join(carpetaDocumentacion(), d.grupo, d.archivo);
    return existsSync(ruta) ? [{ ...d, bytes: statSync(ruta).size }] : [];
  });
}
