-- =============================================================================
-- LIMS IDIC · Frente r4b · documentos propios del BPCH (T24) · Aiuken
-- =============================================================================
--   1 · Codificación Única: campos de los modelos DGMN del listado oficial
--       (grupo, EQ.DIN 60 %, PTN/PIN) y registro de cada emisión del listado
--       oficial por fabricante (EP-09 9.10 y 9.16).
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql.
-- =============================================================================

ALTER TABLE bpch_codificacion ADD COLUMN IF NOT EXISTS grupo_listado VARCHAR(120);
ALTER TABLE bpch_codificacion ADD COLUMN IF NOT EXISTS eq_din_60     NUMERIC(6, 2);
ALTER TABLE bpch_codificacion ADD COLUMN IF NOT EXISTS ptn_pin       VARCHAR(10);
COMMENT ON COLUMN bpch_codificacion.grupo_listado IS 'Grupo del listado oficial DGMN («21 Semigelatina granulada», «44 Matrices»). Agrupa el PDF (EP-09 9.16).';
COMMENT ON COLUMN bpch_codificacion.eq_din_60 IS 'Equivalencia en dinamita 60 % (columna EQ.DIN 60 % de los modelos DGMN). Significado por confirmar (EP-09 P5).';
COMMENT ON COLUMN bpch_codificacion.ptn_pin IS 'PTN / PIN (explosivos) o SQN (sustancias químicas) de los modelos DGMN. Significado por confirmar (EP-09 P5).';

CREATE TABLE IF NOT EXISTS bpch_listado_emision (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenant(id),
  listado           VARCHAR(20)  NOT NULL CHECK (listado IN ('EXPLOSIVOS', 'SUSTANCIAS_QUIMICAS', 'EN_RECESO')),
  fabricante        VARCHAR(200),
  fecha_edicion     DATE         NOT NULL,
  total_elementos   INTEGER      NOT NULL,
  formato           VARCHAR(5)   NOT NULL CHECK (formato IN ('pdf', 'csv')),
  hash_sha256       VARCHAR(64),
  created_by        UUID REFERENCES usuario(id),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE bpch_listado_emision IS 'Emisiones del listado oficial de Codificación Única (PDF para firma del Subdirector BPCH y del Jefe Depto. Control de Armas y Explosivos de la DGMN, o Excel).';
CREATE INDEX IF NOT EXISTS ix_bpch_listado_emision ON bpch_listado_emision (tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2 · Revisión documental IT08 de una inspección de Producción Nacional
--     (EP-07 7.3, BL-177): checklist por documento legal y defectos que se
--     trasladan al ensayo «Rev. Doc. Legal» de la OT.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_revision_documental (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenant(id),
  ot_id           UUID         NOT NULL REFERENCES orden_trabajo(id),
  items           JSONB        NOT NULL DEFAULT '[]'::jsonb,
  criticos        INTEGER      NOT NULL DEFAULT 0 CHECK (criticos >= 0),
  menores         INTEGER      NOT NULL DEFAULT 0 CHECK (menores >= 0),
  resultado       VARCHAR(15)  NOT NULL DEFAULT 'pendiente' CHECK (resultado IN ('pendiente', 'conforme', 'no_conforme')),
  registrado_por  UUID REFERENCES usuario(id),
  registrado_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  trasladado_at   TIMESTAMPTZ,
  CONSTRAINT ux_bpch_revision_documental UNIQUE (ot_id)
);
COMMENT ON TABLE bpch_revision_documental IS 'Registro y análisis de documentos DGMN / AF (SAC-PG01-IT08) de una OT de Producción Nacional; los defectos se trasladan al ensayo «Rev. Doc. Legal».';

-- -----------------------------------------------------------------------------
-- 3 · Parametrización del elemento nuevo de un prototipo (EP-08 8.11, BL-060):
--     panel (método, ensayo, Mín/Nom/Máx, unidad, fórmula) que valida la
--     jefatura y que se aplica como especificación de la OT de evaluación.
-- -----------------------------------------------------------------------------
ALTER TABLE bpch_prototipo ADD COLUMN IF NOT EXISTS param_estado VARCHAR(15) NOT NULL DEFAULT 'sin_parametros';
ALTER TABLE bpch_prototipo ADD COLUMN IF NOT EXISTS param_enviada_por UUID REFERENCES usuario(id);
ALTER TABLE bpch_prototipo ADD COLUMN IF NOT EXISTS param_enviada_at TIMESTAMPTZ;
ALTER TABLE bpch_prototipo ADD COLUMN IF NOT EXISTS param_validada_por UUID REFERENCES usuario(id);
ALTER TABLE bpch_prototipo ADD COLUMN IF NOT EXISTS param_validada_at TIMESTAMPTZ;
ALTER TABLE bpch_prototipo ADD COLUMN IF NOT EXISTS param_devuelta_motivo TEXT;
ALTER TABLE bpch_prototipo DROP CONSTRAINT IF EXISTS ck_bpch_proto_param_estado;
ALTER TABLE bpch_prototipo ADD CONSTRAINT ck_bpch_proto_param_estado
  CHECK (param_estado IN ('sin_parametros', 'borrador', 'en_validacion', 'validada', 'devuelta'));

CREATE TABLE IF NOT EXISTS bpch_prototipo_parametro (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenant(id),
  prototipo_id   UUID          NOT NULL REFERENCES bpch_prototipo(id),
  orden          INTEGER       NOT NULL DEFAULT 0,
  cat_metodo_id  UUID          NOT NULL REFERENCES cat_metodo(id),
  ensayo         VARCHAR(200)  NOT NULL,
  minimo         NUMERIC(18, 6),
  nominal        NUMERIC(18, 6),
  maximo         NUMERIC(18, 6),
  unidad         VARCHAR(30),
  formula        VARCHAR(500),
  tipo_formula   VARCHAR(12)   CHECK (tipo_formula IS NULL OR tipo_formula IN ('general', 'especifica'))
);
CREATE INDEX IF NOT EXISTS ix_bpch_prototipo_parametro ON bpch_prototipo_parametro (prototipo_id, orden);
COMMENT ON TABLE bpch_prototipo_parametro IS 'Panel del elemento nuevo de un prototipo (EP-08 8.11): lo prepara el analista, lo valida la jefatura y se aplica como especificación de la OT.';

INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'bpch_prototipo', 'exige_parametrizacion', 'La OT de evaluación exige la parametrización validada del elemento (si | no)', 1, 'no'
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
