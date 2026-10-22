-- =============================================================================
-- align_r2b_especificacion_tecnica.sql · Especificaciones técnicas del cliente (E.T.)
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql (que siempre es el último de ORDEN_SQL.txt).
-- Reglas: docs/FLUJO_ESPECIFICACIONES_MUESTREO.md. Especificación: EP-03 0.5,
-- 1.3 y 3.6; EP-05 5.1–5.3; EP-02 3.10 (tema transversal T11; backlog BL-042,
-- BL-045, BL-046, BL-049 y, configurable, BL-057 y BL-091).
--
--   1. Biblioteca de E.T. versionada: E.T. (código + versión, cliente o norma,
--      licitación, producto, laboratorios, ¿reutilizable?, estado) con sus
--      puntos (punto, componente, característica, ensayo del catálogo, tipo,
--      requisito Mín/Nom/Máx o texto, segunda condición, plan de 2/3 clases,
--      clase de defecto) y su PDF.
--   2. La OT y la muestra eligen la E.T. (y con ella la versión).
--   3. El resultado guarda de qué punto vino su requisito, la segunda condición
--      con su valor, el plan de clases y la clase de defecto.
--   4. Permisos et.ver y et.gestionar.
--   5. Parámetro de la operación: regla del lote sin Ac/Re (veredicto_lote).
-- =============================================================================

