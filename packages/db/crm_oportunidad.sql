-- ============================================================
-- CRM · OPORTUNIDADES · LIMS IDIC · Aiuken
-- Registra una oferta/oportunidad comercial SIN necesidad de crear
-- una cotización formal. Estados: viva / ganada / perdida / cerrada.
-- Se puede convertir a cotización u OT (hooks cotizacion_id / ot_id).
-- Idempotente (IF NOT EXISTS). Las oportunidades de ejemplo: seed_crm_oportunidad_demo.sql. Requiere pgcrypto
-- (gen_random_uuid) y la función set_updated_at(), ambas definidas en schema.sql.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS oportunidad (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id),
  codigo                  VARCHAR(30) UNIQUE,                 -- OPP-2026-NNNN
  titulo                  VARCHAR(200) NOT NULL,
  cliente_id              UUID REFERENCES cliente(id),
  contacto                VARCHAR(160),
  monto_estimado          NUMERIC(14,2) DEFAULT 0,
  moneda                  VARCHAR(3) DEFAULT 'CLP',
  probabilidad            INT DEFAULT 50,                     -- 0..100
  etapa                   VARCHAR(30) DEFAULT 'prospecto',    -- prospecto, calificada, propuesta, negociacion, ganada, perdida
  estado                  VARCHAR(20) DEFAULT 'viva',         -- viva, ganada, perdida, cerrada
  origen                  VARCHAR(60),                        -- referido, licitacion, web, evento, ...
  fecha_cierre_estimada   DATE,
  notas                   TEXT,
  cotizacion_id           UUID,                               -- hook: conversión a cotización
  ot_id                   UUID,                               -- hook: conversión a OT
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oportunidad_tenant        ON oportunidad(tenant_id)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oportunidad_tenant_estado ON oportunidad(tenant_id, estado)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oportunidad_tenant_etapa  ON oportunidad(tenant_id, etapa)   WHERE deleted_at IS NULL;

-- Trigger de updated_at (idempotente: se recrea si ya existe).
DROP TRIGGER IF EXISTS trg_oportunidad_updated ON oportunidad;
CREATE TRIGGER trg_oportunidad_updated
  BEFORE UPDATE ON oportunidad
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Los datos de ejemplo que sembraba este fichero están en seed_crm_oportunidad_demo.sql (solo demo,
-- ORDEN_SQL.txt), para que la instalación «sin-demo» no cargue datos inventados.

COMMIT;
