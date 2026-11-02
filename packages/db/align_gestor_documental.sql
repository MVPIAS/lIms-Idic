-- =============================================================================
-- LIMS IDIC · Gestor documental y plantillas de exportación (frente documental) · Aiuken
-- =============================================================================
-- Contrato §4.6.1, §4.6.2 y §4.6.3: documentos electrónicos en una estructura
-- jerárquica de carpetas, con historial de versiones, publicación de versión,
-- renombrado, permisos por usuario y vínculo a OT, muestra y cliente.
--
--   · doc_carpeta: árbol de carpetas (padre_id). Una carpeta puede quedar
--     restringida a una unidad (laboratorio/departamento); la restricción la
--     heredan sus subcarpetas y la aplica el alcance por laboratorio.
--   · doc_documento: el documento (título, código DOC-AAAA-NNNNN, carpeta,
--     vínculos). `version_publicada` es la versión que ven los lectores.
--   · doc_version: cada archivo subido es una versión numerada BORRADOR →
--     PUBLICADA → REEMPLAZADA. El contenido se guarda en la base (base64) con
--     su SHA-256, como los demás adjuntos del LIMS.
--   · doc_acceso: si el documento está «restringido», solo lo ven quienes
--     figuran aquí (ver / editar), quien lo creó y los perfiles globales.
--
-- Contrato §4.6.6 y §4.6.7: reporte_plantilla guarda modelos de exportación a
-- Excel (entidad, columnas, filtros, resumen dinámico y gráfico).
--
-- Permisos: documento.ver (todo rol interno con ot.ver; CLIENTE no) y documento.gestionar (subir,
-- versionar, publicar, carpetas y permisos). Aditivo e idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS doc_carpeta (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  padre_id       UUID REFERENCES doc_carpeta(id),
  nombre         VARCHAR(120) NOT NULL,
  descripcion    TEXT,
  unidad_id      UUID REFERENCES unidad(id),          -- NULL = la de la carpeta padre (o todas)
  creado_por     UUID REFERENCES usuario(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_carpeta_nombre
  ON doc_carpeta (tenant_id, COALESCE(padre_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nombre))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_carpeta_tenant ON doc_carpeta(tenant_id);

CREATE SEQUENCE IF NOT EXISTS doc_documento_seq;

CREATE TABLE IF NOT EXISTS doc_documento (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  codigo            VARCHAR(30) NOT NULL,
  carpeta_id        UUID NOT NULL REFERENCES doc_carpeta(id),
  titulo            VARCHAR(200) NOT NULL,
  descripcion       TEXT,
  ot_id             UUID REFERENCES orden_trabajo(id),
  muestra_id        UUID REFERENCES muestra(id),
  cliente_id        UUID REFERENCES cliente(id),
  restringido       BOOLEAN NOT NULL DEFAULT FALSE,
  version_publicada INT,
  creado_por        UUID REFERENCES usuario(id),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por   UUID REFERENCES usuario(id),
  actualizado_en    TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT ux_doc_documento_codigo UNIQUE (tenant_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_doc_documento_carpeta ON doc_documento(carpeta_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_documento_ot      ON doc_documento(ot_id) WHERE ot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_documento_muestra ON doc_documento(muestra_id) WHERE muestra_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS doc_version (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  documento_id   UUID NOT NULL REFERENCES doc_documento(id) ON DELETE CASCADE,
  numero         INT  NOT NULL,
  nombre_archivo VARCHAR(220) NOT NULL,
  mime           VARCHAR(120) NOT NULL,
  bytes          INT  NOT NULL,
  datos          TEXT NOT NULL,                       -- base64
  hash_sha256    CHAR(64) NOT NULL,
  estado         VARCHAR(12) NOT NULL DEFAULT 'BORRADOR',
  comentario     TEXT,
  subido_por     UUID REFERENCES usuario(id),
  subido_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  publicado_por  UUID REFERENCES usuario(id),
  publicado_en   TIMESTAMPTZ,
  CONSTRAINT ck_doc_version_estado CHECK (estado IN ('BORRADOR', 'PUBLICADA', 'REEMPLAZADA')),
  CONSTRAINT ux_doc_version_numero UNIQUE (documento_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_version_publicada ON doc_version(documento_id) WHERE estado = 'PUBLICADA';

CREATE TABLE IF NOT EXISTS doc_acceso (
  documento_id UUID NOT NULL REFERENCES doc_documento(id) ON DELETE CASCADE,
  usuario_id   UUID NOT NULL REFERENCES usuario(id),
  nivel        VARCHAR(10) NOT NULL DEFAULT 'ver',
  otorgado_por UUID REFERENCES usuario(id),
  otorgado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_doc_acceso_nivel CHECK (nivel IN ('ver', 'editar')),
  PRIMARY KEY (documento_id, usuario_id)
);

COMMENT ON TABLE doc_carpeta   IS 'Gestor documental (§4.6.2): árbol de carpetas; unidad_id restringe la carpeta y su subárbol a un laboratorio.';
COMMENT ON TABLE doc_documento IS 'Gestor documental (§4.6.1): documento con vínculos a OT, muestra y cliente; version_publicada = la que ven los lectores.';
COMMENT ON TABLE doc_version   IS 'Gestor documental (§4.6.3): versiones numeradas BORRADOR → PUBLICADA → REEMPLAZADA.';
COMMENT ON TABLE doc_acceso    IS 'Gestor documental (§4.6.1): permisos por usuario de un documento restringido.';

-- Carpetas raíz de partida (solo si el árbol está vacío).
INSERT INTO doc_carpeta (tenant_id, nombre, descripcion)
SELECT t.id, v.nombre, v.descripcion
  FROM tenant t
 CROSS JOIN (VALUES
   ('Calidad',           'Procedimientos, instructivos, registros y documentos del sistema de gestión'),
   ('Laboratorios',      'Documentación técnica por laboratorio'),
   ('Comercial',         'Contratos, convenios y documentación de clientes'),
   ('Dirección',         'Resoluciones, oficios y documentos institucionales')
 ) AS v(nombre, descripcion)
 WHERE NOT EXISTS (SELECT 1 FROM doc_carpeta c WHERE c.tenant_id = t.id);

-- --------------------------------------------- plantillas de exportación ---
CREATE TABLE IF NOT EXISTS reporte_plantilla (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  nombre         VARCHAR(120) NOT NULL,
  descripcion    TEXT,
  entidad        VARCHAR(40) NOT NULL,
  campos         TEXT[] NOT NULL DEFAULT '{}',
  filtros        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { desde, hasta, ultimosDias }
  resumen        JSONB,                               -- { filas, columnas, valor, agregado, grafico }
  compartida     BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por     UUID REFERENCES usuario(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reporte_plantilla_nombre
  ON reporte_plantilla (tenant_id, lower(nombre)) WHERE deleted_at IS NULL;
COMMENT ON TABLE reporte_plantilla IS 'Modelos de exportación a Excel (§4.6.6/§4.6.7): columnas, filtros, resumen dinámico y gráfico.';

-- --------------------------------------------------------------- permisos ---
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'documento.ver', 'documento', 'ver',
   'Ver el gestor documental: carpetas y versiones publicadas de los documentos de su alcance.'),
  (gen_random_uuid(), 'documento.gestionar', 'documento', 'gestionar',
   'Gestor documental: crear carpetas, subir documentos y versiones, publicar, renombrar, mover y dar permisos por usuario.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso po ON po.id = rp.permiso_id AND po.codigo = 'ot.ver'
  JOIN permiso p  ON p.codigo = 'documento.ver'
  JOIN rol r      ON r.id = rp.rol_id AND COALESCE(r.alias_de, r.codigo) <> 'CLIENTE'
ON CONFLICT DO NOTHING;

-- El portal del cliente externo no ve el gestor interno (corrige instalaciones previas).
DELETE FROM rol_permiso rp
 USING rol r, permiso p
 WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
   AND COALESCE(r.alias_de, r.codigo) = 'CLIENTE' AND p.codigo = 'documento.ver';

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('CALIDAD'), ('DIRECTOR'), ('SUBDIRECTOR'), ('JEFE_DEPTO'), ('JEFE_LAB'), ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo IN ('documento.ver', 'documento.gestionar')
ON CONFLICT DO NOTHING;
