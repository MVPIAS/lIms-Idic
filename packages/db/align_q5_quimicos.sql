-- =============================================================================
-- align_q5_quimicos.sql · Respuestas del IDIC del 24-11-2026 (checklist,
-- pestañas «LQC» y «LQA») · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: una pasada deja la misma base que dos. No pisa lo que
-- el laboratorio ya editó en el catálogo. Va ANTES de align_cierre_permisos.sql.
-- No crea permisos.
--
--   1. LQC 4 y 31 · Requisitos de agua potable de la NCh 409/1:2005 («Tabla
--      requisitos NCh 409» del LQC). Reemplaza el vacío que dejó el retiro de
--      la NCh 409 Of.84 (align_informe_ensayo.sql, lote NCH409_OF84). La
--      expresión de nitrato, nitrito y amoníaco (NO3-, NO2-, NH4+) sale del
--      «Listado ensayos LQC mayo 2026» (LQC 8), que da la fórmula de cada uno.
--      Cada analito del método recibe su especificación «estándar»; las demás
--      especificaciones estándar activas de esos analitos (vacías o de otra
--      versión) se desactivan una sola vez y quedan en
--      cat_especificacion_retirada (lote NCH409_2005), para poder revertirlo.
--      Fuera de este paso: el requisito de pH 6,0–8,5 del método 251 (norma
--      «Cueros») sigue retirado hasta que el IDIC diga si es de cuero, y la
--      «Razón nitrato + nitrito» no tiene método en el catálogo.
--   2. LQA 3 · Planillas de registro LAL-PG01-P02 (formularios del 24-11):
--      lecturas y fórmula de Cenizas totales (IT04-FORM01 rev. 09), Índice de
--      peróxido (IT25-FORM01 rev. 00) y pH (IT17-FORM02 rev. 02), con el mismo
--      patrón de align_ali_d4_metodos_lqa.sql (solo en métodos sin lecturas, y
--      la fórmula solo si el analito no tiene). Proteína (IT07-FORM01 rev. 04):
--      la planilla fija la constante 14,01 y el peso de muestra en mg; se
--      ajusta la fórmula sembrada por ALI-D4 si nadie la cambió.
--   3. LQA 1 y LES 1 · Notas aclaratorias del Informe de Ensayos Alimentos
--      (PG09 Anexo 02-02 rev05) con el texto de los informes reales; el
--      versionado de plantillas lo recoge align_cierre_permisos.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 1. NCh 409/1:2005 · requisitos de agua potable
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS tmp_q5_nch409;
CREATE TEMP TABLE tmp_q5_nch409 (
  metodo VARCHAR(30), ensayo TEXT, limite_inf VARCHAR(20), limite_sup VARCHAR(20), unidad VARCHAR(40)
);
INSERT INTO tmp_q5_nch409 VALUES
  ('289',  'Amoníaco',                      NULL,  '1.5',    'mg/L NH4+'),
  ('290',  'Arsénico',                      NULL,  '0.01',   'mg/L As'),
  ('291',  'Cadmio',                        NULL,  '0.01',   'mg/L Cd'),
  ('1127', 'Cianuro',                       NULL,  '0.05',   'mg/L CN-'),
  ('2984', 'Cloro libre',                   '0.2', '2.0',    'mg/L'),
  ('293',  'Cloruros',                      NULL,  '400.0',  'mg/L Cl-'),
  ('294',  'Cobre',                         NULL,  '2.0',    'mg/L Cu'),
  ('295',  'Cromo total',                   NULL,  '0.05',   'mg/L Cr'),
  ('296',  'Fluoruro',                      NULL,  '1.5',    'mg/L F-'),
  ('297',  'Hierro',                        NULL,  '0.3',    'mg/L Fe'),
  ('298',  'Magnesio',                      NULL,  '125.0',  'mg/L Mg'),
  ('299',  'Manganeso',                     NULL,  '0.1',    'mg/L Mn'),
  ('300',  'Mercurio',                      NULL,  '0.001',  'mg/L Hg'),
  ('308',  'Nitrato',                       NULL,  '50.0',   'mg/L NO3-'),
  ('309',  'Nitrito',                       NULL,  '3.0',    'mg/L NO2-'),
  ('301',  'Plomo',                         NULL,  '0.05',   'mg/L Pb'),
  ('305',  'Sólidos disueltos totales',     NULL,  '1500.0', 'mg/L'),
  ('306',  'Selenio',                       NULL,  '0.01',   'mg/L Se'),
  ('310',  'Sulfatos',                      NULL,  '500.0',  'mg/L SO4-2'),
  ('304',  'Zinc',                          NULL,  '3.0',    'mg/L Zn'),
  ('904',  'pH',                            '6.5', '8.5',    NULL);

