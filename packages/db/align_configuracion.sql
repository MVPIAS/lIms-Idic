-- =============================================================================
-- align_configuracion.sql · Zona de configuración de administrador
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente (se puede re-aplicar sin efectos secundarios).
--
-- Habilita la CONFIGURACIÓN DE CORREO SMTP del sistema, primer eslabón del
-- futuro módulo de mensajería (avisos de cotización / resultados).
--
-- CONTEXTO ON-PREMISE: el servidor del IDIC irá SIN salida a internet. El campo
-- `host` NO apunta a un SMTP público (Gmail/O365/SendGrid); apunta al RELAY SMTP
-- INSTITUCIONAL del IDIC, alcanzable dentro de la LAN (p.ej. smtp.idic.local:25
-- o :587). La app solo necesita conectividad de red interna hacia ese relay.
--
-- Una fila por tenant (IDIC es mono-tenant, pero el modelo se mantiene aislado
-- por tenant como el resto del esquema). `password_cifrada` guarda la clave del
-- buzón/relay; la API nunca la re-expone en los GET (se enmascara).
-- =============================================================================

CREATE TABLE IF NOT EXISTS configuracion_correo (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  host              VARCHAR(255),
  puerto            INTEGER     NOT NULL DEFAULT 587,
  -- 'none' | 'starttls' | 'tls'
  seguridad         VARCHAR(16) NOT NULL DEFAULT 'starttls',
  usuario           VARCHAR(255),
  -- Clave del relay/buzón. No se devuelve nunca en los GET (se enmascara a ***).
  password_cifrada  TEXT,
  remitente_nombre  VARCHAR(200),
  remitente_email   VARCHAR(255),
  activo            BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una única configuración de correo por tenant (upsert por tenant_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_configuracion_correo_tenant
  ON configuracion_correo (tenant_id);

COMMENT ON TABLE configuracion_correo IS
  'Configuración SMTP del sistema (relay interno del IDIC en la LAN, sin internet). Habilitador del módulo de mensajería.';
COMMENT ON COLUMN configuracion_correo.seguridad IS
  'Modo de cifrado del transporte SMTP: none | starttls | tls.';
COMMENT ON COLUMN configuracion_correo.password_cifrada IS
  'Clave del relay/buzón SMTP. La API no la re-expone en los GET (se enmascara).';
