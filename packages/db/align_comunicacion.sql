-- =============================================================================
-- align_comunicacion.sql · Comunicación y CRM (contrato §4.1.2, §4.5.4–§4.5.6)
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente.
--
--   · correo_plantilla: plantillas de correo EDITABLES por etapa de la actividad
--     (cotización enviada, OT creada, muestras recibidas, documento oficial,
--     resultado, avisos internos…), con envío automático configurable por etapa
--     (§4.5.4). Las etapas automáticas al cliente nacen DESACTIVADAS: las activa
--     el IDIC desde Mensajería › Plantillas.
--   · correo_enviado: prioridad, remitente, cliente y muestra vinculados y
--     adjuntos libres (§4.5.5), para buscar por remitente, urgencia y adjuntos
--     (§4.5.6).
--   · mensaje / mensaje_destinatario / mensaje_adjunto: mensajería interna entre
--     usuarios con adjuntos y vínculo a OT, muestra, cotización o cliente (§4.5.5).
--   · cliente_interaccion: historial de interacciones del CRM (llamada, reunión,
--     correo, visita, nota) en la línea de tiempo del cliente (§4.1.2).
-- =============================================================================

BEGIN;

-- ------------------------------------------------------- plantillas (§4.5.4) ---
CREATE TABLE IF NOT EXISTS correo_plantilla (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  clave           VARCHAR(60)  NOT NULL,
  etapa           VARCHAR(40)  NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  asunto          VARCHAR(300) NOT NULL,
  cuerpo          TEXT         NOT NULL,
  -- cliente: al correo del cliente de la OT/cotización; interno: aviso interno.
  destino         VARCHAR(20)  NOT NULL DEFAULT 'cliente',
  -- Envío automático al ocurrir la etapa (solo etapas con disparador).
  automatico      BOOLEAN      NOT NULL DEFAULT FALSE,
  activa          BOOLEAN      NOT NULL DEFAULT TRUE,
  actualizado_por UUID REFERENCES usuario(id),
  actualizado_en  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ux_correo_plantilla_clave UNIQUE (tenant_id, clave),
  CONSTRAINT ck_correo_plantilla_destino CHECK (destino IN ('cliente', 'interno'))
);
CREATE INDEX IF NOT EXISTS idx_correo_plantilla_etapa ON correo_plantilla(tenant_id, etapa);
COMMENT ON TABLE correo_plantilla IS 'Plantillas de correo editables por etapa de la actividad (§4.5.4). Marcadores {{variable}} según la etapa (mensajeria/correo-plantillas.ts).';

