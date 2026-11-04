-- =============================================================================
-- LIMS IDIC · Brechas 5 · Contrato §4.7.4 (API REST documentada e integración)
-- =============================================================================
-- Tokens de INTEGRACIÓN (cuentas de servicio) para que otro sistema use la API
-- con `Authorization: Bearer <token>`. No confundir con los tokens de DISPOSITIVO
-- de los instrumentos (otra tabla y otros permisos).
--
--   · Cada token tiene su propia cuenta de servicio (`usuario` con estado
--     'servicio': no puede iniciar sesión en la web) con UN rol asignado; el
--     token actúa con los permisos y el alcance de ese rol.
--   · Solo se guarda el hash SHA-256 del token: se muestra una sola vez al crearlo.
--   · Expira siempre (fecha obligatoria) y se puede revocar; se registra el
--     último uso (fecha, IP y número de usos) y cada uso queda en audit_log.
--
-- Permisos:
--   integracion.tokens         crear / revocar tokens (Administración › API e integración)
--   integracion.documentacion  ver la documentación de la API (los tokens de
--                              integración la reciben siempre)
-- Parámetro: integracion.auditar_lecturas (Sí/No, por defecto Sí).
-- Idempotente (IF NOT EXISTS, ON CONFLICT).
-- =============================================================================

CREATE TABLE IF NOT EXISTS token_integracion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  nombre           varchar(120) NOT NULL,
  descripcion      text,
  -- Cuenta de servicio con la que actúa el token (estado 'servicio').
  usuario_id       uuid NOT NULL REFERENCES usuario(id),
  rol_id           uuid NOT NULL REFERENCES rol(id),
  unidad_id        uuid REFERENCES unidad(id),
  -- SHA-256 (hex) del token completo; el token en claro no se guarda.
  token_hash       char(64) NOT NULL,
  -- Últimos caracteres del token, para reconocerlo en la lista.
  sufijo           varchar(12) NOT NULL,
  expira_at        timestamptz NOT NULL,
  ultimo_uso_at    timestamptz,
  ultimo_uso_ip    inet,
  usos             bigint NOT NULL DEFAULT 0,
  creado_por       uuid REFERENCES usuario(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  revocado_at      timestamptz,
  revocado_por     uuid REFERENCES usuario(id),
  motivo_revocacion text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_token_integracion_hash ON token_integracion (token_hash);
CREATE INDEX IF NOT EXISTS ix_token_integracion_tenant ON token_integracion (tenant_id, created_at DESC);

COMMENT ON TABLE token_integracion IS
  'Tokens de integración (cuentas de servicio) de la API REST · contrato §4.7.4. Solo hash; se muestran una vez.';

-- --------------------------------------------------------------- permisos ---
INSERT INTO permiso (codigo, modulo, accion, descripcion) VALUES
  ('integracion.tokens', 'admin', 'tokens',
   'Crear y revocar tokens de integración (cuentas de servicio) para que otros sistemas usen la API'),
  ('integracion.documentacion', 'admin', 'documentacion',
   'Ver la documentación de la API REST (especificación OpenAPI)')
ON CONFLICT (codigo) DO NOTHING;

-- Administración del sistema: ambos permisos (SUPERADMIN pasa siempre y además
-- los recibe en align_cierre_permisos.sql).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo IN ('integracion.tokens', 'integracion.documentacion')
 WHERE COALESCE(r.alias_de, r.codigo) IN ('ADMIN', 'SUPERADMIN')
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------- parámetro ---
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, 'integracion', 'auditar_lecturas',
       'Registrar en la bitácora también las consultas (GET) hechas con token de integración', 'si', 1
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
