-- =============================================================================
-- align_firma_cierre.sql · Del resultado aprobado al informe firmado, el cierre
-- de la OT y la factura · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE (se puede reaplicar sin error). Reglas de negocio en
-- docs/FLUJO_FIRMA_CIERRE.md. Cubre:
--
--   1. Circuito de firma del informe/certificado según la matriz de firmas
--      (flujo_firma): el documento nace «en_firma» con los pasos que resuelve
--      la matriz; cuando firma el último paso queda «oficial» y no se modifica.
--      Devolución y anulación con motivo; reemisión como nueva versión.
--   2. Registro de cada firma (documento_firma): quién, cuándo, cargo, vía
--      (titular / subrogante / asignación), imagen de firma congelada y huella.
--   3. Imagen de firma del usuario guardada en la propia BD (firma.imagen_data)
--      para poder estamparla en el PDF sin depender de un almacén externo.
--   4. Entrega del documento oficial (fecha, medio, a quién).
--   5. Fecha de compromiso de la OT: origen (cotización / manual) y plazo de
--      entrega en días en la cotización; se calcula sola al crear la OT.
--   6. Cierre de la OT (quién) y factura en borrador «pendiente» al cerrar una
--      OT con cobro, con moneda, centro de costo y cotización de origen.
--   7. Permisos nuevos y su asignación por rol.
-- =============================================================================

BEGIN;

