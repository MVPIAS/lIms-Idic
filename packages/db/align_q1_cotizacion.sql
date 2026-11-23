-- =============================================================================
-- align_q1_cotizacion.sql · Quinto envío del IDIC (20–21-11-2026) · lotes 1 y 2 (Comercial)
-- -----------------------------------------------------------------------------
-- Análisis: 09_gestion/quinto_envio_2026-11-21/Analisis_envio_IDIC_2026-11-21.md
-- (§3 Comercial SVT, §4.1, §8 lotes 1 y 2).
--
--  1 · Validez de la cotización a particulares: 60 días (antes 45). Solo se
--      cambia si sigue el valor sembrado (45): no se pisa una edición del IDIC.
--  2 · Tipo de cliente «Interno» (la lista oficial tiene 15; el LIMS tenía 14).
--      Regla de validez: la de particulares.
--  3 · OT sin OC/OPI: la dispone el Director (por su intermedio, el Jefe del
--      Departamento productivo); 2 meses para regularizar (valor sin cambios,
--      solo el texto). Mismo texto en el tipo de aceptación y en el origen
--      «Disposición» (align_tercer_envio_comercial.sql los deja con el texto
--      anterior en cada pasada; este fichero va después y los corrige).
--  4 · Pie INN de la cotización: horario de atención y teléfono de reclamos con
--      su valor (solo si siguen vacíos) y plantilla «Cotización» versión 3:
--      plazo en días HÁBILES (IDIC-PG03 Rev18) y el pie en div.pie-cada-hoja,
--      que el PDF repite en cada hoja. La versión 3 es CUERPO_COTIZACION_FORM04_V3
--      de apps/api/src/cotizacion/plantilla-cotizacion.ts (el spec comprueba que
--      es la misma) y se aplica UNA vez, SOLO sobre la versión 2 sin editar (md5).
--  5 · Adjuntos de la cotización: correos (.msg, .eml) y Office (.docx, .xlsx,
--      .doc, .xls) además de PDF/PNG/JPEG, hasta 25 MB por fichero en la tabla
--      (registro_adjunto); el tope real es el parámetro cotizacion_adjuntos.max_mb
--      (15 MB). Los demás módulos siguen limitados por código a PDF/PNG/JPEG 5 MB.
--
-- Idempotente. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION pg_temp.q1_primera_vez(p_codigo TEXT, p_descripcion TEXT)
RETURNS boolean AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion) VALUES (p_codigo, p_descripcion)
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

BEGIN;

-- 1 · Validez particulares 60 días ---------------------------------------------
UPDATE parametro_sistema SET valor = '60', updated_at = now()
 WHERE categoria = 'validez_cotizacion' AND codigo = 'particular_dias' AND valor = '45';
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo, valor)
SELECT t.id, 'validez_cotizacion', 'particular_dias', 'Particulares: días de validez', 1, TRUE, '60'
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- 2 · Tipo de cliente «Interno» (15.º de la lista oficial) ----------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo, valor)
SELECT t.id, 'tipo_cliente', 'interno', 'Interno', 15, TRUE, 'PARTICULAR'
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- 3 · OT sin OC/OPI: quién la dispone (solo textos sembrados, sin pisar ediciones)
UPDATE parametro_sistema
   SET etiqueta = 'Meses para regularizar la OC/OPI de una OT sin OC/OPI (la dispone el Director; por su intermedio, el Jefe del Departamento productivo)',
       updated_at = now()
 WHERE categoria = 'ot_disposicion' AND codigo = 'meses_opi'
   AND etiqueta IN ('Meses para regularizar la OPI de una OT por disposición', 'Meses para regularizar la OPI');
UPDATE parametro_sistema
   SET etiqueta = 'Disposición del Director (por su intermedio, el Jefe del Departamento productivo), sin OC/OPI previa',
       updated_at = now()
 WHERE categoria = 'aceptacion_tipo' AND codigo = 'DISPOSICION_DIRECTOR'
   AND etiqueta IN ('Disposición del Director (sin OPI previa)', 'Disposición del Director o del Jefe de Departamento (sin OPI previa)');
UPDATE parametro_sistema
   SET etiqueta = 'Disposición del Director (por su intermedio, el Jefe del Departamento productivo)',
       updated_at = now()
 WHERE categoria = 'origen_trabajo' AND codigo = 'DISPOSICION'
   AND etiqueta IN ('Disposición del Director', 'Disposición del Director o del Jefe de Departamento');

