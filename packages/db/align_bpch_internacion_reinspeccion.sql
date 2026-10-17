-- =============================================================================
-- LIMS IDIC · BPCH · Internación, Reinspección y Codificación Única · Aiuken
-- =============================================================================
-- Tres procesos del Banco de Pruebas de Chile construidos SOBRE el flujo
-- general (OT → muestras → resultados → documento → firma → entrega → cierre):
--
--   · Codificación Única (bpch_codificacion): listado oficial de productos con
--     su código CNC-DGMN por fabricante; listados Explosivos / Sustancias
--     químicas, estados Vigente / En receso; historial de cada producto.
--   · Internación (bpch_internacion, IDIC-PG 24 Anexo 03): registro desde la
--     resolución DGMN, análisis técnico con solicitud de antecedentes a DGMN,
--     OT automática ligada, lotes a inspeccionar, documentación administrativa
--     y tasa (calculo_tasa_internacion) que pasa a facturación.
--   · Reinspección (bpch_reinspeccion): nueva inspección de un producto o lote
--     ya inspeccionado, ligada a la OT / certificado / código original.
--
-- Además: vista v_bpch_cabecera_ot (cabecera de los documentos BPCH), origen
-- de OT REINSPECCION, parámetros (tasa %, IVA %, motivos de reinspección),
-- permisos bpch.* y cuerpo de las plantillas SCC si aún tienen el genérico.
--
-- ADITIVO e IDEMPOTENTE: CREATE … IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- ON CONFLICT DO NOTHING. Reglas: docs/FLUJO_BPCH_INTERNACION_REINSPECCION_CODIFICACION.md
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0 · Correlativos de expediente (INT-AAAA-NNNN, REI-AAAA-NNNN)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_correlativo (
  tenant_id   UUID        NOT NULL REFERENCES tenant(id),
  tipo        VARCHAR(10) NOT NULL,
  anio        INTEGER     NOT NULL,
  ultimo      INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tipo, anio)
);

-- -----------------------------------------------------------------------------
-- 1 · Codificación Única
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_codificacion (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenant(id),
  listado            VARCHAR(20)  NOT NULL CHECK (listado IN ('EXPLOSIVOS', 'SUSTANCIAS_QUIMICAS')),
  estado             VARCHAR(12)  NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'EN_RECESO')),
  cnc_dgmn           VARCHAR(80)  NOT NULL,
  cnc_normalizado    VARCHAR(80)  NOT NULL,
  cliente_id         UUID         REFERENCES cliente(id),
  fabricante_nombre  VARCHAR(200) NOT NULL,
  fabricante_rut     VARCHAR(20),
  elemento_generico  VARCHAR(240),
  producto           VARCHAR(240) NOT NULL,
  clase_division_un  VARCHAR(20),
  numero_un          VARCHAR(10),
  cat_elemento_id    UUID         REFERENCES cat_elemento(id),
  certificado_id     UUID         REFERENCES certificado(id),
  certificado_numero VARCHAR(60),
  observaciones      TEXT,
  created_by         UUID,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by         UUID,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
COMMENT ON TABLE bpch_codificacion IS 'Listado de Codificación Única (DGMN/BPCH): producto, fabricante y código CNC-DGMN. Estado Vigente / En receso.';
COMMENT ON COLUMN bpch_codificacion.cnc_normalizado IS 'CNC sin espacios ni separadores de miles, en mayúsculas: clave de unicidad.';
CREATE UNIQUE INDEX IF NOT EXISTS ux_bpch_codificacion_cnc
  ON bpch_codificacion (tenant_id, cnc_normalizado) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_codificacion_listado
  ON bpch_codificacion (tenant_id, listado, estado) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_codificacion_cliente ON bpch_codificacion (cliente_id);

