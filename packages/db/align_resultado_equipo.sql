-- =============================================================================
-- LIMS IDIC · align_resultado_equipo.sql
-- RF-D04 · Equipos y condiciones — D04.1 registrar el equipo usado en cada
-- resultado + D04.2 BLOQUEAR la captura con un equipo descalibrado / fuera de
-- servicio (NCh-ISO/IEC 17025: no se puede emitir un resultado con un equipo no
-- apto).
--
-- Añade a la tabla `resultado` la columna `equipo_id`, que enlaza el resultado
-- con el `equipo` (parque gestionado por equipos_custodia.sql / equipos.module.ts)
-- con el que se ejecutó el ensayo. El BLOQUEO por calibración vencida lo aplica
-- la API en ResultadoService.capturar() llamando a EquiposService.verificarApto()
-- ANTES de persistir; esta columna sólo guarda la trazabilidad del equipo apto.
--
-- Se aplica DESPUÉS de schema.sql + align_schema_to_prisma.sql + align_final.sql
-- + equipos_custodia.sql (que crea la tabla `equipo`). 100% IDEMPOTENTE Y
-- ADITIVO: sólo ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. No
-- elimina ni renombra nada.
--
-- Ejecución:
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < packages/db/align_resultado_equipo.sql
--
-- ⚠️ PENDIENTE DE INTEGRACIÓN: añadir este fichero a la lista de scripts del
-- bucle `for f in ...` de provision.sh, después de align_resultado_estado.sql y
-- de equipos_custodia.sql. No se toca provision.sh desde aquí para no pisar a
-- otros agentes.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · Equipo usado en el ensayo (RF-D04.1)
-- UUID sin FK declarada por dos motivos: (a) coherencia con el resto de enlaces
-- entre el dominio Prisma (`resultado`) y el dominio SQL-crudo de equipos
-- (`equipo`, gestionado fuera de Prisma), y (b) el modelo Prisma `Resultado` la
-- expone como columna escalar `equipoId` @map("equipo_id"), sin relación, igual
-- que hace con otros ids. La integridad "equipo apto" se garantiza en la API
-- (verificarApto lanza 404 si el equipo no existe / es de otro tenant, y 409 si
-- no está apto) antes de insertar la fila, que es donde se puede dar un mensaje
-- útil al analista.
-- NULLABLE: el campo es OPCIONAL. Los resultados históricos y las capturas que
-- no informan equipo quedan con equipo_id NULL (comportamiento previo intacto);
-- sólo cuando se informa un equipo se valida y se guarda.
-- -----------------------------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS equipo_id UUID;


-- -----------------------------------------------------------------------------
-- 2 · Índice
-- Sirve la trazabilidad inversa "¿qué resultados se emitieron con este equipo?"
-- (relevante cuando una calibración sale no conforme y hay que revisar lo
-- emitido con ese equipo en el periodo dudoso). Parcial sobre NOT NULL: la
-- inmensa mayoría de filas históricas no informan equipo y no deben engordar el
-- índice.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_resultado_equipo
  ON resultado(equipo_id)
  WHERE equipo_id IS NOT NULL;


-- =============================================================================
-- Verificación (tras aplicar):
--   \d resultado           → columna equipo_id UUID presente.
--   SELECT count(*) FROM resultado WHERE equipo_id IS NOT NULL;  → 0 al inicio.
--
-- Después de aplicar hay que regenerar el cliente Prisma para que la API vea el
-- campo nuevo:  pnpm --filter @lims-idic/db exec prisma generate
-- (el Dockerfile de la API ya lo hace en el build, así que un redespliegue basta).
-- =============================================================================
