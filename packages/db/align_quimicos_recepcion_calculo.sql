-- =============================================================================
-- align_quimicos_recepcion_calculo.sql · Depto. Químico (observaciones 15-10-2026)
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: se puede reaplicar sin error ni efectos secundarios.
-- Va al FINAL de ORDEN_SQL.txt. Reglas: docs/FLUJO_QUIMICOS_RECEPCION_CALCULO.md
--
--   1. Recepción de la muestra: toma de muestra (3 opciones editables),
--      condición de recepción Cumple / No cumple (observación obligatoria si no
--      cumple), identificación dada por el cliente y «¿requiere ensayos de otros
--      laboratorios?» con cuáles. El número de sello ya existía (sello_numero).
--   2. Historial de cambios de cada resultado (resultado_historial): un
--      disparador anota TODO cambio de valor, especificación, fórmula, factor,
--      veredicto o estado (quién, cuándo, valor anterior y nuevo, motivo). Quien
--      cambia y el motivo los pone la API en la transacción (set_config
--      'lims.usuario_id' / 'lims.motivo' / 'lims.origen'); si un camino no los
--      pone, el cambio igual queda anotado, sin usuario.
--   3. Factor de fórmula (multiplicar o dividir): valor por defecto en el método
--      (cat_metodo) y ajustable por OT en el resultado.
--   4. Planilla de costos reales por OT (DCO-PG01-P05-IT03-FORM01).
--   5. Permisos: resultado.factor, costo_real.ver, costo_real.gestionar.
-- =============================================================================

-- --- 1. Recepción de la muestra ---------------------------------------------------
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS toma_muestra           VARCHAR(60);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS condicion_recepcion    VARCHAR(10);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS condicion_observacion  TEXT;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS identificacion_cliente VARCHAR(300);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS requiere_otros_labs    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS otros_labs             UUID[]  NOT NULL DEFAULT '{}';
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS otros_labs_detalle     TEXT;

COMMENT ON COLUMN muestra.toma_muestra IS
  'Quién tomó la muestra: código de parametro_sistema categoría toma_muestra (terreno_laboratorio | entregada_cliente | seccion_muestreo, editable).';
COMMENT ON COLUMN muestra.condicion_recepcion IS
  'Condición de recepción: cumple | no_cumple (con condicion_observacion obligatoria).';
COMMENT ON COLUMN muestra.identificacion_cliente IS
  'Identificación de la muestra dada por el cliente (rótulo, p. ej. «Estanque Nº 3»).';
COMMENT ON COLUMN muestra.otros_labs IS
  'Laboratorios (unidad.id) que deben hacer ensayos sobre esta muestra; se enlaza con orden_interna por destino_lab.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_muestra_condicion_recepcion') THEN
    ALTER TABLE muestra ADD CONSTRAINT ck_muestra_condicion_recepcion CHECK (
      condicion_recepcion IS NULL
      OR condicion_recepcion = 'cumple'
      OR (condicion_recepcion = 'no_cumple' AND length(btrim(COALESCE(condicion_observacion, ''))) > 0)
    ) NOT VALID;
  END IF;
END $$;

