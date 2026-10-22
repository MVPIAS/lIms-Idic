-- =============================================================================
-- align_r1g_recorrido.sql · Correcciones del recorrido en pantalla MP-02 / MP-06
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt. Reglas: docs/FLUJO_R1G_RECORRIDO.md.
--
--   1. lims_lab_de_resultado(resultado): laboratorio dueño de cada ensayo de una
--      OT. Un ensayo derivado por orden interna (no anulada) es del laboratorio
--      de DESTINO; los demás, del laboratorio responsable de la OT. Lo usan la
--      captura, la revisión, la aprobación y sus bandejas (D02-02, D02-04).
--   2. Parámetros (Catálogo › Parámetros; ON CONFLICT no pisa ediciones):
--      · captura_ld.indeterminado: veredicto de un «< LD» que no se puede
--        decidir contra el requisito (D02-03). Por defecto «pendiente»: lo
--        decide el revisor y bloquea la aprobación hasta entonces.
--      · segregacion_resultado.revisor_aprobador: revisión y aprobación por
--        personas distintas (D06-05). «distintas» por defecto; «excepciones»
--        lista los laboratorios de dos personas (vacía: no hay casos
--        documentados para resultados).
--      · ot_plazo.internacion_dias: plazo de la OT de internación para su fecha
--        de compromiso (D06-09). 10 días corridos por defecto (por confirmar).
-- =============================================================================

-- --- 1 · Laboratorio dueño de un ensayo ---------------------------------------
-- Destino de la orden interna: cat_familia → unidad por CODSUCDEL (la unidad
-- puede declarar varios códigos «7003/7004»; prima la de tipo LABORATORIO),
-- igual que flujo-real.module.ts (captura del destino, r1b).
CREATE OR REPLACE FUNCTION lims_lab_de_resultado(p_resultado UUID)
RETURNS TABLE (unidad_id UUID, principal_id UUID, orden_interna_id UUID, oi_numero TEXT, oi_estado TEXT, derivado BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT r.id, r.muestra_id, r.cat_metodo_id, m.tenant_id, COALESCE(r.ot_id, m.ot_id) AS ot_id
      FROM resultado r JOIN muestra m ON m.id = r.muestra_id
     WHERE r.id = p_resultado
  ), d AS (
    SELECT ud.id AS unidad_id, oi.id, oi.numero::text AS numero, oi.estado::text AS estado
      FROM r
      JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
      JOIN orden_interna oi ON oi.ot_id = r.ot_id AND oi.tenant_id = r.tenant_id
                           AND oi.deleted_at IS NULL AND oi.estado <> 'anulada'
                           AND cm.ensayo_id = ANY(oi.ensayos)
                           AND (oi.muestra_id IS NULL OR oi.muestra_id = r.muestra_id)
      JOIN cat_familia f ON f.id = oi.destino_lab
      JOIN LATERAL (
        SELECT u.id FROM unidad u
         WHERE u.tenant_id = f.tenant_id AND u.activa
           AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\s,;]', '/', 'g'), '/'))
         ORDER BY (u.tipo = 'LABORATORIO') DESC, u.codigo
         LIMIT 1) ud ON TRUE
     ORDER BY (oi.estado = 'recibida') DESC, oi.created_at DESC
     LIMIT 1
  )
  SELECT COALESCE(d.unidad_id, o.unidad_principal), o.unidad_principal, d.id, d.numero, d.estado, d.id IS NOT NULL
    FROM r
    JOIN orden_trabajo o ON o.id = r.ot_id
    LEFT JOIN d ON TRUE;
$$;

COMMENT ON FUNCTION lims_lab_de_resultado(UUID) IS
  'Laboratorio dueño del ensayo: el destino de la orden interna (no anulada) que lo deriva o, si no, el responsable de la OT. Ver docs/FLUJO_R1G_RECORRIDO.md.';

CREATE INDEX IF NOT EXISTS idx_orden_interna_ot_vivas ON orden_interna (ot_id) WHERE deleted_at IS NULL AND estado <> 'anulada';

