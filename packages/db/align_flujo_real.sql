-- =============================================================================
-- align_flujo_real.sql · Corrige D1/D2/D4/D5 del ANALISIS_FLUJO_REAL_LIMS_IDIC
-- -----------------------------------------------------------------------------
-- Aditivo (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS), idempotente,
-- multi-tenant. NO borra ni cambia nada existente: la app viva sigue usando las
-- columnas antiguas (orden_trabajo.estado, cotizacion.gastos_admin_pct).
--
-- D1  OT dual: Genérico(Comercial)/En Espera  <->  Definitivo(Técnico)/Registrado
-- D2  Segundo camino de costeo: Costos Directos por laboratorio + %Admin + %Utilidad
-- D4  Órdenes Internas y Inspección por Muestreo (traspaso entre labs/roles)
-- D5  Catálogo de formatos de informe + Decisión/Atestación de conformidad (OCC/OI)
-- =============================================================================

-- ------------------------------------------------------------ D1 · OT DUAL ---
-- Una sola OT con dos registros y su máquina de estados REAL (jerga StarLIMS).
-- Se conserva `estado` (legacy) y se añade `estado_ot` con el vocabulario real.
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS fase_registro     VARCHAR(20)  NOT NULL DEFAULT 'generico';  -- generico | definitivo
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS estado_ot         VARCHAR(30)  NOT NULL DEFAULT 'en_espera'; -- en_espera|registrado|activo|cumple|no_cumple|cerrada
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS elemento_generico VARCHAR(240);                              -- nivel comercial (Elemento Genérico)
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cat_elemento_id   UUID REFERENCES cat_elemento(id);          -- nivel técnico (Elemento Específico)
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS oc_numero         VARCHAR(40);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cotizacion_numero VARCHAR(40);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS en_espera_at      TIMESTAMPTZ DEFAULT now();
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS registrado_at     TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_ot_estado_ot ON orden_trabajo(tenant_id, estado_ot);
COMMENT ON COLUMN orden_trabajo.fase_registro IS 'Registro Genérico (Comercial) vs Definitivo (Técnico). D1 del ANALISIS_FLUJO_REAL.';
COMMENT ON COLUMN orden_trabajo.estado_ot IS 'Máquina de estados real: en_espera->registrado->activo->cumple|no_cumple->cerrada.';

-- ------------------------------------------------------- D2 · COSTEO (b) -----
-- El camino (a) precio fijo ya existe (lista_precio/linea_cotizacion). Se añade
-- el camino (b): cada laboratorio estima Horas Hombre + Costos Directos contra
-- la solicitud; Comercial consolida ΣCostos Directos +%Admin +%Utilidad.
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS via_costeo            VARCHAR(20)  NOT NULL DEFAULT 'precio_fijo'; -- precio_fijo | estimacion
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS utilidad_pct         NUMERIC(5,2)  DEFAULT 0;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS utilidad_monto       NUMERIC(14,2) DEFAULT 0;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS costos_directos_total NUMERIC(14,2) DEFAULT 0;
COMMENT ON COLUMN cotizacion.via_costeo IS 'D2: precio_fijo (tarifa/OC directa) vs estimacion (Costos Directos por laboratorio).';

