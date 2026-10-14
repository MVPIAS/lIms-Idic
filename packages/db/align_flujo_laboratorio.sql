-- =============================================================================
-- align_flujo_laboratorio.sql · Flujo de laboratorio: de la OT al resultado
-- aprobado · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE (se puede reaplicar sin error). Acompaña a:
--   · apps/api/src/ot/ot.controller.ts + laboratorio-ot.service.ts
--   · apps/api/src/laboratorio/laboratorio.module.ts (revisión / aprobación)
--   · apps/api/src/flujo-real/flujo-real.module.ts (captura por OT)
-- Reglas de negocio: docs/FLUJO_LABORATORIO.md
--
--   1. Laboratorio responsable de la OT (orden_trabajo.unidad_principal):
--      quién y cuándo lo fijó o lo cambió, e historial de la OT.
--   2. Centro de costo → unidad: permite deducir el laboratorio de una
--      cotización por su centro de costo.
--   3. Asignación de analistas a la OT (ot_analista, ya existía en schema.sql)
--      y de un ensayo concreto a un analista (resultado.asignado_a).
--   4. Veredicto único: cumple | no_cumple | informativo | pendiente.
--   5. Resultados del puente aún sin valor: estado 'pendiente' (no 'capturado').
--   6. Permisos ot.asignar y ot.cambiar_laboratorio; muestra.crear para
--      Planificación (registra la OT con sus elementos).
--   7. Formulario de captura estándar: especificación por ensayo de la orden
--      (catálogo u orden), tipo de dato numérico / atributo, lecturas de la
--      fórmula y veredicto de la muestra.
-- =============================================================================

BEGIN;

-- --- 1. Laboratorio responsable e historial de la OT -------------------------
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS unidad_asignada_por UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS unidad_asignada_at  TIMESTAMPTZ;
COMMENT ON COLUMN orden_trabajo.unidad_asignada_por IS 'Usuario que fijó o cambió por última vez el laboratorio responsable (unidad_principal).';
COMMENT ON COLUMN orden_trabajo.unidad_asignada_at  IS 'Fecha y hora en que se fijó o cambió por última vez el laboratorio responsable.';

CREATE TABLE IF NOT EXISTS ot_historial (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  ot_id       UUID NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  -- laboratorio | asignacion | desasignacion | asignacion_ensayo
  tipo        VARCHAR(30) NOT NULL,
  detalle     JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ot_historial_ot ON ot_historial(ot_id, created_at DESC);
COMMENT ON TABLE ot_historial IS 'Trazabilidad de la OT: cambios de laboratorio responsable y asignaciones de analistas (quién, cuándo, qué).';

-- --- 2. Centro de costo → unidad ------------------------------------------------
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS unidad_id UUID REFERENCES unidad(id);
COMMENT ON COLUMN centro_costo.unidad_id IS 'Unidad (laboratorio, sucursal o delegación) a la que corresponde el centro de costo. Sirve para deducir el laboratorio responsable de la OT.';

-- Correspondencias explícitas (códigos sembrados por align_comercial_r2.sql).
UPDATE centro_costo cc SET unidad_id = u.id
  FROM unidad u, (VALUES
    ('LMT-AE',        'LMTE'),
    ('BPCH-SUC-STGO', 'SSTGO'),
    ('BPCH-SUC-ANF',  'SANTOF'),
    ('BPCH-SUC-LSE',  'SSEREN'),
    ('BPCH-SUC-CAL',  'SCALAM'),
    ('BPCH-SUC-CPO',  'SCOPIAP'),
    ('BPCH-SUC-IQQ',  'SIQUIQU'),
    ('BPCH-DEL-11',   'D11')
  ) AS m(cc_codigo, unidad_codigo)
 WHERE cc.unidad_id IS NULL
   AND cc.codigo = m.cc_codigo
   AND u.tenant_id = cc.tenant_id
   AND u.codigo = m.unidad_codigo;

-- Regla general: el prefijo del código del centro de costo («LQC-001») es el
-- código de la unidad («LQC»).
UPDATE centro_costo cc SET unidad_id = u.id
  FROM unidad u
 WHERE cc.unidad_id IS NULL
   AND u.tenant_id = cc.tenant_id
   AND COALESCE(cc.tipo, 'laboratorio') = 'laboratorio'
   AND u.codigo = split_part(cc.codigo, '-', 1);

-- --- 3. Asignación de analistas -------------------------------------------------
ALTER TABLE ot_analista ADD COLUMN IF NOT EXISTS asignado_por UUID;
ALTER TABLE ot_analista ADD COLUMN IF NOT EXISTS asignado_at  TIMESTAMPTZ DEFAULT now();
COMMENT ON TABLE ot_analista IS 'Analistas (o técnicos, metrólogos, inspectores) asignados a la OT por la jefatura del laboratorio.';

ALTER TABLE resultado ADD COLUMN IF NOT EXISTS asignado_a UUID;
COMMENT ON COLUMN resultado.asignado_a IS 'Analista al que la jefatura asignó este ensayo concreto (NULL = cualquiera de los asignados a la OT).';
CREATE INDEX IF NOT EXISTS idx_resultado_asignado ON resultado(asignado_a) WHERE asignado_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resultado_ot_estado ON resultado(ot_id, estado);

-- Resultados capturados sin OT (la captura por réplicas no la exigía): se
-- completa desde la muestra para que cuenten en bandejas y alcance.
UPDATE resultado r SET ot_id = m.ot_id
  FROM muestra m
 WHERE r.ot_id IS NULL AND m.id = r.muestra_id AND m.ot_id IS NOT NULL;

-- --- 4. Veredicto único ----------------------------------------------------------
UPDATE resultado SET veredicto = 'cumple'      WHERE veredicto = 'Cumple';
UPDATE resultado SET veredicto = 'no_cumple'   WHERE veredicto IN ('No cumple', 'No Cumple', 'no cumple');
UPDATE resultado SET veredicto = 'informativo' WHERE veredicto = 'Informativo';
COMMENT ON COLUMN resultado.veredicto IS 'cumple | no_cumple | informativo (sin especificación) | pendiente (sin valor o sin forma de decidir).';

-- --- 5. Resultados del puente aún sin valor -------------------------------------
UPDATE resultado SET estado = 'pendiente'
 WHERE estado = 'capturado'
   AND cat_analito_id IS NOT NULL
   AND valor_texto IS NULL AND valor_numerico IS NULL
   AND promedio IS NULL;

-- --- 6. Permisos -------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'ot.asignar', 'ot', 'asignar',
   'Asignar la OT, sus muestras o ensayos a analistas del laboratorio'),
  (gen_random_uuid(), 'ot.cambiar_laboratorio', 'ot', 'cambiar_laboratorio',
   'Fijar o cambiar el laboratorio responsable de una OT')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'ot.asignar'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFE_SECCION', 'JEFE_LAB')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'ot.cambiar_laboratorio'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFE_SECCION', 'JEFE_LAB', 'PLANIFICACION')
