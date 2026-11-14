/**
 * Firma Electrónica Avanzada (FEA) del Estado sobre el PDF final · reglas PURAS
 * (sin BD), probadas en fea.reglas.spec.ts. Ver docs/FLUJO_FEA_DOCUMENTOS.md.
 *
 * El LIMS no sale a internet, así que no se integra con FirmaGob: el firmante
 * descarga el PDF emitido, lo firma en su equipo (FirmaGob o token) y lo sube.
 * Aquí se decide, sin dependencias nuevas, si lo subido sirve:
 *
 *   1. Es un PDF («%PDF-» al inicio).
 *   2. Trae al menos una firma digital: un diccionario con /ByteRange [a b c d]
 *      y /Contents <hex>, de tipo /Sig (o con /SubFilter de firma). Del
 *      diccionario se leen, si vienen, el nombre (/Name) y la fecha (/M).
 *   3. Es el MISMO documento: una firma PAdES se agrega como actualización
 *      incremental, de modo que el PDF firmado empieza con los bytes exactos
 *      del PDF emitido (prefijo) y la firma cubre todo ese tramo.
 *   4. Integridad de la firma (si se puede comprobar sin la cadena de
 *      certificados): el atributo messageDigest del CMS coincide con el
 *      resumen de los tramos firmados. Si no cuadra, el PDF se alteró después
 *      de firmar. La validez del certificado del firmante (cadena, revocación)
 *      no se puede comprobar sin internet: la comprueba el lector de PDF.
 */
import { createHash } from "crypto";
import { fechaHoraChile } from "../common/fecha-chile";

/* ------------------------------------------------------------------ tipos --- */

export type OrigenFea = "informe" | "metrologia";
export const ORIGENES_FEA: readonly OrigenFea[] = ["informe", "metrologia"];

/** Tamaño máximo del PDF firmado que se acepta. */
export const MAX_BYTES_FEA = 15 * 1024 * 1024;

export interface FirmaPdf {
  /** [inicio1, largo1, inicio2, largo2] de /ByteRange. */
  byteRange: [number, number, number, number];
  /** Nombre del firmante (/Name), si viene. */
  nombre: string | null;
  /** Fecha de la firma (/M) en ISO, si viene y se entiende. */
  fecha: string | null;
  /** Texto original de /M (para mostrarlo si no se entiende). */
  fechaTexto: string | null;
  motivo: string | null;
  lugar: string | null;
  subFilter: string | null;
  /** El hueco entre los dos tramos es exactamente el /Contents <hex>. */
  estructuraValida: boolean;
  /** El segundo tramo llega hasta el final del fichero. */
  cubreHastaElFinal: boolean;
  /** Bytes del CMS (Contents sin el relleno de ceros). */
  cms: Buffer;
  /** true: el messageDigest del CMS cuadra con los tramos; false: no cuadra; null: no se pudo comprobar. */
  integra: boolean | null;
}

/* ----------------------------------------------------------- utilidades --- */

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export function esPdf(b: Buffer | null | undefined): boolean {
  return !!b && b.length >= 8 && b.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Fin de una cadena literal PDF «( … )» que empieza en `i` (posición del «(»). Devuelve el índice del «)» final. */
function finLiteral(s: string, i: number): number {
  let prof = 0;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\") {
      k++;
      continue;
    }
    if (ch === "(") prof++;
    else if (ch === ")") {
      prof--;
      if (prof === 0) return k;
    }
  }
  return -1;
}

/** Bytes de una cadena literal PDF (sin los paréntesis), con sus escapes resueltos. */
export function bytesLiteral(cuerpo: string): Buffer {
  const out: number[] = [];
  for (let k = 0; k < cuerpo.length; k++) {
    const ch = cuerpo[k];
    if (ch !== "\\") {
      out.push(cuerpo.charCodeAt(k) & 0xff);
      continue;
    }
    const n = cuerpo[++k];
    if (n === undefined) break;
    const simples: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (n in simples) out.push(simples[n]);
    else if (n === "\r") {
      if (cuerpo[k + 1] === "\n") k++; // continuación de línea
    } else if (n === "\n") {
      /* continuación de línea */
    } else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(cuerpo[k + 1] ?? "")) oct += cuerpo[++k];
      out.push(parseInt(oct, 8) & 0xff);
    } else out.push(n.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}