-- 1.1 La especificación NCh 409/1:2005 de cada analito de esos métodos.
INSERT INTO cat_especificacion (tenant_id, analito_id, ambito, limite_inf, nominal, limite_sup, requisitos, texto, unidad, dedupe_key, activo)
SELECT a.tenant_id, a.id, 'estandar', n.limite_inf, NULL, n.limite_sup, NULL,
       'NCh 409/1:2005 · ' || n.ensayo || ' (tabla de requisitos del LQC, 24-11-2026)', n.unidad, 'nch409_2005', TRUE
  FROM tmp_q5_nch409 n
  JOIN cat_metodo  m ON m.codigo = n.metodo AND m.deleted_at IS NULL
  JOIN cat_analito a ON a.metodo_id = m.id AND a.deleted_at IS NULL
ON CONFLICT (tenant_id, analito_id, dedupe_key) DO NOTHING;

-- 1.2 Una sola vez por base: las demás especificaciones estándar activas de esos
--     analitos se desactivan (quedan registradas para revertir), para que el
--     ensayo tome la de la NCh 409/1:2005. Una especificación que el laboratorio
--     agregue después no se toca.
CREATE TABLE IF NOT EXISTS cat_especificacion_retirada (
  especificacion_id UUID PRIMARY KEY REFERENCES cat_especificacion(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  lote              VARCHAR(40) NOT NULL,
  motivo            TEXT NOT NULL,
  metodo_codigo     VARCHAR(30),
  analito_nombre    VARCHAR(240),
  limite_inf        VARCHAR(120),
  nominal           VARCHAR(120),
  limite_sup        VARCHAR(120),
  unidad            VARCHAR(60),
  retirada_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion)
  VALUES ('q5.LQC-4', 'NCh 409/1:2005: desactiva las otras especificaciones estándar de los analitos de agua potable (checklist LQC 4 y 31, 24-11-2026)')
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN; END IF;

  INSERT INTO cat_especificacion_retirada
         (especificacion_id, tenant_id, lote, motivo, metodo_codigo, analito_nombre, limite_inf, nominal, limite_sup, unidad)
  SELECT s.id, s.tenant_id, 'NCH409_2005',
         'Reemplazada por el requisito de la NCh 409/1:2005 que entregó el LQC el 24-11-2026.',
         m.codigo, a.nombre, s.limite_inf, s.nominal, s.limite_sup, s.unidad
    FROM cat_especificacion s
    JOIN cat_analito a ON a.id = s.analito_id
    JOIN cat_metodo  m ON m.id = a.metodo_id
    JOIN tmp_q5_nch409 n ON n.metodo = m.codigo
   WHERE s.deleted_at IS NULL AND s.activo AND s.ambito = 'estandar'
     AND s.dedupe_key <> 'nch409_2005'
     AND EXISTS (SELECT 1 FROM cat_especificacion x
                  WHERE x.analito_id = s.analito_id AND x.dedupe_key = 'nch409_2005' AND x.activo AND x.deleted_at IS NULL)
  ON CONFLICT (especificacion_id) DO NOTHING;

  UPDATE cat_especificacion s
     SET activo = FALSE
    FROM cat_especificacion_retirada r
   WHERE r.especificacion_id = s.id AND r.lote = 'NCH409_2005' AND s.activo;
END $$;

-- Para REVERTIR (no forma parte de la instalación):
--   UPDATE cat_especificacion s SET activo = TRUE
--     FROM cat_especificacion_retirada r WHERE r.especificacion_id = s.id AND r.lote = 'NCH409_2005';
--   DELETE FROM cat_especificacion_retirada WHERE lote = 'NCH409_2005';
--   UPDATE cat_especificacion SET activo = FALSE WHERE dedupe_key = 'nch409_2005';

DROP TABLE IF EXISTS tmp_q5_nch409;

-- ---------------------------------------------------------------------------
-- 2. LQA · planillas de registro LAL-PG01-P02 (lecturas y fórmula)
-- ---------------------------------------------------------------------------
ALTER TABLE paso_metodo ADD COLUMN IF NOT EXISTS valor_defecto NUMERIC(18,6);
ALTER TABLE paso_metodo ADD COLUMN IF NOT EXISTS simbolo       VARCHAR(20);
ALTER TABLE paso_metodo ADD COLUMN IF NOT EXISTS por_confirmar BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cat_metodo  ADD COLUMN IF NOT EXISTS reglas_captura JSONB;
ALTER TABLE cat_metodo  ADD COLUMN IF NOT EXISTS nota_captura   TEXT;

DROP TABLE IF EXISTS tmp_q5_metodo;
DROP TABLE IF EXISTS tmp_q5_paso;
CREATE TEMP TABLE tmp_q5_metodo (codigo VARCHAR(30) PRIMARY KEY, formula TEXT, reglas JSONB, nota TEXT);
CREATE TEMP TABLE tmp_q5_paso (
  codigo VARCHAR(30), orden INT, nombre VARCHAR(200), simbolo VARCHAR(20), unidad VARCHAR(40),
  valor_defecto NUMERIC(18,6), por_confirmar BOOLEAN, instruccion TEXT
);

INSERT INTO tmp_q5_metodo (codigo, formula, reglas, nota) VALUES
('386', '(C4 - C1) / (C2 - C1) * 100',
 '[]',
 'Cenizas totales (IT04-FORM01 rev. 09): % = (m₂ − m₀) / (m₁ − m₀) × 100, con m₀ el crisol vacío, m₁ el crisol con la muestra y m₂ la última pesada del crisol con cenizas. Repita la calcinación hasta peso constante (diferencia ≤ 0,1 % de la masa de la porción). Duplicados X y X″: aceptación según NCh 842 Of. 1978 o la DRP de la NCh 842:2018. La planilla no imprime la ecuación: POR CONFIRMAR.'),
('397', '(C2 - C3) * C4 * 1000 / C1',
 '[]',
 'Índice de peróxido (IT25-FORM01 rev. 00): meq/kg = (V₁ − V₀) × N × 1000 / P, con V₁ el gasto de tiosulfato de la muestra, V₀ el del blanco, N la normalidad del tiosulfato y P el peso de la muestra en g. Corrija la bureta en cada valoración. La planilla no imprime la ecuación: POR CONFIRMAR.'),
('402', '(C1 + C2 + C3) / 3',
 '[]',
 'pH (IT17-FORM02 rev. 02): tres lecturas de pH y su promedio; registre también la temperatura de la muestra.');

INSERT INTO tmp_q5_paso (codigo, orden, nombre, simbolo, unidad, valor_defecto, por_confirmar, instruccion) VALUES
('386', 1, 'Peso del crisol vacío', 'm₀', 'g', NULL, false, NULL),
('386', 2, 'Peso del crisol con la muestra', 'm₁', 'g', NULL, false, NULL),
('386', 3, 'Pesada anterior del crisol con cenizas', 'm₂′', 'g', NULL, false, 'Penúltima pesada de la serie hasta peso constante.'),
('386', 4, 'Pesada final del crisol con cenizas (peso constante)', 'm₂', 'g', NULL, false, NULL),
('397', 1, 'Peso de la muestra', 'P', 'g', NULL, false, NULL),
('397', 2, 'Gasto de tiosulfato de la muestra', 'V₁', 'mL', NULL, false, 'Gasto corregido con la corrección de la bureta.'),
('397', 3, 'Gasto de tiosulfato del blanco', 'V₀', 'mL', 0, false, NULL),
('397', 4, 'Normalidad del tiosulfato', 'N', 'N', NULL, false, NULL),
('402', 1, 'Lectura de pH Nº 1', 'pH₁', NULL, NULL, false, NULL),
('402', 2, 'Lectura de pH Nº 2', 'pH₂', NULL, NULL, false, NULL),
('402', 3, 'Lectura de pH Nº 3', 'pH₃', NULL, NULL, false, NULL),
('402', 4, 'Temperatura de la muestra', 'T', '°C', NULL, false, 'Dato de la planilla; no entra en el cálculo.');

-- 2.1 Lecturas: solo en los métodos que aún no tienen ninguna (no pisa lo editado).
INSERT INTO paso_metodo (tenant_id, cat_metodo_id, orden, nombre, tipo_dato, unidad, simbolo, valor_defecto, por_confirmar, instruccion, obligatorio, activo)
SELECT m.tenant_id, m.id, p.orden, p.nombre, 'numero', p.unidad, p.simbolo, p.valor_defecto, p.por_confirmar, p.instruccion,
       NOT (p.codigo = '402' AND p.orden = 4), true
  FROM tmp_q5_paso p
  JOIN cat_metodo m ON m.codigo = p.codigo AND m.deleted_at IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM paso_metodo x WHERE x.cat_metodo_id = m.id AND x.deleted_at IS NULL
                     AND NOT EXISTS (SELECT 1 FROM tmp_q5_paso y WHERE y.codigo = p.codigo AND y.orden = x.orden AND y.nombre = x.nombre))
