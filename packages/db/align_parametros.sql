-- =============================================================================
-- align_parametros.sql · Maestra genérica de PARÁMETROS DE NEGOCIO (§5)
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente (se puede re-aplicar sin efectos secundarios).
--
-- DECISIÓN DEL CLIENTE (§5 parametrización): "rellenar todas las tablas de
-- parámetros/maestras y que los campos de combo o selección múltiple se puedan
-- agregar o modificar". Muchos combos del sistema ya están respaldados por
-- maestras con CRUD (gran grupo, grupo, método, analito, tipo de muestra,
-- plantillas…). Los que quedaban HARDCODEADOS en el frontend (tipo de cliente,
-- forma de pago, prioridad, tipo de línea de costeo, tipo de inspección) pasan a
-- esta tabla única y editable, sin necesidad de una tabla por combo.
--
-- Los ESTADOS de máquina de estados (estado OT, estado muestra, veredicto) NO
-- viven aquí: son enums de sistema y su edición libre rompería la integridad del
-- flujo. Ver Auditoria_Combos_Editables.md.
--
-- Modelo aislado por tenant como el resto del esquema (IDIC es mono-tenant).
-- unique(tenant, categoria, codigo): un código no se repite dentro de su
-- categoría, pero sí puede existir en categorías distintas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS parametro_sistema (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  -- Agrupa los valores de un mismo combo, p. ej. 'tipo_cliente', 'forma_pago'.
  categoria   VARCHAR(60) NOT NULL,
  -- Valor interno estable que se guarda en la fila de negocio (cliente.tipo, …).
  codigo      VARCHAR(60) NOT NULL,
  -- Texto visible en el combo. Es lo único que el usuario debería editar a diario.
  etiqueta    VARCHAR(160) NOT NULL,
  -- Orden de aparición dentro de la categoría (menor primero).
  orden       INTEGER     NOT NULL DEFAULT 0,
  -- Un valor desactivado deja de ofrecerse en los combos pero no se borra (no
  -- rompe filas históricas que ya lo referenciaban).
  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parametro_sistema_cat_cod
  ON parametro_sistema (tenant_id, categoria, codigo);

CREATE INDEX IF NOT EXISTS ix_parametro_sistema_categoria
  ON parametro_sistema (tenant_id, categoria, orden);

COMMENT ON TABLE parametro_sistema IS
  'Maestra genérica de parámetros de negocio editables (combos que antes estaban hardcodeados). §5 parametrización.';
COMMENT ON COLUMN parametro_sistema.categoria IS
  'Combo al que pertenece el valor: tipo_cliente | forma_pago | prioridad | tipo_linea_costeo | tipo_inspeccion | …';
COMMENT ON COLUMN parametro_sistema.codigo IS
  'Valor interno estable guardado en la fila de negocio (p. ej. cliente.tipo).';
COMMENT ON COLUMN parametro_sistema.etiqueta IS
  'Texto visible en el combo (editable por el usuario).';

-- -----------------------------------------------------------------------------
-- Siembra de los valores actuales de los combos de negocio. Se aplica a TODOS
-- los tenants existentes (dev, preprod, prod IDIC). ON CONFLICT DO NOTHING la
-- hace idempotente y no pisa ediciones posteriores del cliente.
-- Los códigos replican los que hoy usa el código (cliente.tipo, prioridad OT,
-- tipo de línea de cotización). forma_pago y tipo_inspeccion no tenían enum en
-- código: se siembran valores razonables que el IDIC puede editar libremente.
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden
FROM tenant t
CROSS JOIN (VALUES
  -- tipo_cliente (hoy hardcodeado en apps/web/.../clientes/page.tsx)
  ('tipo_cliente',      'institucional',       'Institucional',        1),
  ('tipo_cliente',      'gubernamental',       'Gubernamental',        2),
  ('tipo_cliente',      'externo',             'Externo',              3),
  ('tipo_cliente',      'laboratorio_asociado','Laboratorio asociado', 4),
  -- forma_pago (cotizacion.forma_pago era texto libre)
  ('forma_pago',        'contado',             'Contado',              1),
  ('forma_pago',        'credito',             'Crédito',              2),
  ('forma_pago',        'transferencia',       'Transferencia',        3),
  ('forma_pago',        'cheque',              'Cheque',               4),
  ('forma_pago',        'tarjeta',             'Tarjeta',              5),
  -- prioridad (enum PrioridadEnum en ot.controller.ts)
  ('prioridad',         'baja',                'Baja',                 1),
  ('prioridad',         'normal',              'Normal',               2),
  ('prioridad',         'alta',                'Alta',                 3),
  ('prioridad',         'urgente',             'Urgente',              4),
  -- tipo_linea_costeo (tipo de línea de cotización / costeo)
  ('tipo_linea_costeo', 'producto',            'Producto / Ensayo',    1),
  ('tipo_linea_costeo', 'viatico',             'Viático',              2),
  ('tipo_linea_costeo', 'pasaje',              'Pasaje',               3),
  ('tipo_linea_costeo', 'hora_hombre',         'Hora hombre',          4),
  ('tipo_linea_costeo', 'hora_maquina',        'Hora máquina',         5),
  ('tipo_linea_costeo', 'otros',               'Otros',                6),
  ('tipo_linea_costeo', 'extension',           'Extensión',            7),
  -- tipo_inspeccion (valores iniciales editables por el IDIC)
  ('tipo_inspeccion',   'visual',              'Inspección visual',        1),
  ('tipo_inspeccion',   'dimensional',         'Inspección dimensional',   2),
  ('tipo_inspeccion',   'terreno',             'Inspección en terreno',    3),
  ('tipo_inspeccion',   'laboratorio',         'Inspección de laboratorio',4)
) AS v(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
