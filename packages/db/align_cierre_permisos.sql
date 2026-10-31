-- =============================================================================
-- LIMS IDIC · Cierre de permisos (va SIEMPRE al final de ORDEN_SQL.txt) · Aiuken
-- =============================================================================
-- align_admin_roles.sql reparte permisos «en cascada» (Jefe de Laboratorio →
-- Jefe de Sección → Jefe de Departamento), da la lectura total (*.ver) a
-- Dirección, Administración y Lector, y todos los permisos a SUPERADMIN. Como
-- se ejecuta antes que los SQL que crean permisos nuevos (cotización, encuestas,
-- órdenes internas…), en una instalación de UNA sola pasada esos permisos nuevos
-- no llegaban a la cascada; solo aparecían al reaplicar todo. Este fichero repite
-- el reparto al final para que una pasada deje lo mismo que dos.
-- Mantiene las mismas exclusiones que align_admin_roles.sql:
--   · costo_real.* es solo del Jefe de Laboratorio;
--   · Administración no consulta SAEC (evidencias, armas, casos, IBIS).
-- Aditivo e idempotente (ON CONFLICT DO NOTHING).
-- =============================================================================

WITH t AS (SELECT id FROM tenant WHERE codigo = 'IDIC'),
jefe_lab AS (
  SELECT p.codigo
    FROM rol r JOIN rol_permiso rp ON rp.rol_id = r.id JOIN permiso p ON p.id = rp.permiso_id
   WHERE COALESCE(r.alias_de, r.codigo) = 'JEFE_LAB'
     AND r.tenant_id = (SELECT id FROM t)
     AND p.codigo NOT LIKE 'costo\_real.%'
),
jefe_seccion AS (
  SELECT codigo FROM jefe_lab
  UNION
  SELECT p.codigo
    FROM rol r JOIN rol_permiso rp ON rp.rol_id = r.id JOIN permiso p ON p.id = rp.permiso_id
   WHERE COALESCE(r.alias_de, r.codigo) = 'JEFE_SECCION'
     AND r.tenant_id = (SELECT id FROM t)
),
reparto(rol, perm) AS (
  SELECT 'JEFE_SECCION', codigo FROM jefe_lab
  UNION SELECT 'JEFE_DEPTO', codigo FROM jefe_seccion
  UNION SELECT r, p.codigo FROM unnest(ARRAY['DIRECTOR','SUBDIRECTOR','ADMIN','LECTOR']) r
        CROSS JOIN permiso p
        WHERE p.accion = 'ver' AND NOT (r = 'ADMIN' AND p.codigo ~ '^(evidencia|arma|caso|ibis)\.')
  UNION SELECT 'SUPERADMIN', p.codigo FROM permiso p
)
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT r.id, p.id
  FROM reparto m
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol AND r.tenant_id = (SELECT id FROM t)
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Versiones de plantilla (align_plantilla_versiones.sql): si algún SQL aplicado
-- después de aquel cambió el cuerpo o el formato de una plantilla, se registra
-- como versión VIGENTE nueva (origen «script») y la anterior queda RETIRADA.
-- Va aquí porque este fichero es siempre el último.
-- -----------------------------------------------------------------------------
SELECT plantilla_sincronizar_versiones();
