-- =============================================================================
-- LIMS IDIC · Alineación de columnas: schema.sql (BD real) vs schema.prisma
-- =============================================================================
-- PROBLEMA: el cliente Prisma se genera desde prisma/schema.prisma, cuyos
-- modelos tienen campos escalares que NO existen como columnas en las tablas
-- creadas por schema.sql (la BD viva). Como Prisma hace SELECT explícito de
-- todos los campos del modelo, cualquier columna faltante produce un error
-- 500 del tipo: "The column `proveedor.rubro` does not exist in the current
-- database".
--
-- ALCANCE: tablas de los 6 endpoints reportados en 500 (proveedor, muestra,
-- metodo, factura, lista_precio, plantilla_informe) + las tablas que esos
-- mismos servicios cargan vía `include:` en Prisma (revisado en
-- apps/api/src/comercial|laboratorio|facturacion|catalogo .module.ts):
--   - muestra   → include { tipoMuestra, grupo }      => tipo_muestra, grupo
--   - metodo    → include { analitos }                => analito
--   - factura   → include { lineas, pagos, notasCredito } => linea_factura, pago, nota_credito
--   - lista_precio → include { items }                => lista_precio_item
--   - plantilla_informe → sin include adicional
--
-- Tablas ya alineadas (no requieren cambios, se listan para dejar constancia
-- de que fueron revisadas): grupo, linea_factura, pago.
--
-- QUÉ HACE ESTE SCRIPT: únicamente `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
-- No elimina ni modifica columnas existentes, no toca constraints, no renombra
-- nada. Es 100% idempotente: se puede ejecutar tantas veces como se quiera.
-- Todas las columnas nuevas son NULLABLE; solo llevan DEFAULT cuando el campo
-- Prisma tenía `@default(...)` con un valor simple (string/bool) o `now()`.
--
-- Ejecución:  psql -d lims_idic -f align_schema_to_prisma.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- proveedor  (modelo Proveedor)
-- -----------------------------------------------------------------------------
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS rubro          VARCHAR(200);
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS contacto       VARCHAR(120);
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS condicion_pago VARCHAR(40);
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS estado         VARCHAR(20) DEFAULT 'habilitado';
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ DEFAULT now();
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ;
ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- muestra  (modelo Muestra)
-- -----------------------------------------------------------------------------
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS nombre        VARCHAR(200);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS cliente_id    UUID;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(60);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS ubicacion     VARCHAR(80);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ;
-- (gran_grupo_id y grupo_id ya existen vía ALTER previo en schema.sql; no se tocan)

-- -----------------------------------------------------------------------------
-- tipo_muestra  (modelo TipoMuestra — incluida por muestra.include.tipoMuestra)
-- -----------------------------------------------------------------------------
ALTER TABLE tipo_muestra ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;

-- -----------------------------------------------------------------------------
-- grupo  (modelo Grupo — incluida por muestra.include.grupo)
-- Revisada: id, tenant_id, gran_grupo_id, cgrupo, nombre, activo ya existen.
-- No requiere cambios.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- metodo  (modelo Metodo)
-- -----------------------------------------------------------------------------
ALTER TABLE metodo ADD COLUMN IF NOT EXISTS norma      VARCHAR(120);
ALTER TABLE metodo ADD COLUMN IF NOT EXISTS version    VARCHAR(20) DEFAULT 'v1';
ALTER TABLE metodo ADD COLUMN IF NOT EXISTS area       VARCHAR(60);
ALTER TABLE metodo ADD COLUMN IF NOT EXISTS estado     VARCHAR(20) DEFAULT 'vigente';
ALTER TABLE metodo ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- analito  (modelo Analito — incluida por metodo.include.analitos)
-- NOTA: la tabla real de analito está ligada a metodo_version_id (versionado),
-- mientras el modelo Prisma espera metodo_id directo. Se añade metodo_id como
-- columna nueva sin tocar metodo_version_id ni la FK existente.
-- -----------------------------------------------------------------------------
ALTER TABLE analito ADD COLUMN IF NOT EXISTS metodo_id  UUID;
ALTER TABLE analito ADD COLUMN IF NOT EXISTS codigo     VARCHAR(60);
ALTER TABLE analito ADD COLUMN IF NOT EXISTS formula    TEXT;
ALTER TABLE analito ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE analito ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- factura  (modelo Factura)
-- -----------------------------------------------------------------------------
ALTER TABLE factura ADD COLUMN IF NOT EXISTS numero     VARCHAR(30);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS origen     VARCHAR(20);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- linea_factura  (modelo LineaFactura — incluida por factura.include.lineas)
-- Revisada: id, factura_id, descripcion, cantidad, precio_unitario, subtotal
-- ya existen. No requiere cambios.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- pago  (modelo Pago — incluida por factura.include.pagos)
-- Revisada: id, factura_id, fecha, monto, medio, referencia ya existen.
-- No requiere cambios.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- nota_credito  (modelo NotaCredito — incluida por factura.include.notasCredito)
-- -----------------------------------------------------------------------------
ALTER TABLE nota_credito ADD COLUMN IF NOT EXISTS numero VARCHAR(30);

-- -----------------------------------------------------------------------------
-- lista_precio  (modelo ListaPrecio)
-- -----------------------------------------------------------------------------
ALTER TABLE lista_precio ADD COLUMN IF NOT EXISTS activa     BOOLEAN DEFAULT true;
ALTER TABLE lista_precio ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE lista_precio ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- lista_precio_item  (modelo ListaPrecioItem — incluida por lista_precio.include.items)
-- NOTA: la tabla real usa PK compuesta (lista_id, metodo_id) sin columna `id`
-- propia y sin `lista_precio_id`. Se añaden las columnas que Prisma espera sin
-- tocar la PK ni las columnas existentes (lista_id, metodo_id, precio).
-- -----------------------------------------------------------------------------
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS id              UUID;
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS lista_precio_id UUID;
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS codigo          VARCHAR(30);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS descripcion     VARCHAR(300);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS cc              VARCHAR(20);
ALTER TABLE lista_precio_item ADD COLUMN IF NOT EXISTS tipo            VARCHAR(20) DEFAULT 'servicio';

-- -----------------------------------------------------------------------------
-- plantilla_informe  (modelo PlantillaInforme)
-- -----------------------------------------------------------------------------
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS version    VARCHAR(10) DEFAULT 'v1';
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- =============================================================================
-- FIN
-- =============================================================================

-- ============================================================
-- Defaults/backfill de updated_at: Prisma lo exige NON-NULL, pero ADD COLUMN
-- dejó null en filas ya sembradas -> "Error converting field updatedAt ... null".
-- ============================================================
ALTER TABLE proveedor ALTER COLUMN updated_at SET DEFAULT now();
UPDATE proveedor SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE factura   ALTER COLUMN updated_at SET DEFAULT now();
UPDATE factura   SET updated_at = now() WHERE updated_at IS NULL;

-- ============================================================
-- resultado: la captura por UI (ResultadoService.capturar) no setea tenant_id
-- ni analisis_programado_id (columnas legacy NOT NULL). Se relajan para permitir
-- capturas ad-hoc muestra->analito->replicas->veredicto.
-- ============================================================
ALTER TABLE resultado ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE resultado ALTER COLUMN analisis_programado_id DROP NOT NULL;

-- contacto: el modelo Prisma usa principal/created_at/deleted_at (la tabla tenía es_principal).
ALTER TABLE contacto ADD COLUMN IF NOT EXISTS principal BOOLEAN DEFAULT false;
ALTER TABLE contacto ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE contacto ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
UPDATE contacto SET principal = COALESCE(principal, es_principal, false) WHERE principal IS NULL;
