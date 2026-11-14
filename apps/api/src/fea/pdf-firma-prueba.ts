/**
 * Firma de PRUEBA de un PDF como actualización incremental (lo que hace
 * FirmaGob o un token al firmar con PAdES), para las pruebas de fea.reglas.ts
 * y para el recorrido scripts/verificacion/fea.js. No se usa en producción:
 * el LIMS nunca firma con FEA, solo recibe el PDF ya firmado.
 *
 * Agrega al final del PDF, sin tocar un solo byte del original:
 *   · el diccionario de firma /Type /Sig con /ByteRange y /Contents reservado;
 *   · el campo de firma (invisible) y una nueva revisión del catálogo con
 *     /AcroForm (/SigFlags 3);
 *   · su tabla xref y su trailer con /Prev.
 * El CMS lo produce quien llama (`firmarCms`), sobre los dos tramos del
 * /ByteRange: openssl en el recorrido real, un CMS mínimo en las pruebas.
 */
import { createHash } from "crypto";

export interface OpcionesFirmaPrueba {
  nombre?: string | null;
  /** Fecha PDF «D:AAAAMMDDHHmmSS-03'00'». */
  fecha?: string | null;
  motivo?: string | null;
  /** Bytes reservados para el CMS. */
  reservar?: number;
  /** Recibe los bytes firmados (los dos tramos) y devuelve el CMS en DER. */
  firmarCms: (datosFirmados: Buffer) => Buffer;
}

/** Cadena PDF: literal si es ASCII imprimible; si no, hexadecimal UTF-16BE con BOM. */
function cadenaPdf(t: string): string {
  if (/^[\x20-\x7e]*$/.test(t)) return `(${t.replace(/([\\()])/g, "\\$1")})`;
  const le = Buffer.from(t, "utf16le");
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  return `<FEFF${be.toString("hex").toUpperCase()}>`;
}

/** Diccionario «<< … >>» que empieza en `i` (posición del primer «<<»): devuelve el índice tras el «>>» final. */
function finDiccionario(s: string, i: number): number {
  let prof = 0;
  for (let k = i; k < s.length - 1; k++) {
    if (s[k] === "(") {
      // salta cadenas literales
      let p = 0;
      for (; k < s.length; k++) {
        if (s[k] === "\\") { k++; continue; }
        if (s[k] === "(") p++;
        else if (s[k] === ")" && --p === 0) break;
      }
      continue;
    }
    if (s[k] === "<" && s[k + 1] === "<") { prof++; k++; continue; }
    if (s[k] === ">" && s[k + 1] === ">") { prof--; k++; if (prof === 0) return k + 1; }
  }
  return -1;
}

