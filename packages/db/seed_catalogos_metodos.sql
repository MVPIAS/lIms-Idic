-- =============================================================================
-- SEED · CATÁLOGOS DE ENSAYOS REALES (LQC, LQA, LES, SEO, SVM)
-- Generado desde la documentación del cliente (Levantamiento IDIC).
-- Ejecutar DESPUÉS de schema.sql. Idempotente por (tenant, codigo) vía guardas.
-- =============================================================================
BEGIN;

-- Asegurar unidad LQC (Laboratorio Químico Central) — no estaba en el seed base
INSERT INTO unidad (tenant_id, sede_id, codigo, nombre)
SELECT t.id, s.id, 'LQC', 'Laboratorio Químico Central'
FROM tenant t JOIN sede s ON s.tenant_id=t.id AND s.codigo='STGO'
WHERE t.codigo='IDIC' AND NOT EXISTS (SELECT 1 FROM unidad u WHERE u.tenant_id=t.id AND u.codigo='LQC');

-- LQC · EN 1231 · Determinación de Sodio (Método JUNAEB)
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1231', 'Determinación de Sodio (Método JUNAEB)', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Requisito varía de acuerdo al producto · mg/L= concentración encontrada de calcio en la muestra (ppm) f= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1231')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimientos lácteos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Sodio (Método JUNAEB)', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 1232 · Determinación de Zinc (Método JUNAEB)
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1232', 'Determinación de Zinc (Método JUNAEB)', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Requisito varía de acuerdo al producto · mg/L= concentración encontrada de zinc en la muestra (ppm) f= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1232')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimientos lácteos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Zinc (Método JUNAEB)', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 210 · Determinación de antimonio en aleaciones metálicas por absor
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 210', 'Determinación de antimonio en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 210')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de antimonio en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 211 · Determinación de cinc en aleaciones metálicas por absorción 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 211', 'Determinación de cinc en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 211')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cinc en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 212 · Determinación de cobre en aleaciones metálicas por absorción
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 212', 'Determinación de cobre en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 212')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cobre en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 213 · Determinación de cromo en aleaciones metálicas por absorción
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 213', 'Determinación de cromo en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 213')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cromo en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 214 · Determinación de estaño en aleaciones metálicas por absorció
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 214', 'Determinación de estaño en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 214')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de estaño en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 215 · Determinación de manganeso en aleaciones metálicas por absor
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 215', 'Determinación de manganeso en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 215')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de manganeso en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 216 · Determinación de molibdeno en aleaciones metálicas por absor
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 216', 'Determinación de molibdeno en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 216')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de molibdeno en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 217 · Determinación de níquel en aleaciones metálicas por absorció
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 217', 'Determinación de níquel en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 217')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de níquel en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 218 · Determinación de vanadio en aleaciones metálicas por absorci
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 218', 'Determinación de vanadio en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 218')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de vanadio en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 219 · Determinación de aluminio en aleaciones metálicas por absorc
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 219', 'Determinación de aluminio en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 219')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de aluminio en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 220 · Determinación de bismuto en aleaciones metálicas por absorci
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 220', 'Determinación de bismuto en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 220')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de bismuto en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 221 · Determinación de selenio en aleaciones metálicas por absorci
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 221', 'Determinación de selenio en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 221')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de selenio en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 222 · Determinación de tungsteno en aleaciones metálicas por absor
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 222', 'Determinación de tungsteno en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 222')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de tungsteno en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 223 · Determinación de hierro en aleaciones metálicas por absorció
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 223', 'Determinación de hierro en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 223')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de hierro en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 224 · Determinación de silicio en aleaciones metálicas por absorci
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 224', 'Determinación de silicio en aleaciones metálicas por absorción atómica. ASTM 351', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · % Si = porcentaje de silicio en la muestra. A= primer peso de crisol con residuos. B= segundo peso de crisol con residuos. 0,4674= factor gravimétrico para transformar de Si2O a Si. M= peso muestra en gramos.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 224')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de silicio en aleaciones metálicas por absorción atómica. ASTM 351', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 225 · Determinación espectrofotométrica de fósforo en aceros al ca
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 225', 'Determinación espectrofotométrica de fósforo en aceros al carbono y de baja aleación. ASTM 350', u.id, NULL, 'Metalúrgico', 'cuantitativo', 'Requisito varía de acuerdo al producto · % P = porcentaje de fósforo en la muestra. A= miligramos por litro leídos en el equipo en la muestra. B= miligramos por litro leídos en el equipo en el blanco. M= Peso muestra en gramos.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 225')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación espectrofotométrica de fósforo en aceros al carbono y de baja aleación. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 226 · Determinación de cafeína en café y té. ISO 20481
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 226', 'Determinación de cafeína en café y té. ISO 20481', u.id, NULL, 'Químico', 'cuantitativo', 'Requisito varía de acuerdo al producto · G= peso en gramos de cafeína entregados por el integrador del equipo. g= peso en gramos de muestra seca. FH°= dado por laboratorio de alimentos'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 226')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Té y/o café', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cafeína en café y té. ISO 20481', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 228 · Determinación del contenido de  humedad en muestras de cuero
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 228', 'Determinación del contenido de humedad en muestras de cuero, descarne y plantilla. NCh 1204', u.id, 'Gravimetría', 'Químico', 'cuantitativo', 'Requisito varía de acuerdo al producto · % H= porcentaje humedad M h = peso en gramos de muestra húmeda. M s = peso en gramos de muestra seca. fH°= factor humedad'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 228')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Cuero de zapatos, botas, guantes, gorros, cinturones y cuero de materia prima', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación del contenido de humedad en muestras de cuero, descarne y plantilla. NCh 1204', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 229 · Determinación de óxido de cromo en muestras de cuero y desca
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 229', 'Determinación de óxido de cromo en muestras de cuero y descarne. NCh 2134', u.id, NULL, 'Químico', 'cuantitativo', 'Requisito varía de acuerdo al producto · mg/L Cr= miligramos por litro de cromo en la muestra. 5= factor de dilución. 1,46= factor gravimétrico, para convertir el cromo a óxido de cromo. mg mt x fH°= miligramos de muestra en base seca.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 229')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Cuero de zapatos, botas, guantes, gorros, cinturones y cuero de materia prima', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de óxido de cromo en muestras de cuero y descarne. NCh 2134', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 230 · Determinación de grasa en muestras de cuero y descarne. NCh 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 230', 'Determinación de grasa en muestras de cuero y descarne. NCh 1203', u.id, NULL, 'Químico', 'cuantitativo', 'Requisito varía de acuerdo al producto · PER: peso del vaso borosilicato con el residuo de grasa obtenido. PEV: peso del vaso borosilicato vacío. (Tara). g muestra: peso de muestra, en base seca.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 230')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Cuero de zapatos, botas, guantes, gorros, cinturones y cuero de materia prima', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de grasa en muestras de cuero y descarne. NCh 1203', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 231 · Determinación de cenizas sulfatadas totales en muestras de c
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 231', 'Determinación de cenizas sulfatadas totales en muestras de cuero y plantilla. NCh 1206', u.id, 'Gravimetría', 'Químico', 'cuantitativo', 'Requisito varía de acuerdo al producto · CCR: peso del crisol con los residuos de cenizas obtenidas. CSR: peso del crisol sin residuo. (Tara). mg mt x fH°= miligramos de muestra en base seca.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 231')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Cuero de zapatos, botas, guantes, gorros, cinturones y cuero de materia prima', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cenizas sulfatadas totales en muestras de cuero y plantilla. NCh 1206', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 232 · Determinación de pH en muestras de cuero, descarne y plantil
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 232', 'Determinación de pH en muestras de cuero, descarne y plantilla. NCh 1791', u.id, NULL, 'Químico', 'cuantitativo', 'Requisito varía de acuerdo al producto · pH = pH inicial pH (dil 10/100)= pH de dilución del anterior (10 en 100 mL)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 232')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, 'pH= Valor dado por el equipo Índice de diferencia= pH - pH (dil 10/100)', 'Cuero de zapatos, botas, guantes, gorros, cinturones y cuero de materia prima', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de pH en muestras de cuero, descarne y plantilla. NCh 1791', NULL, 'pH= Valor dado por el equipo Índice de diferencia= pH - pH (dil 10/100)', 'Calc', TRUE FROM v;

