-- =============================================================================
-- align_metrologia_ot.sql · Metrología ligada a la OT (entrega R1, frente r1a)
-- -----------------------------------------------------------------------------
-- Especificación: 09_gestion/especificacion_procesos/EP-04_Metrologia.md
-- (F2 recepción y custodia, F3 calibración desde el ítem, F8 entrega y
-- devolución, F9 cierre técnico y cierre de la OT). Reglas en
-- docs/FLUJO_METROLOGIA.md §7.
--
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt. Sin permisos nuevos (ot.ver, ot.crear, ot.asignar,
-- metrologia.crear, certificado.entregar, ot.cerrar).
--
--   1. met_ot_instrumento: un ítem por instrumento de la OT, con su recepción
--      (custodia), la decisión «¿se puede calibrar?», el metrólogo asignado y
--      la devolución del instrumento (acta).
--   2. met_calibracion: enlace al ítem (y a la OT, columna que ya existía) y
--      registro de la entrega del certificado.
--   3. Numeración por laboratorio: formato configurable por prefijo y
--      correlativo anual (LCPNF-NNN.AA). Prefijos HT-, ME-, TF- (LMTE) y
--      LCPNF (LNF). Los últimos números reales los fija el IDIC.
--   4. Parámetro: el cierre de una OT de calibración exige la devolución del
--      instrumento (por defecto sí; editable en Administración › Parámetros).
-- =============================================================================

