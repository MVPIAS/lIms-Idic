-- =============================================================================
-- seed_accesos_demo.sql · Usuarios de PRUEBA por perfil · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- SOLO ENTORNOS DE DEMOSTRACIÓN (etiqueta `demo` en ORDEN_SQL.txt). Nunca se
-- aplica en la instalación de producción del IDIC.
--
-- Crea un usuario por cada perfil del flujo, con el alcance que le corresponde,
-- para comprobar que cada uno ve solo lo suyo:
--
--   · Dirección y sistema ... administrador, director, calidad, auditor, recepción
--   · Comercial ............. jefe de departamento, ventas, planificación y
--                             control, muestreo, finanzas, abastecimiento
--   · Por departamento ...... jefe de departamento (Químico, Armamento y
--                             Munición, BPCH)
--   · Por sección ........... jefe de sección
--   · Por laboratorio ....... jefe, revisor y DOS analistas (un laboratorio
--                             admite N: basta crear más con el mismo rol y
--                             unidad desde Administración → Usuarios). En los
--                             laboratorios de Metrología el analista es metrólogo.
--   · BPCH .................. Certificación de la Conformidad (jefe + 2
--                             inspectores), cada sucursal (jefe + inspector) y
--                             Delegación Nº 11 (jefe + 2 inspectores)
--
-- Los nombres son genéricos («Analista 1 · LQC (prueba)»): no hay personas
-- reales. Los usuarios NO llevan contraseña (ver align_accesos_demo.sql).
--
-- Además reparte entre las unidades las órdenes de trabajo de ejemplo que no
-- tenían laboratorio asignado, para que cada perfil tenga algo propio que ver.
--
-- IDEMPOTENTE: se puede reaplicar. Requiere align_admin_roles.sql (organigrama
-- y roles) y align_accesos_demo.sql (columna es_demo).
-- =============================================================================

BEGIN;

-- --- Rol de PRUEBA con ot.crear y alcance de UN laboratorio --------------------
-- Planificación y Control (PLANIFICACION) es de alcance global; para probar que
-- registrar OT y emitir órdenes internas respetan el alcance por laboratorio hace
-- falta un perfil con ot.crear acotado a su unidad (demo.lqc.planificador). Solo
-- existe en demostración: se borra con los demás perfiles de prueba
-- (docs/ACCESOS_DEMO.md, «Antes de producción»).
INSERT INTO rol (id, tenant_id, codigo, nombre, descripcion, es_sistema, nivel, alcance, orden, created_at)
SELECT gen_random_uuid(), t.id, 'PLANIFICADOR_LAB', 'Planificador de laboratorio (prueba)',
       'Rol de PRUEBA (solo demostración): registra OT y emite órdenes internas de su laboratorio.',
       FALSE, 'OPERATIVO', 'UNIDAD', 43, now()
  FROM (SELECT id FROM tenant ORDER BY (codigo = 'IDIC') DESC, created_at LIMIT 1) t
