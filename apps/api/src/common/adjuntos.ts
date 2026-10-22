/**
 * Adjuntos de un registro (tabla registro_adjunto): PDF, PNG o JPEG de hasta
 * 5 MB. El tipo se decide por los BYTES del fichero (nunca por la extensión ni
 * por el Content-Type que manda el navegador) y se sirve siempre con ese tipo y
 * `nosniff`. Este módulo no comprueba permisos: cada controlador que lo usa
 * exige los suyos y el ámbito de la unidad antes de llamar aquí.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const MAX_BYTES_ADJUNTO = 5 * 1024 * 1024;
export type MimeAdjunto = "application/pdf" | "image/png" | "image/jpeg";
export type ArchivoAdjunto = { buffer: Buffer; originalname?: string; size?: number };

type Db = { $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T> };

/** Tipo real del fichero por su firma; null si no es PDF, PNG ni JPEG. */
export function mimePorFirma(b: Buffer): MimeAdjunto | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** Nombre seguro para mostrar y para Content-Disposition (sin rutas, comillas ni controles). */
export function nombreSeguro(nombre: string | undefined, mime: MimeAdjunto): string {
  const ext = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : ".jpg";
  const base = String(nombre ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\p{L}\p{N} ._()-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  if (!base) return `adjunto${ext}`;
  return /\.(pdf|png|jpe?g)$/i.test(base) ? base : `${base}${ext}`;
}

export function validarAdjunto(archivo: ArchivoAdjunto | undefined): { mime: MimeAdjunto; nombre: string } {
  if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte un fichero (PDF, PNG o JPEG).");
  if (archivo.buffer.length > MAX_BYTES_ADJUNTO) throw new BadRequestException("El fichero supera los 5 MB.");
  const mime = mimePorFirma(archivo.buffer);
  if (!mime) throw new BadRequestException("Solo se aceptan PDF, PNG o JPEG (se comprueba el contenido del fichero).");
  return { mime, nombre: nombreSeguro(archivo.originalname, mime) };
}

export async function guardarAdjunto(
  db: Db,
  p: { tenantId: string; entidad: string; entidadId: string; clase: string; archivo: ArchivoAdjunto | undefined; usuarioId: string | null },
) {
  const { mime, nombre } = validarAdjunto(p.archivo);
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
  return f[0] as { id: string; entidad: string; entidadId: string; nombre: string; mime: MimeAdjunto; datos: Buffer };
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
