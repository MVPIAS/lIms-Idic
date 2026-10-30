-- =============================================================================
-- align_ali_alimentos.sql · Frente ALI · tanda 1 (EP-02, revisión 29-10-2026)
-- LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql. No crea permisos.
--
-- Correcciones del IDIC a los flujos de Alimentos (LQA, LMB y LES) y formatos
-- reales recibidos (OT, órdenes de análisis, I.V.C. e Informe de Ensayos):
--
--   1. ALI-D1 · Recepción de la muestra: temperatura de llegada (°C, un
--      decimal), fecha y hora de la toma de muestra y Nº del formulario de
--      muestreo. Opcionales en todos los laboratorios; los imprime el informe.
--   2. ALI-D2 · Documento de respaldo de la OT (tipo, Nº y fecha) en los datos
--      del encargo. La toma de muestra programada ya existe
--      (ot_encargo.lugar_muestreo / fecha_muestreo) y la norma de cada ensayo
--      sale del método del catálogo (cat_metodo.norma).
--   3. ALI-D7 · Plantilla «Informe de Ensayos Alimentos» (IDIC-PG09 Anexo 02-02
--      rev05), común a LQA, LMB y LES: solo resultados (sin requisito ni
--      veredicto), firmas Jefe de Laboratorio y, «Por orden del Director del
--      IDIC», Jefe del Departamento Químico (las resuelve la matriz de firmas).
--   4. ALI-D8 · Reporte I.V.C. de Alimentos: cuerpo de la plantilla heredada
--      IBC01 «Planilla respaldo I.V.C.» con requisitos Mínimo / Máximo / Otros,
--      resultado y Cumple / No cumple. Solo si la plantilla no tiene cuerpo
--      (no pisa lo que edite Gestión de Calidad).
--
-- Pendiente del IDIC: numeración {OT}-{correlativo} del informe y si el I.V.C.
-- se entrega al cliente (carta SAL-14); código LAL o DAL de los formularios
-- (SAL-12). Hasta entonces rige la numeración del sistema.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recepción de la muestra (ALI-D1)
-- ---------------------------------------------------------------------------
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS temperatura_recepcion NUMERIC(4,1);
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS fecha_toma_muestra    TIMESTAMPTZ;
ALTER TABLE muestra ADD COLUMN IF NOT EXISTS formulario_muestreo   VARCHAR(120);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_muestra_temperatura_recepcion') THEN
    ALTER TABLE muestra ADD CONSTRAINT ck_muestra_temperatura_recepcion
      CHECK (temperatura_recepcion IS NULL OR temperatura_recepcion BETWEEN -40 AND 60);
  END IF;
END $$;
COMMENT ON COLUMN muestra.temperatura_recepcion IS 'Temperatura de llegada de la muestra en °C (EP-02 1.2; órdenes de análisis LAL-PG01-P02-FORM09 y P03-FORM02). Se imprime en el Informe de Ensayos.';
COMMENT ON COLUMN muestra.fecha_toma_muestra IS 'Fecha y hora de la toma de muestra (EP-02 1.1); no posterior a la recepción.';
COMMENT ON COLUMN muestra.formulario_muestreo IS 'Nº del formulario de muestreo (formulario de selección y extracción de muestras del DCO o la Sección Muestreo).';

-- La temperatura pasa a ser un dato común de la recepción: el campo propio
-- «Temperatura de llegada (°C)» de LQA, LMB y LES (align_r1g_recorrido.sql) se
-- desactiva para no pedirla dos veces, y lo ya registrado en él se copia a la
-- columna (solo si es un número en rango y la columna está vacía).
UPDATE muestra
   SET temperatura_recepcion = round(replace(datos_recepcion->>'temperatura_llegada', ',', '.')::numeric, 1)
 WHERE temperatura_recepcion IS NULL
   AND datos_recepcion ? 'temperatura_llegada'
   AND replace(datos_recepcion->>'temperatura_llegada', ',', '.') ~ '^-?[0-9]+(\.[0-9]+)?$'
   AND replace(datos_recepcion->>'temperatura_llegada', ',', '.')::numeric BETWEEN -40 AND 60;
UPDATE parametro_sistema
   SET activo = false
 WHERE categoria = 'recepcion_campo'
   AND codigo IN ('LQA.temperatura_llegada', 'LMB.temperatura_llegada', 'LES.temperatura_llegada')
   AND activo;

-- ---------------------------------------------------------------------------
-- 2. Documento de respaldo de la OT (ALI-D2)
-- ---------------------------------------------------------------------------
ALTER TABLE ot_encargo ADD COLUMN IF NOT EXISTS doc_respaldo_tipo   VARCHAR(60);
ALTER TABLE ot_encargo ADD COLUMN IF NOT EXISTS doc_respaldo_numero VARCHAR(60);
ALTER TABLE ot_encargo ADD COLUMN IF NOT EXISTS doc_respaldo_fecha  DATE;
COMMENT ON COLUMN ot_encargo.doc_respaldo_tipo IS 'Documento de respaldo de la OT (EP-02 0.7): tipo (oficio, orden de compra, factura…), con su Nº y fecha.';