-- Opciones de «Toma de muestra» y cargos de la planilla de costos: combos
-- editables por el IDIC (Catálogo › Parámetros). ON CONFLICT no pisa ediciones.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
  ('toma_muestra', 'terreno_laboratorio', 'En terreno por el laboratorio',                     1),
  ('toma_muestra', 'entregada_cliente',   'Entregada por el cliente',                          2),
  ('toma_muestra', 'seccion_muestreo',    'Tomada por personal de la Sección Muestreo IDIC',   3),
  -- Cargos de «Horas hombre» (ejemplo real NCh 409 de la maqueta: Jefe de
  -- Sección, Jefe de Laboratorio, Analista; el LIMS antiguo separaba
  -- profesional y técnico). La tarifa $/h no consta: se escribe en la planilla.
  ('cargo_costo',  'jefe_departamento',   'Jefe de Departamento',  1),
  ('cargo_costo',  'jefe_laboratorio',    'Jefe de Laboratorio',   2),
  ('cargo_costo',  'profesional',         'Profesional',           3),
  ('cargo_costo',  'analista',            'Analista',              4),
  ('cargo_costo',  'tecnico',             'Técnico',               5)
 ) AS v(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 2. Factor de fórmula ------------------------------------------------------------
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS factor_valor       NUMERIC(18,6);
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS factor_operacion   VARCHAR(12);
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS factor_descripcion VARCHAR(120);
COMMENT ON COLUMN cat_metodo.factor_valor IS
  'Factor por defecto del método que se aplica al resultado calculado (NULL = sin factor). Ajustable por OT en resultado.factor_valor.';

ALTER TABLE resultado ADD COLUMN IF NOT EXISTS factor_valor       NUMERIC(18,6);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS factor_operacion   VARCHAR(12);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS factor_descripcion VARCHAR(120);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS factor_origen      VARCHAR(10);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS factor_editado_por UUID;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS factor_editado_at  TIMESTAMPTZ;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS factor_motivo      TEXT;
-- Valor calculado ANTES de aplicar el factor (para recalcular si cambia) y
-- variables extra que se usaron en la fórmula (reproducibilidad del cálculo).
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS valor_sin_factor   NUMERIC(18,6);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS variables          JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cat_metodo_factor') THEN
    ALTER TABLE cat_metodo ADD CONSTRAINT ck_cat_metodo_factor CHECK (
      (factor_valor IS NULL AND factor_operacion IS NULL)
      OR (factor_valor > 0 AND factor_operacion IN ('multiplicar', 'dividir'))
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_resultado_factor') THEN
    ALTER TABLE resultado ADD CONSTRAINT ck_resultado_factor CHECK (
      (factor_valor IS NULL AND factor_operacion IS NULL)
      OR (factor_valor > 0 AND factor_operacion IN ('multiplicar', 'dividir'))
    ) NOT VALID;
  END IF;
END $$;

-- --- 3. Historial de cambios del resultado -----------------------------------------
CREATE TABLE IF NOT EXISTS resultado_historial (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID,
  resultado_id   UUID        NOT NULL,
  ot_id          UUID,
  campo          VARCHAR(40) NOT NULL,
  valor_anterior JSONB,
  valor_nuevo    JSONB,
  motivo         TEXT,
  origen         VARCHAR(40),
  usuario_id     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_resultado_historial_resultado ON resultado_historial (resultado_id, created_at);
CREATE INDEX IF NOT EXISTS ix_resultado_historial_ot        ON resultado_historial (ot_id, created_at);
COMMENT ON TABLE resultado_historial IS
  'Traza de cambios de cada resultado (17025 §7.5/§7.11): campo, valor anterior y nuevo, quién, cuándo, motivo y origen. La escribe el disparador trg_resultado_historial; no se edita.';

CREATE OR REPLACE FUNCTION fn_resultado_historial() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  campos   TEXT[] := ARRAY[
    'valor_numerico', 'valor_texto', 'replicas', 'lecturas', 'variables', 'promedio',
    'resultado_final', 'valor_sin_factor', 'formula', 'formula_aplicada',
    'factor_valor', 'factor_operacion', 'limite_inf', 'nominal', 'limite_sup', 'unidad',
    'requisito', 'tipo_dato', 'veredicto', 'estado', 'observacion', 'equipo_id', 'deleted_at'];
  v_usuario UUID;
  v_motivo  TEXT := NULLIF(current_setting('lims.motivo', true), '');
  v_origen  TEXT := COALESCE(NULLIF(current_setting('lims.origen', true), ''), 'sistema');
  v_tenant  UUID;
  v_fila    resultado%ROWTYPE;
  o JSONB;
  n JSONB;
  c TEXT;
BEGIN
  BEGIN
    v_usuario := NULLIF(current_setting('lims.usuario_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_usuario := NULL;
  END;
  IF TG_OP = 'DELETE' THEN v_fila := OLD; ELSE v_fila := NEW; END IF;
  v_tenant := v_fila.tenant_id;
  IF v_tenant IS NULL THEN
    SELECT m.tenant_id INTO v_tenant FROM muestra m WHERE m.id = v_fila.muestra_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    o := to_jsonb(OLD);
    INSERT INTO resultado_historial (tenant_id, resultado_id, ot_id, campo, valor_anterior, valor_nuevo, motivo, origen, usuario_id)
    SELECT v_tenant, OLD.id, OLD.ot_id, 'baja',
           jsonb_strip_nulls((SELECT jsonb_object_agg(k, o -> k) FROM unnest(campos) AS k)), NULL,
           v_motivo, v_origen, v_usuario;
    RETURN OLD;
  END IF;
  n := to_jsonb(NEW);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO resultado_historial (tenant_id, resultado_id, ot_id, campo, valor_anterior, valor_nuevo, motivo, origen, usuario_id)
    SELECT v_tenant, NEW.id, NEW.ot_id, 'alta', NULL,
           jsonb_strip_nulls((SELECT jsonb_object_agg(k, n -> k) FROM unnest(campos) AS k)),
           v_motivo, v_origen, v_usuario;
    RETURN NEW;
  END IF;
  o := to_jsonb(OLD);
  FOREACH c IN ARRAY campos LOOP
    IF (o -> c) IS DISTINCT FROM (n -> c) THEN
      INSERT INTO resultado_historial (tenant_id, resultado_id, ot_id, campo, valor_anterior, valor_nuevo, motivo, origen, usuario_id)
      VALUES (v_tenant, NEW.id, NEW.ot_id, c, o -> c, n -> c, v_motivo, v_origen, v_usuario);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resultado_historial ON resultado;
CREATE TRIGGER trg_resultado_historial
  AFTER INSERT OR UPDATE OR DELETE ON resultado
  FOR EACH ROW EXECUTE FUNCTION fn_resultado_historial();

-- --- 4. Planilla de costos reales por OT (DCO-PG01-P05-IT03-FORM01) --------------
CREATE TABLE IF NOT EXISTS ot_costo_real (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenant(id),
  ot_id            UUID        NOT NULL REFERENCES orden_trabajo(id),
  unidad_id        UUID        NOT NULL REFERENCES unidad(id),
  estado           VARCHAR(10) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'cerrada')),
  observaciones    TEXT,
  actualizada_por  UUID,
  actualizada_at   TIMESTAMPTZ,
  cerrada_por      UUID,
  cerrada_at       TIMESTAMPTZ,
  reabierta_por    UUID,
  reabierta_at     TIMESTAMPTZ,
  reabierta_motivo TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ot_costo_real UNIQUE (ot_id, unidad_id)
);
CREATE INDEX IF NOT EXISTS ix_ot_costo_real_tenant ON ot_costo_real (tenant_id, estado);

CREATE TABLE IF NOT EXISTS ot_costo_real_linea (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_id    UUID          NOT NULL REFERENCES ot_costo_real(id) ON DELETE CASCADE,
  orden          INTEGER       NOT NULL DEFAULT 0,
  categoria      VARCHAR(20)   NOT NULL CHECK (categoria IN ('horas_hombre', 'reactivos', 'equipos', 'otros')),
  cargo          VARCHAR(60),
  consumible_id  UUID,
  equipo_id      UUID,
  descripcion    VARCHAR(300),
  cantidad       NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  unidad         VARCHAR(20),
  costo_unitario NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  total          NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (total >= 0)
);
CREATE INDEX IF NOT EXISTS ix_ot_costo_real_linea_planilla ON ot_costo_real_linea (planilla_id, orden);
COMMENT ON TABLE ot_costo_real IS
  'Planilla de costos reales por OT y laboratorio (DCO-PG01-P05-IT03-FORM01). La completa la jefatura del laboratorio al cerrar su parte; se compara con la estimación de la cotización.';

-- --- 5. Permisos ------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'resultado.factor',     'resultado',  'factor',
   'Ajustar el factor de la fórmula de un ensayo en una OT (multiplicar o dividir), con motivo'),
  (gen_random_uuid(), 'costo_real.ver',       'costo_real', 'ver',
   'Ver la planilla de costos reales de la OT y su comparación con la cotización'),
  (gen_random_uuid(), 'costo_real.gestionar', 'costo_real', 'gestionar',
   'Completar, cerrar y reabrir la planilla de costos reales de la OT de su laboratorio')
ON CONFLICT (codigo) DO NOTHING;

-- resultado.factor: la jefatura (quienes aprueban resultados). Para que también
-- lo ajuste el analista basta con asignar este permiso al rol ANALISTA en
-- Administración › Roles (regla parametrizable, sin cambiar código).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'resultado.factor'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION', 'JEFE_LAB', 'JEFELAB')
ON CONFLICT DO NOTHING;

-- Planilla de costos: la completa el Jefe de Laboratorio. El Depto. Químico pidió
-- sacar al Jefe de Sección de la planilla (observaciones del 15-10-2026).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'costo_real.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'JEFE_LAB', 'JEFELAB')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'costo_real.ver'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_LAB', 'JEFELAB',
                    'PLANIFICACION', 'FINANZAS')
ON CONFLICT DO NOTHING;
