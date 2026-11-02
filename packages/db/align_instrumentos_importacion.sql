-- =============================================================================
-- Adquisición de datos desde instrumentos · contrato §4.4.6 y §4.4.7
--
-- instrumento_perfil: cómo exporta cada instrumento (CSV, TXT o XML; separador,
-- decimal, cabecera y columnas de muestra, ensayo y valor; equivalencias de
-- nombres). Puede ligarse al equipo (queda como equipo usado del ensayo) y a
-- una carpeta del servidor que el LIMS revisa sola (lectura automática).
--
-- instrumento_importacion: cada archivo leído, con su contenido íntegro
-- (dato bruto, SHA-256), la vista previa fila a fila y lo que se aplicó. Los
-- valores entran por la captura estándar del laboratorio (mismas reglas:
-- alcance, equipo apto, corrección con motivo, reglas de aceptación) y quedan
-- como capturados, pendientes de revisión.
--
-- Permisos: instrumento.importar (todo rol con resultado.crear) e
-- instrumento.configurar (jefaturas, Calidad y Administración). Aditivo e idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS instrumento_perfil (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  nombre            VARCHAR(120) NOT NULL,
  descripcion       TEXT,
  equipo_id         UUID REFERENCES equipo(id),
  unidad_id         UUID REFERENCES unidad(id),
  formato           VARCHAR(4) NOT NULL DEFAULT 'CSV',
  separador         VARCHAR(10) NOT NULL DEFAULT 'auto',
  decimal           VARCHAR(1) NOT NULL DEFAULT ',',
  fila_cabecera     SMALLINT NOT NULL DEFAULT 1,
  elemento_registro VARCHAR(80),
  col_muestra       VARCHAR(80) NOT NULL,
  col_ensayo        VARCHAR(80),
  col_valor         VARCHAR(80) NOT NULL,
  col_unidad        VARCHAR(80),
  col_fecha         VARCHAR(80),
  ensayo_fijo       VARCHAR(120),
  equivalencias     JSONB NOT NULL DEFAULT '{}'::jsonb,
  carpeta           VARCHAR(80),                         -- subcarpeta de INSTRUMENTOS_DIR que se lee sola
  responsable_id    UUID REFERENCES usuario(id),         -- analista a cuyo nombre se capturan las lecturas automáticas
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por        UUID REFERENCES usuario(id),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT ck_instr_perfil_formato CHECK (formato IN ('CSV', 'TXT', 'XML')),
  CONSTRAINT ck_instr_perfil_decimal CHECK (decimal IN (',', '.')),
  CONSTRAINT ck_instr_perfil_xml CHECK (formato <> 'XML' OR elemento_registro IS NOT NULL),
  CONSTRAINT ck_instr_perfil_ensayo CHECK (col_ensayo IS NOT NULL OR ensayo_fijo IS NOT NULL),
  CONSTRAINT ck_instr_perfil_carpeta CHECK (carpeta IS NULL OR (carpeta ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' AND responsable_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_instr_perfil_nombre ON instrumento_perfil (tenant_id, lower(nombre)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_instr_perfil_carpeta ON instrumento_perfil (tenant_id, lower(carpeta)) WHERE deleted_at IS NULL AND carpeta IS NOT NULL;

CREATE TABLE IF NOT EXISTS instrumento_importacion (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  perfil_id      UUID NOT NULL REFERENCES instrumento_perfil(id),
  origen         VARCHAR(8) NOT NULL DEFAULT 'MANUAL',
  archivo_nombre VARCHAR(220) NOT NULL,
  archivo_bytes  INT NOT NULL,
  hash_sha256    CHAR(64) NOT NULL,
  contenido      TEXT NOT NULL,                          -- base64 del archivo tal como llegó (dato bruto)
  ot_id          UUID REFERENCES orden_trabajo(id),
  estado         VARCHAR(10) NOT NULL DEFAULT 'PREVISTA',
  filas          JSONB NOT NULL DEFAULT '[]'::jsonb,     -- vista previa y resultado de cada fila
  total          INT NOT NULL DEFAULT 0,
  aplicadas      INT NOT NULL DEFAULT 0,
  con_error      INT NOT NULL DEFAULT 0,
  usuario_id     UUID REFERENCES usuario(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  aplicado_en    TIMESTAMPTZ,
  CONSTRAINT ck_instr_imp_origen CHECK (origen IN ('MANUAL', 'CARPETA')),
  CONSTRAINT ck_instr_imp_estado CHECK (estado IN ('PREVISTA', 'APLICADA', 'DESCARTADA', 'ERROR'))
);
CREATE INDEX IF NOT EXISTS idx_instr_imp_perfil ON instrumento_importacion (perfil_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_instr_imp_hash ON instrumento_importacion (tenant_id, hash_sha256);

COMMENT ON TABLE instrumento_perfil IS 'Instrumentos (§4.4.6/§4.4.7): perfil de lectura del archivo que exporta cada instrumento; carpeta = lectura automática.';
COMMENT ON TABLE instrumento_importacion IS 'Instrumentos (§4.4.7): archivo leído (dato bruto en base64 + SHA-256), vista previa por fila y resultado de la aplicación.';

-- --------------------------------------------------------------- permisos ---
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'instrumento.importar', 'instrumento', 'importar',
   'Instrumentos: cargar el archivo de un instrumento, revisar la vista previa y capturar sus valores en los ensayos de la OT.'),
  (gen_random_uuid(), 'instrumento.configurar', 'instrumento', 'configurar',
   'Instrumentos: crear y modificar perfiles de importación (formato, columnas, equivalencias, carpeta de lectura automática).')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso po ON po.id = rp.permiso_id AND po.codigo = 'resultado.crear'
  JOIN permiso p  ON p.codigo = 'instrumento.importar'
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('JEFE_LAB'), ('JEFE_SECCION'), ('JEFE_DEPTO'), ('CALIDAD'), ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'instrumento.configurar'
ON CONFLICT DO NOTHING;
