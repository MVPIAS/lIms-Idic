-- =============================================================================
-- LIMS IDIC · Normas de ejemplo · DATOS DE DEMOSTRACIÓN · Aiuken
-- =============================================================================
-- SOLO demo (ORDEN_SQL.txt: etiqueta «demo», justo después de schema.sql): datos
-- INVENTADOS para la base de demostración y preproducción. Nunca en la base real
-- del IDIC: la instalación «sin-demo» deja la estructura sin estas filas.
-- 11 normas genéricas (NCh, ASTM, AOAC) escogidas como ejemplo; el catálogo de
-- normas del IDIC no está aún (lo entrega el IDIC con la migración).
-- Separado de schema.sql el 24-10-2026 (arranque «sin-demo» limpio). Idempotente:
-- una pasada deja lo mismo que dos.
-- =============================================================================

-- Normas referenciales más usadas (extraídas del análisis)
INSERT INTO norma (codigo, nombre, organismo, ano) VALUES
  ('NCh-ISO/IEC 17025', 'Requisitos generales para la competencia de laboratorios', 'INN', 2017),
  ('NCh 624',        'Cuero - Determinación de resistencia a la tracción y alargamiento', 'INN', 2017),
  ('NCh 622',        'Cuero - Determinación de la resistencia al desgarramiento', 'INN', 2010),
  ('NCh 1206',       'Cuero - Determinación de cenizas', 'INN', 2014),
  ('NCh 841',        'Productos alimenticios - Determinación de humedad', 'INN', 2018),
  ('NCh 842',        'Productos alimenticios - Determinación de cenizas', 'INN', 2018),
  ('NCh 95',         'Productos alimenticios - Determinación de acidez', 'INN', 1981),
  ('NCh 3547',       'Productos alimenticios - Determinación de materia grasa', 'INN', 2018),
  ('ASTM E18',       'Hardness of Metallic Materials - Rockwell', 'ASTM', 2022),
  ('ASTM D5185',     'Multielement Determination of Used and Unused Lubricating Oils', 'ASTM', 2018),
  ('AOAC 979.08',    'Caffeine in Tea, HPLC', 'AOAC', 2019)
ON CONFLICT (codigo) DO NOTHING;
