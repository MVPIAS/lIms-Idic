/**
 * PDF/A del certificado de evidencia SAEC (RF-K07.1) generado SIEMPRE desde el
 * HTML sellado en `saec_certificado.documento_html`. Lo usan la descarga del
 * módulo SAEC y la Firma Electrónica Avanzada (fea.service.ts, origen «saec»),
 * para que el PDF que se entrega a firmar sea el mismo documento que se descarga.
 */
import { NotFoundException } from "@nestjs/common";
import type { Sello } from "../plantilla-render/plantilla-defecto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { fmtFecha } from "../plantilla-render/html.util";
import { urlVerificacionBase } from "../common/url-verificacion";
import { tituloCertificadoSaec } from "./saec-certificado.plantilla";

/** Fila mínima de saec_certificado (+ código de la evidencia) para emitir el PDF. */
export interface CertificadoSaecFila {
  codigo: string;
  codigo_verificacion: string | null;
  hash_documento: string | null;
  emitido_at: Date | string | null;
  documento_html: string | null;
  evidencia_codigo: string;
}

/** El sello que va al pie del documento (fuera de lo hasheado). */
export function selloCertificadoSaec(c: CertificadoSaecFila): Sello {
  return {
    numero: c.codigo,
    codigoVerificacion: c.codigo_verificacion ?? "—",
    hash: c.hash_documento ?? "",
    fecha: fmtFecha(c.emitido_at as any),
    urlVerificacion: `${urlVerificacionBase()}/${c.codigo_verificacion}`,
  };
}

/**
 * Documento sellado de un certificado, o 404 explicando por qué no lo hay.
 * Un certificado sin `documento_html` es uno emitido antes de RF-K07.1: no se
 * puede reconstruir sin re-renderizar (y re-renderizar rompería el sello).
 */
export function documentoSelladoSaec(c: CertificadoSaecFila): string {
  if (!c.documento_html) {
    throw new NotFoundException(
      `El certificado ${c.codigo} se emitió antes de que se guardara el documento sellado y no puede regenerarse. Emita uno nuevo.`,
    );
  }
  return c.documento_html;
}

/** PDF/A del certificado desde el HTML sellado. */
export function pdfCertificadoSaec(c: CertificadoSaecFila): Promise<Buffer> {
  return generarPdf(documentoSelladoSaec(c), selloCertificadoSaec(c), tituloCertificadoSaec(c.codigo, c.evidencia_codigo));
}
