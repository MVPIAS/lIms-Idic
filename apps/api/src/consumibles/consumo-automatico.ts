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

const SQL_DISPONIBLE = `SELECT COALESCE(SUM(cantidad_actual), 0)::float AS d FROM lote_consumible
  WHERE consumible_id = $1::uuid AND tenant_id = $2::uuid AND cantidad_actual > 0 AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= $3::date)`;

/** Faltantes de stock para capturar este ensayo (vacío = alcanza todo). */
export async function faltantesDeCaptura(db: Db, p: { tenantId: string; catMetodoId: string | null; determinaciones: number }): Promise<Faltante[]> {
  if (!p.catMetodoId) return [];
  const out: Faltante[] = [];
  for (const n of await necesidades(db, p.tenantId, p.catMetodoId, p.determinaciones)) {
    const [d] = await db.$queryRawUnsafe<{ d: number }[]>(SQL_DISPONIBLE, n.consumibleId, p.tenantId, hoyCl());
    if (Number(d?.d ?? 0) + 1e-9 < n.necesario) out.push({ consumible: `${n.codigo} · ${n.nombre}`, necesario: n.necesario, disponible: Number(d?.d ?? 0), unidad: n.unidad });
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
  },
): Promise<{ lotes: string[] } | { disponible: number }> {
  return db.$transaction(async (tx) => {
    const filas = await tx.$queryRawUnsafe<{ id: string; numero_lote: string; cantidad_actual: string }[]>(
      `SELECT id, numero_lote, cantidad_actual::text FROM lote_consumible
        WHERE consumible_id = $1::uuid AND tenant_id = $2::uuid AND cantidad_actual > 0 AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= $3::date)
        ORDER BY fecha_vencimiento ASC NULLS LAST, fecha_recepcion ASC NULLS LAST, numero_lote
        FOR UPDATE`,
      p.consumibleId,
      p.tenantId,
      hoyCl(),
    );
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
