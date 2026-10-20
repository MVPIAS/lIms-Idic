-- =============================================================================
-- align_recepcion_custodia_equipo_lme.sql · Entrega R1 · frente r1d
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: se puede reaplicar sin error ni efectos secundarios.
-- Va al FINAL de ORDEN_SQL.txt. Reglas: docs/FLUJO_RECEPCION_CUSTODIA_EQUIPO.md
-- Especificaciones: EP-01 §1.3 / §6.4, EP-02 §1.2 / §2.1, EP-03 §1.2 / §6.3,
-- EP-05 §3.1, y las respuestas del LME del 20-10-2026.
--
--   1. Recepción e identificación de la muestra:
--        · Nº de muestra interno (correlativo atómico por tenant, botón
--          «Asignar número»), con quién y cuándo se asignó;
--        · producto (matriz) = cat_elemento (ya existía muestra.cat_elemento_id);
--        · sellos (varios Nº) y «sellos verificados»;
--        · destino de la muestra (análisis / testigo / en custodia /
--          contramuestra) y fecha hasta la que se retiene;
--        · campos propios de cada laboratorio (datos_recepcion, JSONB),
--          definidos en Catálogo › Parámetros (categoría recepcion_campo).
--   2. Registro fotográfico de la recepción y termograma (ot_foto.tipo).
--   3. Equipo usado en la captura: fecha y hora del ensayo, T, HR e
--      incertidumbre por ensayo; «exige equipo» por método (cat_metodo).
--   4. Parámetros por defecto (editables por el IDIC sin código).
-- =============================================================================

