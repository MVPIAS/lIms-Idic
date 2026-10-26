-- =============================================================================
-- LIMS IDIC · Frente f6 · Semilla de DEMOSTRACIÓN (solo modo demo) · Aiuken
-- =============================================================================
-- Una lista de precios de ejemplo en USD, para ver en preproducción que el
-- precio conserva la moneda de su lista: una cotización en USD toma estos
-- dólares tal cual (sin convertirlos con el dólar del día) y una en CLP sigue
-- tomando la lista oficial en pesos. Los precios son de ejemplo (no son del
-- IDIC). Enlaza dos servicios de Metrología que también están en la lista
-- oficial en CLP (LP-2026). Idempotente.
-- =============================================================================
INSERT INTO lista_precio (tenant_id, codigo, nombre, moneda, vigente_desde, vigente_hasta, activa, fuente)
SELECT t.id, 'DEMO-USD-2026', 'Lista de ejemplo en USD (demostración)', 'USD', DATE '2026-01-01', DATE '2026-12-31', TRUE,
       'Ejemplo de demostración de una lista en dólares (frente f6)'
  FROM tenant t
 WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

INSERT INTO lista_precio_item (lista_precio_id, codigo, descripcion, tipo, precio, costo_total, neto, cat_ensayo_id, enlace)
SELECT lp.id, v.codigo, ce.nombre, 'servicio', v.neto, v.ct, v.neto, ce.id, 'codigo'
  FROM lista_precio lp
  JOIN tenant t ON t.id = lp.tenant_id AND t.codigo = 'IDIC'
 CROSS JOIN (VALUES ('EN1074', 150.00, 115.38),
                    ('EN1075', 250.50, 192.69)) AS v(codigo, neto, ct)
  JOIN cat_ensayo ce ON ce.tenant_id = t.id AND ce.codigo = v.codigo AND ce.deleted_at IS NULL
 WHERE lp.codigo = 'DEMO-USD-2026'
   AND NOT EXISTS (SELECT 1 FROM lista_precio_item i WHERE i.lista_precio_id = lp.id AND i.codigo = v.codigo);
