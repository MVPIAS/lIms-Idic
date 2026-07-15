-- =============================================================================
-- LIMS IDIC · Alineación módulo Órdenes de Compra: schema.sql (BD real) vs schema.prisma
-- =============================================================================
-- PROBLEMA (documentado en apps/api/src/adquisiciones/adquisiciones.module.ts):
-- `OrdenCompraService` opera contra el contrato Prisma `OrdenCompra`/
-- `LineaOrdenCompra`, que diverge de la tabla `orden_compra` creada por
-- schema.sql y de `align_schema_to_prisma.sql` (que no toca este módulo):
--
--   - `orden_compra` real tiene: codigo, tipo, proyecto_id, fecha_emision,
--     moneda, precio_idic_clp, rut_receptor, ... y le FALTAN las columnas que
--     el modelo Prisma espera: numero, proveedor_id, fecha, deleted_at.
--   - `linea_orden_compra` (mapeada por el modelo Prisma `LineaOrdenCompra`,
--     @@map("linea_orden_compra")) NO EXISTE como tabla en la BD real.
--   - Además, `orden_compra` real tiene `codigo` y `tipo` como NOT NULL sin
--     DEFAULT; el backend (OrdenCompraService.crearConLineas) nunca los
--     setea, por lo que el INSERT de Prisma fallaría por violación NOT NULL.
--
-- QUÉ HACE ESTE SCRIPT:
--   1. `ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS ...` para las
--      columnas del modelo Prisma `OrdenCompra` que faltan (numero,
--      proveedor_id, fecha, deleted_at). Todas NULLABLE; `fecha` lleva
--      DEFAULT CURRENT_DATE porque el modelo Prisma la define con
--      `@default(dbgenerated("CURRENT_DATE"))`.
--   2. `ALTER TABLE orden_compra ALTER COLUMN ... DROP NOT NULL` para
--      `codigo` y `tipo`, que el backend no puede satisfacer.
--   3. `CREATE TABLE IF NOT EXISTS linea_orden_compra (...)` con exactamente
--      las columnas del modelo Prisma `LineaOrdenCompra`, FK a
--      orden_compra(id) ON DELETE CASCADE, y un índice por esa FK.
--
-- No elimina columnas ni tablas, no renombra nada, no toca constraints ya
-- alineados. Es 100% idempotente: se puede ejecutar tantas veces como se
-- quiera (ADD COLUMN / CREATE TABLE / CREATE INDEX llevan IF NOT EXISTS;
-- DROP NOT NULL sobre una columna ya nullable es un no-op en PostgreSQL).
--
-- Ejecución:  psql -d lims_idic -f align_orden_compra.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- orden_compra  (modelo Prisma OrdenCompra) — columnas faltantes
-- -----------------------------------------------------------------------------
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS numero       VARCHAR(30);
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS proveedor_id UUID;
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS fecha        DATE DEFAULT CURRENT_DATE;
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- orden_compra  · NOT NULL preexistentes sin DEFAULT que el backend no setea
-- -----------------------------------------------------------------------------
-- `codigo`  VARCHAR(30) NOT NULL  (sin default) → OrdenCompraService.crearConLineas
--           no lo incluye en el `data` del INSERT.
-- `tipo`    VARCHAR(20) NOT NULL  (sin default) → tampoco lo incluye.
ALTER TABLE orden_compra ALTER COLUMN codigo DROP NOT NULL;
ALTER TABLE orden_compra ALTER COLUMN tipo   DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- linea_orden_compra  (modelo Prisma LineaOrdenCompra) — tabla inexistente
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS linea_orden_compra (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID NOT NULL REFERENCES orden_compra(id) ON DELETE CASCADE,
  descripcion     TEXT NOT NULL,
  cantidad        NUMERIC(10,2) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(14,2) NOT NULL,
  subtotal        NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_linea_orden_compra_orden_compra_id
  ON linea_orden_compra(orden_compra_id);
