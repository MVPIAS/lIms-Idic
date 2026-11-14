-- =============================================================================
-- LIMS IDIC · Frente f1 · Solicitud de adquisición (IDIC-PG06-IT02-FORM01) · Aiuken
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql.
-- Reglas puras: apps/api/src/solicitud-adquisicion/reglas-adquisicion.ts.
--
-- Mismo procedimiento del IDIC, digitalizado (respuesta SPC 5 al Depto.
-- Comercial, oct-2026): el laboratorio crea la solicitud, su jefatura da el V°B°
-- y la Sección Abastecimiento (SAB) la recibe; luego SAB anota el Nº de la O/C,
-- su fecha, el proveedor y su estado. Convive con los sistemas de compra de SAB y
-- Finanzas (DFZ): NO maneja presupuesto, ni las firmas de Finanzas y Dirección,
-- ni emite la O/C.
--   1 · solicitud_adquisicion, sus ítems y su historial.
--   2 · Numeración: regla general del tipo SOLICITUD_ADQUISICION por unidad (por confirmar).
--   3 · Permisos adquisicion.ver / crear / visar / gestionar.
-- =============================================================================

-- --- 1 · Solicitud, ítems e historial ------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitud_adquisicion (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID         NOT NULL REFERENCES tenant(id),
  -- Laboratorio solicitante (alcance por unidad).
  unidad_id               UUID         NOT NULL REFERENCES unidad(id),
  -- «Nº REGISTRO (interno centro costo solicitante)»: se asigna al enviarla.
  numero                  VARCHAR(80),
  estado                  VARCHAR(20)  NOT NULL DEFAULT 'borrador',
  fecha                   DATE         NOT NULL,
  -- «NOMBRE Y CENTRO DE COSTO DE SOLICITANTE» y «NOMBRE DEL USUARIO SOLICITANTE» (con su cargo).
  centro_costo            VARCHAR(200) NOT NULL,
  solicitante_nombre      VARCHAR(200) NOT NULL,
  solicitante_cargo       VARCHAR(200),
  -- «COMPRA CON DELEGACIÓN DE ATRIBUCIONES» SÍ/NO.
  delegacion_atribuciones BOOLEAN      NOT NULL DEFAULT FALSE,
  -- «OBJETIVO DE LA ADQUISICIÓN».
  objetivo                TEXT         NOT NULL,
  -- Suma el 19 % IVA al sub-total (FALSE: valores con impuesto incluido o exentos).
  aplica_iva              BOOLEAN      NOT NULL DEFAULT TRUE,
  ot_id                   UUID         REFERENCES orden_trabajo(id),
  creado_por              UUID         REFERENCES usuario(id),
  enviada_por             UUID         REFERENCES usuario(id),
  enviada_at              TIMESTAMPTZ,
  visada_por              UUID         REFERENCES usuario(id),
  visada_at               TIMESTAMPTZ,
  devuelta_motivo         TEXT,
  -- «USO EXCLUSIVO SAB · Nº (Nº REG. INTERNO SECCIÓN ABAST.)».
  sab_numero              VARCHAR(60),
  sab_recibida_por        UUID         REFERENCES usuario(id),
  sab_recibida_at         TIMESTAMPTZ,
  -- Orden de compra registrada por SAB (la emite su sistema de compras).
  oc_numero               VARCHAR(60),
  oc_fecha                DATE,
  oc_proveedor            VARCHAR(200),
  oc_estado               VARCHAR(120),
  oc_registrada_por       UUID         REFERENCES usuario(id),
  oc_registrada_at        TIMESTAMPTZ,
  bodega_fecha            DATE,
  bodega_recibida_por     UUID         REFERENCES usuario(id),
  bodega_recibida_at      TIMESTAMPTZ,
  anulada_motivo          TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_solicitud_adquisicion_estado CHECK (estado IN
    ('borrador', 'enviada', 'devuelta', 'visada', 'recibida_sab', 'en_compra', 'recibida_bodega', 'anulada'))
);
COMMENT ON TABLE solicitud_adquisicion IS
  'Solicitud de adquisición de bienes y/o servicios (IDIC-PG06-IT02-FORM01 Rev. 02): la crea el laboratorio, la visa su jefatura y la recibe Abastecimiento (SAB), que anota la O/C. No maneja presupuesto ni las firmas de Finanzas y Dirección.';
