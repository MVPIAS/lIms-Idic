-- =============================================================================
-- LIMS IDIC · align_resultado_estado.sql
-- RF-E01 · Aprobación escalonada de resultados + RF-A06/D02.1 · motor de fórmulas
--
-- Habilita en el modelo Prisma `Resultado` el ciclo de vida
--   capturado → revisado_n1 → aprobado   (+ rechazado / devuelto hacia atrás)
-- que `packages/db/schema.sql:873` ya definía en la tabla y que
-- `apps/api/src/common/estados.ts` ya tenía mapeado, pero que la API no podía
-- aplicar porque el modelo Prisma no declaraba las columnas (ver la nota
-- "DEFINIDO PERO NO APLICADO" de estados.ts y §5.8 de docs/AUDITORIA_FUNCIONAL.md).
--
-- Se aplica DESPUÉS de schema.sql + align_schema_to_prisma.sql + align_final.sql
-- (mismo orden que provision.sh). 100% IDEMPOTENTE: sólo
--   ADD COLUMN IF NOT EXISTS / ALTER COLUMN SET DEFAULT /
--   UPDATE ... WHERE x IS NULL (backfill) / CREATE INDEX IF NOT EXISTS.
-- No elimina ni renombra nada.
--
-- Ejecución:
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < packages/db/align_resultado_estado.sql
--
-- ⚠️ PENDIENTE DE INTEGRACIÓN: añadir este fichero a la lista de scripts del
-- bucle `for f in ...` de provision.sh, justo DESPUÉS de align_final.sql. No se
-- ha tocado provision.sh desde aquí para no pisar a otros agentes.
--
-- -----------------------------------------------------------------------------
-- NOTA SOBRE LOS NOMBRES DE COLUMNA (desviación deliberada del encargo)
-- -----------------------------------------------------------------------------
-- El encargo pedía crear `revisado_por` / `revisado_at`. NO se han creado: la
-- tabla `resultado` de schema.sql YA tiene `revisado_n1_por` / `revisado_n1_at`
-- (y `aprobado_por` / `aprobado_at`, y `estado`, y `resultado_final`) desde el
-- diseño original. Crear un segundo par de columnas con el mismo significado
-- habría dejado la tabla con dos sitios donde apuntar quién revisó, que es
-- exactamente la clase de ambigüedad que un auditor de la 17025 marca como
-- hallazgo. Se reutilizan las que ya existen y el modelo Prisma las expone como
-- `revisadoPor` / `revisadoAt` vía @map. El sufijo `_n1` es además coherente
-- con el nombre del estado (`revisado_n1`), que sí es el vocabulario real.
--
-- Las columnas se declaran igualmente con ADD COLUMN IF NOT EXISTS para que el
-- script sea aplicable a una BD que no venga de schema.sql (no-op si ya están).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · Ciclo de vida (RF-E01)
-- Vocabulario (estados.ts / schema.sql:873): capturado, revisado_n1, aprobado,
-- rechazado, devuelto. VARCHAR sin CHECK, igual que el resto de estados del
-- esquema: la máquina de estados se aplica en la API (validarTransicion), que
-- es donde puede dar un mensaje de error útil. Se mantiene la coherencia con
-- cotizacion/ot/certificado en vez de introducir aquí un CHECK que sólo
-- cubriría esta tabla.
-- -----------------------------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'capturado';
ALTER TABLE resultado ALTER COLUMN estado SET DEFAULT 'capturado';

-- Backfill: toda fila preexistente es, por definición, una captura sin revisar.
-- NO se marcan como aprobadas: no consta quién las aprobó y la 17025 no admite
-- aprobación sin firmante identificado.
UPDATE resultado SET estado = 'capturado' WHERE estado IS NULL OR btrim(estado) = '';

-- Quién y cuándo revisó / aprobó (no repudio del acto, RF-E02.3).
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS revisado_n1_por UUID REFERENCES usuario(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS revisado_n1_at  TIMESTAMPTZ;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS aprobado_por    UUID REFERENCES usuario(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS aprobado_at     TIMESTAMPTZ;

-- Motivo de la devolución/rechazo. RF-E01 exige rechazo MOTIVADO: sin el motivo
-- el analista no sabe qué corregir y el registro no es trazable.
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS motivo_devolucion TEXT;


-- -----------------------------------------------------------------------------
-- 2 · Motor de fórmulas (RF-A06 / RF-D02.1)
-- `resultado_final` ya existe en schema.sql con el comentario "valor calculado
-- por fórmula": es justo su propósito, así que se reutiliza en vez de crear una
-- columna nueva. Guarda el valor que devuelve la fórmula del analito; si el
-- analito no tiene fórmula queda NULL y el valor del ensayo sigue siendo
-- `promedio` (comportamiento actual, intacto).
--
-- `formula_aplicada` es nueva y guarda el TEXTO de la fórmula tal y como estaba
-- en el catálogo en el instante de la captura. Es un requisito de trazabilidad,
-- no una redundancia: `analito.formula` es editable, y sin esta copia un
-- resultado emitido hace seis meses no sería reproducible después de que un
-- jefe de laboratorio corrigiese la fórmula del analito.
-- -----------------------------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS resultado_final  NUMERIC;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS formula_aplicada TEXT;


-- -----------------------------------------------------------------------------
-- 3 · Índices
-- El de schema.sql (idx_resultado_estado) es (estado, capturado_at). La API
-- ordena y filtra por `fecha` (columna del modelo Prisma), no por capturado_at,
-- así que se añade el índice que sirve de verdad a la bandeja "pendientes de
-- revisar/aprobar". Se usa un nombre distinto para no chocar con el existente.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_resultado_estado_fecha ON resultado(estado, fecha DESC);


-- =============================================================================
-- Verificación (tras aplicar):
--   SELECT estado, count(*) FROM resultado GROUP BY estado;
--     → todas las filas preexistentes en 'capturado', ninguna NULL.
--   \d resultado
--     → estado / revisado_n1_por / revisado_n1_at / aprobado_por / aprobado_at /
--       motivo_devolucion / resultado_final / formula_aplicada presentes.
--
-- Después de aplicar hay que regenerar el cliente Prisma para que la API vea
-- los campos nuevos:  pnpm --filter @lims-idic/db exec prisma generate
-- (el Dockerfile de la API ya lo hace en el build, así que un redespliegue basta).
-- =============================================================================
