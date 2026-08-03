-- =============================================================================
-- align_pasos_metodo.sql  ·  PASOS / CAMPOS EDITABLES POR ENSAYO (método)
-- -----------------------------------------------------------------------------
-- En el manual de StarLIMS, al crear la O/T se baja hasta el ENSAYO y ahí se
-- definen los PASOS/campos que el analista debe capturar (p.ej. "Fuerza",
-- "Area", "Masa Inicial"). Esta tabla modela esa definición como entidad
-- editable, colgando de cat_metodo (el método/ensayo del catálogo v2).
--
-- Fuente de datos real: ANALFIELDS.csv de la exportación StarLIMS
-- "CSV LIMS 2026-07-02", que define POR ENSAYO los campos ordenados
--   TESTCODE (=cat_metodo.codigo) · PROPIEDAD (nombre del paso) · SORTER (orden)
--   TAMANIO · MASK (formato).
-- El texto narrativo del procedimiento NO está en la data (sólo el código de
-- Instrucción de Trabajo INTRABAJO en TESTS/cat_metodo.norma), por eso la
-- columna `instruccion` es TEXT libre, editable, inicialmente vacía.
--
-- CARACTERÍSTICAS (obligatorias por el encargo):
--   * ADITIVO      : sólo CREATE TABLE IF NOT EXISTS. No toca ninguna tabla viva.
--   * IDEMPOTENTE  : todo IF NOT EXISTS; re-ejecutable sin error.
--   * MULTI-TENANT : tenant_id UUID REFERENCES tenant(id); created_at / deleted_at.
--   * CLAVE NATURAL: UNIQUE (tenant_id, cat_metodo_id, orden, nombre) -> permite el
--                    UPSERT idempotente ON CONFLICT DO NOTHING desde ANALFIELDS
--                    (ver seed_pasos_metodo.sql, generado por build_seed_pasos.py).
--
-- Aplicar:  psql "$DATABASE_URL" -f packages/db/align_pasos_metodo.sql
--           (requiere schema.sql -> tenant, y catalogo_v2.sql -> cat_metodo)
-- PostgreSQL 14+.  Usa gen_random_uuid() (PG13+ nativo / extensión pgcrypto).
-- =============================================================================

CREATE TABLE IF NOT EXISTS paso_metodo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  cat_metodo_id UUID NOT NULL REFERENCES cat_metodo(id),
  orden         INT  NOT NULL DEFAULT 0,             -- ANALFIELDS.SORTER
  nombre        VARCHAR(200) NOT NULL,               -- ANALFIELDS.PROPIEDAD (el campo/paso)
  tipo_dato     VARCHAR(30)  NOT NULL DEFAULT 'numero',  -- numero | texto | seleccion
  unidad        VARCHAR(40),                         -- unidad de captura (editable)
  formato       VARCHAR(40),                         -- ANALFIELDS.MASK (máscara de formato)
  instruccion   TEXT,                                -- texto del procedimiento, editable, inicialmente vacío
  obligatorio   BOOLEAN NOT NULL DEFAULT true,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- tipo_dato acotado a los tres valores del encargo (idempotente: sólo si falta).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'paso_metodo_tipo_dato_chk'
  ) THEN
    ALTER TABLE paso_metodo
      ADD CONSTRAINT paso_metodo_tipo_dato_chk
      CHECK (tipo_dato IN ('numero', 'texto', 'seleccion'));
  END IF;
END $$;

-- Clave natural para UPSERT idempotente desde ANALFIELDS (un paso = un campo
-- ordenado dentro de un método). orden+nombre distinguen filas del mismo método.
CREATE UNIQUE INDEX IF NOT EXISTS uq_paso_metodo_natural
  ON paso_metodo (tenant_id, cat_metodo_id, orden, nombre);

-- Índice de lectura pedido por el encargo (listar los pasos de un método en orden).
CREATE INDEX IF NOT EXISTS idx_paso_metodo_orden
  ON paso_metodo (tenant_id, cat_metodo_id, orden);

-- =============================================================================
-- FIN DDL. La carga desde la data real va en seed_pasos_metodo.sql
-- (generado desde ANALFIELDS.csv por 07_migracion/build_seed_pasos.py).
-- =============================================================================
