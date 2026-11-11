/**
 * Datos de la cotización que agregaron las sesiones de preproducción (frente S1,
 * align_sesiones_s1.sql) y que no están en el modelo Prisma: tipo de documento
 * y versiones de la pre-cotización, centro de costo emisor, excepción «aceptada
 * sin OT», muestras de la cotización y la muestra de cada línea. Lectura y
 * escritura con SQL parametrizado; `db` = PrismaService o una transacción.
 *
 * Si la base aún no tiene align_sesiones_s1.sql, las lecturas devuelven vacío
 * (la cotización sigue funcionando como antes).
 */
import type { Muestra } from "./muestras-cotizacion";
import type { ReglaValidezConfig } from "./validez-config";

type Db = {
  $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
};

export interface ExtrasCotizacion {
  tipoDocumento: string;
  precotSerie: number | null;
  precotVersion: number | null;
  reemplazaId: string | null;
  reemplazaCodigo: string | null;
  reemplazadaPorId: string | null;
  reemplazadaPorCodigo: string | null;
  precotizacionId: string | null;
  precotizacionCodigo: string | null;
  centroCostoEmisorId: string | null;
  emisor: { codigo: string; nombre: string } | null;
  sinOtMotivo: string | null;
  sinOtAt: Date | null;
}

export const EXTRAS_VACIOS: ExtrasCotizacion = {
  tipoDocumento: "cotizacion",
  precotSerie: null,
  precotVersion: null,
  reemplazaId: null,
  reemplazaCodigo: null,
  reemplazadaPorId: null,
  reemplazadaPorCodigo: null,
  precotizacionId: null,
  precotizacionCodigo: null,
  centroCostoEmisorId: null,
  emisor: null,
  sinOtMotivo: null,
  sinOtAt: null,
};