-- LQC · EN 233 · Determinación  de cloruro de sodio. Reglamento Sanitario de 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 233', 'Determinación de cloruro de sodio. Reglamento Sanitario de los Alimentos (Método Mohr).', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Requisito varía de acuerdo al producto · VM= volumen de nitrato de plata usado en la titulación de la muestra. VB= volumen de nitrato de plata usado en la titulación del blanco. N= Normalidad del nitrato de plata. G= peso muestra en gramos R= rendimiento del producto en kg/litro, factor que es entregado por el Laboratorio de Alimentos, cuando corresponde.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 233')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos (caldos concentrados, sopas, cremas deshidratadas, sofritos y sal comestible)', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cloruro de sodio. Reglamento Sanitario de los Alimentos (Método Mohr).', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 234 · Determinación de sulfato de sodio a sal comestible. Reglamen
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 234', 'Determinación de sulfato de sodio a sal comestible. Reglamento Sanitario de los Alimentos.', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Requisito varía de acuerdo al producto · C= Concentración dada por el equipo F= factor dilución 0,0148= Factor gravimétrico y ajuste unidades G= peso muestra en gramos'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 234')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, '% Na2SO4 =', 'Alimento: sal comestible', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de sulfato de sodio a sal comestible. Reglamento Sanitario de los Alimentos.', NULL, '% Na2SO4 =', 'Calc', TRUE FROM v;