ON CONFLICT (tenant_id, codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo IN ('ot.ver', 'ot.crear', 'muestra.ver', 'cliente.ver', 'resultado.ver')
 WHERE r.codigo = 'PLANIFICADOR_LAB'
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _demo (
  username text PRIMARY KEY,
  nombre   text NOT NULL,
  cargo    text NOT NULL,
  rol      text NOT NULL,
  unidad   text,                    -- código de unidad; NULL = sin unidad (rol global)
  es_jefe  boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

-- --- Dirección, sistema y Comercial (roles de alcance global) -----------------
INSERT INTO _demo (username, nombre, cargo, rol, unidad) VALUES
  ('demo.admin',          'Administrador del sistema (prueba)',     'Administrador del sistema', 'ADMIN',          NULL),
  ('demo.director',       'Director técnico (prueba)',              'Director técnico',          'DIRECTOR',       'DIR'),
  ('demo.calidad',        'Gestión de calidad (prueba)',            'Gestión de calidad',        'CALIDAD',        'DGC'),
  ('demo.auditor',        'Auditor · solo lectura (prueba)',        'Auditor externo',           'LECTOR',         NULL),
  ('demo.recepcion',      'Recepción de muestras (prueba)',         'Recepción central',         'RECEPCION',      NULL),
  ('demo.ventas',         'Ejecutivo de ventas (prueba)',           'Ventas',                    'COMERCIAL',      'SVT'),
  ('demo.planificacion',  'Planificación y control (prueba)',       'Planificación y control',   'PLANIFICACION',  'SPC'),
  ('demo.muestreo',       'Muestreador (prueba)',                   'Muestreo',                  'MUESTREO',       'MUE'),
  ('demo.finanzas',       'Finanzas y facturación (prueba)',        'Finanzas',                  'FINANZAS',       'DFZ'),
  ('demo.abastecimiento', 'Abastecimiento (prueba)',                'Abastecimiento',            'ABASTECIMIENTO', 'SAB');

-- --- Jefes de departamento y de sección ---------------------------------------
INSERT INTO _demo (username, nombre, cargo, rol, unidad, es_jefe)
SELECT 'demo.' || lower(u.codigo) || '.jefe',
       'Jefe · ' || u.nombre || ' (prueba)',
       CASE u.tipo WHEN 'DEPARTAMENTO' THEN 'Jefe de departamento' ELSE 'Jefe de sección' END,
       CASE u.tipo WHEN 'DEPARTAMENTO' THEN 'JEFE_DEPTO' ELSE 'JEFE_SECCION' END,
       u.codigo, true
  FROM unidad u
 WHERE u.activa
   AND u.codigo IN ('DCO','DQO','DSA','BPCH',          -- departamentos
                    'SQU','SAL','SVE','SEM','SAM','SCC') -- secciones
ON CONFLICT DO NOTHING;

-- --- Laboratorios: jefe + revisor + 2 analistas (metrólogos en Metrología) ----
WITH labs AS (
  SELECT u.codigo, u.nombre,
         (p.codigo = 'SAM') AS es_metrologia
    FROM unidad u
    LEFT JOIN unidad p ON p.id = u.padre_id
   WHERE u.activa AND u.tipo = 'LABORATORIO'
     AND u.padre_id IS NOT NULL  -- solo laboratorios del organigrama (no unidades sueltas de pruebas antiguas)
     AND u.codigo <> 'LCAD'      -- código duplicado, cubierto por LMT
)
INSERT INTO _demo (username, nombre, cargo, rol, unidad, es_jefe)
SELECT 'demo.' || lower(l.codigo) || '.' || x.sufijo,
       x.titulo || ' · ' || l.codigo || ' (prueba)',
       x.titulo,
       CASE WHEN x.rol = 'ANALISTA' AND l.es_metrologia THEN 'METROLOGO' ELSE x.rol END,
       l.codigo,
       x.rol = 'JEFE_LAB'
  FROM labs l
 CROSS JOIN (VALUES
   ('jefe',      'Jefe de laboratorio', 'JEFE_LAB'),
   ('revisor',   'Revisor',             'REVISOR'),
   ('analista1', 'Analista 1',          'ANALISTA'),
   ('analista2', 'Analista 2',          'ANALISTA')
 ) AS x(sufijo, titulo, rol)
ON CONFLICT DO NOTHING;

-- Perfil de prueba con ot.crear y alcance de UN laboratorio (LQC).
INSERT INTO _demo (username, nombre, cargo, rol, unidad)
SELECT 'demo.lqc.planificador', 'Planificador LQC (prueba)', 'Planificador de laboratorio', 'PLANIFICADOR_LAB', 'LQC'
 WHERE EXISTS (SELECT 1 FROM unidad WHERE codigo = 'LQC' AND activa)
ON CONFLICT DO NOTHING;

-- --- BPCH: Certificación, sucursales y Delegación Nº 11 -----------------------
INSERT INTO _demo (username, nombre, cargo, rol, unidad)
SELECT 'demo.' || lower(u.codigo) || '.inspector' || n,
       'Inspector ' || n || ' · ' || u.codigo || ' (prueba)',
       'Inspector', 'INSPECTOR', u.codigo
  FROM unidad u CROSS JOIN generate_series(1, 2) AS n
 WHERE u.activa AND u.codigo IN ('SCC', 'D11')
ON CONFLICT DO NOTHING;

INSERT INTO _demo (username, nombre, cargo, rol, unidad, es_jefe)
SELECT 'demo.' || lower(u.codigo) || '.' || x.sufijo,
       x.titulo || ' · ' || u.nombre || ' (prueba)',
       x.titulo, x.rol, u.codigo, x.rol = 'JEFE_LAB'
  FROM unidad u
 CROSS JOIN (VALUES
   ('jefe',      'Jefe de sucursal', 'JEFE_LAB'),
   ('inspector', 'Inspector',        'INSPECTOR')
 ) AS x(sufijo, titulo, rol)
 WHERE u.activa AND u.tipo = 'SUCURSAL'
ON CONFLICT DO NOTHING;

INSERT INTO _demo (username, nombre, cargo, rol, unidad, es_jefe)
SELECT 'demo.d11.jefe', 'Jefe · Delegación Nº 11 (prueba)', 'Jefe de delegación', 'JEFE_LAB', 'D11', true
 WHERE EXISTS (SELECT 1 FROM unidad WHERE codigo = 'D11' AND activa)
ON CONFLICT DO NOTHING;

-- --- Roles adicionales ---------------------------------------------------------
-- El jefe del Departamento Comercial controla el avance de TODAS las órdenes
-- (su departamento no tiene laboratorios): además de la jefatura lleva el rol
-- transversal de Planificación y Control.
CREATE TEMP TABLE _demo_extra (username text, rol text, unidad text) ON COMMIT DROP;
INSERT INTO _demo_extra VALUES ('demo.dco.jefe', 'PLANIFICACION', 'SPC');

-- --- Alta de usuarios (sin contraseña) ----------------------------------------
INSERT INTO usuario (id, tenant_id, username, nombre_completo, cargo, estado, es_demo)
SELECT gen_random_uuid(), t.id, d.username, d.nombre, d.cargo, 'activo', true
  FROM _demo d
 CROSS JOIN (SELECT id FROM tenant ORDER BY (codigo = 'IDIC') DESC, created_at LIMIT 1) t
ON CONFLICT (tenant_id, username) DO UPDATE
   SET nombre_completo = EXCLUDED.nombre_completo,
       cargo           = EXCLUDED.cargo,
       estado          = 'activo',
       deleted_at      = NULL,
       es_demo         = true;

-- Usuarios de prueba de versiones anteriores que esta semilla ya no declara
-- (p. ej. de unidades sueltas sin lugar en el organigrama): se inactivan.
UPDATE usuario SET estado = 'inactivo', updated_at = now()
 WHERE es_demo AND estado = 'activo'
   AND username::text NOT IN (SELECT username FROM _demo);

-- --- Rol + unidad -------------------------------------------------------------
INSERT INTO usuario_rol (id, usuario_id, rol_id, unidad_id)
SELECT gen_random_uuid(), us.id, r.id, un.id
  FROM (SELECT username, rol, unidad FROM _demo UNION ALL SELECT username, rol, unidad FROM _demo_extra) d
  JOIN usuario us ON us.username = d.username AND us.es_demo
  JOIN rol r      ON r.tenant_id = us.tenant_id AND r.codigo = d.rol
  LEFT JOIN unidad un ON un.tenant_id = us.tenant_id AND un.codigo = d.unidad
 WHERE NOT EXISTS (
   SELECT 1 FROM usuario_rol ur
    WHERE ur.usuario_id = us.id AND ur.rol_id = r.id
      AND ur.unidad_id IS NOT DISTINCT FROM un.id);

-- Un usuario de prueba solo tiene el rol que declara esta semilla: si en una
-- versión anterior tuvo otro, se retira (así reaplicar corrige el perfil).
DELETE FROM usuario_rol ur
 USING usuario us
 WHERE ur.usuario_id = us.id AND us.es_demo
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT username, rol, unidad FROM _demo UNION ALL SELECT username, rol, unidad FROM _demo_extra) d
       JOIN rol r ON r.codigo = d.rol AND r.tenant_id = us.tenant_id
       LEFT JOIN unidad un ON un.codigo = d.unidad AND un.tenant_id = us.tenant_id
      WHERE d.username = us.username AND r.id = ur.rol_id
        AND ur.unidad_id IS NOT DISTINCT FROM un.id);

