-- =============================================================================
-- align_sesiones_s3.sql · Cambios de las sesiones IDIC (27-10 → 09-11) · frente S3
-- BPCH, Delegación Nº 11, Muestreo y trabajo en terreno.
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql (ORDEN_SQL.txt).
--
--   1. Trabajo en terreno sin recepción (SVM, LAM, SEO · R10): ot_terreno,
--      unidades controladas (vehículo: chasis, motor, año), pruebas / lista de
--      chequeo, adjuntos (protocolo, hojas de control, IVC) y permisos.
--   2. D11 (R12): armas pendientes de nueva resolución y devoluciones técnicas.
--   3. Plazo de la OT ligado a la vigencia de la resolución (R3).
--   4. Cabecera BPCH: unidades de lote y muestra, lotes adicionales con su
--      especificación y su vencimiento / vigencia (R3).
--   5. Muestreo (R6): horas de inicio y término, detalle de muestras, norma,
--      especificación, protocolo, selección al azar, unidades, adjunto del
--      formulario.
--   6. Listas (R3): sucursales en «Toma de muestra», ubicaciones de
--      almacenamiento, unidades de tamaño, lugares de inspección con dirección.
--   7. Batería de ensayos fija del BPCH: excepción con permiso propio (R4).
-- Los valores marcados «PRUEBA» son de ejemplo hasta que el IDIC envíe los reales.
-- =============================================================================

