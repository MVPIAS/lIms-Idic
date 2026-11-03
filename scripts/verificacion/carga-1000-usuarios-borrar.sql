-- Borra los usuarios de la prueba de capacidad (carga-1000-usuarios.sql).
DELETE FROM usuario_rol WHERE usuario_id IN (SELECT id FROM usuario WHERE username LIKE 'prueba.carga.%');
UPDATE usuario SET deleted_at = now(), estado = 'inactivo' WHERE username LIKE 'prueba.carga.%' AND deleted_at IS NULL;
