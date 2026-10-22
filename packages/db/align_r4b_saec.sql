-- =============================================================================
-- LIMS IDIC · Frente r4b · SAEC y munición de prueba de la D11 (T25) · Aiuken
-- =============================================================================
--   1 · Adjuntos de un registro (PDF, PNG o JPEG) para peritajes y fichas
--       técnicas: tabla común; cada módulo comprueba sus propios permisos.
--   2 · Evidencia con oficio (Nº, fecha, unidad solicitante), NUE y RUC de la
--       causa (EP-11 11.31, BL-186).
--   3 · Caso SAEC con descripción y transiciones de estado controladas
--       (EP-11 11.35, BL-226): la API cambia el estado solo por la acción
--       «estado»; aquí se guarda cada transición.
--   4 · Préstamo de evidencias: receptor del acta de salida y estado del
--       reingreso (EP-11 11.33, BL-187).
--   5 · Munición de prueba (EP-11 11.40 y 11.17, EP-05 2.5/3.4, BL-181): lotes,
--       movimientos inmutables y solicitudes LRB/LAM → D11 con cuadratura
--       entregados = usados + devueltos.
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Adjuntos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_adjunto (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenant(id),
  entidad      VARCHAR(40)  NOT NULL,
  entidad_id   UUID         NOT NULL,
  clase        VARCHAR(40)  NOT NULL,
  nombre       VARCHAR(200) NOT NULL,
  mime         VARCHAR(40)  NOT NULL CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  bytes        INTEGER      NOT NULL CHECK (bytes > 0 AND bytes <= 5242880),
  datos        BYTEA        NOT NULL,
  hash_sha256  VARCHAR(64)  NOT NULL,
  subido_por   UUID REFERENCES usuario(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
COMMENT ON TABLE registro_adjunto IS 'Adjuntos (PDF/PNG/JPEG, máx. 5 MB) de un registro: peritaje SAEC, prototipo BPCH (ficha técnica, HDS), ensayo IT23 (curva). Se valida el tipo por sus bytes.';
CREATE INDEX IF NOT EXISTS ix_registro_adjunto ON registro_adjunto (tenant_id, entidad, entidad_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2 · Evidencia: oficio, NUE y RUC
-- -----------------------------------------------------------------------------
ALTER TABLE evidencia ADD COLUMN IF NOT EXISTS nue            VARCHAR(60);
ALTER TABLE evidencia ADD COLUMN IF NOT EXISTS oficio_numero  VARCHAR(60);
ALTER TABLE evidencia ADD COLUMN IF NOT EXISTS oficio_fecha   DATE;
ALTER TABLE evidencia ADD COLUMN IF NOT EXISTS oficio_unidad  VARCHAR(200);
ALTER TABLE evidencia ADD COLUMN IF NOT EXISTS ruc_causa      VARCHAR(20);
COMMENT ON COLUMN evidencia.nue IS 'Número Único de Evidencia que trae el oficio (por defecto, también el código de barras).';
COMMENT ON COLUMN evidencia.ruc_causa IS 'Rol Único de Causa de la Fiscalía (NNNNNNNNNN-D).';
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidencia_nue ON evidencia (tenant_id, upper(nue)) WHERE nue IS NOT NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3 · Caso SAEC: descripción y transiciones
-- -----------------------------------------------------------------------------
ALTER TABLE saec_caso ADD COLUMN IF NOT EXISTS descripcion TEXT;
CREATE TABLE IF NOT EXISTS saec_caso_transicion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  caso_id     UUID         NOT NULL REFERENCES saec_caso(id),
  desde       VARCHAR(20)  NOT NULL,
  hacia       VARCHAR(20)  NOT NULL,
  motivo      TEXT,
  usuario_id  UUID REFERENCES usuario(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE saec_caso_transicion IS 'Historial de estados del caso SAEC (abierto → en proceso → cerrado → archivado; reabrir con motivo).';
CREATE INDEX IF NOT EXISTS ix_saec_caso_transicion ON saec_caso_transicion (caso_id, created_at);

-- -----------------------------------------------------------------------------
-- 4 · Préstamo: acta de salida y reingreso
-- -----------------------------------------------------------------------------
ALTER TABLE evidencia_prestamo ADD COLUMN IF NOT EXISTS receptor_nombre   VARCHAR(200);
ALTER TABLE evidencia_prestamo ADD COLUMN IF NOT EXISTS entregado_at      TIMESTAMPTZ;
ALTER TABLE evidencia_prestamo ADD COLUMN IF NOT EXISTS devuelto_at       TIMESTAMPTZ;
ALTER TABLE evidencia_prestamo ADD COLUMN IF NOT EXISTS estado_reingreso  VARCHAR(200);

-- -----------------------------------------------------------------------------
-- 5 · Munición de prueba
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS d11_municion_lote (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  lote          VARCHAR(60)   NOT NULL,
  calibre       VARCHAR(80)   NOT NULL,
  descripcion   VARCHAR(200),
  norma         VARCHAR(80),
  nivel         VARCHAR(40),
  masa_bala_g   NUMERIC(8, 3),
  velocidad_ms  NUMERIC(8, 2),
  activo        BOOLEAN       NOT NULL DEFAULT true,
  created_by    UUID REFERENCES usuario(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_d11_municion_lote ON d11_municion_lote (tenant_id, upper(lote), upper(calibre));
COMMENT ON TABLE d11_municion_lote IS 'Inventario de munición de prueba de la D11 por lote de origen. El saldo sale de d11_municion_movimiento.';

CREATE TABLE IF NOT EXISTS d11_municion_solicitud (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenant(id),
  codigo             VARCHAR(30)   NOT NULL,
  unidad_id          UUID          NOT NULL REFERENCES unidad(id),
  ot_id              UUID REFERENCES orden_trabajo(id),
  item_hcp           VARCHAR(80),
  norma              VARCHAR(80)   NOT NULL,
  nivel              VARCHAR(40),
  calibre            VARCHAR(80)   NOT NULL,
  masa_bala_g        NUMERIC(8, 3),
  velocidad_ms       NUMERIC(8, 2),
  velocidad_tol_ms   NUMERIC(8, 2),
  cantidad_pedida    INTEGER       NOT NULL CHECK (cantidad_pedida >= 1),
  estado             VARCHAR(20)   NOT NULL DEFAULT 'solicitada'
                     CHECK (estado IN ('solicitada', 'entregada', 'cerrada', 'anulada')),
  lote_id            UUID REFERENCES d11_municion_lote(id),
  entregados         INTEGER CHECK (entregados IS NULL OR entregados >= 0),
  usados             INTEGER CHECK (usados IS NULL OR usados >= 0),
  devueltos          INTEGER CHECK (devueltos IS NULL OR devueltos >= 0),
  observaciones      TEXT,
  solicitado_por     UUID REFERENCES usuario(id),
  entregado_por      UUID REFERENCES usuario(id),
  entregado_at       TIMESTAMPTZ,
  cerrado_por        UUID REFERENCES usuario(id),
  cerrado_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_d11_municion_cuadratura CHECK (estado <> 'cerrada' OR entregados = COALESCE(usados, 0) + COALESCE(devueltos, 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_d11_municion_solicitud ON d11_municion_solicitud (tenant_id, codigo);
COMMENT ON TABLE d11_municion_solicitud IS 'Orden interna de munición de prueba (LRB/LAM → D11): pedido estructurado, entrega por lote y acta de entregados/usados/devueltos (cuadra al cerrar).';

CREATE TABLE IF NOT EXISTS d11_municion_movimiento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenant(id),
  lote_id        UUID          NOT NULL REFERENCES d11_municion_lote(id),
  tipo           VARCHAR(20)   NOT NULL CHECK (tipo IN ('entrada', 'entrega', 'devolucion', 'uso', 'ajuste_baja')),
  cantidad       INTEGER       NOT NULL CHECK (cantidad >= 1),
  solicitud_id   UUID REFERENCES d11_municion_solicitud(id),
  ot_id          UUID REFERENCES orden_trabajo(id),
  arma_ot_id     UUID REFERENCES d11_arma_ot(id),
  observaciones  TEXT,
  registrado_por UUID REFERENCES usuario(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_d11_municion_movimiento ON d11_municion_movimiento (tenant_id, lote_id);
COMMENT ON TABLE d11_municion_movimiento IS 'Entradas y salidas de munición de prueba (entrada/devolución suman; entrega/uso/ajuste restan). Inmutable.';
CREATE OR REPLACE FUNCTION d11_municion_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de munición de prueba no se modifican ni se borran: registre un movimiento nuevo.';
END $$;
DROP TRIGGER IF EXISTS trg_d11_municion_inmutable ON d11_municion_movimiento;
CREATE TRIGGER trg_d11_municion_inmutable BEFORE UPDATE OR DELETE ON d11_municion_movimiento
  FOR EACH ROW EXECUTE FUNCTION d11_municion_inmutable();

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'municion.solicitar', 'municion', 'solicitar',
   'Laboratorios (LRB, LAM): pedir munición de prueba a la D11 y rendir los cartuchos usados y devueltos.'),
  (gen_random_uuid(), 'municion.gestionar', 'municion', 'gestionar',
   'D11: inventario de munición de prueba (lotes, entradas), entrega a los laboratorios y cierre de la cuadratura.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('ANALISTA', 'municion.solicitar'), ('ANALISTA_SR', 'municion.solicitar'), ('TECNICO', 'municion.solicitar'),
    ('INSPECTOR', 'municion.solicitar'), ('JEFE_LAB', 'municion.solicitar'),
    ('INSPECTOR', 'municion.gestionar'), ('JEFE_LAB', 'municion.gestionar'),
    ('SUPERADMIN', 'municion.solicitar'), ('SUPERADMIN', 'municion.gestionar')
  ) AS m(rol, perm)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
