-- =============================================================================
-- align_r4a_metrologia_ficha.sql · Metrología: ficha de calibración y cálculo
-- (entrega R4, tema T28, frente r4a)
-- -----------------------------------------------------------------------------
-- Especificación: 09_gestion/especificacion_procesos/EP-04_Metrologia.md
-- (P3.4 condiciones corregidas, P4.2 patrón fuera de rango, P5.3 error
-- normalizado, P2.3 informe técnico, P2.4 servicio externo, P7.2 aviso al
-- emitir, P8.4 equipo del laboratorio dueño, P8.5 LNF → maestro de patrones).
-- Reglas en docs/FLUJO_METROLOGIA.md §9.
--
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va ANTES de
-- align_cierre_permisos.sql (que es siempre el último). Sin permisos nuevos.
--
--   1. Parámetros de la operación (categoría metrologia_ficha): criterio del
--      error normalizado, patrón fuera de rango, aviso al emitir, momento de
--      actualizar el equipo del laboratorio dueño y si el ítem no apto exige su
--      documento para el cierre técnico. Valores por defecto POR CONFIRMAR.
--   2. met_patron: rango calibrado numérico, errores del certificado de los
--      equipos auxiliares (corrección de T, HR y P) y coeficientes (LNF).
--   3. met_patron_actualizacion: lo que cambió en el maestro al emitir un
--      certificado del LNF de un transductor del propio IDIC (antes y después).
--   4. met_informe_tecnico: informe técnico del instrumento no calibrable.
--   5. met_servicio_externo: calibración en un laboratorio externo.
--   6. Numeración del informe técnico (prefijo IT-, por confirmar).
-- =============================================================================

