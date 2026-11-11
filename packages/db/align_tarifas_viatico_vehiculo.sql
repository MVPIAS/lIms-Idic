-- =============================================================================
-- LIMS IDIC · Tarifas de viáticos y de vehículos · Aiuken
--   Contrato 4.1.4 · costeo de servicios (FORM05) con los costos estándar del
--   IDIC (DCO-PG01-P05-IT01 «Costo estándar de los recursos»):
--   · Escala de viáticos por grado jerárquico (monto diario al 100 %; el
--     costeo aplica el % del grado: 100, 60, 40 o 20).
--   · Costo por kilómetro por categoría de vehículo.
--   · Precio de un cliente Ejército = costo directo de la lista vigente
--     (DCO-PG01-P05-IT05 «Política de precios»): nueva opción del parámetro.
-- Las tablas nacen vacías: los valores del IDIC se cargan aparte (no son
-- datos del repositorio). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tarifa_viatico (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  -- nacional | extranjero
  ambito         VARCHAR(12)   NOT NULL DEFAULT 'nacional',
  -- País (extranjero) o vacío (nacional: misma escala para todo Chile).
  pais           VARCHAR(80),
  grado_desde    INT           NOT NULL,
  grado_hasta    INT           NOT NULL,
  -- «GDE - GDD», «CAP - ALF - SG1 - ECL»…
  denominacion   VARCHAR(120),
  -- Monto diario al 100 %, en la moneda indicada.
  monto_diario   NUMERIC(14,2) NOT NULL,
  moneda         VARCHAR(3)    NOT NULL DEFAULT 'CLP',
  vigente_desde  DATE          NOT NULL,
  vigente_hasta  DATE,
  activo         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_tarifa_viatico_ambito CHECK (ambito IN ('nacional', 'extranjero')),
  CONSTRAINT ck_tarifa_viatico_grados CHECK (grado_desde >= 1 AND grado_hasta >= grado_desde),
  CONSTRAINT ck_tarifa_viatico_valor CHECK (monto_diario >= 0 AND (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tarifa_viatico
  ON tarifa_viatico (tenant_id, ambito, COALESCE(pais, ''), grado_desde, vigente_desde);

CREATE TABLE IF NOT EXISTS tarifa_vehiculo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  -- Automóvil, camioneta, bus, camión, furgón, minibús…
  categoria      VARCHAR(40)   NOT NULL,
  descripcion    VARCHAR(200),
  -- Costo neto por km: reposición + mantenciones + combustible + seguros.
  costo_km_clp   NUMERIC(14,2) NOT NULL,
  vigente_desde  DATE          NOT NULL,
  vigente_hasta  DATE,
  activo         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_tarifa_vehiculo_valor CHECK (costo_km_clp >= 0 AND (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)),
  CONSTRAINT uq_tarifa_vehiculo UNIQUE (tenant_id, categoria, vigente_desde)
);

-- Metabase lee con el rol de solo lectura (align_brechas_6.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lims_lectura') THEN
    EXECUTE 'GRANT SELECT ON tarifa_viatico, tarifa_vehiculo TO lims_lectura';
  END IF;
END $$;
