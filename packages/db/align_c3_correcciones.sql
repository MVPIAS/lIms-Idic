-- =============================================================================
-- LIMS IDIC · Frente c3 · Correcciones del recorrido de los manuales de proceso
-- (comercial, facturación, formularios, captura y transversal) · Aiuken
-- =============================================================================
-- Cada bloque lleva el ID del backlog (Backlog_Correcciones_Recorrido_Aiuken.xlsx).
-- Aditivo e idempotente: una pasada deja lo mismo que dos. Va ANTES de
-- align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B-030 · Fechas
--   a) La preparación del LQA y del LMB registra fecha Y hora (EP-02 3.1).
--      Solo se cambia el campo que sigue con el tipo de fábrica («fecha»).
--   b) La fecha de ingreso de la OT elegida en un calendario se guardó como
--      medianoche UTC (= 21:00 del día anterior en Chile) y el certificado de
--      Metrología imprimía el día anterior. Se lleva a las 12:00 de Chile del
--      mismo día. Una vez corregida deja de ser medianoche UTC: idempotente.
-- -----------------------------------------------------------------------------
UPDATE parametro_sistema
   SET valor = jsonb_set(valor::jsonb, '{tipo}', '"fechahora"')::text
 WHERE categoria = 'preparacion_campo'
   AND codigo IN ('LQA.fecha', 'LMB.fecha')
   AND valor::jsonb->>'tipo' = 'fecha';

UPDATE orden_trabajo
   SET fecha_recepcion = (((fecha_recepcion AT TIME ZONE 'UTC')::date + time '12:00') AT TIME ZONE 'America/Santiago')
 WHERE fecha_recepcion IS NOT NULL
   AND fecha_recepcion = date_trunc('day', fecha_recepcion AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