ON CONFLICT (tenant_id, cat_metodo_id, orden, nombre) DO NOTHING;

-- 2.2 Reglas y nota: solo si el método no tiene.
UPDATE cat_metodo m
   SET reglas_captura = COALESCE(m.reglas_captura, d.reglas),
       nota_captura   = COALESCE(m.nota_captura, d.nota)
  FROM tmp_q5_metodo d
 WHERE m.codigo = d.codigo
   AND (m.reglas_captura IS NULL OR m.nota_captura IS NULL);

-- 2.3 Fórmula del analito: solo si está vacía.
UPDATE cat_analito a
   SET formula = d.formula
  FROM tmp_q5_metodo d
  JOIN cat_metodo m ON m.codigo = d.codigo
 WHERE a.metodo_id = m.id AND a.deleted_at IS NULL
   AND COALESCE(btrim(a.formula), '') = '';

DROP TABLE IF EXISTS tmp_q5_metodo;
DROP TABLE IF EXISTS tmp_q5_paso;

-- 2.4 Proteína Kjeldahl (método 403): la planilla IT07-FORM01 rev. 04 registra el
--     peso de muestra en mg y la constante 14,01 → %P = 1401 × N × V × F / m(mg).
--     Solo si la fórmula y la lectura siguen como las sembró ALI-D4.
UPDATE cat_analito a
   SET formula = '1401 * C3 * C2 * C4 / C1'
  FROM cat_metodo m
 WHERE a.metodo_id = m.id AND m.codigo = '403' AND a.deleted_at IS NULL
   AND btrim(a.formula) = '1.4 * C3 * C2 * C4 / C1'
   AND EXISTS (SELECT 1 FROM paso_metodo p WHERE p.cat_metodo_id = m.id AND p.orden = 1 AND p.nombre = 'Peso de muestra'
                 AND p.unidad = 'g' AND p.por_confirmar AND p.deleted_at IS NULL);