-- --- Jefatura titular de la unidad (solo si la unidad aún no tiene titular) ----
INSERT INTO unidad_jefe (tenant_id, unidad_id, usuario_id, rol)
SELECT us.tenant_id, un.id, us.id, 'titular'
  FROM _demo d
  JOIN usuario us ON us.username = d.username AND us.es_demo
  JOIN unidad un  ON un.tenant_id = us.tenant_id AND un.codigo = d.unidad
 WHERE d.es_jefe
   AND NOT EXISTS (SELECT 1 FROM unidad_jefe j WHERE j.unidad_id = un.id AND j.rol = 'titular')
ON CONFLICT DO NOTHING;

-- --- Órdenes de trabajo de ejemplo sin laboratorio: se reparten ---------------
-- En los datos de demostración casi todas las OT carecían de unidad, de modo que
-- solo las veían los perfiles globales. Se asignan por turno a los laboratorios,
-- a Certificación, a las sucursales y a la Delegación Nº 11. No toca las OT que
-- ya tenían unidad.
WITH destino AS (
  SELECT u.id, row_number() OVER (ORDER BY u.codigo) AS rn, count(*) OVER () AS n
    FROM unidad u
   WHERE u.activa
     AND (u.tipo IN ('LABORATORIO', 'SUCURSAL', 'DELEGACION') OR u.codigo = 'SCC')
     AND u.codigo <> 'LCAD'
), huerfanas AS (
  SELECT o.id, row_number() OVER (ORDER BY o.codigo) AS rn
    FROM orden_trabajo o
   WHERE o.unidad_principal IS NULL
)
UPDATE orden_trabajo o
   SET unidad_principal = d.id
  FROM huerfanas h
  JOIN destino d ON d.rn = (h.rn % d.n) + 1
 WHERE o.id = h.id;

-- --- Toda unidad con al menos dos OT de ejemplo --------------------------------
-- Si tras el reparto una unidad sigue sin órdenes (base de demostración con
-- pocas OT), se le crean dos, marcadas en el código como DEMO. Necesita que
-- exista al menos un cliente de ejemplo; si no lo hay, no hace nada.
INSERT INTO orden_trabajo (id, tenant_id, codigo, cliente_id, unidad_principal)
SELECT gen_random_uuid(), u.tenant_id, 'OT-DEMO-' || u.codigo || '-' || n, c.id, u.id
  FROM unidad u
 CROSS JOIN generate_series(1, 2) AS n
 CROSS JOIN LATERAL (
   SELECT id FROM cliente WHERE tenant_id = u.tenant_id ORDER BY created_at, id LIMIT 1
 ) c
 WHERE u.activa
   AND (u.tipo IN ('LABORATORIO', 'SUCURSAL', 'DELEGACION') OR u.codigo = 'SCC')
   AND u.codigo <> 'LCAD'
   AND NOT EXISTS (SELECT 1 FROM orden_trabajo o WHERE o.unidad_principal = u.id)
ON CONFLICT DO NOTHING;

COMMIT;
