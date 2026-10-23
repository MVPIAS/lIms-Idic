-- =============================================================================
-- LIMS IDIC · Frente c2 · Correcciones del recorrido de los manuales de
-- proceso (emisión, documentos, Metrología y SAEC) · Aiuken
-- =============================================================================
-- Backlog_Correcciones_Recorrido_Aiuken.xlsx, pestaña «Plan», frente 2.
--   B-003 · El oficio conductor tiene su propia serie: no repite el número de
--           un documento emitido (disparador de unicidad oficio ↔ documento).
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
