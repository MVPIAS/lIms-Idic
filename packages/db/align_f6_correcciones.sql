-- =============================================================================
-- LIMS IDIC · Frente f6 · Correcciones (moneda de las listas y su lectura) · Aiuken
-- =============================================================================
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql (ORDEN_SQL.txt).
--
-- 1 · El precio conserva la moneda de su lista (apps/api/src/lista-precio/precio-lista.ts):
--   la cotización ya no toma el neto de una lista en USD como si fueran pesos.
--   Es una regla de la API; no cambia el esquema. No hay tipo de cambio de la
--   operación: una cotización en CLP con un ensayo que solo está en una lista
--   en USD se bloquea con un mensaje (decisión del IDIC pendiente). La semilla
--   de demostración (seed_f6_demo.sql) trae una lista en USD.
--
-- 2 · Listas de precio con permiso de lectura propio: lista_precio.ver.
--   Antes se leían con cotizacion.ver, así que Calidad, que las mantiene con
--   catalogo.gestionar (alcance global), no las veía en pantalla; y darle
--   cotizacion.ver le abriría las cotizaciones de los clientes. Mismo patrón
--   que tarifa.ver (frente f5): lo tienen los roles que ya veían las listas
--   (Comercial, Planificación, Muestreo, Finanzas, Cobranza y Jefe de
--   Laboratorio, que costea el FORM05) más Calidad. Jefe de Sección y de
--   Departamento lo heredan del Jefe de Laboratorio, y Dirección,
--   Subdirección, Administración y Lector reciben todo *.ver, en
--   align_cierre_permisos.sql. El rol CLIENTE ya no las ve: la lista trae la
--   estructura de costos interna (CD, CI, CT, recargo).
-- =============================================================================

INSERT INTO permiso (codigo, modulo, accion, descripcion) VALUES
  ('lista_precio.ver', 'lista_precio', 'ver',
   'Ver las listas de precio y sus ítems con la estructura de costos (Comercial › Listas de precio). Se mantienen con catalogo.gestionar de alcance global.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('COMERCIAL'), ('PLANIFICACION'), ('MUESTREO'), ('FINANZAS'), ('COBRANZA'),
               ('JEFE_LAB'), ('CALIDAD'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'lista_precio.ver'
ON CONFLICT DO NOTHING;