-- --- 1 · Parámetros de la operación ---------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, 'metrologia_ficha', v.codigo, v.etiqueta, v.valor, v.orden
  FROM tenant t,
       (VALUES
         ('criterio_en', 'Criterio del error normalizado (informativo): <1 o <=1', '<=1', 1),
         ('patron_fuera_rango', 'Punto medido con un patrón fuera de su rango calibrado: bloquear o avisar', 'bloquear', 2),
         ('notificar_emision', 'Al emitir, enviar el certificado por correo al contacto de la OT (si / no)', 'si', 3),
         ('actualizar_equipo', 'Actualizar el equipo del laboratorio dueño: al emitir, al entregar o no', 'emitir', 4),
         ('no_apto_exige_documento', 'El cierre técnico exige informe técnico o servicio externo del ítem no apto (si / no)', 'no', 5)
       ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 2 · Maestro de patrones ------------------------------------------------------
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS rango_min    DOUBLE PRECISION;
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS rango_max    DOUBLE PRECISION;
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS unidad_rango VARCHAR(20);
-- Errores del certificado del auxiliar: {"temp": {"error": -0.2, "U": 0.6}, "hum": {...}, "pres": {...}}.
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS correcciones JSONB;
-- LNF: clase y coeficientes de la ecuación F = t·S + u·S² + v·S³ del último certificado.
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS coeficientes JSONB;
ALTER TABLE met_patron ADD COLUMN IF NOT EXISTS actualizado_por_cal UUID REFERENCES met_calibracion(id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'met_patron_rango_check') THEN
    ALTER TABLE met_patron ADD CONSTRAINT met_patron_rango_check
      CHECK (rango_min IS NULL OR rango_max IS NULL OR rango_min <= rango_max);
  END IF;
END $$;

-- --- 3 · Historial de lo que el LNF cambió en el maestro ---------------------------
CREATE TABLE IF NOT EXISTS met_patron_actualizacion (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  patron_id      UUID NOT NULL REFERENCES met_patron(id),
  calibracion_id UUID NOT NULL REFERENCES met_calibracion(id),
  antes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  despues        JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario_id     UUID REFERENCES usuario(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patron_id, calibracion_id)
);
CREATE INDEX IF NOT EXISTS idx_met_patron_act_patron ON met_patron_actualizacion (patron_id, created_at DESC);

-- --- 4 · Informe técnico del instrumento no calibrable ----------------------------
CREATE TABLE IF NOT EXISTS met_informe_tecnico (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenant(id),
  ot_id                 UUID NOT NULL REFERENCES orden_trabajo(id),
  ot_instrumento_id     UUID NOT NULL REFERENCES met_ot_instrumento(id),
  estado                VARCHAR(20) NOT NULL DEFAULT 'borrador'
                        CHECK (estado IN ('borrador', 'en_firma', 'emitido', 'anulado')),
  hallazgos             TEXT NOT NULL,
  motivo                TEXT NOT NULL,
  recomendacion         TEXT,
  numero                VARCHAR(30),
  codigo_verificacion   VARCHAR(16),
  documento_html        TEXT,
  documento_hash        VARCHAR(64),
  elaborado_por         UUID REFERENCES usuario(id),
  enviado_at            TIMESTAMPTZ,
  emitido_at            TIMESTAMPTZ,
  emitido_por           UUID REFERENCES usuario(id),
  devuelto_motivo       TEXT,
  entregado_at          TIMESTAMPTZ,
  entrega_medio         VARCHAR(30),
  entrega_destinatario  VARCHAR(160),
  entrega_observacion   TEXT,
  entregado_por         UUID REFERENCES usuario(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un informe vigente por ítem.
CREATE UNIQUE INDEX IF NOT EXISTS ux_met_informe_item ON met_informe_tecnico (ot_instrumento_id) WHERE estado <> 'anulado';
CREATE UNIQUE INDEX IF NOT EXISTS ux_met_informe_numero ON met_informe_tecnico (tenant_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_met_informe_ot ON met_informe_tecnico (ot_id);

-- --- 5 · Servicio externo ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS met_servicio_externo (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenant(id),
  ot_id                  UUID NOT NULL REFERENCES orden_trabajo(id),
  ot_instrumento_id      UUID NOT NULL REFERENCES met_ot_instrumento(id),
  estado                 VARCHAR(20) NOT NULL DEFAULT 'solicitado'
                         CHECK (estado IN ('solicitado', 'aprobado', 'enviado', 'validado', 'rechazado', 'anulado')),
  proveedor_id           UUID REFERENCES proveedor(id),
  justificacion          TEXT NOT NULL,
  costo                  NUMERIC(14, 2),
  oc_numero              VARCHAR(40),
  fecha_envio            DATE,
  fecha_retorno          DATE,
  certificado_numero     VARCHAR(60),
  certificado_nombre     VARCHAR(200),
  certificado_mime       VARCHAR(40),
  certificado_datos      TEXT,
  certificado_hash       VARCHAR(64),
  aptitud                VARCHAR(10) CHECK (aptitud IS NULL OR aptitud IN ('apto', 'no_apto')),
  aptitud_comentario     TEXT,
  solicitado_por         UUID REFERENCES usuario(id),
  aprobado_por           UUID REFERENCES usuario(id),
  aprobado_at            TIMESTAMPTZ,
  rechazo_motivo         TEXT,
  enviado_por            UUID REFERENCES usuario(id),
  validado_por           UUID REFERENCES usuario(id),
  validado_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_met_externo_item ON met_servicio_externo (ot_instrumento_id) WHERE estado NOT IN ('rechazado', 'anulado');
CREATE INDEX IF NOT EXISTS idx_met_externo_ot ON met_servicio_externo (ot_id);

-- --- 6 · Numeración del informe técnico (IT-NNNN, por confirmar) ------------------
INSERT INTO met_numeracion (tenant_id, prefijo, ultimo, relleno, formato, anual, anio)
SELECT t.id, 'ITEC', 0, 4, 'IT-{N}', FALSE, NULL FROM tenant t
ON CONFLICT (tenant_id, prefijo) DO NOTHING;