/** Firma el PDF con una actualización incremental (ver cabecera). */
export function firmarPdfPrueba(original: Buffer, o: OpcionesFirmaPrueba): Buffer {
  const s = original.toString("latin1");
  const sx = s.lastIndexOf("startxref");
  if (sx < 0) throw new Error("PDF sin startxref");
  const prev = Number(/startxref\s+(\d+)/.exec(s.slice(sx))?.[1]);
  const tr = s.lastIndexOf("trailer");
  if (tr < 0) throw new Error("PDF sin trailer clásico (xref en stream no soportado en la prueba)");
  const trailer = s.slice(tr, finDiccionario(s, s.indexOf("<<", tr)));
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1]);
  const root = Number(/\/Root\s+(\d+)\s+0\s+R/.exec(trailer)?.[1]);
  const id = /\/ID\s*\[[^\]]*\]/.exec(trailer)?.[0] ?? "";
  if (!size || !root) throw new Error("Trailer sin /Size o /Root");

  // Catálogo vigente (la última definición del objeto raíz).
  const reCat = new RegExp(`(^|[\\r\\n\\s])${root}\\s+0\\s+obj\\s*`, "g");
  let ini = -1;
  let mm: RegExpExecArray | null;
  while ((mm = reCat.exec(s))) ini = mm.index + mm[0].length;
  if (ini < 0) throw new Error("No se encontró el catálogo");
  const finCat = finDiccionario(s, ini);
  const catalogo = s.slice(ini + 2, finCat - 2).replace(/\/AcroForm\s*(<<[\s\S]*?>>|\d+\s+0\s+R)/, "");

  const sig = size;
  const campo = size + 1;
  const reservar = o.reservar ?? 8192;
  const PH = "0000000000";
  const partes: { num: number; txt: string }[] = [];
  const extras = [
    o.nombre ? ` /Name ${cadenaPdf(o.nombre)}` : "",
    o.fecha ? ` /M ${cadenaPdf(o.fecha)}` : "",
    o.motivo ? ` /Reason ${cadenaPdf(o.motivo)}` : "",
  ].join("");
  partes.push({
    num: sig,
    txt:
      `${sig} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached` +
      ` /ByteRange [0 ${PH} ${PH} ${PH}] /Contents <${"0".repeat(reservar * 2)}>${extras} >>\nendobj\n`,
  });
  partes.push({
    num: campo,
    txt: `${campo} 0 obj\n<< /FT /Sig /T (FirmaFEA) /V ${sig} 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /F 132 >>\nendobj\n`,
  });
  partes.push({ num: root, txt: `${root} 0 obj\n<<${catalogo} /AcroForm << /Fields [${campo} 0 R] /SigFlags 3 >> >>\nendobj\n` });

  let cuerpo = original[original.length - 1] === 0x0a ? "" : "\n";
  const offsets = new Map<number, number>();
  for (const p of partes) {
    offsets.set(p.num, original.length + Buffer.byteLength(cuerpo, "latin1"));
    cuerpo += p.txt;
  }
  const xref = original.length + Buffer.byteLength(cuerpo, "latin1");
  const ent = (n: number) => `${String(offsets.get(n)).padStart(10, "0")} 00000 n \n`;
  cuerpo +=
    `xref\n${root} 1\n${ent(root)}${sig} 2\n${ent(sig)}${ent(campo)}` +
    `trailer\n<< /Size ${size + 2} /Root ${root} 0 R /Prev ${prev}${id ? ` ${id}` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;

  const buf = Buffer.concat([original, Buffer.from(cuerpo, "latin1")]);
  const t = buf.toString("latin1");
  const pc = t.indexOf("/Contents <", original.length) + "/Contents ".length;
  const finC = t.indexOf(">", pc) + 1;
  const br = [0, pc, finC, buf.length - finC];
  const pb = t.indexOf(`/ByteRange [0 ${PH} ${PH} ${PH}]`, original.length);
  const brTxt = `/ByteRange [0 ${br.slice(1).map((x) => String(x).padEnd(10, " ")).join(" ")}]`;
  buf.write(brTxt, pb, "latin1");
  const datos = Buffer.concat([buf.subarray(0, pc), buf.subarray(finC)]);
  const cms = o.firmarCms(datos);
  if (cms.length > reservar) throw new Error("El CMS no cabe en el espacio reservado");
  buf.write(cms.toString("hex").toUpperCase(), pc + 1, "latin1");
  return buf;
}

/** Largo DER. */
function der(tag: number, contenido: Buffer): Buffer {
  const l = contenido.length;
  const cab = l < 0x80 ? Buffer.from([l]) : l < 0x100 ? Buffer.from([0x81, l]) : Buffer.from([0x82, l >> 8, l & 0xff]);
  return Buffer.concat([Buffer.from([tag]), cab, contenido]);
}

/**
 * CMS MÍNIMO de prueba: solo el atributo messageDigest (lo que el LIMS
 * compara). No es una firma criptográfica: sirve para probar la detección y
 * la integridad sin openssl.
 */
export function cmsMinimoPrueba(datos: Buffer, alg: "sha1" | "sha256" | "sha512" = "sha256"): Buffer {
  const oid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
  const md = createHash(alg).update(datos).digest();
  const atributo = der(0x30, Buffer.concat([oid, der(0x31, der(0x04, md))]));
  return der(0x30, der(0xa0, atributo));
}
