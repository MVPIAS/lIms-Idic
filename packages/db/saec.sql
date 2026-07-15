-- ============================================================
-- SAEC · ARMAS, EVIDENCIAS Y CERTIFICADOS · LIMS IDIC · Aiuken
-- Implementa el bloque RF-K del SRS (Requerimientos_LIMS_IDIC_Aiuken.docx §4.11
-- y Anexo C): casos, elementos (armas/vainillas/proyectiles/explosivos),
-- importación ETL del XML ESI v3.2 de IBIS/Forensic (SOLO importación),
-- banco de evidencias, cadena de custodia inmutable, préstamo/devolución,
-- certificados con verificación pública, integraciones de entrada y auditoría.
--
-- Idempotente (IF NOT EXISTS + seed con ON CONFLICT).
--
-- AUTOCONTENIDO A PROPÓSITO. La base desplegada se genera con Prisma
-- (packages/db/prisma/schema.prisma), NO con schema.sql, y por eso NO tiene:
--   · la función set_updated_at()  → se define aquí con CREATE OR REPLACE;
--   · las tablas `ubicacion` ni `seccion` → la ubicación física se modela como
--     texto, igual que `Muestra.ubicacion` (VarChar) en el modelo Prisma;
--   · DEFAULT gen_random_uuid() en las tablas Prisma (los UUID los pone la app)
--     → todo INSERT sobre tablas del núcleo (p. ej. `permiso`) da el id explícito.
-- Solo se referencian tablas presentes en AMBOS esquemas: tenant, usuario,
-- unidad, cliente, orden_trabajo y muestra.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Definida en schema.sql, ausente en la base generada por Prisma: se garantiza
-- aquí para que el módulo se pueda aplicar sobre cualquiera de las dos.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- RF-K01 · Gestión de casos
-- Campos base alineados con el bloque <Case> del estándar ESI v3.2
-- (Anexo C.1): los valores de lista se guardan como código fijo + texto.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saec_caso (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  numero_caso             VARCHAR(60) NOT NULL,               -- ESI CaseNumber (QQWW1001)
  uuid_ibis               VARCHAR(80),                        -- ESI UUID (clave de correlación con Forensic)
  agencia_origen_ref      VARCHAR(120),                       -- ESI OriginatingAgencyReference
  agencia_origen_nombre   VARCHAR(200),                       -- ESI OriginatingAgencyName
  tipo_evento_codigo      VARCHAR(40),                        -- ESI EventType (code)
  tipo_evento_texto       VARCHAR(160),                       -- ESI EventType (texto descriptivo)
  fecha_ocurrencia        TIMESTAMPTZ,                        -- ESI OccurrenceDate
  -- RF-K01.2 · roles del caso
  investigador_id         UUID REFERENCES usuario(id),
  supervisor_id           UUID REFERENCES usuario(id),        -- ESI SupervisorUser
  perito_balistico_id     UUID REFERENCES usuario(id),
  -- RF-K01.3 · asignación de responsable y visibilidad
  responsable_id          UUID REFERENCES usuario(id),
  unidad_id               UUID REFERENCES unidad(id),         -- visibilidad por unidad (no hay tabla `seccion` en el modelo desplegado)
  -- RF-K01.4 · estado y marcas
  estado                  VARCHAR(30) NOT NULL DEFAULT 'abierto',  -- abierto, en_proceso, cerrado, archivado
  restringido             BOOLEAN DEFAULT FALSE,              -- ESI Restricted
  alto_perfil             BOOLEAN DEFAULT FALSE,              -- ESI HighProfile
  hit_indicator           BOOLEAN DEFAULT FALSE,              -- ESI HitIndicator
  comentario              TEXT,                               -- ESI Comment
  origen                  VARCHAR(20) DEFAULT 'manual',       -- manual | ibis
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  created_by              UUID REFERENCES usuario(id),
  deleted_at              TIMESTAMPTZ,
  UNIQUE (tenant_id, numero_caso)
);
CREATE INDEX IF NOT EXISTS idx_saec_caso_tenant        ON saec_caso(tenant_id)           WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saec_caso_tenant_estado ON saec_caso(tenant_id, estado)   WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_saec_caso_uuid_ibis ON saec_caso(tenant_id, uuid_ibis) WHERE uuid_ibis IS NOT NULL;