-- 4a · Pie INN con su valor (solo si sigue vacío) -------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, x.categoria, x.codigo, x.etiqueta, '', x.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
   ('cotizacion_documento', 'horario_atencion',  'Horario de atención a clientes',     1),
   ('cotizacion_documento', 'telefono_reclamos', 'Teléfono de reclamos y sugerencias', 2)
 ) AS x(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
UPDATE parametro_sistema
   SET valor = 'lunes a jueves 09:00–12:00 y 14:00–16:00; viernes 09:00–12:00', updated_at = now()
 WHERE categoria = 'cotizacion_documento' AND codigo = 'horario_atencion' AND coalesce(trim(valor), '') = '';
UPDATE parametro_sistema
   SET valor = '(56 2) 2252 7800 / 7803', updated_at = now()
 WHERE categoria = 'cotizacion_documento' AND codigo = 'telefono_reclamos' AND coalesce(trim(valor), '') = '';

-- 4b · Plantilla «Cotización» versión 3 ----------------------------------------
-- md5 de la versión 2 (CUERPO_COTIZACION_FORM04_V2, align_cuarto_envio_cotizacion.sql): 5f066e0628d6df181e5ed0e9a0496d73
-- md5 de la versión 3: cc4e0b440a6ee7c68b0dc4d47fac59fe
DO $do$
DECLARE
  v_v2    CONSTANT TEXT := '5f066e0628d6df181e5ed0e9a0496d73';
  v_v3    TEXT := replace($form04v3$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Cotización comercial</span>
  </div>
  <div class="doc">
    <b>{{cotizacion.codigo}}</b>
    <span>Cotización</span>
  </div>
</div>

<h1>COTIZACIÓN</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razon_social}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Código</th><td>{{cotizacion.codigo}}</td><th>Fecha</th><td>{{cotizacion.fecha}}</td></tr>
  <tr><th>Forma de pago</th><td>{{cotizacion.forma_pago}}</td><th>Validez</th><td>{{cotizacion.validez}}</td></tr>
  {{#si cotizacion.referencia}}<tr><th>Referencia</th><td colspan="3">{{cotizacion.referencia}}</td></tr>{{/si}}
  {{#si cotizacion.plazo_entrega_dias}}<tr><th>Plazo de entrega</th><td colspan="3">{{cotizacion.plazo_entrega_dias}} días hábiles desde la recepción de las muestras o ítems</td></tr>{{/si}}
  {{#si cotizacion.es_usd}}<tr><th>Moneda</th><td>US$</td><th>Dólar del día</th><td>{{cotizacion.dolar_texto}}</td></tr>{{/si}}
</table>

{{#si cotizacion.descripcion_tecnica}}<h2>Descripción técnica y alcance</h2>{{descripcion_tecnica_parrafos}}{{/si}}

<h2>Detalle</h2>
<table class="rep">
  <thead>
    <tr><th>#</th><th>Ensayo / descripción</th><th class="num">Cantidad</th><th class="num">P. unitario</th><th class="num">Subtotal</th></tr>
  </thead>
  <tbody>
    {{filas_detalle}}
  </tbody>
</table>

<h2>Totales</h2>
<table class="meta">
  <tr><th>Subtotal</th><td>{{totales.subtotal}}</td><th>Neto</th><td>{{totales.neto}}</td></tr>
  <tr><th>IVA</th><td>{{totales.iva}}</td><th>TOTAL</th><td>{{totales.total}}</td></tr>
</table>

{{#si cotizacion.condiciones_adicionales}}<h2>Condiciones adicionales</h2>{{condiciones_adicionales_parrafos}}{{/si}}

<h2>Notas</h2>
<ul>
  <li>Los tiempos de ensayo y disponibilidad para efectuar el trabajo solicitado son estimados.</li>
  <li>El plazo definitivo para la entrega de los informes se establecerá una vez que se reciba la orden de compra.</li>
  <li>Las muestras podrán ser recepcionadas solo cuando sea emitida la Orden de Trabajo por el Departamento Comercial del IDIC, previa coordinación con el laboratorio para el inicio de los ensayos.</li>
  <li>Una vez finalizado el ensayo, las muestras deben ser retiradas antes de 1 mes; de lo contrario, serán eliminadas.</li>
  <li>La identificación de las muestras debe ser entregada por el cliente por correo electrónico.</li>
  {{#si cotizacion.con_iva}}<li>El total a pagar por el servicio incluye IVA, en atención a la entrada en vigencia desde el 01 de enero de 2023 de la Ley 21.420.</li>{{/si}}
</ul>

<p><b>IMPORTANTE: SEÑALAR EN LA ORDEN DE COMPRA EL Nº DE ESTA COTIZACIÓN ({{cotizacion.codigo}}).</b></p>

<h2>Confidencialidad</h2>
<p>El Instituto de Investigaciones y Control (IDIC) mantiene la confidencialidad de toda la información que obtiene y genera durante la realización de sus actividades. Esa información no está disponible para el público. Si la ley obliga al IDIC a revelar información confidencial, se notificará al cliente la información entregada, salvo que la ley lo prohíba.</p>

<p class="nota">Documento generado por el sistema LIMS IDIC. Los valores están expresados en {{cotizacion.moneda_texto}}.</p>
<div class="pie-cada-hoja">{{#si idic.horario_atencion}}<p class="nota">Horario de Atención a Clientes: {{idic.horario_atencion}}</p>{{/si}}{{#si idic.telefono_reclamos}}<p class="nota">Reclamos y sugerencias: {{idic.telefono_reclamos}}</p>{{/si}}</div>$form04v3$, chr(13) || chr(10), chr(10));
  r       RECORD;
  n       INTEGER := 0;
BEGIN
  IF NOT pg_temp.q1_primera_vez('q1_cotizacion_plantilla_v3',
       'Quinto envío IDIC 21-11-2026: plantilla DCO-FORM04 versión 3 (días hábiles y pie INN en cada hoja)') THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT p.id, p.tenant_id, p.cuerpo_html
      FROM plantilla_informe p
     WHERE p.tipo = 'COTIZACION' AND p.deleted_at IS NULL
  LOOP
    IF r.cuerpo_html IS NOT NULL AND md5(r.cuerpo_html) = v_v2 THEN
      UPDATE plantilla_informe SET cuerpo_html = v_v3 WHERE id = r.id;
      n := n + 1;
    ELSIF r.cuerpo_html IS DISTINCT FROM v_v3 THEN
      RAISE NOTICE 'Plantilla de cotización % (tenant %): no es la versión 2 sin editar; NO se aplica la versión 3. Cambie a mano «días corridos» por «días hábiles» y envuelva el horario y los reclamos en <div class="pie-cada-hoja"> en una versión nueva.', r.id, r.tenant_id;
    END IF;
  END LOOP;
  IF n > 0 THEN
    PERFORM plantilla_sincronizar_versiones();
    UPDATE plantilla_informe_version v
       SET motivo = 'Respuesta IDIC quinto envío 21-11-2026 (§4.1): plazo en días hábiles (IDIC-PG03 Rev18) y pie INN (horario y reclamos) en cada hoja.'
      FROM plantilla_informe p
     WHERE p.id = v.plantilla_id AND p.tipo = 'COTIZACION' AND v.estado = 'VIGENTE' AND v.origen = 'script'
       AND v.cuerpo_html = v_v3;
  END IF;
END
$do$;

-- 5a · registro_adjunto: correos y Office, hasta 25 MB --------------------------
-- Los CHECK originales (align_r4b_saec.sql) no tienen nombre: se buscan y se quitan.
DO $do$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'registro_adjunto'::regclass AND con.contype = 'c'
       AND con.conname NOT IN ('ck_registro_adjunto_mime', 'ck_registro_adjunto_bytes')
       AND (pg_get_constraintdef(con.oid) ILIKE '%mime%' OR pg_get_constraintdef(con.oid) ILIKE '%bytes%')
  LOOP
    EXECUTE format('ALTER TABLE registro_adjunto DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$do$;
ALTER TABLE registro_adjunto ALTER COLUMN mime TYPE VARCHAR(100);
ALTER TABLE registro_adjunto DROP CONSTRAINT IF EXISTS ck_registro_adjunto_mime;
ALTER TABLE registro_adjunto ADD CONSTRAINT ck_registro_adjunto_mime CHECK (mime IN (
  'application/pdf', 'image/png', 'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-outlook', 'message/rfc822'));
ALTER TABLE registro_adjunto DROP CONSTRAINT IF EXISTS ck_registro_adjunto_bytes;
ALTER TABLE registro_adjunto ADD CONSTRAINT ck_registro_adjunto_bytes CHECK (bytes > 0 AND bytes <= 26214400);
COMMENT ON TABLE registro_adjunto IS 'Adjuntos de un registro: peritaje SAEC, prototipo BPCH, ensayo IT23 (PDF/PNG/JPEG, 5 MB) y cotización (además correos .msg/.eml y Office; tope en cotizacion_adjuntos.max_mb, máx. 25 MB). El tipo se valida por sus bytes.';

-- 5b · Tope de los adjuntos de la cotización (Administración › Parámetros) ------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, 1, TRUE, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('cotizacion_adjuntos', 'max_mb', 'Tamaño máximo de cada adjunto de la cotización (MB)', '15')
 ) AS v(categoria, codigo, etiqueta, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

COMMIT;

-- Verificación:
-- SELECT categoria, codigo, etiqueta, valor FROM parametro_sistema
--  WHERE (categoria, codigo) IN (('validez_cotizacion','particular_dias'), ('tipo_cliente','interno'),
--        ('ot_disposicion','meses_opi'), ('cotizacion_documento','horario_atencion'),
--        ('cotizacion_documento','telefono_reclamos'), ('cotizacion_adjuntos','max_mb'));
-- SELECT p.repid, v.numero, v.estado, md5(v.cuerpo_html) FROM plantilla_informe p
--   JOIN plantilla_informe_version v ON v.plantilla_id = p.id WHERE p.tipo = 'COTIZACION' ORDER BY v.numero;