-- ---------------------------------------------------------------------------
-- 3. Informe de Ensayos Alimentos · IDIC-PG09 Anexo 02-02 rev05 (ALI-D7)
-- ---------------------------------------------------------------------------
-- Común a los tres laboratorios de la Sección Alimentos (el membrete toma el
-- laboratorio responsable de la OT). Las notas aclaratorias son un texto
-- propuesto: Gestión de Calidad lo ajusta editando la plantilla.
INSERT INTO plantilla_informe (tenant_id, repid, nombre, tipo, emision, version, activo, cuerpo_html, config_informe)
SELECT t.id, 'PG09A2-ALI', 'Informe de Ensayos Alimentos (IDIC-PG09 Anexo 02-02 rev05)', 'I.ENSAYO', 'conjunto', 'rev05', TRUE,
$cuerpo$<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Departamento Químico &middot; {{unidad.nombre}}</span>
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
  <tr><th>Atención</th><td>{{ot.solicitante}}</td><th>Contacto</th><td>{{antecedentes.contacto}}</td></tr>
  <tr><th>Dirección</th><td colspan="3">{{cliente.direccion}}</td></tr>
  <tr><th>Fecha O/T</th><td>{{ot.fechaRecepcion}}</td><th>Fecha y hora de muestreo</th><td>{{antecedentes.muestreo}}</td></tr>
  <tr><th>Fecha de recepción del ítem</th><td>{{antecedentes.recepcion}}</td><th>Fecha y hora del análisis</th><td>{{antecedentes.analisis}}</td></tr>
  <tr><th>Fecha de emisión del informe</th><td colspan="3">{{fecha}}</td></tr>
</table>

<h2>2. Identificación de la muestra</h2>
<table class="meta">
  <tr><th>Temperatura de recepción</th><td>{{antecedentes.temperatura}}</td><th>Formulario de muestreo</th><td>{{antecedentes.formulario}}</td></tr>
</table>
{{identificacion_muestras}}

<h2>3. Identificación de normas, métodos y/o especificaciones técnicas</h2>
<h3>3.1. Normas y métodos</h3>
{{tabla_metodos}}
<h3>3.2. Especificaciones técnicas</h3>
{{#si ot.descripcionTrabajo}}<p>{{ot.descripcionTrabajo}}</p>{{/si}}
{{#no ot.descripcionTrabajo}}<p>No aplica.</p>{{/no}}

<h2>4. Resultados</h2>
{{tabla_resultados}}

<h2>5. Conclusiones y/u observaciones</h2>
{{conclusion_texto}}

<h2>6. Notas aclaratorias</h2>
<p>Los ensayos contenidos en este informe fueron ejecutados en las instalaciones permanentes del laboratorio indicado en el membrete.</p>
<p>Los resultados del presente informe solo son válidos para las muestras entregadas y recibidas en el laboratorio para ser ensayadas, y no representan lote o partida alguna de fabricación.</p>
<p>Los datos de extracción, fecha de muestreo e identificación de la muestra fueron proporcionados por el cliente o por la Sección Muestreo del IDIC. El laboratorio no es responsable de dicha información ni de los efectos que esta pueda tener en la validez de los resultados.</p>
<p>Los resultados de este informe no pueden ser reproducidos en forma parcial sin la autorización escrita del laboratorio.</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe de Laboratorio</div>
  <div class="firma"><span class="linea"></span>Por orden del Director del IDIC · Jefe Departamento Químico</div>
</div>$cuerpo$,
'{
  "agrupacion": "muestra", "columnaMetodo": false, "columnaUnidad": true,
  "referencias": false, "anexoFotografico": false,
  "modalidadPorDefecto": "solo_resultados",
  "etiquetas": {"ensayo": "Ensayos", "resultado": "Resultado"}
}'::jsonb
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM plantilla_informe p WHERE p.tenant_id = t.id AND p.repid = 'PG09A2-ALI');

-- ---------------------------------------------------------------------------
-- 4. Reporte I.V.C. de Alimentos sobre la plantilla heredada IBC01 (ALI-D8)
-- ---------------------------------------------------------------------------
-- La numeración {Nº de muestra}/{año} del formato real espera la respuesta del
-- IDIC (SAL-14): mientras tanto se imprime el número del sistema.
UPDATE plantilla_informe
   SET cuerpo_html = $cuerpo$<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>EJÉRCITO DE CHILE &middot; COMANDO DE INDUSTRIA MILITAR E INGENIERÍA</b>
    <span>Instituto de Investigaciones y Control &middot; {{unidad.nombre}}</span>
  </div>
  <div class="doc">
    <b>Fecha: {{fecha_hora}}</b>
    <span>I.V.C. N.º {{certificado.numero}}</span>
  </div>
</div>

<table class="meta">
  <tr><th>I.V.C. N.º</th><td>{{certificado.numero}}</td><th>N.º O/T</th><td>{{ot.codigo}}</td></tr>
  <tr><th>Cliente</th><td colspan="3">{{cliente.razonSocial}}</td></tr>
</table>

{{identificacion_muestras}}

{{tabla_resultados}}

{{conclusion}}$cuerpo$,
       config_informe = COALESCE(config_informe, '{}'::jsonb) || '{
         "agrupacion": "muestra", "columnaMetodo": false, "columnaUnidad": false,
         "columnasRequisito": "min_max_otros", "textoSinCota": "",
         "referencias": false, "anexoFotografico": false,
         "modalidadPorDefecto": "cumplimiento",
         "etiquetas": {"ensayo": "Análisis", "minimo": "Mín.", "maximo": "Máx.", "otros": "Otros", "resultado": "Resultado", "veredicto": "Observ."}
       }'::jsonb
 WHERE repid = 'IBC01' AND nombre = 'Planilla respaldo I.V.C.'
   AND COALESCE(btrim(cuerpo_html), '') = '';