-- LQC · EN 235 · Determinación de nitrato en sal comestible. Reglamento Sanit
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 235', 'Determinación de nitrato en sal comestible. Reglamento Sanitario de los Alimentos.', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Requisito varía de acuerdo al producto · C= Concentración dada por el equipo F= factor dilución 0,0163= Factor gravimétrico y ajuste unidades G= peso muestra en gramos'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 235')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, '% KNO3 =', 'Alimento: sal comestible', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de nitrato en sal comestible. Reglamento Sanitario de los Alimentos.', NULL, '% KNO3 =', 'Calc', TRUE FROM v;

-- LQC · EN 236 · Determinación de nitrito en sal comestible. Reglamento Sanit
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 236', 'Determinación de nitrito en sal comestible. Reglamento Sanitario de los Alimentos.', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Requisito varía de acuerdo al producto · C= Concentración dada por el equipo F= factor dilución 100= Factor ajuste unidades G= peso muestra en gramos'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 236')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, 'mg/kg NO2- =', 'Alimento: sal comestible', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de nitrito en sal comestible. Reglamento Sanitario de los Alimentos.', NULL, 'mg/kg NO2- =', 'Calc', TRUE FROM v;

-- LQC · EN 237 · Determinación de sulfato en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 237', 'Determinación de sulfato en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '500 mg/L máx. · ppm lectura= concentración encontrada en la muestra. F= factor dilución'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 237')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de sulfato en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 238 · Determinación de nitrato en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 238', 'Determinación de nitrato en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '50 mg/L máx. · ppm lectura= concentración encontrada en la muestra. F= factor dilución'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 238')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de nitrato en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 239 · Determinación de fluoruro en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 239', 'Determinación de fluoruro en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '1,5 mg/L máx. · ppm lectura= concentración encontrada en la muestra. F= factor dilución'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 239')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de fluoruro en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 241 · Determinación de cloruro en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 241', 'Determinación de cloruro en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '400 mg/L máx. · A = mL gastados en titulación de la muestra B = mL gastados en titulación del blanco N = Normalidad del titulante AgNO3 35.450 = peso equivalente del ion cloruro (Cl-)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 241')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cloruro en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 242 · Determinación de cloro libre en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 242', 'Determinación de cloro libre en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,2 a 2,0 mg/L'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 242')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, 'Resuldado por test colorimétrico', 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cloro libre en agua potable. NCH 409', NULL, 'Resuldado por test colorimétrico', 'Manual', FALSE FROM v;

