-- =============================================================================
-- align_ibis_testigos.sql · Evidencias de prueba («evidencias blancas») de IBIS
--
-- Cada arma importada se dispara en el banco de pruebas y deja dos evidencias:
-- la vaina (Cartridge Case) y el proyectil (Bullet). El XML diario de IBIS
-- (ESI 3.2) trae cada una como <Exhibit> con <TestFirearmExhibitUUID> = UUID
-- del arma. El ETL las guarda aquí y, cuando el arma está asociada a su OT,
-- crea la evidencia en el banco de evidencias ligada al arma y a la OT.
-- La ubicación de la evidencia sigue siendo TEXTO (el IDIC no tiene aún una
-- clasificación de almacén): «Almacén · estante · línea · caja».
-- Idempotente.
-- =============================================================================

ALTER TABLE evidencia ADD COLUMN IF NOT EXISTS arma_id UUID REFERENCES arma(id);
ALTER TABLE evidencia ADD COLUMN IF NOT EXISTS fecha_disparo TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ix_evidencia_arma ON evidencia (tenant_id, arma_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_evidencia_exhibit ON evidencia (tenant_id, upper(exhibit_number)) WHERE deleted_at IS NULL;
COMMENT ON COLUMN evidencia.arma_id IS 'Arma con la que se disparó la evidencia de prueba (vaina o proyectil de IBIS).';
COMMENT ON COLUMN evidencia.fecha_disparo IS 'Fecha del disparo / adquisición en IBIS de la evidencia de prueba.';

CREATE TABLE IF NOT EXISTS ibis_testigo (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenant(id),
  ibis_importacion_id  UUID REFERENCES ibis_importacion(id),
  uuid_ibis            VARCHAR(80) NOT NULL,
  exhibit_number       VARCHAR(80),
  tipo                 VARCHAR(20) NOT NULL CHECK (tipo IN ('vainilla', 'proyectil')),
  firearm_uuid         VARCHAR(80) NOT NULL,
  calibre              VARCHAR(120),
  firing_pin_shape     VARCHAR(120),
  breech_face_class    VARCHAR(40),
  hit_count            INTEGER NOT NULL DEFAULT 0,
  fecha_disparo        TIMESTAMPTZ,
  datos                JSONB,
  evidencia_id         UUID REFERENCES evidencia(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ibis_testigo_uuid ON ibis_testigo (tenant_id, uuid_ibis) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ibis_testigo_arma ON ibis_testigo (tenant_id, firearm_uuid) WHERE deleted_at IS NULL;
COMMENT ON TABLE ibis_testigo IS 'Vainas y proyectiles de prueba que trae el XML de IBIS (TestFirearmExhibitUUID = arma). Origen de las evidencias blancas.';

-- Certificado por arma (CERTARMA): bloque con el resultado de IBIS antes del QR.
-- Se actualiza la plantilla y su versión vigente solo si aún no tienen el bloque.
UPDATE plantilla_informe
   SET cuerpo_html = replace(cuerpo_html, '{{qr_verificacion}}', E'{{ibis_arma}}\n\n{{qr_verificacion}}')
 WHERE repid = 'CERTARMA' AND cuerpo_html LIKE '%{{qr_verificacion}}%' AND cuerpo_html NOT LIKE '%{{ibis_arma}}%';

DO $$
BEGIN
  IF to_regclass('public.plantilla_informe_version') IS NOT NULL THEN
    UPDATE plantilla_informe_version v
       SET cuerpo_html = replace(v.cuerpo_html, '{{qr_verificacion}}', E'{{ibis_arma}}\n\n{{qr_verificacion}}')
      FROM plantilla_informe p
     WHERE p.id = v.plantilla_id AND p.repid = 'CERTARMA' AND v.estado = 'VIGENTE'
       AND v.cuerpo_html LIKE '%{{qr_verificacion}}%' AND v.cuerpo_html NOT LIKE '%{{ibis_arma}}%';
  END IF;
END $$;