UPDATE paso_metodo p
   SET unidad = 'mg', por_confirmar = FALSE,
       instruccion = 'Peso de muestra en mg, como la planilla IT07-FORM01 rev. 04 (constante 14,01).'
  FROM cat_metodo m
 WHERE p.cat_metodo_id = m.id AND m.codigo = '403' AND p.orden = 1 AND p.nombre = 'Peso de muestra'
   AND p.unidad = 'g' AND p.por_confirmar AND p.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL
                 AND btrim(a.formula) = '1401 * C3 * C2 * C4 / C1');

UPDATE cat_metodo m
   SET nota_captura = 'Proteína (Kjeldahl, IT07-FORM01 rev. 04): %P = 14,01 × N × V × Factor × 100 / m, con m en mg. Ingrese el duplicado X y X″; el resultado es el promedio y la diferencia entre duplicados no supera 0,38 %. POR CONFIRMAR con el IDIC: factor de conversión por producto (6,25 por defecto) y si la diferencia es absoluta o relativa.'
 WHERE m.codigo = '403'
   AND m.nota_captura LIKE 'Proteína (Kjeldahl, IT07): %P = 1,4 × N × V × Factor / m.%'
   AND EXISTS (SELECT 1 FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL
                 AND btrim(a.formula) = '1401 * C3 * C2 * C4 / C1');

