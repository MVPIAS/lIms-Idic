-- =============================================================================
-- LIMS IDIC · Frente f5 · Semilla de DEMOSTRACIÓN (solo modo demo) · Aiuken
-- =============================================================================
-- Una lista de precios de ejemplo en UF, como las que traerá la migración del
-- Sistema Comercial antiguo, para ver en preproducción cómo se muestra un dato
-- en moneda histórica: tal cual, sin convertir y de solo lectura. Los nombres y
-- precios son de ejemplo (no son del IDIC). Idempotente.
-- Se carga como la migración: SET lims.migracion = 'on' (align_f5_correcciones.sql).
-- =============================================================================
SET lims.migracion = 'on';

INSERT INTO lista_precio (tenant_id, codigo, nombre, moneda, vigente_desde, vigente_hasta, activa, fuente)
SELECT t.id, 'DEMO-UF-2019', 'Lista de ejemplo en UF (histórica, demostración)', 'UF', DATE '2019-01-01', DATE '2019-12-31', TRUE,
       'Ejemplo de demostración de una lista migrada en UF (frente f5)'
  FROM tenant t
 WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

INSERT INTO lista_precio_item (lista_precio_id, codigo, descripcion, tipo, precio)
SELECT lp.id, v.codigo, v.descripcion, 'servicio', v.precio
  FROM lista_precio lp
  JOIN tenant t ON t.id = lp.tenant_id AND t.codigo = 'IDIC'
 CROSS JOIN (VALUES ('UF-001', 'Servicio de ejemplo 1 (UF)', 2.50),
                    ('UF-002', 'Servicio de ejemplo 2 (UF)', 4.75)) AS v(codigo, descripcion, precio)
 WHERE lp.codigo = 'DEMO-UF-2019'
   AND NOT EXISTS (SELECT 1 FROM lista_precio_item i WHERE i.lista_precio_id = lp.id AND i.codigo = v.codigo);

RESET lims.migracion;
