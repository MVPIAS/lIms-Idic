-- =============================================================================
-- LIMS IDIC · Sesiones de preproducción (27-10 → 09-11) · Frente S1 · Comercial y cotización · Aiuken
-- =============================================================================
-- Aditivo e idempotente (se puede reaplicar sin error). Va justo antes de
-- align_cierre_permisos.sql en ORDEN_SQL.txt.
--
--   1. Cotización por muestra (reunión 5): muestras de la cotización con su
--      producto (eje Producto, elegido antes que los ensayos, reunión 3) y su
--      plazo, y la muestra de cada línea.
--   2. Pre-cotización (reunión 10): tipo de documento, numeración propia y versiones.
--   3. Centro de costo de la sucursal que emite (reunión 2) y excepción del
--      aviso «aceptada sin OT» (reunión 1).
--   4. Condiciones adicionales hasta 5.000 caracteres (reuniones 1 y 2).
--   5. Validez por tipo de cliente y laboratorio (reunión 2) con las respuestas
--      del IDIC: Ejército, FF.AA. y de Orden hasta el 31-12; particulares de
--      Metrología y Resistencia Balística, 60 días.
--   6. Aceptación: «Resolución» y «Oficio» (BPCH, reunión 3), OPI aparte, y
--      comprobante obligatorio (configurable).
--   7. Bloqueo de clientes por el Jefe DCO (reunión 2): historial y permiso.
--   8. Ficha de ensayo (reunión 2): cinco bloques de recursos.
--   9. Anulación de la OT cuando el cliente desiste (reunión 2) y permisos.
--  10. Parámetros: plazo de la OPI (2 meses), anulación de vencidas, gracia de mora.
-- =============================================================================

BEGIN;

-- --- 1 · Cotización por muestra --------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizacion_muestra (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenant(id),
  cotizacion_id    UUID NOT NULL REFERENCES cotizacion(id) ON DELETE CASCADE,
  n                INT  NOT NULL CHECK (n >= 1),
  descripcion      VARCHAR(300) NOT NULL,
  cat_elemento_id  UUID REFERENCES cat_elemento(id),
  producto_texto   VARCHAR(300),
  plazo_dias       INT CHECK (plazo_dias IS NULL OR plazo_dias BETWEEN 1 AND 730),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cotizacion_id, n)
);
COMMENT ON TABLE cotizacion_muestra IS
  'Muestras de la cotización (Químico, reunión 5): producto (cat_elemento) y plazo propio desde la llegada de la muestra.';

ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS muestra_n INT;
COMMENT ON COLUMN linea_cotizacion.muestra_n IS 'Muestra de la cotización (cotizacion_muestra.n) a la que pertenece el ensayo; NULL = línea general.';

