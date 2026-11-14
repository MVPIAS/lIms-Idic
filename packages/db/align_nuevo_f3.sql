-- =============================================================================
-- align_nuevo_f3.sql · Encuestas de satisfacción por tipo de cliente + informe
--                      trimestral (DCO-PG01-P04-IT05 «Seguimiento de clientes»)
-- -----------------------------------------------------------------------------
-- Frente F3 (14-11-2026). El IDIC aplica un formulario distinto por tipo de
-- cliente (FORM01 a FORM05 e IDIC-PG03-FORM01) y emite cada trimestre un
-- informe por formulario (Anexos 01 a 06). Hasta ahora el LIMS tenía un solo
-- juego de preguntas (las cuatro del formulario Ejército, escala 1/3/5/7).
--
--   · encuesta_tipo: un registro por formulario, con su código, revisión, anexo
--     del informe, cómo se agrupa (laboratorio o sucursal), nota máxima, umbral
--     del índice de satisfacción y reglas para asignarlo al cerrar la OT.
--   · encuesta_pregunta.tipo_codigo: cada pregunta pertenece a un formulario.
--   · encuesta_satisfaccion.tipo_codigo / referencia / cliente_texto: el tipo de
--     la encuesta y, para las que no nacen de una OT (cotización vencida,
--     asistencia técnica, cliente interno), el número de referencia.
--   · fn_encuesta_al_cerrar_ot asigna el tipo al nacer la encuesta.
--
-- Solo textos de los formularios (sin respuestas ni datos de clientes).
-- Aditivo e idempotente. Va antes de align_cierre_permisos.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS encuesta_tipo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(20)  NOT NULL,
  nombre              VARCHAR(200) NOT NULL,
  formulario          VARCHAR(60)  NOT NULL,
  formulario_revision VARCHAR(10),
  instruccion         VARCHAR(60)  NOT NULL DEFAULT 'DCO-PG01-P04-IT05',
  anexo_numero        VARCHAR(4),
  anexo_revision      VARCHAR(10),
  anexo_emision       VARCHAR(10),
  titulo_informe      VARCHAR(300) NOT NULL,
  objeto_informe      VARCHAR(300) NOT NULL,
  agrupar_por         VARCHAR(20)  NOT NULL DEFAULT 'laboratorio',
  nota_maxima         INTEGER      NOT NULL DEFAULT 7,
  umbral_pct          NUMERIC(5,2) NOT NULL DEFAULT 85,
  origenes            TEXT,
  tipos_cliente       TEXT,
  regla_cliente       VARCHAR(20),
  por_defecto         BOOLEAN      NOT NULL DEFAULT FALSE,
  distribucion        TEXT,
  orden               INTEGER      NOT NULL DEFAULT 0,
  activo              BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo),
  CONSTRAINT ck_encuesta_tipo_agrupar CHECK (agrupar_por IN ('laboratorio', 'sucursal')),
  CONSTRAINT ck_encuesta_tipo_nota CHECK (nota_maxima BETWEEN 2 AND 100),
  CONSTRAINT ck_encuesta_tipo_umbral CHECK (umbral_pct BETWEEN 0 AND 100)
);
COMMENT ON TABLE encuesta_tipo IS
  'Formularios de encuesta del IDIC (DCO-PG01-P04-IT05 FORM01–FORM05, IDIC-PG03-FORM01) y el anexo del informe trimestral de cada uno.';
COMMENT ON COLUMN encuesta_tipo.origenes IS 'Orígenes de OT (separados por coma) que generan este tipo al cerrar la OT. Prioridad 1.';
COMMENT ON COLUMN encuesta_tipo.tipos_cliente IS 'Códigos de tipo de cliente (parámetro tipo_cliente) que generan este tipo. Prioridad 2.';
COMMENT ON COLUMN encuesta_tipo.regla_cliente IS 'Regla del tipo de cliente (EJERCITO | PARTICULAR) que genera este tipo. Prioridad 3.';
COMMENT ON COLUMN encuesta_tipo.por_defecto IS 'Tipo que se usa si ninguna regla coincide.';
COMMENT ON COLUMN encuesta_tipo.distribucion IS 'Distribución del informe, una línea por destinatario (separadas por |).';

