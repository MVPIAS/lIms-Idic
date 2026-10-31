-- =============================================================================
-- LIMS IDIC · QC microbiológico por lote (EP-02 ALI-D6, paso 3.9) · Aiuken
-- =============================================================================
-- Reutiliza el QC existente (qc_control por OT × método, align_qc.sql) en vez
-- de crear un formulario especial: tres tipos de control más del mismo registro.
--   · control positivo  → la cepa de referencia debe crecer: (+)
--   · control negativo  → no debe crecer: (−)
--   · blanco de medio   → el tipo «blanco» de siempre; si se registra con
--                         resultado cualitativo, debe dar (−)
-- Cada control guarda el lote del medio de cultivo y, el positivo, la cepa de
-- referencia ATCC usada (catálogo administrable, 7 cepas de las planillas LMB
-- IT31/IT33/IT34). Si un método exige estos tipos (cat_metodo.qc_tipos) y no
-- están aprobados, el gate de emisión ya existente bloquea el documento de la
-- OT (contrato §4.2.3–4.2.4 / §4.3.7–4.3.8).
-- Datos: las 7 cepas son las que usa el IDIC (EP-02 §3.3), no inventadas.
-- Aditivo e idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS qc_cepa_referencia (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  numero      INT,                                -- número de la cepa en la planilla (1 a 7)
  codigo      VARCHAR(40)  NOT NULL,              -- 'ATCC 25922'
  organismo   VARCHAR(120) NOT NULL,              -- 'Escherichia coli'
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT ux_qc_cepa UNIQUE (tenant_id, codigo)
);
COMMENT ON TABLE qc_cepa_referencia IS
  'Cepas de referencia (ATCC) para el control positivo del QC microbiológico. Catálogo administrable (catalogo.gestionar).';

INSERT INTO qc_cepa_referencia (tenant_id, numero, codigo, organismo)
SELECT t.id, c.numero, c.codigo, c.organismo
  FROM tenant t
 CROSS JOIN (VALUES
   (1, 'ATCC 25922', 'Escherichia coli'),
   (2, 'ATCC 25923', 'Staphylococcus aureus'),
   (3, 'ATCC 12228', 'Staphylococcus epidermidis'),
   (4, 'ATCC 13124', 'Clostridium perfringens'),
   (5, 'ATCC 13048', 'Klebsiella aerogenes'),
   (6, 'ATCC 10876', 'Bacillus cereus'),
   (7, 'ATCC 14028', 'Salmonella Typhimurium')
 ) AS c(numero, codigo, organismo)
 WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

ALTER TABLE qc_control ADD COLUMN IF NOT EXISTS resultado_cualitativo VARCHAR(1);
ALTER TABLE qc_control ADD COLUMN IF NOT EXISTS lote_medio            VARCHAR(80);
ALTER TABLE qc_control ADD COLUMN IF NOT EXISTS cepa_id               UUID REFERENCES qc_cepa_referencia(id);
DO $$ BEGIN
  ALTER TABLE qc_control ADD CONSTRAINT ck_qc_control_cualitativo CHECK (resultado_cualitativo IN ('+', '-'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN qc_control.resultado_cualitativo IS 'QC microbiológico: (+) crece / (−) no crece. Positivo debe dar +, negativo y blanco −.';
COMMENT ON COLUMN qc_control.lote_medio IS 'Lote del medio de cultivo con que se corrió el control.';
COMMENT ON COLUMN qc_control.cepa_id IS 'Cepa de referencia ATCC del control positivo.';
