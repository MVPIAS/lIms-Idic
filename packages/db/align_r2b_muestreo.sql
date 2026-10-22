-- =============================================================================
-- align_r2b_muestreo.sql · Registro de muestreo de la OT y plan NCh 43/44
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql. Reglas: docs/FLUJO_ESPECIFICACIONES_MUESTREO.md.
-- Especificación: EP-01 1.1, EP-02 1.1, EP-03 0.4, EP-05 3.2 y 5.3, EP-10 10.4
-- (tema transversal T13; backlog BL-043 y BL-047).
--
--   1. ot_muestreo: el formulario de muestreo de la OT (Nº único, lugar, fecha
--      y hora de toma, responsable, producto, proveedor, guía, lote, tamaños,
--      cantidad y envase, sellos, registro fotográfico, excedente, costo) con
--      su plan NCh 44 (nivel, tabla, AQL por clase, letra, n, Ac/Re), la
--      selección NCh 43, la entrega al laboratorio, el «recibido conforme» y la
--      conclusión del lote.
--   2. ot_muestreo_unidad: unidades seleccionadas y sus reemplazos.
--   3. ot_muestreo_foto: registro fotográfico del muestreo.
--   4. muestra.muestreo_id: de qué muestreo sale cada muestra.
--   5. Permiso muestreo.registrar.
--   6. Parámetros de la operación del plan (muestreo_plan).
-- =============================================================================

