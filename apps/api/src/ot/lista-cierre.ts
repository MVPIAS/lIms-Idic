/**
 * Condiciones SQL comunes de «OT lista para cerrar» y «OT con analista» · B-017
 * (recorrido MP-04, D04-18): la tarjeta de Mi bandeja, el filtro de la lista de
 * OT (/ot?listasCierre=1, /ot?sinAsignar=1) y la Ruta de la OT dicen lo mismo,
 * también en la OT de calibración (certificados de calibración, informes técnicos y
 * certificados externos validados de los no calibrables, e instrumentos).
 * El alias de la orden de trabajo es `o`.
 */
import { SQL_ZONA } from "../common/fecha-chile";

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
  -- Lote 4: «No ejecutado» (cierre por incumplimiento) tampoco deja nada pendiente.
  AND NOT EXISTS (SELECT 1 FROM resultado r WHERE r.ot_id = o.id AND r.deleted_at IS NULL AND r.estado NOT IN ('aprobado','no_ejecutado'))
  -- IDIC-PG 24 Anexo 03: internación sujeta a la tasa con la tasa remitida a facturación (bpch/internacion/cierre-tasa.ts).
  AND NOT EXISTS (SELECT 1 FROM bpch_internacion bi WHERE bi.ot_id = o.id AND bi.estado <> 'anulada' AND bi.sujeta_tasa AND bi.remitida_dco_at IS NULL)
  -- Metrología (EP-04): certificados de calibración emitidos y entregados; instrumentos recibidos, calibrados y devueltos.
  AND NOT EXISTS (SELECT 1 FROM met_calibracion mc WHERE mc.ot_id = o.id AND mc.deleted_at IS NULL
                    AND (mc.estado IN ('borrador','calculada','en_revision','en_firma') OR (mc.estado = 'emitida' AND mc.entregado_at IS NULL)))
  AND NOT EXISTS (SELECT 1 FROM met_informe_tecnico mit WHERE mit.ot_id = o.id AND mit.estado = 'emitido' AND mit.entregado_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM met_servicio_externo mse WHERE mse.ot_id = o.id AND mse.estado = 'validado' AND mse.entregado_at IS NULL)
  -- D04-31: ningún servicio externo a medio camino (como el cierre técnico y el final).
  AND NOT EXISTS (SELECT 1 FROM met_servicio_externo mse WHERE mse.ot_id = o.id AND mse.estado IN ('solicitado','aprobado','enviado'))
  -- D04-31: con no_apto_exige_documento = sí, cada no calibrable con su informe técnico emitido o su externo validado.
  AND NOT (COALESCE((SELECT lower(trim(ps.valor)) IN ('si','sí','s','true','1') FROM parametro_sistema ps
                      WHERE ps.tenant_id = o.tenant_id AND ps.categoria = 'metrologia_ficha' AND ps.codigo = 'no_apto_exige_documento' AND ps.activo), FALSE)
           AND EXISTS (SELECT 1 FROM met_ot_instrumento i WHERE i.ot_id = o.id
                         AND (i.estado = 'no_apto' OR (i.estado = 'devuelto' AND i.calibrable = FALSE))
                         AND NOT EXISTS (SELECT 1 FROM met_informe_tecnico mit WHERE mit.ot_instrumento_id = i.id AND mit.estado = 'emitido')
                         AND NOT EXISTS (SELECT 1 FROM met_servicio_externo mse WHERE mse.ot_instrumento_id = i.id AND mse.estado = 'validado')))
  AND NOT EXISTS (SELECT 1 FROM met_ot_instrumento i WHERE i.ot_id = o.id
                    AND (i.estado = 'por_recibir'
                         OR (i.estado = 'recibido' AND NOT EXISTS (SELECT 1 FROM met_calibracion mc WHERE mc.ot_instrumento_id = i.id AND mc.deleted_at IS NULL AND mc.estado <> 'reemplazada'))
                         OR (i.estado IN ('recibido','no_apto') AND COALESCE((SELECT lower(trim(ps.valor)) NOT IN ('no','n','false','0') FROM parametro_sistema ps
                               WHERE ps.tenant_id = o.tenant_id AND ps.categoria = 'metrologia' AND ps.codigo = 'cierre_exige_devolucion' AND ps.activo), TRUE))))`;

/** La OT tiene a alguien asignado: analista de la OT o metrólogo de alguno de sus instrumentos. */
export const SQL_OT_CON_ANALISTA = `
  (EXISTS (SELECT 1 FROM ot_analista oa WHERE oa.ot_id = o.id)
   OR EXISTS (SELECT 1 FROM met_ot_instrumento mi WHERE mi.ot_id = o.id AND mi.metrologo_id IS NOT NULL AND mi.estado <> 'anulado'))`;

/**
 * Día (en Chile) en que la OT quedó TERMINADA: el de la última entrega de sus
 * documentos oficiales (informes, certificados de calibración) o, si es
 * posterior, la recepción en el DCO. NULL si no hay nada entregado.
 */
export const SQL_OT_TERMINADA_EL = `GREATEST(
    (SELECT (max(c.entregado_at) AT TIME ZONE ${SQL_ZONA})::date FROM certificado c
      WHERE c.ot_id = o.id AND c.deleted_at IS NULL AND c.estado IN ('oficial','emitido')),
    (SELECT (max(mc.entregado_at) AT TIME ZONE ${SQL_ZONA})::date FROM met_calibracion mc
      WHERE mc.ot_id = o.id AND mc.deleted_at IS NULL AND mc.estado = 'emitida'),
    o.fecha_recep_dco)`;

/** Parámetro ot_cierre.dias_cierre del tenant de la OT (1–60; 10 por defecto, IDIC-PG03). */
export const SQL_DIAS_CIERRE = `COALESCE((SELECT CASE WHEN btrim(p.valor) ~ '^[0-9]{1,2}$' AND btrim(p.valor)::int BETWEEN 1 AND 60 THEN btrim(p.valor)::int END
    FROM parametro_sistema p WHERE p.tenant_id = o.tenant_id AND p.categoria = 'ot_cierre' AND p.codigo = 'dias_cierre' AND p.activo LIMIT 1), 10)`;

/**
 * Lote 4 · IDIC-PG03: OT terminada (lista para cerrar) que pasó el plazo de
 * cierre: más días HÁBILES (lunes a viernes; los feriados no se descuentan)
 * que ot_cierre.dias_cierre desde que quedó terminada.
 */
export const SQL_OT_CIERRE_ATRASADO = `
  ${SQL_OT_LISTA_PARA_CERRAR}
  AND ${SQL_OT_TERMINADA_EL} IS NOT NULL
  AND (SELECT count(*) FROM generate_series(${SQL_OT_TERMINADA_EL} + 1, (now() AT TIME ZONE ${SQL_ZONA})::date, interval '1 day') g
        WHERE extract(isodow FROM g) < 6) > ${SQL_DIAS_CIERRE}`;
