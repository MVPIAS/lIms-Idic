-- =============================================================================
-- LIMS IDIC · Equipos, calibración y cadena de custodia de muestras
-- Cubre RF-D04 (equipos y condiciones) y RF-C02 (cadena de custodia) del SRS
-- `Requerimientos_LIMS_IDIC_Aiuken.docx`, ambos [MVP] y ambos exigidos por la
-- NCh-ISO/IEC 17025.
--
--   RF-D04.1  Registrar el equipo usado en cada resultado.
--   RF-D04.2  Bloquear el registro si la calibración del equipo está vencida.
--   RF-D04.3  Registrar condiciones ambientales (T°, HR) cuando aplique.
--   RF-C02.1  Trazabilidad de quién, cuándo y dónde sobre cada muestra.
--   RF-C02.2  Registro de transferencias entre responsables.
--   RF-C02.3  Gestión de retención y disposición final de la muestra.
--
-- IDEMPOTENTE: se puede aplicar N veces sin efecto adicional.
--   psql -U lims -d lims_idic -f packages/db/equipos_custodia.sql
--
-- -----------------------------------------------------------------------------
-- NOTA SOBRE `schema.sql` (leer antes de tocar este archivo)
-- -----------------------------------------------------------------------------
-- `packages/db/schema.sql` YA declara `equipo`, `calibracion` y `cadena_custodia`,
-- pero NO está aplicado en la base real: la BD desplegada la genera Prisma y solo
-- tiene 44 tablas, ninguna de las tres. Es la misma deriva "schema Prisma ↔ BD"
-- que documenta SECURITY_AUDIT.md (hallazgo #2).
--
-- Para funcionar en LOS DOS mundos (BD Prisma actual, y BD con schema.sql
-- aplicado algún día) este script:
--   1. usa CREATE TABLE IF NOT EXISTS con los NOMBRES DE COLUMNA DE schema.sql
--      cuando la columna ya está prevista allí (no se duplica nada), y
--   2. añade lo que falta con ADD COLUMN IF NOT EXISTS.
--
-- Mapeo nombre-pedido → columna-real (se reutiliza la de schema.sql):
--   marca                     → equipo.fabricante
--   fecha_proxima_calibracion → equipo.proxima_calibracion
--   vigencia_hasta            → calibracion.proxima_fecha   (misma semántica:
--                               fecha hasta la que la calibración es válida)
--   proveedor/laboratorio     → calibracion.ejecutada_por
--
-- `equipo.ubicacion` se declara VARCHAR y NO FK a `ubicacion`: esa tabla existe
-- en schema.sql pero no en la BD real (`muestra.ubicacion` ya es VARCHAR(80) por
-- el mismo motivo). Un FK aquí rompería el despliegue actual.
--
-- Custodia de MUESTRAS = `muestra_custodia` (este archivo). La custodia de
-- EVIDENCIAS forenses es RF-K05 [SAEC · track aparte] y va en el módulo SAEC.
-- `schema.sql:cadena_custodia` es el antecedente en papel de esta tabla; si algún
-- día se aplica schema.sql habrá que decidir cuál de las dos sobrevive (ver el
-- informe de entrega).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1) EQUIPO
-- =============================================================================
CREATE TABLE IF NOT EXISTS equipo (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenant(id),
  codigo                   VARCHAR(40)  NOT NULL,
  nombre                   VARCHAR(200) NOT NULL,
  descripcion              TEXT,
  fabricante               VARCHAR(120),            -- "marca"
  modelo                   VARCHAR(120),
  serie                    VARCHAR(120),
  ubicacion                VARCHAR(120),
  unidad_id                UUID REFERENCES unidad(id),
  estado                   VARCHAR(30)  NOT NULL DEFAULT 'operativo',
  fecha_ultima_calibracion DATE,
  proxima_calibracion      DATE,                    -- "fecha_proxima_calibracion"
  responsable_id           UUID REFERENCES usuario(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ
);

-- Columnas que schema.sql no trae (o que trae con otro nombre/tipo).
ALTER TABLE equipo ADD COLUMN IF NOT EXISTS nombre                   VARCHAR(200);
ALTER TABLE equipo ADD COLUMN IF NOT EXISTS descripcion              TEXT;
ALTER TABLE equipo ADD COLUMN IF NOT EXISTS ubicacion                VARCHAR(120);
ALTER TABLE equipo ADD COLUMN IF NOT EXISTS fecha_ultima_calibracion DATE;
ALTER TABLE equipo ADD COLUMN IF NOT EXISTS deleted_at               TIMESTAMPTZ;
ALTER TABLE equipo ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE equipo ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ NOT NULL DEFAULT now();

-- Si la tabla vino de schema.sql, `nombre` no existía y `descripcion` era el
-- rótulo obligatorio: se rellena `nombre` desde `descripcion` antes de exigir NOT NULL.
UPDATE equipo SET nombre = LEFT(COALESCE(descripcion, codigo), 200) WHERE nombre IS NULL;

DO $$ BEGIN
  ALTER TABLE equipo ALTER COLUMN nombre SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE equipo ADD CONSTRAINT equipo_tenant_codigo_key UNIQUE (tenant_id, codigo);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_equipo_tenant           ON equipo(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipo_tenant_estado    ON equipo(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_equipo_prox_calibracion ON equipo(tenant_id, proxima_calibracion);

COMMENT ON TABLE  equipo IS 'RF-D04 · Equipos de laboratorio sujetos a calibración (17025).';
COMMENT ON COLUMN equipo.estado IS 'operativo | en_calibracion | fuera_servicio (el vocabulario lo valida Zod en la API).';
COMMENT ON COLUMN equipo.proxima_calibracion IS 'Fecha hasta la que el equipo está calibrado. < CURRENT_DATE => calibración VENCIDA => el equipo NO es apto (RF-D04.2).';

-- =============================================================================
-- 2) CALIBRACION
-- =============================================================================
CREATE TABLE IF NOT EXISTS calibracion (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenant(id),
  equipo_id          UUID NOT NULL REFERENCES equipo(id),
  fecha              DATE NOT NULL,
  ejecutada_por      VARCHAR(200),                  -- proveedor / laboratorio de calibración
  norma_calibracion  VARCHAR(120),
  certificado_ref    VARCHAR(120),                  -- nº de certificado del proveedor
  resultado          VARCHAR(30),                   -- conforme | no_conforme | conforme_con_obs
  proxima_fecha      DATE,                          -- "vigencia_hasta"
  observaciones      TEXT,
  registrada_por     UUID REFERENCES usuario(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

-- schema.sql no trae tenant_id, certificado_ref, registrada_por ni deleted_at.
ALTER TABLE calibracion ADD COLUMN IF NOT EXISTS tenant_id       UUID REFERENCES tenant(id);
ALTER TABLE calibracion ADD COLUMN IF NOT EXISTS certificado_ref VARCHAR(120);
ALTER TABLE calibracion ADD COLUMN IF NOT EXISTS registrada_por  UUID REFERENCES usuario(id);
ALTER TABLE calibracion ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;
ALTER TABLE calibracion ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now();

-- Rellena tenant_id heredándolo del equipo (filas preexistentes) y lo hace NOT NULL.
UPDATE calibracion c SET tenant_id = e.tenant_id
  FROM equipo e WHERE e.id = c.equipo_id AND c.tenant_id IS NULL;

DO $$ BEGIN
  ALTER TABLE calibracion ALTER COLUMN tenant_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

-- Identidad natural del seed: un certificado no se registra dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calibracion_certificado
  ON calibracion(tenant_id, certificado_ref) WHERE certificado_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calibracion_tenant      ON calibracion(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_calibracion_equipo_fecha ON calibracion(equipo_id, fecha DESC);

COMMENT ON TABLE  calibracion IS 'RF-D04 · Historial de calibraciones por equipo. Fuente de verdad de la vigencia.';
COMMENT ON COLUMN calibracion.proxima_fecha IS 'Vigencia hasta. Al registrar una calibración CONFORME se copia a equipo.proxima_calibracion.';

-- =============================================================================
-- 3) MUESTRA_CUSTODIA · cadena de custodia de muestras (RF-C02)
-- Append-only: sin UPDATE ni DELETE desde la API. Cada registro encadena el hash
-- del anterior de la MISMA muestra (hash_prev) => la cadena es a prueba de
-- manipulación: alterar un eslabón invalida todos los posteriores.
-- =============================================================================
CREATE TABLE IF NOT EXISTS muestra_custodia (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  muestra_id        UUID NOT NULL REFERENCES muestra(id),
  evento            VARCHAR(40) NOT NULL DEFAULT 'transferencia',
  de_usuario_id     UUID REFERENCES usuario(id),
  a_usuario_id      UUID REFERENCES usuario(id),
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo            TEXT,
  ubicacion_origen  VARCHAR(120),
  ubicacion_destino VARCHAR(120),
  temp_celsius      NUMERIC(5,2),                   -- RF-D04.3 / condiciones de traslado
  humedad_pct       NUMERIC(5,2),
  sello_numero      VARCHAR(40),
  sello_integro     BOOLEAN,
  observaciones     TEXT,
  registrado_por    UUID REFERENCES usuario(id),
  hash_prev         VARCHAR(64),                    -- hash del eslabón anterior de esta muestra
  hash_registro     VARCHAR(64),                    -- sha256(hash_prev || payload canónico)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

ALTER TABLE muestra_custodia ADD COLUMN IF NOT EXISTS hash_prev     VARCHAR(64);
ALTER TABLE muestra_custodia ADD COLUMN IF NOT EXISTS hash_registro VARCHAR(64);
ALTER TABLE muestra_custodia ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_custodia_tenant        ON muestra_custodia(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_custodia_muestra_fecha ON muestra_custodia(muestra_id, fecha ASC);
CREATE INDEX IF NOT EXISTS idx_custodia_tenant_fecha  ON muestra_custodia(tenant_id, fecha DESC);

COMMENT ON TABLE  muestra_custodia IS 'RF-C02 · Cadena de custodia de MUESTRAS, append-only y encadenada por hash. La custodia de evidencias forenses (RF-K05) vive en el módulo SAEC.';
COMMENT ON COLUMN muestra_custodia.evento IS 'recepcion | traslado | preparacion | analisis | almacenamiento | transferencia | devolucion | destruccion (RF-C02.3: devolucion/destruccion = disposición final).';
COMMENT ON COLUMN muestra_custodia.hash_registro IS 'SHA-256 del eslabón. Encadena hash_prev => manipular un registro invalida la cadena posterior.';

-- =============================================================================
-- 4) PERMISOS (RBAC)
-- La tabla `permiso` está VACÍA en la BD real (el admin pasa por el bypass
-- SUPERADMIN de PermisoGuard), así que `equipo.ver`/`equipo.gestionar`/
-- `muestra.transferir` — que seed_rbac.sql da por sembrados — hay que sembrarlos.
-- Se usan los códigos YA previstos en seed_rbac.sql; no se inventa ninguno.
-- =============================================================================
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'equipo.ver',        'equipo',  'ver',        'Ver equipos, su estado y su historial de calibración'),
  (gen_random_uuid(), 'equipo.gestionar',  'equipo',  'gestionar',  'Alta/edición/baja de equipos y registro de calibraciones'),
  (gen_random_uuid(), 'muestra.ver',       'muestra', 'ver',        'Ver muestras y su cadena de custodia'),
  (gen_random_uuid(), 'muestra.transferir','muestra', 'transferir', 'Registrar traspasos en la cadena de custodia de una muestra')
ON CONFLICT (codigo) DO NOTHING;

-- Matriz rol→permiso. OJO: se usan los códigos de rol REALES de la BD
-- (JEFELAB / JEFEDCO), no los de seed_rbac.sql (JEFE_LAB / ADMIN / TECNICO),
-- que no existen. Los roles que no existan se ignoran por el JOIN.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('SUPERADMIN','equipo.ver'),
    ('SUPERADMIN','equipo.gestionar'),
    ('SUPERADMIN','muestra.ver'),
    ('SUPERADMIN','muestra.transferir'),
    ('DIRECTOR','equipo.ver'),
    ('DIRECTOR','muestra.ver'),
    ('JEFEDCO','equipo.ver'),
    ('JEFEDCO','muestra.ver'),
    ('JEFEDCO','muestra.transferir'),
    ('JEFELAB','equipo.ver'),
    ('JEFELAB','equipo.gestionar'),
    ('JEFELAB','muestra.ver'),
    ('JEFELAB','muestra.transferir'),
    ('CALIDAD','equipo.ver'),
    ('CALIDAD','equipo.gestionar'),
    ('CALIDAD','muestra.ver'),
    ('ANALISTA_SR','equipo.ver'),
    ('ANALISTA_SR','muestra.ver'),
    ('ANALISTA_SR','muestra.transferir'),
    ('ANALISTA','equipo.ver'),
    ('ANALISTA','muestra.ver'),
    ('ANALISTA','muestra.transferir'),
    ('RECEPCION','muestra.ver'),
    ('RECEPCION','muestra.transferir'),
    ('LECTOR','equipo.ver'),
    ('LECTOR','muestra.ver')
  ) AS m(rol_codigo, permiso_codigo)
  JOIN rol     r ON r.codigo = m.rol_codigo
  JOIN permiso p ON p.codigo = m.permiso_codigo
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- =============================================================================
-- 5) SEED · 8 equipos del tenant IDIC
-- Fechas RELATIVAS a CURRENT_DATE para que la demo del bloqueo por calibración
-- vencida funcione siempre, se aplique el seed el día que se aplique:
--   · EQ-BAL-001 (LQC) y EQ-MUF-001 (LEM) => VENCIDOS (proxima_calibracion pasada)
--   · EQ-PHM-001                          => fuera_servicio (tampoco es apto)
--   · EQ-FTIR-001                         => en_calibracion (tampoco es apto)
--   · el resto                            => operativos y vigentes
-- =============================================================================
INSERT INTO equipo (
  tenant_id, codigo, nombre, descripcion, fabricante, modelo, serie,
  ubicacion, unidad_id, estado, fecha_ultima_calibracion, proxima_calibracion, responsable_id
)
SELECT
  t.id, v.codigo, v.nombre, v.descripcion, v.fabricante, v.modelo, v.serie,
  v.ubicacion,
  (SELECT u.id FROM unidad u WHERE u.tenant_id = t.id AND u.codigo = v.unidad_codigo LIMIT 1),
  v.estado,
  CURRENT_DATE + (v.ultima_offset || ' days')::interval,
  CURRENT_DATE + (v.proxima_offset || ' days')::interval,
  (SELECT us.id FROM usuario us WHERE us.tenant_id = t.id AND us.username = v.responsable LIMIT 1)
FROM tenant t
CROSS JOIN (VALUES
  ('EQ-HPLC-001','Cromatógrafo líquido HPLC','Cromatógrafo de líquidos de alta resolución con detector DAD','Agilent','1260 Infinity II','DEAAB12345','LQC · Sala instrumental','LQC','operativo',            -155, 210, 'm.gonzalez'),
  ('EQ-GCMS-001','Cromatógrafo de gases GC-MS','Cromatógrafo de gases acoplado a espectrómetro de masas','Shimadzu','GCMS-QP2020 NX','O2091500321','LQC · Sala instrumental','LQC','operativo',                 -95, 270, 'm.gonzalez'),
  ('EQ-BAL-001','Balanza analítica 0,1 mg','Balanza analítica de precisión, cámara de pesaje antiestática','Mettler Toledo','XPR205','B845102934','LQC · Sala de pesaje','LQC','operativo',                    -400, -35, 'm.gonzalez'),
  ('EQ-FTIR-001','Espectrofotómetro FTIR','Espectrofotómetro infrarrojo por transformada de Fourier con ATR','PerkinElmer','Spectrum Two','108772','LQA · Laboratorio químico','LQA','en_calibracion',          -180, 185, 'r.munoz'),
  ('EQ-MUF-001','Horno mufla 1200 °C','Horno mufla para calcinación y ensayos de cenizas','Nabertherm','LT 15/12','N221904471','LEM · Sala de hornos','LEM','operativo',                                       -430, -62, 'r.munoz'),
  ('EQ-EST-001','Estufa de secado 250 °C','Estufa de convección forzada para secado y desecación','Memmert','UF110','M2210447','LCC · Sala de acondicionamiento','LCC','operativo',                           -120, 245, 'j.soto'),
  ('EQ-PHM-001','pH-metro de sobremesa','pH-metro con electrodo combinado y compensación automática de T°','Hanna Instruments','HI5221','H51120087','LQA · Laboratorio químico','LQA','fuera_servicio',        -210, 155, 'r.munoz'),
  ('EQ-DUR-001','Durómetro Shore A/D','Durómetro digital para elastómeros y suelas','Instron','S1-Shore-A','IN774120','LCC · Sala de ensayos físicos','LCC','operativo',                                       -70, 295, 'j.soto')
) AS v(codigo, nombre, descripcion, fabricante, modelo, serie, ubicacion, unidad_codigo, estado, ultima_offset, proxima_offset, responsable)
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- =============================================================================
-- 6) SEED · calibraciones (historial coherente con el estado del equipo)
-- `proxima_fecha` de la ÚLTIMA calibración == `equipo.proxima_calibracion`.
-- =============================================================================
INSERT INTO calibracion (
  tenant_id, equipo_id, fecha, ejecutada_por, norma_calibracion,
  certificado_ref, resultado, proxima_fecha, observaciones, registrada_por
)
SELECT
  e.tenant_id, e.id,
  CURRENT_DATE + (v.fecha_offset || ' days')::interval,
  v.ejecutada_por, v.norma, v.certificado_ref, v.resultado,
  CURRENT_DATE + (v.proxima_offset || ' days')::interval,
  v.observaciones,
  (SELECT us.id FROM usuario us WHERE us.tenant_id = e.tenant_id AND us.username = 'm.gonzalez' LIMIT 1)
FROM equipo e
JOIN (VALUES
  -- equipo        fecha  proveedor                         norma                certificado         resultado            proxima  observaciones
  ('EQ-HPLC-001',  -520, 'Lab. Metrología Aplicada Ltda.',  'NCh-ISO/IEC 17025', 'CAL-2024-HPLC-118', 'conforme',            -155, 'Verificación de caudal y linealidad del DAD dentro de tolerancia.'),
  ('EQ-HPLC-001',  -155, 'Lab. Metrología Aplicada Ltda.',  'NCh-ISO/IEC 17025', 'CAL-2025-HPLC-402', 'conforme',             210, 'Calibración anual. Sin desviaciones.'),
  ('EQ-GCMS-001',  -460, 'CESMEC S.A.',                     'NCh-ISO/IEC 17025', 'CAL-2024-GCMS-077', 'conforme_con_obs',     -95, 'Se recomienda reemplazo del septum en la próxima mantención.'),
  ('EQ-GCMS-001',   -95, 'CESMEC S.A.',                     'NCh-ISO/IEC 17025', 'CAL-2025-GCMS-311', 'conforme',             270, 'Sintonía del cuadrupolo conforme. Sensibilidad OK.'),
  -- VENCIDO: última calibración conforme pero su vigencia expiró hace 35 días.
  ('EQ-BAL-001',   -765, 'Lab. Metrología Aplicada Ltda.',  'OIML R76 / NCh2103','CAL-2023-BAL-021',  'conforme',            -400, 'Calibración con pesas patrón clase E2.'),
  ('EQ-BAL-001',   -400, 'Lab. Metrología Aplicada Ltda.',  'OIML R76 / NCh2103','CAL-2024-BAL-233',  'conforme',             -35, 'VIGENCIA EXPIRADA: recalibración pendiente. Equipo NO apto para ensayo.'),
  ('EQ-FTIR-001',  -180, 'PerkinElmer Chile SpA',           'NCh-ISO/IEC 17025', 'CAL-2025-FTIR-014', 'conforme',             185, 'Verificación con patrón de poliestireno.'),
  -- VENCIDO: además la última calibración fue NO CONFORME.
  ('EQ-MUF-001',   -795, 'CESMEC S.A.',                     'NCh-ISO/IEC 17025', 'CAL-2023-MUF-009',  'conforme',            -430, 'Mapeo térmico de cámara conforme.'),
  ('EQ-MUF-001',   -430, 'CESMEC S.A.',                     'NCh-ISO/IEC 17025', 'CAL-2024-MUF-188',  'no_conforme',          -62, 'Desviación de +9 °C en el punto de 550 °C. Requiere ajuste del controlador PID.'),
  ('EQ-EST-001',   -120, 'Lab. Metrología Aplicada Ltda.',  'NCh-ISO/IEC 17025', 'CAL-2025-EST-055',  'conforme',             245, 'Uniformidad térmica dentro de ±2 °C.'),
  ('EQ-PHM-001',   -210, 'Hanna Instruments Chile',         'NCh-ISO/IEC 17025', 'CAL-2025-PHM-091',  'conforme',             155, 'Calibración a 3 puntos (pH 4,01 / 7,00 / 10,01).'),
  ('EQ-DUR-001',    -70, 'Instron Chile Ltda.',             'ASTM D2240',        'CAL-2025-DUR-137',  'conforme',             295, 'Verificación con bloques patrón Shore A y D.')
) AS v(equipo_codigo, fecha_offset, ejecutada_por, norma, certificado_ref, resultado, proxima_offset, observaciones)
  ON v.equipo_codigo = e.codigo
JOIN tenant t ON t.id = e.tenant_id AND t.codigo = 'IDIC'
ON CONFLICT DO NOTHING;

COMMIT;

-- =============================================================================
-- Verificación rápida (no forma parte de la migración):
--
--   SELECT codigo, nombre, estado, proxima_calibracion,
--          (estado = 'operativo' AND proxima_calibracion >= CURRENT_DATE) AS apto
--     FROM equipo WHERE deleted_at IS NULL ORDER BY codigo;
--
-- Esperado: 8 filas · 5 aptas · EQ-BAL-001 y EQ-MUF-001 no aptas por calibración
-- vencida · EQ-FTIR-001 (en_calibracion) y EQ-PHM-001 (fuera_servicio) no aptas
-- por estado.
-- =============================================================================
