-- =============================================================================
-- align_rbac_comercial_catalogo.sql · COMERCIAL puede LEER el catálogo
-- -----------------------------------------------------------------------------
-- Hallazgo de las pruebas por roles (PRUEBAS_RBAC_POR_ROLES.md): el rol COMERCIAL
-- no podía leer /cat/* ni /cascada/* porque la lectura del catálogo exige
-- `muestra.ver`, permiso que COMERCIAL no tenía. COMERCIAL necesita navegar
-- Elementos/Ensayos/Familias para armar cotizaciones y el costeo por estimación
-- (que referencia cat_elemento/cat_ensayo/cat_familia).
--
-- Fix aditivo, reversible (solo concede lectura), idempotente. Aprobado por el
-- usuario. Multi-tenant IDIC (mismo patrón que align_rbac.sql).
-- =============================================================================

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM (VALUES ('COMERCIAL','muestra.ver')) AS m(rol_cod, perm_cod)
JOIN rol r     ON r.codigo = m.rol_cod
              AND r.tenant_id = (SELECT id FROM tenant WHERE codigo='IDIC')
JOIN permiso p ON p.codigo = m.perm_cod
ON CONFLICT DO NOTHING;
