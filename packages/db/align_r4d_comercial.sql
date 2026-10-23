-- =============================================================================
-- LIMS IDIC · Frente r4d · Comercial, datos de la OT, cobro, no conformidades,
-- QC analítico y recepción · Aiuken
-- =============================================================================
--   1 · Cotización: solicitante y documento de solicitud (EP-01/02 0.1, BL-210).
--   2 · Oportunidad (CRM): laboratorio para el alcance, motivo de pérdida y
--       enlace con la cotización y la OT (EP-00 0.3, BL-173).
--   3 · Datos del encargo de la OT: lo heredado de la cotización, la
--       clasificación del trabajo, el oficio de la OT institucional, el contrato o
--       lote (DSA / adquisiciones) y la validación del laboratorio con sus fechas
--       internas (EP-00 5.1, EP-01/02 0.5, EP-03 0.1/0.3, EP-05 0.1/0.3/1.2;
--       BL-159 a BL-163).
--   4 · Informe mensual de la tasa 1,5 % (EP-06 6.23, BL-164).
--   5 · Planilla de costos reales: órdenes internas valorizadas y gastos de
--       comisión (EP-00 7.1, EP-05 9.1; BL-193, BL-194).
--   6 · Trabajo / producto no conforme IDIC-PG12, reclamos y apelaciones
--       (EP-01/03 4.2, EP-04 P6.3, EP-05 6.2/8.2, EP-00 9.2; BL-165, 166, 219).
--   7 · Control de calidad analítico por método: tipos exigidos y criterios
--       (EP-01 3.5, contrato §4.2.3; BL-167).
--   8 · Recepción de ítems en DCO, distribución de porciones y devolución de
--       excedente (EP-00 5.7, EP-02 1.3, EP-03 7.2; BL-211, 212, 213).
--   9 · Listas (combos) y parámetros de la operación nuevos; permisos.
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Cotización: solicitante y documento de solicitud
-- -----------------------------------------------------------------------------
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS solicitante_contacto_id UUID REFERENCES contacto(id);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS solicitante_nombre      VARCHAR(160);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS solicitud_medio         VARCHAR(20);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS solicitud_numero        VARCHAR(80);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS solicitud_fecha         DATE;
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS oportunidad_id          UUID REFERENCES oportunidad(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cotizacion_solicitud_medio') THEN
    ALTER TABLE cotizacion ADD CONSTRAINT ck_cotizacion_solicitud_medio
      CHECK (solicitud_medio IS NULL OR solicitud_medio IN ('oficio', 'correo'));
  END IF;
END $$;
COMMENT ON COLUMN cotizacion.solicitante_contacto_id IS 'Contacto del cliente que solicita (EP-01 0.1); se cita por cargo en los documentos.';
COMMENT ON COLUMN cotizacion.solicitud_medio IS 'Medio de la solicitud: oficio (Ejército, FF.AA.) o correo (particular). Fija la «Referencia».';

-- Solicitud al laboratorio de tipo «comision» (costeo de una comisión en terreno
-- o en el extranjero, EP-05 0.2, BL-151).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitud_costeo_tipo_servicio'
              AND pg_get_constraintdef(oid) NOT LIKE '%comision%') THEN
    ALTER TABLE solicitud_costeo DROP CONSTRAINT ck_solicitud_costeo_tipo_servicio;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitud_costeo_tipo_servicio') THEN
    ALTER TABLE solicitud_costeo ADD CONSTRAINT ck_solicitud_costeo_tipo_servicio
      CHECK (tipo_servicio IS NULL OR tipo_servicio IN ('estandar', 'no_estandar', 'comision'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2 · Oportunidad (CRM)
-- -----------------------------------------------------------------------------
ALTER TABLE oportunidad ADD COLUMN IF NOT EXISTS unidad_id       UUID REFERENCES unidad(id);
ALTER TABLE oportunidad ADD COLUMN IF NOT EXISTS motivo_perdida  TEXT;
CREATE INDEX IF NOT EXISTS ix_oportunidad_cotizacion ON oportunidad (cotizacion_id) WHERE cotizacion_id IS NOT NULL;
COMMENT ON COLUMN oportunidad.unidad_id IS 'Laboratorio o centro de costo de la oportunidad: define quién la ve (alcance por laboratorio).';

-- -----------------------------------------------------------------------------
-- 3 · Datos del encargo de la OT (1:1 con orden_trabajo)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_encargo (
  ot_id                    UUID PRIMARY KEY REFERENCES orden_trabajo(id) ON DELETE CASCADE,
  tenant_id                UUID         NOT NULL REFERENCES tenant(id),
  -- Heredado de la cotización (EP-00 5.1)
  moneda                   VARCHAR(3),
  forma_pago               VARCHAR(80),
  referencia               VARCHAR(300),
  descripcion_tecnica      TEXT,
  valor_inicial            NUMERIC(14, 2),
  paridad                  NUMERIC(12, 4),
  -- Clasificación del trabajo (EP-00 5.1, EP-03 0.1)
  nivel_tecnologico        VARCHAR(4),
  requiere_muestreo        BOOLEAN,
  mandante                 VARCHAR(160),
  -- OT institucional sin cobro (EP-01/02 0.5)
  oficio_numero            VARCHAR(80),
  oficio_fecha             DATE,
  laboratorios             UUID[]       NOT NULL DEFAULT '{}',
  -- Contrato o lote (EP-03 0.3, EP-05 0.3)
  contrato                 VARCHAR(160),
  contrato_fecha           DATE,
  proyecto                 VARCHAR(200),
  proveedor                VARCHAR(200),
  fabricante               VARCHAR(200),
  pais_origen              VARCHAR(80),
  item                     VARCHAR(300),
  cantidad                 NUMERIC(14, 2),
  unidad_cantidad          VARCHAR(30),
  et_texto                 VARCHAR(200),
  lugar_muestreo           VARCHAR(300),
  fecha_muestreo           DATE,
  ot_origen_id             UUID REFERENCES orden_trabajo(id),
  paga                     VARCHAR(20),
  -- Carril DSA (EP-05 0.1)
  carril_dsa               VARCHAR(30),
  lugar_ejecucion          VARCHAR(30),
  pais_ejecucion           VARCHAR(80),
  muestreo_cliente         BOOLEAN,
  -- Validación del laboratorio (EP-05 1.2)
  alcance_conforme         BOOLEAN,
  alcance_observacion      TEXT,
  clasificacion_vehiculo   VARCHAR(20),
  subtipo_vehiculo         VARCHAR(80),
  fecha_inspeccion         DATE,
  fecha_inicio_interna     DATE,
  fecha_termino_interna    DATE,
  fecha_informe_interna    DATE,
  escalar_jefe_seccion     BOOLEAN,
  validada_por             UUID REFERENCES usuario(id),
  validada_at              TIMESTAMPTZ,
  devuelta_ventas_at       TIMESTAMPTZ,
  devuelta_ventas_por      UUID REFERENCES usuario(id),
  devuelta_ventas_motivo   TEXT,
  actualizado_por          UUID REFERENCES usuario(id),
  actualizado_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_ot_encargo_paga CHECK (paga IS NULL OR paga IN ('proveedor', 'mandante')),
  CONSTRAINT ck_ot_encargo_fechas CHECK (fecha_termino_interna IS NULL OR fecha_inicio_interna IS NULL OR fecha_termino_interna >= fecha_inicio_interna)
);
COMMENT ON TABLE ot_encargo IS 'Datos del encargo de la OT: lo heredado de la cotización, la clasificación del trabajo, el oficio (OT institucional), el contrato o lote (precarga la portada del IVC) y la validación del laboratorio con sus fechas internas (no cambian el plazo comprometido).';
CREATE INDEX IF NOT EXISTS ix_ot_encargo_origen ON ot_encargo (ot_origen_id) WHERE ot_origen_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4 · Informe mensual de la tasa 1,5 %
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasa_informe_mensual (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenant(id),
  mes           DATE          NOT NULL,
  n_ot          INTEGER       NOT NULL DEFAULT 0,
  total_tasa    NUMERIC(16, 2) NOT NULL DEFAULT 0,
  total_pagado  NUMERIC(16, 2) NOT NULL DEFAULT 0,
  detalle       JSONB         NOT NULL DEFAULT '[]'::jsonb,
  difusion      TEXT,
  observaciones TEXT,
  emitido_por   UUID REFERENCES usuario(id),
  emitido_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ux_tasa_informe_mes UNIQUE (tenant_id, mes),
  CONSTRAINT ck_tasa_informe_mes CHECK (mes = date_trunc('month', mes)::date)
);
COMMENT ON TABLE tasa_informe_mensual IS 'Informe mensual de la tasa de internación 1,5 % emitido por el Jefe DCO (EP-06 6.23): foto de las OT del mes, montos y estado de pago, y a quién se difundió.';

-- -----------------------------------------------------------------------------
-- 5 · Planilla de costos reales: OT internas valorizadas y gastos de comisión
-- -----------------------------------------------------------------------------
ALTER TABLE ot_costo_real_linea ADD COLUMN IF NOT EXISTS orden_interna_id UUID REFERENCES orden_interna(id);
ALTER TABLE ot_costo_real_linea ADD COLUMN IF NOT EXISTS tipo_gasto       VARCHAR(30);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ot_costo_real_linea_categoria_check'
              AND pg_get_constraintdef(oid) NOT LIKE '%comision%') THEN
    ALTER TABLE ot_costo_real_linea DROP CONSTRAINT ot_costo_real_linea_categoria_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ot_costo_real_linea_categoria_check') THEN
    ALTER TABLE ot_costo_real_linea ADD CONSTRAINT ot_costo_real_linea_categoria_check
      CHECK (categoria IN ('horas_hombre', 'reactivos', 'equipos', 'otros', 'ot_interna', 'comision'));
  END IF;
END $$;
COMMENT ON COLUMN ot_costo_real_linea.orden_interna_id IS 'Orden interna valorizada (bloque «OT internas»): su costo directo de respuesta.';
COMMENT ON COLUMN ot_costo_real_linea.tipo_gasto IS 'Gasto de comisión (bloque «Comisión»): viatico, pasaje, traslado, arriendo, combustible, rendicion u otro.';

-- -----------------------------------------------------------------------------
-- 6 · No conformidades: PNC/TNC IDIC-PG12, reclamos y apelaciones
-- -----------------------------------------------------------------------------
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS clase              VARCHAR(4);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS formulario         VARCHAR(40);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS muestra_id         UUID REFERENCES muestra(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS calibracion_id     UUID REFERENCES met_calibracion(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS certificado_id     UUID REFERENCES certificado(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS resultado_ids      UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS accion             VARCHAR(30);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS costo_no_calidad   NUMERIC(14, 2);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS accion_ejecutada_at  TIMESTAMPTZ;
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS accion_ejecutada_por UUID REFERENCES usuario(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS escalada_at        TIMESTAMPTZ;
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS escalada_por       UUID REFERENCES usuario(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS escalada_motivo    TEXT;
-- Reclamo de cliente (EP-00 9.2)
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS cliente_id         UUID REFERENCES cliente(id);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS reclamo_fecha      DATE;
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS responsable_rol    VARCHAR(40);
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS respuesta          TEXT;
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS respondido_at      TIMESTAMPTZ;
ALTER TABLE no_conformidad ADD COLUMN IF NOT EXISTS respondido_por     UUID REFERENCES usuario(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_no_conformidad_clase') THEN
    ALTER TABLE no_conformidad ADD CONSTRAINT ck_no_conformidad_clase CHECK (clase IS NULL OR clase IN ('NC', 'PNC', 'TNC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_no_conformidad_accion') THEN
    ALTER TABLE no_conformidad ADD CONSTRAINT ck_no_conformidad_accion
      CHECK (accion IS NULL OR accion IN ('reejecutar', 'corregir_informe', 'volver_elaboracion'));
  END IF;
END $$;
COMMENT ON COLUMN no_conformidad.clase IS 'NC (general), PNC (producto no conforme) o TNC (trabajo no conforme) según IDIC-PG12.';
COMMENT ON COLUMN no_conformidad.accion IS 'Acción del PNC/TNC: reejecutar (devuelve los ensayos a la captura), corregir_informe o volver_elaboracion (calibración).';
COMMENT ON COLUMN no_conformidad.resultado_ids IS 'Ensayos afectados por el PNC/TNC; «Reejecutar» los devuelve a la captura.';
CREATE INDEX IF NOT EXISTS ix_no_conformidad_reclamo ON no_conformidad (tenant_id, tipo) WHERE tipo = 'reclamo_cliente';

CREATE TABLE IF NOT EXISTS apelacion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(30)   NOT NULL,
  ot_id               UUID          NOT NULL REFERENCES orden_trabajo(id),
  certificado_id      UUID REFERENCES certificado(id),
  documento_numero    VARCHAR(80),
  fecha_recepcion_doc DATE          NOT NULL,
  fecha_ingreso       DATE          NOT NULL,
  plazo_dias_habiles  INTEGER       NOT NULL,
  vence_el            DATE          NOT NULL,
  fuera_de_plazo      BOOLEAN       NOT NULL DEFAULT false,
  fundamento          TEXT          NOT NULL,
  antecedentes        TEXT,
  estado              VARCHAR(20)   NOT NULL DEFAULT 'registrada',
  decision            VARCHAR(10),
  resolucion_fecha    DATE,
  resolucion_texto    TEXT,
  resuelta_por        UUID REFERENCES usuario(id),
  resuelta_at         TIMESTAMPTZ,
  registrada_por      UUID REFERENCES usuario(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ux_apelacion_codigo UNIQUE (tenant_id, codigo),
  CONSTRAINT ck_apelacion_estado CHECK (estado IN ('registrada', 'resuelta')),
  CONSTRAINT ck_apelacion_decision CHECK (decision IS NULL OR decision IN ('acoge', 'rechaza')),
  CONSTRAINT ck_apelacion_resuelta CHECK (estado <> 'resuelta' OR (decision IS NOT NULL AND resolucion_fecha IS NOT NULL))
);
COMMENT ON TABLE apelacion IS 'Apelación de un Informe de Rechazo (LRB, EP-05 8.2): plazo en días hábiles desde la recepción del informe; la resuelve el Director y su decisión es inapelable.';
CREATE INDEX IF NOT EXISTS ix_apelacion_ot ON apelacion (ot_id);

-- -----------------------------------------------------------------------------
-- 7 · QC analítico por método
-- -----------------------------------------------------------------------------
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS qc_tipos     TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS qc_criterios JSONB  NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN cat_metodo.qc_tipos IS 'Tipos de control exigidos por el método (blanco, estandar, curva, duplicado, mrc, patron). Vacío con qc_requerido = basta un control aprobado de cualquier tipo.';
COMMENT ON COLUMN cat_metodo.qc_criterios IS 'Criterio de aceptación por tipo de control para este método ({"mrc": "95-105", "curva": "0,995"}). Vacío = criterio general del sistema (por confirmar con el IDIC, EP-01 P11).';
ALTER TABLE qc_control ADD COLUMN IF NOT EXISTS mrc_referencia VARCHAR(160);
COMMENT ON COLUMN qc_control.mrc_referencia IS 'Material de referencia certificado o patrón usado (identificación, lote, certificado).';

-- -----------------------------------------------------------------------------
-- 8 · Recepción de ítems en DCO, distribución de porciones y devolución de excedente
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_recepcion_dco (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenant(id),
  ot_id              UUID          NOT NULL REFERENCES orden_trabajo(id),
  portador_rut       VARCHAR(12)   NOT NULL,
  portador_nombre    VARCHAR(160)  NOT NULL,
  portador_direccion VARCHAR(300),
  fecha_recibo       TIMESTAMPTZ   NOT NULL,
  cantidad_items     INTEGER       NOT NULL CHECK (cantidad_items > 0),
  condicion          VARCHAR(10)   NOT NULL CHECK (condicion IN ('cumple', 'no_cumple')),
  observacion        TEXT,
  recibido_por       UUID REFERENCES usuario(id),
  entregado_lab_at   TIMESTAMPTZ,
  entregado_lab_por  UUID REFERENCES usuario(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE ot_recepcion_dco IS 'Recepción de ítems del cliente en el DCO (DCO-PG01-P01-IT01, EP-00 5.7): portador, fecha de recibo, cantidad y condición; luego se entregan al laboratorio.';
CREATE INDEX IF NOT EXISTS ix_ot_recepcion_dco ON ot_recepcion_dco (ot_id);

CREATE TABLE IF NOT EXISTS muestra_distribucion (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenant(id),
  muestra_id     UUID          NOT NULL REFERENCES muestra(id),
  unidad_id      UUID          NOT NULL REFERENCES unidad(id),
  porcion        VARCHAR(80)   NOT NULL,
  fecha_hora     TIMESTAMPTZ   NOT NULL,
  recibido_por   VARCHAR(160),
  ensayos        TEXT,
  registrado_por UUID REFERENCES usuario(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ux_muestra_distribucion UNIQUE (muestra_id, unidad_id)
);
COMMENT ON TABLE muestra_distribucion IS 'Porción de una muestra entregada a cada laboratorio de destino, con fecha, hora y quién la recibió (EP-02 1.3).';

ALTER TABLE muestra_custodia ADD COLUMN IF NOT EXISTS cantidad_devuelta NUMERIC(14, 3);
ALTER TABLE muestra_custodia ADD COLUMN IF NOT EXISTS guia_despacho     VARCHAR(40);
ALTER TABLE muestra_custodia ADD COLUMN IF NOT EXISTS medio_devolucion  VARCHAR(40);
COMMENT ON COLUMN muestra_custodia.cantidad_devuelta IS 'Devolución de excedente al proveedor (EP-03 7.2): cantidad devuelta.';
COMMENT ON COLUMN muestra_custodia.guia_despacho IS 'Devolución de excedente: Nº de la guía de despacho.';

-- -----------------------------------------------------------------------------
-- 9 · Listas (combos), parámetros de la operación y permisos
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
    ('origen_trabajo', 'INSTITUCIONAL', 'Institucional sin cobro (oficio)', 9),
    ('tipo_trabajo', 'ENSAYOS', 'Ensayos', 1),
    ('tipo_trabajo', 'ADQUISICIONES', 'Adquisiciones (lote)', 2),
    ('tipo_trabajo', 'ASESORIA', 'Asesoría', 3),
    ('tipo_trabajo', 'CALIBRACION', 'Calibración', 4),
    ('tipo_trabajo', 'CERTIFICACION', 'Certificación', 5),
    ('nivel_tecnologico', 'AA', 'AA', 1),
    ('nivel_tecnologico', 'AB', 'AB', 2),
    ('nivel_tecnologico', 'BA', 'BA', 3),
    ('nivel_tecnologico', 'BB', 'BB', 4),
    ('carril_dsa', 'PARTICULAR', 'Particular con cotización', 1),
    ('carril_dsa', 'INSTITUCIONAL', 'Institucional sin cobro', 2),
    ('carril_dsa', 'COMISION_FABRICA', 'Comisión en fábrica (US$)', 3),
    ('carril_dsa', 'ORDEN_INTERNA', 'Orden interna', 4),
    ('carril_dsa', 'REINSPECCION', 'Reinspección', 5),
    ('lugar_ejecucion', 'IDIC', 'IDIC', 1),
    ('lugar_ejecucion', 'FABRICA_NACIONAL', 'Fábrica nacional', 2),
    ('lugar_ejecucion', 'FABRICA_EXTRANJERO', 'Fábrica en el extranjero', 3),
    ('lugar_ejecucion', 'UNIDAD_MILITAR', 'Unidad militar', 4),
    ('clasificacion_vehiculo', 'MMU', 'MMU', 1),
    ('clasificacion_vehiculo', 'MUU', 'MUU', 2),
    ('clasificacion_vehiculo', 'PPU', 'PPU', 3),
    ('clasificacion_vehiculo', 'APOYO', 'Apoyo', 4)
 ) AS v(categoria, codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- Parámetros de la operación (Administración › Parámetros del sistema), por confirmar con el IDIC.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
    ('cotizacion_lrb', 'reposicion', 'Unidades de reposición que se suman al lote del LRB al cotizar', 1, '4'),
    ('aceptacion_oc', 'tolerancia', 'Diferencia entre la O/C y el total cotizado que no se considera discrepancia (CLP)', 1, '0'),
    ('tasa_informe', 'difusion', 'Destinatarios de la difusión del informe mensual de la tasa 1,5 %', 1, 'DIRECCION,SUBDIRECCION,BPCH,CONTRALORIA,DFZ'),
    ('ot_institucional', 'exige_oficio', 'La OT institucional sin cobro exige el Nº y la fecha del oficio', 1, 'si')
 ) AS v(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'tasa.emitir', 'tasa', 'emitir',
   'Jefe DCO: emitir y difundir el informe mensual de la tasa de internación 1,5 %.'),
  (gen_random_uuid(), 'apelacion.ver', 'apelacion', 'ver',
   'Ver las apelaciones de Informes de Rechazo.'),
  (gen_random_uuid(), 'apelacion.registrar', 'apelacion', 'registrar',
   'Registrar la apelación de un Informe de Rechazo presentada por el cliente (Jefe de Departamento o de Laboratorio).'),
  (gen_random_uuid(), 'apelacion.resolver', 'apelacion', 'resolver',
   'Resolver la apelación (Director): acoge o rechaza, decisión inapelable.'),
  (gen_random_uuid(), 'reclamo.gestionar', 'reclamo', 'gestionar',
   'Comercial (SVT/SPC): registrar reclamos de clientes, asignar el responsable, responder y cerrar.'),
  (gen_random_uuid(), 'ot.recepcion_dco', 'ot', 'recepcion_dco',
   'Recepcionar en el DCO los ítems que trae el cliente y entregarlos al laboratorio (DCO-PG01-P01-IT01).')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('JEFE_DEPTO', 'tasa.emitir'), ('SUPERADMIN', 'tasa.emitir'),
    ('JEFE_LAB', 'apelacion.ver'), ('JEFE_DEPTO', 'apelacion.ver'), ('COMERCIAL', 'apelacion.ver'), ('CALIDAD', 'apelacion.ver'),
    ('JEFE_LAB', 'apelacion.registrar'), ('JEFE_DEPTO', 'apelacion.registrar'),
    ('DIRECTOR', 'apelacion.resolver'), ('SUPERADMIN', 'apelacion.registrar'), ('SUPERADMIN', 'apelacion.resolver'),
    ('COMERCIAL', 'reclamo.gestionar'), ('PLANIFICACION', 'reclamo.gestionar'), ('CALIDAD', 'reclamo.gestionar'), ('SUPERADMIN', 'reclamo.gestionar'),
    ('COMERCIAL', 'ot.recepcion_dco'), ('PLANIFICACION', 'ot.recepcion_dco'), ('RECEPCION', 'ot.recepcion_dco'), ('SUPERADMIN', 'ot.recepcion_dco')
  ) AS m(rol, perm)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;