CREATE TABLE IF NOT EXISTS bpch_codificacion_historial (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenant(id),
  codificacion_id  UUID        NOT NULL REFERENCES bpch_codificacion(id) ON DELETE CASCADE,
  evento           VARCHAR(30) NOT NULL,
  detalle          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ot_id            UUID        REFERENCES orden_trabajo(id),
  certificado_id   UUID        REFERENCES certificado(id),
  usuario_id       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bpch_cod_hist ON bpch_codificacion_historial (codificacion_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2 · Internación (IDIC-PG 24 Anexo 03)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_internacion (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID         NOT NULL REFERENCES tenant(id),
  numero                  VARCHAR(20)  NOT NULL,
  estado                  VARCHAR(30)  NOT NULL DEFAULT 'registrada'
                          CHECK (estado IN ('registrada', 'antecedentes_pendientes', 'ot_generada', 'anulada')),
  -- Registro (resolución DGMN)
  resolucion_numero       VARCHAR(60)  NOT NULL,
  resolucion_fecha        DATE         NOT NULL,
  oficio                  VARCHAR(60),
  cliente_id              UUID         NOT NULL REFERENCES cliente(id),
  documento_aduanero      VARCHAR(60),
  pais_origen             VARCHAR(80),
  esquema                 VARCHAR(10)  NOT NULL DEFAULT 'LOTES' CHECK (esquema IN ('LOTES', 'TIPO')),
  procedimiento           VARCHAR(40),
  unidad_inspeccion_id    UUID         NOT NULL REFERENCES unidad(id),
  sujeta_tasa             BOOLEAN      NOT NULL,
  -- Análisis técnico (SCC)
  info_completa           BOOLEAN,
  analista_id             UUID         REFERENCES usuario(id),
  fecha_analisis          DATE,
  observaciones_analisis  TEXT,
  ot_id                   UUID         REFERENCES orden_trabajo(id),
  ot_generada_at          TIMESTAMPTZ,
  -- Documentación administrativa para la tasa
  doc_adm_estado          VARCHAR(20)  NOT NULL DEFAULT 'no_aplica'
                          CHECK (doc_adm_estado IN ('no_aplica', 'pendiente', 'solicitada', 'recibida', 'conforme', 'no_conforme')),
  doc_adm_solicitada_at   DATE,
  doc_adm_recibida_at     DATE,
  doc_adm_detalle         TEXT,
  factura_comercial       VARCHAR(60),
  -- Inspección (cabecera del Informe de Inspección)
  lugar_inspeccion        VARCHAR(240),
  fecha_inspeccion        DATE,
  inspectores             VARCHAR(240),
  fecha_vencimiento_producto DATE,
  vigencia_informe        DATE,
  observaciones_inspeccion TEXT,
  -- Remisión a Comercial / facturación de la tasa
  remitida_dco_at         TIMESTAMPTZ,
  remitida_dco_por        UUID,
  factura_id              UUID         REFERENCES factura(id),
  anulada_motivo          TEXT,
  created_by              UUID,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by              UUID,
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero)
);
COMMENT ON TABLE bpch_internacion IS 'Expediente de internación BPCH (IDIC-PG 24 Anexo 03): resolución DGMN → análisis técnico → OT automática → inspección → certificado/incumplimiento → tasa.';
CREATE UNIQUE INDEX IF NOT EXISTS ux_bpch_internacion_ot ON bpch_internacion (ot_id) WHERE ot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_internacion_estado ON bpch_internacion (tenant_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_bpch_internacion_cliente ON bpch_internacion (cliente_id);
CREATE INDEX IF NOT EXISTS ix_bpch_internacion_unidad ON bpch_internacion (unidad_inspeccion_id);

CREATE TABLE IF NOT EXISTS bpch_internacion_item (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL REFERENCES tenant(id),
  internacion_id       UUID         NOT NULL REFERENCES bpch_internacion(id) ON DELETE CASCADE,
  orden                INTEGER      NOT NULL DEFAULT 1,
  codificacion_id      UUID         REFERENCES bpch_codificacion(id),
  cat_elemento_id      UUID         REFERENCES cat_elemento(id),
  elemento_generico    VARCHAR(240),
  elemento_especifico  VARCHAR(240) NOT NULL,
  cnc_dgmn             VARCHAR(80),
  clase_division_un    VARCHAR(20),
  numero_un            VARCHAR(10),
  cantidad             NUMERIC(14, 2),
  unidad_medida        VARCHAR(20),
  identificacion_lote  VARCHAR(80),
  tamano_lote          INTEGER,
  tamano_muestra       INTEGER,
  muestra_id           UUID         REFERENCES muestra(id),
  CONSTRAINT ck_bpch_item_muestra_lote CHECK (tamano_muestra IS NULL OR tamano_lote IS NULL OR tamano_muestra <= tamano_lote)
);
CREATE INDEX IF NOT EXISTS ix_bpch_internacion_item ON bpch_internacion_item (internacion_id, orden);
CREATE INDEX IF NOT EXISTS ix_bpch_internacion_item_cod ON bpch_internacion_item (codificacion_id);

CREATE TABLE IF NOT EXISTS bpch_solicitud_antecedentes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         NOT NULL REFERENCES tenant(id),
  internacion_id   UUID         NOT NULL REFERENCES bpch_internacion(id) ON DELETE CASCADE,
  destinatario     VARCHAR(200) NOT NULL,
  detalle          TEXT         NOT NULL,
  fecha_envio      DATE         NOT NULL,
  fecha_respuesta  DATE,
  respuesta        TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bpch_solicitud ON bpch_solicitud_antecedentes (internacion_id, created_at);

-- Tasa: la tabla existe en schema.sql; en bases que no la tengan se crea igual.
CREATE TABLE IF NOT EXISTS calculo_tasa_internacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ot_id               UUID REFERENCES orden_trabajo(id),
  cliente_id          UUID REFERENCES cliente(id),
  tasa_id             UUID,
  monto_cif_usd       NUMERIC(16,2),
  paridad_usd         NUMERIC(12,4),
  monto_cif_clp       NUMERIC(18,2),
  pct_afecto          NUMERIC(6,2) DEFAULT 100.00,
  monto_operacion     NUMERIC(18,2),
  iva_internacion     NUMERIC(18,2),
  total_a_cancelar    NUMERIC(18,2),
  distribucion_cc     JSONB,
  documento_cb        UUID,
  calculado_por       UUID,
  calculado_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS internacion_id UUID REFERENCES bpch_internacion(id);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS tasa_pct      NUMERIC(6,3);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS iva_pct       NUMERIC(5,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS factura_id    UUID REFERENCES factura(id);
CREATE INDEX IF NOT EXISTS ix_calc_tasa_internacion ON calculo_tasa_internacion (internacion_id, calculado_at DESC);

-- -----------------------------------------------------------------------------
-- 3 · Reinspección
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_reinspeccion (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID         NOT NULL REFERENCES tenant(id),
  numero                  VARCHAR(20)  NOT NULL,
  estado                  VARCHAR(20)  NOT NULL DEFAULT 'ot_generada' CHECK (estado IN ('ot_generada', 'anulada')),
  -- Solicitud
  motivo                  VARCHAR(30)  NOT NULL,
  motivo_detalle          TEXT,
  solicitado_por          VARCHAR(160) NOT NULL,
  documento_solicitud     VARCHAR(120),
  fecha_solicitud         DATE         NOT NULL,
  -- Antecedente original (al menos uno)
  origen_ot_id            UUID         REFERENCES orden_trabajo(id),
  certificado_origen_id   UUID         REFERENCES certificado(id),
  codificacion_id         UUID         REFERENCES bpch_codificacion(id),
  internacion_origen_id   UUID         REFERENCES bpch_internacion(id),
  -- Titular y producto (heredados del antecedente, editables)
  cliente_id              UUID         NOT NULL REFERENCES cliente(id),
  empresa_destino         VARCHAR(200),
  cliente_destino_id      UUID         REFERENCES cliente(id),
  esquema                 VARCHAR(10)  NOT NULL DEFAULT 'TIPO' CHECK (esquema IN ('LOTES', 'TIPO')),
  procedimiento           VARCHAR(40),
  unidad_inspeccion_id    UUID         NOT NULL REFERENCES unidad(id),
  con_cobro               BOOLEAN      NOT NULL,
  elemento_generico       VARCHAR(240),
  elemento_especifico     VARCHAR(240) NOT NULL,
  cnc_dgmn                VARCHAR(80),
  clase_division_un       VARCHAR(20),
  numero_un               VARCHAR(10),
  cat_elemento_id         UUID         REFERENCES cat_elemento(id),
  -- Lote e inspección
  identificacion_lote     VARCHAR(80),
  tamano_lote             INTEGER,
  tamano_muestra          INTEGER,
  muestra_id              UUID         REFERENCES muestra(id),
  lugar_inspeccion        VARCHAR(240),
  fecha_inspeccion        DATE,
  inspectores             VARCHAR(240),
  fecha_vencimiento_producto DATE,
  vigencia_informe        DATE,
  observaciones_inspeccion TEXT,
  ot_id                   UUID         REFERENCES orden_trabajo(id),
  trazabilidad_at         TIMESTAMPTZ,
  anulada_motivo          TEXT,
  created_by              UUID,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by              UUID,
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero),
  CONSTRAINT ck_bpch_reinsp_antecedente CHECK (origen_ot_id IS NOT NULL OR certificado_origen_id IS NOT NULL OR codificacion_id IS NOT NULL),
  CONSTRAINT ck_bpch_reinsp_muestra_lote CHECK (tamano_muestra IS NULL OR tamano_lote IS NULL OR tamano_muestra <= tamano_lote)
);
COMMENT ON TABLE bpch_reinspeccion IS 'Reinspección BPCH: nueva inspección de un producto/lote ya inspeccionado, ligada a la OT, certificado o código original (SAC-PG05, no entregado).';
CREATE UNIQUE INDEX IF NOT EXISTS ux_bpch_reinspeccion_ot ON bpch_reinspeccion (ot_id) WHERE ot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_reinspeccion_estado ON bpch_reinspeccion (tenant_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_bpch_reinspeccion_origen ON bpch_reinspeccion (origen_ot_id);
CREATE INDEX IF NOT EXISTS ix_bpch_reinspeccion_cod ON bpch_reinspeccion (codificacion_id);
CREATE INDEX IF NOT EXISTS ix_bpch_reinspeccion_unidad ON bpch_reinspeccion (unidad_inspeccion_id);

-- -----------------------------------------------------------------------------
-- 4 · Cabecera de los documentos BPCH por OT (Informe de Inspección,
--     Certificado de Conformidad, Informe de Incumplimiento). La lee el motor
--     de plantillas como {{bpch.*}}. Otros procesos BPCH pueden sumarse aquí.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_bpch_cabecera_ot;
CREATE VIEW v_bpch_cabecera_ot AS
SELECT i.ot_id,
       'INTERNACION'::text                         AS proceso,
       i.numero                                    AS expediente,
       'Internación'::text                         AS origen,
       CASE i.esquema WHEN 'TIPO' THEN 'Tipo' ELSE 'Por lotes' END AS esquema,
       i.procedimiento,
       i.resolucion_numero || ' · ' || to_char(i.resolucion_fecha, 'DD-MM-YYYY') AS documento,
       cl.razon_social                             AS empresa,
       cl.rut                                      AS rut,
       u.nombre                                    AS organismo,
       i.lugar_inspeccion,
       to_char(i.fecha_inspeccion, 'DD-MM-YYYY')   AS fecha_inspeccion,
       i.inspectores,
       (SELECT string_agg(COALESCE(it.elemento_generico, ''), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS elemento_generico,
       (SELECT string_agg(it.elemento_especifico, ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS elemento_especifico,
       (SELECT string_agg(COALESCE(it.cnc_dgmn, '—'), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS cnc_dgmn,
       (SELECT string_agg(COALESCE(it.clase_division_un, '—') || ' · ' || COALESCE(it.numero_un, '—'), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS clase_un,
       (SELECT string_agg(COALESCE(it.identificacion_lote, '—'), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS lote,
       (SELECT string_agg(COALESCE(it.tamano_lote::text, '—') || ' / ' || COALESCE(it.tamano_muestra::text, '—'), ' · ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS tamano_lote_muestra,
       to_char(i.fecha_vencimiento_producto, 'DD-MM-YYYY') AS vencimiento_producto,
       to_char(i.vigencia_informe, 'DD-MM-YYYY')   AS vigencia_informe,
       i.observaciones_inspeccion                  AS observaciones,
       NULL::text                                  AS motivo
  FROM bpch_internacion i
  JOIN cliente cl ON cl.id = i.cliente_id
  JOIN unidad u ON u.id = i.unidad_inspeccion_id
 WHERE i.ot_id IS NOT NULL
UNION ALL
SELECT r.ot_id,
       'REINSPECCION'::text,
       r.numero,
       'Reinspección'::text,
       CASE r.esquema WHEN 'TIPO' THEN 'Tipo' ELSE 'Por lotes' END,
       r.procedimiento,
       COALESCE(r.documento_solicitud, 'Solicitud') || ' · ' || to_char(r.fecha_solicitud, 'DD-MM-YYYY'),
       cl.razon_social,
       cl.rut,
       u.nombre,
       r.lugar_inspeccion,
       to_char(r.fecha_inspeccion, 'DD-MM-YYYY'),
       r.inspectores,
       r.elemento_generico,
       r.elemento_especifico,
       r.cnc_dgmn,
       COALESCE(r.clase_division_un, '—') || ' · ' || COALESCE(r.numero_un, '—'),
       r.identificacion_lote,
       COALESCE(r.tamano_lote::text, '—') || ' / ' || COALESCE(r.tamano_muestra::text, '—'),
       to_char(r.fecha_vencimiento_producto, 'DD-MM-YYYY'),
       to_char(r.vigencia_informe, 'DD-MM-YYYY'),
       r.observaciones_inspeccion,
       r.motivo
  FROM bpch_reinspeccion r
  JOIN cliente cl ON cl.id = r.cliente_id
  JOIN unidad u ON u.id = r.unidad_inspeccion_id
 WHERE r.ot_id IS NOT NULL;
COMMENT ON VIEW v_bpch_cabecera_ot IS 'Cabecera común de los documentos BPCH por OT ({{bpch.*}} en las plantillas SCC).';

-- -----------------------------------------------------------------------------
-- 5 · Parámetros (Administración › Parámetros del sistema)
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (id, tenant_id, categoria, codigo, etiqueta, orden, activo, valor)
SELECT gen_random_uuid(), t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.activo, v.valor
FROM tenant t
CROSS JOIN (VALUES
  ('origen_trabajo', 'REINSPECCION', 'Reinspección (BPCH)', 6, TRUE, NULL),
  -- Tasa de internación (IDIC-PG 24 Anexo 03; % levantado 1,5). Valores editables.
  ('bpch_tasa', 'tasa_pct', 'Tasa de internación sobre el CIF afecto (%)', 1, TRUE, '1.5'),
  ('bpch_tasa', 'iva_pct',  'IVA aplicado a la tasa (%)',                  2, TRUE, '19'),
  -- Motivos de reinspección (solo uno documentado: traspaso; el resto a confirmar con BPCH)
  ('bpch_motivo_reinspeccion', 'TRASPASO',    'Traspaso / venta entre empresas',              1, TRUE, NULL),
  ('bpch_motivo_reinspeccion', 'VENCIMIENTO', 'Vencimiento de vigencia',                      2, TRUE, NULL),
  ('bpch_motivo_reinspeccion', 'RECHAZO',     'Lote rechazado en una inspección anterior',    3, TRUE, NULL),
  ('bpch_motivo_reinspeccion', 'OTRO',        'Otro (indique el detalle)',                    9, TRUE, NULL)
) AS v(categoria, codigo, etiqueta, orden, activo, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6 · Permisos
-- -----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'bpch.internacion.ver',       'bpch', 'internacion.ver',
   'Ver los expedientes de internación BPCH'),
  (gen_random_uuid(), 'bpch.internacion.registrar', 'bpch', 'internacion.registrar',
   'Registrar una internación desde la resolución DGMN y corregir su registro antes de generar la OT'),
  (gen_random_uuid(), 'bpch.internacion.gestionar', 'bpch', 'internacion.gestionar',
   'Análisis técnico, solicitud de antecedentes a DGMN, documentación administrativa, lotes e inspección de la internación'),
  (gen_random_uuid(), 'bpch.tasa.gestionar',        'bpch', 'tasa.gestionar',
   'Calcular la tasa de internación y remitirla a facturación'),
  (gen_random_uuid(), 'bpch.reinspeccion.ver',      'bpch', 'reinspeccion.ver',
   'Ver las reinspecciones BPCH'),
  (gen_random_uuid(), 'bpch.reinspeccion.gestionar','bpch', 'reinspeccion.gestionar',
   'Registrar y gestionar reinspecciones BPCH'),
  (gen_random_uuid(), 'bpch.codificacion.ver',      'bpch', 'codificacion.ver',
   'Consultar el listado de Codificación Única'),
  (gen_random_uuid(), 'bpch.codificacion.gestionar','bpch', 'codificacion.gestionar',
   'Inscribir, corregir, pasar a receso o reactivar productos de la Codificación Única')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN ('bpch.internacion.ver', 'bpch.reinspeccion.ver', 'bpch.codificacion.ver')
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'INSPECTOR', 'COMERCIAL', 'PLANIFICACION', 'FINANZAS', 'LECTOR')
ON CONFLICT DO NOTHING;

-- Registro de la resolución: Comercial (SVT) y jefaturas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.internacion.registrar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION', 'COMERCIAL')
ON CONFLICT DO NOTHING;

-- Tramitación técnica: Sección Certificación, sucursales y jefaturas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN ('bpch.internacion.gestionar')
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'INSPECTOR')
ON CONFLICT DO NOTHING;

-- Tasa: Comercial (cálculo y factura) y jefaturas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.tasa.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'COMERCIAL')
ON CONFLICT DO NOTHING;

-- Reinspección: la solicita el Jefe de Sucursal; jefaturas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.reinspeccion.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION', 'JEFE_LAB', 'JEFELAB')
ON CONFLICT DO NOTHING;

-- Codificación Única: Subdirección BPCH (jefatura de departamento), Sección Certificación, Dirección.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.codificacion.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7 · Cuerpo de las plantillas SCC (solo si siguen con el cuerpo genérico
--     sembrado o vacío: nunca se pisa una plantilla ya maquetada)
-- -----------------------------------------------------------------------------
UPDATE plantilla_informe SET cuerpo_html = $html$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>EJÉRCITO DE CHILE · INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Banco de Pruebas de Chile · {{bpch.organismo}}</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME DE INSPECCIÓN</h1>

<table class="meta">
  <tr><th>Empresa</th><td>{{bpch.empresa}}</td><th>RUT</th><td>{{bpch.rut}}</td></tr>
  <tr><th>Origen del trabajo</th><td>{{bpch.origen}}</td><th>Esquema</th><td>{{bpch.esquema}}</td></tr>
  <tr><th>Documento</th><td>{{bpch.documento}}</td><th>Procedimiento de control</th><td>{{bpch.procedimiento}}</td></tr>
  <tr><th>Elemento genérico</th><td>{{bpch.elemento_generico}}</td><th>Elemento específico</th><td>{{bpch.elemento_especifico}}</td></tr>
  <tr><th>CNC-DGMN</th><td>{{bpch.cnc_dgmn}}</td><th>Clase/División UN · Nº UN</th><td>{{bpch.clase_un}}</td></tr>
  <tr><th>Organismo de inspección</th><td>{{bpch.organismo}}</td><th>Lugar de inspección</th><td>{{bpch.lugar_inspeccion}}</td></tr>
  <tr><th>Fecha de inspección</th><td>{{bpch.fecha_inspeccion}}</td><th>Orden de trabajo</th><td>{{ot.codigo}} ({{bpch.expediente}})</td></tr>
  <tr><th>Identificación del lote</th><td>{{bpch.lote}}</td><th>Tamaño lote / muestra</th><td>{{bpch.tamano_lote_muestra}}</td></tr>
</table>

<h2>Resultados de la inspección</h2>
{{tabla_inspeccion}}

<table class="meta">
  <tr><th>Observaciones</th><td colspan="3">{{bpch.observaciones}}</td></tr>
  <tr><th>Vencimiento del producto</th><td>{{bpch.vencimiento_producto}}</td><th>Vigencia del informe</th><td>{{bpch.vigencia_informe}}</td></tr>
  <tr><th>Condición</th><td colspan="3"><b>{{bpch.condicion_final}}</b></td></tr>
</table>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe de Sucursal / Organismo de inspección</div>
</div>
$html$
WHERE repid = 'SCCII'
  AND (cuerpo_html IS NULL OR btrim(cuerpo_html) = '' OR md5(cuerpo_html) = 'd67e946a50d47394bc54fd697933640e');

UPDATE plantilla_informe SET cuerpo_html = $html$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>EJÉRCITO DE CHILE · INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Banco de Pruebas de Chile · Sección Certificación de la Conformidad</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>CERTIFICADO DE CONFORMIDAD</h1>

<p>El Instituto de Investigaciones y Control del Ejército, en su función de Banco de Pruebas de Chile,
certifica la conformidad de los productos inspeccionados de acuerdo a la Ley N° 17.798 sobre Control
de Armas, su reglamento complementario, las resoluciones DGMN y las normas chilenas aplicables,
conforme al siguiente detalle:</p>

<table class="meta">
  <tr><th>Empresa</th><td>{{bpch.empresa}}</td><th>RUT</th><td>{{bpch.rut}}</td></tr>
  <tr><th>Origen del trabajo</th><td>{{bpch.origen}}</td><th>Esquema</th><td>{{bpch.esquema}}</td></tr>
  <tr><th>Documento</th><td>{{bpch.documento}}</td><th>Procedimiento de control</th><td>{{bpch.procedimiento}}</td></tr>
  <tr><th>Elemento genérico</th><td>{{bpch.elemento_generico}}</td><th>Elemento específico</th><td>{{bpch.elemento_especifico}}</td></tr>
  <tr><th>CNC-DGMN</th><td>{{bpch.cnc_dgmn}}</td><th>Clase/División UN · Nº UN</th><td>{{bpch.clase_un}}</td></tr>
  <tr><th>Organismo de inspección</th><td>{{bpch.organismo}}</td><th>Informe de Inspección Nº</th><td>{{bpch.informe_inspeccion}}</td></tr>
  <tr><th>Fecha de inspección</th><td>{{bpch.fecha_inspeccion}}</td><th>Orden de trabajo</th><td>{{ot.codigo}} ({{bpch.expediente}})</td></tr>
  <tr><th>Identificación del lote</th><td>{{bpch.lote}}</td><th>Tamaño lote / muestra</th><td>{{bpch.tamano_lote_muestra}}</td></tr>
</table>

{{tabla_inspeccion}}

<table class="meta">
  <tr><th>Observaciones</th><td colspan="3">{{bpch.observaciones}}</td></tr>
  <tr><th>Vencimiento del producto</th><td>{{bpch.vencimiento_producto}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
  <tr><th>CONDICIÓN FINAL</th><td colspan="3"><b>{{bpch.condicion_final}}</b></td></tr>
</table>

<p class="nota">Distribución: 1. Persona natural / jurídica · 2. BPCH SCC (archivo).</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Sección Certificación de la Conformidad</div>
</div>
$html$
WHERE repid IN ('SCCCC', 'SCCDG')
  AND (cuerpo_html IS NULL OR btrim(cuerpo_html) = '' OR md5(cuerpo_html) = '12bacbdd44021e7b0c0e6253b68643e1');

UPDATE plantilla_informe SET cuerpo_html = $html$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>EJÉRCITO DE CHILE · INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Banco de Pruebas de Chile · Sección Certificación de la Conformidad</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME DE INCUMPLIMIENTO</h1>

<p>El Instituto de Investigaciones y Control del Ejército, en su función de Banco de Pruebas de Chile,
informa el incumplimiento de los productos inspeccionados de acuerdo a la Ley N° 17.798 sobre Control
de Armas, conforme al siguiente detalle:</p>

<table class="meta">
  <tr><th>Empresa</th><td>{{bpch.empresa}}</td><th>RUT</th><td>{{bpch.rut}}</td></tr>
  <tr><th>Origen del trabajo</th><td>{{bpch.origen}}</td><th>Esquema</th><td>{{bpch.esquema}}</td></tr>
  <tr><th>Documento</th><td>{{bpch.documento}}</td><th>Procedimiento de control</th><td>{{bpch.procedimiento}}</td></tr>
  <tr><th>Elemento genérico</th><td>{{bpch.elemento_generico}}</td><th>Elemento específico</th><td>{{bpch.elemento_especifico}}</td></tr>
  <tr><th>CNC-DGMN</th><td>{{bpch.cnc_dgmn}}</td><th>Clase/División UN · Nº UN</th><td>{{bpch.clase_un}}</td></tr>
  <tr><th>Organismo de inspección</th><td>{{bpch.organismo}}</td><th>Informe de Inspección Nº</th><td>{{bpch.informe_inspeccion}}</td></tr>
  <tr><th>Fecha de inspección</th><td>{{bpch.fecha_inspeccion}}</td><th>Orden de trabajo</th><td>{{ot.codigo}} ({{bpch.expediente}})</td></tr>
  <tr><th>Identificación del lote</th><td>{{bpch.lote}}</td><th>Tamaño lote / muestra</th><td>{{bpch.tamano_lote_muestra}}</td></tr>
</table>

{{tabla_inspeccion}}

<table class="meta">
  <tr><th>Observaciones</th><td colspan="3">{{bpch.observaciones}}</td></tr>
  <tr><th>CONDICIÓN FINAL</th><td colspan="3"><b>{{bpch.condicion_final}}</b></td></tr>
</table>

<p class="nota">Distribución: 1. DGMN DCAE · 2. Autoridad fiscalizadora (C/I) · 3. BPCH SCC (archivo).</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Sección Certificación de la Conformidad</div>
</div>
$html$
WHERE repid IN ('SCCID', 'SCCIN')
  AND (cuerpo_html IS NULL OR btrim(cuerpo_html) = '' OR md5(cuerpo_html) = 'd67e946a50d47394bc54fd697933640e');

COMMIT;