-- --- 1 · Muestreo -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_muestreo (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenant(id),
  ot_id                 UUID NOT NULL REFERENCES orden_trabajo(id),
  numero_formulario     VARCHAR(60)  NOT NULL,
  tipo_formulario       VARCHAR(30)  NOT NULL DEFAULT 'extraccion',
  lugar                 VARCHAR(240),
  fecha_toma            TIMESTAMPTZ,
  responsable           VARCHAR(200),
  solicitado_por        VARCHAR(200),
  producto              VARCHAR(240),
  cat_elemento_id       UUID REFERENCES cat_elemento(id),
  proveedor             VARCHAR(240),
  guia_despacho         VARCHAR(60),
  identificacion_lote   VARCHAR(120),
  fecha_elaboracion     DATE,
  tamano_lote           INT,
  unidad_presentacion   VARCHAR(40),
  tamano_muestra        INT,
  cantidad_envase       VARCHAR(200),
  material_adicional    TEXT,
  sellos                TEXT[]       NOT NULL DEFAULT '{}',
  registro_foto_numero  VARCHAR(60),
  devolucion_excedente  BOOLEAN,
  costo_uf              NUMERIC(10,2),
  tiempo_respuesta      VARCHAR(60),
  observaciones         TEXT,
  plan                  JSONB,
  linea_movil           BOOLEAN      NOT NULL DEFAULT false,
  linea_movil_plan      TEXT,
  estado                VARCHAR(12)  NOT NULL DEFAULT 'borrador',
  creado_por            UUID REFERENCES usuario(id),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_por       UUID REFERENCES usuario(id),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  registrado_por        UUID REFERENCES usuario(id),
  registrado_at         TIMESTAMPTZ,
  recibido_conforme     BOOLEAN,
  recibido_observacion  TEXT,
  recibido_por          UUID REFERENCES usuario(id),
  recibido_at           TIMESTAMPTZ,
  veredicto_lote        VARCHAR(10),
  conclusion            TEXT,
  concluido_por         UUID REFERENCES usuario(id),
  concluido_at          TIMESTAMPTZ,
  anulado_motivo        TEXT,
  anulado_por           UUID REFERENCES usuario(id),
  anulado_at            TIMESTAMPTZ
);
COMMENT ON TABLE ot_muestreo IS 'Formulario de muestreo de la OT (NUMFORM / DCO-PG01-P01-IT01-FORM06 / formulario de selección y extracción) con su plan NCh 44 y la selección NCh 43.';
COMMENT ON COLUMN ot_muestreo.tipo_formulario IS 'extraccion (formulario de selección y extracción, EP-03 0.4) | numform (Alimentos, EP-02 1.1) | it01_form06 (lista de chequeo DCO, EP-01 1.1) | planilla_nch44 (SVM, LAM, BPCH).';
COMMENT ON COLUMN ot_muestreo.plan IS 'Plan NCh 44: {norma, nivel, tabla, aql{critico,mayor,menor}, letra, nPropuesto, n, motivoN, clases{…: {letra, n, ac, re, aql}}, seleccion{metodo, paso, inicio}}.';
COMMENT ON COLUMN ot_muestreo.estado IS 'borrador (se edita) | registrado («Registrar muestreo → entregar al laboratorio») | recibido (el laboratorio marcó «recibido conforme» o no conforme) | anulado.';
COMMENT ON COLUMN ot_muestreo.veredicto_lote IS 'Conclusión del lote (EP-05 5.3): acepta | rechaza.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_muestreo_estado') THEN
    ALTER TABLE ot_muestreo ADD CONSTRAINT ck_ot_muestreo_estado CHECK (estado IN ('borrador', 'registrado', 'recibido', 'anulado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_muestreo_tamanos') THEN
    ALTER TABLE ot_muestreo ADD CONSTRAINT ck_ot_muestreo_tamanos CHECK (
      (tamano_lote IS NULL OR tamano_lote > 0) AND (tamano_muestra IS NULL OR tamano_muestra > 0)
      AND (tamano_lote IS NULL OR tamano_muestra IS NULL OR tamano_muestra <= tamano_lote)
      AND (costo_uf IS NULL OR costo_uf >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_muestreo_veredicto') THEN
    ALTER TABLE ot_muestreo ADD CONSTRAINT ck_ot_muestreo_veredicto CHECK (veredicto_lote IS NULL OR veredicto_lote IN ('acepta', 'rechaza'));
  END IF;
END $$;
-- El Nº de formulario es único en el instituto (salvo los anulados).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ot_muestreo_formulario ON ot_muestreo (tenant_id, upper(numero_formulario)) WHERE estado <> 'anulado';
CREATE INDEX IF NOT EXISTS ix_ot_muestreo_ot ON ot_muestreo (ot_id);

-- --- 2 · Unidades seleccionadas y reemplazos ---------------------------------
CREATE TABLE IF NOT EXISTS ot_muestreo_unidad (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muestreo_id     UUID NOT NULL REFERENCES ot_muestreo(id) ON DELETE CASCADE,
  orden           INT          NOT NULL,
  posicion        INT,
  identificacion  VARCHAR(120),
  talla           VARCHAR(40),
  ubicacion       VARCHAR(80),
  reemplaza_id    UUID REFERENCES ot_muestreo_unidad(id),
  reemplazada     BOOLEAN      NOT NULL DEFAULT false,
  motivo_reemplazo TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE ot_muestreo_unidad IS 'Unidades seleccionadas del lote (posición NCh 43, serie, talla, panel/ubicación) y sus reemplazos (series destruidas → reemplazo, EP-05 3.2).';
CREATE INDEX IF NOT EXISTS ix_ot_muestreo_unidad ON ot_muestreo_unidad (muestreo_id, orden);

-- --- 3 · Registro fotográfico del muestreo -----------------------------------
CREATE TABLE IF NOT EXISTS ot_muestreo_foto (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  muestreo_id UUID NOT NULL REFERENCES ot_muestreo(id),
  nombre      VARCHAR(200),
  mime        VARCHAR(20)  NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  bytes       INT          NOT NULL,
  datos       TEXT         NOT NULL,
  hash_sha256 VARCHAR(64)  NOT NULL,
  pie         VARCHAR(500),
  subida_por  UUID REFERENCES usuario(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ot_muestreo_foto ON ot_muestreo_foto (muestreo_id) WHERE deleted_at IS NULL;

-- --- 4 · Muestras del muestreo ------------------------------------------------
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS muestreo_id UUID REFERENCES ot_muestreo(id);
CREATE INDEX IF NOT EXISTS ix_muestra_muestreo ON muestra (muestreo_id) WHERE muestreo_id IS NOT NULL;
COMMENT ON COLUMN muestra.muestreo_id IS 'Muestreo del que sale la muestra: sus sellos se verifican al recibirla (EP-03 1.2).';

-- --- 5 · Permiso -------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'muestreo.registrar', 'muestreo', 'registrar',
   'Registrar el muestreo de una OT de su alcance: formulario, plan NCh 43/44, unidades seleccionadas, sellos y fotos, y entregarlo al laboratorio')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'muestreo.registrar'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'MUESTREO', 'ANALISTA', 'ANALISTA_SR', 'REVISOR', 'TECNICO', 'INSPECTOR',
                    'JEFE_LAB', 'JEFELAB', 'JEFE_SECCION', 'JEFE_DEPTO')
ON CONFLICT DO NOTHING;

-- --- 6 · Parámetros de la operación (Administración › Parámetros del sistema) --
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'muestreo_plan', v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('nivel',       'Nivel de inspección con que se abre el plan (S-1…S-4, I, II, III)', 1, 'II'),
  ('aql_critico', 'AQL de los defectos críticos (ninguno = un crítico rechaza)', 2, 'ninguno'),
  ('aql_mayor',   'AQL de los defectos mayores', 3, '2.5'),
  ('aql_menor',   'AQL de los defectos menores', 4, '4')
 ) AS v(codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