-- Plantillas iniciales por tenant (no pisa lo que el IDIC ya editó).
INSERT INTO correo_plantilla (tenant_id, clave, etapa, nombre, asunto, cuerpo, destino, automatico)
SELECT t.id, v.clave, v.etapa, v.nombre, v.asunto, v.cuerpo, v.destino, FALSE
  FROM tenant t
 CROSS JOIN (VALUES
  ('cotizacion_estandar', 'cotizacion_enviada', 'Cotización · estándar', 'Cotización {{codigo}} · IDIC',
   E'<p>Estimado(a) <b>{{cliente}}</b>:</p>\n<p>Adjunto encontrará en formato PDF la cotización <b>{{codigo}}</b> emitida por el Instituto de Investigaciones y Control (IDIC), por un total de <b>{{total}}</b>.</p>\n<p>La cotización tiene una validez de <b>{{validez}}</b> días. Ante cualquier consulta puede responder directamente a este correo.</p>', 'cliente'),
  ('cotizacion_seguimiento', 'cotizacion_enviada', 'Cotización · recordatorio de seguimiento', 'Recordatorio · Cotización {{codigo}}',
   E'<p>Estimado(a) <b>{{cliente}}</b>:</p>\n<p>Le reenviamos, adjunta en PDF, la cotización <b>{{codigo}}</b> (total <b>{{total}}</b>) por si fuera de su interés retomarla. Su validez es de <b>{{validez}}</b> días.</p>', 'cliente'),
  ('ot_creada', 'ot_creada', 'OT creada · confirmación al cliente', 'Orden de trabajo {{codigo}} registrada · IDIC',
   E'<p>Estimado(a) <b>{{cliente}}</b>:</p>\n<p>Su solicitud quedó registrada como la orden de trabajo <b>{{codigo}}</b> el {{fecha}}, en el {{laboratorio}}.</p>\n<p>Fecha comprometida de entrega: <b>{{fecha_compromiso}}</b>.</p>', 'cliente'),
  ('muestras_recibidas', 'muestras_recibidas', 'Muestras recibidas · aviso al cliente', 'Muestras recibidas · OT {{codigo}}',
   E'<p>Estimado(a) <b>{{cliente}}</b>:</p>\n<p>Recibimos {{cantidad}} muestra(s) de la orden de trabajo <b>{{codigo}}</b> ({{muestras}}). Le avisaremos cuando el informe esté disponible.</p>', 'cliente'),
  ('documento_oficial', 'documento_oficial', 'Informe oficial · listo para entrega', 'Informe {{documento}} disponible · OT {{codigo}}',
   E'<p>Estimado(a) <b>{{cliente}}</b>:</p>\n<p>El documento <b>{{documento}}</b> de la orden de trabajo <b>{{codigo}}</b> quedó emitido con todas sus firmas el {{fecha}}. El Departamento Comercial le hará llegar el original.</p>', 'cliente'),
  ('resultado_estandar', 'resultado', 'Resultado · notificación al cliente', 'Resultado de su orden de trabajo {{codigo}}',
   E'<p>Estimado(a) <b>{{cliente}}</b>:</p>\n<p>Le informamos que la orden de trabajo <b>{{codigo}}</b> registra el siguiente estado/veredicto: <b>{{veredicto}}</b>.</p>\n<p>Puede solicitar el informe o certificado correspondiente respondiendo a este correo.</p>', 'cliente'),
  ('resultado_validado', 'resultado', 'Resultado · validado por responsable', 'Informe validado · Orden de trabajo {{codigo}}',
   E'<p>Estimado(a) <b>{{cliente}}</b>:</p>\n<p>El resultado de la orden de trabajo <b>{{codigo}}</b> ha sido <b>validado</b> por el responsable del laboratorio. Veredicto: <b>{{veredicto}}</b>.</p>', 'cliente'),
  ('aviso_interno', 'aviso_interno', 'Aviso interno · correo de Mi bandeja', 'IDIC · {{titulo}}',
   E'<p>{{mensaje}}</p>\n<p style="color:#666">Aviso automático del LIMS del Instituto de Investigaciones y Control del Ejército de Chile. Lo encuentra también en «Mi bandeja».</p>', 'interno')
 ) AS v(clave, etapa, nombre, asunto, cuerpo, destino)
ON CONFLICT (tenant_id, clave) DO NOTHING;

-- El aviso interno se envía siempre que el parámetro de avisos lo pida.
UPDATE correo_plantilla SET automatico = TRUE WHERE clave = 'aviso_interno' AND actualizado_en IS NULL;

-- ------------------------------------------- bitácora de correos (§4.5.5/6) ---
ALTER TABLE correo_enviado ADD COLUMN IF NOT EXISTS prioridad   VARCHAR(10) NOT NULL DEFAULT 'normal';
ALTER TABLE correo_enviado ADD COLUMN IF NOT EXISTS cliente_id  UUID REFERENCES cliente(id);
ALTER TABLE correo_enviado ADD COLUMN IF NOT EXISTS muestra_id  UUID REFERENCES muestra(id);
ALTER TABLE correo_enviado ADD COLUMN IF NOT EXISTS adjuntos    JSONB;
ALTER TABLE correo_enviado ADD COLUMN IF NOT EXISTS n_adjuntos  INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_correo_enviado_cliente ON correo_enviado(tenant_id, cliente_id) WHERE cliente_id IS NOT NULL;
COMMENT ON COLUMN correo_enviado.prioridad IS 'normal | alta | urgente (§4.5.6: búsqueda por urgencia).';
COMMENT ON COLUMN correo_enviado.adjuntos IS 'Nombre, tipo y tamaño de cada adjunto enviado (el PDF de la cotización o adjuntos libres).';

