-- =============================================================================
-- align_bpch_pn_prototipos_clasificacion.sql · BPCH: Producción Nacional,
-- Prototipos y Clasificación de Sustancias · LIMS IDIC (Aiuken)
--
-- ADITIVO e IDEMPOTENTE (se puede aplicar varias veces). Va al final de
-- ORDEN_SQL.txt. Reglas y fuentes: docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md.
--
-- Los tres procesos se apoyan en el flujo general de la OT (muestras →
-- resultados → revisión → aprobación → documento → firma → entrega → cierre):
--   1. Producción Nacional: RAF DGMN del fabricante (cliente) → O/C operativa
--      anual (productos y cantidades) → programa de inspecciones → cada línea
--      del programa genera UNA OT (origen PRODUCCION_NACIONAL) → correlación con
--      la relación de ventas e informe técnico a DCO (cierre propio del camino).
--   2. Prototipos: ingreso del elemento nuevo → pronunciamiento SAC sobre el
--      tamaño de muestra (SAC-PG01-IT10) → OT (origen PROTOTIPO) → dictamen de
--      aprobación o rechazo, emitido como documento del circuito de firmas.
--   3. Clasificación de sustancias: maestro con las pruebas ONU
--      (SAC-PG01-IT21/IT22/IT23, registro SAC-PG01-FORM12), la clasificación
--      decidida (quién y cuándo), su aprobación y su documento sellado.
-- =============================================================================

-- --- 0. Correlativos propios (PROTO, CLS, ITPN) por tenant y año --------------
CREATE TABLE IF NOT EXISTS bpch_correlativo (
  tenant_id  UUID        NOT NULL REFERENCES tenant(id),
  tipo       VARCHAR(10) NOT NULL,
  anio       INTEGER     NOT NULL,
  ultimo     INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tipo, anio)
);
COMMENT ON TABLE bpch_correlativo IS
  'Correlativos de BPCH (PROTO-AAAA-NNNN, CLS-AAAA-NNNN, ITPN-AAAA-NNNN). INSERT … ON CONFLICT DO UPDATE … RETURNING: atómico.';

