/**
 * Adjuntos de un registro (tabla registro_adjunto): PDF, PNG o JPEG de hasta
 * 5 MB. El tipo se decide por los BYTES del fichero (nunca por la extensión ni
 * por el Content-Type que manda el navegador) y se sirve siempre con ese tipo y
 * `nosniff`. Este módulo no comprueba permisos: cada controlador que lo usa
 * exige los suyos y el ámbito de la unidad antes de llamar aquí.
 *
 * Modo AMPLIADO (cotización, quinto envío del IDIC 21-11-2026): además correos
 * (.msg, .eml) y documentos Office (.docx, .xlsx, .doc, .xls), con un tope
 * mayor configurable. La firma de los bytes debe cuadrar con la extensión
 * (ZIP para .docx/.xlsx con su carpeta interna; OLE2 para .doc/.xls/.msg;
 * texto con cabeceras RFC 822 para .eml). Siempre se descargan como adjunto.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const MAX_BYTES_ADJUNTO = 5 * 1024 * 1024;
/** Techo absoluto del modo ampliado (el tope real es un parámetro, menor o igual). Coincide con el CHECK de la tabla. */
export const MAX_BYTES_ADJUNTO_AMPLIADO = 25 * 1024 * 1024;
export type MimeAdjunto = "application/pdf" | "image/png" | "image/jpeg";
export type MimeAmpliado =
  | MimeAdjunto
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/msword"
  | "application/vnd.ms-excel"
  | "application/vnd.ms-outlook"
  | "message/rfc822";
export type ArchivoAdjunto = { buffer: Buffer; originalname?: string; size?: number };

/** Extensión de cada tipo (la que se fuerza en el nombre guardado). */
const EXT_MIME: Record<MimeAmpliado, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-outlook": ".msg",
  "message/rfc822": ".eml",
};
/** Extensiones que acepta el modo ampliado (para el texto de ayuda y el `accept` del navegador). */
export const EXTENSIONES_AMPLIADAS = [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".doc", ".xls", ".msg", ".eml"];

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Tipo real en modo ampliado: PDF/PNG/JPEG por su firma; los demás por su firma
 * Y su extensión (un .docx que no es ZIP con «word/», o un .exe renombrado, no pasa).
 */