-- Los correos de cotización ya enviados llevaban su PDF.
UPDATE correo_enviado SET n_adjuntos = 1 WHERE tipo = 'cotizacion' AND n_adjuntos = 0 AND adjuntos IS NULL;
-- El cliente de los correos anteriores, desde su cotización u OT.
UPDATE correo_enviado ce
   SET cliente_id = COALESCE((SELECT c.cliente_id FROM cotizacion c WHERE c.id = ce.cotizacion_id),
                             (SELECT o.cliente_id FROM orden_trabajo o WHERE o.id = ce.ot_id))
 WHERE ce.cliente_id IS NULL AND (ce.cotizacion_id IS NOT NULL OR ce.ot_id IS NOT NULL);

-- ------------------------------------------------ mensajería interna (§4.5.5) ---
CREATE TABLE IF NOT EXISTS mensaje (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  remitente_id  UUID NOT NULL REFERENCES usuario(id),
  asunto        VARCHAR(200) NOT NULL,
  cuerpo        TEXT NOT NULL,
  prioridad     VARCHAR(10) NOT NULL DEFAULT 'normal',
  ot_id         UUID REFERENCES orden_trabajo(id),
  muestra_id    UUID REFERENCES muestra(id),
  cotizacion_id UUID REFERENCES cotizacion(id),
  cliente_id    UUID REFERENCES cliente(id),
  respuesta_a   UUID REFERENCES mensaje(id),
  n_adjuntos    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_mensaje_prioridad CHECK (prioridad IN ('normal', 'alta', 'urgente'))
);
CREATE INDEX IF NOT EXISTS idx_mensaje_remitente ON mensaje(tenant_id, remitente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mensaje_ot ON mensaje(ot_id) WHERE ot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mensaje_destinatario (
  mensaje_id   UUID NOT NULL REFERENCES mensaje(id) ON DELETE CASCADE,
  usuario_id   UUID NOT NULL REFERENCES usuario(id),
  leido_at     TIMESTAMPTZ,
  archivado_at TIMESTAMPTZ,
  PRIMARY KEY (mensaje_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_mensaje_dest_usuario ON mensaje_destinatario(usuario_id, leido_at);

-- Adjuntos de un mensaje interno o de un correo externo libre (base64, como el gestor documental).
CREATE TABLE IF NOT EXISTS mensaje_adjunto (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  mensaje_id  UUID REFERENCES mensaje(id) ON DELETE CASCADE,
  correo_id   UUID REFERENCES correo_enviado(id) ON DELETE CASCADE,
  nombre      VARCHAR(220) NOT NULL,
  mime        VARCHAR(120) NOT NULL,
  bytes       INT NOT NULL,
  sha256      CHAR(64) NOT NULL,
  contenido   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_mensaje_adjunto_origen CHECK ((mensaje_id IS NULL) <> (correo_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_mensaje_adjunto_mensaje ON mensaje_adjunto(mensaje_id) WHERE mensaje_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mensaje_adjunto_correo  ON mensaje_adjunto(correo_id)  WHERE correo_id IS NOT NULL;
COMMENT ON TABLE mensaje IS 'Mensajería interna entre usuarios del LIMS (§4.5.5), con prioridad y vínculo a OT, muestra, cotización o cliente.';

-- ------------------------------------------------- CRM · interacciones (§4.1.2) ---
CREATE TABLE IF NOT EXISTS cliente_interaccion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  cliente_id      UUID NOT NULL REFERENCES cliente(id),
  tipo            VARCHAR(20) NOT NULL,
  fecha           TIMESTAMPTZ NOT NULL,
  asunto          VARCHAR(200) NOT NULL,
  detalle         TEXT,
  contacto        VARCHAR(160),
  responsable_id  UUID REFERENCES usuario(id),
  oportunidad_id  UUID,
  ot_id           UUID REFERENCES orden_trabajo(id),
  cotizacion_id   UUID REFERENCES cotizacion(id),
  proxima_accion  VARCHAR(200),
  proxima_fecha   DATE,
  creado_por      UUID REFERENCES usuario(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT ck_cliente_interaccion_tipo CHECK (tipo IN ('llamada', 'reunion', 'correo', 'visita', 'nota'))
);
CREATE INDEX IF NOT EXISTS idx_cliente_interaccion ON cliente_interaccion(tenant_id, cliente_id, fecha DESC) WHERE deleted_at IS NULL;
COMMENT ON TABLE cliente_interaccion IS 'CRM (§4.1.2): interacciones con el cliente (llamada, reunión, correo, visita, nota) con responsable y próxima acción.';

-- --------------------------------------------------------------- permisos ---
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'mensaje.usar', 'mensajeria', 'usar',
   'Mensajería interna: enviar y recibir mensajes con adjuntos entre usuarios, vinculados a OT, muestras, cotizaciones o clientes.'),
  (gen_random_uuid(), 'correo.enviar', 'mensajeria', 'enviar',
   'Mensajería: enviar correos externos con adjuntos libres vinculados a una OT, muestra, cotización o cliente.'),
  (gen_random_uuid(), 'correo_plantilla.editar', 'mensajeria', 'editar',
   'Mensajería: editar las plantillas de correo por etapa y activar su envío automático.'),
  (gen_random_uuid(), 'cliente.interaccion', 'cliente', 'interaccion',
   'CRM: registrar llamadas, reuniones, correos, visitas y notas en el historial del cliente.')
ON CONFLICT (codigo) DO NOTHING;

-- mensaje.usar: todo rol interno (con ot.ver o cliente.ver), nunca CLIENTE.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso po ON po.id = rp.permiso_id AND po.codigo IN ('ot.ver', 'cliente.ver')
  JOIN rol r      ON r.id = rp.rol_id AND COALESCE(r.alias_de, r.codigo) <> 'CLIENTE'
  JOIN permiso p  ON p.codigo = 'mensaje.usar'
ON CONFLICT DO NOTHING;

-- correo.enviar: quien tiene cotizacion.crear u ot.ver, salvo CLIENTE y LECTOR (solo lectura).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso po ON po.id = rp.permiso_id AND po.codigo IN ('cotizacion.crear', 'ot.ver')
  JOIN rol r      ON r.id = rp.rol_id AND COALESCE(r.alias_de, r.codigo) NOT IN ('CLIENTE', 'LECTOR')
  JOIN permiso p  ON p.codigo = 'correo.enviar'
ON CONFLICT DO NOTHING;

-- cliente.interaccion: Comercial (cotizacion.crear), Cobranza y las jefaturas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso po ON po.id = rp.permiso_id AND po.codigo = 'cotizacion.crear'
  JOIN rol r      ON r.id = rp.rol_id AND COALESCE(r.alias_de, r.codigo) <> 'CLIENTE'
  JOIN permiso p  ON p.codigo = 'cliente.interaccion'
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('DIRECTOR'), ('SUBDIRECTOR'), ('JEFE_DEPTO'), ('COBRANZA'), ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'cliente.interaccion'
ON CONFLICT DO NOTHING;

-- correo_plantilla.editar: Dirección, Jefaturas de Departamento y Administración.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('DIRECTOR'), ('SUBDIRECTOR'), ('JEFE_DEPTO'), ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'correo_plantilla.editar'
ON CONFLICT DO NOTHING;

COMMIT;

-- Verificación:
-- SELECT etapa, clave, automatico, activa FROM correo_plantilla ORDER BY etapa, clave;
-- SELECT p.codigo, count(*) FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id
--  WHERE p.codigo IN ('mensaje.usar','correo.enviar','correo_plantilla.editar','cliente.interaccion') GROUP BY 1;
