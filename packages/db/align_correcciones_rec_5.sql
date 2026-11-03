-- =============================================================================
-- Correcciones del recorrido de manuales · 5 · BPCH, Delegación Nº 11 / SAEC
-- y Metrología
--
--   1 · Nombre del analito «Permisibidad» (IT05 de la Delegación Nº 11): falta
--       «li». Se corrige el NOMBRE que se muestra; el código (clave de la
--       migración) no cambia.
--   2 · Bitácora de correos sin servidor de correo (ver abajo).
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt).
-- =============================================================================

UPDATE cat_analito SET nombre = 'Permisibilidad' WHERE nombre = 'Permisibidad';

--   2 · Bitácora de correos: los envíos de certificados, informes y documentos
--       que fallaron por no haber servidor de correo quedaron «error»; pasan a
--       «sin_configurar» («Sin servidor de correo»), el mismo criterio que el
--       correo libre y los avisos (avisos/reglas-avisos.ts · estadoCorreo).

UPDATE correo_enviado SET estado = 'sin_configurar'
 WHERE estado = 'error'
   AND error ~* '(configuraci[oó]n de correo|inactiva|host SMTP)';
