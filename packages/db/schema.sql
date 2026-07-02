-- =============================================================================
-- LIMS IDIC · Schema PostgreSQL (PG 14+)
-- =============================================================================
-- Schema completo ejecutable para arrancar el desarrollo del LIMS IDIC.
-- Combina: multi-tenant + organización + taxonomía + métodos + equipos +
--          clientes + comercial + operativo + QC + revisión + certificados +
--          facturación chilena + NC + motor BPM (def + runtime) + audit log.
--
-- Decisión arquitectónica: motor BPM PROPIO (no n8n, no Camunda). Los flujos
-- viven como datos en BD; el diseñador (bpmn-js en frontend) los edita y los
-- 18 flujos del Excel maestro se cargan como plantillas iniciales.
--
-- Ejecución:  psql -d lims_idic -f schema.sql
--
-- Convenciones:
--   - UUID v4 como PK siempre, código humano-amigable adicional
--   - Audit columns: created_at, updated_at, created_by, updated_by
--   - Soft delete con deleted_at donde aplique
--   - FK ON DELETE RESTRICT en transaccionales (preservación de datos)
--   - Multi-tenant: tenant_id en transaccionales
--   - Vigencia con fechas (vigente_desde / vigente_hasta) en catálogos
--   - JSONB para campos variables por tipo
--   - Audit_log particionado por mes
--
-- Autor: Aiuken Solutions Chile · IAFIS · 2026
-- =============================================================================

\set ON_ERROR_STOP on
SET client_min_messages TO WARNING;

-- =============================================================================
-- EXTENSIONES Y CONFIGURACIÓN INICIAL
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";          -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";            -- email case-insensitive
CREATE EXTENSION IF NOT EXISTS "pg_trgm";           -- búsqueda fuzzy
CREATE EXTENSION IF NOT EXISTS "btree_gin";         -- índices GIN sobre JSONB
CREATE EXTENSION IF NOT EXISTS "unaccent";          -- búsqueda sin acentos

-- Esquemas lógicos para organizar (opcional, todo va en public por simplicidad inicial)
-- CREATE SCHEMA IF NOT EXISTS lims;

-- =============================================================================
-- FUNCIONES AUXILIARES
-- =============================================================================

