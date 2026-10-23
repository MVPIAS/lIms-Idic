-- =============================================================================
-- LIMS IDIC · Frente c1 (permisos, alcance, OT y bandejas) · correcciones del
-- recorrido de los manuales de proceso v2.0 (23-10-2026) · Aiuken
-- =============================================================================
-- ADITIVO e IDEMPOTENTE: una pasada deja lo mismo que dos. Va ANTES de
-- align_cierre_permisos.sql (que siempre es el último de ORDEN_SQL.txt).
-- Cada bloque indica el fallo del backlog (B-nnn) que corrige.
-- =============================================================================

-- --- B-010 · plazo por defecto de toda OT -------------------------------------
-- ot/plazo-defecto.ts: laboratorio (ot_plazo_laboratorio.<LAB>) > origen
-- (ot_plazo.<origen>_dias) > ot_plazo.defecto_dias. Valores POR CONFIRMAR con
-- el IDIC (carta de consultas MET-09): 10 días corridos, como la internación.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'ot_plazo', v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('defecto_dias', 'Plazo por defecto de la OT, en días corridos desde que nace (fecha de compromiso)', 0, '10'),
  ('produccion_nacional_dias', 'Plazo de la OT de Producción Nacional, en días corridos desde que nace', 2, '10'),
  ('prototipo_dias', 'Plazo de la OT de prototipo, en días corridos desde que nace', 3, '10'),
  ('reinspeccion_dias', 'Plazo de la OT de reinspección, en días corridos desde que nace', 4, '10')
 ) AS v(codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- B-015 · Comercial abre la ficha de la calibración para entregarla ---------
-- EP-04 P8.1 y FLUJO_METROLOGIA §9.2: Comercial (DCO) entrega y envía por correo
-- el certificado de calibración (certificado.entregar). Sin metrologia.ver la
-- ficha daba 403. Lectura solamente: registrar, firmar y emitir siguen en
-- metrologia.crear / metrologia.emitir. La entrega de ARMAS sigue siendo de la
-- D11 (custodia y salida por código de barras, EP-11 11.27): se corrige el manual.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT r.id, p.id
  FROM rol r JOIN permiso p ON p.codigo = 'metrologia.ver'
 WHERE COALESCE(r.alias_de, r.codigo) = 'COMERCIAL'
ON CONFLICT DO NOTHING;
