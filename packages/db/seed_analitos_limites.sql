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

-- -----------------------------------------------------------------------------
-- 1) Norma genérica interna para servir de `norma_id` (PK compuesta NOT NULL
--    de norma_limite). No se usa la norma técnica real de cada método: es un
--    ancla estable para los límites genéricos que genera este seed.
-- -----------------------------------------------------------------------------
INSERT INTO norma (codigo, nombre, organismo, vigente)
SELECT 'IDIC-GEN-LIM', 'Límites internos de referencia (seed captura de resultados)', 'IDIC', TRUE
WHERE NOT EXISTS (SELECT 1 FROM norma WHERE codigo = 'IDIC-GEN-LIM');

-- -----------------------------------------------------------------------------
-- 2) Un analito por método, con metodo_id poblado.
--    - metodo_version_id: se resuelve a la versión vigente del método (o la
--      más reciente si no hay ninguna 'vigente'); si el método no tiene
--      ninguna versión, se omite (la columna es NOT NULL en schema.sql).
--    - numero: correlativo siguiente dentro de esa versión (evita choque con
--      el analito #1 que ya insertó seed_catalogos_metodos.sql).
--    - codigo: <codigo_metodo sanitizado>-A1 (clave estable para idempotencia).
--    - nombre/unidad/rangos: derivados de metodo.tipo / metodo.tecnica /
--      metodo.nombre con reglas simples y plausibles.
-- -----------------------------------------------------------------------------
WITH candidatos AS (
  SELECT
    m.id                                   AS metodo_id,
    m.codigo                                AS metodo_codigo,
    m.nombre                                AS metodo_nombre,
    m.tecnica                               AS tecnica,
    m.tipo                                  AS tipo,
    m.familia                               AS familia,
    (
      SELECT mv.id
      FROM metodo_version mv
      WHERE mv.metodo_id = m.id
      ORDER BY (mv.estado = 'vigente') DESC, mv.vigente_desde DESC NULLS LAST, mv.created_at DESC
      LIMIT 1
    ) AS metodo_version_id
  FROM metodo m
  JOIN tenant t ON t.id = m.tenant_id
  WHERE t.codigo = 'IDIC'
    AND m.deleted_at IS NULL
),
clasificados AS (
  SELECT
    c.*,
    regexp_replace(c.metodo_codigo, '[^A-Za-z0-9]+', '-', 'g') || '-A1' AS analito_codigo,
    CASE
      WHEN c.tipo = 'cualitativo'                                                    THEN 'Resultado'
      WHEN c.metodo_nombre ILIKE '%humedad%'                                          THEN 'Contenido de humedad'
      WHEN c.metodo_nombre ILIKE '%ceniza%'                                           THEN 'Contenido de cenizas'
      WHEN c.metodo_nombre ILIKE '%grasa%' OR c.metodo_nombre ILIKE '%proteína%'
        OR c.metodo_nombre ILIKE '%bromatológ%'                                       THEN 'Contenido'
      WHEN c.tecnica ILIKE '%AAS%' OR c.metodo_nombre ILIKE '%absorción atómica%'
        OR c.metodo_nombre ILIKE '%determinación de%'                                 THEN 'Concentración'
      WHEN c.tecnica ILIKE '%HPLC%' OR c.tecnica ILIKE '%cromatograf%'                 THEN 'Concentración'
      WHEN c.tecnica ILIKE '%microbiológ%' OR c.metodo_nombre ILIKE '%microbio%'
        OR c.metodo_nombre ILIKE '%UFC%'                                              THEN 'Recuento microbiológico'
      WHEN c.metodo_nombre ILIKE '%resistencia%' OR c.metodo_nombre ILIKE '%tracción%' THEN 'Resistencia'
      WHEN c.metodo_nombre ILIKE '%espesor%' OR c.metodo_nombre ILIKE '%dimensi%'
        OR c.metodo_nombre ILIKE '%longitud%'                                         THEN 'Medición dimensional'
      WHEN c.metodo_nombre ILIKE '%peso%'                                             THEN 'Peso'
      WHEN c.metodo_nombre ILIKE '%temperatura%'                                      THEN 'Temperatura'
      WHEN c.metodo_nombre ILIKE '%frecuencia%'                                       THEN 'Frecuencia'
      WHEN c.metodo_nombre ILIKE '%potencia%'                                         THEN 'Potencia'
      WHEN c.metodo_nombre ILIKE '%tensión%' OR c.metodo_nombre ILIKE '%voltaje%'      THEN 'Tensión'
      WHEN c.metodo_nombre ILIKE '%corriente%' OR c.metodo_nombre ILIKE '%consumo%'    THEN 'Corriente'
      WHEN c.tecnica ILIKE '%Visual%' OR c.tecnica ILIKE '%Operacional%'               THEN 'Resultado'
      ELSE 'Resultado'
    END AS analito_nombre,
    CASE
      WHEN c.tipo = 'cualitativo'                                                     THEN NULL
      WHEN c.metodo_nombre ILIKE '%humedad%' OR c.metodo_nombre ILIKE '%ceniza%'
        OR c.metodo_nombre ILIKE '%grasa%' OR c.metodo_nombre ILIKE '%proteína%'       THEN '%'
      WHEN c.tecnica ILIKE '%AAS%' OR c.metodo_nombre ILIKE '%absorción atómica%'      THEN 'ppm'
      WHEN c.tecnica ILIKE '%HPLC%' OR c.tecnica ILIKE '%cromatograf%'                 THEN 'mg/kg'
      WHEN c.tecnica ILIKE '%microbiológ%' OR c.metodo_nombre ILIKE '%UFC%'            THEN 'UFC/g'
      WHEN c.metodo_nombre ILIKE '%resistencia%' OR c.metodo_nombre ILIKE '%tracción%' THEN 'N'
      WHEN c.metodo_nombre ILIKE '%espesor%' OR c.metodo_nombre ILIKE '%dimensi%'
        OR c.metodo_nombre ILIKE '%longitud%'                                         THEN 'mm'
      WHEN c.metodo_nombre ILIKE '%peso%'                                             THEN 'g'
      WHEN c.metodo_nombre ILIKE '%temperatura%'                                      THEN '°C'
      WHEN c.metodo_nombre ILIKE '%frecuencia%'                                       THEN 'Hz'
      WHEN c.metodo_nombre ILIKE '%potencia%'                                         THEN 'W'
      WHEN c.metodo_nombre ILIKE '%tensión%' OR c.metodo_nombre ILIKE '%voltaje%'      THEN 'V'
      WHEN c.metodo_nombre ILIKE '%corriente%' OR c.metodo_nombre ILIKE '%consumo%'    THEN 'A'
      WHEN c.tipo = 'semicuantitativo'                                                THEN 'pts'
      ELSE '%'
    END AS analito_unidad
  FROM candidatos c
),
rangos AS (
  SELECT
    cl.*,
    CASE WHEN cl.analito_unidad IS NULL THEN NULL ELSE 0 END                              AS r_min,
    CASE
      WHEN cl.analito_unidad IS NULL THEN NULL
      ELSE (CASE cl.analito_unidad
        WHEN '%'     THEN 100 WHEN 'ppm'  THEN 1000 WHEN 'mg/kg' THEN 500 WHEN 'UFC/g' THEN 1000
        WHEN 'N'     THEN 500 WHEN 'mm'   THEN 1000 WHEN 'g'     THEN 5000 WHEN '°C'    THEN 100
        WHEN 'Hz'    THEN 100000 WHEN 'W' THEN 1000 WHEN 'V'     THEN 250 WHEN 'A'      THEN 100
        WHEN 'pts'   THEN 10
        ELSE 100
      END)
    END                                                                                    AS r_max
  FROM clasificados cl
),
final AS (
  SELECT
    r.*,
    CASE WHEN r.r_min IS NULL THEN NULL ELSE round(((r.r_min + r.r_max) / 2.0), 3) END AS r_nom
  FROM rangos r
  WHERE r.metodo_version_id IS NOT NULL
)
INSERT INTO analito (
  metodo_version_id, numero, nombre, unidad, rango_min, rango_nominal, rango_max,
  formula_calculo, ingreso, auto_calc, metodo_id, codigo, formula
)
SELECT
  f.metodo_version_id,
  COALESCE((SELECT MAX(a2.numero) FROM analito a2 WHERE a2.metodo_version_id = f.metodo_version_id), 0) + 1,
  f.analito_nombre,
  f.analito_unidad,
  f.r_min,
  f.r_nom,
  f.r_max,
  'promedio(RN)',
  'Manual',
  FALSE,
  f.metodo_id,
  f.analito_codigo,
  'promedio(RN)'
FROM final f
WHERE NOT EXISTS (
  SELECT 1 FROM analito a3 WHERE a3.metodo_id = f.metodo_id AND a3.codigo = f.analito_codigo
);

-- -----------------------------------------------------------------------------
-- 3) Un límite (norma_limite) por cada analito con metodo_id poblado, usando
--    el mismo rango calculado al insertarlo (rango_min/rango_nominal/rango_max
--    quedaron guardados en el propio analito). producto = 'General'.
--    Idempotente vía ON CONFLICT sobre la PK compuesta (norma_id, analito_id).
-- -----------------------------------------------------------------------------
INSERT INTO norma_limite (norma_id, analito_id, rango_min, rango_max, unidad, id, producto, limite_inf, nominal, limite_sup)
SELECT
  n.id,
  a.id,
  a.rango_min,
  a.rango_max,
  a.unidad,
  gen_random_uuid(),
  'General',
  a.rango_min,
  a.rango_nominal,
  a.rango_max
FROM analito a
JOIN norma n ON n.codigo = 'IDIC-GEN-LIM'
WHERE a.metodo_id IS NOT NULL
ON CONFLICT (norma_id, analito_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- FIN
-- =============================================================================
