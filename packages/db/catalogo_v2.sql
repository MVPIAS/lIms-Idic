-- =============================================================================
-- catalogo_v2.sql  ·  ESQUEMA DEFINITIVO del CATÁLOGO CORREGIDO (LIMS IDIC)
-- -----------------------------------------------------------------------------
-- Cascada real StarLIMS: 5 niveles de PRODUCTO + 4 niveles de ANÁLISIS + bisagra.
-- Fuente: exportación StarLIMS "CSV LIMS 2026-07-02" (207 CSV, parseo real).
-- Referencia de diseño: 06_entregables_cliente/ESQUEMA_CATALOGO_CORREGIDO.md
--
-- CARACTERÍSTICAS (obligatorias por el encargo):
--   * ADITIVO      : sólo CREATE TABLE IF NOT EXISTS con prefijo cat_. NO toca ni
--                    borra gran_grupo / grupo / metodo actuales (coexisten hasta
--                    la fase 2 de refactor de la app). La app viva sigue intacta.
--   * IDEMPOTENTE  : todo IF NOT EXISTS; re-ejecutable sin error.
--   * MULTI-TENANT : cada tabla lleva tenant_id UUID REFERENCES tenant(id),
--                    created_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ (soft-delete).
--   * CLAVE NATURAL: UNIQUE (tenant_id, <codigo legacy>) por nivel -> permite
--                    UPSERT idempotente desde los CSV (ver seed_catalogo_v2.sql).
--
-- Aplicar:  psql "$DATABASE_URL" -f packages/db/catalogo_v2.sql
--           (requiere que schema.sql ya haya creado la tabla tenant)
-- PostgreSQL 14+.  Usa gen_random_uuid() (extensión pgcrypto o PG13+ nativo).
-- =============================================================================

-- ============================================================ EJE PRODUCTO (5)
-- Nivel 1 · Gran Grupo  <-  GGRUPO (15 filas; 12 con código útil)
CREATE TABLE IF NOT EXISTS cat_gran_grupo (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenant(id),
  codigo     VARCHAR(20)  NOT NULL,               -- GGRUPO.CODIGO  ('E','A','P'...)
  nombre     VARCHAR(160) NOT NULL,               -- GGRUPO.GGRUPO
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);

-- Nivel 2 · Grupo  <-  GRUPO_ELEM (207 filas)
CREATE TABLE IF NOT EXISTS cat_grupo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  gran_grupo_id  UUID NOT NULL REFERENCES cat_gran_grupo(id),  -- via GRUPO_ELEM.CODIGO
  cgrupo         VARCHAR(20)  NOT NULL,            -- GRUPO_ELEM.CGRUPO
  nombre         VARCHAR(200) NOT NULL,            -- GRUPO_ELEM.GRUPO
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  UNIQUE (tenant_id, gran_grupo_id, cgrupo)
);

-- Nivel 3 · SubGrupo  <-  CNTRLROOMS (1.429 filas; "Control Rooms" reutilizado)
CREATE TABLE IF NOT EXISTS cat_subgrupo (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenant(id),
  grupo_id   UUID NOT NULL REFERENCES cat_grupo(id),          -- via (CODIGO,CGRUPO)
  cntlroom   VARCHAR(30)  NOT NULL,               -- CNTRLROOMS.CNTLROOM
  nombre     VARCHAR(240) NOT NULL,               -- CNTRLROOMS.CNTRLROOMDES
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, cntlroom)
);

-- Nivel 4 · Familia (= Laboratorio)  <-  SUCURDELEG (72 filas) · dimensión lateral
CREATE TABLE IF NOT EXISTS cat_familia (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  codsucdel    VARCHAR(30)  NOT NULL,             -- SUCURDELEG.CODSUCDEL
  nombre       VARCHAR(200) NOT NULL,             -- SUCURDELEG.NOMSUCDEL
  laboratorio  VARCHAR(200),                      -- SUCURDELEG.LABORATORIO
  departamento VARCHAR(200),                      -- SUCURDELEG.DEPARTAMENTO
  subdireccion VARCHAR(200),                      -- SUCURDELEG.SUBDIRECCION
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, codsucdel)
);