ON CONFLICT DO NOTHING;

-- Planificación registra la OT con sus elementos (muestras y análisis pedidos).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'muestra.crear'
 WHERE r.codigo = 'PLANIFICACION'
ON CONFLICT DO NOTHING;

-- --- 7. Formulario de captura estándar ------------------------------------------
-- Cada ensayo de la OT lleva su especificación (Mín / Nom / Máx, unidad,
-- requisito de texto, fórmula) COPIADA del catálogo al generarse. Lo que el
-- catálogo no trae queda vacío y se completa en la captura, solo para esa
-- orden: el catálogo no se toca. espec_origen distingue «catalogo» de «orden».
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS tipo_dato         VARCHAR(12);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS requisito         TEXT;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS observacion       TEXT;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS lecturas          JSONB;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS espec_origen      VARCHAR(10) NOT NULL DEFAULT 'catalogo';
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS espec_catalogo    JSONB;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS espec_editada_por UUID;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS espec_editada_at  TIMESTAMPTZ;
COMMENT ON COLUMN resultado.tipo_dato         IS 'numerico (veredicto automático contra Mín/Máx; sin límites = informativo) | atributo (Cumple/No cumple lo elige el analista).';
COMMENT ON COLUMN resultado.requisito         IS 'Requisito de texto de la especificación (p. ej. «Tafetán», «Grado 4/5 mín.»).';
COMMENT ON COLUMN resultado.observacion       IS 'Observación del analista (obligatoria en atributos No cumple).';
COMMENT ON COLUMN resultado.lecturas          IS 'Lecturas con los campos del método (C1..Cn = paso_metodo) cuando el valor sale de una fórmula.';
COMMENT ON COLUMN resultado.espec_origen      IS 'catalogo = especificación tal como vino del catálogo | orden = completada o cambiada para esta orden.';
COMMENT ON COLUMN resultado.espec_catalogo    IS 'Copia de la especificación del catálogo al generar el ensayo (para comparar con la de la orden).';

-- Ensayos ya generados: tipo de dato y copia de la especificación del catálogo.
UPDATE resultado SET tipo_dato = CASE
         WHEN COALESCE(limite_inf, '') ~ '^\s*[+-]?([0-9]+([.,][0-9]+)?|[.,][0-9]+)\s*$'
           OR COALESCE(nominal, '')    ~ '^\s*[+-]?([0-9]+([.,][0-9]+)?|[.,][0-9]+)\s*$'
           OR COALESCE(limite_sup, '') ~ '^\s*[+-]?([0-9]+([.,][0-9]+)?|[.,][0-9]+)\s*$' THEN 'numerico'
         WHEN COALESCE(limite_inf, '') <> '' OR COALESCE(nominal, '') <> '' OR COALESCE(limite_sup, '') <> '' THEN 'atributo'
         ELSE 'numerico' END
 WHERE tipo_dato IS NULL AND cat_analito_id IS NOT NULL;
UPDATE resultado SET espec_catalogo = jsonb_build_object(
         'limiteInf', limite_inf, 'nominal', nominal, 'limiteSup', limite_sup,
         'unidad', unidad, 'formula', formula, 'tipoDato', tipo_dato)
 WHERE espec_catalogo IS NULL AND cat_analito_id IS NOT NULL;

-- Veredicto de la muestra (lote): no_cumple si algún ensayo no cumple,
-- pendiente si falta alguno, cumple si todos cumplen. Lo usa el informe.
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS veredicto    VARCHAR(20);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS veredicto_at TIMESTAMPTZ;
COMMENT ON COLUMN muestra.veredicto IS 'cumple | no_cumple | informativo | pendiente · agregado de los ensayos de la muestra (lo recalcula la API en cada captura).';

COMMIT;