-- --- 1 · Trabajo en terreno --------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_terreno (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenant(id),
  ot_id              UUID NOT NULL UNIQUE REFERENCES orden_trabajo(id),
  lugar              VARCHAR(240),
  fecha_inicio       DATE,
  fecha_termino      DATE,
  modalidad          VARCHAR(12)  NOT NULL DEFAULT 'total',
  norma_muestreo     VARCHAR(20),
  letra_codigo       VARCHAR(4),
  tamano_lote        INT,
  n_muestras         INT,
  protocolo          VARCHAR(200),
  analistas          UUID[]       NOT NULL DEFAULT '{}',
  asignada_por       UUID REFERENCES usuario(id),
  asignada_at        TIMESTAMPTZ,
  pruebas_at         TIMESTAMPTZ,
  chequeo_at         TIMESTAMPTZ,
  ivc_numero         VARCHAR(60),
  ivc_grado          VARCHAR(10),
  ivc_conclusion     TEXT,
  ivc_por            UUID REFERENCES usuario(id),
  ivc_at             TIMESTAMPTZ,
  cerrada_por        UUID REFERENCES usuario(id),
  cerrada_at         TIMESTAMPTZ,
  observaciones      TEXT,
  creado_por         UUID REFERENCES usuario(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE ot_terreno IS 'Trabajo en terreno sin recepción ni toma de muestras (SVM, LAM, SEO · R10): apertura, asignación, pruebas, lista de chequeo, IVC y cierre.';
COMMENT ON COLUMN ot_terreno.modalidad IS 'total (control al 100 %) | muestreo (por norma: letra código y número de muestras).';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_terreno_modalidad') THEN
    ALTER TABLE ot_terreno ADD CONSTRAINT ck_ot_terreno_modalidad CHECK (modalidad IN ('total', 'muestreo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_terreno_grado') THEN
    ALTER TABLE ot_terreno ADD CONSTRAINT ck_ot_terreno_grado CHECK (ivc_grado IS NULL OR ivc_grado IN ('cumple', 'no_cumple'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_terreno_tamanos') THEN
    ALTER TABLE ot_terreno ADD CONSTRAINT ck_ot_terreno_tamanos CHECK (
      (tamano_lote IS NULL OR tamano_lote > 0) AND (n_muestras IS NULL OR n_muestras > 0)
      AND (tamano_lote IS NULL OR n_muestras IS NULL OR n_muestras <= tamano_lote));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ot_terreno_unidad (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terreno_id        UUID NOT NULL REFERENCES ot_terreno(id) ON DELETE CASCADE,
  orden             INT          NOT NULL,
  descripcion       VARCHAR(200),
  chasis            VARCHAR(60),
  motor             VARCHAR(60),
  anio_fabricacion  INT,
  serie             VARCHAR(80),
  seleccionada      BOOLEAN      NOT NULL DEFAULT true,
  observacion       VARCHAR(500),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE ot_terreno_unidad IS 'Unidades controladas en terreno: vehículos (chasis, motor, año de fabricación; aún sin placa), armas o equipos (serie).';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_terreno_unidad_anio') THEN
    ALTER TABLE ot_terreno_unidad ADD CONSTRAINT ck_ot_terreno_unidad_anio CHECK (anio_fabricacion IS NULL OR anio_fabricacion BETWEEN 1900 AND 2100);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ot_terreno_unidad ON ot_terreno_unidad (terreno_id, orden);

CREATE TABLE IF NOT EXISTS ot_terreno_prueba (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terreno_id     UUID NOT NULL REFERENCES ot_terreno(id) ON DELETE CASCADE,
  unidad_id      UUID REFERENCES ot_terreno_unidad(id) ON DELETE CASCADE,
  orden          INT          NOT NULL,
  sistema        VARCHAR(120) NOT NULL,
  prueba         VARCHAR(300) NOT NULL,
  requisito      VARCHAR(500),
  resultado      VARCHAR(10),
  observacion    VARCHAR(1000),
  registrado_por UUID REFERENCES usuario(id),
  registrado_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE ot_terreno_prueba IS 'Pruebas elegidas del protocolo de recepción cualitativa (formato de control de prueba) y su registro en la lista de chequeo (hoja de control de prueba).';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_terreno_prueba_resultado') THEN
    ALTER TABLE ot_terreno_prueba ADD CONSTRAINT ck_ot_terreno_prueba_resultado CHECK (resultado IS NULL OR resultado IN ('cumple', 'no_cumple', 'no_aplica'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ot_terreno_prueba ON ot_terreno_prueba (terreno_id, orden);

CREATE TABLE IF NOT EXISTS ot_terreno_adjunto (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  terreno_id  UUID NOT NULL REFERENCES ot_terreno(id),
  tipo        VARCHAR(20)  NOT NULL,
  nombre      VARCHAR(200) NOT NULL,
  mime        VARCHAR(100) NOT NULL,
  bytes       INT          NOT NULL,
  datos       TEXT         NOT NULL,
  hash_sha256 VARCHAR(64)  NOT NULL,
  subido_por  UUID REFERENCES usuario(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
COMMENT ON COLUMN ot_terreno_adjunto.tipo IS 'protocolo (protocolo de recepción) | hoja_control (hoja de control de pruebas) | ivc (informe de verificación de calidad) | otro.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_terreno_adjunto_tipo') THEN
    ALTER TABLE ot_terreno_adjunto ADD CONSTRAINT ck_ot_terreno_adjunto_tipo CHECK (tipo IN ('protocolo', 'hoja_control', 'ivc', 'otro'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ot_terreno_adjunto ON ot_terreno_adjunto (terreno_id) WHERE deleted_at IS NULL;

-- --- 2 · D11: armas pendientes y devoluciones ---------------------------------
ALTER TABLE d11_arma_ot ADD COLUMN IF NOT EXISTS pendiente_motivo   VARCHAR(20);
ALTER TABLE d11_arma_ot ADD COLUMN IF NOT EXISTS pendiente_detalle  VARCHAR(1000);
ALTER TABLE d11_arma_ot ADD COLUMN IF NOT EXISTS pendiente_por      UUID REFERENCES usuario(id);
ALTER TABLE d11_arma_ot ADD COLUMN IF NOT EXISTS pendiente_at       TIMESTAMPTZ;
ALTER TABLE d11_arma_ot ADD COLUMN IF NOT EXISTS liberada_resolucion VARCHAR(60);
ALTER TABLE d11_arma_ot ADD COLUMN IF NOT EXISTS liberada_por       UUID REFERENCES usuario(id);
ALTER TABLE d11_arma_ot ADD COLUMN IF NOT EXISTS liberada_at        TIMESTAMPTZ;
COMMENT ON COLUMN d11_arma_ot.pendiente_motivo IS 'Arma pendiente de nueva resolución (R12): falla | serie_distinta | otro. NULL = sigue su curso.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_d11_arma_ot_pendiente') THEN
    ALTER TABLE d11_arma_ot ADD CONSTRAINT ck_d11_arma_ot_pendiente CHECK (pendiente_motivo IS NULL OR pendiente_motivo IN ('falla', 'serie_distinta', 'otro'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_d11_arma_ot_pendiente ON d11_arma_ot (tenant_id) WHERE pendiente_motivo IS NOT NULL;

CREATE TABLE IF NOT EXISTS d11_devolucion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  ot_id         UUID NOT NULL REFERENCES orden_trabajo(id),
  arma_ot_id    UUID NOT NULL REFERENCES d11_arma_ot(id),
  etapa         VARCHAR(30)  NOT NULL,
  motivo        VARCHAR(2000) NOT NULL,
  certificado   VARCHAR(60),
  resultados    INT          NOT NULL DEFAULT 0,
  devuelta_por  UUID REFERENCES usuario(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE d11_devolucion IS 'Devoluciones técnicas de un arma en cualquier paso (R12): se anulan su certificado y sus resultados vuelven al inspector para rehacer las pruebas.';
CREATE INDEX IF NOT EXISTS ix_d11_devolucion ON d11_devolucion (ot_id, created_at);

-- --- 3 · Plazo de la OT y vigencia de la resolución --------------------------
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS vigencia_resolucion_hasta DATE;
COMMENT ON COLUMN orden_trabajo.vigencia_resolucion_hasta IS 'Último día de vigencia de la resolución que origina la OT del BPCH o la D11 (fecha de la resolución + bpch_resolucion.vigencia_dias). La fecha de compromiso no puede pasarla (R3).';

-- --- 4 · Cabecera BPCH: unidades y lotes adicionales --------------------------
ALTER TABLE bpch_cabecera_ot ADD COLUMN IF NOT EXISTS unidad_lote    VARCHAR(20);
ALTER TABLE bpch_cabecera_ot ADD COLUMN IF NOT EXISTS unidad_muestra VARCHAR(20);
COMMENT ON COLUMN bpch_cabecera_ot.unidad_lote IS 'Unidad del tamaño del lote (lista unidad_tamano_lote: kilos, toneladas).';
COMMENT ON COLUMN bpch_cabecera_ot.unidad_muestra IS 'Unidad del tamaño de la muestra (lista unidad_tamano_muestra: toneladas, kilos, gramos, unidades).';

CREATE TABLE IF NOT EXISTS bpch_cabecera_lote (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenant(id),
  ot_id            UUID NOT NULL REFERENCES orden_trabajo(id),
  orden            INT          NOT NULL,
  identificacion   VARCHAR(200) NOT NULL,
  tamano_lote      NUMERIC(14,3),
  unidad_lote      VARCHAR(20),
  tamano_muestra   NUMERIC(14,3),
  unidad_muestra   VARCHAR(20),
  vencimiento      DATE,
  especificacion   VARCHAR(1000),
  observacion      VARCHAR(1000),
  created_by       UUID REFERENCES usuario(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE bpch_cabecera_lote IS 'Lotes de la inspección del BPCH con su especificación, tamaños con unidad y fecha de vencimiento o vigencia (R3).';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bpch_cabecera_lote_tamanos') THEN
    ALTER TABLE bpch_cabecera_lote ADD CONSTRAINT ck_bpch_cabecera_lote_tamanos CHECK (
      (tamano_lote IS NULL OR tamano_lote > 0) AND (tamano_muestra IS NULL OR tamano_muestra > 0));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_bpch_cabecera_lote ON bpch_cabecera_lote (ot_id, orden);

-- --- 5 · Muestreo: formulario de selección y extracción completo --------------
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS hora_inicio            TIME;
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS hora_termino           TIME;
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS detalle_muestras       TEXT;
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS especificacion_tecnica VARCHAR(240);
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS protocolo_norma        VARCHAR(240);
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS norma_muestreo         VARCHAR(20);
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS cantidad_aleatoria     INT;
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS unidad_lote            VARCHAR(20);
ALTER TABLE ot_muestreo ADD COLUMN IF NOT EXISTS unidad_muestra         VARCHAR(20);
COMMENT ON COLUMN ot_muestreo.detalle_muestras IS 'Detalle de las muestras extraídas (distinto de las observaciones · R6).';
COMMENT ON COLUMN ot_muestreo.norma_muestreo IS 'NCh 44 (plan por atributos) | NCh 43 (selección al azar) | otra.';
COMMENT ON COLUMN ot_muestreo.cantidad_aleatoria IS 'Cantidad de muestras de la selección al azar (opcional · R6).';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_muestreo_aleatoria') THEN
    ALTER TABLE ot_muestreo ADD CONSTRAINT ck_ot_muestreo_aleatoria CHECK (cantidad_aleatoria IS NULL OR cantidad_aleatoria > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ot_muestreo_adjunto (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  muestreo_id UUID NOT NULL REFERENCES ot_muestreo(id),
  nombre      VARCHAR(200) NOT NULL,
  mime        VARCHAR(100) NOT NULL,
  bytes       INT          NOT NULL,
  datos       TEXT         NOT NULL,
  hash_sha256 VARCHAR(64)  NOT NULL,
  subido_por  UUID REFERENCES usuario(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
COMMENT ON TABLE ot_muestreo_adjunto IS 'Archivo del formulario de selección y extracción de muestras firmado en terreno (PDF o imagen · R6).';
CREATE INDEX IF NOT EXISTS ix_ot_muestreo_adjunto ON ot_muestreo_adjunto (muestreo_id) WHERE deleted_at IS NULL;

-- --- 6 · Listas y parámetros ----------------------------------------------------
-- 6.1 «Toma de muestra»: todas las sucursales del BPCH y la Delegación Nº 11.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT u.tenant_id, 'toma_muestra', 'sucursal_' || lower(u.codigo), left(u.nombre, 160),
       10 + row_number() OVER (PARTITION BY u.tenant_id ORDER BY u.nombre), NULL
  FROM unidad u
  JOIN unidad p ON p.id = u.padre_id AND p.codigo = 'BPCH'
 WHERE u.activa AND u.tipo IN ('SUCURSAL', 'DELEGACION')
   AND NOT EXISTS (SELECT 1 FROM parametro_sistema x WHERE x.tenant_id = u.tenant_id AND x.categoria = 'toma_muestra' AND lower(x.etiqueta) = lower(u.nombre))
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- 6.2 Unidades de tamaño (pedidas por el BPCH en R3) y ubicaciones de ejemplo.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
  ('unidad_tamano_lote',    'kg',       'Kilos',      1),
  ('unidad_tamano_lote',    't',        'Toneladas',  2),
  ('unidad_tamano_muestra', 't',        'Toneladas',  1),
  ('unidad_tamano_muestra', 'kg',       'Kilos',      2),
  ('unidad_tamano_muestra', 'g',        'Gramos',     3),
  ('unidad_tamano_muestra', 'unidades', 'Unidades',   4),
  ('ubicacion_almacenamiento', 'prueba_bodega_1', 'PRUEBA · Bodega de muestras 1',     1),
  ('ubicacion_almacenamiento', 'prueba_bodega_2', 'PRUEBA · Bodega de muestras 2',     2),
  ('ubicacion_almacenamiento', 'prueba_refrigerador', 'PRUEBA · Refrigerador de muestras', 3),
  ('ubicacion_almacenamiento', 'prueba_polvorin', 'PRUEBA · Polvorín de custodia',     4)
 ) AS v(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- 6.3 Parámetros de la operación (Catálogo › Parámetros, con motivo).
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('bpch_resolucion', 'vigencia_dias',
   'Días de vigencia de la resolución: la OT del BPCH o la D11 no puede durar más', 1, '180'),
  ('terreno', 'laboratorios',
   'Laboratorios que trabajan en terreno sin recepción ni toma de muestras', 1, 'SVM,LAM,SEO'),
  ('bpch_lugar_inspeccion', 'tabla',
   'Plantas y lugares de inspección con su dirección', 1,
   '[{"lugar":"PRUEBA · Planta de ejemplo Norte","direccion":"PRUEBA · Calle Uno 100","comuna":"Antofagasta","sucursal":"SANTOF"},{"lugar":"PRUEBA · Faena minera de ejemplo","direccion":"PRUEBA · Camino interior km 10","comuna":"Calama","sucursal":"SCALAM"},{"lugar":"PRUEBA · Bodega de ejemplo Centro","direccion":"PRUEBA · Avenida Dos 200","comuna":"Santiago","sucursal":"SSTGO"}]'),
  ('terreno_protocolo', 'SVM',
   'Protocolo de recepción cualitativa · Vehículos Militares', 1,
   '[{"sistema":"PRUEBA · Motor","prueba":"PRUEBA · Arranque y ralentí","requisito":"Arranca y mantiene ralentí estable"},{"sistema":"PRUEBA · Frenos","prueba":"PRUEBA · Frenado en pendiente","requisito":"Detiene el vehículo sin desplazamiento"},{"sistema":"PRUEBA · Dirección","prueba":"PRUEBA · Giro completo","requisito":"Sin juego ni ruidos anormales"}]'),
  ('terreno_protocolo', 'LAM',
   'Protocolo de recepción cualitativa · Armamento y Municiones', 2,
   '[{"sistema":"PRUEBA · Mecanismo","prueba":"PRUEBA · Inspección ocular","requisito":"Sin daños ni corrosión"},{"sistema":"PRUEBA · Funcionamiento","prueba":"PRUEBA · Prueba de funcionamiento","requisito":"Cicla sin interrupciones"}]'),
  ('terreno_protocolo', 'SEO',
   'Protocolo de recepción cualitativa · Electrónica y Optrónica', 3,
   '[{"sistema":"PRUEBA · Alimentación","prueba":"PRUEBA · Encendido","requisito":"Enciende y supera el autodiagnóstico"},{"sistema":"PRUEBA · Comunicación","prueba":"PRUEBA · Enlace de prueba","requisito":"Establece enlace a la distancia indicada"}]')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 7 · Permisos ---------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'terreno.registrar', 'terreno', 'registrar',
   'Terreno (SVM, LAM, SEO): registrar unidades controladas, pruebas, lista de chequeo y adjuntos de la OT en terreno.'),
  (gen_random_uuid(), 'terreno.gestionar', 'terreno', 'gestionar',
   'Terreno: abrir el trabajo en terreno, asignar analistas, emitir el IVC (cumple / no cumple) y cerrar.'),
  (gen_random_uuid(), 'arma.devolver', 'arma', 'devolver',
   'D11: devolver un arma por motivos técnicos en cualquier paso (anula su certificado y devuelve sus resultados).'),
  (gen_random_uuid(), 'bpch.bateria.excepcion', 'bpch', 'bateria.excepcion',
   'BPCH: registrar un lote sin algún ensayo de la batería fija del procedimiento de calidad (excepción con motivo).')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('ANALISTA', 'terreno.registrar'), ('REVISOR', 'terreno.registrar'),
    ('JEFE_LAB', 'terreno.registrar'), ('JEFE_LAB', 'terreno.gestionar'),
    ('JEFE_SECCION', 'terreno.registrar'), ('JEFE_SECCION', 'terreno.gestionar'),
    ('JEFE_DEPTO', 'terreno.registrar'), ('JEFE_DEPTO', 'terreno.gestionar'),
    ('JEFE_LAB', 'arma.devolver'), ('JEFE_SECCION', 'arma.devolver'), ('JEFE_DEPTO', 'arma.devolver'),
    ('JEFE_SECCION', 'bpch.bateria.excepcion'), ('JEFE_DEPTO', 'bpch.bateria.excepcion'),
    ('SUPERADMIN', 'terreno.registrar'), ('SUPERADMIN', 'terreno.gestionar'),
    ('SUPERADMIN', 'arma.devolver'), ('SUPERADMIN', 'bpch.bateria.excepcion')
  ) AS m(rol, perm)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
