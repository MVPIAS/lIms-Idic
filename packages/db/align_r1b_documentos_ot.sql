-- =============================================================================
-- align_r1b_documentos_ot.sql · Varios documentos vigentes por OT
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt. Reglas: docs/FLUJO_DOCUMENTOS_POR_OT.md.
--
-- Hasta ahora una OT admitía UN documento vigente por plantilla. Las
-- especificaciones piden varios (tema transversal T02):
--   · LQC: un informe por muestra cuando la OT lo pide (EP-01 5.1);
--   · LPN: un IE por producto, con registro del IE no emitido y su motivo (EP-01 5.1);
--   · Alimentos: uno por laboratorio cuando la muestra pasa por LQA, LMB y LES
--     (EP-02 4.2 y 5.1, por confirmar: EP-02 P5).
-- Cada documento lleva su cobertura, su circuito de firmas (resuelto con el
-- laboratorio que cubre), su entrega y su cuenta para el cierre de la OT.
--
--   1. certificado: cobertura (ot | muestra | producto | laboratorio), muestras
--      que cubre, laboratorio que cubre, etiqueta y marca «no emitido».
--   2. documento_cobertura_unidad: cobertura que se propone por laboratorio
--      (configurable; la hereda la unidad hija). Se siembra UNA vez.
-- Sin permisos nuevos: emitir y registrar «no emitido», certificado.emitir.
-- =============================================================================

-- --- 1 · Cobertura del documento --------------------------------------------
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS cobertura           VARCHAR(12) NOT NULL DEFAULT 'ot';
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS muestra_ids         UUID[]      NOT NULL DEFAULT '{}';
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS unidad_cobertura    UUID        REFERENCES unidad(id);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS cobertura_etiqueta  VARCHAR(200);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS no_emitido          BOOLEAN     NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN certificado.cobertura IS
  'Qué cubre el documento: ot (toda la OT), muestra, producto (muestras de un mismo producto) o laboratorio (sus resultados). Varios vigentes por OT si no se solapan.';
COMMENT ON COLUMN certificado.muestra_ids IS 'Muestras que cubre (cobertura muestra o producto).';
COMMENT ON COLUMN certificado.unidad_cobertura IS 'Laboratorio que cubre (cobertura laboratorio); sus firmas se resuelven con esa unidad.';
COMMENT ON COLUMN certificado.no_emitido IS
  'Número reservado para un documento que no se emite (IE de LPN «la muestra no forma película»): queda anulado con su motivo y cubre su muestra para el cierre.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_certificado_cobertura') THEN
    ALTER TABLE certificado ADD CONSTRAINT ck_certificado_cobertura CHECK (
      cobertura IN ('ot', 'muestra', 'producto', 'laboratorio')
      AND (cobertura NOT IN ('muestra', 'producto') OR cardinality(muestra_ids) > 0)
      AND (cobertura <> 'laboratorio' OR unidad_cobertura IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_certificado_no_emitido') THEN
    ALTER TABLE certificado ADD CONSTRAINT ck_certificado_no_emitido CHECK (NOT no_emitido OR estado = 'anulado');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_certificado_ot_plantilla ON certificado (ot_id, plantilla_id) WHERE deleted_at IS NULL;

-- --- 2 · Cobertura que se propone por laboratorio ---------------------------
CREATE TABLE IF NOT EXISTS documento_cobertura_unidad (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID         NOT NULL REFERENCES tenant(id),
  unidad_id      UUID         NOT NULL REFERENCES unidad(id),
  cobertura      VARCHAR(12)  NOT NULL,
  por_confirmar  BOOLEAN      NOT NULL DEFAULT FALSE,
  fuente         TEXT,
  updated_by     UUID         REFERENCES usuario(id),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_documento_cobertura_unidad CHECK (cobertura IN ('ot', 'muestra', 'producto', 'laboratorio')),
  CONSTRAINT uq_documento_cobertura_unidad UNIQUE (tenant_id, unidad_id)
);
COMMENT ON TABLE documento_cobertura_unidad IS
  'Cobertura del documento que la pantalla de emisión propone por laboratorio (la unidad hija hereda la del ancestro más cercano). Quien emite puede elegir otra.';

INSERT INTO documento_cobertura_unidad (tenant_id, unidad_id, cobertura, por_confirmar, fuente)
SELECT t.id, u.id, v.cobertura, v.por_confirmar, v.fuente
  FROM tenant t
 CROSS JOIN (VALUES
  ('LPN', 'producto',    FALSE, 'EP-01 5.1: un IE por producto (submuestra), correlativo por laboratorio y año.'),
  ('LQC', 'ot',          FALSE, 'EP-01 5.1: un informe por OT; por muestra cuando la OT lo pide (se elige al emitir).'),
  ('SAL', 'laboratorio', TRUE,  'EP-02 4.2 y 5.1: ¿un informe por OT o uno por laboratorio? Por confirmar (EP-02 P5).')
 ) AS v(unidad, cobertura, por_confirmar, fuente)
  JOIN unidad u ON u.tenant_id = t.id AND u.codigo = v.unidad
ON CONFLICT (tenant_id, unidad_id) DO NOTHING;