INSERT INTO encuesta_tipo (tenant_id, codigo, nombre, formulario, formulario_revision, anexo_numero, anexo_revision, anexo_emision,
                           titulo_informe, objeto_informe, agrupar_por, origenes, tipos_cliente, regla_cliente, por_defecto, distribucion, orden)
SELECT t.id, v.codigo, v.nombre, v.formulario, v.frev, v.anexo, v.arev, '12/07/2024', v.titulo, v.objeto, v.agrupar,
       v.origenes, v.tipos, v.regla, v.defecto, v.distribucion, v.orden
  FROM tenant t
 CROSS JOIN (VALUES
   ('FORM01', 'Servicios prestados a particulares', 'DCO-PG01-P04-IT05-FORM01', '02', '01', '01',
    'INFORME DE ENCUESTAS DE SERVICIOS PRESTADOS A PARTICULARES', 'Encuestas de Servicios Prestados',
    'laboratorio', NULL, NULL, 'PARTICULAR', TRUE, 'IDIC DIR SGC|IDIC DSA|IDIC DQO|IDIC DCO (Archivo)', 1),
   ('FORM02', 'Cotizaciones no aceptadas (vencidas)', 'DCO-PG01-P04-IT05-FORM02', '02', '02', '01',
    'INFORME DE ENCUESTAS DE COTIZACIONES NO ACEPTADAS', 'Encuestas de Cotizaciones no aceptadas',
    'laboratorio', NULL, NULL, NULL, FALSE, 'IDIC DIR SGC|IDIC DSA|IDIC DQO|IDIC DCO (Archivo)', 2),
   ('FORM03', 'Servicios prestados al Ejército', 'DCO-PG01-P04-IT05-FORM03', '02', '03', '01',
    'INFORME DE ENCUESTAS DE SERVICIOS PRESTADOS AL EJÉRCITO', 'Encuestas de Servicios Prestados al Ejército',
    'laboratorio', NULL, 'ejercito', 'EJERCITO', FALSE, 'IDIC DIR SGC|IDIC DSA|IDIC DQO|IDIC DCO (Archivo)', 3),
   ('FORM04', 'Usuarios Ley 17.798 «Asistencias Técnicas»', 'DCO-PG01-P04-IT05-FORM04', '00', '04', '00',
    'INFORME DE ENCUESTAS A TRABAJOS DE USUARIOS LEY 17.798 "ASISTENCIAS TÉCNICAS"',
    'Encuestas de Trabajos a Clientes Ley 17.798 "Asistencias Técnicas"',
    'sucursal', NULL, 'ley_17798', NULL, FALSE, 'IDIC DIR SGC|IDIC DSA|IDIC DQO|IDIC SDBPCH|IDIC DCO (Archivo)', 4),
   ('FORM05', 'Usuarios Ley 17.798 Empresas Controladas «Inspecciones»', 'DCO-PG01-P04-IT05-FORM05', '00', '05', '00',
    'INFORME DE ENCUESTAS A TRABAJOS DE USUARIOS LEY 17.798 EMPRESAS CONTROLADAS "INSPECCIONES"',
    'Encuestas de Trabajos a Clientes Ley 17.798 Empresas Controladas "Inspecciones"',
    'sucursal', 'PRODUCCION_NACIONAL,INTERNACION,REINSPECCION', NULL, NULL, FALSE,
    'IDIC DIR SGC|IDIC DSA|IDIC DQO|IDIC SDBPCH|IDIC DCO (Archivo)', 5),
   ('INTERNO', 'Servicios prestados a cliente interno', 'IDIC-PG03-FORM01', '00', '06', '00',
    'INFORME DE ENCUESTAS DE SERVICIOS CLIENTE INTERNO', 'Encuestas de Servicios Cliente Interno',
    'laboratorio', NULL, NULL, NULL, FALSE, 'IDIC DIR SGC|IDIC DSA|IDIC DQO|IDIC DCO (Archivo)', 6)
 ) AS v(codigo, nombre, formulario, frev, anexo, arev, titulo, objeto, agrupar, origenes, tipos, regla, defecto, distribucion, orden)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- --- Preguntas por formulario ---------------------------------------------------
