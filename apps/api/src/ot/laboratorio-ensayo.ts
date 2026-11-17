/**
 * Laboratorio que hace cada ensayo de la OT (F071). La asignación y el
 * «Siguiente paso» del laboratorio responsable cuentan solo sus ensayos: los
 * que van a otro laboratorio (por su catálogo, aunque la orden interna aún no
 * se emita, o derivados por una orden interna) los asigna y captura el destino.
 *
 *   laboratorio = destino de la orden interna (si está derivado)
 *               ?? laboratorio del catálogo del ensayo (unidad de tipo LABORATORIO)
 *               ?? laboratorio responsable de la OT
 *
 * Es la misma regla con la que oi-pendientes-datos.ts exige la orden interna.
 */
export interface EnsayoConLaboratorio {
  id: string;
  estado: string | null;
  muestraId?: string | null;
  derivadoA: string | null;
  laboratorioCatalogo: string | null;
  laboratorioCodigo?: string | null;
}

export function laboratorioDelEnsayo(e: Pick<EnsayoConLaboratorio, "derivadoA" | "laboratorioCatalogo">, principal: string | null): string | null {
  return e.derivadoA ?? e.laboratorioCatalogo ?? principal;
}

export function esDelResponsable(e: Pick<EnsayoConLaboratorio, "derivadoA" | "laboratorioCatalogo">, principal: string | null): boolean {
  if (!principal) return true;
  return laboratorioDelEnsayo(e, principal) === principal;
}

/** Ensayos de otros laboratorios por código de laboratorio (para el aviso de la asignación). */
export function ensayosDeOtrosLaboratorios(ensayos: EnsayoConLaboratorio[], principal: string | null): { laboratorio: string; ensayos: number }[] {
  const m = new Map<string, number>();
  for (const e of ensayos)
    if (!esDelResponsable(e, principal)) {
      const k = e.laboratorioCodigo ?? "otro laboratorio";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  return [...m].map(([laboratorio, n]) => ({ laboratorio, ensayos: n })).sort((a, b) => a.laboratorio.localeCompare(b.laboratorio, "es"));
}

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

/** Ensayos vivos de la OT con su laboratorio (null si la base no tiene lims_lab_de_resultado). */
export async function ensayosConLaboratorio(db: Sql, otId: string): Promise<EnsayoConLaboratorio[] | null> {
  try {
    return await db.$queryRawUnsafe<EnsayoConLaboratorio[]>(
      `SELECT r.id, r.estado, r.muestra_id AS "muestraId",
              CASE WHEN l.derivado THEN l.unidad_id END AS "derivadoA",
              ul.id AS "laboratorioCatalogo",
              COALESCE(ud.codigo, ul.codigo) AS "laboratorioCodigo"
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id AND m.deleted_at IS NULL
         JOIN LATERAL lims_lab_de_resultado(r.id) l ON TRUE
         LEFT JOIN unidad ud ON ud.id = l.unidad_id AND l.derivado
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         LEFT JOIN cat_ensayo e ON e.id = cm.ensayo_id
         LEFT JOIN cat_familia f ON f.id = e.familia_id
         LEFT JOIN LATERAL (
           SELECT u.id, u.codigo FROM unidad u
            WHERE f.id IS NOT NULL AND u.tenant_id = f.tenant_id AND u.activa AND u.tipo = 'LABORATORIO'
              AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
            ORDER BY u.codigo LIMIT 1) ul ON TRUE
        WHERE COALESCE(r.ot_id, m.ot_id) = $1::uuid AND r.deleted_at IS NULL`,
      otId,
    );
  } catch {
    return null;
  }
}