-- LQC · EN 243 · Determinación de nitrito en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 243', 'Determinación de nitrito en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '3,0 mg/L máx. · ppm lectura= concentración encontrada en la muestra. F= factor dilución'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 243')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de nitrito en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 244 · Determinación de amoníaco en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 244', 'Determinación de amoníaco en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '1,5 mg/L máx. · ppm lectura= concentración encontrada en la muestra. F= factor dilución'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 244')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de amoníaco en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 245 · Determinación de cianuro en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 245', 'Determinación de cianuro en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,05 mg/L máx. · ppm lectura= concentración encontrada en la muestra. F= factor dilución'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 245')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cianuro en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 246 · Determinación de cadmio en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 246', 'Determinación de cadmio en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,01 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 246')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cadmio en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 247 · Determinación de cobre en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 247', 'Determinación de cobre en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '2,0 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 247')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cobre en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 248 · Determinación de cromo total en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 248', 'Determinación de cromo total en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,05 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 248')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de cromo total en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 249 · Determinación de hierro en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 249', 'Determinación de hierro en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,30 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 249')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de hierro en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 250 · Determinación de magnesio en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 250', 'Determinación de magnesio en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '125,0 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 250')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de magnesio en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 251 · Determinación de manganeso en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 251', 'Determinación de manganeso en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,10 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 251')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de manganeso en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 252 · Determinación de plomo en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 252', 'Determinación de plomo en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,05 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 252')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de plomo en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 253 · Determinación de zinc en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 253', 'Determinación de zinc en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '3,0 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 253')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de zinc en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 254 · Determinación de mercurio en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 254', 'Determinación de mercurio en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,001 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 254')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de mercurio en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 255 · Determinación de selenio en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 255', 'Determinación de selenio en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,01 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 255')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de selenio en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 256 · Determinación de arsénico en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 256', 'Determinación de arsénico en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '0,01 mg/L máx. · ppm equipo= concentración leída en equipo EAA Fd= Factor dilución Fc= Factor concentración'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 256')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de arsénico en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 257 · Determinación de pH en agua potable.  NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 257', 'Determinación de pH en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '6,5 a 8,5'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 257')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, 'Resultado es lectura en equipo', 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de pH en agua potable. NCH 409', NULL, 'Resultado es lectura en equipo', 'Manual', FALSE FROM v;

-- LQC · EN 258 · Determinación de sólidos totales disueltos secados en agua p
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 258', 'Determinación de sólidos totales disueltos secados en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', '1.500 mg/L máx. · ppm STD= concentración sólidos totales disueltos. B= peso cápsula con residuos a= peso cápsula vacía (tara) V= volumen muestra en mL'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 258')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de sólidos totales disueltos secados en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 268 · Determinación de fosfato amonio en polvo químico seco ABC. N
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 268', 'Determinación de fosfato amonio en polvo químico seco ABC. NCh 1724', u.id, NULL, 'Químico', 'cuantitativo', 'Sin requisito · mg/L= miligramos por litro de Fósforo leídos en el equipo. 3,71= factor gravimétrico, para convertir el Fósforo a Fosfato Biácido de amonio.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 268')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Polvo químico seco ABC de extintor', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de fosfato amonio en polvo químico seco ABC. NCh 1724', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 269 · Determinación de insolubles en polvo químico seco. NCh 1724
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 269', 'Determinación de insolubles en polvo químico seco. NCh 1724', u.id, NULL, 'Químico', 'cuantitativo', 'Sin requisito · A =Peso de pesa sustancias y papel filtro secos. B = Peso de pesa sustancias con el papel filtro y residuos secos.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 269')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Polvo químico seco ABC de extintor', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de insolubles en polvo químico seco. NCh 1724', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 270 · Determinación de sulfato de amonio en polvo químico seco ABC
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 270', 'Determinación de sulfato de amonio en polvo químico seco ABC. NCh 1724', u.id, NULL, 'Químico', 'cuantitativo', 'Sin requisito · A =Peso crisol (tara). B = peso de crisol de platino con residuo calcinado, con ácido fluorhídrico y vuelto a calcinar. 0,565= factor gravimétrico para convertir sulfato de bario en sulfato de amonio. 5= alícuota un volumen equivalente a la quinta parte del aforado inicial de la muestra.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 270')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Polvo químico seco ABC de extintor', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de sulfato de amonio en polvo químico seco ABC. NCh 1724', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 272 · Determinación de Silicio en aluminio (ASTM E 34)
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 272', 'Determinación de Silicio en aluminio (ASTM E 34)', u.id, NULL, 'Químico', 'cuantitativo', 'Sin requisito · % Si = porcentaje de silicio en la muestra. A= primer peso de crisol con residuos. B= segundo peso de crisol con residuos. 0,4674= factor gravimétrico para transformar de Si2O a Si. M= peso muestra en gramos.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 272')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Polvo químico seco ABC de extintor', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Silicio en aluminio (ASTM E 34)', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 273 · Determinación de plomo en aleaciones metálicas por absorción
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 273', 'Determinación de plomo en aleaciones metálicas por absorción atómica. ASTM 350', u.id, 'AAS', 'Metalúrgico', 'cuantitativo', 'Sin requisito · ppm= concentración encontrada en la muestra F= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 273')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Aleación metálica', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de plomo en aleaciones metálicas por absorción atómica. ASTM 350', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 320 · Determinación de Calcio (Método JUNAEB)
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 320', 'Determinación de Calcio (Método JUNAEB)', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Requisito varía de acuerdo al producto · mg/L= concentración encontrada de calcio en la muestra (ppm) f= factor dilución g= peso muestra en gramos 100= factor ajuste unidades'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 320')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimientos lácteos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Calcio (Método JUNAEB)', NULL, NULL, 'Manual', FALSE FROM v;

