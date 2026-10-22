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
--   5. Plantillas de informe del LME (tabla de 5 columnas, informe interno e
--      informe para cliente externo IDIC-PG09-ANEXO 02-02-REV05).
--   6. Circuito de aprobación del informe del LME en la matriz de firmas.
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

-- --- 5. Informes del LME (respuestas del 20-10-2026) --------------------------------
-- Tres plantillas de informe (tipo I.ENSAYO) con su formato (config-informe.ts):
--   LME-IT03   informe que genera el LIMS: tabla de 5 columnas
--              Análisis · Mínimo · Máximo · Resultado (unidad) · Condición, con «-.-».
--   LME-INT    informe interno: Muestra · Ensayo · Requisito · Resultado · Condición.
--   PG09A2-LME informe para cliente externo según IDIC-PG09-ANEXO 02-02-REV05:
--              antecedentes, identificación, normas y métodos con la fecha del
--              análisis, resultados con termograma, conclusiones y notas.
-- Solo se insertan si no existen (no pisan ediciones de Gestión de Calidad).
INSERT INTO plantilla_informe (tenant_id, repid, nombre, tipo, emision, version, activo, cuerpo_html, config_informe)
SELECT t.id, v.repid, v.nombre, 'I.ENSAYO', 'conjunto', v.version, TRUE, v.cuerpo, v.config::jsonb
  FROM tenant t
 CROSS JOIN (VALUES
  ('LME-IT03', 'Informe de ensayo LME · tabla Análisis / Mínimo / Máximo (LME-PG01-IT03)', 'rev04',
$cuerpo$<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Lab. Materiales Energéticos (LME)</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>LME-PG01-IT03 &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME N.º {{certificado.numero}}</h1>
<p>Santiago, {{fecha}}</p>

{{#si bpch.empresa}}<table class="meta">
  <tr><th>Empresa</th><td colspan="3">{{bpch.empresa}}</td></tr>
  <tr><th>R.U.T.</th><td>{{bpch.rut}}</td><th>Orden de Trabajo</th><td>{{ot.codigo}}</td></tr>
  <tr><th>Origen del trabajo</th><td>{{bpch.origen}}</td><th>Documento</th><td>{{bpch.documento}}</td></tr>
  <tr><th>Elemento</th><td colspan="3">{{bpch.elemento_generico}} {{bpch.elemento_especifico}}</td></tr>
  <tr><th>Lote</th><td>{{bpch.lote}}</td><th>Cantidad</th><td>{{bpch.tamano_lote_muestra}}</td></tr>
</table>{{/si}}
{{#no bpch.empresa}}<table class="meta">
  <tr><th>Cliente</th><td colspan="3">{{cliente.razonSocial}}</td></tr>
  <tr><th>R.U.T.</th><td>{{cliente.rut}}</td><th>Orden de Trabajo</th><td>{{ot.codigo}}</td></tr>
  <tr><th>Fecha de recepción</th><td>{{ot.fechaRecepcion}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
</table>{{/no}}

<h2>Identificación de la muestra</h2>
{{identificacion_muestras}}

<h2>Resultados</h2>
{{tabla_resultados}}

{{anexo_fotografico}}

{{conclusion}}

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Lab. Materiales Energéticos</div>
  <div class="firma"><span class="linea"></span>Jefe Departamento Químico</div>
</div>$cuerpo$,
   '{"agrupacion":"muestra","columnaMetodo":false,"columnaUnidad":false,"columnasRequisito":"min_max","unidadEnResultado":true,"textoSinCota":"-.-","referencias":false,"anexoFotografico":true,"etiquetas":{"ensayo":"Análisis","minimo":"Mínimo","maximo":"Máximo","resultado":"Resultado","veredicto":"Condición"}}'),
  ('LME-INT', 'Informe interno LME · Muestra / Ensayo / Requisito / Resultado / Condición', 'rev04',
$cuerpo$<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Lab. Materiales Energéticos (LME)</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>Informe interno &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME INTERNO N.º {{certificado.numero}}</h1>

<table class="meta">
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
  <tr><th>Solicitante</th><td colspan="3">{{cliente.razonSocial}}</td></tr>
</table>

<h2>Identificación de las muestras</h2>
{{identificacion_muestras}}

<h2>Resultados</h2>
{{tabla_resultados}}

{{anexo_fotografico}}

{{conclusion}}

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Lab. Materiales Energéticos</div>
</div>$cuerpo$,
   '{"agrupacion":"unica","columnaMuestra":true,"columnaMetodo":false,"columnaUnidad":false,"unidadEnResultado":true,"referencias":false,"anexoFotografico":true,"etiquetas":{"muestra":"Muestra","ensayo":"Ensayo","requisito":"Requisito","resultado":"Resultado","veredicto":"Condición"}}'),
  ('PG09A2-LME', 'Informe de ensayos LME · cliente externo (IDIC-PG09 Anexo 02-02 rev05)', 'rev05',
$cuerpo$<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Departamento Químico</span>
  </div>
  <div class="doc">
    <b>O/T N.º {{ot.codigo}}</b>
    <span>IDIC-PG09-Anexo02-02 &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME DE ENSAYOS N.º {{certificado.numero}}</h1>

<h2>1. Antecedentes</h2>
<table class="meta">
  <tr><th>Cliente</th><td colspan="3">{{cliente.razonSocial}}</td></tr>
  <tr><th>Atención</th><td>{{ot.solicitante}}</td><th>Contacto</th><td>{{cliente.telefono}}</td></tr>
  <tr><th>Dirección</th><td colspan="3">{{cliente.direccion}}</td></tr>
  <tr><th>Fecha O/T</th><td>{{ot.fechaRecepcion}}</td><th>Fecha y hora de muestreo</th><td>No aplica</td></tr>
  <tr><th>Fecha de recepción del ítem</th><td>{{ot.fechaRecepcion}}</td><th>Fecha y hora del análisis</th><td>Ver punto 3.1</td></tr>
  <tr><th>Fecha de emisión del informe</th><td colspan="3">{{fecha}}</td></tr>
</table>

<h2>2. Identificación de la muestra</h2>
{{identificacion_muestras}}

<h2>3. Identificación de normas, métodos y/o especificaciones técnicas</h2>
<h3>3.1. Normas y métodos</h3>
{{tabla_metodos}}
<h3>3.2. Especificaciones técnicas</h3>
{{#si ot.descripcionTrabajo}}<p>{{ot.descripcionTrabajo}}</p>{{/si}}
{{#no ot.descripcionTrabajo}}<p>Las indicadas en la tabla de resultados; sin requisito, «No especificado».</p>{{/no}}

<h2>4. Resultados</h2>
{{tabla_resultados}}
{{termograma}}

<h2>5. Conclusiones y/u observaciones</h2>
{{conclusion_texto}}

<h2>6. Notas aclaratorias</h2>
<p>Los resultados del presente informe sólo son válidos para las muestras ensayadas por el Laboratorio.</p>

{{anexo_fotografico}}

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Lab. Materiales Energéticos</div>
  <div class="firma"><span class="linea"></span>Jefe Sección Química</div>
  <div class="firma"><span class="linea"></span>Jefe Departamento Químico · Por orden del Director del IDIC</div>
</div>$cuerpo$,
   '{"agrupacion":"muestra","columnaMetodo":false,"columnaUnidad":false,"unidadEnResultado":true,"referencias":false,"anexoFotografico":true,"etiquetas":{"ensayo":"Ensayo","requisito":"Requisito","resultado":"Resultado","veredicto":"Condición"}}')
 ) AS v(repid, nombre, version, cuerpo, config)
 WHERE NOT EXISTS (SELECT 1 FROM plantilla_informe p WHERE p.tenant_id = t.id AND p.repid = v.repid);

-- --- 6. Circuito de aprobación del informe del LME (20-10-2026) -----------------------
-- Respuesta del LME: 1 Analista (evaluación) → 2 Jefe de Laboratorio (revisión y
-- firma) → 3 aprobación técnica («Asesor Técnico» en el texto; Jefe de Sección
-- en la imagen y en el informe real firmado) → 4 Jefe DQO (aprobación
-- administrativa y liberación; no aplica a OT interna) → 5 DCO (despacho).
-- La matriz sembrada para el LME ponía al final la firma de Gestión de Calidad,
-- que no figura en el circuito: se desactiva y se agrega la aprobación técnica
-- del Jefe de Sección antes de la oficialización del Jefe DQO. Solo si el LME
-- conserva la matriz sembrada (no se tocan matrices editadas en Administración).
DO $$
DECLARE
  t RECORD;
  v_lme UUID;
  v_calidad UUID;
  v_depto UUID;
BEGIN
  FOR t IN SELECT id FROM tenant LOOP
    v_lme := NULL; v_calidad := NULL; v_depto := NULL;
    SELECT id INTO v_lme FROM unidad WHERE tenant_id = t.id AND codigo = 'LME';
    IF v_lme IS NULL THEN CONTINUE; END IF;
    SELECT f.id INTO v_calidad FROM flujo_firma f JOIN rol r ON r.id = f.rol_id
     WHERE f.tenant_id = t.id AND f.unidad_id = v_lme AND f.tipo_documento = 'INFORME_ENSAYO'
       AND f.activo AND f.orden = 3 AND f.accion = 'FIRMA' AND r.codigo = 'CALIDAD';
    SELECT f.id INTO v_depto FROM flujo_firma f JOIN rol r ON r.id = f.rol_id
     WHERE f.tenant_id = t.id AND f.unidad_id = v_lme AND f.tipo_documento = 'INFORME_ENSAYO'
       AND f.activo AND f.orden = 2 AND f.accion = 'OFICIALIZA' AND r.codigo = 'JEFE_DEPTO';
    IF v_calidad IS NULL OR v_depto IS NULL THEN CONTINUE; END IF;
    UPDATE flujo_firma SET activo = FALSE, updated_at = now(),
           descripcion = 'Firma de Gestión de Calidad (desactivada: no figura en el circuito del LME del 20-10-2026)'
     WHERE id = v_calidad;
    UPDATE flujo_firma SET orden = 3, updated_at = now() WHERE id = v_depto;
    INSERT INTO flujo_firma (tenant_id, tipo_documento, unidad_id, orden, accion, rol_id, nivel_unidad, obligatorio, activo, descripcion)
    SELECT t.id, 'INFORME_ENSAYO', v_lme, 2, 'APRUEBA', r.id, 'SECCION', TRUE, TRUE,
           'Aprobación técnica (Jefe de Sección Química; el LME la nombra «Asesor Técnico»: por confirmar)'
      FROM rol r WHERE r.codigo = 'JEFE_SECCION' AND (r.tenant_id = t.id OR r.tenant_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM flujo_firma f WHERE f.tenant_id = t.id AND f.unidad_id = v_lme
                          AND f.tipo_documento = 'INFORME_ENSAYO' AND f.activo AND f.accion = 'APRUEBA');
  END LOOP;
END $$;
