-- =============================================================================
-- Correcciones del recorrido de manuales · 7 · Laboratorio (captura y revisión)
--
--   1 · Ubicaciones de las alícuotas (contrato §4.2.1): la tabla «ubicacion»
--       no tenía pantalla de alta, así que «Ubicación» solo ofrecía «Sin
--       ubicación» y el traslado no tenía destino. Nuevo permiso
--       «ubicacion.gestionar» para registrarlas desde Calidad › Alícuotas
--       («＋ Nueva ubicación»): jefatura del laboratorio (en cascada a Sección y
--       Departamento, align_cierre_permisos.sql), Calidad y Administración.
--       Con alcance por laboratorio; las comunes, solo con alcance global.
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt).
-- =============================================================================

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'ubicacion.gestionar', 'muestra', 'gestionar',
   'Muestras: registrar las ubicaciones (sala, gabinete, estante, caja) donde se guardan las alícuotas.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('JEFE_LAB'), ('CALIDAD'), ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'ubicacion.gestionar'
ON CONFLICT DO NOTHING;
