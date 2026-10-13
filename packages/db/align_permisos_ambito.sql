-- =============================================================================
-- align_permisos_ambito.sql · Ajustes de permisos por perfil · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE. Acompaña al control de ámbito por unidad
-- (apps/api/src/rbac/ambito-unidad.guard.ts). Sale de la prueba de permisos por
-- perfil del 13-10-2026 (docs/ACCESOS_DEMO.md):
--
--   1. El INSPECTOR de la Delegación Nº 11 no podía entrar en SAEC (armas,
--      evidencias, IBIS) mientras que un analista de cualquier laboratorio sí.
--      El inspector recibe los permisos de consulta y peritaje de SAEC; el
--      ámbito restringe SAEC a la Delegación Nº 11 y su cadena de mando, así
--      que un inspector de sucursal o un analista químico ya no entran.
--   2. Los reportes pedían solo `ot.ver`, que tiene todo el personal técnico.
--      Se crean `reporte.ver` (gestión del laboratorio) y
--      `reporte.comercial.ver` (ingresos y cartera).
-- =============================================================================

BEGIN;

-- --- 1. Inspector: consulta y peritaje en SAEC --------------------------------
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo IN ('caso.ver', 'evidencia.ver', 'evidencia.custodiar',
                                 'arma.ver', 'ibis.ver', 'peritaje.registrar')
 WHERE r.codigo = 'INSPECTOR'
ON CONFLICT DO NOTHING;

-- --- 2. Permisos de reportes ---------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'reporte.ver',           'reporte', 'ver',
   'Ver reportes de gestión del laboratorio (productividad, plazos, conformidad)'),
  (gen_random_uuid(), 'reporte.comercial.ver', 'reporte', 'comercial.ver',
   'Ver el reporte comercial (cotizado, facturado, cartera)')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'reporte.ver'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'JEFEDCO', 'PLANIFICACION', 'CALIDAD', 'LECTOR')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'reporte.comercial.ver'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFEDCO',
                    'COMERCIAL', 'PLANIFICACION', 'FINANZAS', 'COBRANZA', 'LECTOR')
ON CONFLICT DO NOTHING;

COMMIT;
