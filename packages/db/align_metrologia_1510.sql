-- =============================================================================
-- align_metrologia_1510.sql · Metrología según la información del LMT del 15-10-2026
-- -----------------------------------------------------------------------------
-- Respuesta del laboratorio, acreditaciones INN (LC 001 Mod. 2, LC 004 Mod. 1,
-- LC 005 ampliación 15-01-2026), programas de calibración IDIC-PG11-Anexo02,
-- planillas M-3947 (ITM03) y V-5920 (ITV05) y registro de firmas autorizadas
-- (LMT-PG01 Anexo 11 Rev. 28). Ver docs/FLUJO_METROLOGIA.md.
--   1. Acreditación por PROCESO (ITM03 no acreditado; LC 004 acredita ITL05 e ITL10).
--   2. Numeración del certificado por magnitud y sin año (M-, V-, L-, T-, P-, F-, PT-).
--   3. Circuito de firma: metrólogo → Jefe LMT (o subrogante) → Jefe de Departamento.
--   4. Registro de firmas autorizadas por magnitud (personas solo por iniciales).
--   5. Maestro versionado de capacidades de medición (CMC) de las acreditaciones.
--   6. Maestro de patrones y equipos auxiliares desde los Anexo02.
--   7. Nombre del departamento del certificado como parámetro configurable.
-- Aditivo e idempotente. Requiere align_metrologia_flujo.sql y align_parametros.sql.
-- =============================================================================

-- 1 · Procesos: acreditación, revisión de la IT, norma base y prefijo del certificado
ALTER TABLE met_proceso ADD COLUMN IF NOT EXISTS revision            VARCHAR(20);
ALTER TABLE met_proceso ADD COLUMN IF NOT EXISTS prefijo_certificado VARCHAR(10);  -- NULL = sin numeración propia (se usa el código CAL-)

INSERT INTO met_proceso (codigo, magnitud_id, nombre, metodo, norma, laboratorio, acreditacion)
SELECT p.codigo, m.id, p.nombre, p.metodo, p.norma, 'LMT', 'LC 004' FROM (VALUES
 ('ITL05', 'Medidores de espesores con comparador', 'LMT-PG01-P01-ITL05 · Medidor de espesores con comparador (formulario por puntos)', 'ISO 463:2006'),
 ('ITL10', 'Medidores trazadores de altura y de profundidad', 'LMT-PG01-P01-ITL10 · Trazador de altura y medidor de profundidad (formulario por puntos)', 'DI-004 CEM (Edición digital 1)')
) AS p(codigo, nombre, metodo, norma)
JOIN met_magnitud m ON m.codigo = 'longitud'
ON CONFLICT (codigo) DO NOTHING;

-- Acreditación por proceso según los alcances vigentes: ITM03 no figura en LC 001.
-- (Se aplica una sola vez: la condición `revision IS NULL` cambia en la sentencia siguiente.)
UPDATE met_proceso SET acreditacion = NULL WHERE codigo = 'ITM03' AND revision IS NULL;
UPDATE met_proceso p SET revision = v.rev, norma = v.norma
  FROM (VALUES
   ('ITM01', 'Rev. 16', 'OIML R111-1'), ('ITM02', 'Rev. 14', 'Guía SIM 2009 · OIML R76-1'), ('ITM03', 'Rev. 00', 'OIML R 111-1: 2004'),
   ('ITL01', 'Rev. 16', 'DI-008 CEM (Edición digital 1)'), ('ITL02', 'Rev. 14', 'NCh 2518:2000'), ('ITL05', 'Rev. 06', 'ISO 463:2006'),
   ('ITL06', 'Rev. 07', 'JIS B 7516:2005'), ('ITL07', 'Rev. 07', 'JIS B 7512:2016'), ('ITL10', 'Rev. 04', 'DI-004 CEM (Edición digital 1)'),
   ('ITF01', 'Rev. 17', 'NCh2598/1:2024'), ('ITF03', 'Rev. 09', 'NCh2598/1:2024'), ('ITV05', 'Rev. 13', 'ASTM E 1154 - 2023')
  ) AS v(codigo, rev, norma)
 WHERE p.codigo = v.codigo AND p.revision IS NULL;

UPDATE met_proceso p SET prefijo_certificado = v.pre
  FROM (VALUES ('masa','M'), ('volumen','V'), ('longitud','L'), ('temperatura','T'), ('presion','P'), ('fuerza','F'), ('par','PT')) AS v(mag, pre),
       met_magnitud m
 WHERE m.id = p.magnitud_id AND m.codigo = v.mag AND p.laboratorio IN ('LMT', 'LMTE') AND p.prefijo_certificado IS NULL;

-- 2 · Numeración del certificado por prefijo (sin año). `ultimo` = último número visto en
--     los documentos del 15-10; el IDIC debe fijar el real antes de la puesta en marcha.
CREATE TABLE IF NOT EXISTS met_numeracion (
  tenant_id  UUID        NOT NULL REFERENCES tenant(id),
  prefijo    VARCHAR(10) NOT NULL,
  ultimo     INT         NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
  relleno    INT         NOT NULL DEFAULT 0,            -- ceros a la izquierda (PT-0090 → 4)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, prefijo)
);
INSERT INTO met_numeracion (tenant_id, prefijo, ultimo, relleno)
SELECT t.id, v.pre, v.ult, v.rel FROM tenant t,
  (VALUES ('M', 3949, 0), ('V', 5920, 0), ('L', 4414, 0), ('T', 2929, 0), ('P', 808, 0), ('F', 1563, 0), ('PT', 90, 4)) AS v(pre, ult, rel)
ON CONFLICT (tenant_id, prefijo) DO NOTHING;

-- 3 · Calibración: número de certificado, verificación, documento sellado, reemisión y patrones usados
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS numero_certificado  VARCHAR(30);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS codigo_verificacion VARCHAR(16);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS documento_html      TEXT;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS reemplaza_id        UUID REFERENCES met_calibracion(id);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS reemplazada_at      TIMESTAMPTZ;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS motivo_reemision    TEXT;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS patrones            JSONB NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX IF NOT EXISTS ux_met_cal_numero ON met_calibracion(tenant_id, numero_certificado) WHERE numero_certificado IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_met_cal_verif  ON met_calibracion(codigo_verificacion) WHERE codigo_verificacion IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_met_cal_reemplaza ON met_calibracion(reemplaza_id) WHERE reemplaza_id IS NOT NULL;

-- Bitácora: nuevas acciones del circuito (firma de cada paso y reemisión)
ALTER TABLE met_calibracion_evento DROP CONSTRAINT IF EXISTS met_calibracion_evento_accion_check;
ALTER TABLE met_calibracion_evento ADD CONSTRAINT met_calibracion_evento_accion_check
  CHECK (accion IN ('CREADA','EDITADA','ENVIADA','DEVUELTA','FIRMADA','EMITIDA','REEMISION','REEMPLAZADA'));

