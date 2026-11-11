/**
 * Lo que pasa a otro laboratorio sin orden interna (sesión R3) · reglas puras y
 * lectura sin inyección. Fichero aparte de oi-pendientes.ts para que el cierre
 * de la OT lo use sin cargar el ciclo orden-interna ↔ flujo-real.module.
 */
/** Ensayo de una muestra cuyo laboratorio del catálogo no es el de la OT y que ninguna orden interna deriva. */
export interface EnsayoAjeno {
  muestraId: string;
  muestra: string;
  ensayoId: string;
  ensayo: string;
  familiaId: string;
  laboratorioId: string;
  laboratorio: string;
}

/** Muestra marcada «requiere otros laboratorios» hacia un laboratorio sin orden interna. */
export interface DerivacionDeclarada {
  muestraId: string;
  muestra: string;
  laboratorioId: string;
  laboratorio: string;
}

export interface GrupoPendiente {
  muestraId: string;
  muestra: string;
  laboratorioId: string;
  laboratorio: string;
  familiaId: string | null;
  ensayos: { id: string; nombre: string }[];
  /** Solo declarado en la recepción (sin ensayos del catálogo de ese laboratorio en la muestra). */
  soloDeclarado: boolean;
}

/** Una propuesta de orden interna por muestra y laboratorio de destino. */
export function agruparPendientes(ajenos: EnsayoAjeno[], declarados: DerivacionDeclarada[]): GrupoPendiente[] {
  const grupos = new Map<string, GrupoPendiente>();
  for (const a of ajenos) {
    const k = `${a.muestraId}|${a.laboratorioId}`;
    const g = grupos.get(k) ?? {
      muestraId: a.muestraId,
      muestra: a.muestra,
      laboratorioId: a.laboratorioId,
      laboratorio: a.laboratorio,
      familiaId: a.familiaId,
      ensayos: [],
      soloDeclarado: false,
    };
    if (!g.ensayos.some((e) => e.id === a.ensayoId)) g.ensayos.push({ id: a.ensayoId, nombre: a.ensayo });
    grupos.set(k, g);
  }
  for (const d of declarados) {
    const k = `${d.muestraId}|${d.laboratorioId}`;
    if (!grupos.has(k))
      grupos.set(k, { muestraId: d.muestraId, muestra: d.muestra, laboratorioId: d.laboratorioId, laboratorio: d.laboratorio, familiaId: null, ensayos: [], soloDeclarado: true });
  }
  return [...grupos.values()].sort((a, b) => a.muestra.localeCompare(b.muestra) || a.laboratorio.localeCompare(b.laboratorio));
}

/** Texto para el cierre y el avance de la OT: qué pasa a otro laboratorio sin orden interna. */
export function faltantesOrdenInterna(grupos: GrupoPendiente[]): string[] {
  if (!grupos.length) return [];
  const det = grupos.slice(0, 4).map((g) => `${g.muestra} → ${g.laboratorio}`).join(", ");
  return [
    `${grupos.length === 1 ? "Una muestra pasa" : `${grupos.length} muestras pasan`} a otro laboratorio sin orden interna (${det}${grupos.length > 4 ? "…" : ""}): emítala en la pestaña «Órdenes internas» o con «Generar órdenes internas».`,
  ];
}

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

/** Lo que pasa a otro laboratorio sin orden interna en la OT (función sin inyección: la usa también el cierre). */
export async function pendientesOrdenInterna(db: Sql, otId: string): Promise<GrupoPendiente[]> {
  try {
    const ajenos = await db.$queryRawUnsafe<EnsayoAjeno[]>(
      `SELECT DISTINCT m.id AS "muestraId", m.codigo AS muestra, e.id AS "ensayoId", e.nombre AS ensayo, f.id AS "familiaId",
              ul.id AS "laboratorioId", ul.codigo AS laboratorio
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id AND m.deleted_at IS NULL
         JOIN orden_trabajo o ON o.id = COALESCE(r.ot_id, m.ot_id)
         JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         JOIN cat_ensayo e ON e.id = cm.ensayo_id
         JOIN cat_familia f ON f.id = e.familia_id
         JOIN LATERAL (
           SELECT u.id, u.codigo, u.tipo FROM unidad u
            WHERE u.tenant_id = f.tenant_id AND u.activa
              AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
            ORDER BY (u.tipo = 'LABORATORIO') DESC, u.codigo LIMIT 1) ul ON ul.tipo = 'LABORATORIO'
         JOIN LATERAL lims_lab_de_resultado(r.id) l ON TRUE
        WHERE o.id = $1::uuid AND r.deleted_at IS NULL AND NOT l.derivado
          AND o.unidad_principal IS NOT NULL AND ul.id <> o.unidad_principal`,
      otId,
    );
    const declarados = await db.$queryRawUnsafe<DerivacionDeclarada[]>(
      `SELECT m.id AS "muestraId", m.codigo AS muestra, u.id AS "laboratorioId", u.codigo AS laboratorio
         FROM muestra m
         JOIN orden_trabajo o ON o.id = m.ot_id
         JOIN LATERAL unnest(m.otros_labs) AS x(unidad_id) ON TRUE
         JOIN unidad u ON u.id = x.unidad_id
        WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL AND COALESCE(m.requiere_otros_labs, false)
          AND u.id <> COALESCE(o.unidad_principal, '00000000-0000-0000-0000-000000000000'::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM orden_interna oi JOIN cat_familia f ON f.id = oi.destino_lab
             WHERE oi.ot_id = m.ot_id AND oi.deleted_at IS NULL AND oi.estado <> 'anulada'
               AND (oi.muestra_id IS NULL OR oi.muestra_id = m.id)
               AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/')))`,
      otId,
    );
    return agruparPendientes(ajenos, declarados);
  } catch {
    // Base sin las funciones del recorrido (lims_lab_de_resultado) o sin las columnas de la recepción.
    return [];
  }
}

