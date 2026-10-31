-- =============================================================================
-- align_ali_d4_metodos_lqa.sql · Frente ALI-D4 (EP-02 §3.2, §3.9, §5, §9.1)
-- LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql. No crea permisos.
--
-- Métodos de LQA (Química de Alimentos) con LECTURAS y FÓRMULA dentro del
-- formulario de captura estándar (decisión del 14-10: un solo formulario; las
-- columnas de la planilla son las lecturas C1..Cn del método, cada fila es una
-- determinación —duplicado X y X′— y el valor del ensayo es el promedio):
--
--   · Proteína Kjeldahl (LAL-PG01-P02-IT07-FORM-01 rev. 04), método 403:
--       C1 m · C2 V (mL ácido) · C3 N · C4 factor de conversión (6,25 por
--       defecto, POR CONFIRMAR por producto: SAL-06)
--       %P = 1,4 × N × V × Factor / m
--       Aceptación: |X − X′| ≤ 0,38 % (absoluta; POR CONFIRMAR si es relativa).
--   · Materia grasa (LAL-PG01-P02-FORM08 rev. 2), métodos 399 y 978:
--       C1 m · C2 m₁ vaso vacío · C3 pesada anterior · C4 pesada final (m₂)
--       %G = (m₂ − m₁) / m × 100
--       Aceptación: peso constante, |pesada final − anterior| ≤ 0,001 g.
--   · Humedad (planilla HUMEDAD.XLS), método 395: C1 peso filtro o cápsula ·
--       C2 filtro + muestra · C3 peso constante (filtro + muestra seca)
--       %H = (C2 − C3) / (C2 − C1) × 100 (ecuación no impresa: POR CONFIRMAR).
--   · Acidez titulable (planilla Excel), métodos 966, 970, 971, 972 y 973:
--       C1 peso muestra · C2 gasto NaOH · C3 corrección de bureta · C4 gasto
--       blanco · C5 N NaOH · C6 factor del ácido de expresión (meq en g)
--       % = ((C2 − C3) − C4) × C5 × C6 / C1 × 100 (ecuación no impresa: POR
--       CONFIRMAR; factores por defecto de tabla, POR CONFIRMAR).
--
-- Lo que se toca, sin pisar ediciones posteriores:
--   1. paso_metodo: valor por defecto, símbolo y marca «por confirmar» de cada
--      lectura; las lecturas de estos métodos (la exportación ANALFIELDS no las
--      trae) se insertan solo si el método no tiene ninguna.
--   2. cat_metodo: reglas de aceptación (JSON) y nota de la captura.
--   3. cat_analito.formula: solo si está vacía o ya es la de este frente.
--   4. resultado.avisos_aceptacion: avisos que el analista aceptó al guardar.
--   5. Parámetro captura_reglas.modo (avisar | impedir): POR CONFIRMAR (SAL-17);
--      por defecto «avisar» (no bloquea; pide confirmación antes de guardar).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Definición de las lecturas (paso_metodo)
-- ---------------------------------------------------------------------------
ALTER TABLE paso_metodo ADD COLUMN IF NOT EXISTS valor_defecto NUMERIC(18,6);
ALTER TABLE paso_metodo ADD COLUMN IF NOT EXISTS simbolo       VARCHAR(20);
ALTER TABLE paso_metodo ADD COLUMN IF NOT EXISTS por_confirmar BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN paso_metodo.valor_defecto IS 'Valor con que se precarga la lectura en la captura (editable por el analista), p. ej. factor de proteína 6,25.';
COMMENT ON COLUMN paso_metodo.simbolo IS 'Símbolo de la planilla (m, V, N, m₁…) que se muestra junto al nombre de la lectura.';
COMMENT ON COLUMN paso_metodo.por_confirmar IS 'La lectura, su unidad o su valor por defecto están por confirmar con el IDIC.';

