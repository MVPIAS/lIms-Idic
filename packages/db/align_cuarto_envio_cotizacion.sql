-- =============================================================================
-- align_cuarto_envio_cotizacion.sql · Respuestas del IDIC, cuarto envío (18-11-2026)
-- -----------------------------------------------------------------------------
-- Cotización particular (análisis del cuarto envío §3.6): textos estándar del
-- documento de la cotización, como los imprime el sistema comercial actual.
--
--  1 · Plantilla «Cotización» (DCO-FORM04) · versión 2: la versión 1 más el
--      bloque «Notas» (tiempos estimados, plazo definitivo con la OC, recepción
--      de muestras con la OT emitida, retiro antes de 1 mes, identificación por
--      correo, Ley 21.420 solo si la cotización lleva IVA), el «IMPORTANTE:
--      señalar en la OC el Nº de esta cotización», la cláusula de
--      confidencialidad y el pie con el horario de atención y el teléfono de
--      reclamos (parámetros nuevos; vacíos = no se imprimen). El cuerpo es
--      CUERPO_COTIZACION_FORM04_V2 de apps/api/src/cotizacion/
--      plantilla-cotizacion.ts (el spec comprueba que es el mismo).
--      Se aplica UNA sola vez (sql_paso_aplicado) y SOLO si la plantilla
--      guardada sigue siendo la versión 1 sin editar (md5). Si el IDIC ya la
--      editó desde Administración › Plantillas, no se toca y queda un NOTICE:
--      los textos se agregan a mano en una versión nueva.
--  2 · Parámetros `cotizacion_documento.horario_atencion` y
--      `.telefono_reclamos` (Administración › Parámetros del sistema ›
--      «Documento de la cotización»): se crean VACÍOS, sin datos reales; el
--      IDIC los completa.
--
-- No cambia «días corridos» ni la presentación del IVA (pendientes del IDIC).
-- Idempotente. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION pg_temp.ce_primera_vez(p_codigo TEXT, p_descripcion TEXT)
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

-- 1 · Plantilla «Cotización» versión 2 -----------------------------------------
-- md5 de la versión 1 (CUERPO_COTIZACION_FORM04, align_brechas_4.sql): f122ba59844c0edaf1530e39cabfea9a
DO $do$
DECLARE
  v_v1    CONSTANT TEXT := 'f122ba59844c0edaf1530e39cabfea9a';
  v_v2    TEXT := replace($form04v2$
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
  {{#si cotizacion.plazo_entrega_dias}}<tr><th>Plazo de entrega</th><td colspan="3">{{cotizacion.plazo_entrega_dias}} días corridos desde la recepción de las muestras o ítems</td></tr>{{/si}}
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
{{#si idic.horario_atencion}}<p class="nota">Horario de atención a clientes: {{idic.horario_atencion}}</p>{{/si}}
{{#si idic.telefono_reclamos}}<p class="nota">Reclamos y sugerencias: {{idic.telefono_reclamos}}</p>{{/si}}$form04v2$, chr(13) || chr(10), chr(10));
  r       RECORD;
  n       INTEGER := 0;
BEGIN
  IF NOT pg_temp.ce_primera_vez('cuarto_envio_cotizacion_textos_v2',
       'Cuarto envío IDIC 18-11-2026: textos estándar de la cotización (plantilla DCO-FORM04 versión 2)') THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT p.id, p.tenant_id, p.cuerpo_html
      FROM plantilla_informe p
     WHERE p.tipo = 'COTIZACION' AND p.deleted_at IS NULL
  LOOP
    IF r.cuerpo_html IS NOT NULL AND md5(r.cuerpo_html) = v_v1 THEN
      UPDATE plantilla_informe SET cuerpo_html = v_v2 WHERE id = r.id;
      n := n + 1;
    ELSIF r.cuerpo_html IS DISTINCT FROM v_v2 THEN
      RAISE NOTICE 'Plantilla de cotización % (tenant %): ya fue editada desde Administración; NO se agregan los textos estándar del cuarto envío. Agréguelos en una versión nueva (variables cotizacion.con_iva, idic.horario_atencion, idic.telefono_reclamos).', r.id, r.tenant_id;
    END IF;
  END LOOP;
  -- La vigente pasa a RETIRADA y nace la versión 2 VIGENTE (origen «script»).
  IF n > 0 THEN
    PERFORM plantilla_sincronizar_versiones();
    UPDATE plantilla_informe_version v
       SET motivo = 'Respuesta IDIC cuarto envío 18-11-2026 (§3.6): textos estándar de la cotización (notas, Ley 21.420, Nº en la OC, confidencialidad, horario y reclamos).'
      FROM plantilla_informe p
     WHERE p.id = v.plantilla_id AND p.tipo = 'COTIZACION' AND v.estado = 'VIGENTE' AND v.origen = 'script'
       AND v.cuerpo_html = v_v2;
  END IF;
END
$do$;

-- 2 · Parámetros del pie (vacíos; los completa el IDIC) -----------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, x.categoria, x.codigo, x.etiqueta, '', x.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
   ('cotizacion_documento', 'horario_atencion',  'Horario de atención a clientes',     1),
   ('cotizacion_documento', 'telefono_reclamos', 'Teléfono de reclamos y sugerencias', 2)
 ) AS x(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

COMMIT;

-- Verificación:
-- SELECT p.repid, v.numero, v.estado, v.origen, md5(v.cuerpo_html) FROM plantilla_informe p
--   JOIN plantilla_informe_version v ON v.plantilla_id = p.id WHERE p.tipo = 'COTIZACION' ORDER BY v.numero;
-- SELECT codigo, valor FROM parametro_sistema WHERE categoria = 'cotizacion_documento';
