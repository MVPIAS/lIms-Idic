-- =============================================================================
-- LIMS IDIC · Brechas del contrato, tanda 6 · Aiuken
--   §4.8.4  Respaldos programados y su pantalla (Administración › Respaldos)
--   §4.7.5 / §4.5.7 / §4.6.5  Inteligencia de negocio (Metabase) con un usuario
--           de SOLO LECTURA sobre la base del LIMS y vistas para los tableros.
-- Guía de operación: docs/RESPALDOS_Y_BI.md.
-- Idempotente (IF NOT EXISTS, ON CONFLICT, CREATE OR REPLACE): se puede
-- reaplicar sin efectos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Registro de cada ejecución del respaldo
-- -----------------------------------------------------------------------------
-- Lo escriben el servicio «respaldo» de docker-compose.prod.yml
-- (scripts/backup/respaldo-programado.sh) y, en on-premise, backup.sh. La API
-- solo lo lee (pantalla Respaldos) y crea las solicitudes «Respaldar ahora».
-- Sin tenant: el respaldo es de toda la base.
CREATE TABLE IF NOT EXISTS respaldo_registro (
  id             BIGSERIAL PRIMARY KEY,
  -- programado = a la hora configurada; manual = botón «Respaldar ahora».
  tipo           VARCHAR(12)  NOT NULL DEFAULT 'programado',
  -- SOLICITADO (espera al servicio) → EN_CURSO → OK | ERROR.
  resultado      VARCHAR(12)  NOT NULL DEFAULT 'EN_CURSO',
  solicitado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  solicitado_por UUID         REFERENCES usuario(id) ON DELETE SET NULL,
  inicio         TIMESTAMPTZ,
  fin            TIMESTAMPTZ,
  duracion_s     INT,
  tamano_bytes   BIGINT,
  -- Objetos que declara el volcado (pg_restore --list): la verificación.
  objetos        INT,
  -- Nombre del fichero del volcado y nivel de retención en que quedó.
  archivo        VARCHAR(200),
  nivel          VARCHAR(30),
  -- FALSE cuando la rotación ya lo borró del disco.
  disponible     BOOLEAN      NOT NULL DEFAULT TRUE,
  mensaje        TEXT,
  servidor       VARCHAR(120),
  -- La API marca aquí que ya avisó a los administradores de un fallo.
  avisado_at     TIMESTAMPTZ,
  CONSTRAINT ck_respaldo_tipo CHECK (tipo IN ('programado', 'manual')),
  CONSTRAINT ck_respaldo_resultado CHECK (resultado IN ('SOLICITADO', 'EN_CURSO', 'OK', 'ERROR'))
);
CREATE INDEX IF NOT EXISTS ix_respaldo_registro_fecha ON respaldo_registro (solicitado_at DESC);
CREATE INDEX IF NOT EXISTS ix_respaldo_registro_pend ON respaldo_registro (resultado) WHERE resultado IN ('SOLICITADO', 'EN_CURSO');

-- Latido del servicio de respaldo: una sola fila que el servicio actualiza cada
-- minuto con la política que está aplicando (hora, retención, carpeta, espacio
-- libre). La pantalla muestra lo que el servicio REALMENTE aplica y, si el
-- latido envejece, que el servicio no está en marcha.
CREATE TABLE IF NOT EXISTS respaldo_servicio (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- contenedor = servicio «respaldo» de docker-compose.prod.yml; systemd = backup.sh on-premise.
  modo       VARCHAR(20) NOT NULL,
  latido_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  detalle    JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- -----------------------------------------------------------------------------
-- 2) Permiso de la pantalla (Administración › Respaldos)
-- -----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'admin.respaldos', 'admin', 'respaldos',
   'Ver el estado y el historial de los respaldos de la base de datos, pedir un respaldo inmediato y recibir el aviso si un respaldo falla.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'admin.respaldos'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) Parámetros (Parámetros del sistema › «Respaldos de la base de datos»)
-- -----------------------------------------------------------------------------
-- Los lee el servicio de respaldo en cada vuelta (cambian sin reiniciarlo).
-- Idempotente: no pisa un valor ya configurado.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, 'respaldos', v.codigo, v.etiqueta, v.valor, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
   ('hora',                'Hora del respaldo diario (0 a 23, hora de Chile)',                 '2',  1),
   ('retencion_diarios',   'Respaldos diarios que se conservan',                                '14', 2),
   ('retencion_semanales', 'Respaldos semanales (domingo) que se conservan',                    '8',  3),
   ('horas_alerta',        'Horas sin un respaldo correcto para dar el estado en rojo y avisar', '26', 4),
   ('avisar_fallo',        'Avisar a los administradores cuando un respaldo falla',             'si', 5)
 ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) Vistas para la inteligencia de negocio (Metabase)
-- -----------------------------------------------------------------------------
-- Tableros iniciales (scripts/metabase/configurar-metabase.py). Fechas en hora
-- de Chile: la sesión de la base ya la usa (align_zona_horaria.sql), pero se
-- fija la zona en la expresión para que valga igual en la conexión de Metabase.

