-- =============================================================================
-- LIMS IDIC · Frente c2 · Correcciones del recorrido de los manuales de
-- proceso (emisión, documentos, Metrología y SAEC) · Aiuken
-- =============================================================================
-- Backlog_Correcciones_Recorrido_Aiuken.xlsx, pestaña «Plan», frente 2.
--   B-003 · El oficio conductor tiene su propia serie: no repite el número de
--           un documento emitido (disparador de unicidad oficio ↔ documento).
--   B-022 · La plantilla guarda su tipo de documento («Automático» lo toma de ella).
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B-003 · Número del oficio distinto del de cualquier documento emitido
-- -----------------------------------------------------------------------------
-- Antes, el oficio de un laboratorio con una regla «todos los tipos» (LRB:
-- «IDIC DSA SAM LRB Nº J.{OT_N}/{AAAA}») tomaba el mismo número que el Informe
-- de Ensayo de Rechazo que conducía. La API ya elige la serie OFICIO; este
-- disparador lo garantiza también en la base.
CREATE OR REPLACE FUNCTION fn_oficio_numero_unico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NOT NULL AND EXISTS (
       SELECT 1 FROM certificado c
        WHERE c.tenant_id = NEW.tenant_id AND (c.numero = NEW.numero OR c.codigo = NEW.numero)) THEN
    RAISE EXCEPTION 'El número % ya lo tiene un documento emitido: el oficio lleva su propia serie (OFICIO).', NEW.numero
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_oficio_numero_unico ON oficio;
CREATE TRIGGER trg_oficio_numero_unico
  BEFORE INSERT OR UPDATE OF numero ON oficio
  FOR EACH ROW EXECUTE FUNCTION fn_oficio_numero_unico();

-- Oficios aún no firmados que quedaron con el número de un documento: se les
-- libera el número para que al reenviarlos a firma reciban el de su serie.
-- Los firmados o despachados no se tocan (son documentos oficiales).
UPDATE oficio o
   SET numero = NULL, updated_at = now()
 WHERE o.estado IN ('borrador', 'devuelto')
   AND o.numero IS NOT NULL
   AND EXISTS (SELECT 1 FROM certificado c
                WHERE c.tenant_id = o.tenant_id AND (c.numero = o.numero OR c.codigo = o.numero));

-- -----------------------------------------------------------------------------
-- B-022 · El tipo de documento lo define la plantilla
-- -----------------------------------------------------------------------------
-- «Automático» deducía el tipo del tipo genérico de la plantilla (SCCII es
-- «I.TECNICO» → Informe técnico, con firmas y numeración de otro documento).
-- Ahora la plantilla guarda su tipo de documento de la matriz y «Automático» lo
-- toma de ella. Se edita en Configuración del laboratorio › Plantillas de informe.
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(40);
COMMENT ON COLUMN plantilla_informe.tipo_documento IS
  'Tipo de documento de la matriz de firmas y de la numeración que emite la plantilla (INFORME_INSPECCION, CERTIFICADO_CONFORMIDAD...). NULL = se deduce del tipo de plantilla y de la unidad de la OT.';

-- Solo rellena las que aún no lo tienen: respeta lo que haya cambiado Calidad.
UPDATE plantilla_informe p
   SET tipo_documento = v.tipo
  FROM (VALUES
    ('SCCII',     NULL::text,                   'INFORME_INSPECCION'),
    ('ASTEC',     'SCC Informe de Inspección',  'INFORME_INSPECCION'),
    ('SCCCC',     NULL,                         'CERTIFICADO_CONFORMIDAD'),
    ('SCCDG',     NULL,                         'CERTIFICADO_CONFORMIDAD'),
    ('SCCIN',     NULL,                         'INFORME_INCUMPLIMIENTO'),
    ('SCCID',     NULL,                         'INFORME_INCUMPLIMIENTO'),
    ('CERTARMA',  NULL,                         'CERTIFICADO_ARMA'),
    ('LRB-CRB',   NULL,                         'CERTIFICADO_RESISTENCIA_BALISTICA'),
    ('LRB-RECH',  NULL,                         'INFORME_RECHAZO'),
    ('PROTO-APR', NULL,                         'CERTIFICADO_CONFORMIDAD'),
    ('PROTO-REC', NULL,                         'INFORME_INCUMPLIMIENTO')
  ) AS v(repid, nombre, tipo)
 WHERE p.repid = v.repid
   AND (v.nombre IS NULL OR p.nombre = v.nombre)
   AND p.tipo_documento IS NULL;