ALTER TABLE encuesta_pregunta ADD COLUMN IF NOT EXISTS tipo_codigo VARCHAR(20);
ALTER TABLE encuesta_pregunta ADD COLUMN IF NOT EXISTS comentario_si_menor NUMERIC(5,2);
COMMENT ON COLUMN encuesta_pregunta.tipo_codigo IS 'Formulario (encuesta_tipo.codigo) al que pertenece la pregunta.';
COMMENT ON COLUMN encuesta_pregunta.comentario_si_menor IS
  'Si la nota es menor que este valor, el comentario es obligatorio (FORM01 criterio 4: nota inferior a 4,0).';
CREATE INDEX IF NOT EXISTS idx_encuesta_pregunta_tipo ON encuesta_pregunta (tenant_id, tipo_codigo, orden);

-- Las cuatro preguntas que ya existían son las del formulario Ejército (FORM03, escala 1/3/5/7).
UPDATE encuesta_pregunta SET tipo_codigo = 'FORM03' WHERE tipo_codigo IS NULL AND codigo IN ('C01', 'C02', 'C03', 'C04');
UPDATE encuesta_pregunta SET texto = 'El servicio prestado cumplió con las expectativas'
 WHERE codigo = 'C02' AND texto = 'El servicio prestado cumplió con las expectativas de la empresa';

INSERT INTO encuesta_pregunta (tenant_id, tipo_codigo, codigo, texto, escala, orden, comentario_si_menor)
SELECT t.id, v.tipo, v.codigo, v.texto, '{1,2,3,4,5,6,7}', v.orden, v.coment
  FROM tenant t
 CROSS JOIN (VALUES
   ('FORM01', 'F01_01', 'El tiempo de respuesta a su solicitud de cotización', 1, NULL::numeric),
   ('FORM01', 'F01_02', 'La disposición y cordialidad de la persona que lo atendió', 2, NULL),
   ('FORM01', 'F01_03', 'La asesoría prestada para la definición de sus requerimientos', 3, NULL),
   ('FORM01', 'F01_04', 'Tiempo de ejecución del trabajo', 4, 4),
   ('FORM01', 'F01_05', 'El precio del servicio', 5, NULL),
   ('FORM01', 'F01_06', 'Satisfacción por el servicio recibido', 6, NULL),
   ('FORM02', 'F02_01', 'El tiempo de respuesta a su solicitud de cotización', 1, NULL),
   ('FORM02', 'F02_02', 'La disposición y cordialidad de la persona que lo atendió', 2, NULL),
   ('FORM02', 'F02_03', 'La asesoría prestada para la definición de sus requerimientos', 3, NULL),
   ('FORM02', 'F02_04', 'La información contenida en la cotización emitida', 4, NULL),
   ('FORM02', 'F02_05', 'El precio cotizado', 5, NULL),
   ('FORM04', 'F04_01', 'La atención del Banco de Pruebas de Chile es realizada en forma eficiente.', 1, NULL),
   ('FORM04', 'F04_02', 'El Inspector del Banco de Pruebas de Chile es amable y dispuesto a resolver dudas o inconvenientes que se presentan respecto a la Asistencia Técnica.', 2, NULL),
   ('FORM04', 'F04_03', 'El Banco de Pruebas de Chile informa respecto al detalle de cada una de las etapas del proceso de Asistencia Técnica que realiza.', 3, NULL),
   ('FORM04', 'F04_04', 'Los tiempos utilizados por el Banco de Pruebas de Chile para la Asistencia Técnica y específicamente en la entrega de productos y resultados, son oportunos.', 4, NULL),
   ('FORM04', 'F04_05', 'El Inspector del Banco de Pruebas de Chile explica de forma clara y completa el detalle de la Asistencia Técnica realizada al producto y sus hallazgos.', 5, NULL),
   ('FORM04', 'F04_06', 'El certificado de Control de Armas de fuego entregado al cierre del proceso, es de fácil lectura y completo respecto a la información de Asistencia Técnica realizada.', 6, NULL),
   ('FORM05', 'F05_01', 'La coordinación del Banco de Pruebas de Chile para realizar la Inspección se efectúa de forma eficiente.', 1, NULL),
   ('FORM05', 'F05_02', 'El Banco de Pruebas de Chile informa respecto al detalle de cada una de las etapas del proceso de Inspección que realiza.', 2, NULL),
   ('FORM05', 'F05_03', 'El Inspector del Banco de Pruebas de Chile tiene una actitud acorde a la función de control que ejecuta, con buena disposición a resolver dudas durante la Inspección.', 3, NULL),
   ('FORM05', 'F05_04', 'En el proceso de toma de muestras, el Inspector del Banco de Pruebas de Chile explica de forma clara y completa el detalle de la Inspección realizada y sus novedades.', 4, NULL),
   ('FORM05', 'F05_05', 'El Banco de Pruebas de Chile realiza la actividad de Inspección en los tiempos adecuados.', 5, NULL),
   ('FORM05', 'F05_06', 'La entrega de resultados de ensayos y sus certificados, se realiza de forma oportuna.', 6, NULL),
   ('FORM05', 'F05_07', 'La documentación con los resultados de ensayos e Inspecciones es clara, precisa y de fácil lectura.', 7, NULL),
   ('INTERNO', 'INT_A', 'El servicio prestado cumplió con las expectativas', 1, NULL),
   ('INTERNO', 'INT_B', 'Conformidad con el tiempo de respuesta', 2, NULL),
   ('INTERNO', 'INT_C', 'Coordinación Cliente Interno - Laboratorio', 3, NULL)
 ) AS v(tipo, codigo, texto, orden, coment)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- --- Encuesta: tipo y referencia --------------------------------------------------
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS tipo_codigo   VARCHAR(20);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS referencia    VARCHAR(60);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS cliente_texto VARCHAR(200);
ALTER TABLE encuesta_satisfaccion ADD COLUMN IF NOT EXISTS creada_por    UUID REFERENCES usuario(id);
COMMENT ON COLUMN encuesta_satisfaccion.tipo_codigo IS 'Formulario de la encuesta (encuesta_tipo.codigo).';
COMMENT ON COLUMN encuesta_satisfaccion.referencia IS
  'N° de OT, PIA, cotización u OT interna cuando la encuesta no nace del cierre de una OT (alta manual).';
