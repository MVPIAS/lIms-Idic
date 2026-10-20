-- =============================================================================
-- align_r1b_ordenes_internas.sql · Órdenes internas: el destino recibe, responde y cierra
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt. Reglas: docs/FLUJO_LABORATORIO.md › «Órdenes internas».
-- Especificación: EP-01 0.6, 2.2, 3.7 y 5.5; EP-02 0.6 y 5.4; EP-03 0.6, 2.2,
-- 3.5 y 5.5; EP-05 4.10 (tema transversal T06).
--
--   1. Datos de la emisión (EP-01 2.2): muestra de origen, requisito y punto de
--      la especificación, fecha de envío de la muestra e IE de referencia (LAL).
--   2. Recepción por el laboratorio de destino (quién y cuándo).
--   3. Respuesta del destino: Nº de informe de respuesta («I.E. N° …/año» o
--      «Boletín N° …»), informe, horas, insumos y costo directo.
--   4. Cierre por el destino y «Dar por recibido» del laboratorio solicitante.
--   5. Permisos: orden_interna.emitir (analista, jefaturas de laboratorio,
--      inspectores y planificación: EP-01 2.2 «Rol: Analista o Jefe de
--      Laboratorio»), orden_interna.responder (jefaturas del laboratorio de
--      destino: EP-01 0.6 y 5.5) y orden_interna.anular (quien gestiona la OT
--      de origen: antes ot.crear; el analista emite pero no anula).
-- =============================================================================

-- --- 1 · Emisión -------------------------------------------------------------
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS muestra_id            UUID REFERENCES muestra(id);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS requisito             TEXT;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS fecha_envio           DATE;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS ie_referencia         VARCHAR(80);

-- --- 2 · Recepción -----------------------------------------------------------
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS recibida_at           TIMESTAMPTZ;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS recibida_por          UUID REFERENCES usuario(id);

-- --- 3 · Respuesta -----------------------------------------------------------
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS respuesta_numero      VARCHAR(80);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS respuesta_informe     TEXT;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS respuesta_horas       NUMERIC(8,2);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS respuesta_insumos     TEXT;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS costo_directo         NUMERIC(14,2);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS respondida_at         TIMESTAMPTZ;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS respondida_por        UUID REFERENCES usuario(id);

-- --- 4 · Cierre y vuelta al solicitante ----------------------------------------
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS cerrada_at            TIMESTAMPTZ;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS cerrada_por           UUID REFERENCES usuario(id);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS aceptada_at           TIMESTAMPTZ;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS aceptada_por          UUID REFERENCES usuario(id);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS aceptada_observacion  TEXT;

COMMENT ON COLUMN orden_interna.requisito IS 'Requisito y punto de la especificación del solicitante (EP-01 2.2), p. ej. «tafilete 0,6–0,8 mm IUP/4».';
COMMENT ON COLUMN orden_interna.ie_referencia IS 'IE de referencia de la OT madre (OT interna de LAL, EP-02 0.6).';
COMMENT ON COLUMN orden_interna.respuesta_numero IS 'Nº del informe de respuesta del destino (numeración RESPUESTA_OI: «I.E. N° {NI_N}/{AAAA}» por defecto).';
COMMENT ON COLUMN orden_interna.costo_directo IS 'Costo directo del trabajo del destino; se imputa a la OT del laboratorio solicitante (EP-01 §8.5).';
COMMENT ON COLUMN orden_interna.aceptada_at IS 'El laboratorio solicitante dio por recibido el informe de respuesta («Dar por recibido → evaluación», EP-01 3.7).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_orden_interna_respuesta_no_negativa') THEN
    ALTER TABLE orden_interna ADD CONSTRAINT ck_orden_interna_respuesta_no_negativa CHECK (
      (respuesta_horas IS NULL OR respuesta_horas >= 0) AND (costo_directo IS NULL OR costo_directo >= 0));
  END IF;
END $$;

-- Historial: nuevas acciones del ciclo (la CHECK de align_frente_k.sql solo admitía
-- creada/editada/estado/anulada/eliminada). Se sustituye una sola vez.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_orden_interna_historial_accion') THEN
    ALTER TABLE orden_interna_historial DROP CONSTRAINT IF EXISTS orden_interna_historial_accion_check;
    ALTER TABLE orden_interna_historial ADD CONSTRAINT ck_orden_interna_historial_accion CHECK (accion IN (
      'creada', 'editada', 'estado', 'anulada', 'eliminada',
      'recibida', 'respondida', 'respuesta_corregida', 'cerrada', 'dada_por_recibida'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orden_interna_bandeja ON orden_interna (tenant_id, estado, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orden_interna_muestra ON orden_interna (muestra_id) WHERE muestra_id IS NOT NULL;

-- --- 5 · Permisos ------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'orden_interna.emitir', 'orden_interna', 'emitir',
   'Emitir una orden interna a otro laboratorio desde una OT de su alcance, editarla mientras está abierta y dar por recibido su informe de respuesta'),
  (gen_random_uuid(), 'orden_interna.responder', 'orden_interna', 'responder',
   'Recibir, responder (informe, horas, insumos y costo directo) y cerrar las órdenes internas que llegan a su laboratorio')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'orden_interna.emitir'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'ANALISTA', 'ANALISTA_SR', 'JEFE_LAB', 'JEFELAB', 'JEFE_SECCION',
                    'INSPECTOR', 'PLANIFICACION', 'PLANIFICADOR_LAB')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'orden_interna.responder'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'JEFE_LAB', 'JEFELAB', 'JEFE_SECCION')
ON CONFLICT DO NOTHING;

-- Anular o borrar una orden: quien gestiona la OT de origen (los que tenían
-- ot.crear) y las jefaturas de laboratorio; el analista emite pero no anula.
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'orden_interna.anular', 'orden_interna', 'anular',
   'Anular con motivo (o borrar mientras está abierta) una orden interna de una OT de su alcance')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'orden_interna.anular'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'COMERCIAL', 'PLANIFICACION', 'PLANIFICADOR_LAB', 'JEFE_LAB', 'JEFELAB', 'JEFE_SECCION')
ON CONFLICT DO NOTHING;