-- ---------------------------------------------------------------------------
-- 2. Reglas de aceptación y nota de la captura del método (cat_metodo)
-- ---------------------------------------------------------------------------
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS reglas_captura JSONB;
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS nota_captura   TEXT;
COMMENT ON COLUMN cat_metodo.reglas_captura IS
  'Reglas de aceptación de la captura (laboratorio/reglas-aceptacion.ts): [{tipo:"duplicados",max,modo:"absoluto"|"relativo"} | {tipo:"diferencia_campos",campoA,campoB,max}], con unidad, texto, fuente y porConfirmar.';
COMMENT ON COLUMN cat_metodo.nota_captura IS 'Nota que ve el analista en la captura (fórmula y lo que está por confirmar).';

-- ---------------------------------------------------------------------------
-- 3. Avisos aceptados al guardar (resultado)
-- ---------------------------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS avisos_aceptacion JSONB;
COMMENT ON COLUMN resultado.avisos_aceptacion IS
  'Reglas de aceptación del método que no se cumplieron y que el analista confirmó al guardar (parámetro captura_reglas.modo = avisar). NULL = sin avisos.';

-- ---------------------------------------------------------------------------
-- 4. Métodos LQA del catálogo real (seed_catalogo_v2.sql)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS tmp_ali_d4_metodo;
DROP TABLE IF EXISTS tmp_ali_d4_paso;
CREATE TEMP TABLE tmp_ali_d4_metodo (
  codigo VARCHAR(30) PRIMARY KEY, formula TEXT, reglas JSONB, nota TEXT
);
CREATE TEMP TABLE tmp_ali_d4_paso (
  codigo VARCHAR(30), orden INT, nombre VARCHAR(200), simbolo VARCHAR(20), unidad VARCHAR(40),
  valor_defecto NUMERIC(18,6), por_confirmar BOOLEAN, instruccion TEXT
);

INSERT INTO tmp_ali_d4_metodo (codigo, formula, reglas, nota) VALUES
('403', '1.4 * C3 * C2 * C4 / C1',
 '[{"tipo":"duplicados","max":0.38,"modo":"absoluto","unidad":"%","texto":"Diferencia entre duplicados X y X′ ≤ 0,38 %","fuente":"LAL-PG01-P02-IT07-FORM-01 rev. 04","porConfirmar":true}]',
 'Proteína (Kjeldahl, IT07): %P = 1,4 × N × V × Factor / m. Ingrese el duplicado X y X′ (dos lecturas); el resultado es el promedio. POR CONFIRMAR con el IDIC (SAL-06 y SAL-17): unidad de m (la planilla dice mg; con 1,4 la fórmula da % con m en g), factor de conversión por producto (6,25 por defecto) y si la diferencia de 0,38 % entre duplicados es absoluta o relativa.'),
('399', '(C4 - C2) / C1 * 100',
 '[{"tipo":"diferencia_campos","campoA":"C4","campoB":"C3","max":0.001,"unidad":"g","texto":"Peso constante: las dos últimas pesadas no difieren en más de 0,001 g","fuente":"LAL-PG01-P02-FORM08 rev. 2","porConfirmar":true}]',
 'Materia grasa (FORM08): %G = (m₂ − m₁) / m × 100, con m₂ la última pesada del vaso con grasa. Repita el secado hasta peso constante y registre la pesada anterior y la final. La aceptación entre duplicados depende de la norma: POR CONFIRMAR.'),
('978', '(C4 - C2) / C1 * 100',
 '[{"tipo":"diferencia_campos","campoA":"C4","campoB":"C3","max":0.001,"unidad":"g","texto":"Peso constante: las dos últimas pesadas no difieren en más de 0,001 g","fuente":"LAL-PG01-P02-FORM08 rev. 2","porConfirmar":true}]',
 'Materia grasa total por hidrólisis (FORM08): %G = (m₂ − m₁) / m × 100, con m₂ la última pesada del vaso con grasa. Repita el secado hasta peso constante y registre la pesada anterior y la final. La aceptación entre duplicados depende de la norma: POR CONFIRMAR.'),
