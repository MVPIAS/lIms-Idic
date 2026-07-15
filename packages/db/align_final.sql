-- =============================================================================
-- LIMS IDIC · align_final.sql
-- Cierra la deriva de esquema (BD real vs packages/db/prisma/schema.prisma)
-- que dejaba endpoints en HTTP 500, y la fuga cross-tenant en Analito /
-- NormaLimite / Resultado / Firma (tablas sin tenant_id).
--
-- Se aplica DESPUÉS de schema.sql + align_schema_to_prisma.sql (ver
-- provision.sh). Es 100% idempotente: solo usa
--   ADD COLUMN IF NOT EXISTS / ALTER COLUMN SET DEFAULT|DROP NOT NULL /
--   UPDATE ... WHERE x IS NULL (backfill) / CREATE INDEX IF NOT EXISTS /
--   CREATE TABLE IF NOT EXISTS (solo para 2 tablas que Prisma modela y que
--   no existían en absoluto en la BD viva: viatico, firma).
-- No elimina ni renombra columnas, tablas ni constraints existentes.
--
-- Ejecución:
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < packages/db/align_final.sql
--
-- Verificado contra la BD viva (167.233.221.102) el 2026-07-15: los 25
-- endpoints listados en la auditoría se probaron con un token SUPERADMIN
-- antes y después de aplicar este script.
-- =============================================================================


