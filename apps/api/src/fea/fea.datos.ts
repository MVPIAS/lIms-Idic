/**
 * Lecturas de la FEA que usan otros módulos (descarga, envío, entrega y
 * verificación pública) sin inyectar el servicio: reciben el cliente de BD.
 * Tablas: packages/db/align_nuevo_f4.sql. Reglas: fea.reglas.ts.
 */
import { CATEGORIA_FEA, TIPOS_FEA, exigeFea, leyendaFea, mensajeFaltaFea, nombreArchivoFea, type OrigenFea } from "./fea.reglas";

type Db = { $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T> };

export interface FirmadoVigente {
  id: string;
  nombre: string;
  datos: Buffer;
  hash: string;
  firmanteNombre: string | null;
  firmaFecha: Date | null;
  createdAt: Date;
}

/** Versión firmada con FEA vigente del documento (la oficial para el cliente), o null. */
export async function firmadoVigente(db: Db, origen: OrigenFea, documentoId: string, conDatos = true): Promise<FirmadoVigente | null> {
  try {
    const f = await db.$queryRawUnsafe<any[]>(
      `SELECT id, nombre, ${conDatos ? "datos" : "NULL::bytea AS datos"}, hash_sha256, firmante_nombre, firma_fecha, created_at
         FROM documento_fea_archivo
        WHERE origen = $1 AND documento_id = $2::uuid AND clase = 'firmado' AND vigente
        LIMIT 1`,
      origen,
      documentoId,
    );
    if (!f.length) return null;
    const r = f[0];
    return {
      id: r.id,
      nombre: r.nombre,
      datos: r.datos ? Buffer.from(r.datos) : Buffer.alloc(0),
      hash: r.hash_sha256,
      firmanteNombre: r.firmante_nombre,
      firmaFecha: r.firma_fecha,
      createdAt: r.created_at,
    };
  } catch {
    // Base sin align_nuevo_f4.sql: se comporta como hasta ahora (sin FEA).
    return null;
  }
}

/** PDF para el cliente: la versión FEA si existe ({ buffer, nombre }), o null para usar el del sistema. */
export async function pdfFeaParaCliente(db: Db, origen: OrigenFea, documentoId: string, numero: string) {
  const f = await firmadoVigente(db, origen, documentoId);
  return f ? { buffer: f.datos, nombre: nombreArchivoFea(numero, true), fea: f } : null;
}

/** Filas del parámetro «fea» del tenant. */
export async function filasParametroFea(db: Db, tenantId: string) {
  try {
    return await db.$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = $2`,
      tenantId,
      CATEGORIA_FEA,
    );
  } catch {
    return [];
  }
}

export const nombreTipoFea = (tipo: string | null | undefined) => TIPOS_FEA.find((t) => t.tipo === tipo)?.nombre ?? tipo ?? "documento";

/**
 * Mensaje que impide entregar o enviar el documento si el parámetro exige la
 * FEA para su tipo y aún no hay versión firmada; null si se puede.
 */
export async function errorEntregaSinFea(
  db: Db,
  d: { tenantId: string; origen: OrigenFea; documentoId: string; tipoDocumento: string | null | undefined; numero: string },
): Promise<string | null> {
  if (!exigeFea(await filasParametroFea(db, d.tenantId), d.tipoDocumento)) return null;
  if (await firmadoVigente(db, d.origen, d.documentoId, false)) return null;
  return mensajeFaltaFea(d.numero, nombreTipoFea(d.tipoDocumento));
}

/** Lo que la verificación pública informa de la FEA (sin datos internos). */
export async function feaPublica(db: Db, origen: OrigenFea, documentoId: string) {
  const f = await firmadoVigente(db, origen, documentoId, false);
  if (!f) return { firmadoFea: false as const };
  return {
    firmadoFea: true as const,
    firmanteFea: f.firmanteNombre,
    fechaFea: f.firmaFecha ?? f.createdAt,
    leyendaFea: leyendaFea(f.firmanteNombre, f.firmaFecha ?? f.createdAt),
    hashFea: f.hash,
  };
}