-- ---------------------------------------------------------------------------
-- 3. LQA y LES · Notas aclaratorias del Informe de Ensayos Alimentos
-- ---------------------------------------------------------------------------
-- Texto de los informes reales del IDIC-PG09 Anexo 02-02 rev05 que llegaron el
-- 24-11-2026 («Proceso adm LQA 2026» y «Proceso adm LES 2026»). Reemplaza el
-- texto propuesto por ALI-D7 solo si la plantilla sigue con ese texto (no pisa
-- lo que Gestión de Calidad haya editado).
UPDATE plantilla_informe
   SET cuerpo_html = replace(cuerpo_html,
$viejo$<h2>6. Notas aclaratorias</h2>
<p>Los ensayos contenidos en este informe fueron ejecutados en las instalaciones permanentes del laboratorio indicado en el membrete.</p>
<p>Los resultados del presente informe solo son válidos para las muestras entregadas y recibidas en el laboratorio para ser ensayadas, y no representan lote o partida alguna de fabricación.</p>
<p>Los datos de extracción, fecha de muestreo e identificación de la muestra fueron proporcionados por el cliente o por la Sección Muestreo del IDIC. El laboratorio no es responsable de dicha información ni de los efectos que esta pueda tener en la validez de los resultados.</p>
<p>Los resultados de este informe no pueden ser reproducidos en forma parcial sin la autorización escrita del laboratorio.</p>$viejo$,
$nuevo$<h2>6. Notas aclaratorias</h2>
<ul class="notas">
  <li>Los datos de extracción, fecha de muestreo e identificación de la muestra fueron proporcionados por el cliente (Sección Muestreo SMU-IDIC); por tanto, el laboratorio no es responsable por dicha información ni por los efectos que esta pueda tener en la validez de los resultados.</li>
  <li>Los resultados del presente informe solo son válidos para las muestras entregadas y recibidas en el laboratorio para ser ensayadas, y no representan lote o partida alguna de fabricación.</li>
  <li>Los resultados se aplican a la muestra como se recibió.</li>
  <li>Se declara que los resultados de este informe no pueden ser reproducidos en forma parcial o total, sin la autorización escrita del laboratorio.</li>
  <li>Los ensayos contenidos en este informe fueron ejecutados en las instalaciones permanentes del {{unidad.nombre}} - IDIC, ubicado en Av. Pedro Montt 2136, Santiago.</li>
</ul>$nuevo$)
 WHERE repid = 'PG09A2-ALI'
   AND position('<p>Los ensayos contenidos en este informe fueron ejecutados en las instalaciones permanentes del laboratorio indicado en el membrete.</p>' IN cuerpo_html) > 0;
