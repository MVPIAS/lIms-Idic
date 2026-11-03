-- =============================================================================
-- Correcciones del recorrido de manuales · 5 · BPCH, Delegación Nº 11 / SAEC
-- y Metrología
--
--   1 · Nombre del analito «Permisibidad» (IT05 de la Delegación Nº 11): falta
--       «li». Se corrige el NOMBRE que se muestra; el código (clave de la
--       migración) no cambia.
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt).
-- =============================================================================

UPDATE cat_analito SET nombre = 'Permisibilidad' WHERE nombre = 'Permisibidad';
