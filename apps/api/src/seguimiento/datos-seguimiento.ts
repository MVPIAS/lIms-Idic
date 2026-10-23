/**
 * Lecturas comunes del seguimiento del documento (frente r4c): despacho, datos
 * extra de la entrega, oficios que lo conducen y si exige oficio para salir.
 * Defensivas: en una base sin align_r4c_*.sql devuelven lo neutro.
 */
import { exigeOficio } from "../avisos/reglas-avisos";

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

/** Código del departamento (ancestro de tipo DEPARTAMENTO) de una unidad, o null. */
export async function departamentoDe(db: Sql, unidadId: string | null): Promise<string | null> {
  if (!unidadId) return null;
  const f = await db
    .$queryRawUnsafe<{ codigo: string }[]>(
      `WITH RECURSIVE c AS (
         SELECT id, padre_id, codigo, tipo, 0 AS n FROM unidad WHERE id = $1::uuid
         UNION ALL SELECT u.id, u.padre_id, u.codigo, u.tipo, c.n + 1 FROM unidad u JOIN c ON u.id = c.padre_id WHERE c.n < 20)
       SELECT codigo FROM c WHERE tipo = 'DEPARTAMENTO' ORDER BY n LIMIT 1`,
      unidadId,
    )
    .catch(() => [] as { codigo: string }[]);
  return f[0]?.codigo ?? null;
}

/** Configuración del oficio exigido (parámetros oficio_conductor). */
export async function configOficio(db: Sql, tenantId: string): Promise<{ tipos: string[]; departamentos: string[] }> {
  const f = await db
    .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'oficio_conductor'`,
      tenantId,
    )
    .catch(() => [] as { codigo: string; valor: string | null; activo: boolean }[]);
  const lista = (c: string, d: string) => {
    const fila = f.find((x) => x.codigo === c);
    const v = fila ? (fila.activo === false ? "" : fila.valor ?? "") : d;
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  };
  return { tipos: lista("exige_tipos", "IVC,INFORME_TECNICO,INFORME_RECHAZO"), departamentos: lista("exige_departamentos", "DSA") };
}

/** Oficios vivos que conducen el documento. */
type OficioDoc = { id: string; numero: string | null; estado: string; destinatario: string; despachoNumero: string | null };
export async function oficiosDeDocumento(db: Sql, certificadoId: string): Promise<OficioDoc[]> {
  return db
    .$queryRawUnsafe<OficioDoc[]>(
      `SELECT id, numero, estado, destinatario, despacho_numero AS "despachoNumero" FROM oficio
        WHERE $1::uuid = ANY(documentos) AND estado <> 'anulado' ORDER BY created_at`,
      certificadoId,
    )
    .catch(() => [] as OficioDoc[]);
}

/**
 * ¿El documento necesita oficio y no tiene uno firmado? Devuelve el motivo (o
 * null si puede salir). EP-05 7.2.
 */
export async function faltaOficio(
  db: Sql,
  d: { id: string; tenantId: string; tipoDocumento: string | null; unidadId: string | null; numero: string },
): Promise<string | null> {
  const cfg = await configOficio(db, d.tenantId);
  const depto = await departamentoDe(db, d.unidadId);
  if (!exigeOficio(d.tipoDocumento, depto, cfg)) return null;
  const oficios = await oficiosDeDocumento(db, d.id);
  if (oficios.some((o) => o.estado === "firmado" || o.estado === "despachado")) return null;
  return `El documento ${d.numero} sale con oficio conductor (${depto}): genere el oficio y espere sus firmas antes de entregarlo.`;
}

/** Despacho, extras de la entrega y oficios del documento, para su ficha. */
export async function seguimientoDocumento(db: Sql, certificadoId: string) {
  const [despacho] = await db
    .$queryRawUnsafe<any[]>(
      `SELECT d.id, d.destino, u.codigo AS "unidadDestino", d.fecha::text AS fecha, d.ejemplares, d.distribucion,
              d.copia_archivada AS "copiaArchivada", d.archivo_ubicacion AS "archivoUbicacion", d.retencion_meses AS "retencionMeses",
              d.observacion, d.created_at AS "registradoAt", ur.nombre_completo AS "registradoPor",
              d.recibido_at AS "recibidoAt", uv.nombre_completo AS "recibidoPor", o.numero AS "oficioNumero"
         FROM documento_despacho d
         LEFT JOIN unidad u ON u.id = d.unidad_destino_id
         LEFT JOIN usuario ur ON ur.id = d.registrado_por
         LEFT JOIN usuario uv ON uv.id = d.recibido_por
         LEFT JOIN oficio o ON o.id = d.oficio_id
        WHERE d.certificado_id = $1::uuid`,
      certificadoId,
    )
    .catch(() => []);
  const [entrega] = await db
    .$queryRawUnsafe<any[]>(
      `SELECT c.entrega_guia AS guia, c.entrega_ejemplares AS ejemplares, c.entrega_copias AS copias,
              c.entrega_devolucion_muestras AS "devolucionMuestras", o.numero AS "oficioNumero"
         FROM certificado c LEFT JOIN oficio o ON o.id = c.entrega_oficio_id WHERE c.id = $1::uuid`,
      certificadoId,
    )
    .catch(() => []);
  return { despacho: despacho ?? null, entrega: entrega ?? null, oficios: await oficiosDeDocumento(db, certificadoId) };
}
