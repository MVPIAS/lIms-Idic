import { documentoCompleto, type Sello } from "./plantilla-defecto";
import { generarPdf } from "./pdf.renderer";

/**
 * Regresión: el pie se dibuja dentro del margen inferior y, si pdfkit lo
 * considera fuera de la zona útil, abre una página por cada línea del pie
 * (un certificado de 1 página salía con 4; uno de 2, con 8). El número de
 * páginas del PDF debe ser exactamente el de páginas con contenido.
 */

/** Objetos /Page del PDF (sin contar el árbol /Pages). */
const paginas = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

const parrafos = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>Párrafo ${i + 1}: lectura del patrón, corrección e incertidumbre expandida k = 2.</p>`).join("");

const SELLO: Sello = {
  numero: "CERT-LMT-2026-0001",
  codigoVerificacion: "ABCD-1234",
  hash: "a".repeat(64),
  fecha: "18-10-2026",
  urlVerificacion: "https://lims.idic.cl/verificar/ABCD-1234",
};

const pdfDe = (cuerpo: string, sello: Sello) => generarPdf(documentoCompleto(cuerpo, sello, "Prueba"), sello, "Prueba");

describe("generarPdf · número de páginas", () => {
  it("un documento corto ocupa 1 página (sin páginas en blanco por el pie)", async () => {
    expect(paginas(await pdfDe(`<h1>Certificado</h1>${parrafos(5)}`, SELLO))).toBe(1);
  });

  it("un documento que desborda ocupa 2 páginas, no 8", async () => {
    expect(paginas(await pdfDe(`<h1>Certificado</h1>${parrafos(70)}`, SELLO))).toBe(2);
  });

  it("el pie de borrador y el de documento anulado tampoco añaden páginas", async () => {
    const cuerpo = `<h1>Certificado</h1>${parrafos(5)}`;
    expect(paginas(await pdfDe(cuerpo, { ...SELLO, borrador: true }))).toBe(1);
    expect(paginas(await pdfDe(cuerpo, { ...SELLO, estadoDocumento: "anulado", motivoEstado: "Reemplazado" }))).toBe(1);
  });
});