-- OT por estado y mes de recepción.
CREATE OR REPLACE VIEW bi_ot_estado_mes AS
SELECT to_char(date_trunc('month', COALESCE(o.fecha_recepcion, o.created_at) AT TIME ZONE 'America/Santiago'), 'YYYY-MM') AS mes,
       o.estado,
       COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio,
       count(*)::int AS ot
  FROM orden_trabajo o
  LEFT JOIN unidad u ON u.id = o.unidad_principal
 GROUP BY 1, 2, 3;

-- Plazos de las OT abiertas (mismo semáforo que el LIMS: por vencer = 3 días).
CREATE OR REPLACE VIEW bi_ot_plazos AS
SELECT o.codigo AS ot,
       COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio,
       o.estado,
       o.fecha_compromiso,
       CASE
         WHEN o.fecha_compromiso IS NULL THEN 'Sin fecha comprometida'
         WHEN o.fecha_compromiso < (now() AT TIME ZONE 'America/Santiago')::date THEN 'Vencida'
         WHEN o.fecha_compromiso <= (now() AT TIME ZONE 'America/Santiago')::date + 3 THEN 'Por vencer'
         ELSE 'En plazo'
       END AS situacion,
       CASE WHEN o.fecha_compromiso IS NOT NULL
            THEN (now() AT TIME ZONE 'America/Santiago')::date - o.fecha_compromiso END AS dias_de_atraso
  FROM orden_trabajo o
  LEFT JOIN unidad u ON u.id = o.unidad_principal
 WHERE o.estado NOT IN ('cerrada', 'anulada');

-- Cumplimiento del plazo de las OT cerradas, por mes de cierre y laboratorio.
CREATE OR REPLACE VIEW bi_ot_cumplimiento_mes AS
SELECT to_char(date_trunc('month', o.fecha_cierre AT TIME ZONE 'America/Santiago'), 'YYYY-MM') AS mes,
       COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio,
       count(*)::int AS cerradas,
       count(*) FILTER (WHERE o.fecha_compromiso IS NOT NULL
                          AND (o.fecha_cierre AT TIME ZONE 'America/Santiago')::date <= o.fecha_compromiso)::int AS en_plazo,
       count(*) FILTER (WHERE o.fecha_compromiso IS NOT NULL
                          AND (o.fecha_cierre AT TIME ZONE 'America/Santiago')::date > o.fecha_compromiso)::int AS con_atraso
  FROM orden_trabajo o
  LEFT JOIN unidad u ON u.id = o.unidad_principal
 WHERE o.estado = 'cerrada' AND o.fecha_cierre IS NOT NULL
 GROUP BY 1, 2;

-- Resultados No cumple por laboratorio (el dueño del ensayo, también si se derivó).
CREATE OR REPLACE VIEW bi_resultado_no_cumple_lab AS
SELECT COALESCE(u.codigo, 'Sin laboratorio') AS laboratorio,
       to_char(date_trunc('month', COALESCE(r.aprobado_at, r.capturado_at, r.fecha) AT TIME ZONE 'America/Santiago'), 'YYYY-MM') AS mes,
       count(*)::int AS resultados,
       count(*) FILTER (WHERE r.veredicto = 'no_cumple')::int AS no_cumple,
       round(100.0 * count(*) FILTER (WHERE r.veredicto = 'no_cumple') / NULLIF(count(*), 0), 1) AS pct_no_cumple
  FROM resultado r
  LEFT JOIN LATERAL lims_lab_de_resultado(r.id) lr ON TRUE
  LEFT JOIN unidad u ON u.id = lr.unidad_id
 WHERE r.deleted_at IS NULL AND r.veredicto IN ('cumple', 'no_cumple')
 GROUP BY 1, 2;

-- -----------------------------------------------------------------------------
-- 5) Usuario de SOLO LECTURA para Metabase (lims_lectura)
-- -----------------------------------------------------------------------------
-- Se crea SIN contraseña y SIN poder ingresar. La contraseña se fija en el
-- servidor desde la variable METABASE_LECTURA_PASSWORD del .env con
-- scripts/metabase/crear-usuario-lectura.sh: nunca se escribe en el repositorio.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lims_lectura') THEN
    CREATE ROLE lims_lectura NOLOGIN;
  END IF;
END $$;

-- Toda transacción de este usuario es de solo lectura, con un tope de tiempo
-- para que una consulta pesada del BI no frene al laboratorio.
ALTER ROLE lims_lectura SET default_transaction_read_only = on;
ALTER ROLE lims_lectura SET statement_timeout = '120s';
ALTER ROLE lims_lectura CONNECTION LIMIT 10;

GRANT USAGE ON SCHEMA public TO lims_lectura;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lims_lectura;
-- Tablas y vistas que creen los SQL posteriores (o versiones futuras).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lims_lectura;

-- Secretos fuera del alcance del BI: contraseñas, segundo factor y la clave
-- del correo saliente. De `usuario` se conceden solo las columnas sin secretos.
REVOKE ALL ON configuracion_correo FROM lims_lectura;
REVOKE ALL ON usuario FROM lims_lectura;
DO $$
DECLARE cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'usuario'
     AND column_name NOT IN ('password_hash', 'totp_secret', 'token_version');
  IF cols IS NOT NULL THEN
    EXECUTE format('GRANT SELECT (%s) ON usuario TO lims_lectura', cols);
  END IF;
END $$;
