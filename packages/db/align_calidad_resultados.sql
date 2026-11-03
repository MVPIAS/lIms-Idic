-- =============================================================================
-- Bloque A · Laboratorio y calidad (contrato §4.2.1, §4.2.6, §4.3.1, §4.3.5, §4.3.9)
--
--   1 · Dictamen «advertencia» (resultado que cumple pero queda cerca de un
--       límite) y margen por método.
--   2 · Re-análisis automático (No cumple / advertencia) y manual: bloquea
--       revisar y aprobar hasta repetir la determinación o descartarlo.
--   3 · POE (procedimiento operativo estándar) vinculado a cada método, desde
--       el gestor documental.
--   4 · Acreditación ISO/IEC 17025: acreditaciones del laboratorio y su
--       alcance por método (vigencia).
--   5 · Alícuotas de una muestra: cantidad, ubicación, estado y consumo.
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt).
-- =============================================================================

-- --- 1 · Advertencia -----------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS advertencia        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS advertencia_motivo TEXT;
COMMENT ON COLUMN resultado.advertencia IS 'Cumple, pero en la zona de advertencia cerca de un límite (contrato §4.2.6). El veredicto sigue siendo «cumple».';

ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS margen_advertencia_pct NUMERIC(6,2);
COMMENT ON COLUMN cat_metodo.margen_advertencia_pct IS 'Margen de advertencia del método en % (vacío = el general de Parámetros › resultados; 0 = sin advertencias).';

-- --- 2 · Re-análisis -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resultado_reanalisis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  resultado_id    UUID NOT NULL REFERENCES resultado(id) ON DELETE CASCADE,
  ot_id           UUID REFERENCES orden_trabajo(id),
  origen          VARCHAR(12) NOT NULL DEFAULT 'automatico',
  motivo          TEXT NOT NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'solicitado',
  valor_anterior  JSONB,
  valor_nuevo     JSONB,
  solicitado_por  UUID REFERENCES usuario(id),
  solicitado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_por     UUID REFERENCES usuario(id),
  cerrado_at      TIMESTAMPTZ,
  cierre_motivo   TEXT,
  CONSTRAINT ck_reanalisis_origen CHECK (origen IN ('automatico', 'manual')),
  CONSTRAINT ck_reanalisis_estado CHECK (estado IN ('solicitado', 'realizado', 'descartado'))
);
-- Un solo re-análisis abierto por ensayo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_reanalisis_abierto ON resultado_reanalisis (resultado_id) WHERE estado = 'solicitado';
CREATE INDEX IF NOT EXISTS idx_reanalisis_ot ON resultado_reanalisis (ot_id, estado);
CREATE INDEX IF NOT EXISTS idx_reanalisis_tenant ON resultado_reanalisis (tenant_id, estado, solicitado_at DESC);

