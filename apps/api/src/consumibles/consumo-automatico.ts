/**
 * Descuento automático de consumibles al capturar (contrato §4.4.5).
 *
 * Cada método puede declarar cuánto consume una determinación de cada
 * consumible (cat_metodo_consumible). La PRIMERA captura de un ensayo descuenta
 * esa cantidad del stock por FIFO de caducidad, solo de lotes vigentes (no
 * vencidos), repartiendo entre lotes si hace falta. Cada salida queda en el
 * kardex como «consumo» automático con la muestra, el método y el resultado.
 * Una corrección del valor no vuelve a descontar; la repetición por re-análisis sí.
 *
 * Sin stock suficiente, según el parámetro consumibles.sin_stock: «avisar» (se
 * captura y la respuesta trae lo descontado y lo pendiente) o «impedir» (409
 * antes de guardar). Con «avisar», lo que no se pudo descontar queda en
 * consumo_pendiente (align_correcciones_v30_3.sql): nada se pierde, y
 * Abastecimiento lo regulariza desde Consumibles › Consumos pendientes una vez
 * ingresado el lote (o lo descarta con motivo). Se eligió la regularización
 * explícita y no el descuento automático al ingresar stock para que cada
 * salida tenga a alguien que la decidió y el lote de donde salió quede claro.
 */
import { hoyCl } from "../ot/plazos";
import { cantidadPorCaptura } from "./conversion";
import { modoConsumo, ordenarLotesPorBodega, type ModoConsumo } from "./bodegas";

type Db = { $queryRawUnsafe: <T = unknown>(q: string, ...p: unknown[]) => Promise<T>; $executeRawUnsafe: (q: string, ...p: unknown[]) => Promise<number> };
type DbTx = Db & { $transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> };

export interface ConfigConsumo {
  automatico: boolean;
  sinStock: "avisar" | "impedir";
}