-- =============================================================================
-- PARTE 1 · Endpoints en HTTP 500 (deriva Prisma ↔ BD)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- certificado (modelo Certificado)
-- Causa real (log api): "The column `certificado.fecha` does not exist in the
-- current database." — Prisma también espera created_at/deleted_at que no
-- existían. La tabla real usa `emitido_at` para la fecha de emisión; se
-- backfillea `fecha` desde `emitido_at` para no perder el dato.
-- -----------------------------------------------------------------------------
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS fecha TIMESTAMPTZ;
ALTER TABLE certificado ALTER COLUMN fecha SET DEFAULT now();
UPDATE certificado SET fecha = COALESCE(fecha, emitido_at, now()) WHERE fecha IS NULL;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- orden_compra (modelo OrdenCompra)
-- Causa real (log api): "The column `orden_compra.numero` does not exist in
-- the current database." Prisma también espera proveedor_id (FK a Proveedor,
-- inexistente en la BD real), fecha (la BD real tiene fecha_emision) y
-- deleted_at. `numero` se backfillea desde `codigo` (mismo rol funcional);
-- `fecha` desde `fecha_emision`. proveedor_id queda NULL (no hay relación
-- previa que backfillear; la tabla está vacía en producción) — no se fuerza
-- NOT NULL para no romper inserts existentes.
-- -----------------------------------------------------------------------------
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS numero VARCHAR(30);
UPDATE orden_compra SET numero = COALESCE(numero, codigo) WHERE numero IS NULL;
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedor(id);
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS fecha DATE;
ALTER TABLE orden_compra ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
UPDATE orden_compra SET fecha = COALESCE(fecha, fecha_emision, CURRENT_DATE) WHERE fecha IS NULL;
ALTER TABLE orden_compra ALTER COLUMN monto SET DEFAULT 0;
UPDATE orden_compra SET monto = COALESCE(monto, 0) WHERE monto IS NULL;
ALTER TABLE orden_compra ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- centro_costo (modelo CentroCosto)
-- Causa real (log api): "The column `centro_costo.nombre` does not exist in
-- the current database." La BD real usa `descripcion`; se backfillea
-- `nombre` desde `descripcion`. También faltaban laboratorio/created_at/
-- deleted_at del modelo.
-- -----------------------------------------------------------------------------
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS nombre VARCHAR(200);
UPDATE centro_costo SET nombre = COALESCE(nombre, descripcion) WHERE nombre IS NULL;
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS laboratorio VARCHAR(20);
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE centro_costo ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- viatico (modelo Viatico) — causa real: "The table `public.viatico` does not
-- exist in the current database." No es deriva de columnas: la tabla nunca se
-- creó en schema.sql pese a que el modelo Prisma y el módulo comercial
-- (ViaticoService) ya la usan. Creación aditiva, sin tocar nada existente.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS viatico (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  funcionario   VARCHAR(160) NOT NULL,
  destino       VARCHAR(120),
  dias          INT NOT NULL DEFAULT 1,
  tipo          VARCHAR(20),
  monto         NUMERIC(14,2) NOT NULL DEFAULT 0,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  ot_id         UUID REFERENCES orden_trabajo(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_viatico_tenant ON viatico(tenant_id);

-- -----------------------------------------------------------------------------
-- firma (modelo Firma, @@map("firma")) — causa real: "The table `public.firma`
-- does not exist in the current database." La BD real solo tiene
-- `firma_electronica` (evento de firma sobre una entidad: OT/certificado/
-- custodia), que es un concepto distinto del modelo Prisma `Firma` (registro
-- 1:1 por usuario de su firma-imagen + hash, usado por FirmaService/RBAC
-- para "firma.registrar"). No se renombra ni se reutiliza firma_electronica
-- (romperia sus FKs desde boletin_analisis/cadena_custodia/ot_firma); se crea
-- la tabla nueva que el modelo espera. Se añade tenant_id de una vez (parte 2)
-- porque la tabla se crea aquí mismo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS firma (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID NOT NULL UNIQUE REFERENCES usuario(id),
  imagen_ref    VARCHAR(200),
  hash_sha256   VARCHAR(64),
  registrada_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     UUID REFERENCES tenant(id)
);
UPDATE firma f SET tenant_id = u.tenant_id
  FROM usuario u WHERE u.id = f.usuario_id AND f.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_firma_tenant ON firma(tenant_id);

-- -----------------------------------------------------------------------------
-- lista_precio_item (modelo ListaPrecioItem)
-- Causa real (log api): 'Error converting field "id" of expected non-nullable
-- type "String", found incompatible value of "null".' align_schema_to_prisma.sql
-- ya había añadido id/lista_precio_id/codigo/descripcion como columnas NULLABLE
-- pero nunca las rellenó para las 136 filas sembradas (la PK real de esta
-- tabla sigue siendo la compuesta (lista_id, metodo_id); no se toca). Se
-- backfillean con datos reales (metodo.codigo/nombre) y, si no hay método
-- resoluble, con un valor de reserva explícito para que quede evidente que
-- requiere revisión manual.
-- -----------------------------------------------------------------------------
UPDATE lista_precio_item SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE lista_precio_item SET lista_precio_id = lista_id WHERE lista_precio_id IS NULL;
UPDATE lista_precio_item lpi
  SET codigo = COALESCE(lpi.codigo, m.codigo),
      descripcion = COALESCE(lpi.descripcion, m.nombre)
  FROM metodo m
  WHERE m.id = lpi.metodo_id AND (lpi.codigo IS NULL OR lpi.descripcion IS NULL);
UPDATE lista_precio_item
  SET codigo = COALESCE(codigo, 'SIN-CODIGO'),
      descripcion = COALESCE(descripcion, 'Sin descripcion')
  WHERE codigo IS NULL OR descripcion IS NULL;
ALTER TABLE lista_precio_item ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- -----------------------------------------------------------------------------
-- tipos-muestra: SIGUE EN 500 TRAS ESTE SCRIPT. NO ES DERIVA DE ESQUEMA.
-- Causa real (log api): PrismaClientValidationError en
-- `prisma.tipoMuestra.findMany({ orderBy: { createdAt: "desc" } })` porque el
-- modelo Prisma `TipoMuestra` (schema.prisma) NO declara el campo `createdAt`
-- (TipoMuestraService no pasa `orderBy` propio, así que
-- BaseCrudService usa el default `{ createdAt: "desc" }`). Se verificó en
-- vivo que la columna `tipo_muestra.created_at` YA EXISTE en la BD — añadirla
-- no cambia nada porque la validación de Prisma ocurre contra el cliente
-- generado (DMMF), no contra la base de datos real. Este 500 requiere un
-- cambio de código (añadir `createdAt DateTime @map("created_at")` al modelo
-- TipoMuestra + regenerar el cliente Prisma, o pasar `orderBy: { codigo: "asc" }`
-- en TipoMuestraService) y por tanto queda fuera del alcance de este script
-- SQL-only. Documentado aquí para que quede registro; no se emite ALTER
-- porque no tendría efecto.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- PARTE 2 · Fuga cross-tenant: tenant_id en Analito / NormaLimite / Resultado
-- / Firma. (Permiso queda excluido a propósito: es catálogo global del
-- sistema, no de un tenant — RBAC.md y el propio modelo Prisma lo confirman:
-- Permiso no tiene tenantId).
-- No se pone NOT NULL en ningún tenant_id nuevo para no romper inserts
-- existentes que aún no lo completen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- analito → falta tenant_id. Relación natural: analito.metodo_id -> metodo.tenant_id
-- cuando existe (136/272 filas); para el resto, analito.metodo_version_id ->
-- metodo_version.metodo_id -> metodo.tenant_id (los otros 136/272).
-- -----------------------------------------------------------------------------
ALTER TABLE analito ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id);
UPDATE analito a SET tenant_id = m.tenant_id
  FROM metodo m
  WHERE m.id = a.metodo_id AND a.tenant_id IS NULL;
UPDATE analito a SET tenant_id = m.tenant_id
  FROM metodo_version mv JOIN metodo m ON m.id = mv.metodo_id
  WHERE mv.id = a.metodo_version_id AND a.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_analito_tenant ON analito(tenant_id);

-- -----------------------------------------------------------------------------
-- norma_limite → falta tenant_id. Relación natural: norma_limite.analito_id
-- -> analito.tenant_id (ya backfilleado arriba en el mismo script).
-- -----------------------------------------------------------------------------
ALTER TABLE norma_limite ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id);
UPDATE norma_limite nl SET tenant_id = a.tenant_id
  FROM analito a
  WHERE a.id = nl.analito_id AND nl.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_norma_limite_tenant ON norma_limite(tenant_id);

