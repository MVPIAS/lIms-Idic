/**
 * Condiciones SQL comunes de «OT lista para cerrar» y «OT con analista» · B-017
 * (recorrido MP-04, D04-18): la tarjeta de Mi bandeja, el filtro de la lista de
 * OT (/ot?listasCierre=1, /ot?sinAsignar=1) y la Ruta de la OT dicen lo mismo,
 * también en la OT de calibración (certificados de calibración, informes técnicos y
 * certificados externos validados de los no calibrables, e instrumentos).
 * El alias de la orden de trabajo es `o`.
 */

/** La OT tiene sus documentos oficiales y entregados y nada pendiente: falta cerrarla. */
export const SQL_OT_LISTA_PARA_CERRAR = `
  o.estado NOT IN ('cerrada','anulada')
  -- D04-29: la OT de calibración (con instrumentos) está lista para cerrar tras su cierre técnico (finalizada).
  AND (o.estado IN ('finalizada','informada')
       OR NOT EXISTS (SELECT 1 FROM met_ot_instrumento i0 WHERE i0.ot_id = o.id AND i0.estado <> 'anulado'))
  AND (EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido'))
       OR EXISTS (SELECT 1 FROM met_calibracion mc WHERE mc.ot_id = o.id AND mc.deleted_at IS NULL AND mc.estado = 'emitida')
       -- Decisión 24-10: informe técnico emitido y certificado externo validado del no calibrable.
       OR EXISTS (SELECT 1 FROM met_informe_tecnico mit WHERE mit.ot_id = o.id AND mit.estado = 'emitido')
       OR EXISTS (SELECT 1 FROM met_servicio_externo mse WHERE mse.ot_id = o.id AND mse.estado = 'validado'))
  AND NOT EXISTS (SELECT 1 FROM certificado c WHERE c.ot_id = o.id AND c.deleted_at IS NULL
                    AND (c.estado IN ('en_firma','devuelto') OR (c.estado IN ('oficial','emitido') AND c.entregado_at IS NULL)))
  AND NOT EXISTS (SELECT 1 FROM resultado r WHERE r.ot_id = o.id AND r.deleted_at IS NULL AND r.estado <> 'aprobado')
  -- Metrología (EP-04): certificados de calibración emitidos y entregados; instrumentos recibidos, calibrados y devueltos.
  AND NOT EXISTS (SELECT 1 FROM met_calibracion mc WHERE mc.ot_id = o.id AND mc.deleted_at IS NULL
                    AND (mc.estado IN ('borrador','calculada','en_revision','en_firma') OR (mc.estado = 'emitida' AND mc.entregado_at IS NULL)))
  AND NOT EXISTS (SELECT 1 FROM met_informe_tecnico mit WHERE mit.ot_id = o.id AND mit.estado = 'emitido' AND mit.entregado_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM met_servicio_externo mse WHERE mse.ot_id = o.id AND mse.estado = 'validado' AND mse.entregado_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM met_ot_instrumento i WHERE i.ot_id = o.id
                    AND (i.estado = 'por_recibir'
                         OR (i.estado = 'recibido' AND NOT EXISTS (SELECT 1 FROM met_calibracion mc WHERE mc.ot_instrumento_id = i.id AND mc.deleted_at IS NULL AND mc.estado <> 'reemplazada'))
                         OR (i.estado IN ('recibido','no_apto') AND COALESCE((SELECT lower(trim(ps.valor)) NOT IN ('no','n','false','0') FROM parametro_sistema ps
                               WHERE ps.tenant_id = o.tenant_id AND ps.categoria = 'metrologia' AND ps.codigo = 'cierre_exige_devolucion' AND ps.activo), TRUE))))`;

/** La OT tiene a alguien asignado: analista de la OT o metrólogo de alguno de sus instrumentos. */
export const SQL_OT_CON_ANALISTA = `
  (EXISTS (SELECT 1 FROM ot_analista oa WHERE oa.ot_id = o.id)
   OR EXISTS (SELECT 1 FROM met_ot_instrumento mi WHERE mi.ot_id = o.id AND mi.metrologo_id IS NOT NULL AND mi.estado <> 'anulado'))`;
