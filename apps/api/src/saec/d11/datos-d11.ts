/**
 * Lecturas comunes de la D11 (sin inyección): la fila de cada arma de la OT,
 * su estado para las reglas y el avance del expediente. Las usan D11Service y
 * la «Ruta de la OT» (ot/avance-ot.controller.ts).
 */
import { avanceD11, configD11, type ConfigD11, type EstadoArma, type TipoArma } from "./reglas-d11";

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

/** Fila de arma de la OT tal como la necesitan las reglas y la pantalla. */
export interface FilaArma {
  id: string;
  orden: number;
  tipo: TipoArma;
  serie_normalizada: string | null;
  sin_serie: boolean;
  accesorios: string | null;
  lote: string | null;
  ubicacion: string | null;
  clase: EstadoArma["clase"];
  permisibilidad: EstadoArma["permisibilidad"];
  camino: EstadoArma["camino"];
  acunacion_numero: string | null;
  acunacion_anio: number | null;
  acunada_at: Date | null;
  entrega_id: string | null;
  resolucion_arma_id: string | null;
  arma_id: string;
  serie: string | null;
  marca: string | null;
  modelo: string | null;
  calibre: string | null;
  pais_origen: string | null;
  muestra_id: string;
  muestra: string;
  codigo_barras: string | null;
  veredicto: string | null;
  ensayos: number;
  pendientes: number;
  aprobados: number;
  certificado: { id: string; numero: string; estado: string; entregadoAt: string | null; vigenteHasta: string | null; vigenteDesde: string | null } | null;
}

export const SELECT_ARMAS = `
  SELECT a.id, a.orden, a.tipo, a.serie_normalizada, a.sin_serie, a.accesorios, a.lote, a.ubicacion,
         a.clase, a.permisibilidad, a.camino, a.acunacion_numero, a.acunacion_anio, a.acunada_at,
         a.entrega_id, a.resolucion_arma_id,
         ar.id AS arma_id, ar.serie, ar.marca, ar.modelo, ar.calibre, ar.pais_origen,
         m.id AS muestra_id, m.codigo AS muestra, m.codigo_barras, m.veredicto,
         (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL)::int AS ensayos,
         (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL
                                              AND r.estado IN ('pendiente', 'devuelto'))::int AS pendientes,
         (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL AND r.estado = 'aprobado')::int AS aprobados,
         (SELECT json_build_object('id', c.id, 'numero', COALESCE(c.numero, c.codigo), 'estado', c.estado,
                                   'entregadoAt', c.entregado_at, 'vigenteHasta', ca.vigente_hasta, 'vigenteDesde', ca.vigente_desde)
            FROM certificado c
            LEFT JOIN d11_certificado_arma ca ON ca.certificado_id = c.id
           WHERE c.ot_id = a.ot_id AND c.deleted_at IS NULL AND c.tipo_documento = 'CERTIFICADO_ARMA'
             AND c.estado IN ('en_firma', 'oficial', 'emitido') AND c.muestra_ids @> ARRAY[m.id]
           ORDER BY c.created_at DESC LIMIT 1) AS certificado
    FROM d11_arma_ot a
    JOIN arma ar   ON ar.id = a.arma_id
    JOIN muestra m ON m.id = a.muestra_id AND m.deleted_at IS NULL`;

export function estadoDe(a: FilaArma): EstadoArma {
  return {
    clase: a.clase,
    permisibilidad: a.permisibilidad,
    camino: a.camino,
    ensayos: Number(a.ensayos),
    pendientes: Number(a.pendientes),
    aprobados: Number(a.aprobados),
    veredicto: a.veredicto,
    acunada: Boolean(a.acunada_at),
    certificado: a.certificado ? { estado: a.certificado.estado } : null,
    entregada: Boolean(a.entrega_id),
  };
}


/** Parámetros d11 del tenant. */
export async function configD11De(db: Sql, tenantId: string): Promise<ConfigD11> {
  const filas = await db.$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
    `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'd11'`,
    tenantId,
  );
  return configD11(filas);
}

/**
 * Avance del expediente D11 de una OT (null si la OT no es de armas de la D11:
 * sin expediente, sin armas y sin listado de la resolución). Con `siempre`, la OT
 * de la D11 recién creada ya tiene su avance (todo pendiente desde la programación).
 */
export async function avanceArmasDeOt(db: Sql, otId: string, tenantId: string, siempre = false) {
  const [e] = await db.$queryRawUnsafe<any[]>(`SELECT * FROM d11_expediente WHERE ot_id = $1::uuid`, otId);
  const armas = await db.$queryRawUnsafe<FilaArma[]>(`${SELECT_ARMAS} WHERE a.ot_id = $1::uuid ORDER BY a.orden`, otId);
  const [l] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM d11_resolucion_arma r JOIN bpch_internacion i ON i.id = r.internacion_id WHERE i.ot_id = $1::uuid`,
    otId,
  );
  if (!siempre && !e && !armas.length && !Number(l?.n ?? 0)) return null;
  const cfg = await configD11De(db, tenantId);
  return avanceD11(
    {
      programada: Boolean(e?.programacion_fecha),
      llegada: Boolean(e?.llegada_fecha),
      actaFirmada: Boolean(e?.acta_firmada_at),
      recibidas: e?.acta_cantidad ?? null,
      armas: armas.map(estadoDe),
    },
    cfg,
  );
}