COMMENT ON COLUMN encuesta_satisfaccion.fecha_envio IS
  'Fecha del servicio que se evalúa (cierre de la OT o vencimiento de la cotización): define el trimestre del informe.';
CREATE INDEX IF NOT EXISTS idx_encuesta_tipo_fecha ON encuesta_satisfaccion (tenant_id, tipo_codigo, fecha_envio);

-- Tipo que corresponde a una OT: origen → tipo de cliente → regla del tipo de cliente → por defecto.
CREATE OR REPLACE FUNCTION fn_encuesta_tipo_de_ot(p_tenant UUID, p_origen TEXT, p_cliente UUID, p_cotizacion UUID) RETURNS VARCHAR AS $$
DECLARE
  v_tipo   VARCHAR(20);
  v_tcli   TEXT;
  v_regla  TEXT;
BEGIN
  IF p_origen IS NOT NULL THEN
    SELECT et.codigo INTO v_tipo FROM encuesta_tipo et
     WHERE et.tenant_id = p_tenant AND et.activo
       AND upper(p_origen) = ANY (string_to_array(upper(regexp_replace(COALESCE(et.origenes, ''), '\s', '', 'g')), ','))
     ORDER BY et.orden LIMIT 1;
    IF v_tipo IS NOT NULL THEN RETURN v_tipo; END IF;
  END IF;
  SELECT COALESCE(NULLIF(c.tipo_cliente_codigo, ''), cl.tipo) INTO v_tcli
    FROM (SELECT 1) x
    LEFT JOIN cotizacion c ON c.id = p_cotizacion
    LEFT JOIN cliente cl ON cl.id = p_cliente;
  IF v_tcli IS NOT NULL THEN
    SELECT et.codigo INTO v_tipo FROM encuesta_tipo et
     WHERE et.tenant_id = p_tenant AND et.activo
       AND lower(v_tcli) = ANY (string_to_array(lower(regexp_replace(COALESCE(et.tipos_cliente, ''), '\s', '', 'g')), ','))
     ORDER BY et.orden LIMIT 1;
    IF v_tipo IS NOT NULL THEN RETURN v_tipo; END IF;
    SELECT upper(p.valor) INTO v_regla FROM parametro_sistema p
     WHERE p.tenant_id = p_tenant AND p.categoria = 'tipo_cliente' AND lower(p.codigo) = lower(v_tcli) LIMIT 1;
    IF v_regla IS NOT NULL THEN
      SELECT et.codigo INTO v_tipo FROM encuesta_tipo et
       WHERE et.tenant_id = p_tenant AND et.activo AND upper(et.regla_cliente) = v_regla
       ORDER BY et.orden LIMIT 1;
      IF v_tipo IS NOT NULL THEN RETURN v_tipo; END IF;
    END IF;
  END IF;
  SELECT et.codigo INTO v_tipo FROM encuesta_tipo et
   WHERE et.tenant_id = p_tenant AND et.activo AND et.por_defecto ORDER BY et.orden LIMIT 1;
  RETURN v_tipo;
