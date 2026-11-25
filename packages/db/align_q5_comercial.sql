-- =============================================================================
-- align_q5_comercial.sql · Respuestas del IDIC del 24-11-2026 (checklist,
-- pestaña «Comercial SVT») · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: una pasada deja la misma base que dos. No borra nada ni
-- pisa lo que el IDIC ya editó desde las pantallas. Va ANTES de
-- align_cierre_permisos.sql (ver ORDEN_SQL.txt). No crea permisos.
--
--   1. SVT 15 · Texto base de «Condiciones adicionales» de Metrología (LMT, LMT
--      Área Eléctrica), del LNF (cotizaciones de calibración) y del LRB. Se
--      precarga en la cotización al elegir el laboratorio y el ejecutivo lo
--      puede editar. Solo se escribe si el laboratorio no tiene texto.
--   2. SVT 30 · Precio institucional: Ejército, Carabineros, Fuerza Aérea,
--      Armada, PDI y Gendarmería pagan el costo directo de la lista vigente
--      (parámetro circuito_cotizacion.tipos_precio_institucional). El IVA de
--      estas instituciones queda como está hasta que el IDIC lo aclare.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Condiciones adicionales por laboratorio (centro_costo.condiciones_base)
-- ---------------------------------------------------------------------------
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS condiciones_base TEXT;

UPDATE centro_costo cc
   SET condiciones_base = v.texto
  FROM (VALUES
    ('LMT-001', 'La presente cotización, se rige por las condiciones generales para la calibración de equipos e instrumentos, las cuales se adjuntan y serán consideradas aceptadas al aprobar esta cotización.'),
    ('LMT-AE',  'La presente cotización, se rige por las condiciones generales para la calibración de equipos e instrumentos, las cuales se adjuntan y serán consideradas aceptadas al aprobar esta cotización.'),
    ('LNF-001', 'La presente cotización, se rige por las condiciones generales para la calibración de equipos e instrumentos, las cuales se adjuntan y serán consideradas aceptadas al aprobar esta cotización.'),
    ('LRB-001', 'La presente cotización, se rige por las condiciones generales para los ensayos de resistencia balística, las cuales se adjuntan y serán consideradas aceptadas al aprobar esta cotización.')
  ) AS v(codigo, texto)
 WHERE cc.codigo = v.codigo
   AND COALESCE(btrim(cc.condiciones_base), '') = '';

-- ---------------------------------------------------------------------------
-- 2. Tipos de cliente con precio institucional (costo directo)
-- ---------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, 90, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('circuito_cotizacion', 'tipos_precio_institucional', 'Tipos de cliente con precio institucional (costo directo)', 'ejercito,carabineros,fuerza_aerea,armada,pdi,gendarmeria')
 ) AS v(categoria, codigo, etiqueta, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
