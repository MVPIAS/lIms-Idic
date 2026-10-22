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
