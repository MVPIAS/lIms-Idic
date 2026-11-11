-- =============================================================================
-- LIMS IDIC · Evaluación del ensayo: con condición, requisito sin condición o
-- solo resultado · Aiuken
--   Sesiones en preproducción (Químico 29-10, LPN 30-10, LME 02-11): por
--   ensayo, el laboratorio decide si el resultado se contrasta con el requisito
--   (Cumple / No cumple), si el requisito se muestra solo como referencia, sin
--   condición, o si se informa solo el resultado.
--     con_condicion  · (o NULL) veredicto contra Mín / Nom / Máx o el requisito.
--     sin_condicion  · se informa el requisito; veredicto «informativo».
--     solo_resultado · ni requisito ni condición; veredicto «informativo».
--   Valor por defecto en el catálogo (cat_especificacion) y copia en el
--   resultado de la OT, ajustable por la jefatura. Idempotente.
-- =============================================================================

ALTER TABLE cat_especificacion ADD COLUMN IF NOT EXISTS evaluacion VARCHAR(16);
ALTER TABLE resultado          ADD COLUMN IF NOT EXISTS evaluacion VARCHAR(16);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cat_especificacion_evaluacion') THEN
    ALTER TABLE cat_especificacion ADD CONSTRAINT ck_cat_especificacion_evaluacion
      CHECK (evaluacion IS NULL OR evaluacion IN ('con_condicion', 'sin_condicion', 'solo_resultado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_resultado_evaluacion') THEN
    ALTER TABLE resultado ADD CONSTRAINT ck_resultado_evaluacion
      CHECK (evaluacion IS NULL OR evaluacion IN ('con_condicion', 'sin_condicion', 'solo_resultado'));
  END IF;
END $$;

COMMENT ON COLUMN cat_especificacion.evaluacion IS 'con_condicion (o NULL) | sin_condicion (requisito como referencia, veredicto informativo) | solo_resultado';
COMMENT ON COLUMN resultado.evaluacion          IS 'Copia de cat_especificacion.evaluacion al generar el ensayo; la jefatura la ajusta en la OT.';
