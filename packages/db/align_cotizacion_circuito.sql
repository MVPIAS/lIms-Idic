-- =============================================================================
-- align_cotizacion_circuito.sql · Cotización: costeo con el laboratorio, V°B°,
-- firma del Jefe DCO, numeración real y envío
-- -----------------------------------------------------------------------------
-- Frente r1c (EP-00 · F2 y F3). Reglas: docs/FLUJO_COTIZACION_ENCUESTAS.md.
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt.
--
--   1. Numeración de la cotización (formato real «2026-14324»): contador
--      atómico por tenant y serie (global o anual) y parámetros editables.
--   2. Circuito de la cotización: solicitud al laboratorio (fechas y costeo,
--      FORM05/FORM06) sobre `solicitud_costeo`, V°B° del laboratorio y del
--      departamento, firma del Jefe DCO (matriz COTIZACION), envío al cliente
--      y bitácora.
--   3. Permisos nuevos: cotizacion.costear, cotizacion.vb, cotizacion.firmar.
-- Las encuestas de satisfacción van en align_encuestas_satisfaccion.sql.
-- =============================================================================

-- --- 1 · Numeración de la cotización -------------------------------------------
CREATE TABLE IF NOT EXISTS cotizacion_correlativo (
  tenant_id  UUID        NOT NULL REFERENCES tenant(id),
  serie      VARCHAR(10) NOT NULL,            -- 'global' o el año ('2026') si el reinicio es anual
  ultimo     INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, serie)
);
COMMENT ON TABLE cotizacion_correlativo IS
  'Correlativo atómico del número de cotización (INSERT … ON CONFLICT DO UPDATE … RETURNING). Serie global o por año según numeracion_cotizacion.reinicio.';

-- Parámetros (Administración › Parámetros). Formato con {AAAA} y {N}; {N} se
-- rellena con ceros hasta «digitos». «inicio» permite continuar la numeración
-- del Sistema Comercial (el siguiente número será inicio + 1). POR CONFIRMAR
-- con el IDIC (EP-00 §10 P6): formato y si el correlativo es global o anual.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, 'numeracion_cotizacion', v.codigo, v.etiqueta, v.valor, v.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
   ('formato', 'Formato del número ({AAAA} = año, {N} = correlativo)', '{AAAA}-{N}', 1),
   ('digitos', 'Dígitos mínimos del correlativo', '5', 2),
   ('reinicio', 'Reinicio del correlativo (global | anual)', 'global', 3),
   ('inicio', 'Último número ya usado (el siguiente será este + 1)', '0', 4)
 ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 2 · Circuito de la cotización ----------------------------------------------
-- Cotizaciones anteriores a este circuito: se marcan «historico» al añadir la
-- columna (el DEFAULT rellena las filas existentes una sola vez) y las nuevas
-- nacen «r1». Las históricas no exigen firma para aceptarse.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'cotizacion' AND column_name = 'circuito') THEN
    ALTER TABLE cotizacion ADD COLUMN circuito VARCHAR(12) DEFAULT 'historico';
  END IF;
