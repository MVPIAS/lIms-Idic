-- =============================================================================
-- align_puente_catalogo.sql · PUENTE Catálogo v2 (cascada) -> Flujo operativo
-- -----------------------------------------------------------------------------
-- Conecta el catálogo corregido (tablas cat_*, ver catalogo_v2.sql) con la
-- captura de resultados operativa. Al registrar una OT desde la cascada, los
-- MÉTODOS elegidos del panel (cat_panel) se materializan como filas `resultado`
-- por analizar, arrastrando su ESPECIFICACIÓN (Mín/Nominal/Máx) y su FÓRMULA,
-- de modo que quede habilitado el ciclo captura -> veredicto -> informe.
--
-- CARACTERÍSTICAS (obligatorias por el encargo):
--   * ADITIVO      : sólo ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--                    NO borra ni cambia columnas existentes. `analito_id` (viejo)
--                    sigue siendo nullable: los resultados del puente usan
--                    cat_analito_id en su lugar y dejan analito_id en NULL.
--   * IDEMPOTENTE  : re-ejecutable sin error (IF NOT EXISTS en todo).
--   * ORDEN        : aplicar DESPUÉS de catalogo_v2.sql (crea cat_*) y de
--                    align_flujo_real.sql (añade cat_elemento_id a orden_trabajo).
--
-- Aplicar:  psql "$DATABASE_URL" -f packages/db/align_puente_catalogo.sql
-- PostgreSQL 14+.
-- =============================================================================

-- ------------------------------------------------------- RESULTADO · PUENTE ---
-- Referencias al catálogo v2. Nullable: los resultados legacy y de captura por
-- réplicas (analito_id) no las usan; los del puente sí. `analito_id` NO se toca
-- (ya es nullable) para que ambos caminos convivan.
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS cat_analito_id UUID REFERENCES cat_analito(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS cat_metodo_id  UUID REFERENCES cat_metodo(id);

-- Especificación ARRASTRADA en el instante de generar el análisis (copia
-- congelada de cat_especificacion / cat_analito): el catálogo es editable y el
-- resultado tiene que seguir siendo reproducible aunque el límite cambie luego.
-- TEXT porque el catálogo contiene límites no numéricos ('cumple','Declarado').
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS limite_inf TEXT;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS nominal    TEXT;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS limite_sup TEXT;
-- `unidad` y `veredicto` YA existen en resultado (schema.sql / align previos):
-- el ADD IF NOT EXISTS es no-op y se reutilizan tal cual.
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS unidad     VARCHAR(60);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS veredicto  VARCHAR(20);   -- cumple|no_cumple|pendiente
-- Fórmula del analito del catálogo (copia congelada). Coexiste con
-- formula_aplicada (motor de réplicas): son caminos distintos.
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS formula    TEXT;

COMMENT ON COLUMN resultado.cat_analito_id IS 'Puente: analito del catálogo v2 (cat_analito). NULL en resultados por réplicas (usan analito_id).';
COMMENT ON COLUMN resultado.cat_metodo_id  IS 'Puente: método del catálogo v2 (cat_metodo) que originó este resultado.';
COMMENT ON COLUMN resultado.veredicto      IS 'cumple | no_cumple | pendiente (arrastrado del contraste con limite_inf/limite_sup).';

CREATE INDEX IF NOT EXISTS idx_resultado_cat_analito ON resultado(cat_analito_id);
CREATE INDEX IF NOT EXISTS idx_resultado_cat_metodo  ON resultado(cat_metodo_id);

-- Idempotencia dura a nivel de BD: un mismo par (muestra, cat_analito) no puede
-- materializarse dos veces. Parcial (sólo filas del puente vivas) para no
-- interferir con los resultados por réplicas (cat_analito_id NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_resultado_muestra_cat_analito
  ON resultado(muestra_id, cat_analito_id)
  WHERE cat_analito_id IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------- MUESTRA · TRAZA -------
-- Traza del elemento del catálogo v2 que originó la muestra (el wizard de OT
-- crea una muestra por elemento de la cascada). Nullable: las muestras legacy
-- no lo llevan.
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS cat_elemento_id UUID REFERENCES cat_elemento(id);
COMMENT ON COLUMN muestra.cat_elemento_id IS 'Puente: elemento del catálogo v2 (cat_elemento) del que procede la muestra.';
CREATE INDEX IF NOT EXISTS idx_muestra_cat_elemento ON muestra(cat_elemento_id);

-- =============================================================================
-- FIN. El endpoint POST /flujo/ot/:id/generar-analisis (flujo-real.module.ts)
-- consume estas columnas para materializar el panel como resultados.
-- =============================================================================