/** Texto de una cadena PDF: UTF-16BE con BOM (FE FF), UTF-8 con BOM, o PDFDocEncoding (≈ latin1). */
export function textoPdf(b: Buffer): string {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const sw = Buffer.from(b.subarray(2));
    const par = sw.length - (sw.length % 2);
    const le = Buffer.alloc(par);
    for (let i = 0; i < par; i += 2) {
      le[i] = sw[i + 1];
      le[i + 1] = sw[i];
    }
    return le.toString("utf16le");
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString("utf8");
  return b.toString("latin1");
}

/** Valor de texto de la clave `/Clave` dentro de un diccionario (literal «( )» o hexadecimal «< >»). */
export function valorTexto(dic: string, clave: string): string | null {
  const re = new RegExp(`/${clave}\\s*([(<])`, "g");
  const m = re.exec(dic);
  if (!m) return null;
  const ini = m.index + m[0].length - 1;
  if (m[1] === "(") {
    const fin = finLiteral(dic, ini);
    if (fin < 0) return null;
    return limpiar(textoPdf(bytesLiteral(dic.slice(ini + 1, fin))));
  }
  const fin = dic.indexOf(">", ini);
  if (fin < 0) return null;
  let hex = dic.slice(ini + 1, fin).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  if (hex.length % 2) hex += "0";
  return limpiar(textoPdf(Buffer.from(hex, "hex")));
}

const limpiar = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || null;

/** Valor de nombre `/Clave /Valor` (p. ej. /SubFilter /ETSI.CAdES.detached). */
function valorNombre(dic: string, clave: string): string | null {
  const m = new RegExp(`/${clave}\\s*/([^\\s/<>\\[\\]()]+)`).exec(dic);
  return m ? m[1] : null;
}

/**
 * Fecha PDF «D:AAAAMMDDHHmmSSOHH'mm'» a ISO (UTC). Acepta las formas cortas
 * (solo año, año-mes…) y la zona Z o ±HH'mm'. null si no se entiende.
 */
export function fechaPdf(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(Z|[+-]\d{2}'?\d{0,2}'?)?/.exec(texto.trim());
  if (!m) return null;
  const [, a, me = "01", d = "01", h = "00", mi = "00", s = "00", z] = m;
  let off = 0;
  if (z && z !== "Z") {
    const zz = /([+-])(\d{2})'?(\d{0,2})'?/.exec(z);
    if (zz) off = (zz[1] === "-" ? -1 : 1) * (Number(zz[2]) * 60 + Number(zz[3] || 0));
  }
  const ms = Date.UTC(+a, +me - 1, +d, +h, +mi, +s) - off * 60_000;
  const f = new Date(ms);
  if (Number.isNaN(f.getTime()) || +me < 1 || +me > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) return null;
  return f.toISOString();
}

/* ------------------------------------------------- integridad del CMS --- */

/** OID 1.2.840.113549.1.9.4 (messageDigest) codificado en DER, con su cabecera 06 09. */
const OID_MESSAGE_DIGEST = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);

/** Largo DER en `b[i]`: { largo, cabecera } o null. */
function largoDer(b: Buffer, i: number): { largo: number; cab: number } | null {
  if (i >= b.length) return null;
  const x = b[i];
  if (x < 0x80) return { largo: x, cab: 1 };
  const n = x & 0x7f;
  if (n < 1 || n > 4 || i + n >= b.length) return null;
  let l = 0;
  for (let k = 1; k <= n; k++) l = l * 256 + b[i + k];
  return { largo: l, cab: 1 + n };
}

