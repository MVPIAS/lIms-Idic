-- =============================================================================
-- LIMS IDIC · Métodos de Microbiología con QC exigido (EP-02 ALI-D6) · Aiuken
-- =============================================================================
-- Las planillas LMB (IT31/IT33/IT34) registran en cada corrida control
-- positivo, negativo y blanco. Sin marcar los métodos, el bloqueo de emisión de
-- align_qc_microbiologico.sql no se aplica a ningún ensayo. Se marcan los
-- métodos de las familias «Lab. Microbiologia».
-- Solo toca métodos sin configuración de QC (no pisa lo editado en pantalla).
-- Por confirmar con el IDIC si algún método queda exento.
-- =============================================================================

UPDATE cat_metodo m
   SET qc_requerido = TRUE,
       qc_tipos     = ARRAY['positivo', 'negativo', 'blanco']
  FROM cat_ensayo e
  JOIN cat_familia f ON f.id = e.familia_id
 WHERE e.id = m.ensayo_id
   AND f.laboratorio ILIKE 'Lab. Microbiolog%'
   AND m.deleted_at IS NULL
   AND m.qc_requerido IS NOT TRUE
   AND COALESCE(cardinality(m.qc_tipos), 0) = 0;