('395', '(C2 - C3) / (C2 - C1) * 100',
 '[]',
 'Humedad (planilla HUMEDAD.XLS): % = (m inicial − m final) / m inicial × 100, con m inicial = (filtro + muestra) − filtro y m final a peso constante. La planilla no imprime la ecuación: POR CONFIRMAR.'),
('966', '((C2 - C3) - C4) * C5 * C6 / C1 * 100', '[]',
 'Acidez titulable expresada como ácido cítrico: % = (gasto real − gasto blanco) × N × factor del ácido / peso × 100, con gasto real = gasto − corrección de bureta. La planilla no imprime la ecuación y el factor (0,064 g/meq) es de tabla: POR CONFIRMAR.'),
('970', '((C2 - C3) - C4) * C5 * C6 / C1 * 100', '[]',
 'Acidez titulable expresada como ácido málico: % = (gasto real − gasto blanco) × N × factor del ácido / peso × 100, con gasto real = gasto − corrección de bureta. La planilla no imprime la ecuación y el factor (0,067 g/meq) es de tabla: POR CONFIRMAR.'),
('971', '((C2 - C3) - C4) * C5 * C6 / C1 * 100', '[]',
 'Acidez titulable expresada como ácido oleico: % = (gasto real − gasto blanco) × N × factor del ácido / peso × 100, con gasto real = gasto − corrección de bureta. La planilla no imprime la ecuación y el factor (0,282 g/meq) es de tabla: POR CONFIRMAR.'),
('972', '((C2 - C3) - C4) * C5 * C6 / C1 * 100', '[]',
 'Acidez titulable expresada como ácido acético: % = (gasto real − gasto blanco) × N × factor del ácido / peso × 100, con gasto real = gasto − corrección de bureta. La planilla no imprime la ecuación y el factor (0,060 g/meq) es de tabla: POR CONFIRMAR.'),
('973', '((C2 - C3) - C4) * C5 * C6 / C1 * 100', '[]',
 'Acidez titulable expresada como NaOH: % = (gasto real − gasto blanco) × N × factor / peso × 100, con gasto real = gasto − corrección de bureta. La planilla no imprime la ecuación y el factor (0,040 g/meq) es de tabla: POR CONFIRMAR.');

INSERT INTO tmp_ali_d4_paso (codigo, orden, nombre, simbolo, unidad, valor_defecto, por_confirmar, instruccion) VALUES
('403', 1, 'Peso de muestra', 'm', 'g', NULL, true, 'La planilla IT07-FORM-01 indica mg; con la constante 1,4 la fórmula da % con m en g (SAL-06).'),
('403', 2, 'Gasto de ácido en la titulación', 'V', 'mL', NULL, false, NULL),
('403', 3, 'Normalidad del ácido', 'N', 'N', NULL, false, NULL),
('403', 4, 'Factor de conversión nitrógeno → proteína', 'F', NULL, 6.25, true, 'Factor por producto (6,25 general; 5,5 gelatina…): POR CONFIRMAR (SAL-06).'),
('399', 1, 'Peso de muestra', 'm', 'g', NULL, false, NULL),
('399', 2, 'Peso del vaso vacío', 'm₁', 'g', NULL, false, NULL),
('399', 3, 'Pesada anterior del vaso con grasa', 'm₂′', 'g', NULL, false, 'Penúltima pesada de la serie hasta peso constante.'),
('399', 4, 'Pesada final del vaso con grasa (peso constante)', 'm₂', 'g', NULL, false, NULL),
('978', 1, 'Peso de muestra', 'm', 'g', NULL, false, NULL),
('978', 2, 'Peso del vaso vacío', 'm₁', 'g', NULL, false, NULL),
('978', 3, 'Pesada anterior del vaso con grasa', 'm₂′', 'g', NULL, false, 'Penúltima pesada de la serie hasta peso constante.'),
('978', 4, 'Pesada final del vaso con grasa (peso constante)', 'm₂', 'g', NULL, false, NULL),
('395', 1, 'Peso filtro o cápsula', 'm₀', 'g', NULL, false, NULL),
('395', 2, 'Peso filtro + muestra', 'm₁', 'g', NULL, false, NULL),
('395', 3, 'Peso constante (filtro + muestra seca)', 'm₂', 'g', NULL, true, 'Ecuación no impresa en la planilla: POR CONFIRMAR.');

