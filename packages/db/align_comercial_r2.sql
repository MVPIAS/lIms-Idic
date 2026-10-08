-- =============================================================================
-- align_comercial_r2.sql · Observaciones del Depto. Comercial (SVT / SPC)
--                          rondas 1 y 2 (oct-2026) aplicadas al producto real
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CREATE ... IF NOT EXISTS,
-- INSERT ... ON CONFLICT DO NOTHING. Seguro tanto en una BD construida con
-- schema.sql + align_*.sql (provision.sh) como en una BD creada con
-- `prisma db push` (sin DEFAULT en los id → se pasa gen_random_uuid() explícito).
-- Se aplica en provision.sh DESPUÉS de align_parametros.sql.
--
-- Qué cubre (detalle y reglas en docs/COMERCIAL_RONDA2.md):
--   R1  estados de cotización Abierta/Aceptada/Anulada · formatos NORMAL y
--       PERSONALIZADO · moneda CLP/USD con dólar congelado al emitir · forma de
--       pago «Contado 30 días» / «Por adelantado» · sin descuento · Referencia y
--       Condiciones adicionales separadas · validez automática (IT DCO-PG01-P01-IT02)
--       · sin FAX en medios de envío · línea = ensayo (código EN) del catálogo.
--   R2  Descripción técnica y alcance · centros de costo con sucursales BPCH,
--       Delegación Nº 11 y LMT Área Eléctrica · Condiciones adicionales ≤ 2000 y
--       Observaciones internas · texto base por laboratorio · lista única de
--       tipos de cliente · documento de aceptación (OPI/OC/correo/pago/disposición)
--       · OT por disposición con OPI pendiente · OT Interlaboratorio.
--
-- NO borra ni reescribe datos de negocio: los valores antiguos de los combos se
-- DESACTIVAN (activo=false), nunca se eliminan; cliente.tipo NO se toca (la
-- reclasificación es una consulta manual documentada en COMERCIAL_RONDA2.md).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0 · Prerrequisitos defensivos
-- -----------------------------------------------------------------------------
-- parametro_sistema la crea align_parametros.sql; se repite el DDL (IF NOT
-- EXISTS) para que este script funcione aunque aquel no se haya aplicado.
CREATE TABLE IF NOT EXISTS parametro_sistema (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  categoria   VARCHAR(60) NOT NULL,
  codigo      VARCHAR(60) NOT NULL,
  etiqueta    VARCHAR(160) NOT NULL,
  orden       INTEGER     NOT NULL DEFAULT 0,
  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parametro_sistema_cat_cod
  ON parametro_sistema (tenant_id, categoria, codigo);
CREATE INDEX IF NOT EXISTS ix_parametro_sistema_categoria
  ON parametro_sistema (tenant_id, categoria, orden);

-- `valor`: dato técnico asociado al código (no visible en el combo). Lo usan:
--   tipo_cliente       → regla de validez: 'EJERCITO' | 'PARTICULAR'
--   validez_cotizacion → número (días / meses)
ALTER TABLE parametro_sistema ADD COLUMN IF NOT EXISTS valor TEXT;
COMMENT ON COLUMN parametro_sistema.valor IS
  'Dato técnico del código (no se muestra en el combo). tipo_cliente → regla de validez EJERCITO|PARTICULAR; validez_cotizacion → número.';

-- -----------------------------------------------------------------------------
-- 1 · Centros de costo: tipo (grupo del combo), texto base y validez por lab
-- -----------------------------------------------------------------------------
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS nombre        VARCHAR(200);
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS laboratorio   VARCHAR(20);
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT now();
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ;
-- schema.sql ya trae `tipo`, `sigla` y `descripcion`; en BD de prisma db push no.
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS tipo          VARCHAR(30);
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS sigla         VARCHAR(10);
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS descripcion   VARCHAR(200);
-- Texto base de «Condiciones adicionales» del laboratorio (SVT3). Se precarga en
-- la cotización y el usuario lo ajusta (máx. 2000 en la cotización).
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS condiciones_base TEXT;
-- Validez de cotización a PARTICULARES propia del laboratorio (p. ej. LRB, LMT).
-- NULL = regla general (parámetro validez_cotizacion.particular_dias, 45 días).
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS validez_particular_dias INTEGER;

-- schema.sql declara descripcion NOT NULL, pero el modelo Prisma (y el CRUD de
-- /centros-costo) escribe `nombre`: sin esto un alta desde la UI falla.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'centro_costo' AND column_name = 'descripcion'
                AND is_nullable = 'NO') THEN
    ALTER TABLE centro_costo ALTER COLUMN descripcion DROP NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN centro_costo.tipo IS
  'laboratorio | sucursal_bpch | delegacion_bpch. Agrupa el combo de la cotización («Laboratorios» / «Sucursales y Delegación BPCH»).';