-- --- 2 · Parámetros por defecto ----------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('captura_ld', 'indeterminado',
   'Veredicto de un resultado «< LD» que no se puede decidir contra el requisito (pendiente | no_cumple | cumple)', 1, 'pendiente'),
  ('segregacion_resultado', 'revisor_aprobador',
   'Revisión y aprobación de un resultado por personas distintas (distintas | misma_persona)', 1, 'distintas'),
  ('segregacion_resultado', 'excepciones',
   'Laboratorios donde la misma persona puede revisar y aprobar (códigos separados por coma; vacío = ninguno)', 2, ''),
  ('ot_plazo', 'internacion_dias',
   'Plazo de la OT de internación, en días corridos desde que nace (fecha de compromiso)', 1, '10')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 3 · Temperatura de llegada en la recepción de la Sección Alimentos --------
-- EP-02 1.2 (recorrido MP-02, D02-10). Opcional: en qué productos es obligatoria
-- está POR CONFIRMAR con el IDIC (refrigerados / congelados); se marca obligatoria
-- en Catálogo › Parámetros cuando se confirme.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'recepcion_campo', v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('LQA.temperatura_llegada', 'Temperatura de llegada (°C)', 4, '{"tipo":"numero","ayuda":"Obligatoria en productos refrigerados o congelados (por confirmar con el IDIC)."}'),
  ('LMB.temperatura_llegada', 'Temperatura de llegada (°C)', 4, '{"tipo":"numero","ayuda":"Obligatoria en productos refrigerados o congelados (por confirmar con el IDIC)."}'),
  ('LES.temperatura_llegada', 'Temperatura de llegada (°C)', 4, '{"tipo":"numero","ayuda":"Obligatoria en productos refrigerados o congelados (por confirmar con el IDIC)."}')
 ) AS v(codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 4 · Registro de pago: boletín de ingreso y medio de pago de una lista -----
-- EP-00 8.4 / EP-06 6.22 (recorrido MP-02, D02-13). La lista se mantiene en
-- Catálogo › Parámetros (categoría medio_pago).
ALTER TABLE pago ADD COLUMN IF NOT EXISTS numero_boletin VARCHAR(40);
COMMENT ON COLUMN pago.numero_boletin IS 'Nº del boletín de ingreso de Tesorería (EP-00 8.4).';
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'medio_pago', v.codigo, v.etiqueta, v.orden, NULL
  FROM tenant t
 CROSS JOIN (VALUES
  ('caja', 'Caja (efectivo)', 1),
  ('transferencia', 'Transferencia bancaria', 2),
  ('deposito', 'Depósito bancario', 3),
  ('cheque', 'Cheque', 4),
  ('vale_vista', 'Vale vista', 5),
  ('tarjeta', 'Tarjeta de débito o crédito', 6),
  ('descuento_planilla', 'Descuento por planilla (institucional)', 7)
 ) AS v(codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 5 · Ficha del cliente: forma de pago habitual y contacto principal ---------
-- EP-00 0.1 (recorrido MP-02, D02-16). Giro y dirección ya existían (solo en la
-- API): ahora están en el formulario. Forma de pago = código de la lista forma_pago.
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS forma_pago_habitual VARCHAR(30);
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS contacto_nombre     VARCHAR(160);
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS contacto_cargo      VARCHAR(120);
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS contacto_email      VARCHAR(160);
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS contacto_telefono   VARCHAR(40);
COMMENT ON COLUMN cliente.forma_pago_habitual IS 'Código de parametro_sistema forma_pago (EP-00 0.1).';

-- --- 6 · Documentación de la tasa de internación ------------------------------
-- EP-06 6.8 (recorrido MP-06, D06-03): al registrar la recepción de la
-- documentación se anotan el CIF, el tipo de cambio, el IVA de internación y los
-- otros documentos recibidos (transporte, Declaración de Ingreso…). El CIF y el
-- tipo de cambio se proponen luego en el cálculo de la tasa. Los adjuntos como
-- fichero quedan para el gestor documental (pendiente).
ALTER TABLE bpch_internacion ADD COLUMN IF NOT EXISTS doc_cif_usd         NUMERIC(14,2);
ALTER TABLE bpch_internacion ADD COLUMN IF NOT EXISTS doc_tipo_cambio     NUMERIC(12,4);
ALTER TABLE bpch_internacion ADD COLUMN IF NOT EXISTS doc_iva_internacion NUMERIC(14,2);
ALTER TABLE bpch_internacion ADD COLUMN IF NOT EXISTS doc_otros           TEXT;
