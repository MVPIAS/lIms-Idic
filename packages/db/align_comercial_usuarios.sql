-- =============================================================================
-- LIMS IDIC · Comercial, usuarios y transversales · Aiuken
-- =============================================================================
-- Aditivo e idempotente (se puede reaplicar sin error). Ver docs/FLUJO_COMERCIAL_USUARIOS.md.
--
--   1. Cotización: la Sección Ventas registra la aceptación y la anulación
--      (permisos `cotizacion.aceptar` y `cotizacion.anular`, separados de
--      `cotizacion.aprobar`). Marca de vencimiento (`vencida_at`) y el estado
--      `expirada` vuelve a ser vigente con la etiqueta «Vencida».
--   2. Usuario: cambio de contraseña obligatorio en el primer ingreso
--      (`debe_cambiar_password`) y fecha del último cambio.
--   3. No conformidades: vínculo con OT, resultado y equipo, unidad (alcance)
--      y permisos `nc.ver` / `nc.crear` (`nc.gestionar` ya existía).
-- =============================================================================

BEGIN;

-- --- 1. Cotización -------------------------------------------------------------
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS vencida_at TIMESTAMPTZ;
COMMENT ON COLUMN cotizacion.vencida_at IS
  'Momento en que el sistema pasó la cotización a «Vencida» (estado expirada) por superar valida_hasta.';

-- «Vencida» deja de ser solo histórico: una Abierta fuera de validez pasa a ella.
UPDATE parametro_sistema
   SET etiqueta = 'Vencida', activo = TRUE
 WHERE categoria = 'estado_cotizacion' AND codigo = 'expirada';

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'cotizacion.aceptar', 'cotizacion', 'aceptar',
   'Registrar la aceptación de una cotización (OC, OPI/resolución, correo, pago adelantado o disposición del Director). Genera la OT.'),
  (gen_random_uuid(), 'cotizacion.anular', 'cotizacion', 'anular',
   'Anular una cotización Abierta (con motivo) o rechazar una histórica.')
ON CONFLICT (codigo) DO NOTHING;

-- Sección Ventas (rol COMERCIAL) + quienes ya tenían cotizacion.aprobar.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo IN ('cotizacion.aceptar', 'cotizacion.anular')
 WHERE r.codigo = 'COMERCIAL'
    OR EXISTS (SELECT 1 FROM rol_permiso rp JOIN permiso pa ON pa.id = rp.permiso_id
                WHERE rp.rol_id = r.id AND pa.codigo = 'cotizacion.aprobar')
ON CONFLICT DO NOTHING;

-- --- 2. Usuario: cambio de contraseña obligatorio -------------------------------
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS password_cambiada_at TIMESTAMPTZ;
COMMENT ON COLUMN usuario.debe_cambiar_password IS
  'TRUE tras crear el usuario o restablecer su contraseña: hasta que la cambie solo puede usar el cambio de contraseña.';

-- --- 3. No conformidades ----------------------------------------------------------
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS unidad_id    UUID REFERENCES unidad(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS ot_id        UUID REFERENCES orden_trabajo(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS resultado_id UUID;
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS equipo_id    UUID REFERENCES equipo(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS titulo       VARCHAR(200);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS cierre_comentario TEXT;
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_nc_unidad ON no_conformidad (tenant_id, unidad_id);
CREATE INDEX IF NOT EXISTS idx_nc_ot ON no_conformidad (ot_id) WHERE ot_id IS NOT NULL;
COMMENT ON COLUMN no_conformidad.resultado_id IS
  'Resultado afectado (sin FK: resultado puede estar particionado o archivado).';

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'nc.ver',   'nc', 'ver',   'Ver no conformidades de su alcance'),
  (gen_random_uuid(), 'nc.crear', 'nc', 'crear', 'Levantar (registrar) una no conformidad')
ON CONFLICT (codigo) DO NOTHING;

-- Ver y levantar: quien gestiona NC + personal de laboratorio. LECTOR solo ve.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo IN ('nc.ver', 'nc.crear')
 WHERE r.codigo IN ('REVISOR', 'ANALISTA', 'ANALISTA_SR', 'TECNICO', 'METROLOGO', 'INSPECTOR')
    OR EXISTS (SELECT 1 FROM rol_permiso rp JOIN permiso pg ON pg.id = rp.permiso_id
                WHERE rp.rol_id = r.id AND pg.codigo = 'nc.gestionar')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'nc.ver'
 WHERE r.codigo = 'LECTOR'
ON CONFLICT DO NOTHING;

COMMIT;
