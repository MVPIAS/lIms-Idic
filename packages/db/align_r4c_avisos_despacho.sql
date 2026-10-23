-- =============================================================================
-- LIMS IDIC · Frente r4c · avisos, despacho, entrega y seguimiento (T20) y
-- carpeta de trabajo y documentos no-informe (T23, T03) · Aiuken
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql (que debe ser siempre el último de ORDEN_SQL.txt).
-- Reglas: docs/FLUJO_AVISOS_DESPACHO_OFICIO.md.
--
--   1 · aviso: avisos internos por persona («Mi bandeja › Avisos»), con el
--       resultado del correo (enviado, error, sin configurar). Clave única por
--       persona: el mismo aviso no se repite (p. ej. una OT vencida, una vez al día).
--   2 · documento_despacho: despacho del documento oficial al DCO, al
--       laboratorio solicitante, al BPCH o al cliente (EP-01 6.3, EP-03 6.2,
--       EP-05 8.1, EP-06 6.14, EP-07 7.18): fecha, ejemplares, distribución,
--       copia archivada y recepción por el destino.
--   3 · certificado: la entrega con guía, ejemplares, copias, oficio y
--       devolución de muestras (EP-05 8.1).
--   4 · orden_trabajo: aviso del plazo al cliente (EP-00 4.3), recepción en DCO
--       con días de atraso (EP-00 6.3) y carpeta de trabajo archivada (EP-05 9.3).
--   5 · ot_documento_registro: documentos no-informe de la OT (cartas, oficios,
--       copias) con versión (EP-00 6.4, EP-05 9.3).
--   6 · ot_envio: registro del envío al cliente (documentos y factura juntos,
--       EP-00 6.4, EP-06 6.18).
--   7 · Parámetros de la operación (avisos) y permisos nuevos.
-- =============================================================================

