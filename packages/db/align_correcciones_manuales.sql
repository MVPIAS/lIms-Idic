-- =============================================================================
-- align_correcciones_manuales.sql · Correcciones detectadas al reescribir los
-- manuales de usuario · LIMS IDIC (Aiuken)
--
-- ADITIVO e IDEMPOTENTE (se puede aplicar varias veces). Va al final de
-- ORDEN_SQL.txt. Reglas: docs/FLUJO_CORRECCIONES_MANUALES.md.
--
--   1. resultado: reapertura de un resultado aprobado (quién, cuándo, por qué, cuántas veces).
--   2. unidad.tipo_documento_defecto: tipo de documento con que emite la unidad y su
--      rama (BPCH, sus sucursales y la Delegación Nº 11 → «Informe de inspección»).
--   3. qc_control: quién registró el control, su evaluación automática y quién lo
--      aprobó (id): quien registra un control no lo aprueba.
--   4. nota_credito: la tabla no coincidía con el modelo (tenant_id y codigo NOT NULL
--      que la API no rellena): toda alta fallaba. Mismo arreglo que factura.
--   5. Permisos: resultado.reabrir (jefaturas); compra.ver / compra.gestionar
--      (proveedores y órdenes de compra) y consumible.gestionar (kardex), para que
--      Abastecimiento deje de tener factura.emitir, factura.ver y catalogo.gestionar.
-- =============================================================================

-- --- 1. Reapertura de resultados aprobados ------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS reabierto_por    UUID;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS reabierto_at     TIMESTAMPTZ;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS reabierto_motivo TEXT;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS reaperturas      INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN resultado.reabierto_motivo IS
  'Última reapertura de un resultado aprobado (POST /resultados/:id/reabrir). Traza completa en ot_historial (tipo reapertura_resultado).';

-- --- 2. Tipo de documento por defecto de la unidad ------------------------------
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS tipo_documento_defecto VARCHAR(40);
COMMENT ON COLUMN unidad.tipo_documento_defecto IS
  'Tipo de documento (matriz de firmas) con que emite la unidad y su rama si la plantilla no tiene uno propio. NULL = el de la plantilla.';
-- El Banco de Pruebas de Chile (y por herencia sus sucursales y la Delegación Nº 11)
-- emite informes de inspección. Solo si nadie lo fijó antes (no pisa un cambio manual).
UPDATE unidad SET tipo_documento_defecto = 'INFORME_INSPECCION'
 WHERE codigo = 'BPCH' AND tipo_documento_defecto IS NULL;

-- --- 3. Control de calidad: independencia --------------------------------------
ALTER TABLE qc_control ADD COLUMN IF NOT EXISTS registrado_por  UUID;
ALTER TABLE qc_control ADD COLUMN IF NOT EXISTS evaluacion      VARCHAR(20);
ALTER TABLE qc_control ADD COLUMN IF NOT EXISTS aprobado_por_id UUID;
COMMENT ON COLUMN qc_control.evaluacion IS
  'Evaluación automática contra el criterio al registrar. Si cumple, el control queda pendiente hasta que lo apruebe otra persona (resultado.revisar).';

-- --- 4. nota_credito alineada con el modelo -------------------------------------
-- `numero` es lo que escribe la API; `codigo` (NOT NULL, único por tenant) lo
-- sigue, y `tenant_id` sale de la factura.
ALTER TABLE nota_credito ADD COLUMN IF NOT EXISTS numero VARCHAR(30);
CREATE OR REPLACE FUNCTION fn_nota_credito_alinear() RETURNS trigger AS $$
BEGIN
  IF NEW.numero IS NOT NULL THEN
    NEW.codigo := NEW.numero;
  ELSIF NEW.codigo IS NOT NULL THEN
    NEW.numero := NEW.codigo;
  END IF;
  IF NEW.tenant_id IS NULL AND NEW.factura_id IS NOT NULL THEN
    SELECT f.tenant_id INTO NEW.tenant_id FROM factura f WHERE f.id = NEW.factura_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nota_credito' AND column_name = 'codigo') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_nota_credito_alinear ON nota_credito';
    EXECUTE 'CREATE TRIGGER trg_nota_credito_alinear BEFORE INSERT OR UPDATE OF numero, codigo, factura_id ON nota_credito
             FOR EACH ROW EXECUTE FUNCTION fn_nota_credito_alinear()';
  END IF;