-- --- 1 · Instrumentos de la OT (ítems) -----------------------------------------
CREATE TABLE IF NOT EXISTS met_ot_instrumento (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL REFERENCES tenant(id),
  ot_id                UUID         NOT NULL REFERENCES orden_trabajo(id),
  numero               INT          NOT NULL CHECK (numero > 0),
  descripcion          VARCHAR(300) NOT NULL,
  marca                VARCHAR(120),
  modelo               VARCHAR(120),
  serie                VARCHAR(120),
  id_especial          VARCHAR(120),
  capacidad            VARCHAR(120),
  resolucion           VARCHAR(120),
  rango                VARCHAR(160),
  proceso_codigo       VARCHAR(20)  REFERENCES met_proceso(codigo),
  sentido              VARCHAR(5)   CHECK (sentido IS NULL OR sentido IN ('T', 'C', 'T+C')),
  puntos               VARCHAR(500),
  intervalo_meses      INT          CHECK (intervalo_meses IS NULL OR intervalo_meses BETWEEN 0 AND 120),
  equipo_id            UUID         REFERENCES equipo(id),
  linea_cotizacion_id  UUID,
  -- Programación (P1.3)
  metrologo_id         UUID         REFERENCES usuario(id),
  fecha_prevista       DATE,
  asignado_at          TIMESTAMPTZ,
  asignado_por         UUID         REFERENCES usuario(id),
  -- Estado del ítem: por_recibir → recibido | no_apto → devuelto; anulado (solo antes de recibir)
  estado               VARCHAR(20)  NOT NULL DEFAULT 'por_recibir'
                       CHECK (estado IN ('por_recibir', 'recibido', 'no_apto', 'devuelto', 'anulado')),
  -- Recepción y custodia (P2.1, P2.2)
  recibido_at          TIMESTAMPTZ,
  recibido_por         UUID         REFERENCES usuario(id),
  entregado_por        VARCHAR(160),
  estado_fisico        VARCHAR(30),
  estado_fisico_obs    TEXT,
  accesorios           JSONB        NOT NULL DEFAULT '[]',
  ubicacion            VARCHAR(160),
  acondicionamiento_h  NUMERIC(8, 2),
  temp_ambiente        NUMERIC(6, 2),
  etiqueta             VARCHAR(60),
  calibrable           BOOLEAN,
  motivo_no_calibrable TEXT,
  requiere_externo     BOOLEAN,
  -- Devolución del instrumento (P8.2, acta)
  devuelto_at          TIMESTAMPTZ,
  devuelto_recibe      VARCHAR(160),
  devuelto_estado      VARCHAR(30),
  devuelto_obs         TEXT,
  devuelto_guia        VARCHAR(80),
  devuelto_por         UUID         REFERENCES usuario(id),
  devuelto_registrado_at TIMESTAMPTZ,
  anulado_motivo       TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by           UUID         REFERENCES usuario(id),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (ot_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_met_ot_instr_ot ON met_ot_instrumento (ot_id);
CREATE INDEX IF NOT EXISTS idx_met_ot_instr_estado ON met_ot_instrumento (tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_met_ot_instr_metrologo ON met_ot_instrumento (metrologo_id) WHERE metrologo_id IS NOT NULL;

-- --- 2 · Calibración ligada al ítem y entrega del certificado -------------------
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS ot_instrumento_id   UUID REFERENCES met_ot_instrumento(id);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS entregado_at        TIMESTAMPTZ;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS entrega_medio       VARCHAR(30);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS entrega_destinatario VARCHAR(160);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS entrega_observacion TEXT;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS entregado_por       UUID REFERENCES usuario(id);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS entrega_registrada_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_met_cal_ot ON met_calibracion (ot_id) WHERE deleted_at IS NULL;
-- La bitácora de la calibración registra también la entrega del certificado.
ALTER TABLE met_calibracion_evento DROP CONSTRAINT IF EXISTS met_calibracion_evento_accion_check;
ALTER TABLE met_calibracion_evento ADD CONSTRAINT met_calibracion_evento_accion_check
  CHECK (accion IN ('CREADA', 'EDITADA', 'ENVIADA', 'DEVUELTA', 'FIRMADA', 'EMITIDA', 'REEMISION', 'REEMPLAZADA', 'ENTREGADA'));
CREATE INDEX IF NOT EXISTS idx_met_cal_instrumento ON met_calibracion (ot_instrumento_id) WHERE deleted_at IS NULL;

-- --- 3 · Numeración por laboratorio --------------------------------------------
-- formato: {P} prefijo · {N} correlativo (relleno con ceros) · {AA} año en 2 cifras · {AAAA} año.
-- anual: el correlativo vuelve a 1 cada año (anio = año del último número emitido).
ALTER TABLE met_numeracion ADD COLUMN IF NOT EXISTS formato VARCHAR(40) NOT NULL DEFAULT '{P}-{N}';
ALTER TABLE met_numeracion ADD COLUMN IF NOT EXISTS anual   BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE met_numeracion ADD COLUMN IF NOT EXISTS anio    INT;

-- LMTE (Maqueta Área Eléctrica): HT- termohigrómetros, ME- eléctrica, TF- tiempo y frecuencia.
-- LNF: LCPNF-NNN.AA, correlativo anual (caso LCPNF-010.26). Último número POR CONFIRMAR (pregunta 3).
INSERT INTO met_numeracion (tenant_id, prefijo, ultimo, relleno, formato, anual, anio)
SELECT t.id, v.pre, v.ult, v.rel, v.fmt, v.anual, v.anio FROM tenant t,
  (VALUES ('HT', 0, 0, '{P}-{N}', FALSE, NULL::int),
          ('ME', 0, 0, '{P}-{N}', FALSE, NULL::int),
          ('TF', 0, 0, '{P}-{N}', FALSE, NULL::int),
          ('LCPNF', 10, 3, '{P}-{N}.{AA}', TRUE, 2026)) AS v(pre, ult, rel, fmt, anual, anio)
ON CONFLICT (tenant_id, prefijo) DO NOTHING;

-- Prefijo por proceso (solo si aún no tiene; el administrador lo cambia en Maestros › Numeración).
UPDATE met_proceso p SET prefijo_certificado = v.pre
  FROM (VALUES ('ITME01', 'ME'), ('ITE03', 'TF'), ('LCPNF-IT01', 'LCPNF')) AS v(codigo, pre)
 WHERE p.codigo = v.codigo AND p.prefijo_certificado IS NULL;

-- --- 4 · Parámetro del cierre --------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, 'metrologia', 'cierre_exige_devolucion',
       'El cierre de una OT de calibración exige registrar la devolución de cada instrumento (si / no)', 'si', 1
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