-- Nivel 5 · Elemento (HOJA)  <-  UNITS (7.157 filas). Lleva denormalizadas las 4
-- claves padre; aquí modelamos las FK estrictas (subgrupo + familia lateral).
CREATE TABLE IF NOT EXISTS cat_elemento (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  subgrupo_id UUID NOT NULL REFERENCES cat_subgrupo(id),      -- UNITS.CNTLROOM
  familia_id  UUID REFERENCES cat_familia(id),                -- UNITS.CODSUCDEL (38 sin resolver)
  codigo      VARCHAR(30)  NOT NULL,              -- UNITS.UNIT      (el "Código" read-only)
  nombre      VARCHAR(240) NOT NULL,              -- UNITS.UNITNAME  (el "Elemento")
  servgrp     VARCHAR(240),                       -- SERVGRP.SERVGRP (grupo de servicio, gemelo)
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);

-- ============================================================ EJE ANÁLISIS (4)
-- Nivel 1 · Ensayo  <-  ANALISIS (1.749 filas). AQUÍ vive el PRECIO (520 con precio>0).
CREATE TABLE IF NOT EXISTS cat_ensayo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30)  NOT NULL,        -- ANALISIS.CODANALI
  nombre              VARCHAR(240) NOT NULL,        -- ANALISIS.NOMBRE / TESTNO / DESCANALI
  precio              NUMERIC(14,2) NOT NULL DEFAULT 0,  -- ANALISIS.PRECIO
  familia_id          UUID REFERENCES cat_familia(id),   -- ANALISIS.CODSUCDEL (area/lab)
  agrupado            VARCHAR(30),                  -- ANALISIS.AGRUPADO
  objetivo            TEXT,                         -- ANALISIS.OBJETIVO
  instruccion_trabajo TEXT,                         -- ANALISIS.INTRABAJO
  activo              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);

-- Nivel 2 · Método  <-  TESTS (7.676 filas; 7.673 enlazan a ensayo por CODANALI)
CREATE TABLE IF NOT EXISTS cat_metodo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  ensayo_id   UUID REFERENCES cat_ensayo(id),       -- TESTS.CODANALI -> ANALISIS
  codigo      VARCHAR(30)  NOT NULL,                -- TESTS.TESTCODE
  nombre      VARCHAR(240) NOT NULL,                -- TESTS.TESTNAM / TESTDESC / TESTNO
  norma       VARCHAR(240),                         -- TESTS.INTRABAJO (norma / IT)
  instrumento VARCHAR(160),                         -- TESTS.INSTR
  version     VARCHAR(30),                          -- TESTS.VER
  servgrp     VARCHAR(240),                         -- TESTS.SERVGRP
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);

-- Nivel 3 · Analito  <-  ANALYTES (11.904 filas). Clave natural (metodo, ANALYTE).
-- rango_* se dejan TEXT: el CSV contiene valores no numéricos ('cumple','Declarado').
CREATE TABLE IF NOT EXISTS cat_analito (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  metodo_id      UUID NOT NULL REFERENCES cat_metodo(id),     -- ANALYTES.TESTCODE -> TESTS
  codigo         VARCHAR(120) NOT NULL,            -- ANALYTES.ANALYTE (identificador del analito)
  nombre         VARCHAR(240) NOT NULL,            -- ANALYTES.ANALYTE / SINONYM
  unidad         VARCHAR(60),                      -- ANALYTES.UNITS
  formula        TEXT,                             -- ANALYTES.FORMULA / CALCUL
  rango_min      VARCHAR(120),                     -- ANALYTES.LOW
  rango_nominal  VARCHAR(120),                     -- ANALYTES.NOMINAL
  rango_max      VARCHAR(120),                     -- ANALYTES.HIGH
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  UNIQUE (tenant_id, metodo_id, codigo)
);