-- LQC · EN 780 · Determinación de dureza en agua potable. NCH 409
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 780', 'Determinación de dureza en agua potable. NCH 409', u.id, NULL, 'Químico', 'cuantitativo', 'Sin requisito · ppm CaCO3= dureza de calcio expresada como CaCO3 ppm MgCO3= dureza de magnesioo expresada como CaCO3 Dureza total= suma de ppm CaCO3 y ppm MgCO3'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQC'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 780')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Agua potable y agua de pozo', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de dureza en agua potable. NCH 409', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-001 · Control de documentación técnica
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-001', 'Control de documentación técnica', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Documentación.. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-001')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Documentación.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Control de documentación técnica', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-002 · Campo de visión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-002', 'Campo de visión', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-002')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Campo de visión', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-003 · Resolución de visor nocturno
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-003', 'Resolución de visor nocturno', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-003')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Resolución de visor nocturno', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-004 · Divergencia de un haz de luz
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-004', 'Divergencia de un haz de luz', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-004')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Divergencia de un haz de luz', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-005 · Indicador de batería baja
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-005', 'Indicador de batería baja', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-005')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Indicador de batería baja', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-006 · Polaridad invertida
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-006', 'Polaridad invertida', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-006')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Polaridad invertida', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-007 · Peso
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-007', 'Peso', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-007')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Peso', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-008 · Potencia de salida en transmisión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-008', 'Potencia de salida en transmisión', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-008')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Potencia de salida en transmisión', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-009 · Medición de consumos de corriente en modo TX y RX en equipos
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-009', 'Medición de consumos de corriente en modo TX y RX en equipos de radiocomunicaciones', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-009')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Medición de consumos de corriente en modo TX y RX en equipos de radiocomunicaciones', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-010 · Sensibilidad en recepción en equipos de radiocomunicaciones
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-010', 'Sensibilidad en recepción en equipos de radiocomunicaciones', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-010')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sensibilidad en recepción en equipos de radiocomunicaciones', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-011 · Desviación de modulación en equipos de radiocomunicaciones
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-011', 'Desviación de modulación en equipos de radiocomunicaciones', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-011')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Desviación de modulación en equipos de radiocomunicaciones', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-012 · Transmisión estabilidad de frecuencia
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-012', 'Transmisión estabilidad de frecuencia', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-012')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Transmisión estabilidad de frecuencia', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-013 · Inmersión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-013', 'Inmersión', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-013')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Inmersión', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-014 · Temperatura alta
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-014', 'Temperatura alta', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-014')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Temperatura alta', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-015 · Temperatura baja
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-015', 'Temperatura baja', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-015')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Temperatura baja', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-016 · Vibraciones
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-016', 'Vibraciones', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-016')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vibraciones', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-017 · Dispositivos Electroshock
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-017', 'Dispositivos Electroshock', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Laboratorio.. Método: Por variable y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-017')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Dispositivos Electroshock', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-018 · Control de inventario e inspección visual
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-018', 'Control de inventario e inspección visual', u.id, 'Visual', 'Electrónica/Óptica', 'cualitativo', 'Control: Laboratorio.. Método: Visual y Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-018')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Laboratorio.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Control de inventario e inspección visual', NULL, NULL, 'Manual', FALSE FROM v;

