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
 * captura y la respuesta trae el faltante) o «impedir» (409 antes de guardar).
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

/**
 * Descuenta lo que consume la captura. Idempotente por resultado: si ya hay
 * consumos automáticos de este ensayo, no hace nada.
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
    `SELECT count(*)::int AS n FROM movimiento_consumible WHERE resultado_id = $1::uuid AND automatico`,
    p.resultadoId,
  );
  if (ya?.n && !p.repeticion) return { descontados: [], faltantes: [] };
  const lista = await necesidades(db, p.tenantId, p.catMetodoId, p.determinaciones);
  const descontados: Descontado[] = [];
  const faltantes: Faltante[] = [];
  const hoy = hoyCl();
  for (const n of lista) {
    const r = await db.$transaction(async (tx) => {
      const lotes = await tx.$queryRawUnsafe<{ id: string; numero_lote: string; cantidad_actual: string }[]>(
        `SELECT id, numero_lote, cantidad_actual::text FROM lote_consumible
          WHERE consumible_id = $1::uuid AND tenant_id = $2::uuid AND cantidad_actual > 0 AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= $3::date)
          ORDER BY fecha_vencimiento ASC NULLS LAST, fecha_recepcion ASC NULLS LAST, numero_lote
          FOR UPDATE`,
        n.consumibleId,
        p.tenantId,
        hoy,
      );
      const disponible = lotes.reduce((a, l) => a + Number(l.cantidad_actual), 0);
      if (disponible + 1e-9 < n.necesario) return { faltante: { consumible: `${n.codigo} · ${n.nombre}`, necesario: n.necesario, disponible, unidad: n.unidad } };
      let resta = n.necesario;
      const usados: string[] = [];
      for (const l of lotes) {
        if (resta <= 1e-9) break;
        const toma = Math.min(resta, Number(l.cantidad_actual));
        const queda = Math.round((Number(l.cantidad_actual) - toma) * 1e6) / 1e6;
        await tx.$executeRawUnsafe(
          `UPDATE lote_consumible SET cantidad_actual = $2, estado = CASE WHEN $2 <= 0 THEN 'agotado' ELSE estado END WHERE id = $1::uuid`,
          l.id,
          queda,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO movimiento_consumible (tenant_id, lote_id, tipo, cantidad, muestra_id, cat_metodo_id, resultado_id, automatico, motivo, created_by)
           VALUES ($1::uuid, $2::uuid, 'consumo', $3, $4::uuid, $5::uuid, $6::uuid, TRUE, $7, $8::uuid)`,
          p.tenantId,
          l.id,
          Math.round(toma * 1e6) / 1e6,
          p.muestraId,
          p.catMetodoId,
          p.resultadoId,
          `Descuento automático al capturar · ${p.referencia}`.slice(0, 2000),
          p.usuarioId,
        );
        usados.push(l.numero_lote);
        resta = Math.round((resta - toma) * 1e6) / 1e6;
      }
      return { descontado: { consumible: `${n.codigo} · ${n.nombre}`, cantidad: n.necesario, unidad: n.unidad, lotes: usados } };
    });
    if ("faltante" in r && r.faltante) faltantes.push(r.faltante);
    else if ("descontado" in r && r.descontado) descontados.push(r.descontado);
  }
  return { descontados, faltantes };
}
