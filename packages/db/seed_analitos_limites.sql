-- =============================================================================
-- SEED · ANALITOS Y LÍMITES PARA "CAPTURA DE RESULTADOS"
-- =============================================================================
-- OBJETIVO: la pantalla Captura de resultados (apps/web/app/(app)/captura/page.tsx)
-- carga GET /analitos y necesita filas visibles vía el cliente Prisma (que
-- relaciona metodo -> analitos por `metodo_id`, ver AnalitoService/MetodoService
-- en apps/api/src/laboratorio/laboratorio.module.ts). Los 136 analitos que ya
-- crea seed_catalogos_metodos.sql sólo tienen `metodo_version_id` (columna
-- original de schema.sql) y no `metodo_id`, por lo que son invisibles para la
-- API. Este script:
--   1) Añade 1 analito por cada método existente en `metodo`, con
--      `metodo_id` poblado (además de `metodo_version_id`, que sigue siendo
--      NOT NULL en schema.sql), para que aparezcan en /analitos y /metodos.
--   2) Añade 1 fila en `norma_limite` por cada analito insertado, con un
--      rango plausible (limite_inf/limite_sup) para que
--      ResultadoService.capturar() (apps/api/src/laboratorio/laboratorio.module.ts)
--      pueda calcular el veredicto Cumple/No cumple/Informativo contra un
--      límite real.
--
-- NOTA IMPORTANTE (alineación de esquema, mismo espíritu que
-- packages/db/align_schema_to_prisma.sql): el modelo Prisma `NormaLimite`
-- (packages/db/prisma/schema.prisma) espera columnas `id`, `producto`,
-- `limite_inf`, `nominal`, `limite_sup` en la tabla `norma_limite`, pero
-- schema.sql sólo definió `norma_id, analito_id, rango_min, rango_max, unidad`
-- con PK compuesta (norma_id, analito_id) — align_schema_to_prisma.sql nunca
-- tocó esta tabla. Sin esas columnas, cualquier consulta Prisma sobre
-- normaLimite (incluido el include:{limites:true} de GET /analitos) falla con
-- "column norma_limite.xxx does not exist". Por eso este script agrega esas
-- columnas de forma 100% aditiva (ADD COLUMN IF NOT EXISTS, sin tocar ni
-- eliminar nada existente) antes de insertar datos. No se modifica ningún
-- otro archivo del repo.
--
-- Ejecutar DESPUÉS de schema.sql + align_schema_to_prisma.sql +
-- seed_catalogos_metodos.sql.  Idempotente: se puede correr múltiples veces.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 0) Alineación aditiva de norma_limite con el modelo Prisma NormaLimite
--    (misma técnica que packages/db/align_schema_to_prisma.sql)
-- -----------------------------------------------------------------------------
ALTER TABLE norma_limite ADD COLUMN IF NOT EXISTS id         UUID DEFAULT gen_random_uuid();
ALTER TABLE norma_limite ADD COLUMN IF NOT EXISTS producto   VARCHAR(200);
ALTER TABLE norma_limite ADD COLUMN IF NOT EXISTS limite_inf NUMERIC(18,6);
ALTER TABLE norma_limite ADD COLUMN IF NOT EXISTS nominal    NUMERIC(18,6);
ALTER TABLE norma_limite ADD COLUMN IF NOT EXISTS limite_sup NUMERIC(18,6);
-- Backfill por si ya existieran filas sin id (no debería haber, la tabla parte vacía)
UPDATE norma_limite SET id = gen_random_uuid() WHERE id IS NULL;


-- Los datos de ejemplo que sembraba este fichero están en seed_analitos_limites_demo.sql (solo demo,
-- ORDEN_SQL.txt), para que la instalación «sin-demo» no cargue datos inventados.

COMMIT;

-- =============================================================================
-- FIN
-- =============================================================================
