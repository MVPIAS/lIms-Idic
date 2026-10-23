-- =============================================================================
-- align_lp26_lista_precios.sql · Lista de precios oficial 2026 con estructura
-- de costos y fórmula oficial del precio (frente lp26)
-- -----------------------------------------------------------------------------
-- El IDIC envió el 22-10-2026 la «LISTA DE PRECIO 2026 (COSTOS ENSAYOS)»: por
-- código EN, centro de costo, costo directo, indirecto (20 % del CD), total,
-- recargo (30 % del CT), neto, IVA (19 %) y precio particular. Responde a la
-- pregunta abierta de EP-00 §10 P1 (fórmula del precio).
--
--   1 · lista_precio_item admite ítems sin método (PK propia `id`) y guarda la
--       estructura de costos, el ensayo del catálogo enlazado, el centro de
--       costo y la unidad. Los datos los carga seed_lp26_lista_precios_2026.sql
--       (generado desde el CSV).
--   2 · Fórmula oficial en los parámetros del circuito de la cotización: CI 20 %
--       y recargo 30 % (antes 12 % y 20 %), IVA 19 %, y qué precio de la lista
--       toma un cliente Ejército (por confirmar).
--
-- Aditivo e idempotente: una pasada y dos dejan el mismo estado.
-- =============================================================================

-- --- 1 · Ítems de la lista con estructura de costos ----------------------------
-- La tabla nació con PK (lista_id, metodo_id): no admitía un servicio sin método.
UPDATE lista_precio_item SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE lista_precio_item SET lista_precio_id = lista_id WHERE lista_precio_id IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lista_precio_item'::regclass AND conname = 'lista_precio_item_pkey'
              AND pg_get_constraintdef(oid) LIKE 'PRIMARY KEY (lista_id, metodo_id)%') THEN
    ALTER TABLE lista_precio_item DROP CONSTRAINT lista_precio_item_pkey;
  END IF;
  -- Un método sigue sin poder repetirse en una lista (los NULL no chocan).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lista_precio_item'::regclass AND conname = 'uq_lista_precio_item_metodo') THEN
    ALTER TABLE lista_precio_item ADD CONSTRAINT uq_lista_precio_item_metodo UNIQUE (lista_id, metodo_id);
  END IF;
  ALTER TABLE lista_precio_item ALTER COLUMN metodo_id DROP NOT NULL;
  ALTER TABLE lista_precio_item ALTER COLUMN id SET NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lista_precio_item'::regclass AND contype = 'p') THEN
    ALTER TABLE lista_precio_item ADD CONSTRAINT lista_precio_item_pkey PRIMARY KEY (id);
  END IF;
END $$;

ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS costo_directo       NUMERIC(14,2);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS costo_indirecto     NUMERIC(14,2);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS costo_total         NUMERIC(14,2);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS recargo             NUMERIC(14,2);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS neto                NUMERIC(14,2);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS iva                 NUMERIC(14,2);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS precio_iva_incluido NUMERIC(14,2);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS cat_ensayo_id       UUID REFERENCES cat_ensayo(id);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS enlace              VARCHAR(20);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS centro_costo_id     UUID REFERENCES centro_costo(id);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS unidad_id           UUID REFERENCES unidad(id);

COMMENT ON COLUMN lista_precio_item.precio IS
  'Precio de venta del ítem. En una lista con estructura de costos (costo_directo no nulo) es el neto: precio particular sin IVA, el que toma la cotización.';
COMMENT ON COLUMN lista_precio_item.costo_total IS 'CD + CI. Precio Ejército del FORM05 (por confirmar si rige en la cotización: circuito_cotizacion.precio_ejercito).';
COMMENT ON COLUMN lista_precio_item.enlace IS 'Cómo se enlazó con el catálogo: codigo (mismo código EN) · nombre · nombre_base (nombre sin método/norma) · manual.';
COMMENT ON COLUMN lista_precio_item.cc IS 'Centro de costo tal como viene en la lista (LPN, CDOSECALI, #N/D…).';

-- Clave natural de las listas con estructura de costos: un código por lista.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lista_precio_item_codigo ON lista_precio_item (lista_precio_id, codigo) WHERE costo_directo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lista_precio_item_ensayo ON lista_precio_item (cat_ensayo_id) WHERE cat_ensayo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lista_precio_item_lista ON lista_precio_item (lista_precio_id);

-- lista_id (FK real, NOT NULL) y lista_precio_id (la que usa Prisma) son la misma
-- lista: un ítem dado de alta desde la pantalla solo trae lista_precio_id.
CREATE OR REPLACE FUNCTION fn_lista_precio_item_lista() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.lista_id := COALESCE(NEW.lista_id, NEW.lista_precio_id);
  NEW.lista_precio_id := COALESCE(NEW.lista_precio_id, NEW.lista_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lista_precio_item_lista ON lista_precio_item;
CREATE TRIGGER trg_lista_precio_item_lista BEFORE INSERT OR UPDATE ON lista_precio_item
  FOR EACH ROW EXECUTE FUNCTION fn_lista_precio_item_lista();

ALTER TABLE lista_precio ADD COLUMN IF NOT EXISTS fuente VARCHAR(200);

-- La lista de demostración de seed_preprod_demo.sql se llamaba igual que la oficial.
UPDATE lista_precio SET nombre = 'Lista de precios 2026 (demostración)'
 WHERE codigo = 'PRECIOS-2026' AND nombre = 'Lista de precios 2026';

-- --- 2 · Fórmula oficial del precio (circuito_cotizacion) -----------------------
-- Solo cambia el parámetro si sigue con el valor por defecto anterior y nadie lo
-- cambió a mano (historial con usuario). Deja constancia en el historial.
WITH objetivo(codigo, antes, despues, etiqueta) AS (VALUES
  ('cfa_pct', '12', '20', 'Costo indirecto (CI) sobre el costo directo, % · FORM05 y lista de precios'),
  ('margen_particular_pct', '20', '30', 'Recargo del precio particular sobre el costo total, %')
), cambiados AS (
  UPDATE parametro_sistema p
     SET valor = o.despues, etiqueta = o.etiqueta
    FROM objetivo o
   WHERE p.categoria = 'circuito_cotizacion' AND p.codigo = o.codigo AND btrim(coalesce(p.valor, '')) = o.antes
     AND NOT EXISTS (SELECT 1 FROM parametro_sistema_historial h WHERE h.parametro_id = p.id AND h.usuario_id IS NOT NULL)
  RETURNING p.id, p.tenant_id, p.codigo, o.antes, o.despues
)
INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
SELECT c.tenant_id, c.id, 'circuito_cotizacion', c.codigo, c.antes, c.despues,
       'Fórmula oficial de la lista de precios IDIC 2026 (22-10-2026): CI 20 % del costo directo y recargo 30 % del costo total.', NULL
  FROM cambiados c;

INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, 'circuito_cotizacion', v.codigo, v.etiqueta, v.valor, v.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
   ('iva_pct', 'IVA sobre el neto, % · FORM05 y lista de precios', '19', 6),
   ('precio_ejercito', 'Precio de la lista que toma un cliente Ejército (ficha | costo_total | neto)', 'ficha', 7)
 ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
