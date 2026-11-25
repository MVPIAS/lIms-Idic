-- =============================================================================
-- align_ot_migradas.sql · OT migradas del sistema anterior
-- -----------------------------------------------------------------------------
-- El IDIC pide distinguir en pantalla las OT que llegan de la migración
-- (StarLIMS/LINKS: solo cerradas y completas desde el 01-01-2024) de las que
-- se crean en el LIMS desde la puesta en producción.
--
--   origen_registro  'LIMS' (por defecto, toda OT creada en el sistema) o
--                    'MIGRACION' (la fija el ETL de 07_migracion al insertar).
--                    No confundir con origen_trabajo (COTIZACION, INTERNACION…),
--                    que es el motivo de la OT y no cambia.
--   migrada_desde    folio original en el sistema anterior (FOLDERNO).
--   migrada_en       cuándo se cargó.
--
-- La marca es solo de pantalla (listas, bandejas, detalle, Zona de informes):
-- no aparece en informes, certificados ni PDF oficiales.
--
-- Una OT ya cargada sin la marca se corrige con (ver sql/40_operativo.sql del ETL):
--   UPDATE orden_trabajo o
--      SET origen_registro = 'MIGRACION',
--          migrada_desde   = btrim(f."FOLDERNO"),
--          migrada_en      = COALESCE(o.migrada_en, now())
--     FROM stg_lims.folders f
--    WHERE o.codigo = 'OT-' || btrim(f."FOLDERNO")
--      AND o.origen_registro <> 'MIGRACION';
--
-- Aditivo e idempotente. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
-- =============================================================================

BEGIN;

ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS origen_registro VARCHAR(12) NOT NULL DEFAULT 'LIMS';
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS migrada_desde   TEXT;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS migrada_en      TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_origen_registro') THEN
    ALTER TABLE orden_trabajo
      ADD CONSTRAINT ck_ot_origen_registro CHECK (origen_registro IN ('LIMS', 'MIGRACION'));
  END IF;
END $$;

-- Las migradas son pocas frente al total con el paso del tiempo: índice parcial
-- para el filtro «Origen: Migradas».
CREATE INDEX IF NOT EXISTS idx_ot_migradas ON orden_trabajo (tenant_id, created_at) WHERE origen_registro = 'MIGRACION';

COMMENT ON COLUMN orden_trabajo.origen_registro IS
  'LIMS = creada en el sistema; MIGRACION = cargada desde el sistema anterior (StarLIMS/LINKS). Solo se marca en pantalla, nunca en documentos oficiales.';
COMMENT ON COLUMN orden_trabajo.migrada_desde IS 'Folio de la OT en el sistema anterior (FOLDERNO).';
COMMENT ON COLUMN orden_trabajo.migrada_en IS 'Fecha y hora de la carga desde el sistema anterior.';

COMMIT;