/** Resumen messageDigest de los atributos firmados del CMS, o null si no lo trae. */
export function messageDigestCms(cms: Buffer): Buffer | null {
  const i = cms.indexOf(OID_MESSAGE_DIGEST);
  if (i < 0) return null;
  let p = i + OID_MESSAGE_DIGEST.length;
  if (cms[p] !== 0x31) return null; // SET
  const set = largoDer(cms, p + 1);
  if (!set) return null;
  p += 1 + set.cab;
  if (cms[p] !== 0x04) return null; // OCTET STRING
  const oct = largoDer(cms, p + 1);
  if (!oct) return null;
  const ini = p + 1 + oct.cab;
  if (ini + oct.largo > cms.length) return null;
  return Buffer.from(cms.subarray(ini, ini + oct.largo));
}

const ALG_POR_LARGO: Record<number, string> = { 20: "sha1", 32: "sha256", 48: "sha384", 64: "sha512" };

/** Comprueba el messageDigest del CMS contra los tramos firmados. null si no se puede comprobar. */
export function integridadFirma(pdf: Buffer, br: [number, number, number, number], cms: Buffer): boolean | null {
  const md = messageDigestCms(cms);
  if (!md) return null;
  const alg = ALG_POR_LARGO[md.length];
  if (!alg) return null;
  const [a, b, c, d] = br;
  if (c + d > pdf.length) return false;
  const h = createHash(alg).update(pdf.subarray(a, a + b)).update(pdf.subarray(c, c + d)).digest();
  return h.equals(md);
}

/* ---------------------------------------------------- detección de firmas --- */

/**
 * Firmas digitales del PDF: cada diccionario con /ByteRange y /Contents que
 * sea de firma (/Type /Sig, o /Filter o /SubFilter de firma). Se buscan en el
 * texto del fichero: el diccionario de firma va siempre sin comprimir (su
 * /Contents se rellena después de calcular el /ByteRange).
 */
export function detectarFirmas(pdf: Buffer): FirmaPdf[] {
  if (!esPdf(pdf)) return [];
  const s = pdf.toString("latin1");
  const firmas: FirmaPdf[] = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const br = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
    // Diccionario que lo contiene: del «obj» anterior al «endobj» siguiente.
    const desde = Math.max(s.lastIndexOf(" obj", m.index), s.lastIndexOf("\nobj", m.index), 0);
    let hasta = s.indexOf("endobj", m.index);
    if (hasta < 0) hasta = Math.min(s.length, m.index + 200_000);
    const dic = s.slice(desde, hasta);
    const esFirma =
      /\/Type\s*\/Sig\b/.test(dic) ||
      /\/SubFilter\s*\/(adbe\.pkcs7\.(detached|sha1)|ETSI\.CAdES\.detached|ETSI\.RFC3161|adbe\.x509\.rsa_sha1)/.test(dic) ||
      /\/Filter\s*\/(Adobe\.PPK|Entrust|VeriSign|CICI)/.test(dic);
    const cont = /\/Contents\s*<([0-9a-fA-F\s]*)>/.exec(dic);
    if (!esFirma || !cont) continue;
    const [a, b, c, d] = br;
    // El hueco [b, c) debe ser exactamente «<hex>» del /Contents.
    const hueco = a === 0 && b > 0 && c > b && c + d <= pdf.length ? s.slice(b, c) : "";
    const estructuraValida = /^<[0-9a-fA-F\s]*>$/.test(hueco);
    const hex = (estructuraValida ? hueco.slice(1, -1) : cont[1]).replace(/\s+/g, "");
    let cms = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
    // El /Contents se reserva con ceros de relleno: se quitan los del final.
    let fin = cms.length;
    while (fin > 0 && cms[fin - 1] === 0) fin--;
    cms = Buffer.from(cms.subarray(0, fin));
    const fechaTexto = valorTexto(dic, "M");
    firmas.push({
      byteRange: br,
      nombre: valorTexto(dic, "Name"),
      fecha: fechaPdf(fechaTexto),
      fechaTexto,
      motivo: valorTexto(dic, "Reason"),
      lugar: valorTexto(dic, "Location"),
      subFilter: valorNombre(dic, "SubFilter"),
      estructuraValida,
      cubreHastaElFinal: c + d === pdf.length || /^\s*$/.test(s.slice(c + d)),
      cms,
      integra: estructuraValida && cms.length ? integridadFirma(pdf, br, cms) : null,
    });
  }
  return firmas;
}