-- Nivel 4 · Especificación  <-  ANSPECS (235.963 instancias por muestra/SCODE).
-- Se carga el MAESTRO deduplicado (definiciones distintas de límite), no la
-- instancia transaccional por muestra. dedupe_key = hash del contenido para upsert.
CREATE TABLE IF NOT EXISTS cat_especificacion (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  analito_id   UUID NOT NULL REFERENCES cat_analito(id),      -- via (TESTCODE, ANALYTE)
  ambito       VARCHAR(16) NOT NULL DEFAULT 'estandar',       -- estandar|cliente|producto|muestra
  limite_inf   VARCHAR(120),                      -- ANSPECS.LOWA
  nominal      VARCHAR(120),                      -- ANSPECS.NOMINAL
  limite_sup   VARCHAR(120),                      -- ANSPECS.HIGHA
  requisitos   TEXT,                              -- ANSPECS.REQUISITOS
  texto        TEXT,                              -- ANSPECS.TEXT
  unidad       VARCHAR(60),                       -- ANSPECS.UNITS
  dedupe_key   VARCHAR(40) NOT NULL,              -- md5(contenido) para idempotencia
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, analito_id, dedupe_key)
);

-- ==================================================== BISAGRA producto<->análisis
-- cat_panel <- PROFDES (132.198) resuelto por SOURCES.UNIT -> elemento.
-- Maestro "qué métodos aplican a cada Elemento" (perfil deduplicado por muestra).
CREATE TABLE IF NOT EXISTS cat_panel (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  elemento_id UUID NOT NULL REFERENCES cat_elemento(id),      -- SOURCES.UNIT -> UNITS
  metodo_id   UUID NOT NULL REFERENCES cat_metodo(id),        -- PROFDES.TESTCODE -> TESTS
  ensayo_id   UUID REFERENCES cat_ensayo(id),                 -- derivado (metodo.ensayo_id)
  inspec_tipo VARCHAR(30),                         -- PROFDES.INSPECTYPE (representativo)
  orden       INT,                                 -- PROFDES.ORDEN (mínimo por par)
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, elemento_id, metodo_id)
);

-- ------------------------------------------------------------------- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_cat_gg_tenant       ON cat_gran_grupo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_grupo_tenant    ON cat_grupo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_grupo_gg        ON cat_grupo(gran_grupo_id);
CREATE INDEX IF NOT EXISTS idx_cat_subgrupo_tenant ON cat_subgrupo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_subgrupo_grupo  ON cat_subgrupo(grupo_id);
CREATE INDEX IF NOT EXISTS idx_cat_familia_tenant  ON cat_familia(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_elemento_tenant ON cat_elemento(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_elemento_sub    ON cat_elemento(subgrupo_id);
CREATE INDEX IF NOT EXISTS idx_cat_elemento_fam    ON cat_elemento(familia_id);
CREATE INDEX IF NOT EXISTS idx_cat_ensayo_tenant   ON cat_ensayo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_ensayo_fam      ON cat_ensayo(familia_id);
CREATE INDEX IF NOT EXISTS idx_cat_metodo_tenant   ON cat_metodo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_metodo_ensayo   ON cat_metodo(ensayo_id);
CREATE INDEX IF NOT EXISTS idx_cat_analito_tenant  ON cat_analito(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_analito_metodo  ON cat_analito(metodo_id);
CREATE INDEX IF NOT EXISTS idx_cat_espec_tenant    ON cat_especificacion(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_espec_analito   ON cat_especificacion(analito_id);
CREATE INDEX IF NOT EXISTS idx_cat_panel_tenant    ON cat_panel(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cat_panel_elem      ON cat_panel(elemento_id);
CREATE INDEX IF NOT EXISTS idx_cat_panel_metodo    ON cat_panel(metodo_id);

-- =============================================================================
-- FIN DDL. La carga de datos MAESTROS reales va en seed_catalogo_v2.sql
-- (generado desde los CSV por 07_migracion/build_seed_catalogo_v2.py).
-- =============================================================================