DROP TRIGGER IF EXISTS trg_saec_caso_updated ON saec_caso;
CREATE TRIGGER trg_saec_caso_updated BEFORE UPDATE ON saec_caso
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RF-K01.4 · comentarios del caso (hilo, no un solo campo)
CREATE TABLE IF NOT EXISTS saec_caso_comentario (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  caso_id         UUID NOT NULL REFERENCES saec_caso(id) ON DELETE CASCADE,
  texto           TEXT NOT NULL,
  autor_id        UUID REFERENCES usuario(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_saec_caso_comentario ON saec_caso_comentario(tenant_id, caso_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- RF-K02 · Elementos (armas, explosivos, evidencias)
-- RF-K04 · Banco de evidencias y almacén (ubicación, etiquetado, digitalización)
-- Campos base alineados con el bloque <Exhibit> del ESI v3.2 (Anexo C.1).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidencia (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  codigo                  VARCHAR(40) NOT NULL,               -- NUE · Número Único de Evidencia (EV-2026-NNNN)
  uuid_ibis               VARCHAR(80),                        -- ESI UUID
  caso_id                 UUID REFERENCES saec_caso(id),      -- ESI ParentUUID → caso
  exhibit_number          VARCHAR(60),                        -- ESI ExhibitNumber (CC1000, TF1003)
  -- RF-K02.3 · tipificación
  tipo                    VARCHAR(30) NOT NULL DEFAULT 'otro',  -- arma, vainilla, proyectil, explosivo, otro
  descripcion             TEXT,
  categoria_codigo        VARCHAR(40),                        -- ESI Category (code): CE=Crime Evidence, TF=Test Fire
  categoria_texto         VARCHAR(160),
  calibre_codigo          VARCHAR(40),                        -- ESI Caliber (code)
  calibre_texto           VARCHAR(160),                       -- '9 mm Parabellum'
  firing_pin_shape        VARCHAR(160),                       -- ESI FiringPinShape (code+texto aplanado)
  breech_face_class       VARCHAR(160),                       -- ESI BreechFaceClassCharacteristics
  marca                   VARCHAR(120),                       -- ESI Make
  composicion             VARCHAR(120),                       -- ESI Composition
  hit_count               INT DEFAULT 0,                      -- ESI HitIndicator (Count)
  -- Ciclo de vida
  estado                  VARCHAR(30) NOT NULL DEFAULT 'ingresada',  -- ingresada, en_analisis, analizada, almacenada, prestada, devuelta, destruida
  -- RF-K02.2 / RF-K04.4 · codificación y etiquetado
  codigo_barras           VARCHAR(60),
  -- RF-K04.1 · ubicación física (bodega/estantería)
  ubicacion               VARCHAR(120),                       -- bodega/estantería (texto, como Muestra.ubicacion)
  -- RF-K04.3 · soporte físico y digitalizado
  soporte                 VARCHAR(20) DEFAULT 'fisica',       -- fisica, digital, mixta
  documento_id            UUID,                               -- adjunto digitalizado (documento.id)
  -- Enganche con el núcleo del LIMS
  ot_id                   UUID REFERENCES orden_trabajo(id),  -- RF-K02.4 · OT creada automáticamente
  muestra_id              UUID REFERENCES muestra(id),
  cliente_id              UUID REFERENCES cliente(id),
  perito_id               UUID REFERENCES usuario(id),        -- RF-K02.4 · perito/analista asignado
  -- Procedencia / organismo
  procedencia             VARCHAR(200),                       -- incautación, hallazgo, entrega voluntaria, decomiso Aduanas…
  organismo_solicitante   VARCHAR(200),                       -- Fiscalía, PDI, DGMN, Aduanas, Policía Militar…
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  created_by              UUID REFERENCES usuario(id),
  deleted_at              TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_evidencia_tenant        ON evidencia(tenant_id)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_evidencia_tenant_estado ON evidencia(tenant_id, estado)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_evidencia_tenant_tipo   ON evidencia(tenant_id, tipo)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_evidencia_caso          ON evidencia(tenant_id, caso_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_evidencia_ubicacion     ON evidencia(tenant_id, ubicacion)    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidencia_uuid_ibis   ON evidencia(tenant_id, uuid_ibis)     WHERE uuid_ibis IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidencia_cod_barras  ON evidencia(tenant_id, codigo_barras) WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_evidencia_updated ON evidencia;
CREATE TRIGGER trg_evidencia_updated BEFORE UPDATE ON evidencia
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Arma · ficha registral específica del elemento de tipo 'arma'.
-- Se modela aparte de `evidencia` porque una misma arma puede reingresar
-- como evidencia en varios casos y tiene un ciclo registral propio (DGMN).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arma (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  evidencia_id            UUID REFERENCES evidencia(id),      -- ingreso que originó la ficha (opcional)
  serie                   VARCHAR(80),                        -- número de serie (puede venir borrado/limado)
  serie_borrada           BOOLEAN DEFAULT FALSE,
  marca                   VARCHAR(120),
  modelo                  VARCHAR(120),
  calibre                 VARCHAR(80),
  tipo                    VARCHAR(40) NOT NULL DEFAULT 'otro',   -- pistola, revolver, fusil, subfusil, escopeta, hechiza, otro
  -- Estado registral / DGMN
  estado_registral        VARCHAR(40) NOT NULL DEFAULT 'no_inscrita',  -- inscrita, no_inscrita, robada, encargo_vigente, decomisada, destruida, en_tramite
  inscripcion_dgmn        VARCHAR(60),                        -- nº de inscripción DGMN
  fecha_inscripcion_dgmn  DATE,
  propietario_registrado  VARCHAR(200),
  rut_propietario         VARCHAR(20),
  -- Operativo
  estado                  VARCHAR(30) NOT NULL DEFAULT 'en_custodia',  -- en_custodia, en_analisis, prestada, devuelta, destruida
  ubicacion               VARCHAR(120),
  observaciones           TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  created_by              UUID REFERENCES usuario(id),
  deleted_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_arma_tenant          ON arma(tenant_id)                   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_arma_tenant_estado   ON arma(tenant_id, estado_registral) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_arma_evidencia       ON arma(tenant_id, evidencia_id)     WHERE deleted_at IS NULL;
-- La serie es única por tenant salvo que esté borrada/limada (varias armas sin serie).
CREATE UNIQUE INDEX IF NOT EXISTS ux_arma_serie ON arma(tenant_id, serie)
  WHERE serie IS NOT NULL AND serie_borrada = FALSE AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_arma_updated ON arma;
CREATE TRIGGER trg_arma_updated BEFORE UPDATE ON arma
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RF-K05 · Cadena de custodia
-- RF-K05.2 exige un registro INMUTABLE y de solo lectura: el trigger de abajo
-- bloquea UPDATE y DELETE a nivel de base de datos. Por eso esta tabla NO
-- tiene `deleted_at` (un soft-delete contradiría la inmutabilidad).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidencia_movimiento (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  evidencia_id            UUID NOT NULL REFERENCES evidencia(id),
  -- RF-K05.1 · entrada, salida y cambios de ubicación
  evento                  VARCHAR(40) NOT NULL,               -- entrada, salida, cambio_ubicacion, prestamo, devolucion, analisis, destruccion
  fecha                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  desde_usuario_id        UUID REFERENCES usuario(id),
  hacia_usuario_id        UUID REFERENCES usuario(id),
  desde_organismo         VARCHAR(200),                       -- cuando el origen es externo (Fiscalía, PDI…)
  hacia_organismo         VARCHAR(200),
  ubicacion_origen        VARCHAR(120),
  ubicacion_destino       VARCHAR(120),
  motivo                  TEXT NOT NULL,
  sello_numero            VARCHAR(40),
  sello_integro           BOOLEAN,
  firma_nombre            VARCHAR(200),                       -- firma manuscrita digitalizada: quién firma
  firma_hash              VARCHAR(64),                        -- SHA-256 del acta/firma (integridad)
  firma_electronica_id    UUID,                               -- firma_electronica.id si se usó firma del LIMS
  observaciones           TEXT,
  -- RF-K09.2 · trazabilidad de la acción
  registrado_por          UUID REFERENCES usuario(id),
  ip_origen               INET,
  created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evid_mov_tenant    ON evidencia_movimiento(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evid_mov_evidencia ON evidencia_movimiento(tenant_id, evidencia_id, fecha);

-- RF-K05.2 · inmutabilidad garantizada por el motor, no solo por la aplicación.
CREATE OR REPLACE FUNCTION saec_movimiento_inmutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'RF-K05.2: la cadena de custodia es inmutable; % no permitido sobre evidencia_movimiento', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evidencia_movimiento_inmutable ON evidencia_movimiento;
CREATE TRIGGER trg_evidencia_movimiento_inmutable
  BEFORE UPDATE OR DELETE ON evidencia_movimiento
  FOR EACH ROW EXECUTE FUNCTION saec_movimiento_inmutable();

-- ------------------------------------------------------------
-- RF-K06 · Préstamo / devolución de evidencias
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidencia_prestamo (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  evidencia_id            UUID NOT NULL REFERENCES evidencia(id),
  codigo                  VARCHAR(40),                        -- PRE-2026-NNNN
  -- RF-K06.1 · formulario de solicitud
  tipo                    VARCHAR(20) NOT NULL DEFAULT 'entrega',  -- entrega | devolucion
  organismo_solicitante   VARCHAR(200) NOT NULL,              -- Fiscalía, PDI, DGMN, Tribunal…
  solicitante_nombre      VARCHAR(200) NOT NULL,
  solicitante_documento   VARCHAR(40),
  motivo                  TEXT NOT NULL,
  fecha_solicitud         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_devolucion_prevista DATE,
  -- RF-K06.2 · aprobación / rechazo
  estado                  VARCHAR(20) NOT NULL DEFAULT 'solicitado',  -- solicitado, aprobado, rechazado, entregado, devuelto
  responsable_id          UUID REFERENCES usuario(id),        -- a quien se notifica
  resuelto_por            UUID REFERENCES usuario(id),
  resuelto_at             TIMESTAMPTZ,
  motivo_rechazo          TEXT,
  -- RF-K06.3 · registro de salida/entrada
  movimiento_salida_id    UUID REFERENCES evidencia_movimiento(id),
  movimiento_retorno_id   UUID REFERENCES evidencia_movimiento(id),
  ubicacion_retorno       VARCHAR(120),
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  created_by              UUID REFERENCES usuario(id),
  deleted_at              TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_prestamo_tenant     ON evidencia_prestamo(tenant_id)                WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prestamo_evidencia  ON evidencia_prestamo(tenant_id, evidencia_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prestamo_estado     ON evidencia_prestamo(tenant_id, estado)        WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_prestamo_updated ON evidencia_prestamo;
CREATE TRIGGER trg_prestamo_updated BEFORE UPDATE ON evidencia_prestamo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RF-K03.3 / RF-K03.5 · Peritaje balístico
-- origen='ibis'   → cargado por el ETL del XML ESI.
-- origen='manual' → registro manual (elementos no balísticos: explosivos, etc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS peritaje_balistico (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  evidencia_id            UUID NOT NULL REFERENCES evidencia(id),
  origen                  VARCHAR(20) NOT NULL DEFAULT 'manual',   -- ibis | manual
  ibis_importacion_id     UUID,                               -- FK añadida más abajo (dependencia circular)
  uuid_ibis               VARCHAR(80),                        -- UUID del Exhibit en Forensic
  -- Datos balísticos del ESI
  calibre_texto           VARCHAR(160),
  firing_pin_shape        VARCHAR(160),
  breech_face_class       VARCHAR(160),
  hit_count               INT DEFAULT 0,
  resultado               VARCHAR(40),                        -- concluyente, no_concluyente, sin_coincidencia, pendiente
  conclusiones            TEXT,
  datos                   JSONB DEFAULT '{}',                 -- payload ESI completo del Exhibit (campos adicionales pendientes de cliente)
  perito_id               UUID REFERENCES usuario(id),
  fecha_peritaje          TIMESTAMPTZ DEFAULT now(),
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_peritaje_tenant    ON peritaje_balistico(tenant_id)                WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_peritaje_evidencia ON peritaje_balistico(tenant_id, evidencia_id)  WHERE deleted_at IS NULL;
-- Un peritaje IBIS por evidencia: el ETL hace UPSERT sobre esta clave.
CREATE UNIQUE INDEX IF NOT EXISTS ux_peritaje_ibis ON peritaje_balistico(tenant_id, evidencia_id)
  WHERE origen = 'ibis' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_peritaje_updated ON peritaje_balistico;
CREATE TRIGGER trg_peritaje_updated BEFORE UPDATE ON peritaje_balistico
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RF-K03 · Importación (ETL) del XML ESI v3.2 desde IBIS/Forensic
-- RF-K03.4 · control de ya procesados: UNIQUE(tenant_id, hash_sha256).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ibis_importacion (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  nombre_archivo          VARCHAR(260),                       -- archivo depositado por Forensic en el FTP
  hash_sha256             VARCHAR(64) NOT NULL,               -- huella del XML crudo (anti-reproceso)
  xml_crudo               TEXT,                               -- se conserva para reproceso/auditoría forense
  tamano_bytes            INT,
  version_esi             VARCHAR(10) DEFAULT '3.2',
  estado                  VARCHAR(20) NOT NULL DEFAULT 'procesado',  -- procesado, error, parcial, duplicado
  -- RF-K03.2 · contadores del ETL
  casos_creados           INT DEFAULT 0,
  casos_actualizados      INT DEFAULT 0,
  evidencias_creadas      INT DEFAULT 0,
  evidencias_actualizadas INT DEFAULT 0,
  hits_creados            INT DEFAULT 0,
  peritajes_creados       INT DEFAULT 0,
  eliminados              INT DEFAULT 0,                      -- RemovedCases/Exhibits/Hits aplicados
  -- RF-K03.4 · registro de errores y bitácora
  errores                 JSONB DEFAULT '[]',
  bitacora                JSONB DEFAULT '[]',
  resultado               JSONB DEFAULT '{}',                 -- resumen completo devuelto por el endpoint
  importado_por           UUID REFERENCES usuario(id),
  ip_origen               INET,
  created_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ,
  UNIQUE (tenant_id, hash_sha256)
);
CREATE INDEX IF NOT EXISTS idx_ibis_imp_tenant ON ibis_importacion(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- FK diferida de peritaje → importación (evita la dependencia circular en el CREATE).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_peritaje_ibis_importacion') THEN
    ALTER TABLE peritaje_balistico
      ADD CONSTRAINT fk_peritaje_ibis_importacion
      FOREIGN KEY (ibis_importacion_id) REFERENCES ibis_importacion(id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- RF-K03.2 · Coincidencias (Hits) balísticas cruzadas por IBIS.
-- Es la información de mayor valor del XML: correlaciona dos evidencias.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ibis_hit (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  uuid_ibis               VARCHAR(80),                        -- UUID del Hit en Forensic
  ibis_importacion_id     UUID REFERENCES ibis_importacion(id),
  -- Evidencias correlacionadas (pueden no existir aún → se guarda también el UUID crudo)
  evidencia_a_id          UUID REFERENCES evidencia(id),
  evidencia_b_id          UUID REFERENCES evidencia(id),
  uuid_evidencia_a        VARCHAR(80),
  uuid_evidencia_b        VARCHAR(80),
  caso_a_id               UUID REFERENCES saec_caso(id),
  caso_b_id               UUID REFERENCES saec_caso(id),
  score                   NUMERIC(10,3),                      -- puntuación de correlación IBIS
  estado                  VARCHAR(30) DEFAULT 'sin_confirmar', -- sin_confirmar, confirmado, descartado
  fecha_hit               TIMESTAMPTZ,
  confirmado_por          UUID REFERENCES usuario(id),
  datos                   JSONB DEFAULT '{}',                 -- payload ESI completo del Hit
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ibis_hit_tenant ON ibis_hit(tenant_id)                 WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ibis_hit_ev_a   ON ibis_hit(tenant_id, evidencia_a_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ibis_hit_ev_b   ON ibis_hit(tenant_id, evidencia_b_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ibis_hit_uuid ON ibis_hit(tenant_id, uuid_ibis) WHERE uuid_ibis IS NOT NULL;

DROP TRIGGER IF EXISTS trg_ibis_hit_updated ON ibis_hit;
CREATE TRIGGER trg_ibis_hit_updated BEFORE UPDATE ON ibis_hit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RF-K07 · Certificados con verificación pública
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saec_certificado (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  evidencia_id            UUID NOT NULL REFERENCES evidencia(id),
  codigo                  VARCHAR(40) NOT NULL,               -- CERT-SAEC-2026-NNNN
  -- RF-K07.2 · código de verificación + HASH de integridad
  codigo_verificacion     VARCHAR(24) NOT NULL,               -- código corto que se imprime en el documento
  hash_documento          VARCHAR(64) NOT NULL,               -- SHA-256 del contenido emitido
  contenido               JSONB DEFAULT '{}',                 -- snapshot inmutable de lo certificado
  documento_id            UUID,                               -- PDF renderizado (documento.id)
  estado                  VARCHAR(20) NOT NULL DEFAULT 'emitido',  -- emitido, anulado
  emitido_por             UUID REFERENCES usuario(id),
  emitido_at              TIMESTAMPTZ DEFAULT now(),
  anulado_at              TIMESTAMPTZ,
  motivo_anulacion        TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);
-- El código de verificación es la clave de la pantalla pública: único global.
CREATE UNIQUE INDEX IF NOT EXISTS ux_saec_cert_verificacion ON saec_certificado(codigo_verificacion);
CREATE INDEX IF NOT EXISTS idx_saec_cert_tenant    ON saec_certificado(tenant_id)                WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saec_cert_evidencia ON saec_certificado(tenant_id, evidencia_id)  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- RF-K08 · Integraciones externas (SOLO entrada)
-- DGMN (API/WebService asíncrono), calendario de Aduanas y notificaciones
-- a entidades (recuperadores de armas, fiscalías).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saec_integracion_evento (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  origen                  VARCHAR(30) NOT NULL,               -- dgmn, aduanas, fiscalia, pdi, ibis
  direccion               VARCHAR(20) NOT NULL DEFAULT 'entrada',  -- entrada | notificacion (salida informativa)
  tipo                    VARCHAR(60) NOT NULL,               -- consulta_inscripcion, encargo_vigente, calendario_internamiento, notificacion_entidad…
  referencia              VARCHAR(120),                       -- nº de oficio / folio externo
  evidencia_id            UUID REFERENCES evidencia(id),
  arma_id                 UUID REFERENCES arma(id),
  caso_id                 UUID REFERENCES saec_caso(id),
  -- RF-K08.2 · calendario de recepción de Aduanas / control de internamiento
  fecha_programada        TIMESTAMPTZ,
  ubicacion               VARCHAR(120),                       -- bodega de internamiento
  -- RF-K08.1 · recepción asíncrona
  payload                 JSONB DEFAULT '{}',
  estado                  VARCHAR(20) NOT NULL DEFAULT 'pendiente',  -- pendiente, procesado, error, descartado
  error_detalle           TEXT,
  procesado_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);
-- Migración idempotente: la primera versión declaró direccion VARCHAR(10), que
-- no admite el valor 'notificacion' (12). CREATE TABLE IF NOT EXISTS no corrige
-- las instalaciones ya creadas, así que se fuerza el ancho aquí (no-op si ya está).
ALTER TABLE saec_integracion_evento ALTER COLUMN direccion TYPE VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_saec_integ_tenant  ON saec_integracion_evento(tenant_id, origen, estado) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saec_integ_agenda  ON saec_integracion_evento(tenant_id, fecha_programada) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_saec_integ_updated ON saec_integracion_evento;
CREATE TRIGGER trg_saec_integ_updated BEFORE UPDATE ON saec_integracion_evento
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RF-K09.2 · Auditoría SAEC · cada acción con usuario, fecha/hora e IP.
-- Append-only (mismo criterio de inmutabilidad que la cadena de custodia).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saec_auditoria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  entidad         VARCHAR(40) NOT NULL,                       -- evidencia, arma, caso, prestamo, certificado, ibis
  entidad_id      UUID,
  accion          VARCHAR(40) NOT NULL,                       -- crear, editar, eliminar, custodiar, importar, emitir, aprobar, rechazar
  usuario_id      UUID REFERENCES usuario(id),
  usuario_nombre  VARCHAR(200),
  ip_origen       INET,
  detalle         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saec_audit_tenant  ON saec_auditoria(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saec_audit_entidad ON saec_auditoria(tenant_id, entidad, entidad_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_saec_auditoria_inmutable ON saec_auditoria;
CREATE TRIGGER trg_saec_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON saec_auditoria
  FOR EACH ROW EXECUTE FUNCTION saec_movimiento_inmutable();

-- ============================================================
-- RBAC · permisos propios del SAEC
-- El bloque RF-K no está cubierto por los permisos sembrados en seed_rbac.sql
-- (que son del LIMS analítico), así que el módulo declara los suyos.
-- ============================================================
-- El id se da explícito: las tablas del núcleo vienen de Prisma y NO tienen
-- DEFAULT gen_random_uuid() (los UUID los genera la aplicación).
INSERT INTO permiso (id, codigo, modulo, accion, descripcion)
SELECT gen_random_uuid(), v.codigo, v.modulo, v.accion, v.descripcion
FROM (VALUES
  ('evidencia.ver',        'evidencia',  'ver',        'Ver evidencias y elementos del SAEC'),
  ('evidencia.crear',      'evidencia',  'crear',      'Registrar el ingreso de evidencias/elementos'),
  ('evidencia.editar',     'evidencia',  'editar',     'Editar la ficha de una evidencia/elemento'),
  ('evidencia.eliminar',   'evidencia',  'eliminar',   'Dar de baja (soft-delete) una evidencia'),
  ('evidencia.custodiar',  'evidencia',  'custodiar',  'Registrar movimientos de la cadena de custodia'),
  ('evidencia.prestar',    'evidencia',  'prestar',    'Solicitar préstamo/devolución de evidencias'),
  ('evidencia.aprobar',    'evidencia',  'aprobar',    'Aprobar o rechazar solicitudes de préstamo/devolución'),
  ('arma.ver',             'arma',       'ver',        'Ver el registro de armas'),
  ('arma.crear',           'arma',       'crear',      'Registrar un arma'),
  ('arma.editar',          'arma',       'editar',     'Editar la ficha registral de un arma (DGMN)'),
  ('arma.eliminar',        'arma',       'eliminar',   'Dar de baja (soft-delete) una ficha de arma'),
  ('caso.ver',             'caso',       'ver',        'Ver casos SAEC'),
  ('caso.crear',           'caso',       'crear',      'Crear casos SAEC'),
  ('caso.editar',          'caso',       'editar',     'Editar casos SAEC y asignar responsables'),
  ('caso.eliminar',        'caso',       'eliminar',   'Dar de baja (soft-delete) un caso SAEC'),
  ('ibis.ver',             'ibis',       'ver',        'Consultar la bitácora de importaciones IBIS'),
  ('ibis.importar',        'ibis',       'importar',   'Ejecutar la importación ETL del XML ESI de IBIS/Forensic'),
  ('peritaje.registrar',   'peritaje',   'registrar',  'Registrar manualmente resultados de peritaje (no balísticos)'),
  ('saec.certificado.emitir','certificado','emitir',   'Emitir certificados SAEC con código de verificación')
) AS v(codigo, modulo, accion, descripcion)
ON CONFLICT (codigo) DO NOTHING;

-- Matriz rol_permiso del SAEC (tenant IDIC), en la línea de seed_rbac.sql.
-- Criterio: ANALISTA_SR actúa como perito de balística; RECEPCION y TECNICO
-- mueven evidencias en bodega pero no aprueban préstamos ni emiten certificados.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM (VALUES
  ('SUPERADMIN','evidencia.ver'), ('SUPERADMIN','evidencia.crear'), ('SUPERADMIN','evidencia.editar'),
  ('SUPERADMIN','evidencia.eliminar'), ('SUPERADMIN','evidencia.custodiar'), ('SUPERADMIN','evidencia.prestar'),
  ('SUPERADMIN','evidencia.aprobar'), ('SUPERADMIN','arma.ver'), ('SUPERADMIN','arma.crear'),
  ('SUPERADMIN','arma.editar'), ('SUPERADMIN','arma.eliminar'), ('SUPERADMIN','caso.ver'),
  ('SUPERADMIN','caso.crear'), ('SUPERADMIN','caso.editar'), ('SUPERADMIN','caso.eliminar'),
  ('SUPERADMIN','ibis.ver'), ('SUPERADMIN','ibis.importar'), ('SUPERADMIN','peritaje.registrar'),
  ('SUPERADMIN','saec.certificado.emitir'),

  ('ADMIN','evidencia.ver'), ('ADMIN','evidencia.crear'), ('ADMIN','evidencia.editar'),
  ('ADMIN','evidencia.eliminar'), ('ADMIN','evidencia.custodiar'), ('ADMIN','evidencia.prestar'),
  ('ADMIN','evidencia.aprobar'), ('ADMIN','arma.ver'), ('ADMIN','arma.crear'), ('ADMIN','arma.editar'),
  ('ADMIN','arma.eliminar'), ('ADMIN','caso.ver'), ('ADMIN','caso.crear'), ('ADMIN','caso.editar'),
  ('ADMIN','caso.eliminar'), ('ADMIN','ibis.ver'), ('ADMIN','ibis.importar'), ('ADMIN','peritaje.registrar'),
  ('ADMIN','saec.certificado.emitir'),

  ('DIRECTOR','evidencia.ver'), ('DIRECTOR','evidencia.aprobar'), ('DIRECTOR','arma.ver'),
  ('DIRECTOR','caso.ver'), ('DIRECTOR','caso.editar'), ('DIRECTOR','ibis.ver'),
  ('DIRECTOR','saec.certificado.emitir'),

  ('JEFE_LAB','evidencia.ver'), ('JEFE_LAB','evidencia.crear'), ('JEFE_LAB','evidencia.editar'),
  ('JEFE_LAB','evidencia.custodiar'), ('JEFE_LAB','evidencia.prestar'), ('JEFE_LAB','evidencia.aprobar'),
  ('JEFE_LAB','arma.ver'), ('JEFE_LAB','arma.crear'), ('JEFE_LAB','arma.editar'),
  ('JEFE_LAB','caso.ver'), ('JEFE_LAB','caso.crear'), ('JEFE_LAB','caso.editar'),
  ('JEFE_LAB','ibis.ver'), ('JEFE_LAB','ibis.importar'), ('JEFE_LAB','peritaje.registrar'),
  ('JEFE_LAB','saec.certificado.emitir'),

  -- Perito de balística
  ('ANALISTA_SR','evidencia.ver'), ('ANALISTA_SR','evidencia.editar'), ('ANALISTA_SR','evidencia.custodiar'),
  ('ANALISTA_SR','arma.ver'), ('ANALISTA_SR','arma.editar'), ('ANALISTA_SR','caso.ver'),
  ('ANALISTA_SR','ibis.ver'), ('ANALISTA_SR','ibis.importar'), ('ANALISTA_SR','peritaje.registrar'),

  ('ANALISTA','evidencia.ver'), ('ANALISTA','evidencia.custodiar'), ('ANALISTA','arma.ver'),
  ('ANALISTA','caso.ver'), ('ANALISTA','ibis.ver'), ('ANALISTA','peritaje.registrar'),

  ('TECNICO','evidencia.ver'), ('TECNICO','evidencia.custodiar'), ('TECNICO','arma.ver'),
  ('TECNICO','caso.ver'),

  ('RECEPCION','evidencia.ver'), ('RECEPCION','evidencia.crear'), ('RECEPCION','evidencia.custodiar'),
  ('RECEPCION','evidencia.prestar'), ('RECEPCION','arma.ver'), ('RECEPCION','arma.crear'),
  ('RECEPCION','caso.ver'), ('RECEPCION','caso.crear'),

  ('CALIDAD','evidencia.ver'), ('CALIDAD','arma.ver'), ('CALIDAD','caso.ver'), ('CALIDAD','ibis.ver'),

  ('LECTOR','evidencia.ver'), ('LECTOR','arma.ver'), ('LECTOR','caso.ver')
) AS m(rol_cod, perm_cod)
JOIN rol r     ON r.codigo = m.rol_cod AND r.tenant_id = (SELECT id FROM tenant WHERE codigo = 'IDIC')
JOIN permiso p ON p.codigo = m.perm_cod
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED idempotente · tenant IDIC
-- La unicidad de (tenant_id, numero_caso) / (tenant_id, codigo) hace
-- idempotente el re-run.
-- ============================================================

-- 2 casos SAEC
INSERT INTO saec_caso
  (tenant_id, numero_caso, uuid_ibis, agencia_origen_ref, agencia_origen_nombre,
   tipo_evento_codigo, tipo_evento_texto, fecha_ocurrencia, estado, restringido, alto_perfil, comentario, origen)
SELECT t.id, v.num, v.uuid_ibis, v.ag_ref, v.ag_nom, v.ev_cod, v.ev_txt, v.fecha, v.estado, v.restr, v.perfil, v.coment, v.origen
FROM tenant t, (VALUES
  ('CASO-2026-0001','IBIS-CASE-QQWW1001','Ministerio Público','Fiscalía Local de Santiago Centro',
   'HOM','Homicidio', TIMESTAMPTZ '2026-03-12 22:40:00-03', 'en_proceso', FALSE, TRUE,
   'Homicidio con arma de fuego en la vía pública. Se recuperan 4 vainillas y 1 proyectil.', 'manual'),
  ('CASO-2026-0002','IBIS-CASE-QQWW1002','Policía Militar','Destacamento de Policía Militar Nº1',
   'DRA','Drogas y armas', TIMESTAMPTZ '2026-04-02 09:15:00-03', 'abierto', FALSE, FALSE,
   'Incautación en control vehicular: 1 pistola con serie limada y munición.', 'manual')
) AS v(num, uuid_ibis, ag_ref, ag_nom, ev_cod, ev_txt, fecha, estado, restr, perfil, coment, origen)
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, numero_caso) DO NOTHING;

-- 6 evidencias/elementos
INSERT INTO evidencia
  (tenant_id, codigo, uuid_ibis, caso_id, exhibit_number, tipo, descripcion,
   categoria_codigo, categoria_texto, calibre_codigo, calibre_texto,
   firing_pin_shape, breech_face_class, marca, composicion, hit_count,
   estado, codigo_barras, soporte, procedencia, organismo_solicitante)
SELECT
  t.id, v.codigo, v.uuid_ibis,
  (SELECT c.id FROM saec_caso c WHERE c.tenant_id = t.id AND c.numero_caso = v.caso AND c.deleted_at IS NULL LIMIT 1),
  v.exhibit, v.tipo, v.descripcion, v.cat_cod, v.cat_txt, v.cal_cod, v.cal_txt,
  v.fps, v.bfc, v.marca, v.comp, v.hits, v.estado, v.barras, v.soporte, v.proc, v.org
FROM tenant t, (VALUES
  ('EV-2026-0001','IBIS-EXH-CC1000','CASO-2026-0001','CC1000','vainilla',
   'Vainilla percutada recuperada en el sitio del suceso, calle Merced 1120.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum','Circular hemisférico','Paralelas verticales',
   'PMC','Latón', 2, 'analizada','7801234000018','fisica','Levantamiento en sitio del suceso','Ministerio Público'),
  ('EV-2026-0002','IBIS-EXH-CC1001','CASO-2026-0001','CC1001','vainilla',
   'Vainilla percutada recuperada a 3 m de la anterior.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum','Circular hemisférico','Paralelas verticales',
   'PMC','Latón', 2, 'analizada','7801234000025','fisica','Levantamiento en sitio del suceso','Ministerio Público'),
  ('EV-2026-0003','IBIS-EXH-BU2000','CASO-2026-0001','BU2000','proyectil',
   'Proyectil deformado extraído durante la autopsia.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum',NULL,'6 estrías dextrógiras',
   'Desconocida','Plomo encamisado', 1, 'analizada','7801234000032','fisica','Autopsia SML','Ministerio Público'),
  ('EV-2026-0004','IBIS-EXH-TF1003','CASO-2026-0002','TF1003','vainilla',
   'Vainilla de disparo de prueba (test fire) del arma incautada EV-2026-0005.',
   'TF','Test Fire','9MMP','9 mm Parabellum','Circular hemisférico','Paralelas verticales',
   'CBC','Latón', 1, 'analizada','7801234000049','fisica','Disparo de prueba en polígono IDIC','IDIC'),
  ('EV-2026-0005',NULL,'CASO-2026-0002','AR1000','arma',
   'Pistola semiautomática incautada en control vehicular, con número de serie limado.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum',NULL,NULL,
   'Glock',NULL, 0, 'en_analisis','7801234000056','fisica','Incautación en control vehicular','Policía Militar'),
  ('EV-2026-0006',NULL,'CASO-2026-0002','EX3000','explosivo',
   'Artefacto explosivo improvisado desactivado; peritaje no balístico (registro manual de resultados).',
   'CE','Crime Evidence',NULL,NULL,NULL,NULL,
   NULL,'Nitrato de amonio / combustible', 0, 'ingresada','7801234000063','mixta','Hallazgo en inmueble','Fiscalía Local')
) AS v(codigo, uuid_ibis, caso, exhibit, tipo, descripcion, cat_cod, cat_txt, cal_cod, cal_txt,
       fps, bfc, marca, comp, hits, estado, barras, soporte, proc, org)
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- 3 fichas de arma (una ligada al elemento EV-2026-0005)
INSERT INTO arma
  (tenant_id, evidencia_id, serie, serie_borrada, marca, modelo, calibre, tipo,
   estado_registral, inscripcion_dgmn, fecha_inscripcion_dgmn, propietario_registrado, rut_propietario,
   estado, observaciones)
SELECT
  t.id,
  (SELECT e.id FROM evidencia e WHERE e.tenant_id = t.id AND e.codigo = v.ev AND e.deleted_at IS NULL LIMIT 1),
  v.serie, v.borrada, v.marca, v.modelo, v.calibre, v.tipo, v.reg, v.dgmn, v.fdgmn, v.prop, v.rut, v.estado, v.obs
FROM tenant t, (VALUES
  ('EV-2026-0005', NULL, TRUE, 'Glock','17 Gen4','9 mm Parabellum','pistola',
   'no_inscrita', NULL, NULL::date, NULL, NULL, 'en_analisis',
   'Serie limada; se solicita restauración de numeración por ataque químico. Consulta DGMN pendiente.'),
  (NULL, 'FN-4471290', FALSE, 'FN Herstal','FNP-9','9 mm Parabellum','pistola',
   'inscrita', 'DGMN-2019-114872', DATE '2019-07-04', 'Juan Pérez Soto', '13.884.221-5', 'en_custodia',
   'Arma inscrita, ingresada por encargo vigente comunicado por la DGMN.'),
  (NULL, 'HECHIZA-0031', FALSE, 'Artesanal','Hechiza','12 mm','hechiza',
   'decomisada', NULL, NULL::date, NULL, NULL, 'en_custodia',
   'Arma hechiza decomisada por Aduanas; pendiente de destrucción autorizada.')
) AS v(ev, serie, borrada, marca, modelo, calibre, tipo, reg, dgmn, fdgmn, prop, rut, estado, obs)
WHERE t.codigo = 'IDIC'
  AND NOT EXISTS (
    SELECT 1 FROM arma a
     WHERE a.tenant_id = t.id
       AND a.marca = v.marca AND a.modelo = v.modelo
       AND COALESCE(a.serie, '~') = COALESCE(v.serie, '~')
  );

-- Cadena de custodia inicial de las evidencias sembradas (entrada a bodega).
-- Idempotente por NOT EXISTS: la tabla es inmutable, no admite ON CONFLICT DO UPDATE.
INSERT INTO evidencia_movimiento
  (tenant_id, evidencia_id, evento, fecha, desde_organismo, hacia_organismo, motivo, sello_numero, sello_integro, firma_nombre)
SELECT t.id, e.id, 'entrada', e.created_at, e.organismo_solicitante, 'IDIC · Bodega de evidencias',
       'Ingreso inicial de la evidencia al banco del SAEC (acta de recepción).',
       'SELLO-' || right(e.codigo, 4), TRUE, 'Suboficial de guardia · Recepción SAEC'
FROM tenant t
JOIN evidencia e ON e.tenant_id = t.id AND e.deleted_at IS NULL
WHERE t.codigo = 'IDIC'
  AND e.codigo LIKE 'EV-2026-%'
  AND NOT EXISTS (
    SELECT 1 FROM evidencia_movimiento m WHERE m.evidencia_id = e.id AND m.evento = 'entrada'
  );

COMMIT;

-- Verificación:
-- SELECT 'casos', count(*) FROM saec_caso UNION ALL
-- SELECT 'evidencias', count(*) FROM evidencia UNION ALL
-- SELECT 'armas', count(*) FROM arma UNION ALL
-- SELECT 'movimientos', count(*) FROM evidencia_movimiento;
