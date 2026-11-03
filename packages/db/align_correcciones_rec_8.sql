-- =============================================================================
-- Correcciones del recorrido de manuales · 8 · Administración y Abastecimiento
--
--   1 · Mensajes internos (mensaje.usar) para TODOS los roles internos.
--       align_comunicacion.sql los daba a quien tenía ot.ver o cliente.ver, y
--       Abastecimiento, el Operador de Metrología y el Perito SAEC quedaban
--       fuera. Nunca al Cliente externo.
--   2 · Correo (correo.enviar) para Abastecimiento: buscar sus correos en
--       «Mensajería · correo» y escribir a proveedores desde el LIMS.
--   3 · Asignaciones de rol temporales guardadas con «Desde» = 01-01-1970
--       (la API convertía el «Desde» vacío en la fecha 0). Se corrigen a la
--       fecha del arreglo, sin pasar de su «Hasta».
--
-- Idempotente. Va antes de align_cierre_permisos.sql (ORDEN_SQL.txt).
-- =============================================================================
BEGIN;

UPDATE usuario_rol
   SET vigente_desde = LEAST(now(), COALESCE(vigente_hasta, now()))
 WHERE vigente_desde < TIMESTAMPTZ '2000-01-01';

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'mensaje.usar'
 WHERE COALESCE(r.alias_de, r.codigo) <> 'CLIENTE'
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'correo.enviar'
 WHERE COALESCE(r.alias_de, r.codigo) = 'ABASTECIMIENTO'
ON CONFLICT DO NOTHING;

COMMIT;

-- Verificación:
-- SELECT r.codigo, string_agg(p.codigo, ', ') FROM rol_permiso rp JOIN rol r ON r.id = rp.rol_id
--   JOIN permiso p ON p.id = rp.permiso_id
--  WHERE p.codigo IN ('mensaje.usar', 'correo.enviar') AND r.codigo IN ('ABASTECIMIENTO', 'OPERADOR_METROLOGIA', 'PERITO_SAEC')
--  GROUP BY 1;
