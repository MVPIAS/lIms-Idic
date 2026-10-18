-- =============================================================================
-- align_revision_r3.sql · Correcciones de la revisión de código de la ronda 3
-- -----------------------------------------------------------------------------
--   1. Metrología (hallazgo 4): cada firma del circuito se identifica por
--      (orden, acción). La firma ELABORA del metrólogo nunca ocupa el lugar de
--      un paso de jefe con el mismo orden; la unicidad pasa de
--      (calibracion_id, orden) a (calibracion_id, orden, accion). Sigue
--      impidiendo que dos personas firmen el MISMO paso a la vez.
--   2. Recepción de muestras (hallazgo 13): corregir la recepción conserva
--      quién y cuándo la registró y anota aparte quién la corrigió y cuándo.
-- Aditivo e idempotente. Requiere align_metrologia_1510.sql y
-- align_quimicos_recepcion_calculo.sql.
-- =============================================================================

-- 1 · Firmas del Certificado de Calibración: un paso = (orden, acción)
CREATE UNIQUE INDEX IF NOT EXISTS ux_met_cal_firma_paso ON met_calibracion_firma (calibracion_id, orden, accion);
ALTER TABLE met_calibracion_firma DROP CONSTRAINT IF EXISTS met_calibracion_firma_calibracion_id_orden_key;

-- 2 · Corrección de la recepción de una muestra (quién y cuándo, sin pisar la recepción original)
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS recepcion_corregida_por UUID REFERENCES usuario(id);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS recepcion_corregida_at  TIMESTAMPTZ;
COMMENT ON COLUMN muestra.recepcion_corregida_por IS 'Último usuario que corrigió la recepción (recepcionada_por/_at no cambian al corregir)';
COMMENT ON COLUMN muestra.recepcion_corregida_at  IS 'Cuándo se corrigió por última vez la recepción';

-- 3 · Reaplicar los SQL deja la misma base que aplicarlos una vez (base construida desde cero,
--     con una segunda pasada). Corrige en las bases ya afectadas lo que la segunda pasada
--     de align_admin_roles.sql y align_metrologia_flujo.sql cambiaba (ambos ya corregidos):
--   a) costos reales: la gestión es solo del Jefe de Laboratorio; el Jefe de Sección no
--      participa (pedido del Depto. Químico) y el Jefe de Departamento solo la ve.
DELETE FROM rol_permiso rp
 USING rol r, permiso p
 WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
   AND ((COALESCE(r.alias_de, r.codigo) = 'JEFE_SECCION' AND p.codigo IN ('costo_real.ver', 'costo_real.gestionar'))
     OR (COALESCE(r.alias_de, r.codigo) = 'JEFE_DEPTO' AND p.codigo = 'costo_real.gestionar'));
--   b) lectura total (*.ver) para Dirección, Administración y Lector/Auditor también de los
--      permisos creados después de align_admin_roles.sql (antes solo llegaba al reaplicarlo).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT r.id, p.id
  FROM rol r JOIN permiso p ON p.accion = 'ver'
 WHERE COALESCE(r.alias_de, r.codigo) IN ('DIRECTOR', 'SUBDIRECTOR', 'ADMIN', 'LECTOR')
   AND r.tenant_id = (SELECT id FROM tenant WHERE codigo = 'IDIC')
ON CONFLICT DO NOTHING;
--   c) ITM03 no está en el alcance de LC 001 (align_metrologia_1510.sql): sin acreditación.
UPDATE met_proceso SET acreditacion = NULL WHERE codigo = 'ITM03' AND acreditacion = 'LC 001';
