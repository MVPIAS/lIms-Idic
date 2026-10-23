-- =============================================================================
-- LIMS IDIC · Frente r4c · oficio conductor (T03 · BL-005, BL-207) · Aiuken
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql.
-- Reglas: docs/FLUJO_AVISOS_DESPACHO_OFICIO.md §4.
--
-- El IVC, el Informe Técnico, el Informe de Rechazo (EP-05 7.2) y la cotización
-- a Ejército y FF.AA. (EP-00 3.1) salen con un oficio conductor:
--   borrador → «Generar oficio → firmas» (número de la unidad, circuito de la
--   matriz OFICIO: V°B° del Jefe de Departamento → firma del Director) →
--   firmado → «Firmar y despachar» por la Oficina de partes (Nº y fecha de
--   despacho, EP-00 3.3) → despachado.
--   1 · oficio y oficio_firma (pasos resueltos con la matriz al generar).
--   2 · Numeración: regla general del tipo OFICIO por unidad (por confirmar).
--   3 · Parámetros: qué documentos exigen oficio para entregarse.
--   4 · Permisos oficio.ver / oficio.crear / oficio.despachar.
-- =============================================================================

-- --- 1 · Oficio y su circuito -------------------------------------------------------
CREATE TABLE IF NOT EXISTS oficio (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenant(id),
  numero             VARCHAR(80),
  unidad_id          UUID         NOT NULL REFERENCES unidad(id),
  fecha              DATE         NOT NULL,
  destinatario       VARCHAR(300) NOT NULL,
  materia            VARCHAR(500) NOT NULL,
  cuerpo             TEXT,
  distribucion       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  cotizacion_id      UUID         REFERENCES cotizacion(id),
  ot_id              UUID         REFERENCES orden_trabajo(id),
  documentos         UUID[]       NOT NULL DEFAULT '{}',
  estado             VARCHAR(15)  NOT NULL DEFAULT 'borrador',
  devuelto_motivo    TEXT,
  anulado_motivo     TEXT,
  despacho_numero    VARCHAR(60),
  despacho_fecha     DATE,
  despachado_por     UUID         REFERENCES usuario(id),
  despachado_at      TIMESTAMPTZ,
  codigo_verificacion VARCHAR(24),
  hash_sha256        VARCHAR(64),
  creado_por         UUID         REFERENCES usuario(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_oficio_estado CHECK (estado IN ('borrador', 'en_firma', 'devuelto', 'firmado', 'despachado', 'anulado')),
  CONSTRAINT ck_oficio_vinculo CHECK (cotizacion_id IS NOT NULL OR ot_id IS NOT NULL)
);
COMMENT ON TABLE oficio IS
  'Oficio conductor de una cotización (Ejército y FF.AA.) o de documentos de la OT (IVC, Informe Técnico, Rechazo): número de la unidad, destinatario, distribución, circuito de la matriz OFICIO y despacho por la Oficina de partes.';
COMMENT ON COLUMN oficio.documentos IS 'Documentos (certificado.id) que conduce el oficio.';
COMMENT ON COLUMN oficio.distribucion IS 'Lista [{destinatario, ejemplares}] impresa al pie del oficio.';
CREATE UNIQUE INDEX IF NOT EXISTS ux_oficio_numero ON oficio (tenant_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_oficio_ot ON oficio (ot_id) WHERE ot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_oficio_cotizacion ON oficio (cotizacion_id) WHERE cotizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_oficio_estado ON oficio (tenant_id, estado);

CREATE TABLE IF NOT EXISTS oficio_firma (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID         NOT NULL REFERENCES tenant(id),
  oficio_id      UUID         NOT NULL REFERENCES oficio(id) ON DELETE CASCADE,
  orden          INTEGER      NOT NULL,
  accion         VARCHAR(20)  NOT NULL,
  rol_codigo     VARCHAR(60)  NOT NULL,
  rol_nombre     VARCHAR(120),
  unidad_id      UUID         REFERENCES unidad(id),
  responsables   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  estado         VARCHAR(12)  NOT NULL DEFAULT 'pendiente',
  firmado_por    UUID         REFERENCES usuario(id),
  firmado_at     TIMESTAMPTZ,
  comentario     TEXT,
  CONSTRAINT ck_oficio_firma_estado CHECK (estado IN ('pendiente', 'firmado', 'devuelto', 'anulado'))
);
COMMENT ON TABLE oficio_firma IS 'Pasos del circuito del oficio, resueltos con la matriz de firmas (tipo OFICIO) al generar el oficio.';
CREATE INDEX IF NOT EXISTS ix_oficio_firma_oficio ON oficio_firma (oficio_id, orden);

-- El documento despachado o entregado puede citar su oficio.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_documento_despacho_oficio') THEN
    ALTER TABLE documento_despacho ADD CONSTRAINT fk_documento_despacho_oficio FOREIGN KEY (oficio_id) REFERENCES oficio(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_certificado_entrega_oficio') THEN
    ALTER TABLE certificado ADD CONSTRAINT fk_certificado_entrega_oficio FOREIGN KEY (entrega_oficio_id) REFERENCES oficio(id) NOT VALID;
  END IF;
END $$;

-- --- 2 · Numeración (regla general por unidad, por confirmar) -------------------------
INSERT INTO numeracion_documento (tenant_id, unidad_id, tipo_documento, formato, reinicio, correlativo_por_unidad, por_confirmar, fuente)
SELECT t.id, NULL, 'OFICIO', 'OF-{LAB}-{AAAA}-{N:4}', 'anual', TRUE, TRUE,
       'EP-00 3.1 y EP-05 7.2: «Nº oficio [correlativo de la unidad]»; formato real por confirmar con el IDIC.'
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM numeracion_documento n WHERE n.tenant_id = t.id AND n.tipo_documento = 'OFICIO');

-- --- 3 · Parámetros de la operación ----------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, 'oficio_conductor', v.codigo, v.etiqueta, v.valor, v.orden
  FROM tenant t,
       (VALUES
         ('exige_tipos', 'Documentos que no se entregan sin oficio conductor firmado', 'IVC,INFORME_TECNICO,INFORME_RECHAZO', 1),
         ('exige_departamentos', 'Departamentos donde rige (DSA, DQO, BPCH…)', 'DSA', 2)
       ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 4 · Permisos ------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'oficio.ver', 'oficio', 'ver', 'Ver los oficios conductores de su ámbito.'),
  (gen_random_uuid(), 'oficio.crear', 'oficio', 'crear',
   'Elaborar el oficio conductor de una cotización o de documentos de la OT y enviarlo a firmas (la firma la decide la matriz OFICIO).'),
  (gen_random_uuid(), 'oficio.despachar', 'oficio', 'despachar',
   'Oficina de partes: registrar el Nº y la fecha de despacho de un oficio firmado (EP-00 3.3).')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('COMERCIAL', 'oficio.ver'), ('COMERCIAL', 'oficio.crear'), ('PLANIFICACION', 'oficio.ver'),
    ('JEFE_LAB', 'oficio.ver'), ('JEFE_LAB', 'oficio.crear'), ('JEFE_SECCION', 'oficio.ver'), ('JEFE_SECCION', 'oficio.crear'),
    ('JEFE_DEPTO', 'oficio.ver'), ('JEFE_DEPTO', 'oficio.crear'),
    ('DIRECTOR', 'oficio.ver'), ('DIRECTOR', 'oficio.crear'), ('DIRECTOR', 'oficio.despachar'),
    ('SUBDIRECTOR', 'oficio.ver'), ('SUBDIRECTOR', 'oficio.crear'), ('SUBDIRECTOR', 'oficio.despachar'),
    ('SUPERADMIN', 'oficio.ver'), ('SUPERADMIN', 'oficio.crear'), ('SUPERADMIN', 'oficio.despachar'),
    ('LECTOR', 'oficio.ver')
  ) AS m(rol, perm)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
