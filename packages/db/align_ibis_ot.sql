-- =============================================================================
-- align_ibis_ot.sql · Rediseño del modelo IBIS/SAEC para el IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- CORRECCIÓN DE MODELO. El IDIC NO gestiona casos criminales: controla las
-- ARMAS QUE SE IMPORTAN AL PAÍS. El flujo real es:
--   1. Se crea una ORDEN DE TRABAJO (OT) de importación que lista las armas
--      (por número de serie) que entran al país.
--   2. IBIS/Forensic deja UN XML DIARIO en una CARPETA (ETL, no subida visual).
--      Ese XML trae los resultados balísticos de MUCHAS armas de distinto origen.
--   3. El ETL barre la carpeta y vuelca cada arma del XML a un POOL de
--      resultados (ibis_resultado). En administración queda un REGISTRO de qué
--      XML se cargaron (ibis_importacion), nada más.
--   4. Al hacerse la prueba de una OT, el perito toma DEL POOL sólo las armas de
--      ESA OT (match por número de serie) y las adjunta a la OT.
--
-- Idempotente: se puede aplicar varias veces sin efectos secundarios.
-- =============================================================================

-- 1) Una arma puede pertenecer a una OT de importación -------------------------
ALTER TABLE arma ADD COLUMN IF NOT EXISTS ot_id UUID REFERENCES orden_trabajo(id);
CREATE INDEX IF NOT EXISTS idx_arma_ot ON arma(tenant_id, ot_id) WHERE deleted_at IS NULL;
-- El número de serie es la CLAVE DE MATCH con el pool IBIS. Índice para el cruce.
CREATE INDEX IF NOT EXISTS idx_arma_serie ON arma(tenant_id, serie) WHERE deleted_at IS NULL;

-- 2) POOL de resultados balísticos importados desde IBIS -----------------------
--    Una fila por arma/exhibit que viene en un XML. Al principio queda en el
--    pool sin OT; se asigna a una OT cuando el perito la adjunta.
CREATE TABLE IF NOT EXISTS ibis_resultado (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ibis_importacion_id UUID NOT NULL REFERENCES ibis_importacion(id),
  -- Identificación del arma tal como viene en el XML ESI
  uuid_ibis           VARCHAR(80),                    -- UUID/Id del exhibit en Forensic
  exhibit_number      VARCHAR(80),
  serie               VARCHAR(80),                    -- número de serie · CLAVE DE MATCH con arma.serie
  marca               VARCHAR(120),
  modelo              VARCHAR(120),
  calibre             VARCHAR(80),
  tipo                VARCHAR(40),                    -- pistola, revolver, fusil, ...
  -- Datos balísticos de la prueba
  firing_pin_shape    VARCHAR(120),
  breech_face_class   VARCHAR(120),
  hit_count           INT DEFAULT 0,
  resultado           VARCHAR(30),                    -- concluyente, sin_coincidencia, ...
  fecha_prueba        TIMESTAMPTZ,
  datos              JSONB DEFAULT '{}',              -- volcado completo del exhibit (auditoría)
  -- Estado de asignación al pool
  estado              VARCHAR(20) NOT NULL DEFAULT 'pool', -- pool, asignado, descartado
  arma_id             UUID REFERENCES arma(id),       -- arma del IDIC a la que se adjuntó
  ot_id               UUID REFERENCES orden_trabajo(id),
  asignado_por        UUID REFERENCES usuario(id),
  asignado_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ibis_res_tenant   ON ibis_resultado(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ibis_res_serie    ON ibis_resultado(tenant_id, serie)           WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ibis_res_estado   ON ibis_resultado(tenant_id, estado)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ibis_res_ot       ON ibis_resultado(tenant_id, ot_id)           WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ibis_res_import   ON ibis_resultado(ibis_importacion_id);
-- No reprocesar el mismo exhibit del mismo archivo dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ibis_res_import_uuid
  ON ibis_resultado(ibis_importacion_id, uuid_ibis) WHERE uuid_ibis IS NOT NULL AND deleted_at IS NULL;

-- 3) Contador de resultados volcados al pool en la bitácora de importación -----
ALTER TABLE ibis_importacion ADD COLUMN IF NOT EXISTS resultados_creados INT DEFAULT 0;
ALTER TABLE ibis_importacion ADD COLUMN IF NOT EXISTS origen_barrido VARCHAR(20) DEFAULT 'manual'; -- manual | carpeta

-- 4) Configuración del ETL por CARPETA (una sola fila por tenant) ---------------
CREATE TABLE IF NOT EXISTS configuracion_ibis (
  tenant_id           UUID PRIMARY KEY REFERENCES tenant(id),
  carpeta_entrada     VARCHAR(500) NOT NULL DEFAULT '/data/ibis/entrada',
  carpeta_procesados  VARCHAR(500) NOT NULL DEFAULT '/data/ibis/procesados',
  carpeta_errores     VARCHAR(500) NOT NULL DEFAULT '/data/ibis/errores',
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_barrido_at   TIMESTAMPTZ,
  ultimo_barrido_res  JSONB DEFAULT '{}',
  updated_at          TIMESTAMPTZ DEFAULT now(),
  updated_by          UUID REFERENCES usuario(id)
);

-- 5) Permisos del nuevo flujo (idempotente) ------------------------------------
INSERT INTO permiso (codigo, modulo, accion, descripcion)
VALUES
  ('ibis.barrer',  'saec', 'importar', 'Barrer la carpeta ETL de IBIS e importar los XML'),
  ('ibis.asignar', 'saec', 'asignar',  'Adjuntar resultados balísticos IBIS a las armas de una OT'),
  ('ibis.config',  'saec', 'config',   'Configurar la carpeta ETL de IBIS')
ON CONFLICT (codigo) DO NOTHING;

-- Se otorgan a los roles que ya tenían ibis.importar (perito balístico / admin).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso pi ON pi.id = rp.permiso_id AND pi.codigo = 'ibis.importar'
  JOIN permiso p  ON p.codigo IN ('ibis.barrer', 'ibis.asignar', 'ibis.config')
ON CONFLICT DO NOTHING;