-- --- 1. Clasificación de sustancias (maestro) --------------------------------
CREATE TABLE IF NOT EXISTS bpch_clasificacion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID         NOT NULL REFERENCES tenant(id),
  codigo                VARCHAR(20)  NOT NULL,
  version               INTEGER      NOT NULL DEFAULT 1,
  reemplaza_id          UUID         REFERENCES bpch_clasificacion(id),
  sustancia             VARCHAR(240) NOT NULL,
  cliente_id            UUID         REFERENCES cliente(id),
  descripcion           TEXT,
  ot_id                 UUID         REFERENCES orden_trabajo(id),
  muestra_ref           VARCHAR(120),
  pruebas               JSONB        NOT NULL DEFAULT '{}'::jsonb,
  explosiva             BOOLEAN,
  clase_division        VARCHAR(10),
  grupo_compatibilidad  VARCHAR(2),
  numero_onu            VARCHAR(4),
  nombre_envio          VARCHAR(300),
  justificacion         TEXT,
  estado                VARCHAR(14)  NOT NULL DEFAULT 'borrador',
  clasificado_por       UUID,
  clasificado_at        TIMESTAMPTZ,
  aprobado_por          UUID,
  aprobado_at           TIMESTAMPTZ,
  devuelto_motivo       TEXT,
  devuelto_por          UUID,
  devuelto_at           TIMESTAMPTZ,
  anulada_motivo        TEXT,
  anulada_por           UUID,
  anulada_at            TIMESTAMPTZ,
  documento_numero      VARCHAR(30),
  documento_html        TEXT,
  documento_hash        VARCHAR(64),
  documento_codigo_verificacion VARCHAR(24),
  created_by            UUID,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_bpch_clas_estado CHECK (estado IN ('borrador', 'registrada', 'aprobada', 'reemplazada', 'anulada')),
  CONSTRAINT ck_bpch_clas_onu CHECK (numero_onu IS NULL OR numero_onu ~ '^[0-9]{4}$'),
  CONSTRAINT uq_bpch_clas_version UNIQUE (tenant_id, codigo, version)
);
CREATE INDEX IF NOT EXISTS ix_bpch_clas_tenant_estado ON bpch_clasificacion (tenant_id, estado);
CREATE INDEX IF NOT EXISTS ix_bpch_clas_cliente ON bpch_clasificacion (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_clas_ot ON bpch_clasificacion (ot_id) WHERE ot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_clas_reemplaza ON bpch_clasificacion (reemplaza_id) WHERE reemplaza_id IS NOT NULL;
COMMENT ON COLUMN bpch_clasificacion.pruebas IS
  'Lecturas de SAC-PG01-FORM12: IT21 (series 1 y 2: tubo fragmentado / placa perforada), IT22 Koenen (orificio, tipo de efecto O–H), IT23 TPT (presión máx. y tiempo 690→2.070 kPa). El servidor calcula +/− con los criterios de cada IT.';
COMMENT ON COLUMN bpch_clasificacion.explosiva IS
  'Decisión de quien clasifica (¿es explosiva? = Clase 1). Las pruebas dan un indicador; si la decisión lo contradice se exige justificación.';

-- --- 2. Producción Nacional ----------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_raf (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL REFERENCES tenant(id),
  cliente_id           UUID         NOT NULL REFERENCES cliente(id),
  numero               VARCHAR(60)  NOT NULL,
  fecha                DATE,
  tipo_linea           VARCHAR(10)  NOT NULL,
  planta               VARCHAR(200),
  vigencia_hasta       DATE,
  listado_productos    TEXT,
  res_inspeccion_linea VARCHAR(120),
  res_almacenamiento   VARCHAR(120),
  observaciones        TEXT,
  estado               VARCHAR(12)  NOT NULL DEFAULT 'vigente',
  anulada_motivo       TEXT,
  anulada_por          UUID,
  anulada_at           TIMESTAMPTZ,
  created_by           UUID,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_bpch_raf_linea CHECK (tipo_linea IN ('FIJA', 'MOVIL')),
  CONSTRAINT ck_bpch_raf_estado CHECK (estado IN ('vigente', 'anulada')),
  CONSTRAINT uq_bpch_raf_numero UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_bpch_raf_cliente ON bpch_raf (cliente_id);
COMMENT ON TABLE bpch_raf IS
  'Resolución de Autorización para Fabricar (RAF DGMN) de una línea fija o móvil, con los documentos legales que revisa SAC-PG01-IT08 en Producción Nacional.';

CREATE TABLE IF NOT EXISTS bpch_oc_operativa (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenant(id),
  raf_id          UUID        NOT NULL REFERENCES bpch_raf(id),
  cliente_id      UUID        NOT NULL REFERENCES cliente(id),
  numero          VARCHAR(60) NOT NULL,
  anio            INTEGER     NOT NULL,
  vigencia_desde  DATE        NOT NULL,
  vigencia_hasta  DATE        NOT NULL,
  con_cobro       BOOLEAN     NOT NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'vigente',
  observaciones   TEXT,
  cerrada_por     UUID,
  cerrada_at      TIMESTAMPTZ,
  anulada_motivo  TEXT,
  anulada_por     UUID,
  anulada_at      TIMESTAMPTZ,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_bpch_oc_anio CHECK (anio BETWEEN 2000 AND 2100),
  CONSTRAINT ck_bpch_oc_vigencia CHECK (vigencia_hasta >= vigencia_desde),
  CONSTRAINT ck_bpch_oc_estado CHECK (estado IN ('vigente', 'cerrada', 'anulada')),
  CONSTRAINT uq_bpch_oc_numero UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_bpch_oc_raf ON bpch_oc_operativa (raf_id);
CREATE INDEX IF NOT EXISTS ix_bpch_oc_cliente ON bpch_oc_operativa (cliente_id);
CREATE INDEX IF NOT EXISTS ix_bpch_oc_tenant_anio ON bpch_oc_operativa (tenant_id, anio);

CREATE TABLE IF NOT EXISTS bpch_oc_producto (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  oc_id               UUID          NOT NULL REFERENCES bpch_oc_operativa(id),
  producto            VARCHAR(240)  NOT NULL,
  cat_elemento_id     UUID          REFERENCES cat_elemento(id),
  clasificacion_id    UUID          REFERENCES bpch_clasificacion(id),
  unidad_medida       VARCHAR(20)   NOT NULL,
  cantidad_autorizada NUMERIC(14,3) NOT NULL,
  orden               INTEGER       NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_bpch_ocp_cantidad CHECK (cantidad_autorizada > 0)
);
CREATE INDEX IF NOT EXISTS ix_bpch_ocp_oc ON bpch_oc_producto (oc_id);
CREATE INDEX IF NOT EXISTS ix_bpch_ocp_clas ON bpch_oc_producto (clasificacion_id) WHERE clasificacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_ocp_elemento ON bpch_oc_producto (cat_elemento_id) WHERE cat_elemento_id IS NOT NULL;

-- Programa de inspecciones: una línea = una visita / lote = UNA OT.
CREATE TABLE IF NOT EXISTS bpch_pn_inspeccion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL REFERENCES tenant(id),
  oc_id            UUID          NOT NULL REFERENCES bpch_oc_operativa(id),
  oc_producto_id   UUID          NOT NULL REFERENCES bpch_oc_producto(id),
  unidad_id        UUID          NOT NULL REFERENCES unidad(id),
  mes              SMALLINT      NOT NULL,
  fecha_programada DATE,
  lugar            VARCHAR(200),
  lote             VARCHAR(120),
  cantidad         NUMERIC(14,3),
  observaciones    TEXT,
  ot_id            UUID          REFERENCES orden_trabajo(id),
  ot_generada_por  UUID,
  ot_generada_at   TIMESTAMPTZ,
  anulada          BOOLEAN       NOT NULL DEFAULT FALSE,
  anulada_motivo   TEXT,
  anulada_por      UUID,
  anulada_at       TIMESTAMPTZ,
  created_by       UUID,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_bpch_pni_mes CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT ck_bpch_pni_cantidad CHECK (cantidad IS NULL OR cantidad > 0)
);
CREATE INDEX IF NOT EXISTS ix_bpch_pni_oc ON bpch_pn_inspeccion (oc_id);
CREATE INDEX IF NOT EXISTS ix_bpch_pni_producto ON bpch_pn_inspeccion (oc_producto_id);
CREATE INDEX IF NOT EXISTS ix_bpch_pni_unidad ON bpch_pn_inspeccion (unidad_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bpch_pni_ot ON bpch_pn_inspeccion (ot_id) WHERE ot_id IS NOT NULL;

-- Cierre propio de Producción Nacional (Bizagi «Subproceso Producción Nacional»):
-- relación de ventas ↔ planillas de actividades ejecutadas → informe técnico a DCO.
CREATE TABLE IF NOT EXISTS bpch_pn_correlacion (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID        NOT NULL REFERENCES tenant(id),
  oc_id                     UUID        NOT NULL REFERENCES bpch_oc_operativa(id),
  periodo_desde             DATE        NOT NULL,
  periodo_hasta             DATE        NOT NULL,
  relacion_ventas_ref       VARCHAR(200),
  relacion_ventas_at        DATE,
  conforme                  BOOLEAN,
  observaciones             TEXT,
  requerimiento_sucursal    TEXT,
  requerimiento_sucursal_at DATE,
  respuesta_sucursal        TEXT,
  respuesta_sucursal_at     DATE,
  responde_requerimiento    BOOLEAN,
  solicitud_dgmn            TEXT,
  solicitud_dgmn_at         DATE,
  respuesta_dgmn            TEXT,
  respuesta_dgmn_at         DATE,
  propuesta_tecnica         TEXT,
  estado                    VARCHAR(12) NOT NULL DEFAULT 'borrador',
  informe_numero            VARCHAR(30),
  informe_html              TEXT,
  informe_hash              VARCHAR(64),
  informe_codigo_verificacion VARCHAR(24),
  informe_por               UUID,
  informe_at                TIMESTAMPTZ,
  remitido_dco_por          UUID,
  remitido_dco_at           TIMESTAMPTZ,
  created_by                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_bpch_corr_periodo CHECK (periodo_hasta >= periodo_desde),
  CONSTRAINT ck_bpch_corr_estado CHECK (estado IN ('borrador', 'emitido', 'remitido'))
);
CREATE INDEX IF NOT EXISTS ix_bpch_corr_oc ON bpch_pn_correlacion (oc_id);

CREATE TABLE IF NOT EXISTS bpch_pn_correlacion_linea (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlacion_id  UUID          NOT NULL REFERENCES bpch_pn_correlacion(id) ON DELETE CASCADE,
  oc_producto_id  UUID          NOT NULL REFERENCES bpch_oc_producto(id),
  cantidad_ventas NUMERIC(14,3) NOT NULL,
  CONSTRAINT ck_bpch_corrl_cantidad CHECK (cantidad_ventas >= 0),
  CONSTRAINT uq_bpch_corrl UNIQUE (correlacion_id, oc_producto_id)
);
CREATE INDEX IF NOT EXISTS ix_bpch_corrl_producto ON bpch_pn_correlacion_linea (oc_producto_id);

-- --- 3. Prototipos -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_prototipo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(20)  NOT NULL,
  cliente_id          UUID         NOT NULL REFERENCES cliente(id),
  elemento            VARCHAR(240) NOT NULL,
  descripcion_tecnica TEXT,
  ficha_tecnica       VARCHAR(200),
  hoja_seguridad      VARCHAR(200),
  solicitud_dgmn      VARCHAR(120) NOT NULL,
  fecha_solicitud     DATE,
  grupo_propuesto     VARCHAR(200),
  esquema             VARCHAR(10)  NOT NULL DEFAULT 'TIPO',
  clasificacion_id    UUID         REFERENCES bpch_clasificacion(id),
  sac_consulta_at     DATE,
  sac_referencia      VARCHAR(200),
  sac_tamano_muestra  INTEGER,
  sac_respuesta_at    DATE,
  sac_observacion     TEXT,
  unidad_id           UUID         REFERENCES unidad(id),
  ot_id               UUID         REFERENCES orden_trabajo(id),
  ot_generada_por     UUID,
  ot_generada_at      TIMESTAMPTZ,
  estado              VARCHAR(14)  NOT NULL DEFAULT 'ingresado',
  dictamen            VARCHAR(10),
  dictamen_motivo     TEXT,
  dictamen_por        UUID,
  dictamen_at         TIMESTAMPTZ,
  documento_id        UUID         REFERENCES certificado(id),
  codigo_cnc          VARCHAR(60),
  codigo_cnc_por      UUID,
  codigo_cnc_at       TIMESTAMPTZ,
  anulado_motivo      TEXT,
  anulado_por         UUID,
  anulado_at          TIMESTAMPTZ,
  created_by          UUID,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_bpch_proto_estado CHECK (estado IN ('ingresado', 'en_evaluacion', 'dictaminado', 'anulado')),
  CONSTRAINT ck_bpch_proto_dictamen CHECK (dictamen IS NULL OR dictamen IN ('aprobado', 'rechazado')),
  CONSTRAINT ck_bpch_proto_muestra CHECK (sac_tamano_muestra IS NULL OR sac_tamano_muestra > 0),
  CONSTRAINT uq_bpch_proto_codigo UNIQUE (tenant_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_bpch_proto_tenant_estado ON bpch_prototipo (tenant_id, estado);
CREATE INDEX IF NOT EXISTS ix_bpch_proto_cliente ON bpch_prototipo (cliente_id);
CREATE INDEX IF NOT EXISTS ix_bpch_proto_clas ON bpch_prototipo (clasificacion_id) WHERE clasificacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bpch_proto_documento ON bpch_prototipo (documento_id) WHERE documento_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bpch_proto_ot ON bpch_prototipo (ot_id) WHERE ot_id IS NOT NULL;

-- --- 4. Parámetros (combos editables en Parámetros del sistema) --------------
-- Origen de la OT: los dos caminos nuevos. Las listas ONU son las de las
-- Recomendaciones relativas al transporte de mercancías peligrosas (Reglamentación
-- Modelo); el IDIC puede desactivar o añadir valores sin tocar el código.
INSERT INTO parametro_sistema (id, tenant_id, categoria, codigo, etiqueta, orden, activo, valor)
SELECT gen_random_uuid(), t.id, v.categoria, v.codigo, v.etiqueta, v.orden, TRUE, NULL
FROM tenant t
CROSS JOIN (VALUES
  ('origen_trabajo', 'PRODUCCION_NACIONAL', 'Producción Nacional (RAF DGMN)',     20),
  ('origen_trabajo', 'PROTOTIPO',           'Prototipo (aprobación de tipo)',     21),
  ('clase_division_onu', '1.1', '1.1 · Riesgo de explosión en masa', 1),
  ('clase_division_onu', '1.2', '1.2 · Riesgo de proyección sin explosión en masa', 2),
  ('clase_division_onu', '1.3', '1.3 · Riesgo de incendio con pequeño riesgo de onda expansiva o de proyección', 3),
  ('clase_division_onu', '1.4', '1.4 · Sin riesgo apreciable', 4),
  ('clase_division_onu', '1.5', '1.5 · Muy insensibles con riesgo de explosión en masa', 5),
  ('clase_division_onu', '1.6', '1.6 · Extremadamente insensibles sin riesgo de explosión en masa', 6),
  ('clase_division_onu', '2.1', '2.1 · Gases inflamables', 10),
  ('clase_division_onu', '2.2', '2.2 · Gases no inflamables, no tóxicos', 11),
  ('clase_division_onu', '2.3', '2.3 · Gases tóxicos', 12),
  ('clase_division_onu', '3',   '3 · Líquidos inflamables', 13),
  ('clase_division_onu', '4.1', '4.1 · Sólidos inflamables', 14),
  ('clase_division_onu', '4.2', '4.2 · Combustión espontánea', 15),
  ('clase_division_onu', '4.3', '4.3 · Desprenden gases inflamables en contacto con agua', 16),
  ('clase_division_onu', '5.1', '5.1 · Comburentes', 17),
  ('clase_division_onu', '5.2', '5.2 · Peróxidos orgánicos', 18),
  ('clase_division_onu', '6.1', '6.1 · Tóxicas', 19),
  ('clase_division_onu', '6.2', '6.2 · Infecciosas', 20),
  ('clase_division_onu', '7',   '7 · Radiactivos', 21),
  ('clase_division_onu', '8',   '8 · Corrosivas', 22),
  ('clase_division_onu', '9',   '9 · Mercancías peligrosas varias', 23),
  ('grupo_compatibilidad_onu', 'A', 'A', 1),
  ('grupo_compatibilidad_onu', 'B', 'B', 2),
  ('grupo_compatibilidad_onu', 'C', 'C', 3),
  ('grupo_compatibilidad_onu', 'D', 'D', 4),
  ('grupo_compatibilidad_onu', 'E', 'E', 5),
  ('grupo_compatibilidad_onu', 'F', 'F', 6),
  ('grupo_compatibilidad_onu', 'G', 'G', 7),
  ('grupo_compatibilidad_onu', 'H', 'H', 8),
  ('grupo_compatibilidad_onu', 'J', 'J', 9),
  ('grupo_compatibilidad_onu', 'K', 'K', 10),
  ('grupo_compatibilidad_onu', 'L', 'L', 11),
  ('grupo_compatibilidad_onu', 'N', 'N', 12),
  ('grupo_compatibilidad_onu', 'S', 'S', 13)
) AS v(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 5. Plantillas del dictamen del prototipo ---------------------------------
-- Se emiten SOLO desde «Prototipos» (el servidor rechaza usarlas en otra OT).
-- Firma: matriz de firmas del tipo indicado al emitir (CERTIFICADO_CONFORMIDAD
-- para la aprobación de tipo, INFORME_INCUMPLIMIENTO para el rechazo).
INSERT INTO plantilla_informe (tenant_id, repid, nombre, tipo, emision, version, cuerpo_html)
SELECT t.id, v.repid, v.nombre, 'CERTIFICADO', 'conjunto', 'v1', v.cuerpo
FROM tenant t
CROSS JOIN (VALUES
  ('PROTO-APR', 'BPCH · Certificado de aprobación de tipo (prototipo)', $html$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Banco de Pruebas de Chile</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>CERTIFICADO DE APROBACIÓN DE TIPO · PROTOTIPO</h1>

<table class="meta">
  <tr><th>Empresa</th><td>{{prototipo.fabricante}}</td><th>RUT</th><td>{{prototipo.rut}}</td></tr>
  <tr><th>Prototipo</th><td>{{prototipo.codigo}}</td><th>Esquema</th><td>{{prototipo.esquema}}</td></tr>
  <tr><th>Elemento</th><td colspan="3">{{prototipo.elemento}}</td></tr>
  <tr><th>Solicitud / resolución DGMN</th><td>{{prototipo.solicitudDgmn}}</td><th>Orden de Trabajo</th><td>{{ot.codigo}}</td></tr>
  <tr><th>Organismo de inspección</th><td>{{prototipo.unidad}}</td><th>Tamaño de muestra (SAC)</th><td>{{prototipo.tamanoMuestra}}</td></tr>
  <tr><th>Clasificación</th><td>{{prototipo.clasificacionCodigo}}</td><th>Clase/División · Nº ONU</th><td>{{prototipo.claseDivision}} · {{prototipo.numeroOnu}}</td></tr>
  <tr><th>Fecha de emisión</th><td colspan="3">{{fecha}}</td></tr>
</table>

{{#si prototipo.descripcionTecnica}}
<h2>Antecedentes técnicos</h2>
<p>{{prototipo.descripcionTecnica}}</p>
{{/si}}

<h2>Resultados de los ensayos del tipo</h2>
{{tabla_ensayos}}

<h2>Dictamen</h2>
<p><b>APROBADO.</b> El prototipo cumple las pruebas de control del panel de ensayos. Se aprueba el TIPO.</p>
{{#si prototipo.dictamenMotivo}}<p>{{prototipo.dictamenMotivo}}</p>{{/si}}

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Sección Certificación de la Conformidad</div>
  <div class="firma"><span class="linea"></span>Subdirector BPCH</div>
</div>
$html$),
  ('PROTO-REC', 'BPCH · Informe de rechazo de prototipo', $html$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Banco de Pruebas de Chile</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME DE RECHAZO · PROTOTIPO</h1>

<table class="meta">
  <tr><th>Empresa</th><td>{{prototipo.fabricante}}</td><th>RUT</th><td>{{prototipo.rut}}</td></tr>
  <tr><th>Prototipo</th><td>{{prototipo.codigo}}</td><th>Esquema</th><td>{{prototipo.esquema}}</td></tr>
  <tr><th>Elemento</th><td colspan="3">{{prototipo.elemento}}</td></tr>
  <tr><th>Solicitud / resolución DGMN</th><td>{{prototipo.solicitudDgmn}}</td><th>Orden de Trabajo</th><td>{{ot.codigo}}</td></tr>
  <tr><th>Organismo de inspección</th><td>{{prototipo.unidad}}</td><th>Tamaño de muestra (SAC)</th><td>{{prototipo.tamanoMuestra}}</td></tr>
  <tr><th>Clasificación</th><td>{{prototipo.clasificacionCodigo}}</td><th>Clase/División · Nº ONU</th><td>{{prototipo.claseDivision}} · {{prototipo.numeroOnu}}</td></tr>
  <tr><th>Fecha de emisión</th><td colspan="3">{{fecha}}</td></tr>
</table>

<h2>Resultados de los ensayos del tipo</h2>
{{tabla_ensayos}}

<h2>Dictamen</h2>
<p><b>RECHAZADO.</b> {{prototipo.dictamenMotivo}}</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Sección Certificación de la Conformidad</div>
  <div class="firma"><span class="linea"></span>Subdirector BPCH</div>
</div>
$html$)
) AS v(repid, nombre, cuerpo)
ON CONFLICT (tenant_id, repid, nombre) DO NOTHING;

-- --- 6. Permisos -----------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'bpch.pn.ver',                  'bpch', 'pn_ver',
   'Ver Producción Nacional: fabricantes, RAF, O/C operativas, programa de inspecciones, correlación e informes técnicos'),
  (gen_random_uuid(), 'bpch.pn.gestionar',            'bpch', 'pn_gestionar',
   'Registrar fabricantes, RAF DGMN y O/C operativas anuales; correlación de ventas e informe técnico a DCO'),
  (gen_random_uuid(), 'bpch.pn.programar',            'bpch', 'pn_programar',
   'Programar inspecciones de Producción Nacional y generar sus OT'),
  (gen_random_uuid(), 'bpch.prototipo.ver',           'bpch', 'prototipo_ver',
   'Ver prototipos y su evaluación'),
  (gen_random_uuid(), 'bpch.prototipo.gestionar',     'bpch', 'prototipo_gestionar',
   'Registrar prototipos, el pronunciamiento SAC y generar su OT'),
  (gen_random_uuid(), 'bpch.prototipo.dictaminar',    'bpch', 'prototipo_dictaminar',
   'Dictaminar la aprobación o el rechazo de un prototipo y emitir su documento'),
  (gen_random_uuid(), 'bpch.clasificacion.ver',       'bpch', 'clasificacion_ver',
   'Ver clasificaciones de sustancias (pruebas ONU) y su documento'),
  (gen_random_uuid(), 'bpch.clasificacion.registrar', 'bpch', 'clasificacion_registrar',
   'Registrar sustancias, las pruebas ONU (IT21/IT22/IT23) y proponer su clasificación'),
  (gen_random_uuid(), 'bpch.clasificacion.aprobar',   'bpch', 'clasificacion_aprobar',
   'Aprobar, devolver o anular la clasificación de una sustancia')
ON CONFLICT (codigo) DO NOTHING;

-- Lectura: personal de BPCH (inspectores y jefaturas), Dirección y perfiles de
-- consulta. Comercial lee Producción Nacional (recibe el informe técnico, base de la tasa).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p
    ON p.codigo IN ('bpch.pn.ver', 'bpch.prototipo.ver', 'bpch.clasificacion.ver')
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'INSPECTOR', 'CALIDAD', 'LECTOR', 'PLANIFICACION')
ON CONFLICT DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.pn.ver'
 WHERE r.codigo = 'COMERCIAL'
ON CONFLICT DO NOTHING;

-- Producción Nacional: la RAF y la O/C las registran SCC y la Subdirección
-- (jefaturas de sección y departamento); el programa mensual, las sucursales.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.pn.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION')
ON CONFLICT DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.pn.programar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION', 'JEFE_LAB', 'JEFELAB')
ON CONFLICT DO NOTHING;

-- Prototipos: ingreso por SCC (jefatura e inspectores); dictamen, jefaturas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.prototipo.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION', 'INSPECTOR')
ON CONFLICT DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.prototipo.dictaminar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION')
ON CONFLICT DO NOTHING;

-- Clasificación: registran los inspectores LCA y las jefaturas; aprueban las jefaturas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.clasificacion.registrar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'INSPECTOR')
ON CONFLICT DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.clasificacion.aprobar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION', 'JEFE_LAB', 'JEFELAB')
ON CONFLICT DO NOTHING;
