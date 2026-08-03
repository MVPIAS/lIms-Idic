-- =============================================================================
-- align_consumibles.sql  ·  CONSUMIBLES con lotes/stock/caducidad + KARDEX
-- Contrato 4.4.4 / 4.4.5 · Aditivo e IDEMPOTENTE (puede re-aplicarse sin daño).
--
-- Reutiliza las tablas ya existentes `consumible` y `lote_consumible`
-- (definidas en schema.sql) y añade lo que faltaba para el kardex:
--   1. `lote_consumible.tenant_id`  (para aislar por tenant sin JOIN)
--   2. tabla nueva `movimiento_consumible` (entradas / consumos / ajustes)
--
-- Modelo de stock:
--   · `lote_consumible.cantidad_actual` = stock VIVO del lote (se descuenta).
--   · `lote_consumible.cantidad_inicial` = stock con el que ingresó el lote.
--   · cada cambio de stock deja un asiento en `movimiento_consumible`.
--   · stock del consumible = Σ cantidad_actual de sus lotes
--                          = Σ entradas − Σ consumos ± Σ ajustes.
-- =============================================================================

-- --- 0. Tablas base (no-op si ya existen; portabilidad a BD limpia) ----------
CREATE TABLE IF NOT EXISTS consumible (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  codigo        VARCHAR(40)  NOT NULL,
  nombre        VARCHAR(200) NOT NULL,
  tipo          VARCHAR(40),
  unidad_medida VARCHAR(20),
  proveedor_id  UUID,
  stock_minimo  NUMERIC,
  activo        BOOLEAN DEFAULT TRUE,
  UNIQUE (tenant_id, codigo)
);

CREATE TABLE IF NOT EXISTS lote_consumible (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumible_id     UUID NOT NULL REFERENCES consumible(id),
  numero_lote       VARCHAR(80) NOT NULL,
  fecha_recepcion   DATE,
  fecha_vencimiento DATE,
  cantidad_inicial  NUMERIC,
  cantidad_actual   NUMERIC,
  ubicacion_id      UUID,
  estado            VARCHAR(30) DEFAULT 'disponible',
  UNIQUE (consumible_id, numero_lote)
);

-- --- 1. tenant_id en lote_consumible (aislamiento por tenant) ----------------
ALTER TABLE lote_consumible ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Backfill desde el consumible padre para lotes ya existentes.
UPDATE lote_consumible l
   SET tenant_id = c.tenant_id
  FROM consumible c
 WHERE c.id = l.consumible_id
   AND l.tenant_id IS NULL;

-- FK sólo una vez (idempotente vía catálogo de constraints).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lote_tenant'
  ) THEN
    ALTER TABLE lote_consumible
      ADD CONSTRAINT fk_lote_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lote_consumible_tenant ON lote_consumible(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lote_consumible_consumible ON lote_consumible(consumible_id);

-- --- 2. KARDEX · movimiento_consumible --------------------------------------
CREATE TABLE IF NOT EXISTS movimiento_consumible (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  lote_id       UUID NOT NULL REFERENCES lote_consumible(id),
  tipo          VARCHAR(20) NOT NULL
                  CHECK (tipo IN ('entrada', 'consumo', 'ajuste')),
  cantidad      NUMERIC NOT NULL,           -- magnitud del movimiento (siempre > 0
                                            -- para entrada/consumo; con signo para ajuste)
  muestra_id    UUID REFERENCES muestra(id),        -- consumo asociado a una muestra
  cat_metodo_id UUID REFERENCES cat_metodo(id),     -- consumo asociado a un método
  motivo        TEXT,
  created_by    UUID,                       -- usuario que registró (opcional)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mov_consumible_tenant  ON movimiento_consumible(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mov_consumible_lote    ON movimiento_consumible(lote_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mov_consumible_muestra ON movimiento_consumible(muestra_id);