COMMENT ON COLUMN solicitud_adquisicion.numero IS 'Nº de registro interno del centro de costo solicitante (numeración SOLICITUD_ADQUISICION), asignado al enviarla a la jefatura.';
COMMENT ON COLUMN solicitud_adquisicion.sab_numero IS 'Nº de registro interno de la Sección Abastecimiento (casillero «USO EXCLUSIVO SAB»).';
COMMENT ON COLUMN solicitud_adquisicion.oc_estado IS 'Estado de la O/C en el sistema de compras de SAB, tal como lo anota SAB.';
CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitud_adquisicion_numero ON solicitud_adquisicion (tenant_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_solicitud_adquisicion_estado ON solicitud_adquisicion (tenant_id, estado);
CREATE INDEX IF NOT EXISTS ix_solicitud_adquisicion_unidad ON solicitud_adquisicion (unidad_id);
CREATE INDEX IF NOT EXISTS ix_solicitud_adquisicion_ot ON solicitud_adquisicion (ot_id) WHERE ot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS solicitud_adquisicion_item (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenant(id),
  solicitud_id    UUID          NOT NULL REFERENCES solicitud_adquisicion(id) ON DELETE CASCADE,
  orden           INTEGER       NOT NULL,
  -- «CANTIDAD A ADQUIRIR».
  cantidad        NUMERIC(14,3) NOT NULL,
  unidad_medida   VARCHAR(40),
  -- «CARACTERÍSTICAS DETALLADAS DEL BIEN O SERVICIO REQUERIDO».
  descripcion     TEXT          NOT NULL,
  -- «VALOR UNITARIO» estimado (pesos); el TOTAL del ítem se calcula.
  valor_unitario  NUMERIC(14,2),
  consumible_id   UUID          REFERENCES consumible(id),
  equipo_id       UUID          REFERENCES equipo(id),
  CONSTRAINT ck_solicitud_adquisicion_item_cantidad CHECK (cantidad > 0),
  CONSTRAINT ck_solicitud_adquisicion_item_valor CHECK (valor_unitario IS NULL OR valor_unitario >= 0),
  CONSTRAINT ck_solicitud_adquisicion_item_vinculo CHECK (consumible_id IS NULL OR equipo_id IS NULL)
);
COMMENT ON TABLE solicitud_adquisicion_item IS 'Bienes o servicios de la solicitud de adquisición; opcionalmente ligados a un consumible del kardex o a un equipo.';
CREATE INDEX IF NOT EXISTS ix_solicitud_adquisicion_item_solicitud ON solicitud_adquisicion_item (solicitud_id, orden);
CREATE INDEX IF NOT EXISTS ix_solicitud_adquisicion_item_consumible ON solicitud_adquisicion_item (consumible_id) WHERE consumible_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS solicitud_adquisicion_evento (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenant(id),
  solicitud_id    UUID         NOT NULL REFERENCES solicitud_adquisicion(id) ON DELETE CASCADE,
  accion          VARCHAR(30)  NOT NULL,
  estado_desde    VARCHAR(20),
  estado_hasta    VARCHAR(20),
  motivo          TEXT,
  detalle         JSONB,
  usuario_id      UUID         REFERENCES usuario(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE solicitud_adquisicion_evento IS 'Historial de la solicitud de adquisición: quién hizo cada paso, cuándo y con qué motivo.';
CREATE INDEX IF NOT EXISTS ix_solicitud_adquisicion_evento_solicitud ON solicitud_adquisicion_evento (solicitud_id, created_at);

-- --- 2 · Numeración (regla general por unidad, por confirmar) -------------------------
INSERT INTO numeracion_documento (tenant_id, unidad_id, tipo_documento, formato, reinicio, correlativo_por_unidad, por_confirmar, fuente)
SELECT t.id, NULL, 'SOLICITUD_ADQUISICION', 'SA-{LAB}-{AAAA}-{N:4}', 'anual', TRUE, TRUE,
       'IDIC-PG06-IT02-FORM01: «Nº REGISTRO (interno centro costo solicitante)»; formato real por confirmar con el IDIC.'
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM numeracion_documento n WHERE n.tenant_id = t.id AND n.tipo_documento = 'SOLICITUD_ADQUISICION');

-- --- 3 · Permisos --------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'adquisicion.ver', 'adquisicion', 'ver',
   'Ver las solicitudes de adquisición de su laboratorio (Abastecimiento ve todas).'),
  (gen_random_uuid(), 'adquisicion.crear', 'adquisicion', 'crear',
   'Crear la solicitud de adquisición de su laboratorio (IDIC-PG06-IT02-FORM01), corregirla y enviarla a su jefatura.'),
  (gen_random_uuid(), 'adquisicion.visar', 'adquisicion', 'visar',
   'Jefatura del laboratorio: dar el V°B° a una solicitud de adquisición o devolverla con motivo (no la que creó).'),
  (gen_random_uuid(), 'adquisicion.gestionar', 'adquisicion', 'gestionar',
   'Abastecimiento (SAB): recibir solicitudes con V°B°, anotar la orden de compra (Nº, fecha, proveedor y estado) y la recepción en bodega.')
ON CONFLICT (codigo) DO NOTHING;

-- Laboratorios crean; jefaturas visan (JEFE_LAB; align_cierre_permisos.sql lo
-- hereda a Jefe de Sección y Jefe de Departamento); Abastecimiento gestiona.
-- Dirección, Administración y Lector reciben adquisicion.ver en el cierre.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('ANALISTA', 'adquisicion.ver'), ('ANALISTA', 'adquisicion.crear'),
    ('REVISOR', 'adquisicion.ver'), ('REVISOR', 'adquisicion.crear'),
    ('TECNICO', 'adquisicion.ver'), ('TECNICO', 'adquisicion.crear'),
    ('METROLOGO', 'adquisicion.ver'), ('METROLOGO', 'adquisicion.crear'),
    ('OPERADOR_METROLOGIA', 'adquisicion.ver'), ('OPERADOR_METROLOGIA', 'adquisicion.crear'),
    ('PLANIFICADOR_LAB', 'adquisicion.ver'), ('PLANIFICADOR_LAB', 'adquisicion.crear'),
    ('PERITO_SAEC', 'adquisicion.ver'), ('PERITO_SAEC', 'adquisicion.crear'),
    ('INSPECTOR', 'adquisicion.ver'), ('INSPECTOR', 'adquisicion.crear'),
    ('JEFE_LAB', 'adquisicion.ver'), ('JEFE_LAB', 'adquisicion.crear'), ('JEFE_LAB', 'adquisicion.visar'),
    ('JEFE_SECCION', 'adquisicion.ver'), ('JEFE_SECCION', 'adquisicion.crear'), ('JEFE_SECCION', 'adquisicion.visar'),
    ('JEFE_DEPTO', 'adquisicion.ver'), ('JEFE_DEPTO', 'adquisicion.crear'), ('JEFE_DEPTO', 'adquisicion.visar'),
    ('ABASTECIMIENTO', 'adquisicion.ver'), ('ABASTECIMIENTO', 'adquisicion.gestionar'),
    ('FINANZAS', 'adquisicion.ver'),
    ('SUPERADMIN', 'adquisicion.ver'), ('SUPERADMIN', 'adquisicion.crear'), ('SUPERADMIN', 'adquisicion.visar'), ('SUPERADMIN', 'adquisicion.gestionar'),
    ('LECTOR', 'adquisicion.ver')
  ) AS m(rol, perm)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
