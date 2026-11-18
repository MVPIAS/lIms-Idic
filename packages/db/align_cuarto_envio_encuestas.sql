-- =============================================================================
-- align_cuarto_envio_encuestas.sql · Cuarto envío IDIC (18-11-2026) · COM-14
-- -----------------------------------------------------------------------------
-- Encuestas de satisfacción (DCO-PG01-P04-IT05). Idempotente: se puede correr
-- dos veces. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
--
--   1 · Preguntas abiertas (encuesta_pregunta.tipo_respuesta = 'texto'): el
--       FORM02 «Cotizaciones no aceptadas» trae «Razón por la cual no han
--       contratado el servicio cotizado». Una pregunta de texto no lleva escala
--       ni entra en los promedios ni en el índice del informe trimestral.
--   2 · Medio por defecto de cada formulario (encuesta_tipo.medio_defecto):
--       FORM01 y FORM02 son encuestas telefónicas; el FORM05 se envía por correo.
--       El medio se elige al registrar (encuesta_satisfaccion.canal_envio).
--   3 · Cartas de remisión FORM06 / FORM07 / FORM08: no necesitan tablas; se
--       generan desde la lista de encuestas (GET /encuestas/cartas-remision).
--
-- Los pasos que siembran datos que el IDIC administra después (la pregunta del
-- FORM02 y los medios por defecto) se aplican UNA sola vez (sql_paso_aplicado).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION pg_temp.te_primera_vez(p_codigo TEXT, p_descripcion TEXT)
RETURNS boolean AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion) VALUES (p_codigo, p_descripcion)
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 1 · Tipo de respuesta de la pregunta: nota (escala) o texto (pregunta abierta)
-- -----------------------------------------------------------------------------
ALTER TABLE encuesta_pregunta ADD COLUMN IF NOT EXISTS tipo_respuesta VARCHAR(10) NOT NULL DEFAULT 'nota';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_encuesta_pregunta_tipo_respuesta') THEN
    ALTER TABLE encuesta_pregunta ADD CONSTRAINT ck_encuesta_pregunta_tipo_respuesta CHECK (tipo_respuesta IN ('nota', 'texto'));
  END IF;
END $$;
COMMENT ON COLUMN encuesta_pregunta.tipo_respuesta IS
  'nota = el cliente pone una nota de la escala (entra en promedios e índice) · texto = pregunta abierta (no lleva escala ni entra en los promedios).';
COMMENT ON COLUMN encuesta_satisfaccion.respuestas IS
  'Copia de cada pregunta con su respuesta: [{codigo, texto, valor, escala}] y, en las preguntas abiertas, {tipo: "texto", respuesta} con valor null.';

-- FORM02 (Rev02): «Usted podría indicarme la razón por la cual no han contratado
-- el servicio cotizado». Opcional: el cliente puede no querer indicarla.
DO $$
BEGIN
  IF pg_temp.te_primera_vez('ce1811.COM-14.form02-razon', 'FORM02: pregunta abierta «razón por la cual no han contratado el servicio» (COM-14)') THEN
    INSERT INTO encuesta_pregunta (tenant_id, tipo_codigo, codigo, texto, escala, orden, obligatoria, tipo_respuesta)
    SELECT t.id, 'FORM02', 'F02_RAZON', 'Razón por la cual no han contratado el servicio cotizado', '{}', 6, FALSE, 'texto'
      FROM tenant t
     WHERE EXISTS (SELECT 1 FROM encuesta_tipo et WHERE et.tenant_id = t.id AND et.codigo = 'FORM02')
    ON CONFLICT (tenant_id, codigo) DO NOTHING;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2 · Medio por defecto de cada formulario
-- -----------------------------------------------------------------------------
ALTER TABLE encuesta_tipo ADD COLUMN IF NOT EXISTS medio_defecto VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_encuesta_tipo_medio_defecto') THEN
    ALTER TABLE encuesta_tipo ADD CONSTRAINT ck_encuesta_tipo_medio_defecto
      CHECK (medio_defecto IS NULL OR medio_defecto IN ('telefono', 'correo', 'presencial', 'formulario_fisico'));
  END IF;
END $$;
COMMENT ON COLUMN encuesta_tipo.medio_defecto IS
  'Medio que se propone al registrar la encuesta (telefono | correo | presencial | formulario_fisico); vacío = se elige cada vez.';

DO $$
BEGIN
  IF pg_temp.te_primera_vez('ce1811.COM-14.medio-defecto', 'Medio por defecto: FORM01 y FORM02 teléfono, FORM05 correo (COM-14)') THEN
    UPDATE encuesta_tipo SET medio_defecto = 'telefono', updated_at = now()
     WHERE codigo IN ('FORM01', 'FORM02') AND medio_defecto IS NULL;
    UPDATE encuesta_tipo SET medio_defecto = 'correo', updated_at = now()
     WHERE codigo = 'FORM05' AND medio_defecto IS NULL;
  END IF;
END $$;

COMMIT;
