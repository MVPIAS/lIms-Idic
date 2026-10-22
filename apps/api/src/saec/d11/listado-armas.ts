/**
 * Listado de armas de la resolución DGMN (EP-11 11.1). Lo registra Comercial o
 * la SCC junto con la internación cuando la unidad que inspecciona es la
 * Delegación Nº 11; queda «según resolución» para el acta (11.6) y la
 * verificación (11.9). Lo usa InternacionBpchService (registrar y corregir).
 */
import { z } from "zod";
import { TIPOS_ARMA, erroresListado, normalizarSerie } from "./reglas-d11";

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T>; $executeRawUnsafe(q: string, ...v: any[]): Promise<number> };

const t = (max: number) => z.string().trim().max(max);

export const ListadoArmaBody = z.object({
  tipo: z.enum(TIPOS_ARMA),
  marca: t(160).min(1, "Indique la marca."),
  modelo: t(160).optional().nullable(),
  calibre: t(80).optional().nullable(),
  serie: t(80).optional().nullable(),
  accesorios: t(300).optional().nullable(),
  cantidad: z.number().int().min(1).max(10_000).default(1),
});
export type ListadoArma = z.infer<typeof ListadoArmaBody>;

/** ¿La unidad es la Delegación Nº 11 o cuelga de ella? */
export async function esRamaD11(db: Sql, tenantId: string, unidadId: string): Promise<boolean> {
  const filas = await db.$queryRawUnsafe<{ ok: boolean }[]>(
    `WITH RECURSIVE rama AS (
       SELECT id FROM unidad WHERE tenant_id = $1::uuid AND codigo = 'D11'
       UNION ALL SELECT u.id FROM unidad u JOIN rama r ON u.padre_id = r.id)
     SELECT EXISTS (SELECT 1 FROM rama WHERE id = $2::uuid) AS ok`,
    tenantId,
    unidadId,
  );
  return Boolean(filas[0]?.ok);
}

/** Errores del listado para la unidad que inspecciona (solo la D11 lleva listado de armas). */
export async function erroresListadoArmas(db: Sql, tenantId: string, unidadId: string, armas: ListadoArma[]): Promise<string[]> {
  if (!armas.length) return [];
  if (!(await esRamaD11(db, tenantId, unidadId)))
    return ["El listado de armas solo corresponde cuando inspecciona la Delegación Nº 11."];
  return erroresListado(armas.map((a) => ({ ...a, cantidad: a.cantidad ?? 1 })));
}

/** Reemplaza el listado de la internación (dentro de la transacción del registro). */
export async function guardarListadoArmas(tx: Sql, tenantId: string, internacionId: string, armas: ListadoArma[], usuario: string | null) {
  await tx.$executeRawUnsafe(`DELETE FROM d11_resolucion_arma WHERE internacion_id = $1::uuid`, internacionId);
  let orden = 1;
  for (const a of armas)
    await tx.$executeRawUnsafe(
      `INSERT INTO d11_resolucion_arma (tenant_id, internacion_id, orden, tipo, marca, modelo, calibre, serie, serie_normalizada, accesorios, cantidad, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid)`,
      tenantId,
      internacionId,
      orden++,
      a.tipo,
      a.marca.trim(),
      a.modelo?.trim() || null,
      a.calibre?.trim() || null,
      a.serie?.trim() || null,
      normalizarSerie(a.serie),
      a.accesorios?.trim() || null,
      a.cantidad ?? 1,
      usuario,
    );
}

export function leerListadoArmas(db: Sql, internacionId: string) {
  return db.$queryRawUnsafe<any[]>(
    `SELECT id, orden, tipo, marca, modelo, calibre, serie, accesorios, cantidad
       FROM d11_resolucion_arma WHERE internacion_id = $1::uuid ORDER BY orden`,
    internacionId,
  );
}