-- Solicitud de costeo a laboratorio (una fila por laboratorio/elemento/ensayo de
-- la cotización). El laboratorio graba horas_hombre + costo_directo; puede haber
-- una Glosa (texto libre) para pruebas no identificadas.
CREATE TABLE IF NOT EXISTS solicitud_costeo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  cotizacion_id  UUID NOT NULL REFERENCES cotizacion(id) ON DELETE CASCADE,
  familia_id     UUID REFERENCES cat_familia(id),          -- laboratorio destino
  cat_elemento_id UUID REFERENCES cat_elemento(id),
  cat_ensayo_id  UUID REFERENCES cat_ensayo(id),
  glosa          TEXT,                                     -- prueba no identificada
  horas_hombre   NUMERIC(10,2) DEFAULT 0,
  costo_directo  NUMERIC(14,2) DEFAULT 0,
  estado         VARCHAR(20) NOT NULL DEFAULT 'solicitado', -- solicitado|estimado|consolidado
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_solicitud_costeo_cot ON solicitud_costeo(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_solicitud_costeo_lab ON solicitud_costeo(familia_id);

-- ------------------------------------------------------ D4 · ORDEN INTERNA ---
-- OT Internas (DCOM->LAB1->LAB2), OT Genérica Interna (LAB1->LAB2) e Inspección
-- por Muestreo: sub-órdenes con numeración propia ligada a la OT.
CREATE TABLE IF NOT EXISTS orden_interna (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  ot_id        UUID NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  tipo         VARCHAR(24) NOT NULL DEFAULT 'interna',     -- interna|generica_interna|muestreo
  numero       VARCHAR(40) NOT NULL,
  origen_lab   UUID REFERENCES cat_familia(id),
  destino_lab  UUID REFERENCES cat_familia(id),
  estado       VARCHAR(20) NOT NULL DEFAULT 'abierta',     -- abierta|recibida|cerrada
  detalle      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_orden_interna_ot ON orden_interna(ot_id);

-- Correlativo atómico para el número de Orden Interna (OI-AAAA-NNNN).
CREATE TABLE IF NOT EXISTS orden_interna_correlativo (
  tenant_id  UUID    NOT NULL REFERENCES tenant(id),
  anio       INTEGER NOT NULL,
  ultimo     INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, anio)
);

-- ----------------------------------------------- D5 · FORMATOS + DECISIÓN ----
-- Catálogo de Formatos de Impresión (SCCCC/SCCDG/…) seleccionados por
-- veredicto × organismo × destino [MAN2020].
CREATE TABLE IF NOT EXISTS formato_informe (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  codigo      VARCHAR(20)  NOT NULL,
  descripcion VARCHAR(200) NOT NULL,
  veredicto   VARCHAR(20),                 -- cumple|no_cumple|inspeccion|NULL
  organismo   VARCHAR(10),                 -- OCC|OI|NULL
  destino     VARCHAR(20),                 -- cliente|DGMN|NULL
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);

-- Siembra el catálogo real de formatos para CADA tenant (cross join con tenant).
INSERT INTO formato_informe (tenant_id, codigo, descripcion, veredicto, organismo, destino)
SELECT t.id, f.codigo, f.descripcion, f.veredicto, f.organismo, f.destino
FROM tenant t
CROSS JOIN (VALUES
  ('SCCCC','SCC Certificado de Conformidad',                'cumple',     'OCC','cliente'),
  ('SCCDG','SCC Certificado de Conformidad DGMN',           'cumple',     'OCC','DGMN'),
  ('SCCIN','SCC Informe de Incumplimiento',                 'no_cumple',  'OCC','cliente'),
  ('SCCID','SCC Informe de Incumplimiento DGMN',            'no_cumple',  'OCC','DGMN'),
  ('SCCII','SCC Informe de Inspección',                     'inspeccion', 'OI', 'cliente'),
  ('IVC01','IVC Modelo A (Informe de Verificación de Calidad)', NULL,     NULL, NULL),
  ('IVCTX','IVC Modelo T (Informe de Verificación de Calidad)', NULL,     NULL, NULL),
  ('RES01','Planilla de resultados (respaldo)',             NULL,         NULL, NULL),
  ('IBC01','Planilla respaldo I.V.C.',                      NULL,         NULL, NULL),
  ('DAL01','Informe Propuesta (comercial)',                 NULL,         NULL, NULL),
  ('i2bas','I2BAS',                                         'no_cumple',  'OI', NULL),
  ('inbas','INBAS',                                         'no_cumple',  'OI', NULL),
  ('STGO1','Tiempo Retardo (especializado)',                NULL,         NULL, NULL)
) AS f(codigo, descripcion, veredicto, organismo, destino)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Decisión + Atestación de conformidad: acto separado del "aprobar resultados",
-- responsabilidad del OCC (Sección Certificación) / OI, que elige un formato.
CREATE TABLE IF NOT EXISTS decision_conformidad (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  ot_id         UUID NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  veredicto     VARCHAR(20) NOT NULL,                 -- cumple|no_cumple|inspeccion
  organismo     VARCHAR(10) NOT NULL,                 -- OCC|OI
  destino       VARCHAR(20),                          -- cliente|DGMN
  formato_id    UUID REFERENCES formato_informe(id),
  atestado_por  VARCHAR(120),                         -- no repudio: quién atesta
  atestado_at   TIMESTAMPTZ DEFAULT now(),
  observaciones TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_decision_conf_ot ON decision_conformidad(ot_id);
