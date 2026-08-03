-- =============================================================================
-- align_rbac_tecnico.sql · El TÉCNICO de laboratorio debe poder CAPTURAR
-- resultados (resultado.crear) y ver los métodos que ejecuta (metodo.ver).
-- Idempotente (ON CONFLICT DO NOTHING). Aiuken · LIMS IDIC.
-- =============================================================================
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM (VALUES
  ('TECNICO','resultado.crear'),
  ('TECNICO','metodo.ver')
) AS m(rol_cod, perm_cod)
JOIN rol r     ON r.codigo = m.rol_cod
JOIN permiso p ON p.codigo = m.perm_cod
ON CONFLICT DO NOTHING;
