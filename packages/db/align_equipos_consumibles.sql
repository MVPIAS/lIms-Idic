-- =============================================================================
-- Bloque A · Equipos y consumibles (contrato §4.4.3, §4.4.4, §4.4.5)
--
--   1 · Unidad de consumo distinta de la de compra: el consumible se compra en
--       envases (frasco de 500 mL, caja de 100 viales) y se consume en su
--       unidad de medida; el factor convierte una en otra.
--   2 · Consumo por método: cuánto consume cada determinación de un método, y
--       descuento automático del stock (FIFO por caducidad) al capturar.
--   3 · Plan de mantención preventiva por equipo (frecuencia y próxima fecha),
--       mantenciones ejecutadas contra el plan y reportes de gestión.
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt).
-- =============================================================================

-- --- 1 · Unidad de compra y factor -------------------------------------------
ALTER TABLE consumible ADD COLUMN IF NOT EXISTS unidad_compra     VARCHAR(30);
ALTER TABLE consumible ADD COLUMN IF NOT EXISTS factor_conversion NUMERIC;
COMMENT ON COLUMN consumible.unidad_compra IS 'Envase o unidad en que se compra (frasco 500 mL, caja). El stock se lleva en unidad_medida (§4.4.4).';
COMMENT ON COLUMN consumible.factor_conversion IS 'Unidades de consumo (unidad_medida) que trae una unidad de compra.';
DO $$ BEGIN
  ALTER TABLE consumible ADD CONSTRAINT ck_consumible_factor CHECK (factor_conversion IS NULL OR factor_conversion > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- 2 · Consumo por método y descuento automático -------------------------------
CREATE TABLE IF NOT EXISTS cat_metodo_consumible (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  cat_metodo_id  UUID NOT NULL REFERENCES cat_metodo(id) ON DELETE CASCADE,
  consumible_id  UUID NOT NULL REFERENCES consumible(id),
  cantidad       NUMERIC NOT NULL,
  por            VARCHAR(10) NOT NULL DEFAULT 'ensayo',
  nota           VARCHAR(200),
  creado_por     UUID REFERENCES usuario(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_cat_metodo_consumible UNIQUE (cat_metodo_id, consumible_id),
  CONSTRAINT ck_cat_metodo_consumible_cantidad CHECK (cantidad > 0),
  CONSTRAINT ck_cat_metodo_consumible_por CHECK (por IN ('ensayo', 'replica'))
);
COMMENT ON COLUMN cat_metodo_consumible.por IS 'ensayo = la cantidad por cada ensayo capturado; replica = por cada réplica o lectura.';

ALTER TABLE movimiento_consumible ADD COLUMN IF NOT EXISTS resultado_id UUID REFERENCES resultado(id);
ALTER TABLE movimiento_consumible ADD COLUMN IF NOT EXISTS automatico   BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_mov_consumible_resultado ON movimiento_consumible(resultado_id) WHERE resultado_id IS NOT NULL;

-- --- 3 · Plan de mantención preventiva ----------------------------------------------
CREATE TABLE IF NOT EXISTS plan_mantencion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenant(id),
  equipo_id        UUID NOT NULL REFERENCES equipo(id),
  tipo             VARCHAR(20) NOT NULL DEFAULT 'preventiva',
  descripcion      VARCHAR(300) NOT NULL,
  frecuencia_dias  INT NOT NULL,
  proxima_fecha    DATE NOT NULL,
  responsable_id   UUID REFERENCES usuario(id),
  proveedor        VARCHAR(200),
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por       UUID REFERENCES usuario(id),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ,
  CONSTRAINT ck_plan_mantencion_tipo CHECK (tipo IN ('preventiva', 'verificacion', 'limpieza')),
  CONSTRAINT ck_plan_mantencion_frecuencia CHECK (frecuencia_dias BETWEEN 1 AND 3650)
);
CREATE INDEX IF NOT EXISTS idx_plan_mantencion_equipo ON plan_mantencion (equipo_id) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_plan_mantencion_proxima ON plan_mantencion (tenant_id, proxima_fecha) WHERE activo;

ALTER TABLE mantencion ADD COLUMN IF NOT EXISTS tenant_id         UUID REFERENCES tenant(id);
ALTER TABLE mantencion ADD COLUMN IF NOT EXISTS plan_id           UUID REFERENCES plan_mantencion(id);
ALTER TABLE mantencion ADD COLUMN IF NOT EXISTS fecha_programada  DATE;
ALTER TABLE mantencion ADD COLUMN IF NOT EXISTS resultado         VARCHAR(30);
ALTER TABLE mantencion ADD COLUMN IF NOT EXISTS registrada_por    UUID REFERENCES usuario(id);
UPDATE mantencion m SET tenant_id = e.tenant_id FROM equipo e WHERE e.id = m.equipo_id AND m.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_mantencion_equipo_fecha ON mantencion (equipo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_mantencion_plan ON mantencion (plan_id) WHERE plan_id IS NOT NULL;

-- --- Parámetros (Catálogo › Parámetros · consumibles) ----------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('consumibles', 'descuento_automatico',
   'Descontar del stock, al capturar un ensayo, los consumibles configurados para su método (si | no)', 1, 'si'),
  ('consumibles', 'sin_stock',
   'Si no hay stock suficiente al capturar: avisar (se captura y queda el faltante) o impedir la captura (avisar | impedir)', 2, 'avisar')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
