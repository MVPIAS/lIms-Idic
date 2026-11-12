-- =============================================================================
-- LIMS IDIC · fx5-c · Correcciones del recorrido de manuales v4 (BPCH y D11/SAEC)
-- =============================================================================
-- Aditivo e idempotente (IF NOT EXISTS / ON CONFLICT DO NOTHING). Sin DROP ni
-- borrado de datos. Va en ORDEN_SQL.txt justo antes de align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- F010 / F017 / F088 · Unidad del tamaño del lote: además de Kilos y Toneladas,
-- «Unidades» (productos contados por pieza o envase) y «Pares» (vestuario y
-- calzado). «Pares» también para la muestra, para comparar lote y muestra en la
-- misma unidad. Son listas de Catálogo › Parámetros: el IDIC puede desactivarlas.
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
  ('unidad_tamano_lote',    'unidades', 'Unidades', 3),
  ('unidad_tamano_lote',    'pares',    'Pares',    4),
  ('unidad_tamano_muestra', 'pares',    'Pares',    5)
 ) AS v(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

COMMENT ON COLUMN bpch_cabecera_ot.unidad_lote IS 'Unidad del tamaño del lote (lista unidad_tamano_lote: kilos, toneladas, unidades, pares).';
COMMENT ON COLUMN bpch_cabecera_ot.unidad_muestra IS 'Unidad del tamaño de la muestra (lista unidad_tamano_muestra: toneladas, kilos, gramos, unidades, pares).';

-- -----------------------------------------------------------------------------
-- F020 · Mismo nombre del tipo de documento en todas las pantallas: la ruta y
-- la lista dicen «Certificado de control»; el título del documento SCCII decía
-- solo «INFORME DE INSPECCIÓN». Se actualiza el título de la plantilla (la
-- versión anterior queda RETIRADA y la nueva VIGENTE con origen «script» al
-- llamar plantilla_sincronizar_versiones() en align_cierre_permisos.sql).
-- -----------------------------------------------------------------------------
UPDATE plantilla_informe
   SET cuerpo_html = replace(cuerpo_html, '<h1>INFORME DE INSPECCIÓN</h1>', '<h1>CERTIFICADO DE CONTROL (INFORME DE INSPECCIÓN)</h1>')
 WHERE repid = 'SCCII'
   AND cuerpo_html LIKE '%<h1>INFORME DE INSPECCIÓN</h1>%';