-- Firmas del circuito (una por paso de la matriz CERTIFICADO_CALIBRACION)
CREATE TABLE IF NOT EXISTS met_calibracion_firma (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calibracion_id UUID NOT NULL REFERENCES met_calibracion(id) ON DELETE CASCADE,
  orden          INT  NOT NULL,
  accion         VARCHAR(20) NOT NULL,                 -- ELABORA | FIRMA | …
  rol_codigo     VARCHAR(40),
  rol_nombre     VARCHAR(120),
  unidad_codigo  VARCHAR(20),
  usuario_id     UUID REFERENCES usuario(id),
  nombre         VARCHAR(200) NOT NULL,
  grado          VARCHAR(80),
  cargo          VARCHAR(200),
  via            VARCHAR(20),                          -- titular | subrogante | asignacion | registro
  firmado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (calibracion_id, orden)
);

-- 4 · Registro de firmas autorizadas por magnitud (LMT-PG01 Anexo 11). Personas por iniciales;
--     el administrador vincula cada fila con su usuario (Metrología › Configuración).
CREATE TABLE IF NOT EXISTS met_firmante (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  iniciales    VARCHAR(20)  NOT NULL,
  funcion      VARCHAR(20)  NOT NULL CHECK (funcion IN ('METROLOGO','JEFE_LAB','JEFE_LAB_SUBROGANTE','JEFE_DEPTO')),
  cargo        VARCHAR(200),
  magnitudes   TEXT[] NOT NULL DEFAULT '{}',           -- códigos de met_magnitud
  laboratorios TEXT[] NOT NULL DEFAULT '{LMT,LMTE}',
  usuario_id   UUID REFERENCES usuario(id),
  documento    VARCHAR(120),
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, iniciales, funcion)
);
CREATE INDEX IF NOT EXISTS idx_met_firmante_usuario ON met_firmante(usuario_id) WHERE usuario_id IS NOT NULL;

INSERT INTO met_firmante (tenant_id, iniciales, funcion, cargo, magnitudes, documento)
SELECT t.id, v.ini, v.fun, v.cargo, v.mags::text[], 'LMT-PG01 Anexo 11 Rev. 28 (02-04-2026)'
  FROM tenant t, (VALUES
   ('RMM', 'JEFE_LAB',            'Jefe de Laboratorio Metrología', '{}'),
   ('HOC', 'JEFE_LAB_SUBROGANTE', 'Jefe Sección Ensayos Mecánicos · Jefe de Laboratorio Metrología subrogante', '{}'),
   ('LSV', 'METROLOGO',           'Metrólogo de Temperatura, Magnitudes Eléctricas y Tiempo frecuencia', '{temperatura,electrica,tiempo}'),
   ('ABG', 'METROLOGO',           'Metrólogo de Fuerza, Presión, Par Torsional y Masa', '{fuerza,presion,par,masa}'),
   ('LSP', 'METROLOGO',           'Metrólogo de Longitud', '{longitud}'),
   ('MEC', 'METROLOGO',           'Metrólogo de Par Torsional, Masa y Volumen', '{par,masa,volumen}'),
   ('PRE', 'JEFE_DEPTO',          'Jefe de Departamento (oficializa el registro)', '{}')
  ) AS v(ini, fun, cargo, mags)
ON CONFLICT (tenant_id, iniciales, funcion) DO NOTHING;

-- Base de demostración: perfiles demo.* habilitados como los metrólogos del registro (no son personas).
INSERT INTO met_firmante (tenant_id, iniciales, funcion, cargo, magnitudes, usuario_id, documento)
SELECT u.tenant_id, v.ini, 'METROLOGO', v.cargo, v.mags::text[], u.id, 'Demostración'
  FROM usuario u JOIN (VALUES
   ('demo.lmt.analista1',  'DEMO-1', 'Metrólogo demo · Par, Masa y Volumen', '{par,masa,volumen}'),
   ('demo.lmt.analista2',  'DEMO-2', 'Metrólogo demo · Longitud', '{longitud}'),
   ('demo.lmte.analista1', 'DEMO-3', 'Metrólogo demo · Temperatura, Eléctricas y Tiempo', '{temperatura,electrica,tiempo}'),
   ('demo.lmt.jefe',       'DEMO-4', 'Jefe de laboratorio demo · magnitudes del LMT', '{masa,volumen,longitud,presion,fuerza,par}')
  ) AS v(usr, ini, cargo, mags) ON v.usr = u.username
 WHERE u.es_demo AND u.deleted_at IS NULL
ON CONFLICT (tenant_id, iniciales, funcion) DO NOTHING;

-- Subrogante del Jefe LMT en la base de demostración: el jefe de la Sección Ensayos Mecánicos
-- (como en el registro real). Solo si el LMT aún no tiene subrogante.
INSERT INTO unidad_jefe (tenant_id, unidad_id, usuario_id, rol)
SELECT un.tenant_id, un.id, u.id, 'subrogante'
  FROM unidad un JOIN usuario u ON u.tenant_id = un.tenant_id AND u.username = 'demo.sem.jefe' AND u.es_demo
 WHERE un.codigo = 'LMT'
   AND NOT EXISTS (SELECT 1 FROM unidad_jefe j WHERE j.unidad_id = un.id AND j.rol = 'subrogante')
ON CONFLICT (unidad_id, usuario_id) DO NOTHING;

