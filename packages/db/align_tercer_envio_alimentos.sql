-- =============================================================================
-- align_tercer_envio_alimentos.sql · Respuestas del IDIC del tercer envío
-- (17-11-2026), hoja «6 Sección Alimentos» · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql. No crea permisos.
--
--   1. SAL-01 · «Registrar los datos en cada etapa e individuales»: se activan
--      los formularios de Microbiología (lmb_micro: siembra, incubación,
--      lecturas, confirmación) y de Evaluación Sensorial (les_panel: cartilla
--      por juez y estadístico) para los métodos del LMB y del LES.
--   2. SAL-07 · «El ensayo entrega resultados, no condición de cumplimiento»:
--      las especificaciones del catálogo del LQA pasan a «solo resultado» (sin
--      Cumple / No cumple). Solo las que nadie ha decidido (evaluacion NULL).
--   3. SAL-09 · «No se usan contramuestras (o testigos)»: la recepción de la
--      Sección Alimentos (SAL, LQA, LMB, LES) deja de ofrecer y aceptar los
--      destinos «Contramuestra» y «Testigo». No se borra nada en otras áreas.
--
-- Cada cambio de parámetro deja su fila en parametro_sistema_historial con el
-- motivo «Respuesta IDIC tercer envío 17-11-2026 (<REF>)». Si una persona ya
-- cambió el parámetro desde la pantalla (historial con usuario), no se toca.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SAL-01 · Formularios por etapa del LMB y del LES
-- ---------------------------------------------------------------------------
-- 1a. Las filas sembradas inactivas por align_r2a_formularios.sql (EP-02 P1).
WITH cambiados AS (
  UPDATE parametro_sistema p
     SET activo = TRUE, updated_at = now()
   WHERE p.categoria = 'captura_variante_metodo'
     AND p.valor IN ('lmb_micro', 'les_panel')
     AND NOT p.activo
     AND NOT EXISTS (SELECT 1 FROM parametro_sistema_historial h WHERE h.parametro_id = p.id AND h.usuario_id IS NOT NULL)
  RETURNING p.id, p.tenant_id, p.codigo, p.valor
)
INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
SELECT c.tenant_id, c.id, 'captura_variante_metodo', c.codigo, c.valor || ' · inactiva', c.valor || ' · activa',
       'Respuesta IDIC tercer envío 17-11-2026 (SAL-01): registrar los datos de cada etapa e individuales.', NULL
  FROM cambiados c;

-- 1b. El resto de los métodos microbiológicos del LMB y de los atributos
--     sensoriales del LES que no estaban sembrados. Quedan en la captura
--     estándar: 412 (interpretación / conclusiones), 413 (grasa superficial)
--     y las características físicas, pesos, rendimiento y preferencia por
--     ordenamiento del LES (no son un panel de jueces con puntaje).
WITH nuevos AS (
  INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor, activo)
  SELECT m.tenant_id, 'captura_variante_metodo', m.codigo, left(m.codigo || ' · ' || m.nombre, 160), v.orden, v.variante, TRUE
    FROM (VALUES
      ('1138', 'lmb_micro', 72), ('1140', 'lmb_micro', 73), ('414', 'lmb_micro', 74), ('415', 'lmb_micro', 75),
      ('418', 'lmb_micro', 76), ('419', 'lmb_micro', 77), ('420', 'lmb_micro', 78), ('423', 'lmb_micro', 79),
      ('427', 'lmb_micro', 80), ('430', 'lmb_micro', 81), ('431', 'lmb_micro', 82), ('433', 'lmb_micro', 83),
      ('4875', 'lmb_micro', 84), ('4916', 'lmb_micro', 85),
      ('443', 'les_panel', 86), ('460', 'les_panel', 87), ('1355', 'les_panel', 88), ('1356', 'les_panel', 89),
      ('6780', 'les_panel', 90)
    ) AS v(codigo, variante, orden)
    JOIN cat_metodo m ON m.codigo = v.codigo AND m.deleted_at IS NULL
  ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING
  RETURNING id, tenant_id, codigo, valor
)
INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
SELECT n.tenant_id, n.id, 'captura_variante_metodo', n.codigo, NULL, n.valor || ' · activa',
       'Respuesta IDIC tercer envío 17-11-2026 (SAL-01): registrar los datos de cada etapa e individuales.', NULL
  FROM nuevos n;

-- ---------------------------------------------------------------------------
-- 2. SAL-07 · El LQA entrega solo resultados
-- ---------------------------------------------------------------------------
-- Especificación → analito → método → ensayo → familia (CODSUCDEL) contenida
-- en el codsucdel de la unidad LQA (igual que lims_lab_de_resultado). Solo las
-- que siguen sin decidir (NULL): una decisión explícita desde el catálogo se
-- respeta. Los ensayos ya generados en OT conservan su copia (la jefatura la
-- ajusta en la OT); los nuevos nacen «solo resultado».
UPDATE cat_especificacion ce
   SET evaluacion = 'solo_resultado'
  FROM cat_analito a
  JOIN cat_metodo cm ON cm.id = a.metodo_id AND cm.deleted_at IS NULL
  JOIN cat_ensayo e ON e.id = cm.ensayo_id AND e.deleted_at IS NULL
  JOIN cat_familia f ON f.id = e.familia_id
  JOIN unidad u ON u.tenant_id = f.tenant_id AND u.codigo = 'LQA'
   AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\s,;]', '/', 'g'), '/'))
 WHERE ce.analito_id = a.id
   AND ce.deleted_at IS NULL
   AND ce.evaluacion IS NULL;

-- ---------------------------------------------------------------------------
-- 3. SAL-09 · La Sección Alimentos no usa contramuestras ni testigos
-- ---------------------------------------------------------------------------
-- Parámetro por laboratorio (Catálogo › Parámetros › «Recepción · destinos de
-- la muestra que no usa el laboratorio»). Código = laboratorio de la OT.
WITH nuevos AS (
  INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor, activo)
  SELECT u.tenant_id, 'recepcion_destino_no_usado', u.codigo, left(u.codigo || ' · ' || u.nombre, 160), v.orden, 'TESTIGO,CONTRAMUESTRA', TRUE
    FROM (VALUES ('SAL', 1), ('LQA', 2), ('LMB', 3), ('LES', 4)) AS v(codigo, orden)
    JOIN unidad u ON u.codigo = v.codigo
  ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING
  RETURNING id, tenant_id, codigo, valor
)
INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
SELECT n.tenant_id, n.id, 'recepcion_destino_no_usado', n.codigo, NULL, n.valor,
       'Respuesta IDIC tercer envío 17-11-2026 (SAL-09): no se usan contramuestras (o testigos).', NULL
  FROM nuevos n;