COMMENT ON COLUMN centro_costo.condiciones_base IS
  'Texto base de Condiciones adicionales del laboratorio (SVT3). Se precarga en la cotización.';
COMMENT ON COLUMN centro_costo.validez_particular_dias IS
  'Validez (días) de cotizaciones a particulares propia del laboratorio. NULL = parámetro general (45).';

-- Las filas existentes sin tipo son laboratorios (la siembra previa solo tenía labs).
UPDATE centro_costo SET tipo = 'laboratorio' WHERE tipo IS NULL;

-- Siembra (SVT2). Códigos ≤ 20 (schema.sql: VARCHAR(20)). Para los laboratorios
-- se reutiliza el patrón 'XXX-001' de seed_preprod_demo.sql → sin duplicados.
-- Nombres neutros y editables desde /centros-costo; ON CONFLICT no pisa
-- ediciones del IDIC.
INSERT INTO centro_costo (id, tenant_id, codigo, nombre, descripcion, sigla, tipo, laboratorio, activo)
SELECT gen_random_uuid(), t.id, v.codigo, v.nombre, v.nombre, v.sigla, v.tipo, v.lab, TRUE
FROM tenant t
CROSS JOIN (VALUES
  -- Laboratorios (organigrama IDIC, en alcance)
  ('LQC-001',      'Laboratorio Químico (LQC)',                 'LQC',  'laboratorio',     'LQC'),
  ('LPN-001',      'Laboratorio de Pinturas (LPN)',             'LPN',  'laboratorio',     'LPN'),
  ('LQA-001',      'Laboratorio Química de Alimentos (LQA)',    'LQA',  'laboratorio',     'LQA'),
  ('LMB-001',      'Laboratorio de Microbiología (LMB)',        'LMB',  'laboratorio',     'LMB'),
  ('LES-001',      'Laboratorio LES',                           'LES',  'laboratorio',     'LES'),
  ('LCC-001',      'Laboratorio Cuero y Calzado (LCC)',         'LCC',  'laboratorio',     'LCC'),
  ('LTX-001',      'Laboratorio Textil (LTX)',                  'LTX',  'laboratorio',     'LTX'),
  ('LME-001',      'Laboratorio LME',                           'LME',  'laboratorio',     'LME'),
  ('LRB-001',      'Laboratorio LRB',                           'LRB',  'laboratorio',     'LRB'),
  ('LAM-001',      'Laboratorio LAM',                           'LAM',  'laboratorio',     'LAM'),
  ('SEO-001',      'Sección Electrónica y Optrónica (SEO)',     'SEO',  'laboratorio',     'SEO'),
  ('SVM-001',      'Sección Vehículos Militares (SVM)',         'SVM',  'laboratorio',     'SVM'),
  ('LEM-001',      'Laboratorio Ensayos Mecánicos (LEM)',       'LEM',  'laboratorio',     'LEM'),
  ('LMT-001',      'Laboratorio de Metrología (LMT)',           'LMT',  'laboratorio',     'LMT'),
  ('LMT-AE',       'LMT · Área Eléctrica',                      'LMT',  'laboratorio',     'LMT'),
  ('LNF-001',      'Laboratorio Nacional de Fuerza (LNF)',      'LNF',  'laboratorio',     'LNF'),
  -- Sucursales y Delegación BPCH (SVT2)
  ('BPCH-SUC-STGO','Sucursal Santiago',                         'BPCH', 'sucursal_bpch',   'BPCH'),
  ('BPCH-SUC-ANF', 'Sucursal Antofagasta',                      'BPCH', 'sucursal_bpch',   'BPCH'),
  ('BPCH-SUC-LSE', 'Sucursal La Serena',                        'BPCH', 'sucursal_bpch',   'BPCH'),
  ('BPCH-SUC-CAL', 'Sucursal Calama',                           'BPCH', 'sucursal_bpch',   'BPCH'),
  ('BPCH-SUC-CPO', 'Sucursal Copiapó',                          'BPCH', 'sucursal_bpch',   'BPCH'),
  ('BPCH-SUC-IQQ', 'Sucursal Iquique',                          'BPCH', 'sucursal_bpch',   'BPCH'),
  ('BPCH-DEL-11',  'Delegación Nº 11',                          'BPCH', 'delegacion_bpch', 'BPCH')
) AS v(codigo, nombre, sigla, tipo, lab)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2 · Cotización
-- -----------------------------------------------------------------------------
-- En schema.sql centro_costo_id ya existe (con FK); en BD de prisma db push no.
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS centro_costo_id        UUID REFERENCES centro_costo(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS referencia             VARCHAR(300);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS descripcion_tecnica    TEXT;           -- SVT1
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS condiciones_adicionales VARCHAR(2000); -- SVT3 · se imprime
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS observaciones_internas TEXT;           -- SVT3 · NO se imprime
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS moneda                 VARCHAR(3) NOT NULL DEFAULT 'CLP';
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS dolar_valor            NUMERIC(12,4);  -- CLP por USD, congelado al emitir
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS dolar_fecha            DATE;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS dolar_motivo           TEXT;           -- motivo si se edita tras emitir
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS valida_hasta           DATE;           -- IT DCO-PG01-P01-IT02
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS tipo_cliente_codigo    VARCHAR(60);    -- snapshot al emitir
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS medio_envio            VARCHAR(40);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS aceptacion_tipo        VARCHAR(30);    -- SVT6
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS aceptacion_numero      VARCHAR(60);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS aceptacion_fecha       DATE;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS aceptacion_adjunto     VARCHAR(300);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS con_cobro              BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS aceptada_at            TIMESTAMPTZ;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS aceptada_por           UUID;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS anulacion_motivo       TEXT;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS anulada_at             TIMESTAMPTZ;

-- Si condiciones_adicionales existía con otro tipo (TEXT), el límite SVT3 se
-- garantiza con un CHECK. NOT VALID: no revalida filas históricas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_condiciones_len') THEN
    ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_condiciones_len
      CHECK (condiciones_adicionales IS NULL OR char_length(condiciones_adicionales) <= 2000) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_moneda') THEN
    ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_moneda
      CHECK (moneda IN ('CLP', 'USD')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_cotizacion_centro_costo ON cotizacion (centro_costo_id);

-- Histórico: las cotizaciones ya existentes conservan su estado (borrador,
-- enviada, rechazada, expirada) y quedan de SOLO LECTURA; no se migran a
-- 'abierta'. valida_hasta histórica = expira_at si existía.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'cotizacion' AND column_name = 'expira_at') THEN
    UPDATE cotizacion SET valida_hasta = expira_at WHERE valida_hasta IS NULL AND expira_at IS NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN cotizacion.condiciones_adicionales IS 'Condiciones adicionales (máx. 2000). Se IMPRIMEN en la cotización.';
COMMENT ON COLUMN cotizacion.observaciones_internas  IS 'Observaciones internas de Comercial. NO se imprimen.';
COMMENT ON COLUMN cotizacion.valida_hasta IS 'Validez automática según IT DCO-PG01-P01-IT02 (particular 45 d o del lab; Ejército 31-dic o 6 meses si oct–dic).';
COMMENT ON COLUMN cotizacion.aceptacion_tipo IS 'OPI_RESOLUCION | OC | CORREO | PAGO_ADELANTADO | DISPOSICION_DIRECTOR (IDIC-PG03 6.3 n / 6.4 g).';

-- Línea de cotización = ensayo del catálogo (código EN) valorizado por su ficha.
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS cat_ensayo_id UUID;
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS ensayo_codigo VARCHAR(30);
-- En BD de schema.sql la tabla nació sin estas columnas del modelo Prisma
-- (las añade align_schema_to_prisma.sql); se repiten por si acaso.
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS tipo         VARCHAR(30) NOT NULL DEFAULT 'producto';
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS categoria    VARCHAR(80);
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS dias_o_horas NUMERIC(8,2);
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS tramo        VARCHAR(200);

-- -----------------------------------------------------------------------------
-- 3 · Orden de trabajo: origen, cobro, disposición del Director, OPI pendiente
-- -----------------------------------------------------------------------------
-- origen_trabajo ya existe (VARCHAR(120), texto libre heredado). Desde ahora las
-- OT nuevas guardan un CÓDIGO: COTIZACION | INTERNACION | DISPOSICION |
-- INTERLABORATORIO | OT_INTERNA. Los textos heredados se conservan tal cual.
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS origen_trabajo        VARCHAR(120);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS numero_ley            VARCHAR(40);  -- Nº resolución DGMN (internación)
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS con_cobro             BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS disposicion_ref       VARCHAR(120); -- IDIC-PG03 6.4 g
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS disposicion_fecha     DATE;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS opi_pendiente         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS opi_numero            VARCHAR(60);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS opi_fecha             DATE;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS opi_registrada_at     TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS centro_costo_id       UUID;         -- lab/sucursal ejecutor
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS lab_solicitante_cc_id UUID;         -- Interlaboratorio: lab que pide
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS horas_hombre          NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS costo_estimado        NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_ot_opi_pendiente ON orden_trabajo (tenant_id) WHERE opi_pendiente;
CREATE INDEX IF NOT EXISTS ix_ot_origen_trabajo ON orden_trabajo (tenant_id, origen_trabajo);

-- Backfill prudente: las OT con cotización y sin origen pasan a COTIZACION.
UPDATE orden_trabajo SET origen_trabajo = 'COTIZACION'
 WHERE origen_trabajo IS NULL AND cotizacion_id IS NOT NULL;

COMMENT ON COLUMN orden_trabajo.con_cobro IS 'FALSE = OT sin cobro (interlaboratorio / disposición sin cobro). Igual registra horas y costo.';
COMMENT ON COLUMN orden_trabajo.opi_pendiente IS 'OT por disposición del Director con cobro, aún sin OPI registrada (SVT7).';

-- -----------------------------------------------------------------------------
-- 4 · Parámetros de negocio (combos) · siembra a todos los tenants
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (id, tenant_id, categoria, codigo, etiqueta, orden, activo, valor)
SELECT gen_random_uuid(), t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.activo, v.valor
FROM tenant t
CROSS JOIN (VALUES
  -- Tipos de cliente (SVT5 / SPC2.2) · valor = regla de validez
  ('tipo_cliente', 'ley_17798',         'Ley 17.798',                       1, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'ejercito',          'Ejército',                         2, TRUE, 'EJERCITO'),
  ('tipo_cliente', 'carabineros',       'Carabineros',                      3, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'fuerza_aerea',      'Fuerza Aérea',                     4, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'armada',            'Armada',                           5, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'pdi',               'PDI',                              6, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'gendarmeria',       'Gendarmería',                      7, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'dgmn',              'DGMN',                             8, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'particulares',      'Particulares',                     9, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'prov_ejercito',     'Particular proveedor Ejército',   10, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'prov_carabineros',  'Particular proveedor Carabineros',11, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'prov_fuerza_aerea', 'Particular proveedor Fuerza Aérea',12, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'prov_armada',       'Particular proveedor Armada',     13, TRUE, 'PARTICULAR'),
  ('tipo_cliente', 'interlaboratorio',  'Interlaboratorio',                14, TRUE, 'PARTICULAR'),
  -- Forma de pago (R1)
  ('forma_pago', 'contado_30',  'Contado 30 días', 1, TRUE, NULL),
  ('forma_pago', 'adelantado',  'Por adelantado',  2, TRUE, NULL),
  -- Estados de cotización (R1) · los históricos se siembran inactivos
  ('estado_cotizacion', 'abierta',   'Abierta',               1, TRUE,  NULL),
  ('estado_cotizacion', 'aceptada',  'Aceptada',              2, TRUE,  NULL),
  ('estado_cotizacion', 'anulada',   'Anulada',               3, TRUE,  NULL),
  ('estado_cotizacion', 'borrador',  'Borrador (histórico)',  10, FALSE, NULL),
  ('estado_cotizacion', 'enviada',   'Enviada (histórico)',   11, FALSE, NULL),
  ('estado_cotizacion', 'rechazada', 'Rechazada (histórico)', 12, FALSE, NULL),
  ('estado_cotizacion', 'expirada',  'Vencida (histórico)',   13, FALSE, NULL),
  -- Formato (R1)
  ('formato_cotizacion', 'NORMAL',        'Normal',        1, TRUE, NULL),
  ('formato_cotizacion', 'PERSONALIZADO', 'Personalizado', 2, TRUE, NULL),
  -- Moneda (R1)
  ('moneda', 'CLP', 'Pesos chilenos (CLP)', 1, TRUE, NULL),
  ('moneda', 'USD', 'Dólar (US$)',          2, TRUE, NULL),
  -- Medio de envío (R1: sin FAX)
  ('medio_envio', 'correo',  'Correo electrónico',        1, TRUE,  NULL),
  ('medio_envio', 'mano',    'Entrega en mano',           2, TRUE,  NULL),
  ('medio_envio', 'courier', 'Correo postal / courier',   3, TRUE,  NULL),
  ('medio_envio', 'fax',     'FAX (retirado)',            9, FALSE, NULL),
  -- Documento de aceptación (SVT6 · IDIC-PG03 6.3 n / 6.4 g)
  ('aceptacion_tipo', 'OPI_RESOLUCION',       'OPI / Resolución (Ejército)',              1, TRUE, NULL),
  ('aceptacion_tipo', 'OC',                   'Orden de compra',                          2, TRUE, NULL),
  ('aceptacion_tipo', 'CORREO',               'Aprobación por correo (particular)',       3, TRUE, NULL),
  ('aceptacion_tipo', 'PAGO_ADELANTADO',      'Comprobante de pago por adelantado',       4, TRUE, NULL),
  ('aceptacion_tipo', 'DISPOSICION_DIRECTOR', 'Disposición del Director (sin OPI previa)',5, TRUE, NULL),
  -- Origen de la OT (SVT7 / SPC2.2)
  ('origen_trabajo', 'COTIZACION',       'Cotización aceptada',              1, TRUE, NULL),
  ('origen_trabajo', 'INTERNACION',      'Internación (resolución DGMN)',    2, TRUE, NULL),
  ('origen_trabajo', 'DISPOSICION',      'Disposición del Director',         3, TRUE, NULL),
  ('origen_trabajo', 'INTERLABORATORIO', 'Interlaboratorio (sin cobro)',     4, TRUE, NULL),
  ('origen_trabajo', 'OT_INTERNA',       'OT interna',                       5, TRUE, NULL),
  -- Validez de cotización (IT DCO-PG01-P01-IT02) · valor numérico
  ('validez_cotizacion', 'particular_dias',        'Particulares: días de validez',               1, TRUE, '45'),
  ('validez_cotizacion', 'ejercito_meses_oct_dic', 'Ejército: meses de validez si se emite oct–dic', 2, TRUE, '6')
) AS v(categoria, codigo, etiqueta, orden, activo, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- Completa `valor` en filas preexistentes (sin pisar ediciones del IDIC).
-- El antiguo 'institucional' (clientes del Ejército sembrados con ese código)
-- conserva la regla Ejército mientras no se reclasifique el cliente.
UPDATE parametro_sistema SET valor = 'EJERCITO'
 WHERE categoria = 'tipo_cliente' AND codigo IN ('ejercito', 'institucional') AND valor IS NULL;
UPDATE parametro_sistema SET valor = 'PARTICULAR'
 WHERE categoria = 'tipo_cliente' AND valor IS NULL;

-- Valores ANTIGUOS: se desactivan (no se borran) → siguen resolviendo la
-- etiqueta de filas históricas, pero ya no se ofrecen en los combos.
UPDATE parametro_sistema SET activo = FALSE, updated_at = now()
 WHERE activo AND (
       (categoria = 'tipo_cliente'      AND codigo IN ('institucional', 'gubernamental', 'externo', 'laboratorio_asociado'))
    OR (categoria = 'forma_pago'        AND codigo IN ('contado', 'credito', 'transferencia', 'cheque', 'tarjeta'))
    OR (categoria = 'tipo_linea_costeo' AND codigo IN ('extension', 'comprension'))
    OR (categoria = 'medio_envio'       AND codigo = 'fax')
 );
