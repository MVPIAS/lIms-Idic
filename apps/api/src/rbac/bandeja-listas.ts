/**
 * «Lo que le toca» de cada tarjeta de Mi bandeja (T14, frente r4c): las primeras
 * filas de la lista que cuenta la tarjeta, con su enlace. Mismo criterio y mismo
 * alcance que el conteo de bandeja.service.ts ($1 tenant, $2 unidades visibles
 * o NULL, $3 usuario). Cada consulta devuelve id, texto, detalle, ruta y fecha.
 */

const OT_TERMINADA = `('cerrada','anulada','finalizada','informada')`;
const OT_CERRADA = `('cerrada','anulada')`;
const HOY_CL = `(now() AT TIME ZONE 'America/Santiago')::date`;
const OT_SCOPE = `o.tenant_id = COALESCE($1::uuid, o.tenant_id) AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))`;

/** Fila de OT con cliente y laboratorio, para las tarjetas de OT. */
const filaOt = (where: string, orden = "o.fecha_compromiso NULLS LAST, o.created_at", ruta = "'/ot/' || o.id") => `
  SELECT o.id::text AS id, o.codigo AS texto,
         concat_ws(' · ', u.codigo, cl.razon_social) AS detalle,
         ${ruta} AS ruta, o.fecha_compromiso::text AS fecha
    FROM orden_trabajo o
    LEFT JOIN unidad u ON u.id = o.unidad_principal
    LEFT JOIN cliente cl ON cl.id = o.cliente_id
   WHERE ${OT_SCOPE} AND ${where}
   ORDER BY ${orden}`;

/** Resultados agrupados por OT (captura, revisión, aprobación, devueltos). */
const porOt = (where: string, params: "estados" | "yo" | "nada", ruta: string) => `
  SELECT o.id::text AS id, o.codigo AS texto,
         concat_ws(' · ', count(*) || ' resultado' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END, min(u.codigo)) AS detalle,
         '${ruta}' || o.id AS ruta, NULL::text AS fecha
    FROM resultado r JOIN orden_trabajo o ON o.id = r.ot_id
    JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
    LEFT JOIN unidad u ON u.id = lr.unidad_id
   WHERE r.deleted_at IS NULL AND o.tenant_id = COALESCE($1::uuid, o.tenant_id)
     AND ($2::uuid[] IS NULL OR lr.unidad_id = ANY($2::uuid[])) AND ${where}
     ${params === "nada" ? "" : ""}
   GROUP BY o.id, o.codigo ORDER BY o.codigo`;

const docCert = (where: string) => `
  SELECT c.id::text AS id, COALESCE(c.numero, c.codigo) AS texto,
         concat_ws(' · ', 'OT ' || o.codigo, cl.razon_social) AS detalle,
         '/ot/' || o.id || '?tab=informe' AS ruta, COALESCE(c.oficial_at, c.fecha)::date::text AS fecha
    FROM certificado c JOIN orden_trabajo o ON o.id = c.ot_id
    LEFT JOIN cliente cl ON cl.id = o.cliente_id
   WHERE ${where}
   ORDER BY COALESCE(c.oficial_at, c.fecha)`;

/**
 * Consulta de la lista de cada tarjeta (por clave). `extra` son los parámetros
 * desde $3 que usa esa consulta (el conteo usa los mismos).
 */