export async function leerConfigConsumo(db: Db, tenantId: string): Promise<ConfigConsumo> {
  const filas = await db
    .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'consumibles'`,
      tenantId,
    )
    .catch(() => [] as { codigo: string; valor: string | null; activo: boolean }[]);
  const v = (c: string) => String(filas.find((f) => f.codigo === c && f.activo !== false)?.valor ?? "").trim().toLowerCase();
  return { automatico: v("descuento_automatico") !== "no", sinStock: v("sin_stock") === "impedir" ? "impedir" : "avisar" };
}

export interface Faltante {
  consumible: string;
  necesario: number;
  disponible: number;
  unidad: string | null;
  /** Registro en consumo_pendiente (solo al capturar con «avisar»). */
  pendienteId?: string | null;
}
export interface Descontado {
  consumible: string;
  cantidad: number;
  unidad: string | null;
  lotes: string[];
}

interface Necesidad {
  consumibleId: string;
  codigo: string;
  nombre: string;
  unidad: string | null;
  necesario: number;
}

async function necesidades(db: Db, tenantId: string, catMetodoId: string, determinaciones: number): Promise<Necesidad[]> {
  const filas = await db.$queryRawUnsafe<{ consumible_id: string; codigo: string; nombre: string; unidad: string | null; cantidad: string; por: string }[]>(
    `SELECT mc.consumible_id, c.codigo, c.nombre, c.unidad_medida AS unidad, mc.cantidad::text AS cantidad, mc.por
       FROM cat_metodo_consumible mc JOIN consumible c ON c.id = mc.consumible_id AND c.activo IS NOT FALSE
      WHERE mc.cat_metodo_id = $1::uuid AND mc.tenant_id = $2::uuid`,
    catMetodoId,
    tenantId,
  );
  return filas.map((f) => ({
    consumibleId: f.consumible_id,
    codigo: f.codigo,
    nombre: f.nombre,
    unidad: f.unidad,
    necesario: cantidadPorCaptura(Number(f.cantidad), f.por, determinaciones),
  }));
}

/** Unidad del laboratorio de una cat_familia (mismo criterio que planillas-ot.ts). */
const FAMILIA_DE_UNIDAD = `f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))`;

/**
 * Laboratorios a cuyas sub-bodegas puede cargarse un consumo (S4, bodegas): el
 * del método en el catálogo y el responsable de la OT de la muestra (o de la OT
 * indicada). Vacío si no se puede saber.
 */
export async function laboratoriosDelConsumo(
  db: Db,
  p: { tenantId: string; catMetodoId?: string | null; muestraId?: string | null; otId?: string | null },
): Promise<string[]> {
  if (!p.catMetodoId && !p.muestraId && !p.otId) return [];
  const filas = await db
    .$queryRawUnsafe<{ id: string }[]>(
      `SELECT u.id FROM cat_metodo cm
         JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
         JOIN cat_familia f ON f.id = ce.familia_id AND f.codsucdel IS NOT NULL
         JOIN unidad u ON u.tenant_id = $1::uuid AND ${FAMILIA_DE_UNIDAD}
        WHERE cm.id = $2::uuid
       UNION
       SELECT o.unidad_principal FROM orden_trabajo o
        WHERE o.tenant_id = $1::uuid AND o.unidad_principal IS NOT NULL
          AND o.id = COALESCE($4::uuid, (SELECT m.ot_id FROM muestra m WHERE m.id = $3::uuid))`,
      p.tenantId,
      p.catMetodoId ?? null,
      p.muestraId ?? null,
      p.otId ?? null,
    )
    .catch(() => [] as { id: string }[]);
  return [...new Set(filas.map((f) => f.id).filter(Boolean))];
}

export async function leerModoConsumo(db: Db, tenantId: string): Promise<ModoConsumo> {
  const [f] = await db
    .$queryRawUnsafe<{ valor: string | null }[]>(
      `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'consumibles' AND codigo = 'bodega_consumo' AND activo`,
      tenantId,
    )
    .catch(() => [] as { valor: string | null }[]);
  return modoConsumo(f?.valor);
}

/**
 * Lotes vigentes con stock de un consumible que puede usar un consumo, en el
 * orden en que se descuentan: bodega (sub-bodega del laboratorio, central) y,
 * dentro de cada una, FIFO de caducidad.
 */
export async function lotesParaConsumo(
  db: Db,
  p: { tenantId: string; consumibleId: string; labs: string[]; modo: ModoConsumo; bloquear?: boolean },
): Promise<{ id: string; numero_lote: string; cantidad_actual: string }[]> {
  const filas = await db.$queryRawUnsafe<{ id: string; numero_lote: string; cantidad_actual: string; bodega_tipo: string | null; bodega_unidad: string | null }[]>(
    `SELECT l.id, l.numero_lote, l.cantidad_actual::text, b.tipo AS bodega_tipo, b.unidad_id AS bodega_unidad FROM lote_consumible l
       LEFT JOIN bodega b ON b.id = l.bodega_id
      WHERE l.consumible_id = $1::uuid AND l.tenant_id = $2::uuid AND l.cantidad_actual > 0 AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= $3::date)
      ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.fecha_recepcion ASC NULLS LAST, l.numero_lote${p.bloquear ? `
      FOR UPDATE OF l` : ""}`,
    p.consumibleId,
    p.tenantId,
    hoyCl(),
  );
  return ordenarLotesPorBodega(
    filas.map((f) => ({ ...f, tipo: (f.bodega_tipo as "central" | "laboratorio" | null) ?? null, unidadId: f.bodega_unidad ?? null })),
    p.labs,
    p.modo,
  );
}

/** Faltantes de stock para capturar este ensayo (vacío = alcanza todo). */
export async function faltantesDeCaptura(
  db: Db,
  p: { tenantId: string; catMetodoId: string | null; determinaciones: number; muestraId?: string | null },
): Promise<Faltante[]> {
  if (!p.catMetodoId) return [];
  const out: Faltante[] = [];
  const labs = await laboratoriosDelConsumo(db, { tenantId: p.tenantId, catMetodoId: p.catMetodoId, muestraId: p.muestraId ?? null });
  const modo = await leerModoConsumo(db, p.tenantId);
  for (const n of await necesidades(db, p.tenantId, p.catMetodoId, p.determinaciones)) {
    const lotes = await lotesParaConsumo(db, { tenantId: p.tenantId, consumibleId: n.consumibleId, labs, modo });
    const d = lotes.reduce((a, l) => a + Math.max(0, Number(l.cantidad_actual) || 0), 0);
    if (d + 1e-9 < n.necesario) out.push({ consumible: `${n.codigo} · ${n.nombre}`, necesario: n.necesario, disponible: d, unidad: n.unidad });
  }
  return out;
}

/** Lote con stock vigente, en el orden FIFO de caducidad. */
export interface LoteFifo {
  id: string;
  numero: string;
  cantidad: number;
}
export interface TomaLote {
  loteId: string;
  numero: string;
  toma: number;
  queda: number;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Reparto FIFO de una cantidad entre lotes ya ordenados por caducidad.
 * null = el stock no alcanza (no se toma nada: el consumo no se parte entre
 * lo que hay y lo que falta).
 */
export function repartoFifo(lotes: LoteFifo[], necesario: number): TomaLote[] | null {
  const disponible = lotes.reduce((a, l) => a + Math.max(0, l.cantidad), 0);
  if (disponible + 1e-9 < necesario) return null;
  const out: TomaLote[] = [];
  let resta = necesario;
  for (const l of lotes) {
    if (resta <= 1e-9) break;
    if (l.cantidad <= 0) continue;
    const toma = Math.min(resta, l.cantidad);
    out.push({ loteId: l.id, numero: l.numero, toma: r6(toma), queda: r6(l.cantidad - toma) });
    resta = r6(resta - toma);
  }
  return out;
}

/**
 * Descuenta `cantidad` de un consumible por FIFO de caducidad (solo lotes
 * vigentes) dentro de una transacción, con un asiento de consumo por lote.
 * Devuelve los lotes usados o, si no alcanza, lo disponible (sin tocar nada).
 */
export async function descontarFifo(
  db: DbTx,
  p: {
    tenantId: string;
    consumibleId: string;
    cantidad: number;
    muestraId: string | null;
    catMetodoId: string | null;
    resultadoId: string | null;
    automatico: boolean;
    motivo: string;
    usuarioId: string | null;
    /** Laboratorios del consumo y modo de bodega (si no se dan, se leen). */
    labs?: string[];
    modo?: ModoConsumo;
  },
): Promise<{ lotes: string[] } | { disponible: number }> {
  // S4 · bodegas: el consumo sale de la sub-bodega del laboratorio del ensayo (parámetro consumibles.bodega_consumo).
  const labs = p.labs ?? (await laboratoriosDelConsumo(db, { tenantId: p.tenantId, catMetodoId: p.catMetodoId, muestraId: p.muestraId }));
  const modo = p.modo ?? (await leerModoConsumo(db, p.tenantId));
  return db.$transaction(async (tx) => {
    const filas = await lotesParaConsumo(tx, { tenantId: p.tenantId, consumibleId: p.consumibleId, labs, modo, bloquear: true });
    const lotes = filas.map((l) => ({ id: l.id, numero: l.numero_lote, cantidad: Number(l.cantidad_actual) }));
    const reparto = repartoFifo(lotes, p.cantidad);
    if (!reparto) return { disponible: lotes.reduce((a, l) => a + l.cantidad, 0) };
    for (const t of reparto) {
      await tx.$executeRawUnsafe(
        `UPDATE lote_consumible SET cantidad_actual = $2, estado = CASE WHEN $2 <= 0 THEN 'agotado' ELSE estado END WHERE id = $1::uuid`,
        t.loteId,
        t.queda,
      );
      await tx.$executeRawUnsafe(
        // §4.4.5: la OT sale de la muestra y la actividad es «análisis» (mismo vínculo que un movimiento manual).
        `INSERT INTO movimiento_consumible (tenant_id, lote_id, tipo, cantidad, muestra_id, cat_metodo_id, resultado_id, automatico, motivo, created_by, ot_id, actividad)
         VALUES ($1::uuid, $2::uuid, 'consumo', $3, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9::uuid,
                 (SELECT ot_id FROM muestra WHERE id = $4::uuid), 'analisis')`,
        p.tenantId,
        t.loteId,
        t.toma,
        p.muestraId,
        p.catMetodoId,
        p.resultadoId,
        p.automatico,
        p.motivo.slice(0, 2000),
        p.usuarioId,
      );
    }
    return { lotes: reparto.map((t) => t.numero) };
  });
}

/**
 * Descuenta lo que consume la captura. Idempotente por resultado: si ya hay
 * consumos automáticos o pendientes de este ensayo, no hace nada (salvo la
 * repetición de un re-análisis). Lo que no alcanza a descontarse queda como
 * consumo pendiente para regularizarlo después.
 */
export async function descontarPorCaptura(
  db: DbTx,
  p: {
    tenantId: string;
    resultadoId: string;
    catMetodoId: string | null;
    muestraId: string | null;
    determinaciones: number;
    usuarioId: string | null;
    referencia: string;
    /** Repetición por re-análisis: la determinación se vuelve a hacer y consume de nuevo. */
    repeticion?: boolean;
  },
): Promise<{ descontados: Descontado[]; faltantes: Faltante[] }> {
  if (!p.catMetodoId) return { descontados: [], faltantes: [] };
  const [ya] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT (SELECT count(*) FROM movimiento_consumible WHERE resultado_id = $1::uuid AND automatico)::int
          + (SELECT count(*) FROM consumo_pendiente WHERE resultado_id = $1::uuid)::int AS n`,
    p.resultadoId,
  );
  if (ya?.n && !p.repeticion) return { descontados: [], faltantes: [] };
  const lista = await necesidades(db, p.tenantId, p.catMetodoId, p.determinaciones);
  const labs = await laboratoriosDelConsumo(db, { tenantId: p.tenantId, catMetodoId: p.catMetodoId, muestraId: p.muestraId });
  const modo = await leerModoConsumo(db, p.tenantId);
  const descontados: Descontado[] = [];
  const faltantes: Faltante[] = [];
  for (const n of lista) {
    const consumible = `${n.codigo} · ${n.nombre}`;
    const r = await descontarFifo(db, {
      tenantId: p.tenantId,
      consumibleId: n.consumibleId,
      cantidad: n.necesario,
      muestraId: p.muestraId,
      catMetodoId: p.catMetodoId,
      resultadoId: p.resultadoId,
      automatico: true,
      motivo: `Descuento automático al capturar · ${p.referencia}`,
      usuarioId: p.usuarioId,
      labs,
      modo,
    });
    if ("lotes" in r) {
      descontados.push({ consumible, cantidad: n.necesario, unidad: n.unidad, lotes: r.lotes });
      continue;
    }
    // Sin stock vigente: queda registrado como pendiente de descontar.
    const [pend] = await db.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO consumo_pendiente (tenant_id, consumible_id, cantidad, muestra_id, cat_metodo_id, resultado_id, referencia, creado_por)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7, $8::uuid) RETURNING id`,
      p.tenantId,
      n.consumibleId,
      n.necesario,
      p.muestraId,
      p.catMetodoId,
      p.resultadoId,
      p.referencia.slice(0, 500),
      p.usuarioId,
    );
    faltantes.push({ consumible, necesario: n.necesario, disponible: r.disponible, unidad: n.unidad, pendienteId: pend?.id ?? null });
  }
  return { descontados, faltantes };
}
