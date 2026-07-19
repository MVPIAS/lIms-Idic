-- =============================================================================
-- align_ot_correlativo.sql · Correlativo ATÓMICO de OT (OT-AAAA-NNNN)
-- -----------------------------------------------------------------------------
-- Arregla el bug conocido (docs/AUDITORIA_FUNCIONAL.md §5.15): `generarCodigoOt`
-- era un read-then-write sin bloqueo -> dos altas concurrentes calculaban el
-- mismo correlativo y la segunda chocaba contra UNIQUE(tenant_id, codigo) => 500.
-- Además `orderBy codigo desc` es lexicográfico y se rompía al pasar de 9999.
--
-- Solución: contador por (tenant, año) incrementado con
--   INSERT ... ON CONFLICT DO UPDATE ... RETURNING
-- que PostgreSQL garantiza atómico bajo concurrencia (misma técnica ya usada por
-- certificado_correlativo). Aditivo e idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ot_correlativo (
  tenant_id  UUID    NOT NULL REFERENCES tenant(id),
  anio       INTEGER NOT NULL,
  ultimo     INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, anio)
);

COMMENT ON TABLE ot_correlativo IS
  'Contador atómico del correlativo de OT por tenant y anio (OT-AAAA-NNNN). Se incrementa con INSERT ... ON CONFLICT DO UPDATE RETURNING dentro de la transaccion que crea la OT.';

-- Siembra el contador con el máximo ya emitido por tenant/año para CONTINUAR la
-- numeración sobre una BD con OT previas (no reinicia, no choca con el UNIQUE).
-- El substring numérico se castea a INT (no lexicográfico) y se toma el MAX real.
INSERT INTO ot_correlativo (tenant_id, anio, ultimo)
SELECT o.tenant_id,
       (substring(o.codigo from '^OT-(\d{4})-'))::INT AS anio,
       MAX((substring(o.codigo from '^OT-\d{4}-(\d+)$'))::INT)
FROM orden_trabajo o
WHERE o.codigo ~ '^OT-\d{4}-\d+$'
GROUP BY o.tenant_id, (substring(o.codigo from '^OT-(\d{4})-'))::INT
ON CONFLICT (tenant_id, anio) DO NOTHING;
