-- =============================================================================
-- align_fx5_d.sql · Correcciones v4 (recorrido de manuales 12-11-2026), frente fx5-d:
-- Metrología, Vestuario, DSA y terreno. Idempotente: se puede aplicar varias veces.
-- Sin DROP ni borrado de datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- F051 / F053 · Maestro de patrones y equipos auxiliares por laboratorio.
-- Un equipo puede ser de varios laboratorios (un termohigrómetro o un barómetro
-- compartido entre LMT, LMTE y LNF). Lista vacía o nula = común a todos.
-- La columna antigua `laboratorio` se conserva con el primero de la lista.
-- -----------------------------------------------------------------------------
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS laboratorios VARCHAR(10)[];

UPDATE met_patron SET laboratorios = ARRAY[laboratorio]
 WHERE laboratorios IS NULL AND laboratorio IS NOT NULL;

-- Los patrones propios del LNF (planilla LCPNF-010.26, pestaña TID) son datos reales
-- del IDIC: se cargan aparte, fuera del repositorio público (datos_reales/patrones_lnf_fx5d.sql).

-- -----------------------------------------------------------------------------
-- F089 · Margen de advertencia: ahora es el % de cada límite, con tope en el % del
-- ancho del intervalo Mín–Máx (laboratorio/advertencia.ts › margenDeLimite). Solo se
-- actualiza el texto de ayuda del parámetro si sigue siendo el original.
-- -----------------------------------------------------------------------------
UPDATE parametro_sistema
   SET etiqueta = 'Margen de advertencia: % de cada límite (tope: % del intervalo Mín–Máx) en que un resultado que cumple queda «en advertencia» (0 = sin advertencias)'
 WHERE categoria = 'resultados' AND codigo = 'advertencia_margen_pct'
   AND etiqueta = 'Margen de advertencia: % del intervalo Mín–Máx (o del límite único) en que un resultado que cumple queda «en advertencia» (0 = sin advertencias)';