export function mimeAmpliadoPorFirma(b: Buffer, nombre: string | undefined): MimeAmpliado | null {
  const basico = mimePorFirma(b);
  if (basico) return basico;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(String(nombre ?? "").trim())?.[1]?.toLowerCase() ?? "";
  if (b.length >= 4 && b.subarray(0, 4).equals(ZIP)) {
    const contenido = b.toString("latin1");
    if (!contenido.includes("[Content_Types].xml")) return null;
    if (ext === "docx" && contenido.includes("word/")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === "xlsx" && contenido.includes("xl/")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return null;
  }
  if (b.length >= 8 && b.subarray(0, 8).equals(OLE2)) {
    if (ext === "doc") return "application/msword";
    if (ext === "xls") return "application/vnd.ms-excel";
    if (ext === "msg") return "application/vnd.ms-outlook";
    return null;
  }
  if (ext === "eml") {
    const cabeza = b.subarray(0, Math.min(b.length, 8192));
    if (cabeza.includes(0)) return null; // binario: no es un correo de texto
    const texto = cabeza.toString("latin1");
    if (/^(From|To|Subject|Date|Received|Return-Path|Message-ID|MIME-Version|Delivered-To|X-[A-Za-z-]+):/im.test(texto)) return "message/rfc822";
    return null;
  }
  return null;
}

type Db = { $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T> };

/** Tipo real del fichero por su firma; null si no es PDF, PNG ni JPEG. */
export function mimePorFirma(b: Buffer): MimeAdjunto | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** Nombre seguro para mostrar y para Content-Disposition (sin rutas, comillas ni controles). */
export function nombreSeguro(nombre: string | undefined, mime: MimeAmpliado): string {
  const ext = EXT_MIME[mime] ?? ".bin";
  const base = String(nombre ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\p{L}\p{N} ._()-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  if (!base) return `adjunto${ext}`;
  const okExt = ext === ".jpg" ? /\.jpe?g$/i : new RegExp(`\\${ext}$`, "i");
  return okExt.test(base) ? base : `${base}${ext}`;
}

/** Modo ampliado: otros tipos (correos y Office) y tope propio en bytes (≤ MAX_BYTES_ADJUNTO_AMPLIADO). */
export interface OpcionesAdjunto {
  ampliado?: boolean;
  maxBytes?: number;
}

const mb = (n: number) => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`.replace(".", ",");

export function validarAdjunto(archivo: ArchivoAdjunto | undefined, op: OpcionesAdjunto = {}): { mime: MimeAmpliado; nombre: string } {
  const tipos = op.ampliado ? "PDF, imagen PNG/JPEG, correo (.msg, .eml) u Office (.docx, .xlsx, .doc, .xls)" : "PDF, PNG o JPEG";
  if (!archivo?.buffer?.length) throw new BadRequestException(`Adjunte un fichero (${tipos}).`);
  const max = op.ampliado ? Math.min(op.maxBytes ?? MAX_BYTES_ADJUNTO_AMPLIADO, MAX_BYTES_ADJUNTO_AMPLIADO) : MAX_BYTES_ADJUNTO;
  if (archivo.buffer.length > max) throw new BadRequestException(`El fichero supera los ${mb(max)}.`);
  const mime = op.ampliado ? mimeAmpliadoPorFirma(archivo.buffer, archivo.originalname) : mimePorFirma(archivo.buffer);
  if (!mime) throw new BadRequestException(`Solo se aceptan ${tipos} (se comprueba el contenido del fichero).`);
  return { mime, nombre: nombreSeguro(archivo.originalname, mime) };
}

export async function guardarAdjunto(
  db: Db,
  p: { tenantId: string; entidad: string; entidadId: string; clase: string; archivo: ArchivoAdjunto | undefined; usuarioId: string | null; opciones?: OpcionesAdjunto },
) {
  const { mime, nombre } = validarAdjunto(p.archivo, p.opciones);
  const datos = p.archivo!.buffer;
  const filas = await db.$queryRawUnsafe<any[]>(
    `INSERT INTO registro_adjunto (tenant_id, entidad, entidad_id, clase, nombre, mime, bytes, datos, hash_sha256, subido_por)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10::uuid)
     RETURNING id, clase, nombre, mime, bytes, hash_sha256 AS "hash", created_at AS "createdAt"`,
    p.tenantId,
    p.entidad,
    p.entidadId,
    p.clase,
    nombre,
    mime,
    datos.length,
    datos,
    createHash("sha256").update(datos).digest("hex"),
    p.usuarioId,
  );
  return filas[0];
}

export async function listarAdjuntos(db: Db, tenantId: string, entidad: string, ids: string[]) {
  if (!ids.length) return [];
  return db.$queryRawUnsafe<any[]>(
    `SELECT a.id, a.entidad_id AS "entidadId", a.clase, a.nombre, a.mime, a.bytes, a.hash_sha256 AS "hash",
            a.created_at AS "createdAt", u.nombre_completo AS "subidoPor"
       FROM registro_adjunto a LEFT JOIN usuario u ON u.id = a.subido_por
      WHERE a.tenant_id = $1::uuid AND a.entidad = $2 AND a.entidad_id = ANY($3::uuid[]) AND a.deleted_at IS NULL
      ORDER BY a.created_at`,
    tenantId,
    entidad,
    ids,
  );
}

/** Lee un adjunto SOLO si pertenece a la entidad indicada (el llamador ya comprobó el acceso a ella). */
export async function leerAdjunto(db: Db, tenantId: string, entidades: string[], id: string) {
  const f = await db.$queryRawUnsafe<any[]>(
    `SELECT id, entidad, entidad_id AS "entidadId", nombre, mime, datos
       FROM registro_adjunto
      WHERE id = $1::uuid AND tenant_id = $2::uuid AND entidad = ANY($3::text[]) AND deleted_at IS NULL`,
    id,
    tenantId,
    entidades,
  );
  if (!f[0]) throw new NotFoundException("Adjunto no encontrado.");
  return f[0] as { id: string; entidad: string; entidadId: string; nombre: string; mime: MimeAmpliado; datos: Buffer };
}

/** Cabeceras para servir un adjunto: tipo fijo por firma, descarga y sin caché compartida. */
export function cabecerasAdjunto(a: { nombre: string; mime: string; datos: Buffer }) {
  return {
    "Content-Type": a.mime,
    "Content-Length": String(a.datos.length),
    "Content-Disposition": `attachment; filename="${a.nombre.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