/* --------------------------------------------- correspondencia y decisión --- */

/** El PDF firmado empieza con los bytes exactos del PDF emitido (y agrega algo después). */
export function correspondePrefijo(original: Buffer, firmado: Buffer): boolean {
  return firmado.length > original.length && firmado.subarray(0, original.length).equals(original);
}

/** La firma cubre todo el PDF emitido: su primer tramo empieza en 0 y el segundo llega más allá del original. */
export function firmaCubreOriginal(f: FirmaPdf, largoOriginal: number): boolean {
  const [a, , c, d] = f.byteRange;
  return a === 0 && c + d >= largoOriginal;
}

export interface AnalisisSubida {
  esPdf: boolean;
  firmas: FirmaPdf[];
  /** Firma que se toma como la FEA (la última que cubre el original, o la última). */
  firma: FirmaPdf | null;
  /** Original (de los candidatos) con que coincide el prefijo; -1 si ninguno. */
  originalIndice: number;
  corresponde: boolean;
  /** Errores que impiden aceptar el archivo (no se salvan con excepción). */
  errores: string[];
  /** Motivo por el que no corresponde (se salva solo con excepción de una jefatura). */
  noCorresponde: string | null;
}

/**
 * Analiza el PDF subido contra los PDF emitidos guardados (puede haber más de
 * uno si el documento cambió, p. ej. con un V°B° posterior). No escribe nada.
 */
export function analizarSubida(firmado: Buffer, originales: Buffer[]): AnalisisSubida {
  const r: AnalisisSubida = { esPdf: esPdf(firmado), firmas: [], firma: null, originalIndice: -1, corresponde: false, errores: [], noCorresponde: null };
  if (!firmado?.length) {
    r.errores.push("El archivo está vacío. Seleccione el PDF firmado con FirmaGob.");
    return r;
  }
  if (firmado.length > MAX_BYTES_FEA) {
    r.errores.push(`El archivo pesa ${(firmado.length / 1048576).toFixed(1)} MB; el máximo es ${MAX_BYTES_FEA / 1048576} MB.`);
    return r;
  }
  if (!r.esPdf) {
    r.errores.push("El archivo no es un PDF. Suba el PDF que descargó del LIMS, ya firmado con FirmaGob o su token.");
    return r;
  }
  r.firmas = detectarFirmas(firmado);
  if (!r.firmas.length) {
    r.errores.push(
      "El PDF no trae ninguna firma digital. Fírmelo con FirmaGob (o su token) y suba el archivo que genera la firma, no el original.",
    );
    return r;
  }
  const rotas = r.firmas.filter((f) => !f.estructuraValida);
  if (rotas.length === r.firmas.length)
    r.errores.push("La firma digital del PDF está mal formada (su /ByteRange no coincide con el contenido de la firma). Vuelva a firmar el documento.");
  if (r.firmas.some((f) => f.integra === false))
    r.errores.push("El PDF se modificó después de firmarlo: la firma no cuadra con el contenido. Vuelva a firmar el PDF descargado del LIMS sin editarlo.");
  if (r.errores.length) return r;

  r.originalIndice = originales.findIndex((o) => correspondePrefijo(o, firmado));
  const orig = r.originalIndice >= 0 ? originales[r.originalIndice] : null;
  const validas = r.firmas.filter((f) => f.estructuraValida);
  r.firma = (orig ? validas.filter((f) => firmaCubreOriginal(f, orig.length)) : validas).slice(-1)[0] ?? validas.slice(-1)[0] ?? null;
  if (!originales.length) r.noCorresponde = "No hay un PDF emitido guardado con que comparar. Descargue el PDF para firmar desde la ficha del documento.";
  else if (!orig)
    r.noCorresponde =
      "El PDF firmado no corresponde al documento emitido: no empieza con los mismos bytes del PDF que entrega el LIMS. Firme el PDF descargado con «Descargar PDF para firmar» sin modificarlo ni volver a guardarlo.";
  else if (!r.firma || !firmaCubreOriginal(r.firma, orig.length))
    r.noCorresponde = "La firma no cubre el documento emitido completo.";
  r.corresponde = !r.noCorresponde;
  return r;
}

