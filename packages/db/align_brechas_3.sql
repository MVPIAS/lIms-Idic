-- =============================================================================
-- Cierre de brechas del contrato · frente 3 (equipos y consumibles)
--
-- §4.4.5 · Movimientos de lotes vinculados a OT / muestra / método / actividad.
--   movimiento_consumible gana ot_id y actividad. El descuento automático de la
--   captura ya traía muestra, método y resultado; ahora además la OT (de la
--   muestra) y la actividad «análisis». Los movimientos manuales pueden llevar
--   el mismo vínculo (opcional). Se rellenan los asientos existentes: la OT
--   desde la muestra y la actividad «análisis» en los consumos automáticos.
--
-- §4.4.7 · Comunicación serie (RS-232) y Ethernet con instrumentos.
--   instrumento_dispositivo: el «agente de instrumentos» instalado en el PC
--   conectado al equipo (tools/agente-instrumentos). Se autentica con un token
--   propio (se guarda solo su SHA-256; el token se muestra una sola vez al darlo
--   de alta) y envía las tramas que lee del puerto serie o del socket TCP. Las
--   lecturas entran como importaciones de origen DISPOSITIVO, pendientes de
--   revisión en «Datos de instrumentos», igual que un archivo cargado a mano.
--   Alta y revocación con instrumento.configurar (permiso existente).
--
-- Aditivo e idempotente: puede ejecutarse varias veces.
-- =============================================================================

-- --------------------------------------------------------------- §4.4.5 ---
ALTER TABLE movimiento_consumible ADD COLUMN IF NOT EXISTS ot_id     UUID REFERENCES orden_trabajo(id);
ALTER TABLE movimiento_consumible ADD COLUMN IF NOT EXISTS actividad VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_mov_consumible_actividad') THEN
    ALTER TABLE movimiento_consumible ADD CONSTRAINT ck_mov_consumible_actividad CHECK (
      actividad IS NULL OR actividad IN ('analisis', 'preparacion', 'control_calidad', 'calibracion',
                                         'mantencion', 'limpieza', 'muestreo', 'otro'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mov_consumible_ot ON movimiento_consumible(ot_id) WHERE ot_id IS NOT NULL;

-- Asientos anteriores: la OT sale de la muestra; los consumos automáticos son de análisis.
UPDATE movimiento_consumible m
   SET ot_id = mu.ot_id
  FROM muestra mu
 WHERE mu.id = m.muestra_id AND m.ot_id IS NULL AND mu.ot_id IS NOT NULL;
UPDATE movimiento_consumible SET actividad = 'analisis'
 WHERE actividad IS NULL AND (automatico OR resultado_id IS NOT NULL);

COMMENT ON COLUMN movimiento_consumible.ot_id IS '§4.4.5: OT a la que se imputa el movimiento (de la muestra o elegida a mano).';
COMMENT ON COLUMN movimiento_consumible.actividad IS '§4.4.5: actividad del movimiento (analisis, preparacion, control_calidad, calibracion, mantencion, limpieza, muestreo, otro).';

-- --------------------------------------------------------------- §4.4.7 ---
CREATE TABLE IF NOT EXISTS instrumento_dispositivo (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  perfil_id         UUID NOT NULL REFERENCES instrumento_perfil(id),
  nombre            VARCHAR(120) NOT NULL,
  conexion          VARCHAR(10) NOT NULL DEFAULT 'SERIE',
  ubicacion         VARCHAR(200),
  token_hash        CHAR(64) NOT NULL,                     -- SHA-256 del token; el token no se guarda
  token_prefijo     VARCHAR(20) NOT NULL,                  -- inicio del token, para reconocerlo en pantalla
  creado_por        UUID REFERENCES usuario(id),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revocado_en       TIMESTAMPTZ,
  revocado_por      UUID REFERENCES usuario(id),
  motivo_revocacion VARCHAR(500),
  ultimo_contacto   TIMESTAMPTZ,
  ultima_ip         VARCHAR(64),
  version_agente    VARCHAR(40),
  envios            INT NOT NULL DEFAULT 0,
  CONSTRAINT ck_instr_disp_conexion CHECK (conexion IN ('SERIE', 'ETHERNET'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_instr_disp_token ON instrumento_dispositivo (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_instr_disp_nombre ON instrumento_dispositivo (tenant_id, lower(nombre)) WHERE revocado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_instr_disp_perfil ON instrumento_dispositivo (perfil_id);

-- Las lecturas de un dispositivo son importaciones de origen DISPOSITIVO.
ALTER TABLE instrumento_importacion ALTER COLUMN origen TYPE VARCHAR(12);
ALTER TABLE instrumento_importacion ADD COLUMN IF NOT EXISTS dispositivo_id UUID REFERENCES instrumento_dispositivo(id);
ALTER TABLE instrumento_importacion DROP CONSTRAINT IF EXISTS ck_instr_imp_origen;
ALTER TABLE instrumento_importacion ADD CONSTRAINT ck_instr_imp_origen CHECK (origen IN ('MANUAL', 'CARPETA', 'DISPOSITIVO'));
CREATE INDEX IF NOT EXISTS idx_instr_imp_pendientes ON instrumento_importacion (tenant_id, creado_en DESC) WHERE estado = 'PREVISTA';

COMMENT ON TABLE instrumento_dispositivo IS 'Instrumentos (§4.4.7): agente conectado por puerto serie (RS-232) o Ethernet; token propio (solo su SHA-256), revocable.';
COMMENT ON COLUMN instrumento_importacion.dispositivo_id IS '§4.4.7: dispositivo (agente) que envió las lecturas, si el origen es DISPOSITIVO.';
