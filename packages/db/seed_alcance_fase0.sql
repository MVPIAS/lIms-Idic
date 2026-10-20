-- =============================================================================
-- seed_alcance_fase0.sql · Perfiles de PRUEBA con DOS roles · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- SOLO DEMOSTRACIÓN (etiqueta `demo` en ORDEN_SQL.txt). Prueban el alcance POR
-- ASIGNACIÓN (docs/ADMIN_ROLES.md › «Alcance por asignación»): cada permiso vale
-- con el alcance del rol que lo concede.
--
--   demo.multi.lpn_comercial  · Analista de LPN + Comercial (global): captura
--                               solo en LPN; ve las cotizaciones de todo el IDIC.
--   demo.multi.lqc_recepcion  · Analista de LQC + Recepción central (global):
--                               captura solo en LQC; sin SAEC ni Metrología.
--   demo.multi.lam_lem        · Jefe de LAM + Analista de LEM: aprueba solo en
--                               LAM; captura en LAM y LEM.
--
-- Sin contraseña (como los demás demo.*, ver align_accesos_demo.sql). Se borran
-- con los demás perfiles de prueba (docs/ACCESOS_DEMO.md, «Antes de producción»).
-- IDEMPOTENTE. Va después de seed_accesos_demo.sql, que inactiva los perfiles de
-- prueba que no declara: aquí se reactivan y se reponen sus roles.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _multi (username text, nombre text, cargo text, rol text, unidad text) ON COMMIT DROP;
INSERT INTO _multi VALUES
  ('demo.multi.lpn_comercial', 'Analista LPN y Comercial (prueba)',   'Analista y ejecutivo comercial', 'ANALISTA',  'LPN'),
  ('demo.multi.lpn_comercial', 'Analista LPN y Comercial (prueba)',   'Analista y ejecutivo comercial', 'COMERCIAL', 'SVT'),
  ('demo.multi.lqc_recepcion', 'Analista LQC y Recepción (prueba)',   'Analista y recepción',           'ANALISTA',  'LQC'),
  ('demo.multi.lqc_recepcion', 'Analista LQC y Recepción (prueba)',   'Analista y recepción',           'RECEPCION', NULL),
  ('demo.multi.lam_lem',       'Jefe LAM y Analista LEM (prueba)',    'Jefe de laboratorio y analista', 'JEFE_LAB',  'LAM'),
  ('demo.multi.lam_lem',       'Jefe LAM y Analista LEM (prueba)',    'Jefe de laboratorio y analista', 'ANALISTA',  'LEM');

INSERT INTO usuario (id, tenant_id, username, nombre_completo, cargo, estado, es_demo)
SELECT DISTINCT ON (m.username) gen_random_uuid(), t.id, m.username, m.nombre, m.cargo, 'activo', true
  FROM _multi m
 CROSS JOIN (SELECT id FROM tenant ORDER BY (codigo = 'IDIC') DESC, created_at LIMIT 1) t
ON CONFLICT (tenant_id, username) DO UPDATE
   SET nombre_completo = EXCLUDED.nombre_completo,
       cargo           = EXCLUDED.cargo,
       estado          = 'activo',
       deleted_at      = NULL,
       es_demo         = true;

INSERT INTO usuario_rol (id, usuario_id, rol_id, unidad_id)
SELECT gen_random_uuid(), us.id, r.id, un.id
  FROM _multi m
  JOIN usuario us ON us.username = m.username AND us.es_demo
  JOIN rol r      ON r.tenant_id = us.tenant_id AND r.codigo = m.rol
  LEFT JOIN unidad un ON un.tenant_id = us.tenant_id AND un.codigo = m.unidad
 WHERE (m.unidad IS NULL OR un.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM usuario_rol ur
      WHERE ur.usuario_id = us.id AND ur.rol_id = r.id AND ur.unidad_id IS NOT DISTINCT FROM un.id);

COMMIT;