-- --- 1 · Avisos ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aviso (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenant(id),
  usuario_id      UUID         NOT NULL REFERENCES usuario(id),
  tipo            VARCHAR(40)  NOT NULL,
  severidad       VARCHAR(10)  NOT NULL DEFAULT 'info',
  titulo          VARCHAR(200) NOT NULL,
  mensaje         TEXT,
  ruta            VARCHAR(300),
  ot_id           UUID         REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  certificado_id  UUID,
  clave           VARCHAR(200) NOT NULL,
  correo_estado   VARCHAR(15)  NOT NULL DEFAULT 'no_aplica',
  correo_error    TEXT,
  leido_at        TIMESTAMPTZ,
  creado_por      UUID         REFERENCES usuario(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_aviso_severidad CHECK (severidad IN ('info', 'warn', 'alta')),
  CONSTRAINT ck_aviso_correo CHECK (correo_estado IN ('no_aplica', 'enviado', 'error', 'sin_correo', 'sin_configurar')),
  CONSTRAINT ux_aviso_clave UNIQUE (tenant_id, usuario_id, clave)
);
COMMENT ON TABLE aviso IS
  'Avisos internos por persona (Mi bandeja › Avisos): plazos, OT vencidas, No cumple / Contaminado (contrato §4.2.6), documentos listos, despachos y oficios. Si el correo no está configurado el aviso queda aquí y en la bitácora de Mensajería sin fallar.';
COMMENT ON COLUMN aviso.clave IS 'Evita repetir el mismo aviso a la misma persona (p. ej. ot_vencida:<ot>:<día>).';
COMMENT ON COLUMN aviso.correo_estado IS 'no_aplica (solo interno) · enviado · error (el SMTP falló) · sin_correo (la persona no tiene correo) · sin_configurar (el LIMS no tiene correo configurado).';
CREATE INDEX IF NOT EXISTS ix_aviso_usuario ON aviso (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_aviso_no_leido ON aviso (usuario_id) WHERE leido_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_aviso_ot ON aviso (ot_id) WHERE ot_id IS NOT NULL;

-- La bitácora de Mensajería registra también los correos de aviso.
COMMENT ON COLUMN correo_enviado.tipo IS 'cotizacion | resultado | informe | aviso | oficio | envio | otro';

-- --- 2 · Despacho del documento ------------------------------------------------------
CREATE TABLE IF NOT EXISTS documento_despacho (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenant(id),
  certificado_id     UUID         NOT NULL REFERENCES certificado(id),
  ot_id              UUID         NOT NULL REFERENCES orden_trabajo(id),
  destino            VARCHAR(20)  NOT NULL,
  unidad_destino_id  UUID         REFERENCES unidad(id),
  fecha              DATE         NOT NULL,
  ejemplares         INTEGER      NOT NULL DEFAULT 1,
  distribucion       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  copia_archivada    BOOLEAN      NOT NULL DEFAULT TRUE,
  archivo_ubicacion  VARCHAR(200),
  retencion_meses    INTEGER,
  oficio_id          UUID,
  observacion        TEXT,
  registrado_por     UUID         REFERENCES usuario(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  recibido_at        TIMESTAMPTZ,
  recibido_por       UUID         REFERENCES usuario(id),
  CONSTRAINT ck_despacho_destino CHECK (destino IN ('DCO', 'LAB_SOLICITANTE', 'BPCH', 'CLIENTE')),
  CONSTRAINT ck_despacho_ejemplares CHECK (ejemplares BETWEEN 1 AND 50),
  CONSTRAINT ck_despacho_retencion CHECK (retencion_meses IS NULL OR retencion_meses BETWEEN 1 AND 600),
  CONSTRAINT ux_documento_despacho UNIQUE (certificado_id)
);
COMMENT ON TABLE documento_despacho IS
  'Despacho del documento oficial a su destino (DCO, laboratorio solicitante, BPCH o cliente) con ejemplares, distribución y copia archivada. «Remitir a DCO» del BPCH es un despacho con destino DCO. El DCO lo da por recibido y luego registra la entrega al cliente.';
CREATE INDEX IF NOT EXISTS ix_documento_despacho_ot ON documento_despacho (ot_id);
CREATE INDEX IF NOT EXISTS ix_documento_despacho_pendiente ON documento_despacho (tenant_id, destino) WHERE recibido_at IS NULL;

-- --- 3 · Entrega con guía ---------------------------------------------------------------
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_guia               VARCHAR(60);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_ejemplares         INTEGER;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_copias             VARCHAR(200);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_oficio_id          UUID;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS entrega_devolucion_muestras BOOLEAN;
COMMENT ON COLUMN certificado.entrega_guia IS 'Nº de guía de despacho o de courier de la entrega (EP-05 8.1).';
COMMENT ON COLUMN certificado.entrega_copias IS 'Copias entregadas (laboratorio, DCO…), texto libre.';
COMMENT ON COLUMN certificado.entrega_oficio_id IS 'Oficio conductor con que salió el documento (align_r4c_oficio.sql).';

-- --- 4 · Seguimiento de la OT -----------------------------------------------------------
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS plazo_notificado_at    TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS plazo_notificado_por   UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS plazo_notificado_medio VARCHAR(20);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS recep_dco_por          UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS recep_dco_at           TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS carpeta_archivada_at   TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS carpeta_archivada_por  UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS carpeta_ubicacion      VARCHAR(200);
COMMENT ON COLUMN orden_trabajo.plazo_notificado_at IS 'Cuándo se avisó al cliente la fecha de entrega (EP-00 4.3 «Notificar plazo al cliente»).';
COMMENT ON COLUMN orden_trabajo.recep_dco_at IS 'Cuándo se registró la recepción del informe en DCO (fecha_recep_dco, dias_atraso y estado_envio, EP-00 6.3).';
COMMENT ON COLUMN orden_trabajo.carpeta_archivada_at IS 'Carpeta de Trabajo archivada (EP-05 9.3 «Archivar → fin»).';

-- --- 5 · Documentos no-informe de la OT ---------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_documento_registro (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenant(id),
  ot_id           UUID         NOT NULL REFERENCES orden_trabajo(id),
  tipo            VARCHAR(20)  NOT NULL,
  numero          VARCHAR(80)  NOT NULL,
  version         INTEGER      NOT NULL DEFAULT 1,
  copias          INTEGER      NOT NULL DEFAULT 1,
  fecha           DATE         NOT NULL,
  descripcion     VARCHAR(500),
  archivo_nombre  VARCHAR(200),
  archivo_mime    VARCHAR(80),
  archivo_bytes   INTEGER,
  archivo_datos   TEXT,
  archivo_hash    VARCHAR(64),
  registrado_por  UUID         REFERENCES usuario(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_por     UUID         REFERENCES usuario(id),
  deleted_motivo  TEXT,
  CONSTRAINT ck_ot_documento_tipo CHECK (tipo IN ('CARTA', 'OFICIO', 'CERTIFICADO', 'INFORME', 'IVC', 'PLANILLA', 'ACTA', 'OTRO')),
  CONSTRAINT ck_ot_documento_copias CHECK (copias BETWEEN 0 AND 50),
  CONSTRAINT ck_ot_documento_archivo CHECK (archivo_bytes IS NULL OR archivo_bytes <= 5000000)
);
COMMENT ON TABLE ot_documento_registro IS
  'Documentos de la OT que no son informes del circuito (cartas, oficios en papel, copias, planillas): tipo, Nº, versión, copias, fecha y archivo. Forman parte de la Carpeta de Trabajo.';
CREATE INDEX IF NOT EXISTS ix_ot_documento_registro_ot ON ot_documento_registro (ot_id) WHERE deleted_at IS NULL;

-- --- 6 · Envío al cliente -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_envio (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenant(id),
  ot_id           UUID         NOT NULL REFERENCES orden_trabajo(id),
  fecha           DATE         NOT NULL,
  medio           VARCHAR(20)  NOT NULL,
  destinatario    VARCHAR(300) NOT NULL,
  documentos      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  factura_id      UUID,
  guia            VARCHAR(60),
  observacion     TEXT,
  correo_estado   VARCHAR(15)  NOT NULL DEFAULT 'no_aplica',
  correo_error    TEXT,
  registrado_por  UUID         REFERENCES usuario(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_ot_envio_medio CHECK (medio IN ('correo', 'mano', 'libro', 'oficio', 'oficina_partes', 'courier', 'plataforma', 'otro')),
  CONSTRAINT ck_ot_envio_correo CHECK (correo_estado IN ('no_aplica', 'enviado', 'error', 'sin_configurar'))
);
COMMENT ON TABLE ot_envio IS
  'Envío al cliente (EP-00 6.4 y EP-06 6.18): medio, fecha, destinatario y los documentos (informes, certificados, oficios, cartas) y la factura que van juntos. Por correo, adjunta los PDF oficiales.';
CREATE INDEX IF NOT EXISTS ix_ot_envio_ot ON ot_envio (ot_id);

-- --- 7a · Parámetros de la operación -------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, 'avisos', v.codigo, v.etiqueta, v.valor, v.orden
  FROM tenant t,
       (VALUES
         ('dias_por_vencer', 'Días antes de la fecha de compromiso en que se avisa «por vencer»', '3', 1),
         ('revision_automatica', 'Revisar los plazos de las OT cada hora y avisar (si / no)', 'si', 2),
         ('enviar_correo', 'Enviar también por correo los avisos (si / no)', 'si', 3),
         ('no_cumple_al_cliente', 'Avisar al cliente un resultado No cumple o Contaminado al aprobarlo (si / no)', 'no', 4),
         ('documento_listo', 'Avisar a Comercial cuando un documento queda oficial (si / no)', 'si', 5)
       ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 7b · Permisos -------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'certificado.despachar', 'certificado', 'despachar',
   'Despachar un documento oficial al DCO, al laboratorio solicitante, al BPCH o al cliente («Despachar al DCO →», «Remitir a DCO»).'),
  (gen_random_uuid(), 'ot.seguimiento', 'ot', 'seguimiento',
   'Seguimiento comercial de la OT: avisar el plazo al cliente, recepción en DCO, envío al cliente, documentos no-informe y avisos de vencimiento.'),
  (gen_random_uuid(), 'ot.carpeta', 'ot', 'carpeta',
   'Archivar la Carpeta de Trabajo de la OT y registrar sus documentos no-informe.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('JEFE_LAB', 'certificado.despachar'), ('JEFE_SECCION', 'certificado.despachar'), ('JEFE_DEPTO', 'certificado.despachar'),
    ('DIRECTOR', 'certificado.despachar'), ('SUBDIRECTOR', 'certificado.despachar'), ('SUPERADMIN', 'certificado.despachar'),
    ('COMERCIAL', 'ot.seguimiento'), ('PLANIFICACION', 'ot.seguimiento'), ('JEFE_LAB', 'ot.seguimiento'),
    ('JEFE_SECCION', 'ot.seguimiento'), ('JEFE_DEPTO', 'ot.seguimiento'), ('DIRECTOR', 'ot.seguimiento'),
    ('SUBDIRECTOR', 'ot.seguimiento'), ('SUPERADMIN', 'ot.seguimiento'),
    ('ANALISTA', 'ot.carpeta'), ('TECNICO', 'ot.carpeta'), ('REVISOR', 'ot.carpeta'), ('METROLOGO', 'ot.carpeta'),
    ('INSPECTOR', 'ot.carpeta'), ('JEFE_LAB', 'ot.carpeta'), ('JEFE_SECCION', 'ot.carpeta'), ('JEFE_DEPTO', 'ot.carpeta'),
    ('PLANIFICACION', 'ot.carpeta'), ('COMERCIAL', 'ot.carpeta'), ('DIRECTOR', 'ot.carpeta'), ('SUBDIRECTOR', 'ot.carpeta'),
    ('SUPERADMIN', 'ot.carpeta')
  ) AS m(rol, perm)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
