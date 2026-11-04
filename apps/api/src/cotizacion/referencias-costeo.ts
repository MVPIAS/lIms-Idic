/**
 * Contrato 4.1.4 · valores de referencia que el laboratorio usa al llenar el
 * Formulario de costeo (FORM05) de una solicitud:
 *   · Tarifas HH vigentes (Tablas maestras › Tarifas HH): «Valor hora» de la
 *     sección 2 según la categoría. Las tarifas HH son comunes al instituto.
 *   · Tarifas HM vigentes de los equipos DEL LABORATORIO de la solicitud (y las
 *     que no van atadas a un equipo): «Valor hora» de la sección 4.
 *   · Consumibles activos del inventario con su costo de referencia por unidad
 *     (Consumibles › «Costo unitario»): sección 7, insumos y reactivos.
 * Los valores se proponen en pantalla y quedan editables; el servidor no los
 * impone al guardar (el costeo es una estimación del laboratorio).
 */

export interface TarifaHhRef { categoria: string; descripcion: string | null; valorHora: number; vigenteDesde: string }
export interface TarifaHmRef { codigo: string | null; descripcion: string | null; equipo: string | null; valorHora: number; vigenteDesde: string; delLaboratorio: boolean }
export interface InsumoRef { id: string; codigo: string; nombre: string; unidad: string | null; costoUnitario: number | null }
export interface ReferenciasCosteo { fecha: string; tarifasHh: TarifaHhRef[]; tarifasHm: TarifaHmRef[]; insumos: InsumoRef[] }

const num = (v: unknown) => (v == null ? null : Number(v));

/** Nombre que el FORM05 muestra para una tarifa HM: equipo (código · nombre) o la descripción de la tarifa. */
export function etiquetaTarifaHm(t: Pick<TarifaHmRef, "codigo" | "descripcion" | "equipo">): string {
  return t.equipo ?? t.descripcion ?? t.codigo ?? "Equipo";
}

/** Lee las referencias vigentes a `fecha` (AAAA-MM-DD) para el laboratorio `unidadId`. */
export async function leerReferenciasCosteo(db: any, tenantId: string, unidadId: string | null, fecha: string): Promise<ReferenciasCosteo> {
  const [hh, hm, ins] = await Promise.all([
    db.$queryRawUnsafe(
      `SELECT DISTINCT ON (lower(categoria)) categoria, descripcion, valor_hora_clp::float8 AS "valorHora",
              to_char(vigente_desde, 'YYYY-MM-DD') AS "vigenteDesde"
         FROM hora_hombre_catalogo
        WHERE tenant_id = $1::uuid AND activo AND vigente_desde <= $2::date AND (vigente_hasta IS NULL OR vigente_hasta >= $2::date)
        ORDER BY lower(categoria), vigente_desde DESC`,
      tenantId,
      fecha,
    ) as Promise<any[]>,
    db.$queryRawUnsafe(
      `SELECT DISTINCT ON (COALESCE(h.equipo_id::text, h.codigo, h.id::text))
              h.codigo, h.descripcion, h.valor_hora_clp::float8 AS "valorHora", to_char(h.vigente_desde, 'YYYY-MM-DD') AS "vigenteDesde",
              CASE WHEN e.id IS NULL THEN NULL ELSE concat_ws(' · ', e.codigo, COALESCE(e.nombre, e.descripcion)) END AS equipo,
              (e.unidad_id IS NOT NULL AND e.unidad_id = $3::uuid) AS "delLaboratorio"
         FROM hora_maquina_catalogo h
         LEFT JOIN equipo e ON e.id = h.equipo_id AND e.deleted_at IS NULL
        WHERE h.tenant_id = $1::uuid AND h.activo AND h.vigente_desde <= $2::date AND (h.vigente_hasta IS NULL OR h.vigente_hasta >= $2::date)
          AND (h.equipo_id IS NULL OR e.unidad_id = $3::uuid)
        ORDER BY COALESCE(h.equipo_id::text, h.codigo, h.id::text), h.vigente_desde DESC`,
      tenantId,
      fecha,
      unidadId,
    ) as Promise<any[]>,
    db.$queryRawUnsafe(
      `SELECT id::text, codigo, nombre, unidad_medida AS unidad, costo_unitario_clp::float8 AS "costoUnitario"
         FROM consumible
        WHERE tenant_id = $1::uuid AND COALESCE(activo, TRUE)
        ORDER BY codigo
        LIMIT 2000`,
      tenantId,
    ) as Promise<any[]>,
  ]);
  return {
    fecha,
    tarifasHh: hh.map((r) => ({ ...r, valorHora: Number(r.valorHora) })),
    tarifasHm: hm
      .map((r) => ({ ...r, valorHora: Number(r.valorHora), delLaboratorio: !!r.delLaboratorio }))
      .sort((a, b) => Number(b.delLaboratorio) - Number(a.delLaboratorio) || etiquetaTarifaHm(a).localeCompare(etiquetaTarifaHm(b), "es")),
    insumos: ins.map((r) => ({ ...r, costoUnitario: num(r.costoUnitario) })),
  };
}