export async function leerExtras(db: Db, ids: string[]): Promise<Map<string, ExtrasCotizacion>> {
  if (!ids.length) return new Map();
  try {
    const filas = await db.$queryRawUnsafe<any[]>(
      `SELECT c.id::text AS id, c.tipo_documento AS "tipoDocumento", c.precot_serie AS "precotSerie", c.precot_version AS "precotVersion",
              c.reemplaza_id::text AS "reemplazaId", ra.codigo AS "reemplazaCodigo",
              c.reemplazada_por_id::text AS "reemplazadaPorId", rp.codigo AS "reemplazadaPorCodigo",
              c.precotizacion_id::text AS "precotizacionId", pc.codigo AS "precotizacionCodigo",
              c.centro_costo_emisor_id::text AS "centroCostoEmisorId", ce.codigo AS "emisorCodigo", ce.nombre AS "emisorNombre",
              c.sin_ot_motivo AS "sinOtMotivo", c.sin_ot_at AS "sinOtAt"
         FROM cotizacion c
         LEFT JOIN cotizacion ra ON ra.id = c.reemplaza_id
         LEFT JOIN cotizacion rp ON rp.id = c.reemplazada_por_id
         LEFT JOIN cotizacion pc ON pc.id = c.precotizacion_id
         LEFT JOIN centro_costo ce ON ce.id = c.centro_costo_emisor_id
        WHERE c.id = ANY($1::uuid[])`,
      ids,
    );
    return new Map(
      filas.map((f) => [
        f.id,
        {
          tipoDocumento: f.tipoDocumento ?? "cotizacion",
          precotSerie: f.precotSerie ?? null,
          precotVersion: f.precotVersion ?? null,
          reemplazaId: f.reemplazaId ?? null,
          reemplazaCodigo: f.reemplazaCodigo ?? null,
          reemplazadaPorId: f.reemplazadaPorId ?? null,
          reemplazadaPorCodigo: f.reemplazadaPorCodigo ?? null,
          precotizacionId: f.precotizacionId ?? null,
          precotizacionCodigo: f.precotizacionCodigo ?? null,
          centroCostoEmisorId: f.centroCostoEmisorId ?? null,
          emisor: f.emisorCodigo ? { codigo: f.emisorCodigo, nombre: f.emisorNombre } : null,
          sinOtMotivo: f.sinOtMotivo ?? null,
          sinOtAt: f.sinOtAt ?? null,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

/** Guarda los campos S1 de la cabecera (solo los indicados). */
export async function guardarExtras(
  db: Db,
  id: string,
  d: { tipoDocumento?: string; precotSerie?: number | null; precotVersion?: number | null; reemplazaId?: string | null; precotizacionId?: string | null; centroCostoEmisorId?: string | null; conCobro?: boolean | null },
) {
  const sets: string[] = [];
  const args: unknown[] = [id];
  const set = (col: string, v: unknown, cast = "") => {
    args.push(v);
    sets.push(`${col} = $${args.length}${cast}`);
  };
  if (d.tipoDocumento !== undefined) set("tipo_documento", d.tipoDocumento);
  if (d.precotSerie !== undefined) set("precot_serie", d.precotSerie, "::int");
  if (d.precotVersion !== undefined) set("precot_version", d.precotVersion, "::int");
  if (d.reemplazaId !== undefined) set("reemplaza_id", d.reemplazaId, "::uuid");
  if (d.precotizacionId !== undefined) set("precotizacion_id", d.precotizacionId, "::uuid");
  if (d.centroCostoEmisorId !== undefined) set("centro_costo_emisor_id", d.centroCostoEmisorId, "::uuid");
  if (d.conCobro !== undefined && d.conCobro !== null) set("con_cobro", d.conCobro, "::boolean");
  if (!sets.length) return;
  await db.$executeRawUnsafe(`UPDATE cotizacion SET ${sets.join(", ")} WHERE id = $1::uuid`, ...args);
}

/** Muestras de una cotización, en orden. */
export async function leerMuestras(db: Db, cotizacionId: string): Promise<Muestra[]> {
  try {
    const f = await db.$queryRawUnsafe<any[]>(
      `SELECT m.n, m.descripcion, m.cat_elemento_id::text AS "catElementoId", m.producto_texto AS "productoTexto", m.plazo_dias AS "plazoDias"
         FROM cotizacion_muestra m WHERE m.cotizacion_id = $1::uuid ORDER BY m.n`,
      cotizacionId,
    );
    return f.map((m) => ({ n: Number(m.n), descripcion: m.descripcion, catElementoId: m.catElementoId ?? null, productoTexto: m.productoTexto ?? null, plazoDias: m.plazoDias ?? null }));
  } catch {
    return [];
  }
}

/** Reemplaza las muestras de la cotización. Un producto del catálogo debe ser del tenant. */
export async function guardarMuestras(db: Db, tenantId: string, cotizacionId: string, muestras: Muestra[]) {
  await db.$executeRawUnsafe(`DELETE FROM cotizacion_muestra WHERE cotizacion_id = $1::uuid`, cotizacionId);
  if (!muestras.length) return;
  await db.$executeRawUnsafe(
    `INSERT INTO cotizacion_muestra (tenant_id, cotizacion_id, n, descripcion, cat_elemento_id, producto_texto, plazo_dias)
     SELECT $1::uuid, $2::uuid, x.n, x.descripcion,
            (SELECT e.id FROM cat_elemento e WHERE e.id = x.elemento AND e.tenant_id = $1::uuid), x.producto, x.plazo
       FROM jsonb_to_recordset($3::jsonb) AS x(n int, descripcion text, elemento uuid, producto text, plazo int)`,
    tenantId,
    cotizacionId,
    JSON.stringify(muestras.map((m) => ({ n: m.n, descripcion: m.descripcion, elemento: m.catElementoId, producto: m.productoTexto, plazo: m.plazoDias }))),
  );
}

/** Muestra de cada línea (por su `orden`). */
export async function guardarMuestraDeLineas(db: Db, cotizacionId: string, pares: { orden: number; muestraN: number | null }[]) {
  if (!pares.length) return;
  await db.$executeRawUnsafe(
    `UPDATE linea_cotizacion l SET muestra_n = x.m
       FROM jsonb_to_recordset($2::jsonb) AS x(orden int, m int)
      WHERE l.cotizacion_id = $1::uuid AND l.orden = x.orden`,
    cotizacionId,
    JSON.stringify(pares.map((p) => ({ orden: p.orden, m: p.muestraN }))),
  );
}

/** Muestra de cada línea, por id de línea. */
export async function leerMuestraDeLineas(db: Db, cotizacionId: string): Promise<Map<string, number | null>> {
  try {
    const f = await db.$queryRawUnsafe<{ id: string; m: number | null }[]>(
      `SELECT id::text AS id, muestra_n AS m FROM linea_cotizacion WHERE cotizacion_id = $1::uuid`,
      cotizacionId,
    );
    return new Map(f.map((x) => [x.id, x.m == null ? null : Number(x.m)]));
  } catch {
    return new Map();
  }
}

/** Reglas de validez del tenant (Comercial › Validez de cotizaciones). */
export async function leerReglasValidez(db: Db, tenantId: string, soloActivas = true): Promise<(ReglaValidezConfig & { id: string; nota: string | null; centroCosto: string | null })[]> {
  try {
    const f = await db.$queryRawUnsafe<any[]>(
      `SELECT r.id::text AS id, r.tipo_cliente AS "tipoCliente", r.centro_costo_id::text AS "centroCostoId", r.regla, r.dias,
              r.meses_oct_dic AS "mesesOctDic", r.activo, r.nota, cc.codigo || ' · ' || cc.nombre AS "centroCosto"
         FROM cotizacion_validez_regla r LEFT JOIN centro_costo cc ON cc.id = r.centro_costo_id
        WHERE r.tenant_id = $1::uuid AND ($2::boolean = FALSE OR r.activo)
        ORDER BY r.tipo_cliente NULLS LAST, cc.codigo NULLS FIRST`,
      tenantId,
      soloActivas,
    );
    return f.map((r) => ({ ...r, dias: r.dias ?? null, mesesOctDic: r.mesesOctDic ?? null }));
  } catch {
    return [];
  }
}

/** Siguiente número de pre-cotización del año (candado por tenant; usar dentro de una transacción). */
export async function siguienteSeriePrecot(db: Db, tenantId: string, anio: number): Promise<number> {
  await db.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))::text`, `precotizacion:${tenantId}:${anio}`);
  const f = await db.$queryRawUnsafe<{ n: number | null }[]>(
    `SELECT max(precot_serie)::int AS n FROM cotizacion
      WHERE tenant_id = $1::uuid AND tipo_documento = 'precotizacion' AND codigo LIKE $2`,
    tenantId,
    `PC-${anio}-%`,
  );
  return (f[0]?.n ?? 0) + 1;
}
