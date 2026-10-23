/**
 * Alcance por laboratorio de los reportes · LIMS IDIC. Funciones PURAS (solo
 * construyen texto SQL fijo + parámetros), probadas en alcance-reportes.spec.ts.
 *
 * Cada fila cuenta para la UNIDAD de la OT a la que pertenece. Las expresiones
 * salen SIEMPRE de este fichero (nunca del usuario); las unidades viajan como
 * parámetro posicional (`$k::uuid[]`).
 */

/** Expresión SQL cuyo valor es la unidad de cada fila, por tabla (`t` = nombre o alias). */
export const UNIDAD_DE: Record<string, (t: string) => string> = {
  orden_trabajo: (t) => `${t}.unidad_principal`,
  muestra: (t) => `(SELECT o.unidad_principal FROM orden_trabajo o WHERE o.id = ${t}.ot_id)`,
  resultado: (t) =>
    `(SELECT o.unidad_principal FROM orden_trabajo o WHERE o.id = COALESCE(${t}.ot_id, (SELECT m.ot_id FROM muestra m WHERE m.id = ${t}.muestra_id)))`,
  certificado: (t) => `COALESCE(${t}.unidad_id, (SELECT o.unidad_principal FROM orden_trabajo o WHERE o.id = ${t}.ot_id))`,
  factura: (t) => `(SELECT o.unidad_principal FROM orden_trabajo o WHERE o.id = ${t}.ot_id)`,
};

/**
 * Condición de alcance para una tabla: ` AND <unidad> = ANY($k::uuid[])`, con las
 * unidades añadidas a `args`. Sin filtro (perfil global, `unidades = null`) no
 * añade nada. Las cotizaciones cuentan si alguna de sus OT o su centro de costo
 * es de una unidad visible. Una tabla desconocida no devuelve filas.
 */
export function condicionAlcance(tabla: string, alias: string, unidades: string[] | null, args: unknown[]): string {
  if (!unidades) return "";
  args.push(unidades);
  const k = `$${args.length}::uuid[]`;
  if (tabla === "cotizacion")
    return (
      ` AND (EXISTS (SELECT 1 FROM orden_trabajo o WHERE o.cotizacion_id = ${alias}.id AND o.unidad_principal = ANY(${k}))` +
      ` OR EXISTS (SELECT 1 FROM centro_costo cc WHERE cc.id = ${alias}.centro_costo_id AND cc.unidad_id = ANY(${k})))`
    );
  const expr = UNIDAD_DE[tabla];
  if (!expr) return " AND FALSE";
  return ` AND ${expr(alias)} = ANY(${k})`;
}