-- 5 · Maestro versionado de CMC (capacidad de medición y calibración) de las acreditaciones.
--     tipo: valor (a) · lineal (a·L + b, L en la unidad del rango) · raiz (√(a·V + 0,333·r²), planilla ITV05).
--     Rango: mayor que rango_min (o igual si incluye_min) y menor o igual que rango_max.
--     Una modificación del alcance = filas nuevas con su versión y vigencia (se cierra la anterior).
CREATE TABLE IF NOT EXISTS met_cmc (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave          VARCHAR(80) UNIQUE NOT NULL,
  acreditacion   VARCHAR(20),
  version        VARCHAR(80) NOT NULL,
  vigente_desde  DATE NOT NULL,
  vigente_hasta  DATE,
  proceso_codigo VARCHAR(20) NOT NULL,
  servicio       VARCHAR(200) NOT NULL,
  variante       VARCHAR(80),
  rango_min      DOUBLE PRECISION NOT NULL,
  rango_max      DOUBLE PRECISION NOT NULL,
  incluye_min    BOOLEAN NOT NULL DEFAULT FALSE,
  unidad_rango   VARCHAR(10) NOT NULL,
  resolucion     DOUBLE PRECISION,
  tipo           VARCHAR(10) NOT NULL DEFAULT 'valor' CHECK (tipo IN ('valor','lineal','raiz')),
  a              DOUBLE PRECISION NOT NULL,
  b              DOUBLE PRECISION,
  unidad_cmc     VARCHAR(10) NOT NULL,
  patron         VARCHAR(200),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_met_cmc_proceso ON met_cmc(proceso_codigo, vigente_desde) WHERE activo;

INSERT INTO met_cmc (clave, acreditacion, version, vigente_desde, vigente_hasta, proceso_codigo, servicio, variante, rango_min, rango_max,
                     incluye_min, unidad_rango, resolucion, tipo, a, b, unidad_cmc, patron)
SELECT v.clave, v.acreditacion, v.version, v.vigente_desde, v.vigente_hasta, v.proceso_codigo, v.servicio, v.variante, v.rango_min, v.rango_max,
       v.incluye_min, v.unidad_rango, v.resolucion::double precision, v.tipo, v.a, v.b::double precision, v.unidad_cmc, v.patron
  FROM (VALUES
  ('LC001M2-ITM01-F1-1mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.001, 0.001, TRUE, 'g', NULL, 'valor', 0.006, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-2mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.002, 0.002, TRUE, 'g', NULL, 'valor', 0.006, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-5mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.005, 0.005, TRUE, 'g', NULL, 'valor', 0.006, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-10mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.01, 0.01, TRUE, 'g', NULL, 'valor', 0.008, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-20mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.02, 0.02, TRUE, 'g', NULL, 'valor', 0.01, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-50mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.05, 0.05, TRUE, 'g', NULL, 'valor', 0.012, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-100mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.1, 0.1, TRUE, 'g', NULL, 'valor', 0.016, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-200mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.2, 0.2, TRUE, 'g', NULL, 'valor', 0.02, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-500mg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 0.5, 0.5, TRUE, 'g', NULL, 'valor', 0.025, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-1g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 1, 1, TRUE, 'g', NULL, 'valor', 0.03, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-2g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 2, 2, TRUE, 'g', NULL, 'valor', 0.04, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-5g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 5, 5, TRUE, 'g', NULL, 'valor', 0.05, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-10g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 10, 10, TRUE, 'g', NULL, 'valor', 0.06, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-20g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 20, 20, TRUE, 'g', NULL, 'valor', 0.08, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-50g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 50, 50, TRUE, 'g', NULL, 'valor', 0.1, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-100g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 100, 100, TRUE, 'g', NULL, 'valor', 0.16, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-200g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 200, 200, TRUE, 'g', NULL, 'valor', 0.3, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-500g', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 500, 500, TRUE, 'g', NULL, 'valor', 0.8, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F1-1kg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F1 e inferior', 'F1 e inferior', 1000, 1000, TRUE, 'g', NULL, 'valor', 1.6, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM01-F2-2kg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F2 e inferior', 'F2 e inferior', 2000, 2000, TRUE, 'g', NULL, 'valor', 10, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM01-F2-5kg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F2 e inferior', 'F2 e inferior', 5000, 5000, TRUE, 'g', NULL, 'valor', 25, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM01-F2-10kg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F2 e inferior', 'F2 e inferior', 10000, 10000, TRUE, 'g', NULL, 'valor', 50, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM01-F2-20kg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F2 e inferior', 'F2 e inferior', 20000, 20000, TRUE, 'g', NULL, 'valor', 100, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM01-F2-50kg', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM01', 'Masa patrón (pesas) clase F2 e inferior', 'F2 e inferior', 50000, 50000, TRUE, 'g', NULL, 'valor', 250, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM02-I-0.001-5', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 0.001, 5, FALSE, 'g', NULL, 'valor', 0.017, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-5-10', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 5, 10, FALSE, 'g', NULL, 'valor', 0.021, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-10-20', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 10, 20, FALSE, 'g', NULL, 'valor', 0.026, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-20-50', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 20, 50, FALSE, 'g', NULL, 'valor', 0.03, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-50-100', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 50, 100, FALSE, 'g', NULL, 'valor', 0.05, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-100-200', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 100, 200, FALSE, 'g', NULL, 'valor', 0.12, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-200-500', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 200, 500, FALSE, 'g', NULL, 'valor', 0.26, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-500-1000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 500, 1000, FALSE, 'g', NULL, 'valor', 0.8, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-1000-2000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 1000, 2000, FALSE, 'g', NULL, 'valor', 3.1, NULL, 'mg', 'Juego de masas 1 mg a 200 g E2 · masas 500 g y 1 kg E2 (CESMEC D-K-15091-01-00 · KERN D-K-19408-01-00)'),
  ('LC001M2-ITM02-I-2000-5000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 2000, 5000, FALSE, 'g', NULL, 'valor', 9.9, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM02-I-5000-10000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 5000, 10000, FALSE, 'g', NULL, 'valor', 17, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM02-I-10000-20000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 10000, 20000, FALSE, 'g', NULL, 'valor', 31, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM02-I-20000-50000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Instrumentos para pesar de funcionamiento no automático clase I y II', 'Clase I y II', 20000, 50000, FALSE, 'g', NULL, 'valor', 80, NULL, 'mg', 'Juego de masas 2 kg a 5 kg F1 · masas 10 kg a 50 kg F1 (CESMEC LC 002)'),
  ('LC001M2-ITM02-III-50000-100000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Balanzas clase III y IIII', 'Clase III y IIII', 50000, 100000, FALSE, 'g', NULL, 'valor', 503, NULL, 'mg', 'Juego de masas 20 kg a 50 kg M1 (IDIC LC 001)'),
  ('LC001M2-ITM02-III-100000-200000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Balanzas clase III y IIII', 'Clase III y IIII', 100000, 200000, FALSE, 'g', NULL, 'valor', 3201, NULL, 'mg', 'Juego de masas 20 kg a 50 kg M1 (IDIC LC 001)'),
  ('LC001M2-ITM02-III-200000-300000', 'LC 001', 'LC 001 Mod. 2 (06-08-2026)', DATE '2023-01-27', DATE '2028-01-27', 'ITM02', 'Balanzas clase III y IIII', 'Clase III y IIII', 200000, 300000, FALSE, 'g', NULL, 'valor', 4800, NULL, 'mg', 'Juego de masas 20 kg a 50 kg M1 (IDIC LC 001)'),
  ('LC004M1-ITL01-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL01', 'Pie de metro análogos y digitales', NULL, 0, 1000, FALSE, 'mm', 0.01, 'valor', 10, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL01-R0.02', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL01', 'Pie de metro análogos y digitales', NULL, 0, 1000, FALSE, 'mm', 0.02, 'valor', 14, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL01-R0.05', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL01', 'Pie de metro análogos y digitales', NULL, 0, 1000, FALSE, 'mm', 0.05, 'valor', 29, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL01-R0.1', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL01', 'Pie de metro análogos y digitales', NULL, 0, 1000, FALSE, 'mm', 0.1, 'valor', 0.1, NULL, 'mm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL10-alt-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL10', 'Medidor trazador de altura análogos y digitales', 'Trazador de altura', 0, 1000, FALSE, 'mm', 0.01, 'valor', 12, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL10-alt-R0.02', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL10', 'Medidor trazador de altura análogos y digitales', 'Trazador de altura', 0, 1000, FALSE, 'mm', 0.02, 'valor', 17, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL10-alt-R0.05', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL10', 'Medidor trazador de altura análogos y digitales', 'Trazador de altura', 0, 1000, FALSE, 'mm', 0.05, 'valor', 50, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL10-prof-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL10', 'Medidor de profundidad análogos y digitales', 'Medidor de profundidad', 0, 300, FALSE, 'mm', 0.01, 'valor', 9, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL10-prof-R0.02', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL10', 'Medidor de profundidad análogos y digitales', 'Medidor de profundidad', 0, 300, FALSE, 'mm', 0.02, 'valor', 14, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL10-prof-R0.05', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL10', 'Medidor de profundidad análogos y digitales', 'Medidor de profundidad', 0, 300, FALSE, 'mm', 0.05, 'valor', 29, NULL, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL07', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL07', 'Flexómetro o huincha de medir', NULL, 0, 30000, FALSE, 'mm', NULL, 'valor', 1, NULL, 'mm', 'Regla patrón serie 137 (IDIC LC 004)'),
  ('LC004M1-ITL06', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL06', 'Reglas graduadas', NULL, 0, 2000, FALSE, 'mm', NULL, 'valor', 0.5, NULL, 'mm', 'Pie de metro L-10/011 · L-10/009 (IDIC LC 004)'),
  ('LC004M1-ITL02-ext-R0.001', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL02', 'Micrómetro de exterior (resolución 0,001 mm)', 'Exterior', 0, 1000, FALSE, 'mm', 0.001, 'lineal', 0.01, 0.3, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL02-ext-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL02', 'Micrómetro de exterior (resolución 0,01 mm)', 'Exterior', 0, 1000, FALSE, 'mm', 0.01, 'lineal', 0.009, 4.7, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL02-int-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL02', 'Micrómetro de interiores de dos contactos (resolución 0,01 mm)', 'Interiores', 5, 1500, FALSE, 'mm', 0.01, 'lineal', 0.02, 4, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL02-int-R0.001', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL02', 'Micrómetro de interiores de dos contactos (resolución 0,001 mm)', 'Interiores', 5, 1500, FALSE, 'mm', 0.001, 'lineal', 0.02, 0.7, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL02-prof-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL02', 'Micrómetro de profundidad (resolución 0,01 mm)', 'Profundidad', 0, 300, FALSE, 'mm', 0.01, 'lineal', 0.009, 4.7, 'µm', 'Set de bloques patrón 964165 · 982739 · 963843 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL02-esp-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL02', 'Micrómetros especiales (topes esféricos, platillos, puntas cónicas, reborde de latas)', 'Especiales', 0, 25, FALSE, 'mm', 0.01, 'lineal', 0.009, 4.7, 'µm', 'Set de bloques patrón 982739 (DICTUC)'),
  ('LC004M1-ITL05-R0.1', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL05', 'Medidor de espesores con comparador análogos y digitales', NULL, 0, 50, FALSE, 'mm', 0.1, 'valor', 0.1, NULL, 'mm', 'Set de bloques patrón 982739 · 964165 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL05-R0.01', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL05', 'Medidor de espesores con comparador análogos y digitales', NULL, 0, 50, FALSE, 'mm', 0.01, 'valor', 10, NULL, 'µm', 'Set de bloques patrón 982739 · 964165 · L-01/001 (DICTUC)'),
  ('LC004M1-ITL05-R0.001', 'LC 004', 'LC 004 Mod. 1 (30-06-2025)', DATE '2024-10-28', DATE '2029-10-28', 'ITL05', 'Medidor de espesores con comparador análogos y digitales', NULL, 0, 50, FALSE, 'mm', 0.001, 'valor', 1, NULL, 'µm', 'Set de bloques patrón 982739 · 964165 · L-01/001 (DICTUC)'),
  ('LC005-ITF03-maq', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF03', 'Máquina de ensayos uniaxiales · masas suspendidas en tracción', 'Máquina · tracción', 0.001, 0.5, FALSE, 'kN', NULL, 'valor', 0.002, NULL, '%', 'Juego de patrones de masa M-04/008 · F-PM-001 (IDIC LC 001)'),
  ('LC005-ITF03-din', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF03', 'Dinamómetros · masas suspendidas en tracción', 'Dinamómetro · tracción', 0.001, 0.5, FALSE, 'kN', NULL, 'valor', 0.002, NULL, '%', 'Juego de patrones de masa M-04/008 · F-PM-001 (IDIC LC 001)'),
  ('LC005-ITF01-maq-tr-0.05-1-0.25', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en tracción', 'Máquina · tracción', 0.05, 1, FALSE, 'kN', NULL, 'valor', 0.25, NULL, '%', 'Transductor de fuerza HBM K66340 5 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-tr-1-3.5-0.12', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en tracción', 'Máquina · tracción', 1, 3.5, FALSE, 'kN', NULL, 'valor', 0.12, NULL, '%', 'Transductor de fuerza HBM K66340 5 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-tr-0.5-5-0.21', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en tracción', 'Máquina · tracción', 0.5, 5, FALSE, 'kN', NULL, 'valor', 0.21, NULL, '%', 'Transductor de fuerza HBM 044930052 50 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-tr-5-50-0.2', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en tracción', 'Máquina · tracción', 5, 50, FALSE, 'kN', NULL, 'valor', 0.2, NULL, '%', 'Transductor de fuerza HBM 044930052 50 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-tr-5-50-0.21', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en tracción', 'Máquina · tracción', 5, 50, FALSE, 'kN', NULL, 'valor', 0.21, NULL, '%', 'Transductor de fuerza HBM 032930033 500 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-tr-50-500-0.19', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en tracción', 'Máquina · tracción', 50, 500, FALSE, 'kN', NULL, 'valor', 0.19, NULL, '%', 'Transductor de fuerza HBM 032930033 500 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-co-0.05-1-0.23', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en compresión', 'Máquina · compresión', 0.05, 1, FALSE, 'kN', NULL, 'valor', 0.23, NULL, '%', 'Transductor de fuerza HBM K66340 5 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-co-1-3.5-0.11', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en compresión', 'Máquina · compresión', 1, 3.5, FALSE, 'kN', NULL, 'valor', 0.11, NULL, '%', 'Transductor de fuerza HBM K66340 5 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-co-0.5-5-0.22', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en compresión', 'Máquina · compresión', 0.5, 5, FALSE, 'kN', NULL, 'valor', 0.22, NULL, '%', 'Transductor de fuerza HBM 044930052 50 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-co-5-50-0.19', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en compresión', 'Máquina · compresión', 5, 50, FALSE, 'kN', NULL, 'valor', 0.19, NULL, '%', 'Transductor de fuerza HBM 044930052 50 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-co-5-50-0.2', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en compresión', 'Máquina · compresión', 5, 50, FALSE, 'kN', NULL, 'valor', 0.2, NULL, '%', 'Transductor de fuerza HBM 032930033 500 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-co-50-500-0.18', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en compresión', 'Máquina · compresión', 50, 500, FALSE, 'kN', NULL, 'valor', 0.18, NULL, '%', 'Transductor de fuerza HBM 032930033 500 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-maq-co-300-3000-0.32', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Máquina de ensayos uniaxiales · transductor en compresión', 'Máquina · compresión', 300, 3000, FALSE, 'kN', NULL, 'valor', 0.32, NULL, '%', 'Transductor de fuerza HBM 002881W4 3 MN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-din-tr-0.05-1-0.25', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Dinamómetros · transductor en tracción', 'Dinamómetro · tracción', 0.05, 1, FALSE, 'kN', NULL, 'valor', 0.25, NULL, '%', 'Transductor de fuerza HBM K66340 5 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-din-tr-1-3.5-0.12', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Dinamómetros · transductor en tracción', 'Dinamómetro · tracción', 1, 3.5, FALSE, 'kN', NULL, 'valor', 0.12, NULL, '%', 'Transductor de fuerza HBM K66340 5 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-din-tr-0.5-5-0.21', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Dinamómetros · transductor en tracción', 'Dinamómetro · tracción', 0.5, 5, FALSE, 'kN', NULL, 'valor', 0.21, NULL, '%', 'Transductor de fuerza HBM 044930052 50 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-din-tr-5-50-0.2', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Dinamómetros · transductor en tracción', 'Dinamómetro · tracción', 5, 50, FALSE, 'kN', NULL, 'valor', 0.2, NULL, '%', 'Transductor de fuerza HBM 044930052 50 kN (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-din-tr-5-50-0.21', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Dinamómetros · transductor en tracción', 'Dinamómetro · tracción', 5, 50, FALSE, 'kN', NULL, 'valor', 0.21, NULL, '%', 'Transductor de fuerza HBM 032930033 500 kN bajo 10% (LCPN-F D-K-18357-01-00)'),
  ('LC005-ITF01-din-tr-50-100-0.19', 'LC 005', 'LC 005 ampliación (15-01-2026)', DATE '2026-01-14', DATE '2029-10-28', 'ITF01', 'Dinamómetros · transductor en tracción', 'Dinamómetro · tracción', 50, 100, FALSE, 'kN', NULL, 'valor', 0.19, NULL, '%', 'Transductor de fuerza HBM 032930033 500 kN (LCPN-F D-K-18357-01-00)'),
  ('PLANILLA-ITV05-0.0001-10', 'LC 023', 'Planilla ITV05 Rev. 19 (alcance LC 023 no entregado)', DATE '2025-12-01', NULL, 'ITV05', 'Instrumentos volumétricos accionados por pistón', NULL, 0.0001, 10, TRUE, 'mL', NULL, 'raiz', 5.2e-9, NULL, 'mL', 'Balanza analítica AG285 (IDIC LC 001)'),
  ('PLANILLA-ITV05-10-100', 'LC 023', 'Planilla ITV05 Rev. 19 (alcance LC 023 no entregado)', DATE '2025-12-01', NULL, 'ITV05', 'Instrumentos volumétricos accionados por pistón', NULL, 10, 100, TRUE, 'mL', NULL, 'raiz', 8.8e-8, NULL, 'mL', 'Balanza analítica AG285 (IDIC LC 001)'),
  ('PLANILLA-ITV05-100-1000', 'LC 023', 'Planilla ITV05 Rev. 19 (alcance LC 023 no entregado)', DATE '2025-12-01', NULL, 'ITV05', 'Instrumentos volumétricos accionados por pistón', NULL, 100, 1000, TRUE, 'mL', NULL, 'raiz', 1.8e-7, NULL, 'mL', 'Balanza analítica AG285 (IDIC LC 001)')
) AS v(clave, acreditacion, version, vigente_desde, vigente_hasta, proceso_codigo, servicio, variante, rango_min, rango_max, incluye_min, unidad_rango, resolucion, tipo, a, b, unidad_cmc, patron)
ON CONFLICT (clave) DO NOTHING;

-- 6 · Maestro de patrones y equipos auxiliares (IDIC-PG11-Anexo02 Rev01 de Fuerza, Longitud y Masa)
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS tipo               VARCHAR(10) NOT NULL DEFAULT 'patron';  -- patron | auxiliar
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS rango              VARCHAR(80);
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS norma_referencia   VARCHAR(80);
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS puesta_marcha      DATE;
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS ultima_calibracion DATE;
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS intervalo_meses    INT;
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS laboratorio        VARCHAR(10);   -- LMT, LMTE, LNF
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS fuente             VARCHAR(120);  -- documento de origen
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS observacion        TEXT;
CREATE INDEX IF NOT EXISTS idx_met_patron_codigo ON met_patron(tenant_id, codigo) WHERE deleted_at IS NULL;

INSERT INTO met_patron (tenant_id, magnitud_id, codigo, tipo, nombre, marca, serie, rango, clase, norma_referencia, puesta_marcha,
                        emisor, n_certificado, ultima_calibracion, intervalo_meses, vence, fuente, observacion, laboratorio, modelo)
SELECT t.id, m.id, v.codigo, v.tipo, v.equipo, v.marca, v.serie, v.rango, v.clase, v.norma, v.puesta::date,
       v.lab, v.cert, v.ultima::date, v.meses, v.vence::date, v.fuente, v.obs, 'LMT', NULL
  FROM tenant t CROSS JOIN (VALUES
  ('fuerza', 'PF-01', 'patron', 'Transductor de fuerza', 'HBM', 'K66340', '5 kN Compresión', 'Clase 1', 'ISO 376', '2006-06-08', 'LCPN-F', 'LCPN-F-049.25', '2025-09-23', 26, '2027-11-23', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-02', 'patron', 'Transductor de fuerza', 'HBM', 'K66340', '5 kN Compresión bajo 10%', 'Clase 1', 'ISO 376', '2006-06-08', 'LCPN-F', 'LCPN-F-047.25', '2025-09-16', 26, '2027-11-16', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-03', 'patron', 'Transductor de fuerza', 'HBM', 'K66340', '5 kN Tracción', 'Clase 1', 'ISO 376', '2006-06-08', 'LCPN-F', 'LCPN-F-050.25', '2025-09-24', 26, '2027-11-24', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-04', 'patron', 'Transductor de fuerza', 'HBM', 'K66340', '5 kN Tracción bajo 10%', 'Clase 0,5', 'ISO 376', '2006-06-08', 'LCPN-F', 'LCPN-F-048.25', '2025-09-22', 26, '2027-11-22', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-05', 'patron', 'Transductor de fuerza', 'HBM', '044930052', '50 kN Compresión', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-063.25', '2025-12-11', 26, '2028-02-11', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-06', 'patron', 'Transductor de fuerza', 'HBM', '044930052', '50 kN Compresión bajo 10%', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-060.25', '2025-12-05', 26, '2028-02-05', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-07', 'patron', 'Transductor de fuerza', 'HBM', '044930052', '50 kN Tracción', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-062.25', '2025-12-10', 26, '2028-02-10', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-08', 'patron', 'Transductor de fuerza', 'HBM', '044930052', '50 kN Tracción bajo 10%', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-061.25', '2025-12-09', 26, '2028-02-09', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-09', 'patron', 'Transductor de fuerza', 'HBM', '032930033', '500 kN Compresión', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-068.25', '2025-12-19', 26, '2028-02-19', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-10', 'patron', 'Transductor de fuerza', 'HBM', '032930033', '500 kN Compresión bajo 10%', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-070.25', '2025-12-23', 26, '2028-02-23', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-11', 'patron', 'Transductor de fuerza', 'HBM', '032930033', '500 kN Tracción', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-069.25', '2025-12-22', 26, '2028-02-22', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-12', 'patron', 'Transductor de fuerza', 'HBM', '032930033', '500 kN Tracción bajo 10%', 'Clase 1', 'ISO 376', '2001-06-04', 'LCPN-F', 'LCPN-F-071.25', '2025-12-24', 26, '2028-02-24', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-13', 'patron', 'Transductor de fuerza', 'HBM', '002881W4', '3 MN Compresión', 'Clase 2', 'ISO 376', '2025-11-19', 'LCPN-F', 'LCPN-F-068.24', '2024-09-26', 26, '2026-11-26', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-14', 'patron', 'Juego de masas patrón', 'Instron', 'M-04/008', '100 g a 5 kg', 'M1', 'OIML R111', '1997-04-28', 'IDIC', 'M-3829', '2025-12-02', 24, '2027-12-02', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('fuerza', 'PF-15', 'patron', 'Juego de masas patrón', 'IDIC', 'F-PM-001', '200 g a 2 kg', 'M1', 'OIML R111', '1999-08-19', 'IDIC', 'M-3795 M-3796', '2025-07-02', 24, '2027-07-02', 'IDIC-PG11-Anexo02 Rev01 Fuerza', 'Vencimiento con dos fechas en el programa (01/07/2027 02/07/2027); se toma la última. Dos calibraciones: 01/07/2025 02/07/2025'),
  ('fuerza', 'PF-16', 'auxiliar', 'Termohigrómetro digital', 'Testo', '41317824', '(0 a 50) °C (10 a 95) %Hr', 'No tiene', 'PR-CA-23 v03', '2012-11-17', 'CIDE', 'CCT 395-2024', '2024-12-13', 24, '2026-12-13', 'IDIC-PG11-Anexo02 Rev01 Fuerza', NULL),
  ('longitud', 'PL-01', 'patron', 'Juego de bloques patrón', 'Mitutoyo', '964165', '(0,5 a 100) mm', 'Grado 1', 'ISO 3650', '1996-05-15', 'LCPN-L', '1625557', '2024-07-17', 60, '2029-07-17', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-02', 'patron', 'Juego de bloques patrón', 'Mitutoyo', '963843', '(125 a 500) mm', 'Grado 1', 'ISO 3650', '1996-05-15', 'LCPN-L', '1647953', '2025-07-23', 36, '2028-07-23', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-03', 'patron', 'Juego de bloques patrón', 'Mitutoyo', '982739', '(2,5 a 25) mm', 'Grado 1', 'ISO 3650', '1999-01-28', 'LCPN-L', '1667455', '2026-05-13', 36, '2029-05-13', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-04', 'patron', 'Juego de bloques patrón', 'Carl Mahr', 'L-01/001', '(0,5 a 100) mm', 'Grado 1', 'ISO 3650', '1996-05-15', 'DICTUC', 'DKD-0226', '2022-05-31', 60, '2027-05-31', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-05', 'patron', 'Patrones plano paralelos', 'Mitutoyo', 'L-07/001', '(12 a 12,37) mm', 'Grado 1', 'JIS B 7431', '1996-05-15', 'DICTUC', '1583495', '2022-08-10', 60, '2027-08-10', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-06', 'patron', 'Patrón de planitud', 'Mitutoyo', '50564', NULL, 'Grado 2', 'JIS B 7430', '1996-05-15', 'DICTUC', '1583497', '2022-08-10', 60, '2027-08-10', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-07', 'patron', 'Patrón de plano paralelo', 'Mitutoyo', '81859', NULL, 'Grado 1', 'JIS B 7431', '1999-01-28', 'DICTUC', '1583498', '2022-08-10', 60, '2027-08-10', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-08', 'patron', 'Patrón de planitud', 'Mitutoyo', '50954', NULL, 'Grado 2', 'JIS B 7430', '1996-05-15', 'DICTUC', '1583496', '2022-08-10', 60, '2027-08-10', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-09', 'auxiliar', 'Microscopio de medición', 'Cole-Parmer', 'S361192', '(0 a 2) mm', '0,02 mm', NULL, '2002-01-10', 'DICTUC', '1667862', '2026-05-18', 36, '2029-05-18', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-10', 'patron', 'Micrómetro exterior', 'Mitutoyo', '0138696', '(0 a 25) mm', '0,001 mm', NULL, '2018-01-04', 'IDIC', 'L-4019', '2024-05-24', 24, '2026-11-24', 'IDIC-PG11-Anexo02 Rev01 Longitud', 'Vencimiento con dos fechas en el programa (24/05/2026 24/11/2026); se toma la última'),
  ('longitud', 'PL-11', 'patron', 'Pie de metro universal dig.', 'Mitutoyo', '7051026', '(0 a 200) mm', '0,01 mm', NULL, '1996-06-03', 'IDIC', 'L-4413', '2026-08-27', 12, '2027-08-27', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-12', 'patron', 'Bco. calib. Comparador cent.', 'Mitutoyo', '600191', '(0 a 25) mm', NULL, NULL, '1996-03-14', 'DICTUC', '1648119', '2025-07-24', 36, '2028-07-24', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-13', 'patron', 'Bco. calib. Comparador miles.', 'Mitutoyo', '603175', '(0 a 5) mm', NULL, NULL, '1996-05-15', 'DICTUC', '1648604', '2025-07-29', 36, '2028-07-29', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-14', 'patron', 'Mesa de planitud', 'Mitutoyo', '95100015', NULL, 'Clase 0', 'JIS B 7513', '1996-04-03', 'DICTUC', '1596119', '2023-04-20', 60, '2028-04-20', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-15', 'patron', 'Regla rígida grad. Patrón', 'Ultra-Prazision', '137', '(0 a 3000) mm', 'B', 'DIN 866', '2000-02-01', 'IDIC', 'L-3980-A L-3980-B', '2022-12-12', 60, '2028-12-12', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-16', 'patron', 'Termómetro ambiental', 'IMM', 'LT-026', '(-8 a + 32) ºC', 'ASTM A1', 'ASTM 63C', '2001-12-19', 'IDIC', 'T-2911', '2026-04-17', 12, '2027-04-17', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-17', 'patron', 'Escuadra de perpendicularidad', 'Mauser', 'L-13/004', '90º', 'Clase 0', NULL, '1996-08-10', 'DICTUC', '1648719', '2025-08-04', 60, '2030-08-04', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-18', 'patron', 'Goniómetro univ.', 'Carl Mahr', 'L-13/007', '0º a 360º', '5 min', NULL, '1998-12-03', 'DICTUC', '1648720', '2025-08-04', 60, '2030-08-04', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-19', 'patron', 'Pie de metro boca única', 'Carl Mahr', 'L-10/009', '(0 a 500) mm', '0,02 mm', NULL, '1981-04-01', 'IDIC', 'L-4399', '2026-07-22', 12, '2027-07-22', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-20', 'patron', 'Pie de metro boca única', 'Mitutoyo', 'L-10/011', '(0 a 1000) mm', '0,05 mm', NULL, '1991-06-01', 'IDIC', 'L-4400', '2026-07-22', 12, '2027-07-22', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('longitud', 'PL-21', 'patron', 'Comparador Digital .recto', 'Mitutoyo', '12183954', '(0 a 12,7) mm', '0,002 mm', NULL, '2016-03-19', 'IDIC', 'L-4049', '2024-08-01', 24, '2027-08-01', 'IDIC-PG11-Anexo02 Rev01 Longitud', 'Vencimiento con dos fechas en el programa (01/08/2026 01/08/2027); se toma la última'),
  ('longitud', 'PL-22', 'auxiliar', 'Termohigrómetro', 'Testo', '41317821', '"(0 a 50) ºC', '0,1 ºC y 0,1 %Hr', NULL, '2012-11-14', 'CIDE-USACH', 'CCT 396-2024', '2024-12-13', 36, '2027-12-13', 'IDIC-PG11-Anexo02 Rev01 Longitud', NULL),
  ('masa', 'PM-01', 'patron', 'Juego de masas patrón', 'Mettler-Toledo', '15884', '1 mg a 200 g', 'E2', 'OIML R111', '1996-05-06', 'LCPN-M', 'LNM-1253', '2024-07-05', 36, '2027-07-05', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-02', 'patron', 'Masa patrón individual', 'Mettler-Toledo', '15847', '500 g', 'E2', 'OIML R111', '1998-05-18', 'LCPN-M', 'LNM-1759', '2025-06-24', 36, '2028-06-24', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-03', 'patron', 'Masa patrón individual', 'Mettler-Toledo', '15848', '1 kg', 'E2', 'OIML R111', '1996-11-26', 'LCPN-M', 'LNM-1186', '2024-07-01', 48, '2028-07-01', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-04', 'patron', 'Masa patrón individual', 'Mettler-Toledo', '15918', '1* kg', 'E2', 'OIML R111', '1996-11-26', 'LCPN-M', 'LNM-1771', '2025-06-24', 48, '2029-06-24', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-05', 'patron', 'Juego de masas patrón', 'Mettler-Toledo', '158901', '1 mg a 200 g', 'F1', 'OIML R111', '1996-05-06', 'IDIC', 'M-3931', '2026-05-14', 36, '2029-05-14', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-06', 'patron', 'Masa patrón individual', 'Mettler-Toledo', '15868', '500 g', 'F1', 'OIML R111', '1996-05-11', 'IDIC', 'M-3924', '2026-05-05', 36, '2029-05-05', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-07', 'patron', 'Juego de 4 masas patrón', 'Mettler-Toledo', '158891', '(1 a 5) kg', 'F1', 'OIML R111', '1996-07-06', 'LCPN-M', 'LNM-1768', '2025-06-24', 36, '2028-06-24', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-08', 'patron', 'Masa patrón individual', 'Mettler-Toledo', '15872', '10 kg', 'F1', 'OIML R111', '1998-05-18', 'LCPN-M', 'LNM-1761', '2025-06-24', 36, '2028-06-24', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-09', 'patron', 'Masa patrón individual', 'Mettler-Toledo', '15873', '20 kg', 'F1', 'OIML R111', '1998-11-27', 'LCPN-M', 'LNM-1762', '2025-06-23', 36, '2028-06-23', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-10', 'patron', 'Masa patrón individual', 'Mettler-Toledo', '15873', '20* kg', 'F1', 'OIML R111', '1998-11-27', 'LCPN-M', 'LNM-1763', '2025-06-23', 36, '2028-06-23', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-11', 'patron', 'Masa patrón individual', 'Sartorius', '60629264', '50 kg', 'F1', 'OIML R111', '1998-05-18', 'LCPN-M', 'LNM-1197', '2024-07-08', 36, '2027-07-08', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-12', 'patron', 'Juego de 4 masas patrón', 'Kern', 'G952321 (LC-F2)', '500 g a 5 kg', 'F2', 'OIML R111', '1996-03-11', 'IDIC', 'M-3812', '2025-09-12', 24, '2027-09-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-13', 'patron', 'Masa patrón individual', 'Kern', 'G96236 (LC-F2)', '2* kg', 'F2', 'OIML R111', '1996-03-11', 'IDIC', 'M-3812', '2025-09-12', 24, '2027-09-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-14', 'patron', 'Masa patrón individual', 'Sartorius', '70129782 (LC-F2)', '10 kg', 'F2', 'OIML R111', '1998-05-18', 'IDIC', 'M-3812', '2025-09-12', 24, '2027-09-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-15', 'patron', 'Masa patrón individual', 'Sartorius', '70229837 (LC-F2)', '20 kg', 'F2', 'OIML R111', '1998-05-18', 'IDIC', 'M-3812', '2025-09-12', 24, '2027-09-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-16', 'patron', 'Masa patrón individual', 'Sartorius', '70229838 (LC-F2)', '20* kg', 'F2', 'OIML R111', '1998-05-18', 'IDIC', 'M-3812', '2025-09-12', 24, '2027-09-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-17', 'patron', 'Masa patrón individual', 'Sartorius', '80131223', '50 kg', 'F2', 'OIML R111', '1998-05-18', 'IDIC', 'M-3751', '2025-02-12', 36, '2028-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-18', 'patron', 'Masa patrón individual', 'Sartorius', '71231087 (LC-M1)', '1 kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-19', 'patron', 'Masa patrón individual', 'Sartorius', '70930811 (LC-M1)', '2 kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-20', 'patron', 'Masa patrón individual', 'Sartorius', '70930814 (LC-M1)', '2* kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-21', 'patron', 'Masa patrón individual', 'Sartorius', '70630447 (LC-M1)', '5 kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-22', 'patron', 'Masa patrón individual', 'AHä', '80131195 (LC-M1)', '10 kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-23', 'patron', 'Masa patrón individual', 'AHä', '80131434 (LC-M1)', '20 kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-24', 'patron', 'Masa patrón individual', 'AHä', '80131435 (LC-M1)', '20* kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-25', 'patron', 'Masa patrón individual', 'AHä', '80131222 (LC-M1)', '50 kg', 'M1', 'OIML R111', '1998-05-18', 'IDIC', 'M-3750', '2025-02-12', 24, '2027-02-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-26', 'patron', 'Masa patrón individual', 'Cesmec', '01 (LC-50M1)', '50 kg', 'M1', 'OIML R111', '2000-11-23', 'IDIC', 'M-3932', '2026-05-13', 36, '2029-05-13', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-27', 'patron', 'Masa patrón individual', 'Cesmec', '02 (LC-50M1)', '50 kg', 'M1', 'OIML R111', '2000-11-23', 'IDIC', 'M-3932', '2026-05-13', 36, '2029-05-13', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-28', 'patron', 'Masa patrón individual', 'Cesmec', '03 (LC-50M1)', '50 kg', 'M1', 'OIML R111', '2000-11-23', 'IDIC', 'M-3932', '2026-05-13', 36, '2029-05-13', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-29', 'patron', 'Masa patrón individual', 'Cesmec', '04 (LC-50M1)', '50 kg', 'M1', 'OIML R111', '2000-11-23', 'IDIC', 'M-3932', '2026-05-13', 36, '2029-05-13', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-30', 'patron', 'Masa patrón individual', 'Cesmec', '05 (LC-50M1)', '50 kg', 'M1', 'OIML R111', '2000-11-23', 'IDIC', 'M-3932', '2026-05-13', 36, '2029-05-13', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-31', 'patron', 'Masa patrón individual', 'Narbach', '06 (LC-M1-01)', '10 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-32', 'patron', 'Masa patrón individual', 'Narbach', '07 (LC-M1-01)', '10 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-33', 'patron', 'Masa patrón individual', 'Narbach', '08 (LC-M1-01)', '10 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-34', 'patron', 'Masa patrón individual', 'Narbach', '09 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-35', 'patron', 'Masa patrón individual', 'Narbach', '10 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-36', 'patron', 'Masa patrón individual', 'Narbach', '11 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-37', 'patron', 'Masa patrón individual', 'Narbach', '12 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-38', 'patron', 'Masa patrón individual', 'Narbach', '13 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-39', 'patron', 'Masa patrón individual', 'Narbach', '14 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-40', 'patron', 'Masa patrón individual', 'Narbach', '15 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-41', 'patron', 'Masa patrón individual', 'Narbach', '16 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-42', 'patron', 'Masa patrón individual', 'Narbach', '17 (LC-M1-01)', '20 kg', 'M1', 'OIML R111', '2019-06-11', 'IDIC', 'M-3788', '2025-06-12', 24, '2027-06-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-43', 'auxiliar', 'Comprador de masa XP6U', 'Mettler-Toledo', '1123453047', '0,0001 mg a 6,1 g', NULL, NULL, '2009-12-11', 'IDIC', 'Repetibilidad', '2025-11-12', 24, '2027-11-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-44', 'auxiliar', 'Comparador de masa AT 21', 'Mettler-Toledo', '1115180919', '1 mg a 22 g', NULL, NULL, '1996-09-22', 'IDIC', 'Repetibilidad', '2025-11-12', 24, '2027-11-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-45', 'auxiliar', 'Comparador de masa AT 1005', 'Mettler-Toledo', '1115412761', '(0 a 1109) g', NULL, NULL, '1996-11-26', 'IDIC', 'Repetibilidad', '2025-11-12', 24, '2027-11-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-46', 'auxiliar', 'Comparador de masa PR 5003', 'Mettler-Toledo', '1115180889', '(0 a 5100) g', NULL, NULL, '1996-09-22', 'IDIC', 'Repetibilidad', '2025-11-12', 24, '2027-11-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-47', 'auxiliar', 'Comparador de masa KA 50', 'Mettler-Toledo', '2173980', '(0 a 50000) g', NULL, NULL, '1998-06-10', 'IDIC', 'Repetibilidad', '2025-11-12', 24, '2027-11-12', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-48', 'auxiliar', 'Termo higrómetro digital', 'Testo', '41317842', '(0 a 50) ºC y (10 a 95) % Hr', NULL, 'PR-CA-23 V03 (CIDE)', '2012-11-14', 'CIDE', 'CCT 185-2026', '2026-05-05', 36, '2029-05-05', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL),
  ('masa', 'PM-49', 'auxiliar', 'Barómetro digital', 'PCE Instruments', 'R.056206', '(10 a 1100) hPa', NULL, 'PR-CA-10 V07 (CIDE)', '2019-01-09', 'CIDE', 'CCP 093-2023', '2023-07-24', 48, '2027-07-24', 'IDIC-PG11-Anexo02 Rev01 Masa', NULL)
  ) AS v(mag, codigo, tipo, equipo, marca, serie, rango, clase, norma, puesta, lab, cert, ultima, meses, vence, fuente, obs)
  JOIN met_magnitud m ON m.codigo = v.mag
 WHERE t.codigo = 'IDIC'
   AND NOT EXISTS (SELECT 1 FROM met_patron p WHERE p.tenant_id = t.id AND p.codigo = v.codigo AND p.deleted_at IS NULL);

-- Trazabilidad inmediata: el emisor del certificado y, si es el propio IDIC, su acreditación.
UPDATE met_patron p SET trazabilidad = CASE
         WHEN p.emisor = 'IDIC' AND m.codigo = 'longitud' THEN 'IDIC LC 004'
         WHEN p.emisor = 'IDIC' AND p.n_certificado LIKE 'L-%' THEN 'IDIC LC 004'
         WHEN p.emisor = 'IDIC' AND p.n_certificado LIKE 'T-%' THEN 'IDIC LC 155'
         WHEN p.emisor = 'IDIC' AND p.n_certificado = 'Repetibilidad' THEN 'IDIC (repetibilidad interna)'
         WHEN p.emisor = 'IDIC' THEN 'IDIC LC 001'
         ELSE p.emisor END
  FROM met_magnitud m
 WHERE m.id = p.magnitud_id AND p.fuente LIKE 'IDIC-PG11-Anexo02%' AND p.trazabilidad IS NULL;

-- Los cuatro patrones de ejemplo de align_metrologia.sql no son reales: quedan fuera del selector.
UPDATE met_patron SET activo = FALSE
 WHERE codigo IN ('MP-E2-01', 'PT-01', 'FT-01', 'TP-01') AND fuente IS NULL AND activo;

-- 7 · Nombre del departamento que firma el certificado (parámetro editable en Administración ›
--     Parámetros). Por defecto, el nombre que figura HOY en el organigrama para el departamento
--     de la Sección Metrología; los documentos oficiales del LMT dicen «Departamento Sistemas de Armas».
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden)
SELECT s.tenant_id, 'certificado_calibracion', 'nombre_departamento', d.nombre, 1
  FROM unidad s JOIN unidad d ON d.id = s.padre_id AND d.tipo = 'DEPARTAMENTO'
 WHERE s.codigo = 'SAM'
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