-- SEO · SEO-019 · Pruebas operacionales
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SEO-019', 'Pruebas operacionales', u.id, 'Operacional', 'Electrónica/Óptica', 'semicuantitativo', 'Control: Funcionamiento.. Método: Operacional manual.'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SEO'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SEO-019')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento.', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Pruebas operacionales', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-001 · Manuales técnicos
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-001', 'Manuales técnicos', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Documentación. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-001')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Documentación', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Manuales técnicos', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-002 · Certificados
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-002', 'Certificados', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Documentación. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-002')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Documentación', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Certificados', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-003 · Vistas Frontal
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-003', 'Vistas Frontal', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-003')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vistas Frontal', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-004 · Vista Lateral derecho
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-004', 'Vista Lateral derecho', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-004')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Lateral derecho', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-005 · Vista Trasera
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-005', 'Vista Trasera', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-005')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Trasera', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-006 · Vista Lateral izquierdo
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-006', 'Vista Lateral izquierdo', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-006')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Lateral izquierdo', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-007 · Vista Interior
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-007', 'Vista Interior', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-007')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Interior', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-008 · Vista Superior
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-008', 'Vista Superior', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-008')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Superior', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-009 · Vista Inferior
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-009', 'Vista Inferior', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-009')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Inferior', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-010 · Vista Compartimento motor
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-010', 'Vista Compartimento motor', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-010')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Compartimento motor', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-011 · Vista Compartimento de carga
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-011', 'Vista Compartimento de carga', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-011')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Vista Compartimento de carga', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-012 · Inventario
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-012', 'Inventario', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual y Operacional'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-012')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Inventario', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-013 · Pintura
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-013', 'Pintura', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Configuración. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-013')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Configuración', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Pintura', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-014 · Chasis y Carrocería
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-014', 'Chasis y Carrocería', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-014')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Chasis y Carrocería', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-015 · Conjunto Motor
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-015', 'Conjunto Motor', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-015')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Conjunto Motor', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-016 · Sistema de Refrigeración
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-016', 'Sistema de Refrigeración', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-016')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema de Refrigeración', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-017 · Sistema de Combustible
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-017', 'Sistema de Combustible', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-017')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema de Combustible', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-018 · Sistema Eléctrico
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-018', 'Sistema Eléctrico', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-018')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema Eléctrico', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-019 · Sistema de Transmisión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-019', 'Sistema de Transmisión', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-019')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema de Transmisión', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-020 · Sistema de Freno
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-020', 'Sistema de Freno', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-020')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema de Freno', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-021 · Sistema de Dirección
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-021', 'Sistema de Dirección', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-021')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema de Dirección', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-022 · Sistema de Rodadura
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-022', 'Sistema de Rodadura', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-022')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema de Rodadura', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-023 · Sistema de Suspensión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-023', 'Sistema de Suspensión', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-023')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Sistema de Suspensión', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-024 · Componentes menores y accesorios
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-024', 'Componentes menores y accesorios', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-024')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Componentes menores y accesorios', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-025 · Control de la Versión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-025', 'Control de la Versión', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento estático. Método: Visual y Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-025')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento estático', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Control de la Versión', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-026 · Recorrido
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-026', 'Recorrido', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-026')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Recorrido', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-027 · Frenado
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-027', 'Frenado', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-027')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Frenado', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-028 · Giro
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-028', 'Giro', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-028')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Giro', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-029 · Pendiente longitudinal
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-029', 'Pendiente longitudinal', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-029')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Pendiente longitudinal', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-030 · Pendiente lateral
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-030', 'Pendiente lateral', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-030')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Pendiente lateral', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-031 · Retención
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-031', 'Retención', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-031')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Retención', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-032 · Cruces de Zanja
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-032', 'Cruces de Zanja', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-032')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Cruces de Zanja', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-033 · Estanqueidad
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-033', 'Estanqueidad', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-033')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Estanqueidad', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-034 · Grada Vertical
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-034', 'Grada Vertical', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-034')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Grada Vertical', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-035 · Suspensión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-035', 'Suspensión', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-035')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Suspensión', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-036 · Pruebas de la versión
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-036', 'Pruebas de la versión', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-036')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Pruebas de la versión', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-037 · Control después de la pruebas
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-037', 'Control después de la pruebas', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Funcionamiento Dinámico. Método: Visual y Operacional'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-037')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Control después de la pruebas', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-038 · Control de documentación técnica
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-038', 'Control de documentación técnica', u.id, 'Visual', 'Vehículos', 'cualitativo', 'Control: Documentación. Método: Visual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-038')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Documentación', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Control de documentación técnica', NULL, NULL, 'Manual', FALSE FROM v;