-- --- 1 · Biblioteca ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS especificacion_tecnica (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  codigo          VARCHAR(60)  NOT NULL,
  version         INT          NOT NULL DEFAULT 1,
  nombre          VARCHAR(300) NOT NULL,
  origen          VARCHAR(12)  NOT NULL DEFAULT 'cliente',
  cliente_id      UUID REFERENCES cliente(id),
  mandante        VARCHAR(120),
  licitacion      VARCHAR(120),
  producto        VARCHAR(240),
  cat_elemento_id UUID REFERENCES cat_elemento(id),
  laboratorios    UUID[]       NOT NULL DEFAULT '{}',
  reutilizable    BOOLEAN      NOT NULL DEFAULT true,
  estado          VARCHAR(12)  NOT NULL DEFAULT 'borrador',
  vigente_desde   DATE,
  observaciones   TEXT,
  reemplaza_id    UUID REFERENCES especificacion_tecnica(id),
  motivo_version  TEXT,
  creada_por      UUID REFERENCES usuario(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizada_por UUID REFERENCES usuario(id),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  publicada_por   UUID REFERENCES usuario(id),
  publicada_at    TIMESTAMPTZ,
  anulada_por     UUID REFERENCES usuario(id),
  anulada_at      TIMESTAMPTZ,
  anulada_motivo  TEXT,
  UNIQUE (tenant_id, codigo, version)
);
COMMENT ON TABLE especificacion_tecnica IS 'Biblioteca de especificaciones técnicas del cliente (E.T./EETT) y de normas o reglamentos, versionada (EP-05 5.1, EP-03 0.5). Una versión vigente se congela: se cambia con «Nueva versión».';
COMMENT ON COLUMN especificacion_tecnica.origen IS 'cliente (E.T. de un contrato o licitación) | norma | reglamento (p. ej. RSA) | contrato.';
COMMENT ON COLUMN especificacion_tecnica.laboratorios IS 'Laboratorios donde se usa (alcance de quien la gestiona). Vacío = cualquier laboratorio (solo la gestiona alguien con alcance global).';
COMMENT ON COLUMN especificacion_tecnica.reutilizable IS 'false = solo para OT del mismo cliente (E.T. de una licitación).';
COMMENT ON COLUMN especificacion_tecnica.estado IS 'borrador (se edita) | vigente (se usa en OT) | reemplazada (hay una versión posterior vigente) | anulada.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_et_estado') THEN
    ALTER TABLE especificacion_tecnica ADD CONSTRAINT ck_et_estado CHECK (estado IN ('borrador', 'vigente', 'reemplazada', 'anulada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_et_origen') THEN
    ALTER TABLE especificacion_tecnica ADD CONSTRAINT ck_et_origen CHECK (origen IN ('cliente', 'norma', 'reglamento', 'contrato'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_et_version') THEN
    ALTER TABLE especificacion_tecnica ADD CONSTRAINT ck_et_version CHECK (version >= 1);
  END IF;
END $$;
-- Una sola versión vigente por código.
CREATE UNIQUE INDEX IF NOT EXISTS uq_et_vigente ON especificacion_tecnica (tenant_id, codigo) WHERE estado = 'vigente';
CREATE INDEX IF NOT EXISTS ix_et_tenant_estado ON especificacion_tecnica (tenant_id, estado);
CREATE INDEX IF NOT EXISTS ix_et_cliente ON especificacion_tecnica (cliente_id) WHERE cliente_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS especificacion_tecnica_punto (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  et_id           UUID NOT NULL REFERENCES especificacion_tecnica(id) ON DELETE CASCADE,
  orden           INT          NOT NULL DEFAULT 0,
  punto           VARCHAR(40)  NOT NULL,
  componente      VARCHAR(120),
  caracteristica  VARCHAR(300) NOT NULL,
  cat_metodo_id   UUID REFERENCES cat_metodo(id),
  cat_analito_id  UUID REFERENCES cat_analito(id),
  laboratorio_id  UUID REFERENCES unidad(id),
  tipo            VARCHAR(12)  NOT NULL DEFAULT 'numerico',
  limite_inf      VARCHAR(120),
  nominal         VARCHAR(120),
  limite_sup      VARCHAR(120),
  unidad          VARCHAR(30),
  requisito       TEXT,
  cond2_etiqueta  VARCHAR(120),
  cond2_inf       NUMERIC(18,6),
  cond2_sup       NUMERIC(18,6),
  cond2_unidad    VARCHAR(30),
  plan_n          INT,
  plan_c          INT,
  plan_m          NUMERIC(18,6),
  plan_mm         NUMERIC(18,6),
  clase_defecto   VARCHAR(10),
  observacion     TEXT
);
COMMENT ON TABLE especificacion_tecnica_punto IS 'Puntos de la E.T.: Punto · Componente · Característica · Ensayo · Tipo · Requisito · Unidad (EP-05 5.1, EP-03 1.3).';
COMMENT ON COLUMN especificacion_tecnica_punto.componente IS 'Componente del producto (LCC: planta, cambrillón…; LTX: tela base, hilo…). Vacío = el producto. Con componente se desglosa una submuestra (EP-03 1.3).';
COMMENT ON COLUMN especificacion_tecnica_punto.tipo IS 'numerico | atributo | inspeccion (checklist del producto, no es muestra) | clases (plan de 2/3 clases n, c, m, M del RSA).';
COMMENT ON COLUMN especificacion_tecnica_punto.cond2_etiqueta IS 'Segunda condición de la misma fila («X kgf con Y mm», EP-03 3.6): qué se mide y su Mín/Máx.';
COMMENT ON COLUMN especificacion_tecnica_punto.plan_mm IS 'M del plan de 3 clases (NULL = 2 clases).';
COMMENT ON COLUMN especificacion_tecnica_punto.clase_defecto IS 'critico | mayor | menor: clase con que cuenta una no conformidad en el veredicto del lote (EP-05 5.2).';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_et_punto_tipo') THEN
    ALTER TABLE especificacion_tecnica_punto ADD CONSTRAINT ck_et_punto_tipo CHECK (tipo IN ('numerico', 'atributo', 'inspeccion', 'clases'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_et_punto_clase') THEN
    ALTER TABLE especificacion_tecnica_punto ADD CONSTRAINT ck_et_punto_clase CHECK (clase_defecto IS NULL OR clase_defecto IN ('critico', 'mayor', 'menor'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_et_punto_et ON especificacion_tecnica_punto (et_id, orden);

CREATE TABLE IF NOT EXISTS especificacion_tecnica_pdf (
  et_id       UUID PRIMARY KEY REFERENCES especificacion_tecnica(id) ON DELETE CASCADE,
  nombre      VARCHAR(200) NOT NULL,
  bytes       INT          NOT NULL,
  hash_sha256 VARCHAR(64)  NOT NULL,
  datos       TEXT         NOT NULL,
  subido_por  UUID REFERENCES usuario(id),
  subido_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE especificacion_tecnica_pdf IS 'PDF de la E.T. (base64, máx. 10 MB). Cada versión tiene el suyo.';

-- --- 2 · La OT y la muestra eligen la E.T. ------------------------------------
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS et_id          UUID REFERENCES especificacion_tecnica(id);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS et_asignada_por UUID REFERENCES usuario(id);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS et_asignada_at  TIMESTAMPTZ;
ALTER TABLE muestra       ADD COLUMN IF NOT EXISTS et_id          UUID REFERENCES especificacion_tecnica(id);
ALTER TABLE muestra       ADD COLUMN IF NOT EXISTS et_componente  VARCHAR(120);
COMMENT ON COLUMN orden_trabajo.et_id IS 'E.T. del cliente (versión concreta) que rige la OT (EP-03 0.5, EP-05 0.3). La muestra puede tener la suya (muestra.et_id).';
COMMENT ON COLUMN muestra.et_componente IS 'Componente de la E.T. de esta submuestra (desglose producto → componentes, EP-03 1.3). Su padre es parent_muestra_id.';
CREATE INDEX IF NOT EXISTS ix_muestra_parent ON muestra (parent_muestra_id) WHERE parent_muestra_id IS NOT NULL;

-- --- 3 · Resultado -----------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS et_punto_id       UUID REFERENCES especificacion_tecnica_punto(id) ON DELETE SET NULL;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS espec_fuente      VARCHAR(240);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS condicion2        JSONB;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS valor_condicion2  NUMERIC(18,6);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS plan_clases       JSONB;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS clase_defecto     VARCHAR(10);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS clase_defecto_por UUID REFERENCES usuario(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS clase_defecto_at  TIMESTAMPTZ;
COMMENT ON COLUMN resultado.espec_fuente IS 'De dónde viene el requisito cuando no es el catálogo: «E.T. <código> v<n> · punto <p>». espec_origen = et.';
COMMENT ON COLUMN resultado.condicion2 IS 'Segunda condición del requisito {etiqueta, inf, sup, unidad}; su valor en valor_condicion2.';
COMMENT ON COLUMN resultado.plan_clases IS 'Plan de 2/3 clases {n, c, m, M}: cada réplica es una unidad (requisito-compuesto.ts).';
COMMENT ON COLUMN resultado.clase_defecto IS 'Clase de la no conformidad (critico | mayor | menor) para el veredicto del lote; la trae el punto de la E.T. y la cambia la jefatura.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_resultado_clase_defecto') THEN
    ALTER TABLE resultado ADD CONSTRAINT ck_resultado_clase_defecto CHECK (clase_defecto IS NULL OR clase_defecto IN ('critico', 'mayor', 'menor'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_resultado_et_punto ON resultado (et_punto_id) WHERE et_punto_id IS NOT NULL;

-- --- 4 · Permisos ------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'et.ver', 'et', 'ver',
   'Consultar la biblioteca de especificaciones técnicas del cliente (E.T.), sus versiones, puntos y PDF'),
  (gen_random_uuid(), 'et.gestionar', 'et', 'gestionar',
   'Crear, editar, publicar, versionar y anular E.T. de los laboratorios de su alcance (las E.T. sin laboratorio, solo con alcance global)')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'et.ver'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'ANALISTA', 'ANALISTA_SR', 'REVISOR', 'TECNICO', 'INSPECTOR', 'METROLOGO',
                    'JEFE_LAB', 'JEFELAB', 'JEFE_SECCION', 'JEFE_DEPTO', 'CALIDAD', 'COMERCIAL', 'PLANIFICACION',
                    'PLANIFICADOR_LAB', 'MUESTREO', 'RECEPCION', 'DIRECTOR', 'SUBDIRECTOR', 'LECTOR')
ON CONFLICT DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'et.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'JEFE_LAB', 'JEFELAB', 'JEFE_SECCION', 'JEFE_DEPTO', 'CALIDAD')
ON CONFLICT DO NOTHING;

-- --- 5 · Parámetro de la operación (Administración › Parámetros del sistema) --
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'veredicto_lote', 'regla_sin_plan',
       'Clase sin Ac/Re en el plan (cualquier_nc | critica_o_mayor)', 1, 'cualquier_nc'
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
