-- ============================================================
-- CRM · OPORTUNIDADES · LIMS IDIC · Aiuken
-- Registra una oferta/oportunidad comercial SIN necesidad de crear
-- una cotización formal. Estados: viva / ganada / perdida / cerrada.
-- Se puede convertir a cotización u OT (hooks cotizacion_id / ot_id).
-- Idempotente (IF NOT EXISTS + seed con ON CONFLICT). Requiere pgcrypto
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

-- ------------------------------------------------------------
-- Seed idempotente: ~6 oportunidades del tenant IDIC, ligadas a
-- clientes existentes por RUT (subselect). Etapas/montos variados.
-- La unicidad de `codigo` hace idempotente el re-run (ON CONFLICT).
-- ------------------------------------------------------------
INSERT INTO oportunidad
  (tenant_id, codigo, titulo, cliente_id, contacto, monto_estimado, moneda, probabilidad, etapa, estado, origen, fecha_cierre_estimada, notas)
SELECT
  t.id,
  v.codigo,
  v.titulo,
  (SELECT c.id FROM cliente c WHERE c.tenant_id = t.id AND c.rut = v.rut AND c.deleted_at IS NULL LIMIT 1),
  v.contacto,
  v.monto,
  'CLP',
  v.prob,
  v.etapa,
  v.estado,
  v.origen,
  v.cierre,
  v.notas
FROM tenant t, (VALUES
  ('OPP-2026-0001','Renovación análisis de aceros estructurales', '91.021.000-9','Ing. P. Muñoz',  48500000, 60, 'propuesta',   'viva',    'referido',   DATE '2026-09-30','Propuesta enviada; pendiente aprobación técnica del cliente.'),
  ('OPP-2026-0002','Ensayos balísticos munición 5.56 lote 2026',  '61.104.000-8','Cap. R. Torres',  92000000, 75, 'negociacion', 'viva',    'licitacion', DATE '2026-08-15','En negociación de plazos y penalidades.'),
  ('OPP-2026-0003','Servicio de peritaje armas incautadas',       '71.541.400-7','Subof. L. Rojas', 15300000, 40, 'calificada',  'viva',    'evento',     DATE '2026-10-20','Levantamiento de requisitos con DEPTOL5.'),
  ('OPP-2026-0004','Control de calidad alimentos programa escolar','61.219.000-3','Sra. C. Díaz',    27800000, 30, 'prospecto',   'viva',    'web',        DATE '2026-11-10','Primer contacto; interesados en acreditación.'),
  ('OPP-2026-0005','Certificación fitosanitaria exportación',     '61.307.000-1','Ing. A. Vega',    36400000,100, 'ganada',      'ganada',  'referido',   DATE '2026-06-01','Adjudicada. Pasar a cotización/OT.'),
  ('OPP-2026-0006','Auditoría metrológica movilización',          '61.101.049-4','Tte. F. Soto',    21000000,  0, 'perdida',     'perdida', 'licitacion', DATE '2026-05-15','Perdida: presupuesto adjudicado a competidor.')
) AS v(codigo, titulo, rut, contacto, monto, prob, etapa, estado, origen, cierre, notas)
WHERE t.codigo = 'IDIC'
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
