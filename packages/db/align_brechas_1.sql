-- ============================================================================
-- align_brechas_1.sql · Contrato LIMS §4.1.1 / §4.1.3 / §4.1.4 (área comercial)
-- ----------------------------------------------------------------------------
-- 1 · Listas de precios personalizadas por cliente:
--     · lista_precio.especial: lista «especial de cliente». Solo la usan los
--       clientes que la tienen asignada; la cotización a cualquier otro cliente
--       la ignora (no compite con la lista general vigente).
--     · cliente.lista_precio_id (ya existía, sin uso): lista propia del
--       cliente. Al cotizarle, sus precios mandan sobre la lista general.
--     · cliente.descuento_especial_pct y cliente.condiciones_especiales:
--       condiciones especiales que se precargan en la cotización del cliente.
--     · linea_cotizacion.precio_origen: de qué lista (o ficha) salió el precio
--       de cada línea, para mostrarlo en la cotización.
-- 2 · Costeo FORM05 con insumos: consumible.costo_unitario_clp (costo de
--     referencia por unidad de medida, CLP) que el laboratorio elige en la
--     sección «Insumos y reactivos» del formulario de costeo.
--
-- Idempotente: se puede ejecutar varias veces. Sin permisos nuevos (las rutas
-- nuevas usan cotizacion.ver, cotizacion.costear y cliente.editar).
-- ============================================================================

-- 1 · Lista especial de cliente --------------------------------------------------
ALTER TABLE lista_precio ADD COLUMN IF NOT EXISTS especial BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN lista_precio.especial IS
  'Lista especial de cliente: solo la toma la cotización a los clientes que la tienen asignada (cliente.lista_precio_id). Contrato 4.1.3.';

-- Vigencia coherente (la pantalla ya permite fijar «Vigente hasta»). NOT VALID:
-- no revisa filas antiguas, sí las nuevas y las que se editen.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lista_precio'::regclass AND conname = 'ck_lista_precio_vigencia') THEN
    ALTER TABLE lista_precio ADD CONSTRAINT ck_lista_precio_vigencia
      CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde) NOT VALID;
  END IF;
END $$;

-- 2 · Condiciones especiales del cliente -----------------------------------------
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS descuento_especial_pct NUMERIC(5,2);
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS condiciones_especiales TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cliente'::regclass AND conname = 'ck_cliente_descuento_especial') THEN
    ALTER TABLE cliente ADD CONSTRAINT ck_cliente_descuento_especial
      CHECK (descuento_especial_pct IS NULL OR (descuento_especial_pct >= 0 AND descuento_especial_pct < 100)) NOT VALID;
  END IF;
END $$;
COMMENT ON COLUMN cliente.lista_precio_id IS
  'Lista de precios propia del cliente: al cotizarle, sus precios tienen prioridad sobre la lista general vigente. Contrato 4.1.1 / 4.1.3.';
COMMENT ON COLUMN cliente.descuento_especial_pct IS
  'Descuento especial del cliente (%) sobre el precio de cada ensayo cotizado. Contrato 4.1.3.';
COMMENT ON COLUMN cliente.condiciones_especiales IS
  'Condiciones comerciales especiales del cliente: se precargan en «Condiciones adicionales» de su cotización.';
CREATE INDEX IF NOT EXISTS idx_cliente_lista_precio ON cliente (lista_precio_id) WHERE lista_precio_id IS NOT NULL;

-- 3 · Origen del precio de cada línea de la cotización ------------------------------
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS precio_origen VARCHAR(300);
COMMENT ON COLUMN linea_cotizacion.precio_origen IS
  'De dónde salió el precio: lista propia del cliente, lista de precios vigente o ficha de costos (y el descuento especial, si lo hubo).';

-- 4 · Costo de referencia de los consumibles (FORM05 · insumos y reactivos) -------
ALTER TABLE consumible ADD COLUMN IF NOT EXISTS costo_unitario_clp NUMERIC(14,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'consumible'::regclass AND conname = 'ck_consumible_costo_unitario') THEN
    ALTER TABLE consumible ADD CONSTRAINT ck_consumible_costo_unitario
      CHECK (costo_unitario_clp IS NULL OR costo_unitario_clp >= 0) NOT VALID;
  END IF;
END $$;
COMMENT ON COLUMN consumible.costo_unitario_clp IS
  'Costo de referencia por unidad de medida, en CLP: lo propone la sección «Insumos y reactivos» del formulario de costeo (FORM05).';