-- --- 1. certificado · circuito de firma, versión, anulación y entrega ---------
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS tipo_documento         VARCHAR(40);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS unidad_id              UUID;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS version                INT NOT NULL DEFAULT 1;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS reemplaza_id           UUID;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS oficial_at             TIMESTAMPTZ;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS devuelto_at            TIMESTAMPTZ;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS devuelto_por           UUID;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS devuelto_motivo        TEXT;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS anulado_at             TIMESTAMPTZ;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS anulado_por            UUID;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS anulado_motivo         TEXT;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entregado_at           TIMESTAMPTZ;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_medio          VARCHAR(40);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_destinatario   VARCHAR(200);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_observacion    TEXT;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_registrada_por UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_certificado_reemplaza') THEN
    ALTER TABLE certificado ADD CONSTRAINT fk_certificado_reemplaza
      FOREIGN KEY (reemplaza_id) REFERENCES certificado(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_certificado_ot_estado ON certificado (ot_id, estado);

COMMENT ON COLUMN certificado.estado IS
  'en_firma -> oficial | devuelto | anulado; devuelto -> anulado; oficial -> anulado. '
  '''emitido'' = documento emitido antes del circuito de firma (se trata como oficial).';

-- --- 2. documento_firma · pasos de firma de cada documento ---------------------
CREATE TABLE IF NOT EXISTS documento_firma (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  certificado_id   UUID NOT NULL REFERENCES certificado(id) ON DELETE CASCADE,
  orden            INT NOT NULL,
  accion           VARCHAR(20) NOT NULL,
  rol_codigo       VARCHAR(60) NOT NULL,
  rol_nombre       VARCHAR(200),
  unidad_id        UUID,
  unidad_codigo    VARCHAR(40),
  unidad_nombre    VARCHAR(200),
  obligatorio      BOOLEAN NOT NULL DEFAULT TRUE,
  descripcion      TEXT,
  -- Responsables resueltos por la matriz AL EMITIR: [{usuarioId, nombre, via}].
  responsables     JSONB NOT NULL DEFAULT '[]'::jsonb,
  estado           VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  firmado_por      UUID REFERENCES usuario(id),
  firmado_at       TIMESTAMPTZ,
  firmante_nombre  VARCHAR(200),
  firmante_cargo   VARCHAR(200),
  firmante_grado   VARCHAR(80),
  via              VARCHAR(20),
  -- Imagen de firma CONGELADA al firmar: cambiar después la firma registrada
  -- del usuario no altera los documentos ya firmados.
  imagen_data      TEXT,
  imagen_hash      VARCHAR(64),
  -- sha256(hash del documento | id del paso | usuario | instante ISO).
  hash_firma       VARCHAR(64),
  motivo           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_documento_firma_estado CHECK (estado IN ('pendiente', 'firmado', 'devuelto', 'anulado'))
);
CREATE INDEX IF NOT EXISTS idx_documento_firma_cert   ON documento_firma (certificado_id, orden);
CREATE INDEX IF NOT EXISTS idx_documento_firma_pend   ON documento_firma (tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_documento_firma_resp   ON documento_firma USING gin (responsables jsonb_path_ops);
COMMENT ON TABLE documento_firma IS
  'Pasos de firma de un informe/certificado, resueltos con la matriz flujo_firma al emitir. Registro de quien firmo y cuando.';

-- --- 3. firma · imagen de firma guardada en la BD -----------------------------
ALTER TABLE firma ADD COLUMN IF NOT EXISTS imagen_data TEXT;
ALTER TABLE firma ADD COLUMN IF NOT EXISTS imagen_mime VARCHAR(40);
COMMENT ON COLUMN firma.imagen_data IS 'Imagen de firma (PNG o JPEG) en base64, sin prefijo data:. Se estampa en el PDF al firmar.';

-- --- 4. Fecha de compromiso de la OT -------------------------------------------
ALTER TABLE cotizacion    ADD COLUMN IF NOT EXISTS plazo_entrega_dias      INT;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS fecha_compromiso_origen VARCHAR(20);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS fecha_compromiso_por    UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS fecha_compromiso_at     TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cerrada_por             UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_plazo_entrega') THEN
    ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_plazo_entrega
      CHECK (plazo_entrega_dias IS NULL OR plazo_entrega_dias BETWEEN 1 AND 730);
  END IF;
END $$;

COMMENT ON COLUMN cotizacion.plazo_entrega_dias IS
  'Plazo de entrega comprometido con el cliente, en días corridos desde la recepción de la OT.';
COMMENT ON COLUMN orden_trabajo.fecha_compromiso_origen IS 'cotizacion | manual';

-- Al crear la OT (o al enlazarle la cotización) sin fecha de compromiso, se
-- calcula con el plazo de la cotización: recepción + plazo_entrega_dias.
CREATE OR REPLACE FUNCTION fn_ot_fecha_compromiso() RETURNS trigger AS $$
DECLARE
  v_plazo INT;
BEGIN
  IF NEW.fecha_compromiso IS NULL AND NEW.cotizacion_id IS NOT NULL THEN
    SELECT c.plazo_entrega_dias INTO v_plazo FROM cotizacion c WHERE c.id = NEW.cotizacion_id;
    IF v_plazo IS NOT NULL THEN
      NEW.fecha_compromiso := (COALESCE(NEW.fecha_recepcion, now()) AT TIME ZONE 'America/Santiago')::date + v_plazo;
      NEW.fecha_compromiso_origen := 'cotizacion';
      NEW.fecha_compromiso_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ot_fecha_compromiso ON orden_trabajo;
CREATE TRIGGER trg_ot_fecha_compromiso
  BEFORE INSERT OR UPDATE OF cotizacion_id ON orden_trabajo
  FOR EACH ROW EXECUTE FUNCTION fn_ot_fecha_compromiso();

-- Fechas ya existentes sin origen: se marcan como manuales (las puso alguien).
UPDATE orden_trabajo SET fecha_compromiso_origen = 'manual'
 WHERE fecha_compromiso IS NOT NULL AND fecha_compromiso_origen IS NULL;

-- --- 5. factura · borrador al cerrar la OT -------------------------------------
ALTER TABLE factura ADD COLUMN IF NOT EXISTS moneda          VARCHAR(3) NOT NULL DEFAULT 'CLP';
ALTER TABLE factura ADD COLUMN IF NOT EXISTS iva_pct         NUMERIC(5,2) NOT NULL DEFAULT 19;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS centro_costo_id UUID;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS cotizacion_id   UUID;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS observaciones   TEXT;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS creada_por      UUID;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS emitida_por     UUID;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS emitida_at      TIMESTAMPTZ;

-- Deriva entre schema.sql y Prisma: la tabla tiene `codigo` NOT NULL (UNIQUE
-- con tenant_id) que el modelo Prisma no conoce, así que TODO alta de factura
-- desde la API fallaba con 500 (también la factura manual). `codigo` se
-- mantiene igual a `numero` (que es lo que la API escribe), lo que además da la
-- unicidad del número por tenant. Y `ot_id` es opcional en Prisma y en la
-- pantalla (factura manual sin OT): se relaja el NOT NULL heredado.
CREATE OR REPLACE FUNCTION fn_factura_codigo() RETURNS trigger AS $$
BEGIN
  IF NEW.numero IS NOT NULL THEN
    NEW.codigo := NEW.numero;
  ELSIF NEW.codigo IS NOT NULL THEN
    NEW.numero := NEW.codigo;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'factura' AND column_name = 'codigo') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_factura_codigo ON factura';
    EXECUTE 'CREATE TRIGGER trg_factura_codigo BEFORE INSERT OR UPDATE OF numero, codigo ON factura
             FOR EACH ROW EXECUTE FUNCTION fn_factura_codigo()';
  END IF;
END $$;
ALTER TABLE factura ALTER COLUMN ot_id DROP NOT NULL;

-- linea_factura.cantidad es INTEGER en schema.sql y Decimal(10,2) en Prisma:
-- Prisma la envía como numeric y PostgreSQL rechaza el alta de líneas
-- («incorrect binary data format»). Se alinea con Prisma (ensanchar es seguro).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'linea_factura' AND column_name = 'cantidad' AND data_type = 'integer') THEN
    ALTER TABLE linea_factura ALTER COLUMN cantidad TYPE NUMERIC(10,2) USING cantidad::numeric;
  END IF;
END $$;

-- Una sola factura viva generada por el cierre de cada OT.
CREATE UNIQUE INDEX IF NOT EXISTS ux_factura_cierre_ot
  ON factura (ot_id)
  WHERE origen = 'cierre_ot' AND estado <> 'anulada' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_factura_tenant_estado ON factura (tenant_id, estado);

COMMENT ON COLUMN factura.estado IS
  'pendiente (borrador por emitir) -> emitida -> parcial -> pagada; anulada. aviso_1..cde: cobranza heredada.';

-- --- 6. Permisos ----------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'documento.firmar',     'documento',   'firmar',
   'Ver la bandeja «Documentos por firmar». Firmar exige además ser responsable del paso según la matriz de firmas'),
  (gen_random_uuid(), 'certificado.anular',   'certificado', 'anular',
   'Anular un informe o certificado (en firma, devuelto u oficial) con motivo'),
  (gen_random_uuid(), 'certificado.entregar', 'certificado', 'entregar',
   'Registrar la entrega al cliente de un informe o certificado oficial y enviarlo por correo'),
  (gen_random_uuid(), 'ot.planificar',        'ot',          'planificar',
   'Fijar o corregir la fecha de compromiso de una OT')
ON CONFLICT (codigo) DO NOTHING;

-- documento.firmar: los roles que aparecen en la matriz de firmas de informes.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'documento.firmar'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'REVISOR', 'ANALISTA_SR', 'CALIDAD', 'METROLOGO', 'INSPECTOR')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'certificado.anular'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'CALIDAD')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'certificado.entregar'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'PLANIFICACION', 'COMERCIAL', 'RECEPCION')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'ot.planificar'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'PLANIFICACION')
ON CONFLICT DO NOTHING;

-- Cerrar la OT: además de las jefaturas (ya lo tenían), Planificación.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'ot.cerrar'
 WHERE r.codigo IN ('PLANIFICACION')
ON CONFLICT DO NOTHING;

COMMIT;