-- SVM · SVM-039 · Prueba de Recorrido
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'SVM-039', 'Prueba de Recorrido', u.id, 'Operacional', 'Vehículos', 'semicuantitativo', 'Control: Funcionamiento Dinámico. Método: Operacional manual'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='SVM'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='SVM-039')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Funcionamiento Dinámico', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Prueba de Recorrido', NULL, NULL, 'Manual', FALSE FROM v;

-- LES · EN 1335 · Prueba de Aceptabilidad con preparación. Método: escalas de 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1335', 'Prueba de Aceptabilidad con preparación. Método: escalas de respuestas cuantitativas, Norma: UNE-EN-ISO 4121:2006', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1335')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Prueba de Aceptabilidad con preparación. Método: escalas de respuestas cuantitativas, Norma: UNE-EN-ISO 4121:2006', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1336 · Prueba de Aceptabilidad sin preparación. Método: escalas de 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1336', 'Prueba de Aceptabilidad sin preparación. Método: escalas de respuestas cuantitativas, Norma: UNE-EN-ISO 4121:2006', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1336')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Prueba de Aceptabilidad sin preparación. Método: escalas de respuestas cuantitativas, Norma: UNE-EN-ISO 4121:2006', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1128 · Prueba de Categoría con preparación. Método: escalas de resp
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1128', 'Prueba de Categoría con preparación. Método: escalas de respuestas cuantitativas , Norma: UNE-EN-ISO 4121:2006', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1128')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Prueba de Categoría con preparación. Método: escalas de respuestas cuantitativas , Norma: UNE-EN-ISO 4121:2006', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1129 · Prueba de Categoría sin preparación. Método: escalas de resp
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1129', 'Prueba de Categoría sin preparación. Método: escalas de respuestas cuantitativas , Norma: UNE-EN-ISO 4121:2006', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1129')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Prueba de Categoría sin preparación. Método: escalas de respuestas cuantitativas , Norma: UNE-EN-ISO 4121:2006', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1123 · Determinación de Preferencia con preparación. Método ensayo 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1123', 'Determinación de Preferencia con preparación. Método ensayo de clasificación por ordenación, Norma: UNE-ISO 8587-2017', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1123')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Preferencia con preparación. Método ensayo de clasificación por ordenación, Norma: UNE-ISO 8587-2017', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1338 · Determinación de Preferencia sin preparación. Método ensayo 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1338', 'Determinación de Preferencia sin preparación. Método ensayo de clasificación por ordenación, Norma: UNE-ISO 8587-2017', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1338')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Preferencia sin preparación. Método ensayo de clasificación por ordenación, Norma: UNE-ISO 8587-2017', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1339 · Determinación de Preferencia con preparación. Método: Prueba
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1339', 'Determinación de Preferencia con preparación. Método: Prueba de comparación por pareja, Norma: UNE-EN-ISO 5485:2018', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1339')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Preferencia con preparación. Método: Prueba de comparación por pareja, Norma: UNE-EN-ISO 5485:2018', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 592 · Determinación de Preferencia sin preparación. Método: Prueba
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 592', 'Determinación de Preferencia sin preparación. Método: Prueba de comparación por pareja, Norma: UNE-EN-ISO 5485:2018', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 592')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Preferencia sin preparación. Método: Prueba de comparación por pareja, Norma: UNE-EN-ISO 5485:2018', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 598 · Leguminosas. Método: Prueba de cocción, Norma: UNE87028-1-19
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 598', 'Leguminosas. Método: Prueba de cocción, Norma: UNE87028-1-1997', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 598')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Leguminosas. Método: Prueba de cocción, Norma: UNE87028-1-1997', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 322 · Determinación de Diferencia con preparación. Método: Prueba 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 322', 'Determinación de Diferencia con preparación. Método: Prueba Triangular, Norma: UNE-EN-ISO 4120:2022', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 322')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Diferencia con preparación. Método: Prueba Triangular, Norma: UNE-EN-ISO 4120:2022', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 321 · Determinación de Diferencia sin preparación. Método: Prueba 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 321', 'Determinación de Diferencia sin preparación. Método: Prueba Triangular, Norma: UNE-EN-ISO 4120:2022', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 321')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Diferencia sin preparación. Método: Prueba Triangular, Norma: UNE-EN-ISO 4120:2022', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1125 · Determinación de diferencia con preparación. Método: Prueba 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1125', 'Determinación de diferencia con preparación. Método: Prueba de Comparación por pareja, Norma: UNE-EN-ISO 5495:2018', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1125')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de diferencia con preparación. Método: Prueba de Comparación por pareja, Norma: UNE-EN-ISO 5495:2018', 'escala', NULL, 'Manual', FALSE FROM v;

