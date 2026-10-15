-- =============================================================================
-- align_ajustes_1510.sql · Ajustes del 15-10-2026 · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE.
--
-- 1. Planificación y Control no tenía `flujo.ver`: en el expediente de la OT el
--    selector «Iniciar flujo» le salía vacío aunque su rol puede adjuntar el
--    flujo de trabajo a la orden (detectado al reescribir los manuales).
-- =============================================================================

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'flujo.ver'
 WHERE r.codigo = 'PLANIFICACION'
ON CONFLICT DO NOTHING;