-- Trigger genérico para mantener updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Validar RUT chileno con dígito verificador (módulo 11)
CREATE OR REPLACE FUNCTION valida_rut(rut TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  cleaned TEXT;
  numbers TEXT;
  dv      TEXT;
  s       INT := 0;
  m       INT := 2;
  i       INT;
  expected_dv TEXT;
BEGIN
  cleaned := upper(regexp_replace(rut, '[^0-9K]', '', 'g'));
  IF length(cleaned) < 2 THEN RETURN FALSE; END IF;
  numbers := substring(cleaned FROM 1 FOR length(cleaned) - 1);
  dv      := substring(cleaned FROM length(cleaned));
  FOR i IN REVERSE length(numbers)..1 LOOP
    s := s + (substring(numbers FROM i FOR 1)::INT) * m;
    m := m + 1; IF m > 7 THEN m := 2; END IF;
  END LOOP;
  expected_dv := CASE (11 - (s % 11))
                   WHEN 11 THEN '0'
                   WHEN 10 THEN 'K'
                   ELSE (11 - (s % 11))::TEXT
                 END;
  RETURN dv = expected_dv;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- MULTI-TENANT
-- =============================================================================
-- Aunque IDIC sea el primer cliente, modelamos multi-tenant desde día 1.
-- Cuesta poco ahora; vale oro cuando Aiuken venda a otros laboratorios.

CREATE TABLE tenant (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          VARCHAR(40) UNIQUE NOT NULL,             -- 'IDIC', 'BPCH', etc.
  nombre          VARCHAR(200) NOT NULL,
  rut             VARCHAR(20),
  zona_horaria    VARCHAR(40) DEFAULT 'America/Santiago',
  moneda          VARCHAR(3)  DEFAULT 'CLP',
  iva_pct         NUMERIC(5,2) DEFAULT 19.00,
  config          JSONB DEFAULT '{}',
  activo          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- USUARIOS · ROLES · PERMISOS (RBAC)
-- =============================================================================

CREATE TABLE usuario (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  username            CITEXT NOT NULL,
  email               CITEXT,
  nombre_completo     VARCHAR(200) NOT NULL,
  password_hash       VARCHAR(255),                          -- argon2id
  totp_secret         VARCHAR(120),                          -- 2FA TOTP
  totp_activo         BOOLEAN DEFAULT FALSE,
  estado              VARCHAR(20) DEFAULT 'activo',          -- activo, suspendido, bloqueado, baja
  ultimo_login_at     TIMESTAMPTZ,
  ultimo_login_ip     INET,
  intentos_fallidos   INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  created_by          UUID,
  updated_by          UUID,
  deleted_at          TIMESTAMPTZ,
  UNIQUE(tenant_id, username),
  UNIQUE(tenant_id, email)
);
CREATE INDEX idx_usuario_tenant_estado ON usuario(tenant_id, estado) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_usuario_updated BEFORE UPDATE ON usuario FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE rol (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  codigo          VARCHAR(40) NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  descripcion     TEXT,
  es_sistema      BOOLEAN DEFAULT FALSE,                     -- TRUE para roles base
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE permiso (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          VARCHAR(80) UNIQUE NOT NULL,               -- 'muestra.crear', 'resultado.aprobar'
  modulo          VARCHAR(40) NOT NULL,                      -- 'muestra', 'resultado', etc.
  accion          VARCHAR(40) NOT NULL,                      -- 'crear', 'editar', 'aprobar'
  descripcion     TEXT
);

CREATE TABLE rol_permiso (
  rol_id          UUID REFERENCES rol(id) ON DELETE CASCADE,
  permiso_id      UUID REFERENCES permiso(id) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuario_rol (
  usuario_id      UUID REFERENCES usuario(id) ON DELETE CASCADE,
  rol_id          UUID REFERENCES rol(id) ON DELETE CASCADE,
  unidad_id       UUID,                                      -- rol acotado a una unidad (NULL = global)
  vigente_desde   TIMESTAMPTZ DEFAULT now(),
  vigente_hasta   TIMESTAMPTZ,                               -- delegación temporal (vacaciones)
  asignado_por    UUID REFERENCES usuario(id),
  PRIMARY KEY (usuario_id, rol_id, unidad_id)
);

-- =============================================================================
-- ORGANIZACIÓN (3 niveles fijos: Sede → Unidad → Sección)
-- =============================================================================

CREATE TABLE sede (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  codigo          VARCHAR(20) NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  direccion       TEXT,
  ciudad          VARCHAR(80),
  region          VARCHAR(80),
  pais            VARCHAR(40) DEFAULT 'Chile',
  activa          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE unidad (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  sede_id         UUID NOT NULL REFERENCES sede(id),
  codigo          VARCHAR(20) NOT NULL,                      -- 'LCC', 'LTX', 'BPCH', 'LQA', 'SEO', 'SVM', ...
  nombre          VARCHAR(200) NOT NULL,
  descripcion     TEXT,
  jefe_usuario_id UUID REFERENCES usuario(id),
  activa          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE seccion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_id       UUID NOT NULL REFERENCES unidad(id),
  codigo          VARCHAR(20) NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  activa          BOOLEAN DEFAULT TRUE,
  UNIQUE(unidad_id, codigo)
);

ALTER TABLE usuario_rol ADD CONSTRAINT fk_usuariorol_unidad
  FOREIGN KEY (unidad_id) REFERENCES unidad(id) ON DELETE SET NULL;

-- =============================================================================
-- TAXONOMÍA DE TIPOS DE MUESTRA (adjacency list + path materializado)
-- =============================================================================
-- Diseño: adjacency list portable, path materializado vía trigger.
-- Permite queries rápidos sin requerir ltree (universal y ORM-friendly).

CREATE TABLE tipo_muestra (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  parent_id       UUID REFERENCES tipo_muestra(id) ON DELETE RESTRICT,
  codigo          VARCHAR(60) NOT NULL,
  nombre          VARCHAR(200) NOT NULL,
  path            TEXT NOT NULL,                             -- 'materiales/inorganico/metales/aceros'
  nivel           INT  NOT NULL,
  schema_atributos JSONB DEFAULT '{"campos":[]}',            -- atributos esperados al crear muestra
  vigente         BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_tipo_muestra_path   ON tipo_muestra (path text_pattern_ops);
CREATE INDEX idx_tipo_muestra_parent ON tipo_muestra (parent_id);
CREATE INDEX idx_tipo_muestra_atrib  ON tipo_muestra USING GIN (schema_atributos);
CREATE TRIGGER trg_tipo_muestra_updated BEFORE UPDATE ON tipo_muestra FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trigger que mantiene path materializado automáticamente
CREATE OR REPLACE FUNCTION compute_tipo_muestra_path()
RETURNS TRIGGER AS $$
DECLARE
  parent_path TEXT;
  parent_nivel INT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := NEW.codigo;
    NEW.nivel := 0;
  ELSE
    SELECT path, nivel INTO parent_path, parent_nivel
    FROM tipo_muestra WHERE id = NEW.parent_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'parent_id no existe';
    END IF;
    NEW.path := parent_path || '/' || NEW.codigo;
    NEW.nivel := parent_nivel + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tipo_muestra_path
  BEFORE INSERT OR UPDATE OF parent_id, codigo ON tipo_muestra
  FOR EACH ROW EXECUTE FUNCTION compute_tipo_muestra_path();

-- =============================================================================
-- TAGS ORTOGONALES (clasificación multi-criterio sobre cualquier entidad)
-- =============================================================================

CREATE TABLE tag (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  codigo          VARCHAR(60) NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  categoria       VARCHAR(40),                               -- 'aplicacion', 'normativa', 'criticidad'
  color           VARCHAR(7),
  activo          BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE tag_asignacion (
  tag_id          UUID REFERENCES tag(id) ON DELETE CASCADE,
  entidad_tipo    VARCHAR(40) NOT NULL,                      -- 'tipo_muestra', 'metodo', 'cliente', 'muestra'
  entidad_id      UUID NOT NULL,
  asignado_at     TIMESTAMPTZ DEFAULT now(),
  asignado_por    UUID REFERENCES usuario(id),
  PRIMARY KEY (tag_id, entidad_tipo, entidad_id)
);
CREATE INDEX idx_tag_asig_entidad ON tag_asignacion(entidad_tipo, entidad_id);

-- =============================================================================
-- NORMAS Y MÉTODOS
-- =============================================================================
-- Las normas son el catálogo de referencia (NCh, ISO, ASTM, AOAC, IUC, ...).
-- Los métodos son la implementación de IDIC con su versión propia.

CREATE TABLE norma (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          VARCHAR(80) NOT NULL,                      -- 'NCh 624', 'ASTM D5185', 'AOAC 979.08'
  nombre          VARCHAR(300) NOT NULL,
  organismo       VARCHAR(60),                               -- INN, ASTM, ISO, AOAC
  ano             INT,
  url             TEXT,
  vigente         BOOLEAN DEFAULT TRUE,
  UNIQUE(codigo)
);

CREATE TABLE metodo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(60) NOT NULL,                  -- 'MET-QUI-0014', 'LCC-PG01-P01-IT02'
  nombre              VARCHAR(300) NOT NULL,
  unidad_responsable  UUID NOT NULL REFERENCES unidad(id),
  tecnica             VARCHAR(60),                           -- HPLC, AAS, Rockwell, microbiológico
  familia             VARCHAR(80),                           -- 'Ensayo físico/Cuero', 'Bromatológico'
  tipo                VARCHAR(20),                           -- cuantitativo, cualitativo, semicuantitativo
  objetivo            TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);

-- Versionado: cada cambio del método = nueva versión inmutable
-- Sigue la ficha 9-bloque entregada por IDIC (LCC-PG01-P01-IT02)
CREATE TABLE metodo_version (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metodo_id           UUID NOT NULL REFERENCES metodo(id),
  version             VARCHAR(10) NOT NULL,                  -- 'v1.0', 'v2.1'
  -- BLOQUE 1: IDENTIFICACIÓN ya está en metodo (codigo, nombre, etc.)
  norma_id            UUID REFERENCES norma(id),
  sop_documento       VARCHAR(120),                          -- 'LCC-PG01-P01-IT02-FORM01'
  responsable_id      UUID REFERENCES usuario(id),
  -- BLOQUE 3: PARÁMETROS DEL ENSAYO (ver analito)
  -- BLOQUE 4: FRECUENCIAS Y REPETICIONES
  repeticiones_default  INT,
  frecuencias_default   INT,
  ensayo_por_parejas    BOOLEAN DEFAULT FALSE,
  descripcion_frecuencia TEXT,
  -- BLOQUE 5: CONTROL DE CALIDAD INTERNO
  qc_tipo             VARCHAR(60),                           -- 'Repetición/Verificación', 'Westgard', etc.
  qc_frecuencia       VARCHAR(120),
  qc_criterios        TEXT,
  qc_accion_falla     TEXT,
  qc_bloquea          BOOLEAN DEFAULT FALSE,
  -- BLOQUE 7: FLUJO DEL PROCESO (referenciar a flujo_def vía flujo_codigo opcional)
  flujo_codigo        VARCHAR(40),                           -- ej 'F08' del Excel maestro
  -- BLOQUE 8: INFORME Y CERTIFICADO
  tipo_documento_emitido VARCHAR(120),                       -- 'Informe de ensayos / IVC'
  destinatarios       TEXT,
  requiere_firma_digital BOOLEAN DEFAULT TRUE,
  requiere_hash       BOOLEAN DEFAULT TRUE,
  -- BLOQUE 9: OBSERVACIONES Y REQUERIMIENTOS ESPECIALES
  observaciones_especiales TEXT,
  -- LOD, LOQ, incertidumbre, rango (alcance)
  matriz_aplicable    TEXT,
  unidad_principal    VARCHAR(20),
  lod                 NUMERIC,
  loq                 NUMERIC,
  rango_min           NUMERIC,
  rango_max           NUMERIC,
  incertidumbre_k2    NUMERIC,
  -- Fórmula y configuración avanzada
  formula_dsl         TEXT,                                  -- DSL propio para cálculo
  config              JSONB DEFAULT '{}',
  -- Ciclo de vida y versionado
  estado              VARCHAR(20) NOT NULL DEFAULT 'borrador', -- borrador, en_revision, vigente, obsoleto
  vigente_desde       DATE,
  vigente_hasta       DATE,
  reemplaza_a         UUID REFERENCES metodo_version(id),
  aprobado_por        UUID REFERENCES usuario(id),
  aprobado_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(metodo_id, version)
);
CREATE INDEX idx_metodo_version_estado ON metodo_version(metodo_id, estado);
CREATE INDEX idx_metodo_version_vigencia ON metodo_version(vigente_desde, vigente_hasta);
CREATE TRIGGER trg_metodo_version_updated BEFORE UPDATE ON metodo_version FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- BLOQUE 3: PARÁMETROS / ANALITOS DEL ENSAYO
CREATE TABLE analito (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metodo_version_id   UUID NOT NULL REFERENCES metodo_version(id) ON DELETE CASCADE,
  numero              INT NOT NULL,
  nombre              VARCHAR(200) NOT NULL,
  unidad              VARCHAR(20),
  rango_min           NUMERIC,
  rango_nominal       NUMERIC,
  rango_max           NUMERIC,
  formula_calculo     TEXT,                                  -- 'Kgf/mm²', 'A=espesor*ancho'
  ingreso             VARCHAR(20),                           -- 'Manual', 'Auto', 'Calc'
  auto_calc           BOOLEAN DEFAULT FALSE,
  UNIQUE(metodo_version_id, numero)
);

-- BLOQUE 2: MUESTRAS / ELEMENTOS APLICABLES
-- Métodos × tipos de muestra (matriz N:M)
CREATE TABLE metodo_aplicable_a (
  metodo_version_id   UUID REFERENCES metodo_version(id) ON DELETE CASCADE,
  tipo_muestra_id     UUID REFERENCES tipo_muestra(id) ON DELETE RESTRICT,
  observaciones       TEXT,
  PRIMARY KEY (metodo_version_id, tipo_muestra_id)
);
CREATE INDEX idx_metodo_aplic_tipo ON metodo_aplicable_a(tipo_muestra_id);

-- =============================================================================
-- ESPECIFICACIONES POR CLIENTE (límites paramétricos)
-- =============================================================================
-- Para casos en que un cliente tiene rangos distintos al estándar del método.
-- Ejemplo: BPCH y Codelco usan el mismo método pero con rangos distintos.

CREATE TABLE norma_limite (
  norma_id        UUID REFERENCES norma(id),
  analito_id      UUID REFERENCES analito(id),
  rango_min       NUMERIC,
  rango_max       NUMERIC,
  unidad          VARCHAR(20),
  PRIMARY KEY (norma_id, analito_id)
);

CREATE TABLE cliente_override_limite (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL,                             -- FK definida abajo
  analito_id      UUID REFERENCES analito(id),
  rango_min       NUMERIC,
  rango_max       NUMERIC,
  unidad          VARCHAR(20),
  motivo          TEXT,
  vigente_desde   DATE NOT NULL,
  vigente_hasta   DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- EQUIPOS Y CONSUMIBLES
-- =============================================================================

CREATE TABLE equipo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,                  -- 'EQ-HPLC-001'
  descripcion         VARCHAR(300) NOT NULL,
  fabricante          VARCHAR(120),
  modelo              VARCHAR(120),
  serie               VARCHAR(120),
  ubicacion_id        UUID,                                  -- FK a ubicacion abajo
  unidad_id           UUID REFERENCES unidad(id),
  estado              VARCHAR(30) NOT NULL DEFAULT 'operativo', -- operativo, calibracion, mantenimiento, fuera_servicio, baja
  fecha_adquisicion   DATE,
  fecha_instalacion   DATE,
  proxima_calibracion DATE,
  proxima_mantencion  DATE,
  vida_util_anos      INT,
  responsable_id      UUID REFERENCES usuario(id),
  config              JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_equipo_estado ON equipo(tenant_id, estado);
CREATE INDEX idx_equipo_calibracion_vence ON equipo(proxima_calibracion);
CREATE TRIGGER trg_equipo_updated BEFORE UPDATE ON equipo FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE calibracion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipo_id           UUID NOT NULL REFERENCES equipo(id),
  fecha               DATE NOT NULL,
  ejecutada_por       VARCHAR(200),                          -- proveedor externo o usuario interno
  norma_calibracion   VARCHAR(120),
  certificado_doc_id  UUID,                                  -- FK a documento
  resultado           VARCHAR(30),                           -- conforme, no_conforme, conforme_con_obs
  observaciones       TEXT,
  proxima_fecha       DATE,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_calibracion_equipo_fecha ON calibracion(equipo_id, fecha DESC);

CREATE TABLE mantencion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipo_id           UUID NOT NULL REFERENCES equipo(id),
  tipo                VARCHAR(30),                           -- preventiva, correctiva, verificacion
  fecha               DATE NOT NULL,
  ejecutada_por       VARCHAR(200),
  descripcion         TEXT,
  costo               NUMERIC(14,2),
  observaciones       TEXT,
  proxima_fecha       DATE,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE consumible (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,
  nombre              VARCHAR(200) NOT NULL,
  tipo                VARCHAR(40),                           -- reactivo, columna, estándar, vial
  unidad_medida       VARCHAR(20),                           -- g, mL, unidad
  proveedor_id        UUID,                                  -- FK a proveedor abajo
  stock_minimo        NUMERIC,
  activo              BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE lote_consumible (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumible_id       UUID NOT NULL REFERENCES consumible(id),
  numero_lote         VARCHAR(80) NOT NULL,
  fecha_recepcion     DATE,
  fecha_vencimiento   DATE,
  cantidad_inicial    NUMERIC,
  cantidad_actual     NUMERIC,
  ubicacion_id        UUID,
  estado              VARCHAR(30) DEFAULT 'disponible',      -- disponible, cuarentena, agotado, vencido
  UNIQUE(consumible_id, numero_lote)
);
CREATE INDEX idx_lote_vencimiento ON lote_consumible(fecha_vencimiento) WHERE estado = 'disponible';

-- =============================================================================
-- UBICACIONES FÍSICAS (sala → gabinete → estante → caja → posición)
-- =============================================================================

CREATE TABLE ubicacion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  parent_id       UUID REFERENCES ubicacion(id) ON DELETE RESTRICT,
  codigo          VARCHAR(60) NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  tipo            VARCHAR(30),                               -- sala, gabinete, estante, caja, posicion
  path            TEXT NOT NULL,
  unidad_id       UUID REFERENCES unidad(id),
  temp_min        NUMERIC,                                   -- rango aceptable temperatura
  temp_max        NUMERIC,
  humedad_min     NUMERIC,
  humedad_max     NUMERIC,
  capacidad       INT,
  ocupacion       INT DEFAULT 0,
  activa          BOOLEAN DEFAULT TRUE
);
CREATE INDEX idx_ubicacion_path ON ubicacion(path text_pattern_ops);

ALTER TABLE equipo ADD CONSTRAINT fk_equipo_ubicacion FOREIGN KEY (ubicacion_id) REFERENCES ubicacion(id);
ALTER TABLE lote_consumible ADD CONSTRAINT fk_lote_ubicacion FOREIGN KEY (ubicacion_id) REFERENCES ubicacion(id);

-- =============================================================================
-- PROVEEDORES Y CLIENTES (chilenos)
-- =============================================================================

CREATE TABLE proveedor (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(20) NOT NULL,
  razon_social        VARCHAR(200) NOT NULL,
  rut                 VARCHAR(20),
  direccion           TEXT,
  telefono            VARCHAR(40),
  email               CITEXT,
  activo              BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, codigo)
);
ALTER TABLE consumible ADD CONSTRAINT fk_consumible_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedor(id);

CREATE TABLE cliente (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(20),                           -- código humano interno (opcional)
  rut                 VARCHAR(20) NOT NULL CHECK (valida_rut(rut)),
  razon_social        VARCHAR(200) NOT NULL,
  nombre_fantasia     VARCHAR(200),
  giro                VARCHAR(200),
  tipo                VARCHAR(30),                           -- institucional, externo, gubernamental, laboratorio_asociado
  direccion           TEXT,
  ciudad              VARCHAR(80),
  region              VARCHAR(80),
  telefono            VARCHAR(40),
  email               CITEXT,
  fecha_registro      DATE DEFAULT CURRENT_DATE,
  dias_credito        INT DEFAULT 30,
  bloqueado           BOOLEAN DEFAULT FALSE,
  motivo_bloqueo      TEXT,
  saldo_actual        NUMERIC(14,2) DEFAULT 0,               -- denormalizado para queries rápidas
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  created_by          UUID REFERENCES usuario(id),
  deleted_at          TIMESTAMPTZ,
  UNIQUE(tenant_id, rut)
);
CREATE INDEX idx_cliente_razon ON cliente USING GIN (razon_social gin_trgm_ops);
CREATE INDEX idx_cliente_tipo  ON cliente(tenant_id, tipo) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_cliente_updated BEFORE UPDATE ON cliente FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE cliente_override_limite ADD CONSTRAINT fk_clienteoverride_cliente FOREIGN KEY (cliente_id) REFERENCES cliente(id);

CREATE TABLE planta (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  codigo          VARCHAR(20) NOT NULL,
  nombre          VARCHAR(200) NOT NULL,
  direccion       TEXT,
  ciudad          VARCHAR(80),
  region          VARCHAR(80),
  telefono        VARCHAR(40),
  activa          BOOLEAN DEFAULT TRUE,
  UNIQUE(cliente_id, codigo)
);

CREATE TABLE contacto (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  planta_id       UUID REFERENCES planta(id) ON DELETE CASCADE,
  nombre          VARCHAR(200) NOT NULL,
  cargo           VARCHAR(120),
  email           CITEXT,
  telefono        VARCHAR(40),
  es_principal    BOOLEAN DEFAULT FALSE,
  activo          BOOLEAN DEFAULT TRUE
);

-- =============================================================================
-- LISTAS DE PRECIOS
-- =============================================================================

CREATE TABLE lista_precio (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  codigo          VARCHAR(40) NOT NULL,                      -- 'INST_1', 'EXT_PUBLICA'
  nombre          VARCHAR(200) NOT NULL,
  moneda          VARCHAR(3) DEFAULT 'CLP',
  descuento_default NUMERIC(5,2) DEFAULT 0,
  vigente_desde   DATE NOT NULL,
  vigente_hasta   DATE,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE lista_precio_item (
  lista_id        UUID REFERENCES lista_precio(id) ON DELETE CASCADE,
  metodo_id       UUID REFERENCES metodo(id),
  precio          NUMERIC(14,2) NOT NULL,
  PRIMARY KEY (lista_id, metodo_id)
);

ALTER TABLE cliente ADD COLUMN lista_precio_id UUID REFERENCES lista_precio(id);

-- =============================================================================
-- COMERCIAL: Solicitud → Cotización → Líneas
-- =============================================================================

CREATE TABLE solicitud (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                  -- 'SOL-2026-0341'
  cliente_id          UUID NOT NULL REFERENCES cliente(id),
  planta_id           UUID REFERENCES planta(id),
  contacto_id         UUID REFERENCES contacto(id),
  canal               VARCHAR(30),                           -- email, telefono, portal, oficio
  origen_trabajo      VARCHAR(120),
  prioridad           VARCHAR(20) DEFAULT 'normal',          -- normal, alta, urgente
  estado              VARCHAR(20) NOT NULL DEFAULT 'borrador', -- borrador, enviada, en_cotizacion, cotizada, aceptada, rechazada, expirada
  descripcion         TEXT,
  plazo_solicitado    DATE,
  fecha_envio         DATE,
  fecha_respuesta     DATE,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  created_by          UUID REFERENCES usuario(id),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_solicitud_cliente ON solicitud(cliente_id);
CREATE INDEX idx_solicitud_estado  ON solicitud(tenant_id, estado);
CREATE TRIGGER trg_solicitud_updated BEFORE UPDATE ON solicitud FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cotizacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                  -- 'COT-2026-0901'
  solicitud_id        UUID REFERENCES solicitud(id),
  cliente_id          UUID NOT NULL REFERENCES cliente(id),
  planta_id           UUID REFERENCES planta(id),
  lista_precio_id     UUID REFERENCES lista_precio(id),
  fecha_emision       DATE NOT NULL DEFAULT CURRENT_DATE,
  validez_dias        INT DEFAULT 30,
  expira_at           DATE,
  estado              VARCHAR(20) NOT NULL DEFAULT 'borrador', -- borrador, enviada, aceptada, rechazada, expirada
  -- Totales (denormalizados)
  subtotal            NUMERIC(14,2) DEFAULT 0,
  descuento_pct       NUMERIC(5,2) DEFAULT 0,
  descuento_monto     NUMERIC(14,2) DEFAULT 0,
  gastos_admin_pct    NUMERIC(5,2) DEFAULT 0,
  gastos_admin_monto  NUMERIC(14,2) DEFAULT 0,
  neto                NUMERIC(14,2) DEFAULT 0,
  iva_pct             NUMERIC(5,2) DEFAULT 19,
  iva_monto           NUMERIC(14,2) DEFAULT 0,
  total               NUMERIC(14,2) DEFAULT 0,
  -- Vínculo a OT (cuando se acepta)
  ot_id               UUID,                                  -- FK definida abajo
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  created_by          UUID REFERENCES usuario(id),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_cotizacion_cliente_estado ON cotizacion(cliente_id, estado);
CREATE TRIGGER trg_cotizacion_updated BEFORE UPDATE ON cotizacion FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE linea_cotizacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id       UUID NOT NULL REFERENCES cotizacion(id) ON DELETE CASCADE,
  metodo_id           UUID REFERENCES metodo(id),
  descripcion         TEXT,
  cantidad            INT NOT NULL DEFAULT 1,
  precio_unitario     NUMERIC(14,2) NOT NULL,
  descuento_pct       NUMERIC(5,2) DEFAULT 0,
  subtotal            NUMERIC(14,2) NOT NULL,
  orden               INT
);

-- =============================================================================
-- OPERATIVO: Orden de Trabajo · Muestra · Alícuota · Cadena de Custodia
-- =============================================================================
-- NOTA: la OT existe como entidad propia pero su "estado" se obtiene del motor BPM
-- (flujo_instancia). Esto permite que IDIC personalice los flujos sin alterar el modelo.

CREATE TABLE orden_trabajo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                  -- 'OT-2026-0721'
  cotizacion_id       UUID REFERENCES cotizacion(id),
  cliente_id          UUID NOT NULL REFERENCES cliente(id),
  planta_id           UUID REFERENCES planta(id),
  unidad_principal    UUID REFERENCES unidad(id),
  flujo_instancia_id  UUID,                                  -- FK al motor BPM (definida abajo)
  -- Campos operativos
  prioridad           VARCHAR(20) DEFAULT 'normal',
  fecha_recepcion     TIMESTAMPTZ,
  fecha_compromiso    DATE,
  fecha_cierre        TIMESTAMPTZ,
  solicitante         VARCHAR(200),
  numero_ley          VARCHAR(40),
  origen_trabajo      VARCHAR(120),
  -- Estado denormalizado (vive en flujo_instancia, copiado para queries rápidas)
  estado              VARCHAR(40) NOT NULL DEFAULT 'recepcionada',
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  created_by          UUID REFERENCES usuario(id),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_ot_cliente_estado ON orden_trabajo(cliente_id, estado);
CREATE INDEX idx_ot_unidad_estado  ON orden_trabajo(unidad_principal, estado);
CREATE INDEX idx_ot_compromiso     ON orden_trabajo(fecha_compromiso) WHERE estado NOT IN ('cerrada', 'cancelada');
CREATE TRIGGER trg_ot_updated BEFORE UPDATE ON orden_trabajo FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE cotizacion ADD CONSTRAINT fk_cot_ot FOREIGN KEY (ot_id) REFERENCES orden_trabajo(id);

CREATE TABLE muestra (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  codigo              VARCHAR(30) NOT NULL,                  -- 'M-2026-12881'
  tipo_muestra_id     UUID REFERENCES tipo_muestra(id),
  parent_muestra_id   UUID REFERENCES muestra(id),           -- contramuestra o sub-muestra
  fabricante          VARCHAR(120),
  numero_lote         VARCHAR(80),
  fecha_muestreo      TIMESTAMPTZ,
  recepcionada_at     TIMESTAMPTZ,
  recepcionada_por    UUID REFERENCES usuario(id),
  ubicacion_id        UUID REFERENCES ubicacion(id),
  sello_numero        VARCHAR(40),
  sello_integro       BOOLEAN,
  foto_recepcion_id   UUID,                                  -- FK a documento
  atributos_extra     JSONB DEFAULT '{}',                    -- atributos variables según tipo
  estado              VARCHAR(30) NOT NULL DEFAULT 'pendiente', -- pendiente, recibida, almacenada, en_preparacion, en_analisis, analizada, testigo, descartada
  fecha_descarte      DATE,
  motivo_descarte     TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_muestra_ot       ON muestra(ot_id);
CREATE INDEX idx_muestra_estado   ON muestra(tenant_id, estado);
CREATE INDEX idx_muestra_ubicacion ON muestra(ubicacion_id);
CREATE INDEX idx_muestra_atributos ON muestra USING GIN (atributos_extra);
CREATE TRIGGER trg_muestra_updated BEFORE UPDATE ON muestra FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE alicuota (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muestra_id          UUID NOT NULL REFERENCES muestra(id),
  codigo              VARCHAR(40) NOT NULL,                  -- 'M-2026-12881-A1'
  cantidad            NUMERIC,
  unidad              VARCHAR(20),
  ubicacion_id        UUID REFERENCES ubicacion(id),
  estado              VARCHAR(30) DEFAULT 'disponible',      -- disponible, en_uso, consumida
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cadena_custodia (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muestra_id          UUID NOT NULL REFERENCES muestra(id),
  evento              VARCHAR(40) NOT NULL,                  -- recepcion, traslado, preparacion, analisis, almacenamiento, transferencia, devolucion, destruccion
  fecha               TIMESTAMPTZ NOT NULL DEFAULT now(),
  desde_usuario_id    UUID REFERENCES usuario(id),
  hacia_usuario_id    UUID REFERENCES usuario(id),
  ubicacion_origen_id UUID REFERENCES ubicacion(id),
  ubicacion_destino_id UUID REFERENCES ubicacion(id),
  motivo              TEXT,
  sello_numero        VARCHAR(40),
  sello_integro       BOOLEAN,
  foto_doc_id         UUID,
  firma_electronica_id UUID,                                 -- FK abajo
  temp_celsius        NUMERIC(5,2),
  humedad_pct         NUMERIC(5,2),
  observaciones       TEXT
);
CREATE INDEX idx_custodia_muestra ON cadena_custodia(muestra_id, fecha);

-- =============================================================================
-- ANÁLISIS · CORRIDA · RESULTADO
-- =============================================================================

CREATE TABLE analisis_programado (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ot_id                   UUID NOT NULL REFERENCES orden_trabajo(id),
  muestra_id              UUID NOT NULL REFERENCES muestra(id),
  metodo_version_id       UUID NOT NULL REFERENCES metodo_version(id),
  analista_asignado_id    UUID REFERENCES usuario(id),
  unidad_id               UUID REFERENCES unidad(id),
  estado                  VARCHAR(30) DEFAULT 'programado',  -- programado, en_curso, completado, observado, anulado
  fecha_programada        DATE,
  fecha_inicio            TIMESTAMPTZ,
  fecha_fin               TIMESTAMPTZ,
  prioridad               VARCHAR(20) DEFAULT 'normal',
  bloqueado               BOOLEAN DEFAULT FALSE,
  motivo_bloqueo          TEXT,
  created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_analisis_ot ON analisis_programado(ot_id);
CREATE INDEX idx_analisis_analista_estado ON analisis_programado(analista_asignado_id, estado);

CREATE TABLE corrida (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,                  -- 'R-2026-1183'
  metodo_version_id   UUID NOT NULL REFERENCES metodo_version(id),
  equipo_id           UUID REFERENCES equipo(id),
  analista_id         UUID REFERENCES usuario(id),
  fecha_inicio        TIMESTAMPTZ DEFAULT now(),
  fecha_fin           TIMESTAMPTZ,
  estado              VARCHAR(20) DEFAULT 'en_curso',        -- en_curso, completada, anulada
  qc_aprobado         BOOLEAN,
  temp_celsius        NUMERIC(5,2),
  humedad_pct         NUMERIC(5,2),
  notas               TEXT,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE corrida_consumible (
  corrida_id          UUID REFERENCES corrida(id) ON DELETE CASCADE,
  lote_consumible_id  UUID REFERENCES lote_consumible(id),
  cantidad_usada      NUMERIC,
  PRIMARY KEY (corrida_id, lote_consumible_id)
);

CREATE TABLE resultado (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  analisis_programado_id  UUID NOT NULL REFERENCES analisis_programado(id),
  corrida_id              UUID REFERENCES corrida(id),
  analito_id              UUID REFERENCES analito(id),
  valor_numerico          NUMERIC,
  valor_texto             VARCHAR(120),
  unidad                  VARCHAR(20),
  resultado_final         NUMERIC,                           -- valor calculado por fórmula
  fuera_de_rango          BOOLEAN DEFAULT FALSE,
  observado               BOOLEAN DEFAULT FALSE,
  lecturas_raw            JSONB,                             -- todas las lecturas crudas
  estado                  VARCHAR(20) DEFAULT 'capturado',   -- capturado, revisado_n1, aprobado, rechazado, devuelto
  capturado_por           UUID REFERENCES usuario(id),
  capturado_at            TIMESTAMPTZ DEFAULT now(),
  revisado_n1_por         UUID REFERENCES usuario(id),
  revisado_n1_at          TIMESTAMPTZ,
  aprobado_por            UUID REFERENCES usuario(id),
  aprobado_at             TIMESTAMPTZ,
  notas                   TEXT
);
CREATE INDEX idx_resultado_estado ON resultado(estado, capturado_at);
CREATE INDEX idx_resultado_analisis ON resultado(analisis_programado_id);

-- =============================================================================
-- CONTROL DE CALIDAD (QC)
-- =============================================================================

CREATE TABLE qc_corrida (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corrida_id          UUID NOT NULL REFERENCES corrida(id),
  tipo                VARCHAR(30) NOT NULL,                  -- blanco, duplicado, estandar, curva_calibracion
  valor_esperado      NUMERIC,
  valor_obtenido      NUMERIC,
  unidad              VARCHAR(20),
  desviacion_pct      NUMERIC(8,4),
  z_score             NUMERIC(8,4),
  cv_pct              NUMERIC(8,4),                          -- %CV para duplicados
  r_cuadrado          NUMERIC(8,6),                          -- R² para curvas
  dentro_limite       BOOLEAN,
  observaciones       TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_qc_corrida ON qc_corrida(corrida_id);

-- =============================================================================
-- REVISIÓN · FIRMA ELECTRÓNICA · CERTIFICADOS · INFORMES
-- =============================================================================

CREATE TABLE firma_electronica (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  firmante_id         UUID NOT NULL REFERENCES usuario(id),
  fecha               TIMESTAMPTZ DEFAULT now(),
  ip                  INET,
  user_agent          TEXT,
  tipo                VARCHAR(20),                           -- simple, avanzada, institucional
  entidad_tipo        VARCHAR(40) NOT NULL,                  -- 'resultado', 'certificado', 'cadena_custodia'
  entidad_id          UUID NOT NULL,
  motivo              VARCHAR(200),
  hash_documento      VARCHAR(64),                           -- SHA-256
  certificado_pem     TEXT                                   -- certificado X.509 usado
);
CREATE INDEX idx_firma_entidad ON firma_electronica(entidad_tipo, entidad_id);

ALTER TABLE cadena_custodia ADD CONSTRAINT fk_custodia_firma FOREIGN KEY (firma_electronica_id) REFERENCES firma_electronica(id);

CREATE TABLE boletin_analisis (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                  -- 'BA-2026-1854'
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  muestra_id          UUID REFERENCES muestra(id),
  metodo_version_id   UUID REFERENCES metodo_version(id),
  estado              VARCHAR(20) DEFAULT 'borrador',        -- borrador, en_revision, aprobado, rechazado
  contenido_json      JSONB,
  emitido_por         UUID REFERENCES usuario(id),
  emitido_at          TIMESTAMPTZ,
  firma_id            UUID REFERENCES firma_electronica(id),
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE certificado (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,                  -- 'CERT-IDIC-2026-0441'
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  tipo                VARCHAR(40),                           -- IVC, certificado_analisis, informe_tecnico
  plantilla_codigo    VARCHAR(40),
  pdf_doc_id          UUID,                                  -- FK a documento
  hash_sha256         VARCHAR(64) NOT NULL,
  url_verificacion    VARCHAR(300),                          -- 'verificar.idic.cl/c/{HASH}'
  emitido_por         UUID REFERENCES usuario(id),
  emitido_at          TIMESTAMPTZ DEFAULT now(),
  firmas_ids          UUID[] DEFAULT '{}',                   -- array de firmas
  estado              VARCHAR(20) DEFAULT 'vigente',         -- vigente, revocado
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_certificado_ot ON certificado(ot_id);
CREATE INDEX idx_certificado_hash ON certificado(hash_sha256);

-- =============================================================================
-- FACTURACIÓN CHILENA
-- =============================================================================

CREATE TABLE factura (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                  -- 'F-2026-04412'
  numero_dte          INT,                                   -- folio SII (si integración DTE)
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  cliente_id          UUID NOT NULL REFERENCES cliente(id),
  fecha_emision       DATE DEFAULT CURRENT_DATE,
  fecha_vencimiento   DATE,
  subtotal            NUMERIC(14,2) DEFAULT 0,
  descuento           NUMERIC(14,2) DEFAULT 0,
  neto                NUMERIC(14,2) DEFAULT 0,
  iva_monto           NUMERIC(14,2) DEFAULT 0,
  total               NUMERIC(14,2) DEFAULT 0,
  saldo               NUMERIC(14,2) DEFAULT 0,
  estado              VARCHAR(20) DEFAULT 'emitida',         -- emitida, pagada, aviso_1, aviso_2, aviso_3, prejudicial, cde
  pdf_doc_id          UUID,
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_factura_cliente_estado ON factura(cliente_id, estado);
CREATE INDEX idx_factura_vencimiento ON factura(fecha_vencimiento) WHERE estado IN ('emitida','aviso_1','aviso_2','aviso_3');

CREATE TABLE linea_factura (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id          UUID NOT NULL REFERENCES factura(id) ON DELETE CASCADE,
  metodo_id           UUID REFERENCES metodo(id),
  descripcion         TEXT,
  cantidad            INT NOT NULL DEFAULT 1,
  precio_unitario     NUMERIC(14,2) NOT NULL,
  subtotal            NUMERIC(14,2) NOT NULL
);

CREATE TABLE nota_credito (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,
  factura_id          UUID REFERENCES factura(id),
  fecha               DATE DEFAULT CURRENT_DATE,
  monto               NUMERIC(14,2) NOT NULL,
  motivo              TEXT,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE nota_debito (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,
  factura_id          UUID REFERENCES factura(id),
  fecha               DATE DEFAULT CURRENT_DATE,
  monto               NUMERIC(14,2) NOT NULL,
  motivo              TEXT,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE pago (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id          UUID NOT NULL REFERENCES factura(id),
  fecha               DATE DEFAULT CURRENT_DATE,
  monto               NUMERIC(14,2) NOT NULL,
  medio               VARCHAR(30),                           -- cheque, transferencia, contado, tarjeta
  referencia          VARCHAR(100),                          -- N° cheque o transferencia
  banco               VARCHAR(80),
  registrado_por      UUID REFERENCES usuario(id),
  registrado_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE aviso_cobranza (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id          UUID NOT NULL REFERENCES factura(id),
  tipo                VARCHAR(30) NOT NULL,                  -- aviso_1, aviso_2, aviso_3, prejudicial, cde
  fecha_emision       DATE DEFAULT CURRENT_DATE,
  pdf_doc_id          UUID,
  emitido_por         UUID REFERENCES usuario(id),
  notas               TEXT
);

-- =============================================================================
-- NO CONFORMIDADES (NC)
-- =============================================================================

CREATE TABLE no_conformidad (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                  -- 'NC-2026-0017'
  tipo                VARCHAR(30),                           -- proceso, equipo, personal, externa
  criticidad          VARCHAR(20),                           -- baja, media, alta, critica
  origen_entidad_tipo VARCHAR(40),                           -- 'resultado', 'muestra', 'equipo', 'queja_cliente'
  origen_entidad_id   UUID,
  descripcion         TEXT NOT NULL,
  detectado_por       UUID REFERENCES usuario(id),
  detectado_at        TIMESTAMPTZ DEFAULT now(),
  responsable_id      UUID REFERENCES usuario(id),
  plazo_cierre        DATE,
  causa_raiz          TEXT,
  accion_correctiva   TEXT,
  accion_preventiva   TEXT,
  verificacion        TEXT,
  estado              VARCHAR(20) DEFAULT 'abierta',         -- abierta, en_proceso, verificacion, cerrada, reabierta
  cerrado_at          TIMESTAMPTZ,
  cerrado_por         UUID REFERENCES usuario(id),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_nc_estado ON no_conformidad(tenant_id, estado);

-- =============================================================================
-- REPOSITORIO DOCUMENTAL (MinIO + metadata)
-- =============================================================================

CREATE TABLE documento (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(80),
  nombre              VARCHAR(300) NOT NULL,
  tipo_mime           VARCHAR(120),
  tamano_bytes        BIGINT,
  hash_sha256         VARCHAR(64),
  -- Almacenamiento en MinIO
  bucket              VARCHAR(120),
  object_key          VARCHAR(500),
  -- Metadata
  carpeta_path        TEXT,                                  -- 'OT/2026/0721/muestras'
  vinculado_a_tipo    VARCHAR(40),                           -- 'ot', 'muestra', 'metodo', 'equipo', 'cliente'
  vinculado_a_id      UUID,
  -- Versionado
  version             INT DEFAULT 1,
  documento_padre_id  UUID REFERENCES documento(id),
  vigente             BOOLEAN DEFAULT TRUE,
  -- Audit
  subido_por          UUID REFERENCES usuario(id),
  subido_at           TIMESTAMPTZ DEFAULT now(),
  observaciones       TEXT
);
CREATE INDEX idx_documento_vinculo ON documento(vinculado_a_tipo, vinculado_a_id);
CREATE INDEX idx_documento_carpeta ON documento(carpeta_path text_pattern_ops);
CREATE INDEX idx_documento_hash ON documento(hash_sha256);

-- =============================================================================
-- MOTOR BPM · DEFINICIÓN (la "plantilla" del flujo)
-- =============================================================================
-- Aquí viven los 18 flujos del Excel maestro como plantillas pre-cargadas.
-- El diseñador visual (bpmn-js) edita estas tablas.

CREATE TABLE flujo_def (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  codigo          VARCHAR(40) NOT NULL,                      -- 'F01', 'F08', 'BPCH-EXPLOS-V1'
  nombre          VARCHAR(200) NOT NULL,
  categoria       VARCHAR(40),                               -- Comercial, Operativo, Técnico, Financiero
  unidad_id       UUID REFERENCES unidad(id),                -- NULL = aplica a todo
  es_plantilla    BOOLEAN DEFAULT FALSE,                     -- TRUE para los 18 del Excel
  descripcion     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE flujo_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_def_id    UUID NOT NULL REFERENCES flujo_def(id),
  version         VARCHAR(10) NOT NULL,                      -- 'v1.0', 'v2.1'
  bpmn_xml        TEXT,                                      -- XML BPMN 2.0 original de bpmn-js
  estado          VARCHAR(20) DEFAULT 'borrador',            -- borrador, publicado, archivado
  vigente_desde   TIMESTAMPTZ,
  vigente_hasta   TIMESTAMPTZ,
  publicado_por   UUID REFERENCES usuario(id),
  publicado_at    TIMESTAMPTZ,
  notas_cambio    TEXT,                                      -- "audit" del cambio
  UNIQUE(flujo_def_id, version)
);
CREATE INDEX idx_flujover_vigencia ON flujo_version(estado, vigente_desde, vigente_hasta);

CREATE TABLE flujo_paso (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_version_id    UUID NOT NULL REFERENCES flujo_version(id) ON DELETE CASCADE,
  bpmn_element_id     VARCHAR(80) NOT NULL,                  -- ID dentro del XML BPMN
  numero              INT NOT NULL,
  tipo                VARCHAR(20) NOT NULL,                  -- INICIO, ACTIVIDAD, DECISION, AUTO, ESPERA, FIN, SUBPROCESO
  actividad           VARCHAR(300) NOT NULL,
  responsable_rol_id  UUID REFERENCES rol(id),
  sistema             VARCHAR(120),
  entrada             TEXT,
  salida              TEXT,
  condicion           TEXT,                                  -- expresión DSL para decisiones/transiciones
  sla_minutos         INT,
  escalamiento_rol_id UUID REFERENCES rol(id),
  hito_pliego         VARCHAR(20),                           -- '4.3.7', '4.2.3', etc.
  config_json         JSONB DEFAULT '{}',
  notas               TEXT,
  UNIQUE(flujo_version_id, bpmn_element_id)
);
CREATE INDEX idx_flujopaso_version ON flujo_paso(flujo_version_id);

CREATE TABLE flujo_transicion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_version_id    UUID NOT NULL REFERENCES flujo_version(id) ON DELETE CASCADE,
  origen_paso_id      UUID NOT NULL REFERENCES flujo_paso(id),
  destino_paso_id     UUID NOT NULL REFERENCES flujo_paso(id),
  condicion           TEXT,                                  -- 'qc_ok == true', 'monto > 1000000'
  etiqueta            VARCHAR(80),                           -- 'Sí', 'No', 'Observado'
  orden               INT DEFAULT 0
);

CREATE TABLE flujo_variable (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_version_id    UUID NOT NULL REFERENCES flujo_version(id) ON DELETE CASCADE,
  nombre              VARCHAR(80) NOT NULL,
  tipo                VARCHAR(20) NOT NULL,                  -- boolean, integer, decimal, string, date, json
  obligatoria         BOOLEAN DEFAULT FALSE,
  valor_default       TEXT,
  scope               VARCHAR(20),                           -- input, output, internal
  descripcion         TEXT,
  UNIQUE(flujo_version_id, nombre)
);

-- =============================================================================
-- MOTOR BPM · RUNTIME (ejecución concreta de los flujos)
-- =============================================================================
-- Cada OT operativa es una flujo_instancia.

CREATE TABLE flujo_instancia (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  flujo_version_id    UUID NOT NULL REFERENCES flujo_version(id),
  ot_id               UUID REFERENCES orden_trabajo(id),
  estado              VARCHAR(20) NOT NULL DEFAULT 'iniciado', -- iniciado, en_ejecucion, esperando, completado, abortado, error
  paso_actual_id      UUID REFERENCES flujo_paso(id),
  iniciado_at         TIMESTAMPTZ DEFAULT now(),
  iniciado_por        UUID REFERENCES usuario(id),
  completado_at       TIMESTAMPTZ,
  metadata            JSONB DEFAULT '{}'
);
CREATE INDEX idx_flujoins_ot ON flujo_instancia(ot_id);
CREATE INDEX idx_flujoins_estado ON flujo_instancia(tenant_id, estado);

ALTER TABLE orden_trabajo ADD CONSTRAINT fk_ot_flujoinstancia FOREIGN KEY (flujo_instancia_id) REFERENCES flujo_instancia(id);

CREATE TABLE paso_ejecucion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id        UUID NOT NULL REFERENCES flujo_instancia(id) ON DELETE CASCADE,
  paso_id             UUID NOT NULL REFERENCES flujo_paso(id),
  estado              VARCHAR(20),                           -- pendiente, en_curso, completado, omitido, fallido
  asignado_a          UUID REFERENCES usuario(id),
  iniciado_at         TIMESTAMPTZ,
  completado_at       TIMESTAMPTZ,
  duracion_real_min   INT,
  excedio_sla         BOOLEAN DEFAULT FALSE,
  resultado           JSONB,                                 -- datos producidos por este paso
  error               TEXT
);
CREATE INDEX idx_pasoeje_instancia ON paso_ejecucion(instancia_id);
CREATE INDEX idx_pasoeje_asignado ON paso_ejecucion(asignado_a, estado);

CREATE TABLE variable_valor (
  instancia_id        UUID REFERENCES flujo_instancia(id) ON DELETE CASCADE,
  variable_id         UUID REFERENCES flujo_variable(id),
  valor               TEXT,
  actualizado_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (instancia_id, variable_id)
);

CREATE TABLE tarea_asignada (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paso_ejecucion_id   UUID NOT NULL REFERENCES paso_ejecucion(id) ON DELETE CASCADE,
  asignado_a          UUID NOT NULL REFERENCES usuario(id),
  estado              VARCHAR(20) DEFAULT 'pendiente',       -- pendiente, en_curso, completada, devuelta
  prioridad           INT DEFAULT 0,
  vence_at            TIMESTAMPTZ,                           -- por SLA
  iniciada_at         TIMESTAMPTZ,
  completada_at       TIMESTAMPTZ,
  notas_usuario       TEXT
);
CREATE INDEX idx_tarea_asignado_estado ON tarea_asignada(asignado_a, estado);
CREATE INDEX idx_tarea_vence ON tarea_asignada(vence_at) WHERE estado IN ('pendiente','en_curso');

-- =============================================================================
-- AUDIT LOG (particionado por mes para escala 17025)
-- =============================================================================

CREATE TABLE audit_log (
  id                  UUID DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  ocurrido_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id          UUID,
  username            VARCHAR(80),
  ip                  INET,
  user_agent          TEXT,
  accion              VARCHAR(60) NOT NULL,                  -- crear, modificar, eliminar, login, logout, aprobar, firmar
  entidad_tipo        VARCHAR(60) NOT NULL,
  entidad_id          UUID,
  entidad_codigo      VARCHAR(60),                           -- denormalizado para queries rápidas
  diff                JSONB,                                 -- antes/después
  motivo              TEXT,
  metadata            JSONB,
  PRIMARY KEY (id, ocurrido_at)
) PARTITION BY RANGE (ocurrido_at);

-- Particiones iniciales (1 por mes para 2026)
CREATE TABLE audit_log_2026_01 PARTITION OF audit_log FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_log_2026_02 PARTITION OF audit_log FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_log_2026_03 PARTITION OF audit_log FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_log_2026_04 PARTITION OF audit_log FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_log_2026_06 PARTITION OF audit_log FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_log_2026_07 PARTITION OF audit_log FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_log_2026_09 PARTITION OF audit_log FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_log_2026_10 PARTITION OF audit_log FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_log_2026_12 PARTITION OF audit_log FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_log_2027_01 PARTITION OF audit_log FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE audit_log_2027_02 PARTITION OF audit_log FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');

CREATE INDEX idx_audit_tenant_fecha ON audit_log(tenant_id, ocurrido_at DESC);
CREATE INDEX idx_audit_usuario ON audit_log(usuario_id, ocurrido_at DESC);
CREATE INDEX idx_audit_entidad ON audit_log(entidad_tipo, entidad_id);
CREATE INDEX idx_audit_accion ON audit_log(accion, ocurrido_at);

-- =============================================================================
-- VISTAS PARA BI (Power BI + Metabase consumen estas)
-- =============================================================================

CREATE OR REPLACE VIEW v_muestras_consolidado AS
SELECT
  m.id,
  m.tenant_id,
  m.codigo                    AS muestra_codigo,
  ot.codigo                   AS ot_codigo,
  c.razon_social              AS cliente,
  c.rut                       AS cliente_rut,
  u.codigo                    AS unidad_codigo,
  u.nombre                    AS unidad_nombre,
  tm.nombre                   AS tipo_muestra,
  m.estado,
  m.recepcionada_at,
  ot.fecha_compromiso,
  CASE
    WHEN ot.fecha_compromiso < CURRENT_DATE AND ot.estado NOT IN ('cerrada','informada') THEN TRUE
    ELSE FALSE
  END                         AS vencida,
  EXTRACT(EPOCH FROM (now() - m.recepcionada_at))/86400 AS dias_en_proceso
FROM muestra m
JOIN orden_trabajo ot ON ot.id = m.ot_id
JOIN cliente c ON c.id = ot.cliente_id
JOIN unidad u ON u.id = ot.unidad_principal
LEFT JOIN tipo_muestra tm ON tm.id = m.tipo_muestra_id;

CREATE OR REPLACE VIEW v_sla_por_unidad AS
SELECT
  u.id            AS unidad_id,
  u.codigo        AS unidad_codigo,
  u.nombre        AS unidad,
  date_trunc('week', ot.fecha_recepcion)::date AS semana,
  COUNT(*)                                                            AS ot_totales,
  COUNT(*) FILTER (WHERE ot.estado = 'cerrada')                       AS cerradas,
  COUNT(*) FILTER (WHERE ot.fecha_compromiso < CURRENT_DATE
                   AND ot.estado NOT IN ('cerrada','informada'))      AS vencidas,
  AVG(EXTRACT(EPOCH FROM (ot.fecha_cierre - ot.fecha_recepcion))/86400) FILTER (WHERE ot.estado = 'cerrada') AS ciclo_promedio_dias
FROM orden_trabajo ot
JOIN unidad u ON u.id = ot.unidad_principal
WHERE ot.fecha_recepcion IS NOT NULL
GROUP BY u.id, u.codigo, u.nombre, semana;

CREATE OR REPLACE VIEW v_facturacion_mensual AS
SELECT
  f.tenant_id,
  date_trunc('month', f.fecha_emision)::date AS mes,
  COUNT(*)                                              AS facturas_emitidas,
  SUM(f.total)                                          AS facturado,
  SUM(f.total) FILTER (WHERE f.estado = 'pagada')       AS cobrado,
  SUM(f.saldo) FILTER (WHERE f.estado IN ('emitida','aviso_1','aviso_2','aviso_3')) AS por_cobrar,
  SUM(f.saldo) FILTER (WHERE f.estado IN ('prejudicial','cde')) AS en_riesgo
FROM factura f
GROUP BY f.tenant_id, mes;

-- =============================================================================
-- AMPLIACIÓN MÓDULO COMERCIAL · derivado del análisis de comercial_produccion
-- =============================================================================
-- Estas tablas cubren funcionalidades del PHP+MariaDB legacy que no estaban
-- en el schema inicial. Identificadas en plan_recreacion_modulo_comercial.html.

-- Órdenes de compra/adquisición (consolida ordadq + ord_adq + ord_compra + ordcompra)
CREATE TABLE orden_compra (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                      -- 'OA-2026-0054' o 'OC-2026-0103'
  tipo                VARCHAR(20) NOT NULL,                      -- 'adquisicion' | 'compra'
  proyecto_id         UUID,                                      -- FK a proyecto abajo
  estado              VARCHAR(30) NOT NULL DEFAULT 'borrador',   -- borrador, aprobada, en_proceso, recibida, cerrada, anulada
  fecha_emision       DATE DEFAULT CURRENT_DATE,
  monto               NUMERIC(14,2),
  moneda              VARCHAR(10) DEFAULT 'CLP',
  precio_idic_clp     NUMERIC(14,2),                             -- normalizado a CLP
  paridad_aplicada    NUMERIC(14,4),
  rut_receptor        VARCHAR(20),
  nombre_receptor     VARCHAR(200),
  documento_referencia VARCHAR(120),                             -- nº contrato, orden cliente
  detalle             TEXT,
  emitida_por         UUID REFERENCES usuario(id),
  aprobada_por        UUID REFERENCES usuario(id),
  aprobada_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_orden_compra_estado ON orden_compra(tenant_id, estado);
CREATE INDEX idx_orden_compra_fecha  ON orden_compra(fecha_emision DESC);

-- Proyectos (institucionales o por contrato externo)
CREATE TABLE proyecto (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,
  nombre              VARCHAR(300) NOT NULL,
  descripcion         TEXT,
  cliente_id          UUID REFERENCES cliente(id),                -- NULL si es interno
  fecha_inicio        DATE,
  fecha_fin           DATE,
  presupuesto_clp     NUMERIC(14,2),
  activo              BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, codigo)
);
ALTER TABLE orden_compra ADD CONSTRAINT fk_orden_proyecto FOREIGN KEY (proyecto_id) REFERENCES proyecto(id);

-- Encuestas de satisfacción del cliente (5.638 históricas en legacy)
CREATE TABLE encuesta_satisfaccion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,
  ot_id               UUID REFERENCES orden_trabajo(id),
  cliente_id          UUID REFERENCES cliente(id),
  fecha_envio         DATE,
  fecha_respuesta     DATE,
  canal_envio         VARCHAR(40),                                -- email, portal, formulario fisico
  nps                 INT,                                        -- 0-10
  rating_plazo        INT CHECK (rating_plazo BETWEEN 1 AND 5),
  rating_calidad      INT CHECK (rating_calidad BETWEEN 1 AND 5),
  rating_atencion     INT CHECK (rating_atencion BETWEEN 1 AND 5),
  comentario_libre    TEXT,
  reclamo_abierto     BOOLEAN DEFAULT FALSE,
  nc_relacionada_id   UUID REFERENCES no_conformidad(id),
  estado              VARCHAR(20) DEFAULT 'enviada',              -- enviada, respondida, vencida, anulada
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_encuesta_ot      ON encuesta_satisfaccion(ot_id);
CREATE INDEX idx_encuesta_cliente ON encuesta_satisfaccion(cliente_id);
CREATE INDEX idx_encuesta_nps     ON encuesta_satisfaccion(nps);

-- Recursos del IDIC para visitas en campo / análisis especiales
CREATE TABLE vehiculo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  patente             VARCHAR(10) NOT NULL,
  tipo                VARCHAR(40),                                -- camioneta, sedan, bus, blindado
  marca               VARCHAR(60),
  modelo              VARCHAR(80),
  ano                 INT,
  ubicacion_actual    UUID REFERENCES sede(id),
  estado              VARCHAR(30) DEFAULT 'operativo',
  capacidad_pasajeros INT,
  UNIQUE(tenant_id, patente)
);

CREATE TABLE peq_equipo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,
  nombre              VARCHAR(200) NOT NULL,
  tipo                VARCHAR(60),                                -- balanza_portatil, GPS, cámara, etc.
  marca_modelo        VARCHAR(120),
  asignado_a_id       UUID REFERENCES usuario(id),
  ubicacion_id        UUID REFERENCES ubicacion(id),
  estado              VARCHAR(30) DEFAULT 'disponible',
  UNIQUE(tenant_id, codigo)
);

-- Grados militares (catálogo para usuario.grado)
CREATE TABLE grado_militar (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              VARCHAR(20) NOT NULL UNIQUE,
  nombre              VARCHAR(80) NOT NULL,
  jerarquia           INT NOT NULL,                               -- orden ascendente
  rama                VARCHAR(20)                                 -- Ejército, Civil, FACh, Armada, Carabineros
);

-- Centro de costo (referenciado en cotización, factura, OC)
CREATE TABLE centro_costo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(20) NOT NULL,                       -- 'LCC-001', 'LQC-001'
  sigla               VARCHAR(10),                                -- 'LCC', 'LQC'
  descripcion         VARCHAR(200) NOT NULL,
  tipo                VARCHAR(30),                                -- laboratorio, sección, servicio, administrativo
  unidad_id           UUID REFERENCES unidad(id),                  -- vínculo con unidad organizacional
  activo              BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, codigo)
);

-- Ampliar usuario con grado militar
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS grado_id UUID REFERENCES grado_militar(id);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS cargo VARCHAR(200);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS centro_costo_id UUID REFERENCES centro_costo(id);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS user_lims VARCHAR(50);  -- correspondencia con LIMS técnico

-- Ampliar cotizacion con campos del legacy
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS centro_costo_id UUID REFERENCES centro_costo(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS detalle_cc VARCHAR(300);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS formato VARCHAR(20);          -- F1, F2, F3, F4
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(80);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS ejecutivo_id UUID REFERENCES usuario(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS disponibilidad VARCHAR(60);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS fecha_disponibilidad DATE;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS condiciones_particulares JSONB DEFAULT '{}'; -- de cotcondicper

-- Ampliar linea_cotizacion con tipos discriminados (productdet, viatico, pasajes, hrsmandet, hrsmaqdet, otrosdet, extension)
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) DEFAULT 'producto'; -- producto, viatico, pasaje, hora_hombre, hora_maquina, otros, extension
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS categoria VARCHAR(80);               -- para HH (A/B/C/D/E) o tipo viático (A/B)
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS dias_o_horas NUMERIC(8,2);            -- para viáticos (días) o HH/HM (horas)
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS tramo VARCHAR(200);                  -- para pasajes ej "STG-VIN"

-- Ampliar orden_trabajo con campos del legacy otcontrol (22 campos)
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS subdireccion_asignada VARCHAR(255);    -- SUBDIRASIG
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS origen_trabajo VARCHAR(120);            -- NOMORIGTRAB
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS tipo_trabajo VARCHAR(120);              -- NOMTIPTRAB
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS documento_word VARCHAR(120);            -- NOMDOCUM
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS fecha_entrega_cliente DATE;             -- fentregacli
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS fecha_recep_dco DATE;                   -- recepdco
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS dias_atraso INT DEFAULT 0;              -- diasatraso (calculado)
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS medio_envio VARCHAR(40);                -- medioenvio
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS estado_envio VARCHAR(40) DEFAULT 'No enviado'; -- envio
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS descripcion_trabajo TEXT;               -- DESCTRAB

-- Formulario técnico de la OT (28 campos legacy)
CREATE TABLE formulario_tecnico (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,                     -- 'FORM-2026-1042'
  cotizacion_id       UUID REFERENCES cotizacion(id),
  ot_id               UUID REFERENCES orden_trabajo(id),
  estado              VARCHAR(20) DEFAULT 'borrador',           -- borrador, aprobado, anulado
  fecha               DATE,
  glosa               TEXT,
  -- Responsable laboratorio
  nom_responsable     VARCHAR(200),
  cargo_responsable   VARCHAR(120),
  grado_responsable   VARCHAR(80),
  vb_lab              VARCHAR(20),                              -- pendiente, visado, rechazado
  fecha_vb_lab        TIMESTAMPTZ,
  comentario_lab      TEXT,
  -- Quien realiza
  nom_realiza         VARCHAR(200),
  cargo_realiza       VARCHAR(120),
  grado_realiza       VARCHAR(80),
  -- Jefe departamento
  nom_jefe_dpto       VARCHAR(200),
  centro_costo_id     UUID REFERENCES centro_costo(id),
  detalle_cc          VARCHAR(300),
  -- Condiciones
  condiciones_tecnicas TEXT,
  vb_final            VARCHAR(20),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_form_tec_ot  ON formulario_tecnico(ot_id);
CREATE INDEX idx_form_tec_cot ON formulario_tecnico(cotizacion_id);

-- =============================================================================
-- ENUMs · consolidación de 9 catálogos de estado legacy
-- =============================================================================
-- En el legacy: 9 tablas para listas de pocos valores (estado_cotizaciones,
-- estado_oa, estado_oc, estadocot, estadodco, etc.). En PG son ENUMs.

DO $$ BEGIN
  CREATE TYPE cotizacion_estado AS ENUM (
    'borrador', 'en_cotizacion', 'enviada', 'aceptada', 'rechazada', 'expirada'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE orden_compra_estado AS ENUM (
    'borrador', 'aprobada', 'en_proceso', 'recibida', 'cerrada', 'anulada'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ot_estado AS ENUM (
    'en_proceso', 'sin_plazo', 'cerrada', 'anulada', 'aprobada',
    'en_revision', 'atrasada', 'bloqueada'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hito_tipo AS ENUM (
    'recepcion', 'analisis_iniciado', 'analisis_completado',
    'revision_tecnica', 'aprobacion', 'informe_emitido', 'entrega_cliente',
    'desbloqueo', 'observacion', 'transferencia'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE disponibilidad_tipo AS ENUM (
    'inmediata', 'a_definir', 'fecha_especifica', 'segun_demanda'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE linea_cotizacion_tipo AS ENUM (
    'producto', 'viatico', 'pasaje', 'hora_hombre', 'hora_maquina',
    'otros', 'extension', 'comprension'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- TABLAS RESCATADAS DE REVISIÓN (categoría G del análisis)
-- =============================================================================
-- 7 tablas que estaban "en revisión" y resultaron tener datos relevantes que
-- sí deben migrarse al nuevo schema.

-- Control adicional de cotizaciones (legacy control_cotizacion, 236 filas)
CREATE TABLE control_cotizacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  cotizacion_id       UUID NOT NULL REFERENCES cotizacion(id),
  evento              VARCHAR(40) NOT NULL,                    -- envio, recepcion, modificacion, comentario
  fecha               TIMESTAMPTZ DEFAULT now(),
  usuario_id          UUID REFERENCES usuario(id),
  observacion         TEXT
);
CREATE INDEX idx_ctrl_cot ON control_cotizacion(cotizacion_id, fecha DESC);

-- Control de sincronización con LIMS técnico (legacy ctrlupdate)
-- En el sistema nuevo no hay sync (todo en una BD), pero conservamos histórico
CREATE TABLE control_update_sistema (
  id                  SERIAL PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  modulo              VARCHAR(40) NOT NULL,                    -- 'sync_lims', 'sync_ad', 'sync_sii'
  fecha_ultimo_update TIMESTAMPTZ,
  estado              VARCHAR(20),
  detalle             TEXT
);

-- Comprensión técnica de cotización (descripción técnica adicional, 2.344 filas)
CREATE TABLE cotizacion_comprension (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id       UUID NOT NULL REFERENCES cotizacion(id) ON DELETE CASCADE,
  numero              INT NOT NULL,
  descripcion         TEXT NOT NULL,
  alcance             TEXT,
  exclusiones         TEXT,
  UNIQUE(cotizacion_id, numero)
);

CREATE TABLE cotizacion_comprension_detalle (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comprension_id      UUID NOT NULL REFERENCES cotizacion_comprension(id) ON DELETE CASCADE,
  numero              INT NOT NULL,
  detalle             TEXT,
  cantidad            INT,
  valor               NUMERIC(14,2)
);

CREATE TABLE cotizacion_extension_detalle (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id       UUID NOT NULL REFERENCES cotizacion(id) ON DELETE CASCADE,
  numero              INT NOT NULL,
  detalle             TEXT,
  cantidad            INT,
  valor               NUMERIC(14,2)
);

-- Lista de precios servicio primario (legacy lps_primaria, 574 filas)
CREATE TABLE lista_precio_servicio_primario (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,
  descripcion         TEXT,
  precio_clp          NUMERIC(14,2),
  centro_costo_id     UUID REFERENCES centro_costo(id),
  vigente_desde       DATE NOT NULL,
  vigente_hasta       DATE,
  UNIQUE(tenant_id, codigo, vigente_desde)
);

-- Catálogo HH por categoría (legacy hrshombre, 19 filas)
CREATE TABLE hora_hombre_catalogo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  categoria           VARCHAR(20) NOT NULL,                    -- A, B, C, D, E
  descripcion         VARCHAR(200),                            -- 'Jefe técnico', 'Profesional Sr', etc.
  valor_hora_clp      NUMERIC(14,2) NOT NULL,
  vigente_desde       DATE NOT NULL,
  vigente_hasta       DATE,
  UNIQUE(tenant_id, categoria, vigente_desde)
);

-- Catálogo HM por equipo (legacy hrsmaquina, 488 filas)
CREATE TABLE hora_maquina_catalogo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  equipo_id           UUID REFERENCES equipo(id),
  descripcion         VARCHAR(200),                            -- 'HPLC Agilent 1260'
  valor_hora_clp      NUMERIC(14,2) NOT NULL,
  vigente_desde       DATE NOT NULL,
  vigente_hasta       DATE,
  UNIQUE(tenant_id, equipo_id, vigente_desde)
);

-- Catálogo HH perfil (legacy phh_hh, 2 filas)
CREATE TABLE hora_hombre_perfil (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  perfil              VARCHAR(40),                             -- 'civil', 'militar'
  ajuste_pct          NUMERIC(5,2),                            -- ajuste sobre valor base
  descripcion         TEXT
);

-- Seguimiento de encuestas enviadas (legacy enc_seguimiento, 51 filas)
CREATE TABLE encuesta_seguimiento (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encuesta_id         UUID NOT NULL REFERENCES encuesta_satisfaccion(id),
  fecha               TIMESTAMPTZ DEFAULT now(),
  accion              VARCHAR(40),                             -- enviada, recordatorio, respondida, vencida
  detalle             TEXT,
  usuario_id          UUID REFERENCES usuario(id)
);

-- Tipos catalogados misceláneos (categoría F)
CREATE TABLE servicio_tipo (
  codigo              VARCHAR(20) PRIMARY KEY,
  nombre              VARCHAR(80) NOT NULL,
  activo              BOOLEAN DEFAULT TRUE
);

CREATE TABLE consumo_tipo (
  codigo              VARCHAR(20) PRIMARY KEY,
  nombre              VARCHAR(80) NOT NULL
);

CREATE TABLE unidad_medida (
  codigo              VARCHAR(10) PRIMARY KEY,
  nombre              VARCHAR(80) NOT NULL,
  simbolo             VARCHAR(20)
);

CREATE TABLE consumo_basico (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  tipo_id             VARCHAR(20) REFERENCES consumo_tipo(codigo),
  descripcion         VARCHAR(200),
  cantidad            NUMERIC,
  unidad_id           VARCHAR(10) REFERENCES unidad_medida(codigo)
);

CREATE TABLE correo_distribucion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  email               CITEXT NOT NULL,
  categoria           VARCHAR(40),                              -- distribucion, copia, cobranza, comercial
  cliente_id          UUID REFERENCES cliente(id),
  activo              BOOLEAN DEFAULT TRUE
);

-- Envío de OT (legacy controlenvio)
CREATE TABLE envio_ot (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  medio               VARCHAR(40),                              -- email, fisico, email_fisico, portal
  fecha               TIMESTAMPTZ DEFAULT now(),
  destinatario        VARCHAR(300),
  con_copia           VARCHAR(300),
  otra_copia          VARCHAR(300),
  observacion         TEXT,
  enviado_por         UUID REFERENCES usuario(id)
);
CREATE INDEX idx_envio_ot ON envio_ot(ot_id, fecha DESC);

-- Tabla de bloqueo de cliente normalizada (legacy cliblocked con prefijo cblk_)
CREATE TABLE cliente_bloqueo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  cliente_id          UUID NOT NULL REFERENCES cliente(id),
  factura_id          UUID REFERENCES factura(id),
  numero_factura_legacy INT,                                    -- cblk_numfact del legacy
  fecha_vencimiento   DATE,
  estado_factura      VARCHAR(20),                              -- pagada, anulada, pendiente
  monto_pendiente     NUMERIC(14,2),
  contador_no_pago    INT DEFAULT 0,                            -- cblk_nopago
  bloqueado_at        TIMESTAMPTZ DEFAULT now(),
  bloqueado_por       UUID REFERENCES usuario(id),
  activo              BOOLEAN DEFAULT TRUE
);
CREATE INDEX idx_cli_bloq_cliente ON cliente_bloqueo(cliente_id) WHERE activo = TRUE;

-- Desbloqueo de cliente con motivo (legacy desbloqueocli)
CREATE TABLE cliente_desbloqueo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES cliente(id),
  motivo              TEXT NOT NULL,
  fecha               TIMESTAMPTZ DEFAULT now(),
  ot_id               UUID REFERENCES orden_trabajo(id),
  cotizacion_id       UUID REFERENCES cotizacion(id),
  tipo_doc            VARCHAR(20),                              -- OT, Cot, Factura
  autorizado_por      UUID REFERENCES usuario(id),
  doble_firma_por     UUID REFERENCES usuario(id)               -- para casos críticos
);
CREATE INDEX idx_cli_desbloq ON cliente_desbloqueo(cliente_id, fecha DESC);

-- =============================================================================
-- AMPLIACIÓN LIMS TÉCNICO · 8 GAPS derivados de la reingeniería de todo_idic.XLS
-- =============================================================================
-- Tablas que cubren funcionalidades del STARLIMS/SQL Server legacy ausentes en
-- el schema inicial. Identificadas en reingenieria_lims_tecnico.html (mapeo
-- legacy→nuevo). Conservan la semántica de las tablas SQL Server de origen.

-- GAP 1 · OT internas (legacy INT_ORDERS, 10.757 filas + FOLDERS.OTINTERNA='S')
-- Trabajo de laboratorio sin cliente externo (calibración interna, I+D, ensayos
-- de validación). No factura, pero consume HH/HM y debe costearse internamente.
CREATE TABLE ot_interna (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ot_id               UUID REFERENCES orden_trabajo(id),          -- si se materializa como OT
  codigo              VARCHAR(30) NOT NULL,                       -- 'OTI-2026-0001'
  motivo              VARCHAR(40) NOT NULL,                       -- calibracion_interna, i+d, validacion_metodo, reproceso
  unidad_solicitante  UUID REFERENCES unidad(id),
  unidad_ejecutora    UUID REFERENCES unidad(id),
  centro_costo_id     UUID REFERENCES centro_costo(id),
  descripcion         TEXT,
  costo_hh_estimado   NUMERIC(14,2),
  costo_hm_estimado   NUMERIC(14,2),
  estado              VARCHAR(30) NOT NULL DEFAULT 'abierta',     -- abierta, en_proceso, cerrada, anulada
  abierta_at          TIMESTAMPTZ DEFAULT now(),
  cerrada_at          TIMESTAMPTZ,
  UNIQUE(tenant_id, codigo)
);
CREATE INDEX idx_ot_interna_estado ON ot_interna(tenant_id, estado);

-- GAP 2 · Reapertura de OT (legacy OTREABIERTA)
-- Una OT cerrada/informada puede reabrirse (corrección de resultado, queja del
-- cliente, ampliación de ensayos). Trazabilidad 17025: quién, cuándo y por qué.
CREATE TABLE ot_reapertura (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  motivo              VARCHAR(40) NOT NULL,                       -- correccion_resultado, queja_cliente, ampliacion_ensayo, error_admin
  detalle             TEXT NOT NULL,
  estado_previo       VARCHAR(30),                                -- estado de la OT antes de reabrir
  no_conformidad_id   UUID REFERENCES no_conformidad(id),         -- si la reapertura origina/deriva de una NC
  certificado_anulado UUID REFERENCES certificado(id),            -- certificado que queda sin efecto
  solicitada_por      UUID REFERENCES usuario(id),
  autorizada_por      UUID REFERENCES usuario(id),                -- requiere autorización de jefatura
  reabierta_at        TIMESTAMPTZ DEFAULT now(),
  recerrada_at        TIMESTAMPTZ
);
CREATE INDEX idx_ot_reapertura_ot ON ot_reapertura(ot_id, reabierta_at DESC);

-- GAP 3 · Firma múltiple por analistas + jerarquía (legacy OT_ANALISTAS + OT_FIRMA)
-- Una OT puede tener varios analistas que aportan HH y firman, más la firma
-- escalonada jerárquica (analista → jefe lab → jefe depto) controlada por las
-- fechas FECCIEANA / FECCIEJEFLAB / FECCIEJEFDEP del FOLDERS legacy.
CREATE TABLE ot_analista (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  usuario_id          UUID NOT NULL REFERENCES usuario(id),
  clase_funcionaria   VARCHAR(40),                                -- legacy CLASEFUNC (Químico, Metrólogo, ...)
  tiempo_horas        NUMERIC(8,2),                               -- legacy OT_ANALISTAS.TIEMPO (HH aportadas)
  valor_hora          NUMERIC(14,2),                              -- legacy VALOR
  fecha               DATE DEFAULT CURRENT_DATE,
  UNIQUE(ot_id, usuario_id)
);
CREATE INDEX idx_ot_analista_ot ON ot_analista(ot_id);

CREATE TABLE ot_firma (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ot_id               UUID NOT NULL REFERENCES orden_trabajo(id),
  usuario_id          UUID NOT NULL REFERENCES usuario(id),
  nivel               SMALLINT NOT NULL,                          -- 1=analista, 2=jefe_lab, 3=jefe_depto
  rol_firma           VARCHAR(30) NOT NULL,                       -- analista, jefe_laboratorio, jefe_departamento
  firma_id            UUID REFERENCES firma_electronica(id),
  firmado_at          TIMESTAMPTZ,
  estado              VARCHAR(20) NOT NULL DEFAULT 'pendiente',   -- pendiente, firmado, rechazado
  UNIQUE(ot_id, nivel)
);
CREATE INDEX idx_ot_firma_ot ON ot_firma(ot_id, nivel);
CREATE INDEX idx_ot_firma_pendiente ON ot_firma(usuario_id) WHERE estado = 'pendiente';

-- GAP 4 · Módulo capacitación / competencias (legacy TRAINING, ANCOURS, NIVTECNICO)
-- Requisito NCh-ISO/IEC 17025 §6.2: registro de competencias, cursos y
-- autorizaciones del personal para ejecutar métodos específicos.
CREATE TABLE nivel_tecnico (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(20) NOT NULL,                       -- legacy NIVTECNICO ('AA','A','B'...)
  nombre              VARCHAR(120),
  orden               SMALLINT,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE capacitacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30),                                -- legacy ANCOURS
  nombre              VARCHAR(200) NOT NULL,
  tipo                VARCHAR(30),                                -- curso, induccion, reentrenamiento, externo
  institucion         VARCHAR(200),
  horas               NUMERIC(6,1),
  vigencia_meses      SMALLINT,                                   -- caducidad de la competencia
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE usuario_capacitacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  usuario_id          UUID NOT NULL REFERENCES usuario(id),
  capacitacion_id     UUID NOT NULL REFERENCES capacitacion(id),
  fecha_realizacion   DATE,
  fecha_vencimiento   DATE,                                       -- = realizacion + vigencia_meses
  resultado           VARCHAR(20),                                -- aprobado, reprobado, en_curso
  certificado_doc     UUID REFERENCES documento(id),
  UNIQUE(usuario_id, capacitacion_id, fecha_realizacion)
);
CREATE INDEX idx_usr_capac_vence ON usuario_capacitacion(fecha_vencimiento);

-- Autorización de un usuario para ejecutar un método (competencia técnica)
CREATE TABLE usuario_metodo_autorizado (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  usuario_id          UUID NOT NULL REFERENCES usuario(id),
  metodo_id           UUID NOT NULL REFERENCES metodo(id),
  nivel_tecnico_id    UUID REFERENCES nivel_tecnico(id),
  autorizado_por      UUID REFERENCES usuario(id),
  vigente_desde       DATE DEFAULT CURRENT_DATE,
  vigente_hasta       DATE,
  estado              VARCHAR(20) NOT NULL DEFAULT 'vigente',     -- vigente, suspendida, revocada
  UNIQUE(usuario_id, metodo_id)
);
CREATE INDEX idx_usr_metodo_autz ON usuario_metodo_autorizado(metodo_id) WHERE estado = 'vigente';

-- GAP 5 · Programación / agenda de ensayos (legacy PROGRAMACION3, REGISTRATURA)
-- Planificación de cuándo y con qué recurso (equipo/analista) se ejecuta cada
-- análisis. Base de la vista de carga y del cumplimiento de plazos.
CREATE TABLE programacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  unidad_id           UUID REFERENCES unidad(id),
  ot_id               UUID REFERENCES orden_trabajo(id),
  muestra_id          UUID REFERENCES muestra(id),
  analisis_id         UUID REFERENCES analisis_programado(id),
  equipo_id           UUID REFERENCES equipo(id),
  analista_id         UUID REFERENCES usuario(id),
  fecha_programada    DATE NOT NULL,
  hora_inicio         TIME,
  hora_fin            TIME,
  estado              VARCHAR(20) NOT NULL DEFAULT 'planificado', -- planificado, en_curso, realizado, reprogramado, cancelado
  observacion         TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_prog_fecha   ON programacion(tenant_id, fecha_programada);
CREATE INDEX idx_prog_analista ON programacion(analista_id, fecha_programada);
CREATE INDEX idx_prog_equipo  ON programacion(equipo_id, fecha_programada);

-- GAP 6 · Planillas de cálculo adjuntas (legacy PLANILLAEXCEL + planillas metrología)
-- Muchos labs (sobre todo Metrología) calculan incertidumbre en planillas Excel
-- versionadas (LMT-PG01-P01-ITF01-FORM01). Se conserva la planilla como artefacto
-- trazable ligado al resultado, con sus celdas de entrada/salida clave.
CREATE TABLE planilla_calculo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo_formato      VARCHAR(60),                                -- 'LMT-PG01-P01-ITF01-FORM01'
  nombre              VARCHAR(200) NOT NULL,
  magnitud            VARCHAR(40),                                -- Fuerza, Longitud, Masa, Presión, Volumen, Temperatura, Par Torsional
  metodo_id           UUID REFERENCES metodo(id),
  version             VARCHAR(20),                                -- 'Rev 20'
  documento_id        UUID REFERENCES documento(id),              -- el .xlsx original archivado
  entradas            JSONB,                                      -- celdas/etiquetas de entrada
  formula_incertidumbre TEXT,                                     -- uFp, uDS, uDt, uDD, ua, ub, u_comb, U_exp
  vigente             BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Instancia: una calibración/medición ejecutada con una planilla concreta
CREATE TABLE planilla_ejecucion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  planilla_id         UUID NOT NULL REFERENCES planilla_calculo(id),
  resultado_id        UUID REFERENCES resultado(id),
  calibracion_id      UUID REFERENCES calibracion(id),
  valores             JSONB,                                      -- valores de entrada capturados
  incertidumbre_exp   NUMERIC(18,8),                              -- U expandida resultante
  factor_k            NUMERIC(6,3) DEFAULT 2.0,
  archivo_doc         UUID REFERENCES documento(id),              -- xlsx diligenciado archivado
  ejecutada_por       UUID REFERENCES usuario(id),
  ejecutada_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_plan_eje_resultado ON planilla_ejecucion(resultado_id);

-- GAP 7 · Codificación documental granular (legacy CODTASDOC, CODMATDOC, CODPRODOC)
-- El SGC del IDIC codifica cada documento por tipo/material/proceso
-- (ej. IDIC-PG09-Anexo02-02, LME-PG01-P01-IT03-Rev06). Catálogo que alimenta la
-- numeración correlativa de informes, certificados y formularios.
CREATE TABLE codigo_documento (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(60) NOT NULL,                       -- 'IDIC-PG09-Anexo02-02'
  tipo_documento      VARCHAR(40) NOT NULL,                       -- procedimiento, instructivo, anexo, formulario, informe, certificado
  categoria           VARCHAR(20),                                -- legacy CODTASDOC(tarea)/CODMATDOC(material)/CODPRODOC(proceso)
  nombre              VARCHAR(200),
  unidad_id           UUID REFERENCES unidad(id),
  revision            VARCHAR(10),                                -- 'Rev06'
  vigente             BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, codigo)
);

-- Correlativos por serie de documento (reemplaza el contador embebido legacy)
CREATE TABLE correlativo_documento (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  serie               VARCHAR(60) NOT NULL,                       -- 'IVC.IDIC.DSA.SEM.LEM', 'CERT-IDIC'
  anio                SMALLINT NOT NULL,
  ultimo_numero       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, serie, anio)
);

-- GAP 8 · Tasas y puntos de tarifa (legacy TASADETA, VPUNTOSIV)
-- Soporta el cobro de la TASA 1,5% sobre internaciones (Ley 17.798, Control de
-- Armas) y los "puntos" / valores de tarifa institucional. Regla de negocio de
-- defensa: base CIF × paridad USD → 1,5% → IVA internación 19% → prorrateo a
-- centros de costo (Sucursal Santiago / DTCG / SDBPCH).
CREATE TABLE tasa_arancel (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30) NOT NULL,                       -- 'TASA_1.5', 'INTERNACION'
  nombre              VARCHAR(120),
  porcentaje          NUMERIC(7,4),                               -- 1.5000
  base                VARCHAR(30),                                -- 'CIF', 'monto_operacion'
  fundamento_legal    VARCHAR(120),                               -- 'Ley 17.798 Control de Armas'
  vigente_desde       DATE DEFAULT CURRENT_DATE,
  vigente_hasta       DATE,
  UNIQUE(tenant_id, codigo)
);

CREATE TABLE valor_punto (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  tipo                VARCHAR(20) NOT NULL,                       -- legacy VPUNTOSIV (punto IV), UTM, USD, UF, EUR
  fecha               DATE NOT NULL,
  valor_clp           NUMERIC(16,4) NOT NULL,
  UNIQUE(tenant_id, tipo, fecha)
);
CREATE INDEX idx_valor_punto ON valor_punto(tipo, fecha DESC);

-- Cálculo de la tasa 1,5% por internación (un registro por OT/operación)
CREATE TABLE calculo_tasa_internacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  ot_id               UUID REFERENCES orden_trabajo(id),
  cliente_id          UUID REFERENCES cliente(id),
  tasa_id             UUID REFERENCES tasa_arancel(id),
  monto_cif_usd       NUMERIC(16,2),
  paridad_usd         NUMERIC(12,4),                              -- tipo de cambio aplicado
  monto_cif_clp       NUMERIC(18,2),                              -- monto_cif_usd * paridad_usd
  pct_afecto          NUMERIC(6,2) DEFAULT 100.00,                -- % de la base que queda gravada
  monto_operacion     NUMERIC(18,2),                              -- 1,5% del CIF
  iva_internacion     NUMERIC(18,2),                              -- 19% sobre afecto
  total_a_cancelar    NUMERIC(18,2),
  distribucion_cc     JSONB,                                      -- prorrateo: {Sucursal_Santiago, DTCG, SDBPCH}
  documento_cb        UUID REFERENCES documento(id),              -- Comunicación Breve / carta de cobro
  calculado_por       UUID REFERENCES usuario(id),
  calculado_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_calc_tasa_ot ON calculo_tasa_internacion(ot_id);

-- =============================================================================
-- SEED INICIAL · DATOS DE ARRANQUE PARA IDIC
-- =============================================================================

-- Tenant IDIC
INSERT INTO tenant (codigo, nombre, rut, zona_horaria, moneda, iva_pct, activo) VALUES
  ('IDIC', 'Instituto de Investigaciones y Control · Ejército de Chile', '61.102.000-K', 'America/Santiago', 'CLP', 19.00, TRUE);

-- Sede principal (IDs se obtienen luego para los siguientes inserts)
INSERT INTO sede (tenant_id, codigo, nombre, direccion, ciudad, region) VALUES
  ((SELECT id FROM tenant WHERE codigo='IDIC'), 'STGO', 'IDIC Santiago - Matriz', 'Pedro Montt 145', 'Santiago', 'Metropolitana'),
  ((SELECT id FROM tenant WHERE codigo='IDIC'), 'BPCH-Q', 'Banco de Pruebas Chile - Quilicura', 'Quilicura', 'Santiago', 'Metropolitana');

-- 12 unidades (laboratorios) descubiertos del análisis
INSERT INTO unidad (tenant_id, sede_id, codigo, nombre)
SELECT t.id, s.id, x.codigo, x.nombre
FROM tenant t, sede s, (VALUES
  ('LCC',  'Laboratorio Cuero y Calzado'),
  ('LTX',  'Laboratorio Textil'),
  ('LQA',  'Laboratorio Química Aplicada'),
  ('LMB',  'Laboratorio Microbiología'),
  ('LES',  'Laboratorio Ensayos Especiales'),
  ('LEM',  'Laboratorio Ensayos Mecánicos'),
  ('LMT',  'Laboratorio Metrología'),
  ('LNF',  'Laboratorio LNF'),
  ('SEO',  'Sección Electrónica y Óptica'),
  ('SVM',  'Servicio Vehículos Militares'),
  ('SCC',  'Servicio Calidad Comercial'),
  ('COM',  'Comercial')
) AS x(codigo, nombre)
WHERE t.codigo='IDIC' AND s.codigo='STGO';

INSERT INTO unidad (tenant_id, sede_id, codigo, nombre)
SELECT t.id, s.id, 'BPCH', 'Banco de Pruebas de Chile'
FROM tenant t, sede s
WHERE t.codigo='IDIC' AND s.codigo='BPCH-Q';

-- Roles base del sistema
INSERT INTO rol (tenant_id, codigo, nombre, descripcion, es_sistema)
SELECT t.id, x.codigo, x.nombre, x.descripcion, TRUE
FROM tenant t, (VALUES
  ('SUPERADMIN',  'Super Administrador',       'Acceso total. Solo TI Aiuken / IDIC.'),
  ('ADMIN',       'Administrador del Sistema',  'Configuración, usuarios, parámetros'),
  ('DIRECTOR',    'Director Técnico',           'Aprobación final, sello institucional'),
  ('JEFE_LAB',    'Jefe de Laboratorio',         'Aprobación técnica + firma electrónica'),
  ('ANALISTA_SR', 'Analista Senior',             'Revisión técnica nivel 1'),
  ('ANALISTA',    'Analista',                    'Ejecuta análisis, captura resultados'),
  ('TECNICO',     'Técnico de Laboratorio',      'Preparación de muestras, apoyo'),
  ('RECEPCION',   'Recepción Central',           'Recibe muestras, cadena de custodia inicial'),
  ('COMERCIAL',   'Comercial',                   'Clientes, solicitudes, cotizaciones'),
  ('COBRANZA',    'Cobranza / Finanzas',          'Facturación, pagos, avisos'),
  ('CALIDAD',     'Calidad',                     'NCs, auditoría interna'),
  ('LECTOR',      'Lector / Auditor Externo',    'Solo lectura para auditoría'),
  ('CLIENTE',     'Cliente Externo',              'Portal cliente, descarga certificados')
) AS x(codigo, nombre, descripcion)
WHERE t.codigo='IDIC';

-- Permisos base (granularidad módulo.acción)
INSERT INTO permiso (codigo, modulo, accion, descripcion) VALUES
  ('cliente.ver',         'cliente', 'ver',        'Ver clientes'),
  ('cliente.crear',       'cliente', 'crear',      'Crear clientes'),
  ('cliente.editar',      'cliente', 'editar',     'Editar clientes'),
  ('cotizacion.ver',      'cotizacion', 'ver',     'Ver cotizaciones'),
  ('cotizacion.crear',    'cotizacion', 'crear',   'Crear cotizaciones'),
  ('cotizacion.aprobar',  'cotizacion', 'aprobar', 'Aprobar cotizaciones'),
  ('ot.ver',              'ot', 'ver',             'Ver OT'),
  ('ot.crear',            'ot', 'crear',           'Crear OT'),
  ('ot.cerrar',           'ot', 'cerrar',          'Cerrar OT'),
  ('muestra.ver',         'muestra', 'ver',        'Ver muestras'),
  ('muestra.crear',       'muestra', 'crear',      'Crear muestras (accessioning)'),
  ('muestra.transferir',  'muestra', 'transferir', 'Transferir custodia'),
  ('resultado.ver',       'resultado', 'ver',      'Ver resultados'),
  ('resultado.crear',     'resultado', 'crear',    'Capturar resultados'),
  ('resultado.revisar',   'resultado', 'revisar',  'Revisión nivel 1'),
  ('resultado.aprobar',   'resultado', 'aprobar',  'Aprobar y firmar resultados'),
  ('metodo.ver',          'metodo', 'ver',         'Ver métodos'),
  ('metodo.crear',        'metodo', 'crear',       'Crear métodos'),
  ('metodo.aprobar',      'metodo', 'aprobar',     'Aprobar nueva versión de método'),
  ('equipo.ver',          'equipo', 'ver',         'Ver equipos'),
  ('equipo.gestionar',    'equipo', 'gestionar',   'Calibraciones y mantenciones'),
  ('factura.ver',         'factura', 'ver',        'Ver facturas'),
  ('factura.emitir',      'factura', 'emitir',     'Emitir facturas'),
  ('factura.cobrar',      'factura', 'cobrar',     'Registrar pagos'),
  ('certificado.emitir',  'certificado', 'emitir', 'Emitir certificados'),
  ('certificado.firmar',  'certificado', 'firmar', 'Firmar certificados'),
  ('audit.ver',           'audit', 'ver',          'Ver audit trail'),
  ('admin.usuarios',      'admin', 'usuarios',     'Gestionar usuarios y roles'),
  ('flujo.ver',           'flujo', 'ver',          'Ver flujos BPM'),
  ('flujo.editar',        'flujo', 'editar',       'Editar flujos en diseñador'),
  ('flujo.publicar',      'flujo', 'publicar',     'Publicar versión de flujo'),
  ('nc.gestionar',        'nc', 'gestionar',       'Crear y cerrar NCs');

-- Taxonomía raíz de tipos de muestra (los grandes grupos descubiertos en el análisis)
INSERT INTO tipo_muestra (tenant_id, parent_id, codigo, nombre)
SELECT t.id, NULL, x.codigo, x.nombre
FROM tenant t, (VALUES
  ('explosivos',    'Explosivos y Sistemas de Iniciación'),
  ('cuero',         'Cuero y Calzado'),
  ('textil',        'Textil y Confección'),
  ('alimentos',     'Alimentos y Bromatología'),
  ('quimica',       'Productos Químicos'),
  ('metales',       'Metales y Aleaciones'),
  ('optica',        'Equipos Ópticos y Electrónicos'),
  ('vehiculos',     'Vehículos y Componentes'),
  ('agua',          'Agua y Líquidos')
) AS x(codigo, nombre)
WHERE t.codigo='IDIC';

-- Listas de precios iniciales
INSERT INTO lista_precio (tenant_id, codigo, nombre, moneda, vigente_desde)
SELECT t.id, x.codigo, x.nombre, 'CLP', CURRENT_DATE
FROM tenant t, (VALUES
  ('INST_1',     'Lista Institucional 1 (Ejército y FFAA)'),
  ('INST_2',     'Lista Institucional 2 (Otros organismos públicos)'),
  ('EXT_PUB',    'Lista Externa Pública'),
  ('EXT_PRIV',   'Lista Externa Privada')
) AS x(codigo, nombre)
WHERE t.codigo='IDIC';

-- Normas referenciales más usadas (extraídas del análisis)
INSERT INTO norma (codigo, nombre, organismo, ano) VALUES
  ('NCh-ISO/IEC 17025', 'Requisitos generales para la competencia de laboratorios', 'INN', 2017),
  ('NCh 624',        'Cuero - Determinación de resistencia a la tracción y alargamiento', 'INN', 2017),
  ('NCh 622',        'Cuero - Determinación de la resistencia al desgarramiento', 'INN', 2010),
  ('NCh 1206',       'Cuero - Determinación de cenizas', 'INN', 2014),
  ('NCh 841',        'Productos alimenticios - Determinación de humedad', 'INN', 2018),
  ('NCh 842',        'Productos alimenticios - Determinación de cenizas', 'INN', 2018),
  ('NCh 95',         'Productos alimenticios - Determinación de acidez', 'INN', 1981),
  ('NCh 3547',       'Productos alimenticios - Determinación de materia grasa', 'INN', 2018),
  ('ASTM E18',       'Hardness of Metallic Materials - Rockwell', 'ASTM', 2022),
  ('ASTM D5185',     'Multielement Determination of Used and Unused Lubricating Oils', 'ASTM', 2018),
  ('AOAC 979.08',    'Caffeine in Tea, HPLC', 'AOAC', 2019);

-- Tasa 1,5% sobre internaciones (Ley 17.798 Control de Armas) y niveles técnicos
INSERT INTO tasa_arancel (tenant_id, codigo, nombre, porcentaje, base, fundamento_legal)
SELECT t.id, 'TASA_1.5', 'Tasa 1,5% sobre internaciones de material de uso bélico', 1.5000, 'CIF', 'Ley 17.798 - Control de Armas'
FROM tenant t WHERE t.codigo='IDIC';

INSERT INTO nivel_tecnico (tenant_id, codigo, nombre, orden)
SELECT t.id, x.codigo, x.nombre, x.orden
FROM tenant t, (VALUES
  ('AA', 'Nivel técnico AA (máximo)', 1),
  ('A',  'Nivel técnico A',           2),
  ('B',  'Nivel técnico B',           3),
  ('C',  'Nivel técnico C (inicial)', 4)
) AS x(codigo, nombre, orden)
WHERE t.codigo='IDIC';

-- =============================================================================
-- FIN DEL SCHEMA
-- =============================================================================

-- Verificación rápida
SELECT 'Schema instalado correctamente.' AS status,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tablas_creadas,
       (SELECT count(*) FROM tenant)  AS tenants,
       (SELECT count(*) FROM unidad)  AS unidades,
       (SELECT count(*) FROM rol)     AS roles,
       (SELECT count(*) FROM permiso) AS permisos;
