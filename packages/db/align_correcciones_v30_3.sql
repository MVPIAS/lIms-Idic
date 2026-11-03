-- =============================================================================
-- Correcciones v30 · 3 · Equipos, consumibles e instrumentos
--
--   1 · Consumos pendientes de descontar (contrato §4.4.5): con la regla
--       consumibles.sin_stock = «avisar», lo que una captura no pudo descontar
--       por falta de stock vigente queda registrado aquí, ligado al resultado,
--       la muestra y el método. Se regulariza desde Consumibles › Consumos
--       pendientes: «descontado» (salida FIFO con su asiento en el kardex) o
--       «descartado» (con motivo, sin tocar el stock).
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt).
-- =============================================================================

CREATE TABLE IF NOT EXISTS consumo_pendiente (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenant(id),
  consumible_id      UUID NOT NULL REFERENCES consumible(id),
  cantidad           NUMERIC NOT NULL CHECK (cantidad > 0),
  muestra_id         UUID REFERENCES muestra(id),
  cat_metodo_id      UUID REFERENCES cat_metodo(id),
  resultado_id       UUID REFERENCES resultado(id),
  referencia         VARCHAR(500),
  estado             VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente', 'descontado', 'descartado')),
  lotes              TEXT,
  motivo_resolucion  TEXT,
  creado_por         UUID REFERENCES usuario(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_por       UUID REFERENCES usuario(id),
  resuelto_en        TIMESTAMPTZ
);
COMMENT ON TABLE consumo_pendiente IS 'Consumo de una captura que no se pudo descontar por falta de stock (regla «avisar»); se regulariza en Consumibles (§4.4.5).';
CREATE INDEX IF NOT EXISTS idx_consumo_pendiente_tenant    ON consumo_pendiente(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_consumo_pendiente_resultado ON consumo_pendiente(resultado_id) WHERE resultado_id IS NOT NULL;