export const LISTAS_BANDEJA: Record<string, { sql: string; extra: "yo" | "estados" | "ninguno"; estados?: string[] }> = {
  ot_vencidas: { sql: filaOt(`o.estado NOT IN ${OT_CERRADA} AND o.fecha_compromiso < ${HOY_CL}`), extra: "ninguno" },
  ot_por_vencer: { sql: filaOt(`o.estado NOT IN ${OT_CERRADA} AND o.fecha_compromiso BETWEEN ${HOY_CL} AND ${HOY_CL} + 3`), extra: "ninguno" },
  ot_sin_plazo: { sql: filaOt(`o.estado NOT IN ${OT_CERRADA} AND o.fecha_compromiso IS NULL`, "o.created_at", "'/ot/' || o.id || '?tab=informe'"), extra: "ninguno" },
  ot_listas_cerrar: {
    sql: filaOt(
      `o.estado NOT IN ${OT_CERRADA}
       AND EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido'))
       AND NOT EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL
                         AND (c.estado IN ('en_firma','devuelto') OR (c.estado IN ('oficial','emitido') AND c.entregado_at IS NULL)))
       AND NOT EXISTS (SELECT 1 FROM resultado r WHERE r.ot_id = o.id AND r.deleted_at IS NULL AND r.estado <> 'aprobado')`,
      "o.fecha_compromiso NULLS LAST",
      "'/ot/' || o.id || '?tab=informe'",
    ),
    extra: "ninguno",
  },
  ot_asignadas: {
    sql: filaOt(`o.estado NOT IN ${OT_TERMINADA}
       AND (EXISTS (SELECT 1 FROM ot_analista oa WHERE oa.ot_id = o.id AND oa.usuario_id = $3::uuid)
            OR EXISTS (SELECT 1 FROM resultado r WHERE r.ot_id = o.id AND r.asignado_a = $3::uuid AND r.deleted_at IS NULL))`),
    extra: "yo",
  },
  ot_sin_asignar: {
    sql: filaOt(`o.estado NOT IN ${OT_TERMINADA} AND NOT EXISTS (SELECT 1 FROM ot_analista oa WHERE oa.ot_id = o.id)`, "o.created_at", "'/ot/' || o.id || '?tab=asignacion'"),
    extra: "ninguno",
  },
  ot_cerradas_sin_factura: {
    sql: filaOt(`o.estado = 'cerrada' AND o.con_cobro
       AND NOT EXISTS (SELECT 1 FROM factura f WHERE f.ot_id = o.id AND f.deleted_at IS NULL AND f.estado <> 'anulada')`, "o.fecha_cierre"),
    extra: "ninguno",
  },
  documentos_por_entregar: {
    sql: docCert(`${OT_SCOPE} AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido') AND c.entregado_at IS NULL AND o.estado NOT IN ${OT_CERRADA}`),
    extra: "ninguno",
  },
  informes_por_oficializar: {
    sql: docCert(`c.estado = 'en_firma' AND c.deleted_at IS NULL AND c.tenant_id = COALESCE($1::uuid, c.tenant_id)
       AND ($2::uuid[] IS NULL OR c.unidad_id = ANY($2::uuid[]) OR (c.unidad_id IS NULL AND o.unidad_principal = ANY($2::uuid[])))`),
    extra: "ninguno",
  },
  resultados_por_revisar: { sql: porOt(`r.estado = 'capturado'`, "nada", "/captura-ot?estado=capturado&otId="), extra: "ninguno" },
  resultados_por_aprobar: { sql: porOt(`r.estado = 'revisado_n1'`, "nada", "/captura-ot?estado=revisado_n1&otId="), extra: "ninguno" },
  resultados_devueltos: { sql: porOt(`r.estado IN ('devuelto','rechazado') AND r.analista_id = $3::uuid`, "yo", "/captura-ot?estado=devuelto,rechazado&otId="), extra: "yo" },
  derivados_por_capturar: {
    sql: porOt(`r.estado IN ('pendiente','devuelto','rechazado') AND lr.derivado AND lr.oi_estado = 'recibida'`, "nada", "/captura-ot?estado=pendiente,devuelto,rechazado&otId="),
    extra: "ninguno",
  },
  cotizaciones_por_vencer: {
    sql: `SELECT c.id::text AS id, c.codigo AS texto, cl.razon_social AS detalle, '/cotizaciones/' || c.id AS ruta,
                 COALESCE(c.valida_hasta, c.expira_at)::date::text AS fecha
            FROM cotizacion c LEFT JOIN cliente cl ON cl.id = c.cliente_id
           WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id) AND c.estado IN ('abierta','enviada')
             AND COALESCE(c.valida_hasta, c.expira_at) BETWEEN ${HOY_CL} AND ${HOY_CL} + 7 AND ($2::uuid[] IS NULL OR TRUE)
           ORDER BY COALESCE(c.valida_hasta, c.expira_at)`,
    extra: "ninguno",
  },
  cotizaciones_aceptadas_sin_ot: {
    sql: `SELECT c.id::text AS id, c.codigo AS texto, cl.razon_social AS detalle, '/cotizaciones/' || c.id AS ruta, NULL::text AS fecha
            FROM cotizacion c LEFT JOIN cliente cl ON cl.id = c.cliente_id
           WHERE c.tenant_id = COALESCE($1::uuid, c.tenant_id) AND c.estado = 'aceptada' AND ($2::uuid[] IS NULL OR TRUE)
             AND NOT EXISTS (SELECT 1 FROM orden_trabajo o WHERE o.cotizacion_id = c.id)
           ORDER BY c.created_at`,
    extra: "ninguno",
  },
  encuestas_pendientes: {
    sql: `SELECT e.id::text AS id, COALESCE(o.codigo, 'Encuesta') AS texto, cl.razon_social AS detalle, '/encuestas?estado=pendiente' AS ruta, e.created_at::date::text AS fecha
            FROM encuesta_satisfaccion e LEFT JOIN orden_trabajo o ON o.id = e.ot_id LEFT JOIN cliente cl ON cl.id = o.cliente_id
           WHERE e.tenant_id = COALESCE($1::uuid, e.tenant_id) AND e.estado = 'pendiente' AND ($2::uuid[] IS NULL OR TRUE)
           ORDER BY e.created_at`,
    extra: "ninguno",
  },
  facturas_pendientes: {
    sql: `SELECT f.id::text AS id, COALESCE(f.numero, 'Factura') AS texto, concat_ws(' · ', 'OT ' || o.codigo, cl.razon_social) AS detalle,
                 '/facturas?estado=pendiente' AS ruta, f.created_at::date::text AS fecha
            FROM factura f LEFT JOIN orden_trabajo o ON o.id = f.ot_id LEFT JOIN cliente cl ON cl.id = f.cliente_id
           WHERE f.tenant_id = COALESCE($1::uuid, f.tenant_id) AND f.deleted_at IS NULL AND f.estado = 'pendiente' AND ($2::uuid[] IS NULL OR TRUE)
           ORDER BY f.created_at`,
    extra: "ninguno",
  },
  facturas_por_cobrar: {
    sql: `SELECT f.id::text AS id, COALESCE(f.numero, 'Factura') AS texto, concat_ws(' · ', cl.razon_social, f.estado) AS detalle,
                 '/facturas?estado=por_cobrar' AS ruta, f.fecha_vencimiento::text AS fecha
            FROM factura f LEFT JOIN cliente cl ON cl.id = f.cliente_id
           WHERE f.tenant_id = COALESCE($1::uuid, f.tenant_id) AND f.deleted_at IS NULL AND ($2::uuid[] IS NULL OR TRUE)
             AND f.estado IN ('emitida','parcial','aviso_1','aviso_2','aviso_3','prejudicial')
           ORDER BY f.fecha_vencimiento NULLS LAST`,
    extra: "ninguno",
  },
  lotes_por_inspeccionar: {
    sql: `SELECT i.id::text AS id, i.numero AS texto, concat_ws(' · ', 'OT ' || o.codigo, u.codigo) AS detalle, '/bpch/internaciones/' || i.id AS ruta, NULL::text AS fecha
            FROM bpch_internacion i JOIN orden_trabajo o ON o.id = i.ot_id LEFT JOIN unidad u ON u.id = i.unidad_inspeccion_id
           WHERE i.tenant_id = COALESCE($1::uuid, i.tenant_id) AND i.estado = 'ot_generada' AND o.estado NOT IN ${OT_TERMINADA}
             AND ($2::uuid[] IS NULL OR i.unidad_inspeccion_id = ANY($2::uuid[]))
             AND NOT EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL)
           ORDER BY i.created_at`,
    extra: "ninguno",
  },
  internaciones_por_analizar: {
    sql: `SELECT i.id::text AS id, i.numero AS texto, concat_ws(' · ', 'Res. ' || i.resolucion_numero, u.codigo) AS detalle, '/bpch/internaciones/' || i.id AS ruta, NULL::text AS fecha
            FROM bpch_internacion i LEFT JOIN unidad u ON u.id = i.unidad_inspeccion_id
           WHERE i.tenant_id = COALESCE($1::uuid, i.tenant_id) AND i.estado IN ('registrada', 'antecedentes_pendientes')
             AND ($2::uuid[] IS NULL OR i.unidad_inspeccion_id = ANY($2::uuid[])
                  OR EXISTS (SELECT 1 FROM unidad s WHERE s.codigo = 'SCC' AND s.tenant_id = i.tenant_id AND s.id = ANY($2::uuid[])))
           ORDER BY i.created_at`,
    extra: "ninguno",
  },
  nc_abiertas: {
    sql: `SELECT nc.id::text AS id, COALESCE(nc.codigo, 'NC') AS texto, nc.estado AS detalle, '/no-conformidades' AS ruta, nc.created_at::date::text AS fecha
            FROM no_conformidad nc
           WHERE nc.tenant_id = COALESCE($1::uuid, nc.tenant_id) AND nc.estado IN ('abierta','en_proceso','verificacion','reabierta')
             AND ($2::uuid[] IS NULL OR nc.unidad_id IS NULL OR nc.unidad_id = ANY($2::uuid[]))
           ORDER BY nc.created_at`,
    extra: "ninguno",
  },
};

/** Las vencidas de un laboratorio (tarjetas «OT vencidas · LAB»). */
export const LISTA_VENCIDAS_LAB = filaOt(`o.estado NOT IN ${OT_CERRADA} AND o.fecha_compromiso < ${HOY_CL} AND u.codigo = $3`);

export const MAX_ELEMENTOS = 5;