-- Acidez: las mismas seis lecturas en los cinco métodos; cambia el factor del ácido.
INSERT INTO tmp_ali_d4_paso (codigo, orden, nombre, simbolo, unidad, valor_defecto, por_confirmar, instruccion)
SELECT a.codigo, p.orden, p.nombre, p.simbolo, p.unidad,
       CASE WHEN p.orden = 6 THEN a.factor ELSE p.defecto END, p.por_confirmar, p.instruccion
  FROM (VALUES ('966', 0.064::numeric), ('970', 0.067), ('971', 0.282), ('972', 0.060), ('973', 0.040)) AS a(codigo, factor)
 CROSS JOIN (VALUES
   (1, 'Peso de muestra', 'm', 'g', NULL::numeric, false, NULL::text),
   (2, 'Gasto de titulación NaOH', 'V', 'mL', NULL, false, NULL),
   (3, 'Corrección de bureta', 'c', 'mL', 0, false, 'Gasto real = gasto − corrección.'),
   (4, 'Gasto del blanco', 'Vb', 'mL', 0, false, NULL),
   (5, 'Normalidad del NaOH', 'N', 'N', NULL, false, NULL),
   (6, 'Factor del ácido de expresión', 'f', 'g/meq', NULL, true, 'Factor de tabla: POR CONFIRMAR con el IDIC.')
 ) AS p(orden, nombre, simbolo, unidad, defecto, por_confirmar, instruccion);

-- 4.1 Lecturas: solo en los métodos que aún no tienen ninguna (no pisa lo editado).
INSERT INTO paso_metodo (tenant_id, cat_metodo_id, orden, nombre, tipo_dato, unidad, simbolo, valor_defecto, por_confirmar, instruccion, obligatorio, activo)
SELECT m.tenant_id, m.id, p.orden, p.nombre, 'numero', p.unidad, p.simbolo, p.valor_defecto, p.por_confirmar, p.instruccion, true, true
  FROM tmp_ali_d4_paso p
  JOIN cat_metodo m ON m.codigo = p.codigo AND m.deleted_at IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM paso_metodo x WHERE x.cat_metodo_id = m.id AND x.deleted_at IS NULL
                     AND NOT (x.orden = p.orden AND x.nombre = p.nombre))
ON CONFLICT (tenant_id, cat_metodo_id, orden, nombre) DO NOTHING;

-- 4.2 Reglas y nota: solo si el método no tiene (Calidad puede editarlas después).
UPDATE cat_metodo m
   SET reglas_captura = COALESCE(m.reglas_captura, d.reglas),
       nota_captura   = COALESCE(m.nota_captura, d.nota)
  FROM tmp_ali_d4_metodo d
 WHERE m.codigo = d.codigo
   AND (m.reglas_captura IS NULL OR m.nota_captura IS NULL);

-- 4.3 Fórmula del analito: solo si está vacía (no pisa una fórmula ya definida).
UPDATE cat_analito a
   SET formula = d.formula
  FROM tmp_ali_d4_metodo d
  JOIN cat_metodo m ON m.codigo = d.codigo
 WHERE a.metodo_id = m.id AND a.deleted_at IS NULL
   AND COALESCE(btrim(a.formula), '') = '';

DROP TABLE IF EXISTS tmp_ali_d4_metodo;
DROP TABLE IF EXISTS tmp_ali_d4_paso;

-- ---------------------------------------------------------------------------
-- 5. ¿Avisar o impedir? (SAL-17, POR CONFIRMAR) · Catálogo › Parámetros
-- ---------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'captura_reglas', 'modo',
       'Reglas de aceptación del método no cumplidas al guardar la captura (avisar | impedir). POR CONFIRMAR con el IDIC (SAL-17)', 1, 'avisar'
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
