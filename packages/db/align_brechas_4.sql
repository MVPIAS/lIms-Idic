-- =============================================================================
-- LIMS IDIC · Cierre de brechas del contrato · 4 · Aiuken
-- =============================================================================
--  1 · 4.6.8 · Diseño propio de la COTIZACIÓN. El formato DCO FORM04
--      (DCO-PG01-P01-IT02-FORM04) pasa al repositorio de plantillas con
--      versiones (align_plantilla_versiones.sql): plantilla de tipo COTIZACION,
--      REPID DCO-FORM04, cuya versión 1 VIGENTE reproduce EXACTAMENTE el
--      formato que estaba fijo en el código (apps/api/src/cotizacion/
--      plantilla-cotizacion.ts; el spec comprueba que este cuerpo y el del código
--      son el mismo). Editarla crea un borrador que aprueba Calidad (plantilla.aprobar)
--      como cualquier plantilla de informe. Si la vigente falla al rendir, la
--      cotización sale con la vigente anterior.
--      Una plantilla por tenant; no se pisa si ya existe (las versiones nuevas
--      se hacen en la pantalla).
--  2 · 4.1.5 / 4.3.1 / 4.5.1 · Diseñador de flujos como módulo aparte: Gestión
--      de Calidad diseña, publica y simula flujos (flujo.editar, flujo.publicar),
--      igual que Administración. Los circuitos operativos de los laboratorios no
--      cambian (Matriz de firmas y pasos por método).
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt), que vuelve
-- a sincronizar las versiones de plantilla.
-- =============================================================================
BEGIN;

-- 1 · Plantilla «Cotización» (FORM04) ------------------------------------------
INSERT INTO plantilla_informe (tenant_id, repid, nombre, tipo, emision, activo, version, cuerpo_html)
SELECT t.id, 'DCO-FORM04', 'Cotización comercial (DCO-PG01-P01-IT02-FORM04)', 'COTIZACION', 'individual', true, 'v1',
       replace($form04$
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

<p class="nota">Documento generado por el sistema LIMS IDIC. Los valores están expresados en {{cotizacion.moneda_texto}}.</p>$form04$, chr(13) || chr(10), chr(10))
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM plantilla_informe p WHERE p.tenant_id = t.id AND p.tipo = 'COTIZACION')
ON CONFLICT (tenant_id, repid, nombre) DO NOTHING;

-- Su versión 1 VIGENTE (origen «migracion»), como las demás plantillas.
SELECT plantilla_sincronizar_versiones();

UPDATE plantilla_informe_version v
   SET motivo = 'Versión inicial: formato DCO FORM04 vigente hasta ahora (idéntico al que generaba el sistema).'
  FROM plantilla_informe p
 WHERE p.id = v.plantilla_id AND p.tipo = 'COTIZACION' AND v.numero = 1 AND v.origen = 'migracion'
   AND v.motivo IS DISTINCT FROM 'Versión inicial: formato DCO FORM04 vigente hasta ahora (idéntico al que generaba el sistema).';

-- 2 · Diseñador de flujos: Gestión de Calidad diseña y publica ------------------
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo IN ('flujo.ver', 'flujo.editar', 'flujo.publicar')
 WHERE COALESCE(r.alias_de, r.codigo) IN ('CALIDAD', 'ADMIN')
ON CONFLICT DO NOTHING;

COMMIT;

-- Verificación:
-- SELECT p.repid, v.numero, v.estado, length(v.cuerpo_html) FROM plantilla_informe p
--   JOIN plantilla_informe_version v ON v.plantilla_id = p.id WHERE p.tipo = 'COTIZACION';
-- SELECT r.codigo, string_agg(p.codigo, ', ') FROM rol_permiso rp JOIN rol r ON r.id = rp.rol_id
--   JOIN permiso p ON p.id = rp.permiso_id WHERE p.codigo LIKE 'flujo.%' GROUP BY r.codigo;