END;
$$ LANGUAGE plpgsql STABLE;

-- Al cerrar la OT nace su encuesta pendiente, ya con su tipo (reemplaza la de align_encuestas_satisfaccion.sql).
CREATE OR REPLACE FUNCTION fn_encuesta_al_cerrar_ot() RETURNS trigger AS $$
DECLARE
  excluir TEXT;
BEGIN
  SELECT p.valor INTO excluir FROM parametro_sistema p
   WHERE p.tenant_id = NEW.tenant_id AND p.categoria = 'encuesta' AND p.codigo = 'excluir_origenes' AND p.activo;
  IF NEW.origen_trabajo IS NOT NULL
     AND upper(NEW.origen_trabajo) = ANY (string_to_array(upper(regexp_replace(COALESCE(excluir, ''), '\s', '', 'g')), ',')) THEN
    RETURN NEW;
  END IF;
  INSERT INTO encuesta_satisfaccion (tenant_id, codigo, ot_id, cliente_id, unidad_id, cotizacion_id, estado, fecha_envio, tipo_codigo)
  VALUES (NEW.tenant_id, left('ENC-' || NEW.codigo, 30), NEW.id, NEW.cliente_id, NEW.unidad_principal, NEW.cotizacion_id,
          'pendiente', (now() AT TIME ZONE 'America/Santiago')::date,
          fn_encuesta_tipo_de_ot(NEW.tenant_id, NEW.origen_trabajo, NEW.cliente_id, NEW.cotizacion_id))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Encuestas que ya existían: las registradas se contestaron con las preguntas del
-- formulario Ejército (FORM03); las demás toman el tipo que les corresponde por su OT.
UPDATE encuesta_satisfaccion SET tipo_codigo = 'FORM03'
 WHERE tipo_codigo IS NULL AND estado IN ('registrada', 'sin_respuesta')
   AND EXISTS (SELECT 1 FROM encuesta_tipo et WHERE et.tenant_id = encuesta_satisfaccion.tenant_id AND et.codigo = 'FORM03');
UPDATE encuesta_satisfaccion e
   SET tipo_codigo = fn_encuesta_tipo_de_ot(e.tenant_id, o.origen_trabajo, COALESCE(e.cliente_id, o.cliente_id), COALESCE(e.cotizacion_id, o.cotizacion_id))
  FROM orden_trabajo o
 WHERE e.tipo_codigo IS NULL AND o.id = e.ot_id;
UPDATE encuesta_satisfaccion e SET tipo_codigo = fn_encuesta_tipo_de_ot(e.tenant_id, NULL, e.cliente_id, e.cotizacion_id)
 WHERE e.tipo_codigo IS NULL;
UPDATE encuesta_satisfaccion SET fecha_envio = created_at::date WHERE fecha_envio IS NULL;