-- --- 2 · Pre-cotización -------------------------------------------------------------
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS tipo_documento     VARCHAR(20) NOT NULL DEFAULT 'cotizacion';
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS precot_serie       INT;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS precot_version     INT;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS reemplaza_id       UUID REFERENCES cotizacion(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS reemplazada_por_id UUID REFERENCES cotizacion(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS precotizacion_id   UUID REFERENCES cotizacion(id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_tipo_documento') THEN
    ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_tipo_documento
      CHECK (tipo_documento IN ('cotizacion', 'precotizacion'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_cotizacion_precot ON cotizacion (tenant_id, precot_serie) WHERE tipo_documento = 'precotizacion';
COMMENT ON COLUMN cotizacion.tipo_documento IS
  'cotizacion | precotizacion (SVM, reunión 10): la pre-cotización entrega valores referenciales, sin ensayos ni muestras, y no genera OT.';
COMMENT ON COLUMN cotizacion.precotizacion_id IS 'Pre-cotización desde la que se emitió esta cotización formal.';

-- --- 3 · Centro de costo emisor y excepción «aceptada sin OT» ----------------------
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS centro_costo_emisor_id UUID REFERENCES centro_costo(id);
COMMENT ON COLUMN cotizacion.centro_costo_emisor_id IS
  'Centro de costo de la sucursal que emite la cotización (reunión 2). NULL = Casa Matriz (Departamento Comercial).';
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS sin_ot_motivo TEXT;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS sin_ot_at     TIMESTAMPTZ;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS sin_ot_por    UUID REFERENCES usuario(id);
COMMENT ON COLUMN cotizacion.sin_ot_motivo IS
  'Excepción: aceptada que no tendrá OT en el LIMS (motivo). Sale del aviso «Cotizaciones aceptadas sin OT» (reunión 1).';

-- --- 4 · Condiciones adicionales hasta 5.000 caracteres ----------------------------
DO $$
BEGIN
  IF (SELECT character_maximum_length FROM information_schema.columns
       WHERE table_name = 'cotizacion' AND column_name = 'condiciones_adicionales') IS DISTINCT FROM 5000 THEN
    ALTER TABLE cotizacion ALTER COLUMN condiciones_adicionales TYPE VARCHAR(5000);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_condiciones_len'
               AND pg_get_constraintdef(oid) NOT LIKE '%5000%') THEN
    ALTER TABLE cotizacion DROP CONSTRAINT ck_cotizacion_condiciones_len;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_condiciones_len') THEN
    ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_condiciones_len
      CHECK (condiciones_adicionales IS NULL OR char_length(condiciones_adicionales) <= 5000) NOT VALID;
  END IF;
END $$;

-- --- 5 · Validez por tipo de cliente y laboratorio ---------------------------------
CREATE TABLE IF NOT EXISTS cotizacion_validez_regla (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenant(id),
  tipo_cliente     VARCHAR(60),
  centro_costo_id  UUID REFERENCES centro_costo(id),
  regla            VARCHAR(12) NOT NULL CHECK (regla IN ('DIAS', 'FIN_ANIO')),
  dias             INT CHECK (dias IS NULL OR dias BETWEEN 1 AND 730),
  meses_oct_dic    INT CHECK (meses_oct_dic IS NULL OR meses_oct_dic BETWEEN 1 AND 24),
  nota             VARCHAR(300),
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tipo_cliente IS NOT NULL OR centro_costo_id IS NOT NULL),
  CHECK (regla <> 'DIAS' OR dias IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_validez_regla
  ON cotizacion_validez_regla (tenant_id, COALESCE(tipo_cliente, ''), COALESCE(centro_costo_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE cotizacion_validez_regla IS
  'Validez de la cotización por tipo de cliente y/o laboratorio (reunión 2). Prioridad: tipo+laboratorio > tipo > laboratorio (solo particulares) > general.';

-- Respuesta del IDIC (reunión 2): Ejército, Fuerzas Armadas y de Orden hasta el 31-12 (6 meses si se emite oct–dic).
INSERT INTO cotizacion_validez_regla (tenant_id, tipo_cliente, regla, nota)
SELECT t.id, v.tipo, 'FIN_ANIO', 'Respuesta IDIC, reunión 2 (28-10-2026): Ejército, FF.AA. y de Orden hasta el 31-12'
  FROM tenant t
 CROSS JOIN (VALUES ('ejercito'), ('armada'), ('fuerza_aerea'), ('carabineros'), ('pdi')) AS v(tipo)
 WHERE EXISTS (SELECT 1 FROM parametro_sistema p WHERE p.tenant_id = t.id AND p.categoria = 'tipo_cliente' AND p.codigo = v.tipo)
ON CONFLICT DO NOTHING;

-- Particulares de Metrología y Resistencia Balística: 60 días.
INSERT INTO cotizacion_validez_regla (tenant_id, centro_costo_id, regla, dias, nota)
SELECT cc.tenant_id, cc.id, 'DIAS', 60, 'Respuesta IDIC, reunión 2 (28-10-2026): particulares de Metrología y Resistencia Balística, 60 días'
  FROM centro_costo cc
 WHERE cc.deleted_at IS NULL
   AND (upper(cc.codigo) IN ('LMT-001', 'LMT-AE', 'LRB-001') OR upper(COALESCE(cc.laboratorio, '')) IN ('LMT', 'LRB'))
ON CONFLICT DO NOTHING;

-- --- 6 · Aceptación: OPI, Resolución y Oficio (BPCH) --------------------------------
UPDATE parametro_sistema SET etiqueta = 'OPI (Ejército)'
 WHERE categoria = 'aceptacion_tipo' AND codigo = 'OPI_RESOLUCION' AND etiqueta = 'OPI / Resolución (Ejército)';
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo)
SELECT t.id, 'aceptacion_tipo', v.codigo, v.etiqueta, v.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES ('RESOLUCION', 'Resolución (BPCH u otra autoridad)', 6),
                    ('OFICIO',     'Oficio',                              7)) AS v(codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
COMMENT ON COLUMN cotizacion.aceptacion_tipo IS
  'OPI_RESOLUCION (OPI) | RESOLUCION | OFICIO | OC | CORREO | PAGO_ADELANTADO | DISPOSICION_DIRECTOR (IDIC-PG03; reuniones 2 y 3).';

-- --- 7 · Bloqueo de clientes ------------------------------------------------------------
ALTER TABLE cliente_bloqueo ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE cliente_bloqueo ADD COLUMN IF NOT EXISTS desbloqueado_at TIMESTAMPTZ;
ALTER TABLE cliente_desbloqueo ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id);

-- --- 8 · Ficha de ensayo -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cat_ensayo_ficha (
  cat_ensayo_id    UUID PRIMARY KEY REFERENCES cat_ensayo(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenant(id),
  version          INT  NOT NULL DEFAULT 1,
  observaciones    TEXT,
  actualizada_por  UUID REFERENCES usuario(id),
  actualizada_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cat_ensayo_ficha_item (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenant(id),
  cat_ensayo_id    UUID NOT NULL REFERENCES cat_ensayo(id) ON DELETE CASCADE,
  bloque           VARCHAR(12) NOT NULL CHECK (bloque IN ('personal', 'equipos', 'vehiculos', 'insumos', 'otros')),
  descripcion      VARCHAR(300) NOT NULL,
  categoria        VARCHAR(120),
  cantidad         NUMERIC(12,3),
  unidad           VARCHAR(30),
  horas            NUMERIC(10,2),
  valor_unitario   NUMERIC(14,2),
  orden            INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_cat_ensayo_ficha_item ON cat_ensayo_ficha_item (cat_ensayo_id, bloque, orden);
COMMENT ON TABLE cat_ensayo_ficha_item IS
  'Ficha de ensayo (reunión 2): recursos por bloque (personal, equipos, vehículos, insumos, otros) con cantidad, horas y valor; el valor puede quedar en blanco hasta el estudio de costos.';

-- --- 9 · Anulación de OT -----------------------------------------------------------------
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS anulacion_causa  VARCHAR(30);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS anulacion_motivo TEXT;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS anulada_at       TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS anulada_por      UUID REFERENCES usuario(id);

-- --- Permisos ----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'cliente.bloquear', 'cliente', 'bloquear',
   'Bloquear o desbloquear un cliente con facturas impagas (atribución del Jefe del Departamento Comercial).'),
  (gen_random_uuid(), 'ot.anular', 'ot', 'anular',
   'Anular una OT con motivo (por ejemplo, cuando el cliente desiste).'),
  (gen_random_uuid(), 'comercial.configurar', 'comercial', 'configurar',
   'Configurar la validez de las cotizaciones por tipo de cliente y laboratorio.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    -- El permiso de bloquear se da a la jefatura de departamento; el servicio exige además que sea del Depto. Comercial.
    ('JEFE_DEPTO', 'cliente.bloquear'),
    ('COMERCIAL', 'ot.anular'), ('PLANIFICACION', 'ot.anular'), ('JEFE_DEPTO', 'ot.anular'),
    ('PLANIFICACION', 'comercial.configurar'), ('ADMIN', 'comercial.configurar')
  ) AS m(rol, perm)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;

-- --- 10 · Parámetros (Administración › Parámetros del sistema) -----------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, TRUE, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
   ('ot_disposicion',         'meses_opi',        'Meses para regularizar la OPI de una OT por disposición', 1, '2'),
   ('aceptacion_comprobante', 'exige',            'Exigir el comprobante adjunto al registrar la aceptación', 1, 'si'),
   ('cotizacion_vencidas',    'anular_dias',      'Días tras el vencimiento para anular sola la cotización (0 = no)', 1, '0'),
   ('cliente_moroso',         'dias_gracia',      'Días de gracia tras el vencimiento de la factura', 1, '0')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

COMMIT;