-- --- 1. Recepción e identificación de la muestra -----------------------------------
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS numero_interno     BIGINT;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS numero_interno_por UUID;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS numero_interno_at  TIMESTAMPTZ;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS sellos_verificados BOOLEAN;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS clase_custodia     VARCHAR(20);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS retener_hasta      DATE;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS datos_recepcion    JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Varios sellos por muestra («15572, 15573»): ampliar no reescribe la tabla.
DO $$
BEGIN
  IF (SELECT character_maximum_length FROM information_schema.columns
       WHERE table_name = 'muestra' AND column_name = 'sello_numero') < 200 THEN
    ALTER TABLE muestra ALTER COLUMN sello_numero TYPE VARCHAR(200);
  END IF;
  IF (SELECT character_maximum_length FROM information_schema.columns
       WHERE table_name = 'muestra' AND column_name = 'ubicacion') < 120 THEN
    ALTER TABLE muestra ALTER COLUMN ubicacion TYPE VARCHAR(120);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_muestra_clase_custodia') THEN
    ALTER TABLE muestra ADD CONSTRAINT ck_muestra_clase_custodia CHECK (
      clase_custodia IS NULL OR clase_custodia IN ('analisis', 'testigo', 'custodia', 'contramuestra')
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_muestra_numero_interno
  ON muestra (tenant_id, numero_interno) WHERE numero_interno IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_muestra_retener_hasta
  ON muestra (tenant_id, retener_hasta) WHERE retener_hasta IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN muestra.numero_interno IS
  'Nº de muestra interno del laboratorio (correlativo por tenant, correlativo_muestra). Se asigna con «Asignar número» y no cambia.';
COMMENT ON COLUMN muestra.clase_custodia IS
  'Destino de la muestra: analisis (se consume o destruye) | testigo (bodega, plazo mínimo) | custodia (se devuelve) | contramuestra (se retiene).';
COMMENT ON COLUMN muestra.retener_hasta IS
  'Fecha hasta la que la muestra debe conservarse (testigo / contramuestra): antes no se puede registrar su destrucción.';
COMMENT ON COLUMN muestra.datos_recepcion IS
  'Campos propios del laboratorio en la recepción (fabricante, lote, verificaciones…): parametro_sistema categoría recepcion_campo.';

-- Correlativo del Nº de muestra interno: una fila por tenant, UPDATE … RETURNING atómico.
CREATE TABLE IF NOT EXISTS correlativo_muestra (
  tenant_id  UUID PRIMARY KEY REFERENCES tenant(id),
  ultimo     BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- 2. Fotos: registro fotográfico de la recepción y termograma ------------------
ALTER TABLE ot_foto ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'anexo';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ot_foto_tipo') THEN
    ALTER TABLE ot_foto ADD CONSTRAINT ck_ot_foto_tipo CHECK (tipo IN ('anexo', 'recepcion', 'termograma'));
  END IF;
END $$;
COMMENT ON COLUMN ot_foto.tipo IS
  'anexo = anexo fotográfico del informe · recepcion = registro fotográfico al recibir la muestra · termograma = curva DSC u otro registro del instrumento ({{termograma}}).';

-- --- 3. Equipo usado en la captura ------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS fecha_ensayo  TIMESTAMPTZ;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS temperatura   NUMERIC(6,2);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS humedad       NUMERIC(5,2);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS incertidumbre VARCHAR(60);
COMMENT ON COLUMN resultado.fecha_ensayo IS 'Fecha y hora en que se ejecutó el ensayo (la de la captura si no se indica).';
COMMENT ON COLUMN resultado.temperatura IS 'Temperatura ambiente del ensayo (°C), si el método la registra.';
COMMENT ON COLUMN resultado.humedad IS 'Humedad relativa del ensayo (%), si el método la registra.';

ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS equipo_requerido BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN cat_metodo.equipo_requerido IS
  'El método exige informar el equipo usado al capturar (contrato §4.4.2). Ver parámetro captura_equipo.obligatorio.';
CREATE INDEX IF NOT EXISTS idx_resultado_equipo ON resultado (equipo_id) WHERE equipo_id IS NOT NULL;

-- --- 4. Parámetros por defecto (Catálogo › Parámetros; ON CONFLICT no pisa ediciones)
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  -- Toma de muestra «Sucursal Santiago» (LME, 20-10-2026).
  ('toma_muestra', 'sucursal_santiago', 'Sucursal Santiago', 4, NULL),
  -- Plazos de retención en meses (EP-01 §6.4: testigo ≥ 1 mes; EP-03 §1.2: contramuestra 12 meses).
  ('retencion_muestra', 'testigo',       'Muestra testigo · meses en bodega antes de destruirla', 1, '1'),
  ('retencion_muestra', 'contramuestra', 'Contramuestra · meses de retención',                   2, '12'),
  -- Nº de muestra interno: primer número (si se continúa la numeración del LIMS antiguo, póngase aquí).
  ('numeracion_muestra', 'inicio', 'Primer Nº de muestra interno', 1, '1'),
  -- Equipo obligatorio en la captura: metodo (los métodos marcados «exige equipo») | numerico | siempre.
  ('captura_equipo', 'obligatorio', 'Equipo obligatorio al capturar (metodo | numerico | siempre)', 1, 'metodo')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- Producto (matriz) obligatorio al recepcionar, por laboratorio (activo = obligatorio).
-- LME lo pidió el 20-10-2026; LPN registra una muestra por envase o producto (EP-01 §1.3).
-- El resto queda configurable: basta activar la fila de su laboratorio.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo)
SELECT t.id, 'recepcion_producto_obligatorio', v.codigo, v.etiqueta, v.orden, v.activo
  FROM tenant t
 CROSS JOIN (VALUES
  ('LME', 'LME · producto (matriz) obligatorio al recepcionar', 1, TRUE),
  ('LPN', 'LPN · producto (familia) obligatorio al recepcionar', 2, TRUE),
  ('LQC', 'LQC · producto (matriz) obligatorio al recepcionar', 3, FALSE),
  ('LCC', 'LCC · producto obligatorio al recepcionar', 4, FALSE),
  ('LTX', 'LTX · producto obligatorio al recepcionar', 5, FALSE)
 ) AS v(codigo, etiqueta, orden, activo)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- Lista de productos del LME (20-10-2026: nitrocelulosa, aluminio, nitrato de
-- amonio, hexamina…): elementos del catálogo. Código = <LAB>.<código del elemento>.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT e.tenant_id, 'producto_lab', 'LME.' || e.codigo, v.etiqueta, v.orden, e.codigo
  FROM (VALUES
    ('6703', 'Nitrocelulosa',       1),
    ('6705', 'Aluminio',            2),
    ('6697', 'Nitrato de amonio',   3),
    ('6701', 'Nitrato de hexamina', 4)
  ) AS v(codigo, etiqueta, orden)
  JOIN cat_elemento e ON e.codigo = v.codigo AND e.deleted_at IS NULL
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- Campos propios de cada laboratorio en la recepción. Código = <LAB>.<campo>;
-- valor = definición JSON {tipo, obligatorio, opciones, ayuda}. Tipos: texto,
-- numero, entero, fecha, lista, casilla. Los códigos «clase_custodia» y
-- «ubicacion» van a columnas de la muestra; el resto, a datos_recepcion.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'recepcion_campo', v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  -- LME · tarjeta LME-PG01-IT02-FORM01 (EP-01 §1.3, variante LME)
  ('LME.clase_custodia', 'Tipo de muestra', 1,
   '{"tipo":"lista","obligatorio":true,"opciones":[{"valor":"analisis","etiqueta":"Análisis"},{"valor":"testigo","etiqueta":"Testigo"},{"valor":"custodia","etiqueta":"En custodia"}],"ayuda":"La muestra testigo va a la bodega fuera del laboratorio por al menos el plazo de retención."}'),
  ('LME.fabricante', 'Fabricante', 2, '{"tipo":"texto"}'),
  ('LME.lote', 'Lote', 3, '{"tipo":"texto"}'),
  ('LME.cantidad_recibida', 'Cantidad recibida', 4, '{"tipo":"texto","ayuda":"Con su unidad, p. ej. 100 g."}'),
  ('LME.verif_especificacion', 'Verificada contra la especificación técnica', 5, '{"tipo":"casilla","obligatorio":true}'),
  ('LME.verif_ot', 'Verificada contra la O/T', 6, '{"tipo":"casilla","obligatorio":true}'),
  ('LME.verif_formulario_muestreo', 'Verificada contra el formulario de inspección de muestreo', 7, '{"tipo":"casilla","obligatorio":true}'),
  ('LME.ubicacion', 'Ubicación', 8,
   '{"tipo":"lista","opciones":[{"valor":"Sala de preparación","etiqueta":"Sala de preparación"},{"valor":"Bodega","etiqueta":"Bodega"}]}'),
  -- LPN · una muestra por envase o producto (EP-01 §1.3, variante LPN)
  ('LPN.color', 'Color', 1, '{"tipo":"texto"}'),
  ('LPN.lote', 'Lote', 2, '{"tipo":"texto"}'),
  ('LPN.especificacion', 'Especificación', 3,
   '{"tipo":"lista","opciones":[{"valor":"mop_5_7","etiqueta":"MOP · Manual de Carreteras 5.7"},{"valor":"norma_cliente","etiqueta":"Norma del cliente"},{"valor":"ficha_tecnica","etiqueta":"Ficha técnica"}]}'),
  -- LCC y LTX · Sección Vestuario y Equipos (EP-03 §1.2)
  ('LCC.unidades_recibidas', 'Nº de pares / unidades recibidas', 1, '{"tipo":"entero","obligatorio":true}'),
  ('LCC.ubicacion', 'Ubicación de almacenamiento', 2, '{"tipo":"texto","obligatorio":true}'),
  ('LCC.clase_custodia', 'Destino final', 3,
   '{"tipo":"lista","obligatorio":true,"opciones":[{"valor":"analisis","etiqueta":"Destrucción"},{"valor":"custodia","etiqueta":"Devolución"},{"valor":"contramuestra","etiqueta":"Contramuestra"}]}'),
  ('LTX.unidades_recibidas', 'Nº de pares / unidades recibidas', 1, '{"tipo":"entero","obligatorio":true}'),
  ('LTX.ubicacion', 'Ubicación de almacenamiento', 2, '{"tipo":"texto","obligatorio":true}'),
  ('LTX.clase_custodia', 'Destino final', 3,
   '{"tipo":"lista","obligatorio":true,"opciones":[{"valor":"analisis","etiqueta":"Destrucción"},{"valor":"custodia","etiqueta":"Devolución"},{"valor":"contramuestra","etiqueta":"Contramuestra"}]}'),
  -- Sección Alimentos (EP-02 §2.1)
  ('LQA.lote', 'Lote', 1, '{"tipo":"texto"}'),
  ('LQA.fecha_elaboracion', 'Fecha de elaboración', 2, '{"tipo":"fecha"}'),
  ('LQA.tamano_muestra', 'Tamaño de muestra / lote', 3, '{"tipo":"texto"}'),
  ('LMB.lote', 'Lote', 1, '{"tipo":"texto"}'),
  ('LMB.fecha_elaboracion', 'Fecha de elaboración', 2, '{"tipo":"fecha"}'),
  ('LMB.tamano_muestra', 'Tamaño de muestra / lote', 3, '{"tipo":"texto"}'),
  ('LES.lote', 'Lote', 1, '{"tipo":"texto"}'),
  ('LES.fecha_elaboracion', 'Fecha de elaboración', 2, '{"tipo":"fecha"}'),
  ('LES.tamano_muestra', 'Tamaño de muestra / lote', 3, '{"tipo":"texto"}'),
  -- Depto. Sistemas de Armas · recibir el lote o los ítems (EP-05 §3.1)
  ('LRB.tipo_item', 'Tipo de ítem', 1, '{"tipo":"texto","obligatorio":true}'),
  ('LRB.cantidad', 'Cantidad', 2, '{"tipo":"entero","obligatorio":true}'),
  ('LRB.modelo', 'Modelo', 3, '{"tipo":"texto"}'),
  ('LRB.lote', 'Lote', 4, '{"tipo":"texto","obligatorio":true}'),
  ('LRB.fabricante', 'Fabricante', 5, '{"tipo":"texto"}'),
  ('LRB.anio', 'Año', 6, '{"tipo":"entero"}'),
  ('LRB.series', 'Nº de serie por ítem', 7, '{"tipo":"texto","ayuda":"Separados por coma."}'),
  ('LRB.unidades_destructivas', 'Unidades destructivas', 8, '{"tipo":"entero"}'),
  ('LRB.testigo', 'Testigo en laboratorio', 9, '{"tipo":"casilla"}'),
  ('LRB.estado_ingreso', 'Estado al ingreso', 10, '{"tipo":"texto"}'),
  ('LAM.tipo_item', 'Tipo de ítem', 1, '{"tipo":"texto","obligatorio":true}'),
  ('LAM.cantidad', 'Cantidad', 2, '{"tipo":"entero","obligatorio":true}'),
  ('LAM.modelo', 'Modelo', 3, '{"tipo":"texto"}'),
  ('LAM.lote', 'Lote', 4, '{"tipo":"texto","obligatorio":true}'),
  ('LAM.fabricante', 'Fabricante', 5, '{"tipo":"texto"}'),
  ('LAM.anio', 'Año', 6, '{"tipo":"entero"}'),
  ('LAM.procedencia', 'Polvorín / unidad y procedencia', 7, '{"tipo":"texto"}'),
  ('LAM.unidades_destructivas', 'Unidades destructivas', 8, '{"tipo":"entero"}'),
  ('LAM.estado_ingreso', 'Estado al ingreso', 9, '{"tipo":"texto"}'),
  ('SEO.tipo_item', 'Tipo de ítem', 1, '{"tipo":"texto","obligatorio":true}'),
  ('SEO.cantidad', 'Cantidad', 2, '{"tipo":"entero","obligatorio":true}'),
  ('SEO.modelo', 'Modelo', 3, '{"tipo":"texto"}'),
  ('SEO.lote', 'Lote', 4, '{"tipo":"texto","obligatorio":true}'),
  ('SEO.fabricante', 'Fabricante', 5, '{"tipo":"texto"}'),
  ('SEO.estado_ingreso', 'Estado al ingreso', 6, '{"tipo":"texto"}'),
  ('LEM.tipo_item', 'Tipo de ítem', 1, '{"tipo":"texto","obligatorio":true}'),
  ('LEM.cantidad', 'Cantidad', 2, '{"tipo":"entero","obligatorio":true}'),
  ('LEM.lote', 'Lote', 3, '{"tipo":"texto","obligatorio":true}'),
  ('LEM.series', 'Nº de serie por ítem', 4, '{"tipo":"texto","ayuda":"Separados por coma."}'),
  ('LEM.unidades_destructivas', 'Unidades destructivas', 5, '{"tipo":"entero"}'),
  ('LEM.testigo', 'Testigo en laboratorio', 6, '{"tipo":"casilla"}'),
  -- SVM: la unidad de muestra es el vehículo (EP-05 §3.1)
  ('SVM.chasis', 'Nº de chasis', 1, '{"tipo":"texto","obligatorio":true}'),
  ('SVM.motor', 'Nº de motor', 2, '{"tipo":"texto","obligatorio":true}'),
  ('SVM.anio', 'Año', 3, '{"tipo":"entero"}'),
  ('SVM.km', 'Km de llegada', 4, '{"tipo":"numero"}'),
  ('SVM.identificador', 'PPU o Nº EJTO', 5, '{"tipo":"texto"}')
 ) AS v(codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
