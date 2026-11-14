-- =============================================================================
-- LIMS IDIC · Frente F4 · Firma Electrónica Avanzada (FEA) en el PDF final · Aiuken
-- =============================================================================
-- El LIMS no sale a internet: no se integra con FirmaGob. El firmante descarga
-- el PDF emitido, lo firma en su equipo y lo sube. Aquí se guardan:
--   · documento_fea_archivo: el PDF emitido que se entregó para firmar
--     («original», congelado byte a byte) y cada PDF firmado subido
--     («firmado»; el vigente es la versión oficial para el cliente).
--   · documento_fea_evento: historial (descarga para firmar, subida,
--     excepción aceptada por una jefatura, rechazo).
-- Cubre los documentos de la tabla `certificado` (informes y certificados por
-- OT, informes del BPCH, certificados por arma de la Delegación Nº 11) y los
-- certificados de calibración de `met_calibracion` (origen «metrologia»).
-- Parámetro «fea» (Parámetros del sistema): por tipo de documento, si se exige
-- la versión firmada antes de entregar o enviar al cliente (por defecto, no).
-- Permiso documento.fea.gestionar: jefaturas (subir en nombre del firmante y
-- aceptar con motivo un PDF que no corresponde al emitido).
-- Aditivo e idempotente. Ver docs/FLUJO_FEA_DOCUMENTOS.md.
-- =============================================================================

CREATE TABLE IF NOT EXISTS documento_fea_archivo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  origen           varchar(20) NOT NULL CHECK (origen IN ('informe', 'metrologia')),
  documento_id     uuid NOT NULL,
  clase            varchar(10) NOT NULL CHECK (clase IN ('original', 'firmado')),
  vigente          boolean NOT NULL DEFAULT true,
  nombre           varchar(200) NOT NULL,
  bytes            integer NOT NULL,
  datos            bytea NOT NULL,
  hash_sha256      varchar(64) NOT NULL,
  -- original: huella del estado del documento al congelarlo (sello + firmas).
  huella           varchar(64),
  -- firmado: con qué original coincide el prefijo (NULL si no coincide).
  original_id      uuid REFERENCES documento_fea_archivo(id),
  corresponde      boolean,
  excepcion_motivo text,
  excepcion_por    uuid REFERENCES usuario(id),
  firmante_nombre  varchar(300),
  firma_fecha      timestamptz,
  firma_fecha_texto varchar(60),
  firmas           integer,
  integridad       varchar(15),
  subido_por       uuid REFERENCES usuario(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fea_archivo_doc
  ON documento_fea_archivo (tenant_id, origen, documento_id, clase, created_at DESC);
-- Una sola versión firmada vigente por documento.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fea_firmado_vigente
  ON documento_fea_archivo (origen, documento_id) WHERE clase = 'firmado' AND vigente;

CREATE TABLE IF NOT EXISTS documento_fea_evento (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  origen       varchar(20) NOT NULL,
  documento_id uuid NOT NULL,
  accion       varchar(30) NOT NULL,
  usuario_id   uuid REFERENCES usuario(id),
  archivo_id   uuid REFERENCES documento_fea_archivo(id),
  detalle      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fea_evento_doc ON documento_fea_evento (origen, documento_id, created_at);

-- -----------------------------------------------------------------------------
-- Parámetro «fea»: exige la versión firmada antes de entregar (por defecto «no»).
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, 90, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('fea', 'informe_ensayo', 'Informe de ensayo: exige FEA antes de entregar', 'no'),
  ('fea', 'ivc', 'Informe de verificación de cumplimiento (IVC): exige FEA antes de entregar', 'no'),
  ('fea', 'informe_tecnico', 'Informe técnico: exige FEA antes de entregar', 'no'),
  ('fea', 'informe_inspeccion', 'Informe de inspección (BPCH y Delegación Nº 11): exige FEA antes de entregar', 'no'),
  ('fea', 'certificado_conformidad', 'Certificado de conformidad: exige FEA antes de entregar', 'no'),
  ('fea', 'informe_incumplimiento', 'Informe de incumplimiento: exige FEA antes de entregar', 'no'),
  ('fea', 'certificado_resistencia_balistica', 'Certificado de resistencia balística: exige FEA antes de entregar', 'no'),
  ('fea', 'informe_rechazo', 'Informe de rechazo: exige FEA antes de entregar', 'no'),
  ('fea', 'certificado_arma', 'Certificado por arma (Delegación Nº 11): exige FEA antes de entregar', 'no'),
  ('fea', 'informe_incumplimiento_arma', 'Informe de incumplimiento del arma (Delegación Nº 11): exige FEA antes de entregar', 'no'),
  ('fea', 'certificado_calibracion', 'Certificado de calibración (Metrología): exige FEA antes de entregar', 'no')
 ) AS v(categoria, codigo, etiqueta, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Permiso de las jefaturas.
-- -----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'documento.fea.gestionar', 'documento', 'fea.gestionar',
   'Firma electrónica avanzada: subir la versión firmada de un documento en nombre del firmante, aceptar con motivo un PDF que no corresponde al emitido y ver los pendientes de firma FEA de su alcance.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('JEFE_LAB'), ('JEFE_SECCION'), ('JEFE_DEPTO'), ('DIRECTOR'), ('SUBDIRECTOR'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'documento.fea.gestionar'
ON CONFLICT DO NOTHING;