END $$;
UPDATE nota_credito SET numero = codigo WHERE numero IS NULL AND codigo IS NOT NULL;

-- --- 4b. resultado.tenant_id ------------------------------------------------------
-- Los resultados que crea la API (registro de la OT, captura) no rellenan
-- tenant_id (el modelo Prisma no lo conoce): los reportes de conformidad y el
-- exportador, que filtran por tenant_id, no los contaban. Se toma de la muestra
-- al insertar y se completan los que faltan (como ya hizo align_final.sql).
CREATE OR REPLACE FUNCTION fn_resultado_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT m.tenant_id INTO NEW.tenant_id FROM muestra m WHERE m.id = NEW.muestra_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_resultado_tenant ON resultado;
CREATE TRIGGER trg_resultado_tenant BEFORE INSERT ON resultado
  FOR EACH ROW EXECUTE FUNCTION fn_resultado_tenant();
UPDATE resultado r SET tenant_id = m.tenant_id
  FROM muestra m WHERE m.id = r.muestra_id AND r.tenant_id IS NULL;

-- --- 5. Permisos ----------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'resultado.reabrir',    'resultado',  'reabrir',
   'Reabrir un resultado aprobado con motivo (anula los documentos en firma u oficiales de la OT)'),
  (gen_random_uuid(), 'compra.ver',           'compra',     'ver',
   'Ver proveedores y órdenes de compra'),
  (gen_random_uuid(), 'compra.gestionar',     'compra',     'gestionar',
   'Crear y modificar proveedores y órdenes de compra'),
  (gen_random_uuid(), 'consumible.gestionar', 'consumible', 'gestionar',
   'Gestionar el kardex de consumibles (lotes, movimientos, stock)')
ON CONFLICT (codigo) DO NOTHING;

-- resultado.reabrir: jefaturas del laboratorio y Dirección (quienes aprueban y anulan).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'resultado.reabrir'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION', 'JEFE_LAB', 'JEFELAB')
ON CONFLICT DO NOTHING;

-- compra.*: quienes ya veían / gestionaban compras con los permisos de factura
-- (se conserva lo que cada rol podía hacer) y Abastecimiento.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permiso rp JOIN permiso pv ON pv.id = rp.permiso_id AND pv.codigo = 'factura.ver'
  JOIN permiso pn ON pn.codigo = 'compra.ver'
ON CONFLICT DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permiso rp JOIN permiso pv ON pv.id = rp.permiso_id AND pv.codigo = 'factura.emitir'
  JOIN permiso pn ON pn.codigo = 'compra.gestionar'
ON CONFLICT DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN ('compra.ver', 'compra.gestionar', 'consumible.gestionar')
 WHERE r.codigo = 'ABASTECIMIENTO'
ON CONFLICT DO NOTHING;

-- consumible.gestionar: quienes gestionaban el kardex con catalogo.gestionar.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permiso rp JOIN permiso pv ON pv.id = rp.permiso_id AND pv.codigo = 'catalogo.gestionar'
  JOIN permiso pn ON pn.codigo = 'consumible.gestionar'
ON CONFLICT DO NOTHING;

-- Abastecimiento no emite facturas (es de Finanzas), no ve la facturación ni los
-- centros de costo, y no toca el catálogo ni los «Parámetros del sistema».
-- (Única parte no aditiva: retira permisos concedidos por align_admin_roles.sql.)
DELETE FROM rol_permiso rp
 USING rol r, permiso p
 WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
   AND r.codigo = 'ABASTECIMIENTO'
   AND p.codigo IN ('factura.emitir', 'factura.ver', 'catalogo.gestionar');