-- -----------------------------------------------------------------------------
-- resultado → la columna tenant_id YA EXISTE (nullable; align_schema_to_prisma.sql
-- ya le quitó el NOT NULL heredado de schema.sql). Solo falta backfillear las
-- filas que quedaron con tenant_id NULL (capturas hechas por ResultadoService,
-- que no lo setea) y el índice. Relación natural: resultado.muestra_id ->
-- muestra.tenant_id; si no hay muestra, resultado.ot_id -> orden_trabajo.tenant_id.
-- -----------------------------------------------------------------------------
UPDATE resultado r SET tenant_id = mu.tenant_id
  FROM muestra mu
  WHERE mu.id = r.muestra_id AND r.tenant_id IS NULL;
UPDATE resultado r SET tenant_id = ot.tenant_id
  FROM orden_trabajo ot
  WHERE ot.id = r.ot_id AND r.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_resultado_tenant ON resultado(tenant_id);

-- -----------------------------------------------------------------------------
-- firma → tenant_id ya se añadió y backfilleó en la Parte 1 (la tabla se creó
-- en este mismo script; se deja este bloque como no-op idempotente por si
-- `firma` ya existiera con filas sin tenant_id al aplicar en otro entorno).
-- Relación natural: firma.usuario_id -> usuario.tenant_id.
-- -----------------------------------------------------------------------------
UPDATE firma f SET tenant_id = u.tenant_id
  FROM usuario u
  WHERE u.id = f.usuario_id AND f.tenant_id IS NULL;

-- permiso: sin cambios — es catálogo global (no tiene tenant_id en el modelo
-- Prisma ni debe tenerlo; los 36 permisos son compartidos por todos los tenants).

-- =============================================================================
-- FIN
-- =============================================================================
