-- =============================================================================
-- align_integracion_armas.sql · Integración asíncrona con el software de armas
-- del BPCH (certificación de armamento, FEA con OTP en su gestor documental).
--
-- Fuente: «Fases o etapas proceso de certificaciones armamento BPCH Apis.pdf»,
-- «Diagrama estados.pdf» y «Entidad-Relacion DB.pdf» (IDIC, 24-11-2026).
--
--   · Salida (LIMS → BPCH): la OT se encola en `integracion_armas_envio` y un
--     trabajador la envía a POST /api/v1/integracion/lims/ordenes-trabajo.
--   · Entrada (BPCH → LIMS): webhook firmado con HMAC, POST directo con token
--     de integración o consulta periódica (pull). Cada cambio de estado queda
--     en `integracion_armas_evento` (sin el base64) y en el historial.
--
-- Los secretos (token que entrega el BPCH y clave HMAC compartida) van SOLO en
-- variables de entorno: BPCH_ARMAS_TOKEN y BPCH_ARMAS_HMAC_SECRET.
-- Guía: docs/INTEGRACION_ARMAS_BPCH.md.
-- Idempotente. Va antes de align_cierre_permisos.sql en ORDEN_SQL.txt.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION pg_temp.armas_primera_vez(p_codigo TEXT, p_descripcion TEXT)
RETURNS boolean AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion) VALUES (p_codigo, p_descripcion)
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- --- 1 · Estado de cada OT en el software de armas ---------------------------
CREATE TABLE IF NOT EXISTS integracion_armas_ot (
  ot_id               UUID PRIMARY KEY REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  tenant_id           UUID         NOT NULL REFERENCES tenant(id),
  lims_ot_id          VARCHAR(60)  NOT NULL,
  bpch_id             BIGINT,
  tipo_orden          SMALLINT     NOT NULL CHECK (tipo_orden IN (1, 2)),
  estado_externo      SMALLINT     CHECK (estado_externo IS NULL OR estado_externo IN (1, 2, 3, 5, 6, 7, 8)),
  estado_descripcion  VARCHAR(120),
  motivo              TEXT,
  operador_rut        VARCHAR(20),
  fecha_estado        TIMESTAMPTZ,
  total_certificados  INTEGER      CHECK (total_certificados IS NULL OR total_certificados >= 0),
  enviado_at          TIMESTAMPTZ,
  idempotency_key     UUID         NOT NULL DEFAULT gen_random_uuid(),
  ultimo_error        TEXT,
  ultima_consulta_at  TIMESTAMPTZ,
  created_by          UUID REFERENCES usuario(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ux_integracion_armas_ot_lims UNIQUE (tenant_id, lims_ot_id),
  CONSTRAINT ux_integracion_armas_ot_idem UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_integracion_armas_ot_abiertas
  ON integracion_armas_ot (tenant_id) WHERE estado_externo IS NULL OR estado_externo NOT IN (3, 8);
COMMENT ON TABLE integracion_armas_ot IS
  'OT del LIMS enviada al software de armas del BPCH: identificador enviado (lims_ot_id), id que devolvió el BPCH y último estado externo (1 Pendiente, 6 Visado Delegación, 7 Visado Internación, 5 En firma FEA, 2 Firmada y en Comercial, 8 Finalizada, 3 Anulada).';

-- --- 2 · Cola de envíos (outbox) ----------------------------------------------
CREATE TABLE IF NOT EXISTS integracion_armas_envio (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenant(id),
  ot_id              UUID         NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  tipo               VARCHAR(20)  NOT NULL DEFAULT 'crear_ot' CHECK (tipo IN ('crear_ot')),
  payload            JSONB        NOT NULL,
  estado             VARCHAR(12)  NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'error', 'descartado')),
  intentos           INTEGER      NOT NULL DEFAULT 0,
  proximo_intento_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  http_status        INTEGER,
  respuesta          JSONB,
  ultimo_error       TEXT,
  creado_por         UUID REFERENCES usuario(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  enviado_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_integracion_armas_envio_cola
  ON integracion_armas_envio (proximo_intento_at) WHERE estado = 'pendiente';
CREATE UNIQUE INDEX IF NOT EXISTS ux_integracion_armas_envio_vivo
  ON integracion_armas_envio (ot_id, tipo) WHERE estado IN ('pendiente', 'enviado');
COMMENT ON TABLE integracion_armas_envio IS
  'Cola de envíos al software de armas del BPCH. Un trabajador del LIMS la recorre: 201/409 = enviado; 400 = error sin reintento; 5xx o red = reintento con espera exponencial hasta el máximo de intentos.';

-- --- 3 · Eventos recibidos (dedupe) -------------------------------------------
CREATE TABLE IF NOT EXISTS integracion_armas_evento (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenant(id),
  evento_id     VARCHAR(120) NOT NULL,
  origen        VARCHAR(10)  NOT NULL CHECK (origen IN ('webhook', 'post', 'pull')),
  ot_id         UUID         REFERENCES orden_trabajo(id) ON DELETE SET NULL,
  ot_externa    VARCHAR(60)  NOT NULL,
  estado        SMALLINT,
  payload       JSONB        NOT NULL,
  firma_valida  BOOLEAN,
  procesado_at  TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ux_integracion_armas_evento UNIQUE (tenant_id, evento_id)
);
CREATE INDEX IF NOT EXISTS ix_integracion_armas_evento_ot ON integracion_armas_evento (ot_id, created_at);
COMMENT ON TABLE integracion_armas_evento IS
  'Cada aviso de cambio de estado recibido del BPCH (webhook, POST directo o consulta). El payload se guarda SIN el base64: el PDF queda en registro_adjunto y aquí solo su nombre y hash.';

-- --- 4 · Historial de estados externos ----------------------------------------
CREATE TABLE IF NOT EXISTS integracion_armas_historial (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenant(id),
  ot_id              UUID         NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  evento_id          UUID         REFERENCES integracion_armas_evento(id) ON DELETE SET NULL,
  estado_anterior    SMALLINT,
  estado_nuevo       SMALLINT     NOT NULL,
  estado_descripcion VARCHAR(120),
  motivo             TEXT,
  operador_rut       VARCHAR(20),
  fecha_cambio       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_integracion_armas_historial_ot ON integracion_armas_historial (ot_id, created_at);

-- --- 5 · Enlaces al software de armas (reunión con el BPCH, 24-11-2026) -------
-- Los certificados por arma se quedan en el aplicativo del BPCH: el LIMS NO los
-- guarda, solo el enlace para abrirlos desde la ficha de la OT. Cada URL se
-- valida (http/https y host en integracion_armas.hosts_permitidos).
ALTER TABLE integracion_armas_ot ADD COLUMN IF NOT EXISTS url_ot_externa VARCHAR(1000);
COMMENT ON COLUMN integracion_armas_ot.url_ot_externa IS 'Enlace a la OT en el software de armas del BPCH (validado contra los hosts permitidos).';

CREATE TABLE IF NOT EXISTS integracion_armas_enlace (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  ot_id         UUID          NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  tipo          VARCHAR(12)   NOT NULL CHECK (tipo IN ('ot', 'certificado', 'acta', 'otro')),
  etiqueta      VARCHAR(200)  NOT NULL,
  numero_serie  VARCHAR(80),
  id_externo    VARCHAR(80),
  url           VARCHAR(1000) NOT NULL,
  origen        VARCHAR(10)   NOT NULL DEFAULT 'evento' CHECK (origen IN ('evento', 'consulta')),
  recibido_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  vigente       BOOLEAN       NOT NULL DEFAULT TRUE
);
-- Un enlace vigente por OT, tipo y elemento (serie o id externo): uno nuevo reemplaza al anterior.
CREATE UNIQUE INDEX IF NOT EXISTS ux_integracion_armas_enlace_vigente
  ON integracion_armas_enlace (ot_id, tipo, COALESCE(numero_serie, ''), COALESCE(id_externo, ''), url) WHERE vigente;
CREATE INDEX IF NOT EXISTS ix_integracion_armas_enlace_ot ON integracion_armas_enlace (ot_id) WHERE vigente;
COMMENT ON TABLE integracion_armas_enlace IS
  'Enlaces al software de armas del BPCH que se muestran en la ficha de la OT (la OT, cada certificado por arma, el acta). Los documentos viven en el BPCH; el LIMS solo guarda la URL validada.';

-- --- 6 · Parámetros ------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('integracion_armas', 'activa', 'Integración con el software de armas del BPCH activa', 1, 'no'),
  ('integracion_armas', 'url_base', 'Dirección base del software de armas del BPCH', 2, ''),
  ('integracion_armas', 'modo_retorno', 'Cómo llegan los estados del BPCH al LIMS', 3, 'webhook'),
  ('integracion_armas', 'enviar_automatico', 'Enviar la OT al BPCH automáticamente', 4, 'no'),
  ('integracion_armas', 'unidades', 'Unidades responsables cuyas OT se envían', 5, 'D11,BPCH'),
  ('integracion_armas', 'max_intentos', 'Intentos de envío antes de dejarlo en error', 6, '8'),
  ('integracion_armas', 'intervalo_pull_min', 'Minutos entre consultas de estado (modo consulta)', 7, '15'),
  ('integracion_armas', 'rut_con_dv', 'Enviar el RUT con dígito verificador', 8, 'no'),
  ('integracion_armas', 'vigencia_enlace_horas', 'Horas de validez del enlace de descarga de adjuntos', 9, '72'),
  ('integracion_armas', 'cerrar_ot_al_finalizar', 'Cerrar la OT del LIMS cuando el BPCH la finaliza', 10, 'no'),
  ('integracion_armas', 'hosts_permitidos', 'Servidores permitidos en los enlaces del BPCH', 11, ''),
  ('integracion_armas', 'ruta_enlaces_ot', 'Ruta del BPCH que entrega los enlaces de una OT', 12, ''),
  ('integracion_armas', 'guardar_acta_pdf', 'Guardar el acta de cierre en PDF si viene en el aviso', 13, 'si')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 7 · Permisos --------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'integracion.armas.gestionar', 'integracion', 'armas_gestionar',
   'Ver la bandeja de la integración con el software de armas del BPCH, enviar una OT y reintentar envíos'),
  (gen_random_uuid(), 'integracion.armas.estado', 'integracion', 'armas_estado',
   'Informar al LIMS los cambios de estado de una OT (cuenta de servicio del software de armas del BPCH)')
ON CONFLICT (codigo) DO NOTHING;

DO $$
BEGIN
  IF pg_temp.armas_primera_vez('armas.permisos', 'Integración armas BPCH: integracion.armas.gestionar a SUPERADMIN, ADMIN, JEFE_LAB y COMERCIAL') THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r.id, p.id
      FROM rol r JOIN permiso p ON p.codigo = 'integracion.armas.gestionar'
     WHERE COALESCE(r.alias_de, r.codigo) IN ('SUPERADMIN', 'ADMIN', 'JEFE_LAB', 'COMERCIAL')
    ON CONFLICT DO NOTHING;
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r.id, p.id
      FROM rol r JOIN permiso p ON p.codigo = 'integracion.armas.estado'
     WHERE COALESCE(r.alias_de, r.codigo) = 'SUPERADMIN'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

COMMIT;