-- LES · EN 1337 · Determinación de diferencia sin preparación. Método: Prueba 
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'EN 1337', 'Determinación de diferencia sin preparación. Método: Prueba de Comparación por pareja, Norma: UNE-EN-ISO 5495:2018', u.id, 'Sensorial', 'Evaluación sensorial', 'semicuantitativo', 'Evaluación sensorial con panel de jueces (escalas)'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LES'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='EN 1337')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', 'escala', NULL, 'Alimentos y bebidas', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de diferencia sin preparación. Método: Prueba de Comparación por pareja, Norma: UNE-EN-ISO 5495:2018', 'escala', NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-001 · Determinación de Humedad
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-001', 'Determinación de Humedad', u.id, 'Gravimetría', 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-001')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Humedad', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-002 · Determinación de Ceniza
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-002', 'Determinación de Ceniza', u.id, 'Gravimetría', 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-002')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Ceniza', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-003 · Determinacion de Proteinas Norma: NCh 3551:2018
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-003', 'Determinacion de Proteinas Norma: NCh 3551:2018', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-003')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinacion de Proteinas Norma: NCh 3551:2018', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-004 · Determinacion de Acidez Norma: NCh 95:1981
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-004', 'Determinacion de Acidez Norma: NCh 95:1981', u.id, 'Volumetría', 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-004')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinacion de Acidez Norma: NCh 95:1981', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-005 · Determinación de Materia Grasa
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-005', 'Determinación de Materia Grasa', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-005')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Materia Grasa', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-006 · Determinación de Cloruro de sodio
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-006', 'Determinación de Cloruro de sodio', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-006')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Cloruro de sodio', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-007 · Determinación de Peróxido Norma: NCh 105:2018
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-007', 'Determinación de Peróxido Norma: NCh 105:2018', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-007')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de Peróxido Norma: NCh 105:2018', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-008 · Determinacfión de pH Norma: NCh 1842:2017
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-008', 'Determinacfión de pH Norma: NCh 1842:2017', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-008')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinacfión de pH Norma: NCh 1842:2017', NULL, NULL, 'Manual', FALSE FROM v;

-- LQA · LQA-009 · Determinación de °Brix Norma: NCh 1456:1978
WITH m AS (
  INSERT INTO metodo (tenant_id, codigo, nombre, unidad_responsable, tecnica, familia, tipo, objetivo)
  SELECT t.id, 'LQA-009', 'Determinación de °Brix Norma: NCh 1456:1978', u.id, NULL, 'Bromatológico', 'cuantitativo', 'Determinación bromatológica según Reglamento Sanitario de los Alimentos / NCh'
  FROM tenant t JOIN unidad u ON u.tenant_id=t.id AND u.codigo='LQA'
  WHERE t.codigo='IDIC'
    AND NOT EXISTS (SELECT 1 FROM metodo mx JOIN tenant tx ON tx.id=mx.tenant_id WHERE tx.codigo='IDIC' AND mx.codigo='LQA-009')
  RETURNING id
), v AS (
  INSERT INTO metodo_version (metodo_id, version, estado, vigente_desde, unidad_principal, formula_dsl, matriz_aplicable, tipo_documento_emitido)
  SELECT m.id, 'v1.0', 'vigente', DATE '2026-05-01', NULL, NULL, 'Alimentos', 'Informe de Ensayos / IVC' FROM m
  RETURNING id
)
INSERT INTO analito (metodo_version_id, numero, nombre, unidad, formula_calculo, ingreso, auto_calc)
SELECT v.id, 1, 'Determinación de °Brix Norma: NCh 1456:1978', NULL, NULL, 'Manual', FALSE FROM v;

COMMIT;

-- Verificación
SELECT u.codigo AS lab, count(*) AS metodos FROM metodo m JOIN unidad u ON u.id=m.unidad_responsable GROUP BY u.codigo ORDER BY 2 DESC;