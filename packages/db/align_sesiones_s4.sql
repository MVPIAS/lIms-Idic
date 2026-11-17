-- =============================================================================
-- LIMS IDIC · Sesiones de preproducción · frente S4 · Aiuken
--   Costo real de la OT, bodegas y exportaciones (reuniones R1, R2, R5, R9, R10
--   y documento Z26 del IDIC «Exportación de datos y generación de bases de datos»).
--
--   1. Bodega central y sub-bodegas por laboratorio (contrato 4.4.4 y 4.4.5).
--      · Tabla `bodega` (central | laboratorio). Cada lote de consumible queda en
--        una bodega; los lotes que ya existían pasan a la bodega central.
--      · Inventario valorizado por lote: `lote_consumible.costo_unitario_clp`
--        (precio de compra del lote). Sin él, se usa el costo de referencia del
--        consumible. El IDIC aún no entrega el costo de los insumos: «Pendiente
--        del IDIC» (la tabla nace sin valores).
--      · Traspaso entre bodegas: movimiento «traspaso» (con signo) en el lote de
--        origen y en el de destino, unidos por `traspaso_id`. Un mismo número de
--        lote puede estar en varias bodegas (índice único por bodega).
--      · Se crea la bodega central y una sub-bodega por cada unidad de tipo
--        LABORATORIO. El IDIC confirma la lista real de bodegas (se editan en
--        Consumibles › Bodegas).
--   2. Semáforo de lo cotizado frente a lo real (parámetros «costo_real»):
--      umbrales de la desviación del costo real sobre el estimado. Valores de
--      ejemplo por confirmar con SPC.
--   3. Consumo por bodega (parámetro consumibles.bodega_consumo).
-- Idempotente. Sin datos reales del IDIC.
-- =============================================================================

-- --- 1. Bodegas ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bodega (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  codigo      VARCHAR(30)  NOT NULL,
  nombre      VARCHAR(160) NOT NULL,
  -- central | laboratorio
  tipo        VARCHAR(20)  NOT NULL DEFAULT 'laboratorio',
  -- Laboratorio dueño de la sub-bodega (NULL en la central).
  unidad_id   UUID         REFERENCES unidad(id),
  ubicacion   VARCHAR(200),
  activa      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_bodega_tipo CHECK (tipo IN ('central', 'laboratorio')),
  CONSTRAINT ck_bodega_unidad CHECK ((tipo = 'central' AND unidad_id IS NULL) OR (tipo = 'laboratorio' AND unidad_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bodega_codigo ON bodega (tenant_id, codigo);
-- Una sola bodega central por institución.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bodega_central ON bodega (tenant_id) WHERE tipo = 'central';
CREATE INDEX IF NOT EXISTS ix_bodega_unidad ON bodega (tenant_id, unidad_id);
COMMENT ON TABLE bodega IS
  'Bodega central y sub-bodegas por laboratorio (contrato 4.4.4). Cada lote de consumible está en una bodega.';

INSERT INTO bodega (tenant_id, codigo, nombre, tipo)
SELECT t.id, 'BC', 'Bodega central', 'central'
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM bodega b WHERE b.tenant_id = t.id AND b.tipo = 'central')
ON CONFLICT DO NOTHING;

INSERT INTO bodega (tenant_id, codigo, nombre, tipo, unidad_id)
SELECT u.tenant_id, 'SB-' || u.codigo, 'Sub-bodega ' || u.nombre, 'laboratorio', u.id
  FROM unidad u
 WHERE u.tipo = 'LABORATORIO'
   AND NOT EXISTS (SELECT 1 FROM bodega b WHERE b.tenant_id = u.tenant_id AND b.unidad_id = u.id)
ON CONFLICT DO NOTHING;

-- --- 1b. Lotes en bodega y valorizados -------------------------------------------
ALTER TABLE lote_consumible ADD COLUMN IF NOT EXISTS bodega_id UUID REFERENCES bodega(id);
ALTER TABLE lote_consumible ADD COLUMN IF NOT EXISTS costo_unitario_clp NUMERIC(14,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_lote_costo_unitario') THEN
    ALTER TABLE lote_consumible ADD CONSTRAINT ck_lote_costo_unitario CHECK (costo_unitario_clp IS NULL OR costo_unitario_clp >= 0);
  END IF;
END $$;
COMMENT ON COLUMN lote_consumible.costo_unitario_clp IS
  'Precio de compra por unidad de consumo del lote (CLP). Valoriza el inventario y el consumo; sin él rige consumible.costo_unitario_clp.';

-- Lotes sin bodega → bodega central de su institución.
UPDATE lote_consumible l
   SET bodega_id = b.id
  FROM bodega b
 WHERE l.bodega_id IS NULL AND b.tenant_id = l.tenant_id AND b.tipo = 'central';

CREATE INDEX IF NOT EXISTS ix_lote_consumible_bodega ON lote_consumible (bodega_id, consumible_id);

-- Un mismo número de lote puede estar repartido en varias bodegas (traspasos).
-- Se conserva el nombre del índice: la API lo reconoce para el mensaje de duplicado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lote_consumible_consumible_id_numero_lote_key') THEN
    ALTER TABLE lote_consumible DROP CONSTRAINT lote_consumible_consumible_id_numero_lote_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'lote_consumible_consumible_id_numero_lote_key') THEN
    CREATE UNIQUE INDEX lote_consumible_consumible_id_numero_lote_key
      ON lote_consumible (consumible_id, numero_lote, COALESCE(bodega_id, '00000000-0000-0000-0000-000000000000'::uuid));
  END IF;
END $$;

-- --- 1c. Traspasos en el kardex ---------------------------------------------------
ALTER TABLE movimiento_consumible ADD COLUMN IF NOT EXISTS traspaso_id UUID;
CREATE INDEX IF NOT EXISTS ix_mov_consumible_traspaso ON movimiento_consumible (traspaso_id) WHERE traspaso_id IS NOT NULL;
ALTER TABLE movimiento_consumible DROP CONSTRAINT IF EXISTS movimiento_consumible_tipo_check;
ALTER TABLE movimiento_consumible ADD CONSTRAINT movimiento_consumible_tipo_check
  CHECK (tipo IN ('entrada', 'consumo', 'ajuste', 'traspaso'));
COMMENT ON COLUMN movimiento_consumible.traspaso_id IS
  'Traspaso entre bodegas: une la salida (cantidad negativa) del lote de origen con la entrada (positiva) del lote de destino.';

-- --- 2 y 3. Parámetros ------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.valor, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
   ('costo_real', 'semaforo_amarillo_pct', 'Semáforo del costo real: amarillo desde esta desviación sobre lo estimado, % (valor de ejemplo)', '10', 1),
   ('costo_real', 'semaforo_rojo_pct',     'Semáforo del costo real: rojo desde esta desviación sobre lo estimado, % (valor de ejemplo)',     '20', 2),
   ('consumibles', 'bodega_consumo',       'De qué bodegas descuenta un consumo de laboratorio (laboratorio_primero | solo_laboratorio | todas)', 'laboratorio_primero', 3)
 ) AS v(categoria, codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