END $$;
ALTER TABLE cotizacion ALTER COLUMN circuito SET DEFAULT 'r1';
COMMENT ON COLUMN cotizacion.circuito IS
  'historico = anterior al circuito de firma (no exige firma para aceptarse); r1 = costeo, V°B°, firma del Jefe DCO y envío.';

ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS firma_estado          VARCHAR(12);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS firma_solicitada_por  UUID REFERENCES usuario(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS firma_solicitada_at   TIMESTAMPTZ;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS firmada_por           UUID REFERENCES usuario(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS firmada_at            TIMESTAMPTZ;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS firma_devuelta_motivo TEXT;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS enviada_at            TIMESTAMPTZ;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS enviada_por           UUID REFERENCES usuario(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS enviada_medio         VARCHAR(30);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS enviada_destinatarios TEXT;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS envio_observacion     TEXT;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS form_correlativo      INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_firma_estado') THEN
    ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_firma_estado
      CHECK (firma_estado IS NULL OR firma_estado IN ('pendiente', 'firmada', 'devuelta'));
  END IF;
END $$;
COMMENT ON COLUMN cotizacion.firma_estado IS
  'Circuito de firma (matriz COTIZACION): NULL = en elaboración · pendiente = enviada a firma del Jefe DCO · firmada = emitida · devuelta = devuelta al ejecutivo con motivo.';
COMMENT ON COLUMN cotizacion.form_correlativo IS
  'Último correlativo del Formulario de cotización (FORM-<nº cotización>/00n) emitido para esta cotización.';

-- Solicitud al laboratorio (EP-00 2.3–2.6) sobre la tabla del costeo por
-- laboratorio que ya existía (D2): una fila por laboratorio consultado.
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS unidad_id            UUID REFERENCES unidad(id);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS numero               VARCHAR(50);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS tipo_servicio        VARCHAR(20);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS comentario_ejecutivo TEXT;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS con_copia            TEXT;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS solicitada_por       UUID REFERENCES usuario(id);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS solicitada_at        TIMESTAMPTZ;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS respuesta            VARCHAR(30);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS comentario_lab       TEXT;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS programa             JSONB;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS costeo               JSONB;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS plazo_entrega_dias   INTEGER;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS fecha_inicio         DATE;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS fecha_termino        DATE;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS respondida_por       UUID REFERENCES usuario(id);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS respondida_at        TIMESTAMPTZ;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS vb_lab_por           UUID REFERENCES usuario(id);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS vb_lab_at            TIMESTAMPTZ;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS vb_lab_comentario    TEXT;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS vb_depto_por         UUID REFERENCES usuario(id);
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS vb_depto_at          TIMESTAMPTZ;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS vb_depto_comentario  TEXT;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS devuelta_motivo      TEXT;
ALTER TABLE solicitud_costeo ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitud_costeo_tipo_servicio') THEN
    ALTER TABLE solicitud_costeo ADD CONSTRAINT ck_solicitud_costeo_tipo_servicio
      CHECK (tipo_servicio IS NULL OR tipo_servicio IN ('estandar', 'no_estandar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitud_costeo_respuesta') THEN
    ALTER TABLE solicitud_costeo ADD CONSTRAINT ck_solicitud_costeo_respuesta
      CHECK (respuesta IS NULL OR respuesta IN ('aceptar', 'aceptar_con_comentario', 'rechazar'));
  END IF;
END $$;
COMMENT ON COLUMN solicitud_costeo.estado IS
  'solicitado → respondido → vb_lab → aprobado (V°B° completo) · devuelto (V°B° devuelto: el laboratorio responde de nuevo) · rechazado (el laboratorio no realiza el servicio). Heredados del costeo D2: estimado, consolidado.';
COMMENT ON COLUMN solicitud_costeo.numero IS
  'Formulario de cotización FORM-<nº cotización>/00n (DCO-PG01-P01-IT02-FORM05).';
COMMENT ON COLUMN solicitud_costeo.programa IS
  'Programa de trabajo (FORM06): etapas [{actividad, inicio, termino, recursos}].';
COMMENT ON COLUMN solicitud_costeo.costeo IS
  'Formulario de costeo (FORM05): secciones 1–7 y montos calculados (CDT, CFA, CT, precio Ejército y particular).';
CREATE INDEX IF NOT EXISTS idx_solicitud_costeo_unidad ON solicitud_costeo (unidad_id, estado) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_costeo_numero ON solicitud_costeo (tenant_id, numero) WHERE numero IS NOT NULL;

-- Bitácora de la cotización: solicitudes, respuestas, V°B°, firma, envío.
CREATE TABLE IF NOT EXISTS cotizacion_evento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  cotizacion_id  UUID NOT NULL REFERENCES cotizacion(id) ON DELETE CASCADE,
  solicitud_id   UUID REFERENCES solicitud_costeo(id) ON DELETE SET NULL,
  accion         VARCHAR(30) NOT NULL,
  comentario     TEXT,
  detalle        JSONB,
  usuario_id     UUID REFERENCES usuario(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cotizacion_evento ON cotizacion_evento (cotizacion_id, created_at);

-- Parámetros del circuito (POR CONFIRMAR con el IDIC, EP-00 §10 P1–P2).
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, 'circuito_cotizacion', v.codigo, v.etiqueta, v.valor, v.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
   ('vb_niveles', 'V°B° que exige la respuesta del laboratorio (lab_depto | lab | ninguno)', 'lab_depto', 1),
   ('exigir_consulta_laboratorio', 'Exigir al menos una consulta al laboratorio antes de firmar (si | no)', 'no', 2),
   ('exigir_firma_para_aceptar', 'Exigir la firma del Jefe DCO antes de registrar la aceptación (si | no)', 'si', 3),
   ('cfa_pct', 'Costo fijo asociado (CFA) del Formulario de costeo, %', '12', 4),
   ('margen_particular_pct', 'Recargo del precio particular sobre el costo total, %', '20', 5)
 ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 3 · Permisos ------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'cotizacion.costear', 'cotizacion', 'costear',
   'Responder la solicitud de Comercial: programa de trabajo (FORM06) y formulario de costeo (FORM05) de su laboratorio.'),
  (gen_random_uuid(), 'cotizacion.vb', 'cotizacion', 'vb',
   'Dar o devolver el V°B° del laboratorio o del departamento a la respuesta de costeo.'),
  (gen_random_uuid(), 'cotizacion.firmar', 'cotizacion', 'firmar',
   'Firmar (emitir) o devolver una cotización, si la matriz de firmas COTIZACION lo designa.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('JEFE_LAB', 'cotizacion.costear'), ('JEFE_SECCION', 'cotizacion.costear'), ('JEFE_DEPTO', 'cotizacion.costear'),
    ('JEFE_LAB', 'cotizacion.vb'), ('JEFE_DEPTO', 'cotizacion.vb'),
    ('JEFE_DEPTO', 'cotizacion.firmar')
  ) AS m(rol, perm)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
