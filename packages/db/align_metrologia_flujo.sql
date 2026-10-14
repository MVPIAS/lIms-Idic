-- =============================================================================
-- align_metrologia_flujo.sql · Metrología completa (LMT, LMTE, LNF) · Aiuken
-- -----------------------------------------------------------------------------
-- 1. Cada proceso pertenece a un laboratorio de la Sección Metrología (SAM):
--    LMT (mecánica), LMTE (área eléctrica: temperatura, eléctrica, tiempo) y
--    LNF (Laboratorio Nacional de Fuerza). La calibración guarda su
--    laboratorio (unidad_id) para filtrar por alcance.
-- 2. Procesos nuevos: LCPNF-IT01 (ISO 376, motor validado contra la planilla
--    del LNF), ITME01 (eléctrica) e ITE03 (tiempo y frecuencia) con el
--    formulario estándar por puntos, y PTS01 (reserva para cualquier magnitud).
-- 3. Circuito del certificado: borrador → en revisión → emitida (o devuelta
--    al borrador con motivo). Cada paso queda en met_calibracion_evento.
-- 4. El código CAL-AAAA-NNNN toma el año de la fecha de calibración.
-- Aditivo e idempotente. Requiere align_metrologia.sql y align_admin_roles.sql.
-- =============================================================================

-- Magnitudes sin planilla del IDIC (unidad por defecto; cada punto puede llevar la suya)
INSERT INTO met_magnitud (codigo, nombre, unidad, decimales) VALUES
 ('electrica', 'Magnitudes eléctricas', 'V', 4),
 ('tiempo',    'Tiempo y frecuencia',   's', 6),
 ('general',   'Otra magnitud',         '-', 4)
ON CONFLICT (codigo) DO NOTHING;

-- Laboratorio y acreditación por proceso ---------------------------------------
ALTER TABLE met_proceso ADD COLUMN IF NOT EXISTS laboratorio  VARCHAR(10);   -- código de unidad (LMT, LMTE, LNF); NULL = lo elige quien calibra
ALTER TABLE met_proceso ADD COLUMN IF NOT EXISTS acreditacion VARCHAR(60);   -- NULL = sin acreditación declarada

UPDATE met_proceso SET laboratorio = 'LMT'
 WHERE laboratorio IS NULL AND codigo ~ '^IT(M|P|L|V|F|PT)[0-9]';
UPDATE met_proceso SET laboratorio = 'LMTE'
 WHERE laboratorio IS NULL AND codigo IN ('ITT01', 'ITT02');

UPDATE met_proceso p SET acreditacion = a.acr
  FROM (VALUES ('masa','LC 001'), ('longitud','LC 004'), ('fuerza','LC 005'), ('presion','LC 022'),
               ('volumen','LC 023'), ('par','LC 108'), ('temperatura','LC 155')) AS a(mag, acr),
       met_magnitud m
 WHERE m.id = p.magnitud_id AND m.codigo = a.mag AND p.acreditacion IS NULL AND p.laboratorio IN ('LMT', 'LMTE');

INSERT INTO met_proceso (codigo, magnitud_id, nombre, metodo, norma, laboratorio)
SELECT p.codigo, m.id, p.nombre, p.metodo, p.norma, p.lab FROM (VALUES
 ('LCPNF-IT01', 'fuerza',    'Instrumentos de medida de fuerza (ISO 376)',
  'LCPNF-PG01-P01-IT01 · Calibración de instrumentos de medición de fuerza', 'ISO 376:2011', 'LNF'),
 ('ITME01',     'electrica', 'Instrumentos eléctricos (voltímetro, amperímetro, óhmetro, multímetro)',
  'LMT-PG01-P01-ITME01 · Formulario estándar por puntos (instrucción no entregada)', NULL, 'LMTE'),
 ('ITE03',      'tiempo',    'Contadores y generadores de tiempo',
  'LMT-PG01-P01-ITE03 · Formulario estándar por puntos (instrucción no entregada)', NULL, 'LMTE'),
 ('PTS01',      'general',   'Otra magnitud · formulario estándar por puntos',
  'Comparación directa con patrón (GUM, k = 2)', NULL, NULL)
) AS p(codigo, mag, nombre, metodo, norma, lab)
JOIN met_magnitud m ON m.codigo = p.mag
ON CONFLICT (codigo) DO NOTHING;

-- Calibración: laboratorio, fecha y circuito del certificado -------------------
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS unidad_id         UUID REFERENCES unidad(id);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS fecha_calibracion DATE;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT now();
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS enviado_at        TIMESTAMPTZ;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS enviado_by        UUID REFERENCES usuario(id);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS emitido_by        UUID REFERENCES usuario(id);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS devuelto_at       TIMESTAMPTZ;
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS devuelto_by       UUID REFERENCES usuario(id);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS devuelto_motivo   TEXT;
CREATE INDEX IF NOT EXISTS idx_met_cal_unidad ON met_calibracion(unidad_id, estado) WHERE deleted_at IS NULL;

-- Las calibraciones guardadas antes de este cambio quedaban «calculadas» sin
-- poder emitirse desde la lista: pasan a borrador, que es lo que eran.
UPDATE met_calibracion SET estado = 'borrador' WHERE estado = 'calculada';

-- Laboratorio de las calibraciones existentes, desde su proceso.
UPDATE met_calibracion c SET unidad_id = u.id
  FROM met_proceso p, unidad u
 WHERE c.unidad_id IS NULL AND p.id = c.proceso_id AND p.laboratorio IS NOT NULL
   AND u.codigo = p.laboratorio AND u.tenant_id = c.tenant_id;

UPDATE met_calibracion SET fecha_calibracion = created_at::date WHERE fecha_calibracion IS NULL;

-- Bitácora del circuito (quién guardó, envió, devolvió y emitió, y cuándo)
CREATE TABLE IF NOT EXISTS met_calibracion_evento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calibracion_id UUID NOT NULL REFERENCES met_calibracion(id) ON DELETE CASCADE,
  accion         VARCHAR(20) NOT NULL CHECK (accion IN ('CREADA','EDITADA','ENVIADA','DEVUELTA','EMITIDA')),
  estado_desde   VARCHAR(20),
  estado_hasta   VARCHAR(20),
  usuario_id     UUID REFERENCES usuario(id),
  comentario     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_met_cal_evento ON met_calibracion_evento(calibracion_id, created_at);
