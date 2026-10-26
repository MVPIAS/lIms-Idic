-- =============================================================================
-- LIMS IDIC · Frente f7 · Correcciones del recorrido de manuales v2.2 · Aiuken
-- =============================================================================
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql (ORDEN_SQL.txt).
--
-- D04-31 · El cierre técnico de la OT de Metrología exige lo mismo que el cierre
--   final en lo técnico (regla de la API: metrologia-ot.reglas.ts ›
--   faltantesCierreTecnico / faltantesMetrologia). No cambia el esquema.
--   El parámetro metrologia_ficha.no_apto_exige_documento (por defecto «no»)
--   ahora lo aplican el cierre técnico, el cierre final y la Ruta de la OT:
--   se actualiza su rótulo, solo si sigue con el texto original (no se pisa
--   un rótulo cambiado por Administración).
--
-- D02-45, D04-32 y D01-24 son de pantalla o de la API: sin SQL.
-- =============================================================================

UPDATE parametro_sistema
   SET etiqueta = 'El cierre de la OT (técnico y final) exige el informe técnico emitido o el servicio externo validado del ítem no calibrable (si / no)'
 WHERE categoria = 'metrologia_ficha'
   AND codigo = 'no_apto_exige_documento'
   AND etiqueta = 'El cierre técnico exige informe técnico o servicio externo del ítem no apto (si / no)';
