-- =============================================================================
-- Correcciones v30 · comunicación (mensajería, avisos e historial del cliente).
--   · correo_enviado.mensaje_id: la copia por correo de un mensaje interno
--     queda ligada a su mensaje; en el historial de correos solo la ven su
--     remitente y sus destinatarios (mensajeria/alcance-correo.ts).
--   · Índice de las próximas acciones del CRM con fecha: la revisión horaria
--     de avisos (avisos.service.ts) avisa al responsable cuando llega la fecha.
-- Idempotente.
-- =============================================================================

ALTER TABLE correo_enviado ADD COLUMN IF NOT EXISTS mensaje_id UUID REFERENCES mensaje(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_correo_enviado_mensaje ON correo_enviado (mensaje_id) WHERE mensaje_id IS NOT NULL;

-- Copias anteriores a esta corrección: se ligan a su mensaje por remitente,
-- asunto («Mensaje interno · <asunto>») y hora de envío (mismo minuto).
UPDATE correo_enviado ce
   SET mensaje_id = m.id
  FROM mensaje m
 WHERE ce.tipo = 'mensaje' AND ce.mensaje_id IS NULL
   AND m.tenant_id = ce.tenant_id
   AND m.remitente_id = ce.enviado_por
   AND ce.asunto LIKE '%Mensaje interno · ' || m.asunto
   AND abs(extract(epoch FROM (ce.created_at - m.created_at))) < 60;

CREATE INDEX IF NOT EXISTS ix_cliente_interaccion_proxima
    ON cliente_interaccion (tenant_id, proxima_fecha)
 WHERE deleted_at IS NULL AND proxima_fecha IS NOT NULL;
