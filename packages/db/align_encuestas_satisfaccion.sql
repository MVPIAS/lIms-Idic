-- =============================================================================
-- align_encuestas_satisfaccion.sql · Encuestas de satisfacción (EP-00 9.1)
-- -----------------------------------------------------------------------------
-- Frente r1c · decisión del usuario del 20-10-2026: toda OT que se cierra
-- genera automáticamente una encuesta PENDIENTE (trigger); no se publica a
-- internet ni la llena el cliente: Comercial la registra a mano. Preguntas
-- editables (por defecto las del formulario de evaluación del Sistema
-- Comercial). Reglas: docs/FLUJO_COTIZACION_ENCUESTAS.md.
-- Aditivo e idempotente. Va al FINAL de ORDEN_SQL.txt.
-- Permisos nuevos: encuesta.ver, encuesta.registrar, encuesta.configurar.
-- =============================================================================

-- La tabla existía en schema.sql sin uso. Se completa para el registro manual.
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS unidad_id          UUID REFERENCES unidad(id);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS cotizacion_id      UUID REFERENCES cotizacion(id);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS respuestas         JSONB;
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS promedio           NUMERIC(4,2);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS nombre_respondente VARCHAR(200);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS cargo_respondente  VARCHAR(200);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS registrada_por     UUID REFERENCES usuario(id);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS registrada_at      TIMESTAMPTZ;
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS motivo_sin_respuesta TEXT;
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ;
ALTER TABLE encuesta_satisfaccion ALTER COLUMN estado SET DEFAULT 'pendiente';
COMMENT ON COLUMN encuesta_satisfaccion.estado IS
  'pendiente (nace al cerrar la OT) → registrada (Comercial anota las respuestas del cliente) · sin_respuesta (con motivo). Heredados sin uso: enviada, respondida, vencida, anulada.';
COMMENT ON COLUMN encuesta_satisfaccion.respuestas IS
  'Copia de cada pregunta con su respuesta: [{codigo, texto, valor}] (no cambia si después se editan las preguntas).';
COMMENT ON COLUMN encuesta_satisfaccion.canal_envio IS
  'Medio por el que se obtuvo la respuesta: telefono | correo | presencial | formulario_fisico.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_encuesta_ot ON encuesta_satisfaccion (ot_id) WHERE ot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encuesta_estado ON encuesta_satisfaccion (tenant_id, estado, created_at DESC);

-- Preguntas: las cuatro del formulario de evaluación del Sistema Comercial
-- (encuestaevalua.php: criterios 01–04, escala 1/3/5/7). Editables.
CREATE TABLE IF NOT EXISTS encuesta_pregunta (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  codigo      VARCHAR(20) NOT NULL,
  texto       VARCHAR(300) NOT NULL,
  escala      INTEGER[] NOT NULL DEFAULT '{1,3,5,7}',
  orden       INTEGER NOT NULL DEFAULT 0,
  obligatoria BOOLEAN NOT NULL DEFAULT TRUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);
INSERT INTO encuesta_pregunta (tenant_id, codigo, texto, orden)
SELECT t.id, v.codigo, v.texto, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
   ('C01', 'Satisfacción por el servicio prestado', 1),
   ('C02', 'El servicio prestado cumplió con las expectativas de la empresa', 2),
   ('C03', 'Conformidad con el tiempo de respuesta', 3),
   ('C04', 'Coordinación Cliente – IDIC', 4)
 ) AS v(codigo, texto, orden)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Orígenes de OT que no generan encuesta (no tienen cliente externo, EP-00 5.4).
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, 'encuesta', 'excluir_origenes',
       'Orígenes de OT que no generan encuesta (separados por coma)', 'OT_INTERNA,INTERLABORATORIO', 1, TRUE
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- Al cerrar la OT nace su encuesta pendiente (una por OT, idempotente).
CREATE OR REPLACE FUNCTION fn_encuesta_al_cerrar_ot() RETURNS trigger AS $$
DECLARE
  excluir TEXT;
BEGIN
  SELECT p.valor INTO excluir FROM parametro_sistema p
   WHERE p.tenant_id = NEW.tenant_id AND p.categoria = 'encuesta' AND p.codigo = 'excluir_origenes' AND p.activo;
  IF NEW.origen_trabajo IS NOT NULL
     AND upper(NEW.origen_trabajo) = ANY (string_to_array(upper(regexp_replace(COALESCE(excluir, ''), '\s', '', 'g')), ',')) THEN
    RETURN NEW;
  END IF;
  INSERT INTO encuesta_satisfaccion (tenant_id, codigo, ot_id, cliente_id, unidad_id, cotizacion_id, estado, fecha_envio)
  VALUES (NEW.tenant_id, left('ENC-' || NEW.codigo, 30), NEW.id, NEW.cliente_id, NEW.unidad_principal, NEW.cotizacion_id,
          'pendiente', (now() AT TIME ZONE 'America/Santiago')::date)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_encuesta_al_cerrar_ot ON orden_trabajo;
CREATE TRIGGER trg_encuesta_al_cerrar_ot
  AFTER UPDATE OF estado ON orden_trabajo
  FOR EACH ROW
  WHEN (NEW.estado IN ('cerrada', 'finalizada') AND OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION fn_encuesta_al_cerrar_ot();


-- --- Permisos ----------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'encuesta.ver', 'encuesta', 'ver',
   'Ver encuestas de satisfacción y su reporte.'),
  (gen_random_uuid(), 'encuesta.registrar', 'encuesta', 'registrar',
   'Registrar a mano las respuestas del cliente en la encuesta de satisfacción.'),
  (gen_random_uuid(), 'encuesta.configurar', 'encuesta', 'configurar',
   'Editar las preguntas de la encuesta de satisfacción.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('COMERCIAL', 'encuesta.ver'), ('PLANIFICACION', 'encuesta.ver'), ('JEFE_DEPTO', 'encuesta.ver'),
    ('JEFE_SECCION', 'encuesta.ver'), ('JEFE_LAB', 'encuesta.ver'), ('DIRECTOR', 'encuesta.ver'),
    ('SUBDIRECTOR', 'encuesta.ver'), ('CALIDAD', 'encuesta.ver'), ('LECTOR', 'encuesta.ver'),
    -- Administración recibe todo *.ver por align_admin_roles.sql (segunda pasada): se siembra ya.
    ('ADMIN', 'encuesta.ver'),
    ('COMERCIAL', 'encuesta.registrar'), ('PLANIFICACION', 'encuesta.registrar'),
    ('ADMIN', 'encuesta.configurar')
  ) AS m(rol, perm)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