/* --------------------------------------------- parámetro y textos --- */

/** Tipos de documento que van al cliente y pueden exigir la FEA (código del parámetro = tipo en minúsculas). */
export const TIPOS_FEA: { tipo: string; nombre: string }[] = [
  { tipo: "INFORME_ENSAYO", nombre: "Informe de ensayo" },
  { tipo: "IVC", nombre: "Informe de verificación de cumplimiento (IVC)" },
  { tipo: "INFORME_TECNICO", nombre: "Informe técnico" },
  { tipo: "INFORME_INSPECCION", nombre: "Informe de inspección (BPCH y Delegación Nº 11)" },
  { tipo: "CERTIFICADO_CONFORMIDAD", nombre: "Certificado de conformidad" },
  { tipo: "INFORME_INCUMPLIMIENTO", nombre: "Informe de incumplimiento" },
  { tipo: "CERTIFICADO_RESISTENCIA_BALISTICA", nombre: "Certificado de resistencia balística" },
  { tipo: "INFORME_RECHAZO", nombre: "Informe de rechazo" },
  { tipo: "CERTIFICADO_ARMA", nombre: "Certificado por arma (Delegación Nº 11)" },
  { tipo: "INFORME_INCUMPLIMIENTO_ARMA", nombre: "Informe de incumplimiento del arma (Delegación Nº 11)" },
  { tipo: "CERTIFICADO_CALIBRACION", nombre: "Certificado de calibración (Metrología)" },
];

export const CATEGORIA_FEA = "fea";
export const codigoParametroFea = (tipo: string) => tipo.toLowerCase();

/** ¿El parámetro exige FEA para este tipo? (filas de parametro_sistema de la categoría «fea»; por defecto, no). */
export function exigeFea(filas: { codigo: string; valor: string | null; activo?: boolean | null }[], tipoDocumento: string | null | undefined): boolean {
  if (!tipoDocumento) return false;
  const f = filas.find((x) => x.codigo === codigoParametroFea(tipoDocumento));
  if (!f || f.activo === false) return false;
  return ["si", "sí", "true", "1", "s"].includes(String(f.valor ?? "").trim().toLowerCase());
}

/** Fecha y hora de Chile para la leyenda (dd-mm-aaaa HH:MM, zona del IDIC). */
export function fechaChile(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : fechaHoraChile(d);
}

/** «Firmado con firma electrónica avanzada por <nombre> el <fecha>». */
export function leyendaFea(nombre: string | null | undefined, fecha: string | Date | null | undefined): string {
  const quien = (nombre ?? "").trim() || "el firmante";
  const cuando = fechaChile(fecha);
  return `Firmado con firma electrónica avanzada por ${quien}${cuando ? ` el ${cuando}` : ""}`;
}

/** Mensaje al intentar entregar o enviar sin la versión firmada cuando el parámetro la exige. */
export function mensajeFaltaFea(numero: string, nombreTipo: string): string {
  return (
    `No se puede entregar ni enviar ${numero}: para «${nombreTipo}» se exige la versión firmada con firma electrónica avanzada (FEA). ` +
    `El firmante debe descargar el PDF desde la ficha del documento, firmarlo con FirmaGob y subirlo con «Subir versión firmada con FEA». ` +
    `Este requisito se configura en Administración › Parámetros del sistema › Firma electrónica avanzada.`
  );
}

/** Excepción de una jefatura: motivo obligatorio y con sustancia. */
export function errorMotivoExcepcion(motivo: string | null | undefined): string | null {
  const t = (motivo ?? "").trim();
  if (t.length < 10) return "Para aceptar un PDF que no corresponde al emitido, escriba el motivo (al menos 10 caracteres). Queda en el historial del documento.";
  return null;
}

/** Nombre de archivo seguro para Content-Disposition. */
export function nombreArchivoFea(numero: string, firmado: boolean): string {
  const base = String(numero || "documento").replace(/[^A-Za-z0-9._-]/g, "_");
  return `${base}${firmado ? "_FEA" : ""}.pdf`;
}