-- --- 3 · POE por método ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cat_metodo_poe (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  cat_metodo_id  UUID NOT NULL REFERENCES cat_metodo(id) ON DELETE CASCADE,
  documento_id   UUID NOT NULL REFERENCES doc_documento(id),
  principal      BOOLEAN NOT NULL DEFAULT TRUE,
  nota           VARCHAR(200),
  creado_por     UUID REFERENCES usuario(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_cat_metodo_poe UNIQUE (cat_metodo_id, documento_id)
);
CREATE INDEX IF NOT EXISTS idx_cat_metodo_poe_doc ON cat_metodo_poe (documento_id);

-- --- 4 · Acreditación ISO/IEC 17025 -------------------------------------------------
CREATE TABLE IF NOT EXISTS acreditacion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  unidad_id       UUID REFERENCES unidad(id),
  organismo       VARCHAR(80) NOT NULL DEFAULT 'INN',
  numero          VARCHAR(40) NOT NULL,
  norma           VARCHAR(80) NOT NULL DEFAULT 'NCh-ISO/IEC 17025',
  vigente_desde   DATE,
  vigente_hasta   DATE,
  observacion     TEXT,
  creado_por      UUID REFERENCES usuario(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT ck_acreditacion_vigencia CHECK (vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_acreditacion_numero ON acreditacion (tenant_id, organismo, numero) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS acreditacion_alcance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acreditacion_id  UUID NOT NULL REFERENCES acreditacion(id) ON DELETE CASCADE,
  cat_metodo_id    UUID NOT NULL REFERENCES cat_metodo(id),
  matriz           VARCHAR(160),
  rango            VARCHAR(120),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_acreditacion_alcance UNIQUE (acreditacion_id, cat_metodo_id)
);
CREATE INDEX IF NOT EXISTS idx_acreditacion_alcance_metodo ON acreditacion_alcance (cat_metodo_id);

-- --- 5 · Alícuotas ---------------------------------------------------------------------
ALTER TABLE alicuota ADD COLUMN IF NOT EXISTS tenant_id          UUID REFERENCES tenant(id);
ALTER TABLE alicuota ADD COLUMN IF NOT EXISTS cantidad_restante  NUMERIC;
ALTER TABLE alicuota ADD COLUMN IF NOT EXISTS proposito          VARCHAR(160);
ALTER TABLE alicuota ADD COLUMN IF NOT EXISTS observacion        TEXT;
ALTER TABLE alicuota ADD COLUMN IF NOT EXISTS creado_por         UUID REFERENCES usuario(id);
ALTER TABLE alicuota ADD COLUMN IF NOT EXISTS actualizado_en     TIMESTAMPTZ;
UPDATE alicuota a SET tenant_id = m.tenant_id FROM muestra m WHERE m.id = a.muestra_id AND a.tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_alicuota_codigo ON alicuota (muestra_id, codigo);
CREATE INDEX IF NOT EXISTS idx_alicuota_muestra ON alicuota (muestra_id);
DO $$ BEGIN
  ALTER TABLE alicuota ADD CONSTRAINT ck_alicuota_estado CHECK (estado IN ('disponible', 'en_uso', 'consumida', 'descartada'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Movimientos de la alícuota (consumo, traslado, cambio de estado): trazabilidad.
CREATE TABLE IF NOT EXISTS alicuota_movimiento (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alicuota_id   UUID NOT NULL REFERENCES alicuota(id) ON DELETE CASCADE,
  tipo          VARCHAR(20) NOT NULL,
  cantidad      NUMERIC,
  estado_desde  VARCHAR(30),
  estado_hasta  VARCHAR(30),
  resultado_id  UUID REFERENCES resultado(id),
  detalle       TEXT,
  usuario_id    UUID REFERENCES usuario(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alicuota_mov ON alicuota_movimiento (alicuota_id, creado_en);

-- --- Parámetros (Catálogo › Parámetros · resultados) -----------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('resultados', 'advertencia_margen_pct',
   'Margen de advertencia: % del intervalo Mín–Máx (o del límite único) en que un resultado que cumple queda «en advertencia» (0 = sin advertencias)', 1, '10'),
  ('resultados', 'reanalisis_automatico',
   'Re-análisis automático al capturar (no | no_cumple | no_cumple_y_advertencia)', 2, 'no_cumple'),
  ('resultados', 'advertencia_correo',
   'Avisar por correo al laboratorio las advertencias y los re-análisis al capturar (si | no)', 3, 'si')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- Permisos -----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'acreditacion.gestionar', 'calidad', 'gestionar',
   'Calidad: mantener las acreditaciones ISO/IEC 17025 del IDIC y su alcance por método.'),
  (gen_random_uuid(), 'alicuota.gestionar', 'muestra', 'gestionar',
   'Muestras: preparar alícuotas, registrar su consumo, traslado y estado.')
ON CONFLICT (codigo) DO NOTHING;

-- acreditacion.gestionar: Calidad, jefaturas y administración.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('CALIDAD'), ('DIRECTOR'), ('SUBDIRECTOR'), ('JEFE_DEPTO'), ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'acreditacion.gestionar'
ON CONFLICT DO NOTHING;

-- alicuota.gestionar: quien captura resultados o recibe muestras.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso po ON po.id = rp.permiso_id AND po.codigo IN ('resultado.crear', 'muestra.crear')
  JOIN rol r      ON r.id = rp.rol_id AND COALESCE(r.alias_de, r.codigo) NOT IN ('CLIENTE', 'LECTOR')
  JOIN permiso p  ON p.codigo = 'alicuota.gestionar'
ON CONFLICT DO NOTHING;
