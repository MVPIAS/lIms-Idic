-- =============================================================================
-- LIMS IDIC · Requerimiento BPCH (OT sin cotización) · Aiuken
--   Reunión 11 (BPCH y Delegaciones, 06-11-2026): el Banco de Pruebas no cotiza;
--   genera la OT desde un «Requerimiento» que reemplaza a la cotización:
--     1. Lo elabora el Jefe de la SCC, un Jefe de Escalón (Internaciones o
--        Producción Nacional) o el Jefe de la Delegación 11 (borrador).
--     2. Lo valida el Jefe de Escalón (otra persona) → nace la OT, derivada a la
--        sucursal dentro del LIMS (sin imprimir, firmar, escanear ni correo).
--     3. La sucursal registra muestras e inspección; cierra con el informe de
--        inspección y el cierre de la OT (flujo general).
--   Datos: empresa y plantas, documento de origen (oficio o RPI) con fecha,
--   asistencia técnica, instrucciones, autorización de OT sin cobro
--   (comunicación y su número) y técnico definido. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bpch_requerimiento (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenant(id),
  numero                 VARCHAR(30)  NOT NULL,
  -- internaciones | produccion_nacional | scc | delegacion_11
  escalon                VARCHAR(24)  NOT NULL,
  cliente_id             UUID NOT NULL REFERENCES cliente(id),
  planta_ids             UUID[]       NOT NULL DEFAULT '{}',
  -- oficio | rpi
  doc_origen_tipo        VARCHAR(10)  NOT NULL,
  doc_origen_numero      VARCHAR(80)  NOT NULL,
  doc_origen_fecha       DATE         NOT NULL,
  asistencia_tecnica     BOOLEAN      NOT NULL DEFAULT FALSE,
  instrucciones          TEXT,
  con_cobro              BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Autorización de OT sin cobro: comunicación breve y su número.
  sin_cobro_comunicacion TEXT,
  sin_cobro_numero       VARCHAR(80),
  tecnico                VARCHAR(160),
  -- Sucursal, delegación o sección del BPCH a la que se deriva la OT.
  unidad_destino_id      UUID NOT NULL,
  cat_elemento_id        UUID,
  elemento_generico      VARCHAR(240),
  -- borrador | validado | anulado
  estado                 VARCHAR(12)  NOT NULL DEFAULT 'borrador',
  validado_por           UUID,
  validado_at            TIMESTAMPTZ,
  anulado_motivo         TEXT,
  ot_id                  UUID REFERENCES orden_trabajo(id),
  created_by             UUID,
  updated_by             UUID,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_bpch_requerimiento_numero UNIQUE (tenant_id, numero),
  CONSTRAINT ck_bpch_req_escalon CHECK (escalon IN ('internaciones', 'produccion_nacional', 'scc', 'delegacion_11')),
  CONSTRAINT ck_bpch_req_doc CHECK (doc_origen_tipo IN ('oficio', 'rpi')),
  CONSTRAINT ck_bpch_req_estado CHECK (estado IN ('borrador', 'validado', 'anulado')),
  CONSTRAINT ck_bpch_req_sin_cobro CHECK (con_cobro OR (sin_cobro_numero IS NOT NULL AND sin_cobro_comunicacion IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_bpch_requerimiento_tenant ON bpch_requerimiento (tenant_id, estado);
CREATE INDEX IF NOT EXISTS ix_bpch_requerimiento_ot ON bpch_requerimiento (ot_id);

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'bpch.requerimiento.ver',      'bpch', 'requerimiento.ver',
   'Ver los requerimientos BPCH (OT sin cotización)'),
  (gen_random_uuid(), 'bpch.requerimiento.crear',    'bpch', 'requerimiento.crear',
   'Elaborar un requerimiento BPCH: Jefe SCC, Jefes de Escalón y Jefe de la Delegación 11'),
  (gen_random_uuid(), 'bpch.requerimiento.validar',  'bpch', 'requerimiento.validar',
   'Validar el requerimiento y generar la OT derivada a la sucursal (Jefe de Escalón)')
ON CONFLICT (codigo) DO NOTHING;

-- Ver: jefaturas, inspectores y la sucursal (que recibe la OT).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.requerimiento.ver'
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFEDCO', 'JEFE_SECCION',
                    'JEFE_LAB', 'JEFELAB', 'INSPECTOR', 'LECTOR')
ON CONFLICT DO NOTHING;

-- Elaborar y validar: jefaturas (Jefe SCC, Jefes de Escalón y Jefe D11 tienen
-- rol de jefatura con alcance en su unidad). Quién es quién lo confirma el IDIC.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo IN ('bpch.requerimiento.crear', 'bpch.requerimiento.validar')
 WHERE r.codigo IN ('SUPERADMIN', 'DIRECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO', 'JEFE_SECCION', 'JEFE_LAB', 'JEFELAB')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lims_lectura') THEN
    EXECUTE 'GRANT SELECT ON bpch_requerimiento TO lims_lectura';
  END IF;
END $$;
