-- =============================================================================
-- align_qc.sql · CONTROL DE CALIDAD ligado al FLUJO NUEVO (OT/muestra/puente)
-- -----------------------------------------------------------------------------
-- Aditivo (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS), idempotente,
-- multi-tenant. NO toca `qc_corrida` (que cuelga del `corrida` legacy): esta
-- alineación crea el QC del flujo real, colgado de la ORDEN DE TRABAJO y del
-- método de catálogo v2 (`cat_metodo`).
--
-- Requisitos de contrato 4.2.3 / 4.2.4 / 4.3.7 / 4.3.8: curvas de calibración,
-- blancos, estándares y duplicados; y BLOQUEO de la emisión de informe si el QC
-- exigido por un método presente en la OT no está aprobado.
-- =============================================================================

-- --------------------------------------------------------------- cat_metodo ---
-- Marca los métodos que EXIGEN un QC aprobado antes de publicar/emitir informe.
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS qc_requerido BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN cat_metodo.qc_requerido IS 'Si true, la OT no puede emitir informe hasta tener un qc_control aprobado para este método (contrato 4.3.7/4.3.8).';

-- --------------------------------------------------------------- qc_control ---
-- Un control de calidad (blanco | estandar | curva | duplicado) registrado
-- contra una OT y un método de catálogo. La evaluación (aprobado/rechazado) la
-- calcula el backend al registrar; puede reevaluarse a mano (aprobado_por).
CREATE TABLE IF NOT EXISTS qc_control (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenant(id),
  ot_id            UUID NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  cat_metodo_id    UUID NOT NULL REFERENCES cat_metodo(id),
  tipo             VARCHAR(30) NOT NULL,               -- blanco | estandar | curva | duplicado
  valor_esperado   NUMERIC,
  valor_obtenido   NUMERIC,
  criterio         TEXT,                               -- LD (blanco), rango "80-120" (estandar), umbral (curva/duplicado)
  resultado        VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- aprobado | rechazado | pendiente
  r_cuadrado       NUMERIC,                            -- R² para curvas de calibración
  recuperacion_pct NUMERIC,                            -- %recuperación para estándares
  cv_pct           NUMERIC,                            -- %CV para duplicados
  aprobado_por     VARCHAR(120),
  aprobado_at      TIMESTAMPTZ,
  observaciones    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_qc_control_ot     ON qc_control(ot_id);
CREATE INDEX IF NOT EXISTS idx_qc_control_metodo ON qc_control(cat_metodo_id);
CREATE INDEX IF NOT EXISTS idx_qc_control_tenant ON qc_control(tenant_id);

COMMENT ON TABLE qc_control IS 'Control de calidad del flujo real (blancos/estándares/curvas/duplicados) por OT × cat_metodo. Bloquea la emisión de informe si un método con qc_requerido no tiene control aprobado.';
