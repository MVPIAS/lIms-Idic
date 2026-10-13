-- =============================================================================
-- align_accesos_demo.sql · Marca de «usuario de prueba» · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE. Solo añade la columna `usuario.es_demo`.
--
-- Un usuario de prueba (es_demo = true) NO tiene contraseña propia. Solo puede
-- entrar cuando el servidor declara las dos variables:
--     ACCESOS_DEMO=true
--     ACCESOS_DEMO_CLAVE=<clave compartida, mínimo 8 caracteres>
-- Sin ellas el usuario existe pero es inerte: el ingreso responde «Usuario sin
-- contraseña configurada». En el servidor del IDIC esas variables no se
-- definen y, además, los usuarios de prueba no se siembran (el seed que los
-- crea lleva la etiqueta `demo` en ORDEN_SQL.txt).
--
-- Detalle de uso en docs/ACCESOS_DEMO.md.
-- =============================================================================

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS es_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_usuario_es_demo ON usuario (tenant_id) WHERE es_demo;

COMMENT ON COLUMN usuario.es_demo IS
  'Usuario de prueba por perfil. Sin contraseña propia: solo entra si el servidor define ACCESOS_DEMO y ACCESOS_DEMO_CLAVE.';
