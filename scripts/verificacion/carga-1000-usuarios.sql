-- =============================================================================
-- Prueba de capacidad (contrato §4.7.6: «soportar ≥ 1000 usuarios»).
-- Crea 1000 usuarios «PRUEBA carga NNNN» (prueba.carga.0001 … 1000) como
-- ANALISTA, repartidos en los laboratorios que ya tienen analistas, con
-- contraseña propia (hash argon2 de la clave de pruebas, hash-clave.js). SOLO en
-- una base de pruebas. Para borrarlos: carga-1000-usuarios-borrar.sql.
--   docker exec -i <postgres> psql -U lims -d <base> -v hash="$(node scripts/verificacion/hash-clave.js)" --     -f - < scripts/verificacion/carga-1000-usuarios.sql
-- =============================================================================
WITH t AS (SELECT tenant_id, :'hash'::text AS password_hash FROM usuario WHERE username = 'demo.admin'),
     labs AS (
       SELECT DISTINCT ur.unidad_id, row_number() OVER (ORDER BY ur.unidad_id) - 1 AS k
         FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
        WHERE r.codigo = 'ANALISTA' AND ur.unidad_id IS NOT NULL
        GROUP BY ur.unidad_id
     ),
     nuevos AS (
       INSERT INTO usuario (tenant_id, username, email, nombre_completo, password_hash, estado, cargo)
       SELECT t.tenant_id, 'prueba.carga.' || lpad(g::text, 4, '0'), 'prueba.carga.' || lpad(g::text, 4, '0') || '@prueba.invalid',
              'PRUEBA carga ' || lpad(g::text, 4, '0'), t.password_hash, 'activo', 'PRUEBA capacidad §4.7.6'
         FROM t, generate_series(1, 1000) g
       ON CONFLICT (tenant_id, username) DO NOTHING
       RETURNING id, username
     )
-- Si ya existían (repetición), se les deja la contraseña de esta corrida.
INSERT INTO usuario_rol (usuario_id, rol_id, unidad_id)
SELECT n.id, (SELECT r.id FROM rol r JOIN t ON r.tenant_id = t.tenant_id WHERE r.codigo = 'ANALISTA' LIMIT 1),
       (SELECT l.unidad_id FROM labs l WHERE l.k = (substr(n.username, 14)::int % (SELECT count(*) FROM labs)))
  FROM nuevos n;
UPDATE usuario SET password_hash = :'hash', deleted_at = NULL, estado = 'activo' WHERE username LIKE 'prueba.carga.%';

SELECT count(*) AS usuarios_prueba_carga FROM usuario WHERE username LIKE 'prueba.carga.%';
SELECT count(*) AS usuarios_activos_total FROM usuario WHERE estado = 'activo' AND deleted_at IS NULL;
