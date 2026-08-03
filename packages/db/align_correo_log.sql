-- =============================================================================
-- align_correo_log.sql · Registro de correos enviados (módulo MENSAJERÍA)
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente (se puede re-aplicar sin efectos secundarios).
--
-- Da soporte al MÓDULO DE MENSAJERÍA TRANSACCIONAL (contrato §4.5.4 / §4.5.5 /
-- §4.5.6 y alertas §4.2.6): envío de la cotización con su PDF adjunto y
-- notificación del resultado/validación de una OT al cliente/responsables,
-- reutilizando el MailService de ConfiguracionModule (relay SMTP del tenant).
--
-- Esta tabla es la BITÁCORA de todo correo de negocio: qué se envió, a quién,
-- con qué plantilla, si salió o falló (y por qué). Es la base del "registro de
-- correos enviados con búsqueda" del historial.
--
-- AUTOCONTENIDO A PROPÓSITO (mismo criterio que saec.sql): la base desplegada se
-- genera con Prisma, NO con schema.sql. Por eso:
--   · se garantiza aquí la función set_updated_at() no es necesaria (la tabla es
--     append-only: no tiene updated_at);
--   · solo se referencian tablas presentes en la base Prisma: tenant, usuario,
--     orden_trabajo y cotizacion.
--
-- NO toca schema.prisma: el módulo de mensajería accede a esta tabla con SQL
-- crudo parametrizado ($queryRawUnsafe), igual que hace saec, para no chocar con
-- otros agentes que editan el modelo Prisma.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS correo_enviado (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  -- Tipo de correo de negocio: 'cotizacion' | 'resultado' | 'otro'.
  tipo              VARCHAR(20) NOT NULL DEFAULT 'otro',
  -- Lista de destinatarios tal como se envió (uno o varios, separados por coma).
  destinatarios     TEXT        NOT NULL,
  asunto            VARCHAR(300),
  -- Resumen/extracto del cuerpo (no se guarda el HTML completo del correo).
  cuerpo_resumen    TEXT,
  -- Clave de la plantilla predefinida usada (p.ej. 'cotizacion_estandar').
  plantilla         VARCHAR(60),
  -- Enlaces opcionales con el documento de negocio que originó el correo.
  ot_id             UUID        REFERENCES orden_trabajo(id),
  cotizacion_id     UUID        REFERENCES cotizacion(id),
  -- Resultado del envío: 'enviado' | 'error'. Sin SMTP configurado => 'error'.
  estado            VARCHAR(20) NOT NULL DEFAULT 'enviado',
  error             TEXT,
  -- messageId devuelto por el relay SMTP cuando el envío fue correcto.
  message_id        VARCHAR(255),
  enviado_por       UUID        REFERENCES usuario(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correo_enviado_tenant       ON correo_enviado(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correo_enviado_tenant_tipo  ON correo_enviado(tenant_id, tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correo_enviado_ot           ON correo_enviado(tenant_id, ot_id)         WHERE ot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_correo_enviado_cotizacion   ON correo_enviado(tenant_id, cotizacion_id) WHERE cotizacion_id IS NOT NULL;

COMMENT ON TABLE correo_enviado IS
  'Bitácora de correos transaccionales de negocio (cotización con PDF / notificación de resultado). Base del historial con búsqueda del módulo de mensajería.';
COMMENT ON COLUMN correo_enviado.estado IS
  'Resultado del envío: enviado | error. Si no hay relay SMTP configurado/activo el correo se registra con estado error, sin tumbar la petición.';

COMMIT;

-- Verificación:
-- SELECT tipo, estado, count(*) FROM correo_enviado GROUP BY 1,2 ORDER BY 1,2;
