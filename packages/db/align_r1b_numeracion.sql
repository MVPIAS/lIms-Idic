-- =============================================================================
-- align_r1b_numeracion.sql · Numeración oficial de documentos por laboratorio y tipo
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt. Reglas: docs/FLUJO_NUMERACION_DOCUMENTOS.md.
--
-- Hasta ahora todo documento salía con CERT-AAAA-NNNN (correlativo del instituto).
-- Las especificaciones de proceso (EP-01, EP-03, EP-05, EP-06, EP-09, EP-10)
-- piden la numeración propia de cada laboratorio y tipo de documento:
--   · IE de LPN correlativo por laboratorio y año (EP-01 5.1);
--   · IE e IVC del LCC/LTX con el Nº de la OT (EP-03 5.1, §6);
--   · CODSUCDEL/código/OT/muestra en el BPCH (EP-10 §6, contrato §4.6.4);
--   · los formatos del DSA (EP-05 §6) y la respuesta a una orden interna.
--
--   1. numeracion_documento: una regla por (unidad, tipo de documento). Sin
--      unidad = regla general; sin tipo = todos los tipos de esa unidad. Una
--      unidad hereda la regla de su ancestro más cercano (sucursales ← BPCH).
--      Si ninguna regla aplica, se mantiene CERT-AAAA-NNNN.
--   2. numeracion_documento_correlativo: contador atómico por regla, unidad
--      (si la regla numera por unidad) y período (año o 0 = continuo).
--   3. certificado.numero y certificado.codigo pasan de 30/40 a 80 caracteres
--      (los formatos del DSA superan los 30 con el sufijo de versión).
--   4. Reglas por defecto de las especificaciones; las que el IDIC no ha
--      confirmado quedan marcadas «por confirmar». Se siembran UNA vez por
--      (unidad, tipo): si el administrador las cambia, reaplicar no las repone.
--   5. Permiso documento.numeracion (Administración › Numeración de documentos).
-- =============================================================================

-- --- 1 · Reglas --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS numeracion_documento (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID         NOT NULL REFERENCES tenant(id),
  unidad_id              UUID         REFERENCES unidad(id),
  tipo_documento         VARCHAR(40),
  formato                VARCHAR(120) NOT NULL,
  reinicio               VARCHAR(10)  NOT NULL DEFAULT 'anual',
  correlativo_por_unidad BOOLEAN      NOT NULL DEFAULT FALSE,
  por_confirmar          BOOLEAN      NOT NULL DEFAULT FALSE,
  fuente                 TEXT,
  activo                 BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by             UUID         REFERENCES usuario(id),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by             UUID         REFERENCES usuario(id),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_numeracion_reinicio CHECK (reinicio IN ('anual', 'continuo')),
  CONSTRAINT ck_numeracion_formato CHECK (length(btrim(formato)) > 0)
);
COMMENT ON TABLE numeracion_documento IS
  'Formato del número oficial de los documentos por unidad (laboratorio) y tipo de documento. Tokens: docs/FLUJO_NUMERACION_DOCUMENTOS.md.';
COMMENT ON COLUMN numeracion_documento.reinicio IS 'anual: el correlativo {N} vuelve a 1 cada año; continuo: no se reinicia.';
COMMENT ON COLUMN numeracion_documento.correlativo_por_unidad IS
  'TRUE: cada unidad que hereda la regla lleva su propio correlativo (p. ej. cada sucursal del BPCH).';
COMMENT ON COLUMN numeracion_documento.por_confirmar IS 'Formato por defecto de la especificación, aún no confirmado por el IDIC.';

-- Una regla activa por (unidad, tipo); NULL cuenta como un valor más.
CREATE UNIQUE INDEX IF NOT EXISTS ux_numeracion_documento_regla
  ON numeracion_documento (tenant_id, COALESCE(unidad_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(tipo_documento, '*'))
  WHERE activo;
CREATE INDEX IF NOT EXISTS ix_numeracion_documento_unidad ON numeracion_documento (unidad_id) WHERE unidad_id IS NOT NULL;

-- --- 2 · Correlativos --------------------------------------------------------
CREATE TABLE IF NOT EXISTS numeracion_documento_correlativo (
  tenant_id   UUID        NOT NULL REFERENCES tenant(id),
  regla_id    UUID        NOT NULL REFERENCES numeracion_documento(id) ON DELETE CASCADE,
  unidad_id   UUID        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  periodo     INTEGER     NOT NULL,
  ultimo      INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, regla_id, unidad_id, periodo),
  CONSTRAINT ck_numeracion_correlativo_ultimo CHECK (ultimo >= 0)
);
COMMENT ON TABLE numeracion_documento_correlativo IS
  'Último {N} entregado por regla, unidad (si numera por unidad) y período (año, o 0 si es continuo). Se incrementa con INSERT … ON CONFLICT DO UPDATE … RETURNING (atómico).';

-- --- 3 · Números más largos ----------------------------------------------------
DO $$
BEGIN
  IF (SELECT character_maximum_length FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'certificado' AND column_name = 'numero') < 80 THEN
    ALTER TABLE certificado ALTER COLUMN numero TYPE VARCHAR(80);
  END IF;
  IF (SELECT character_maximum_length FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'certificado' AND column_name = 'codigo') < 80 THEN
    ALTER TABLE certificado ALTER COLUMN codigo TYPE VARCHAR(80);
  END IF;
END $$;

-- --- 4 · Reglas por defecto (especificaciones de proceso) ---------------------
-- (codigo de unidad | NULL = general, tipo | NULL = todos, formato, reinicio,
--  correlativo por unidad, por confirmar, fuente)
INSERT INTO numeracion_documento
  (tenant_id, unidad_id, tipo_documento, formato, reinicio, correlativo_por_unidad, por_confirmar, fuente)
SELECT t.id, u.id, v.tipo, v.formato, v.reinicio, v.por_unidad, v.por_confirmar, v.fuente
  FROM tenant t
 CROSS JOIN (VALUES
  ('LQC',  'INFORME_ENSAYO',          'IE {LAB} N° {N:3}/{AAAA}',                'anual',    FALSE, TRUE,
   'EP-01 §6: correlativo del documento. Formato por confirmar.'),
  ('LPN',  'INFORME_ENSAYO',          'IE {LAB} N° {N:3}/{AAAA}',                'anual',    FALSE, TRUE,
   'EP-01 5.1: IE con numeración correlativa automática por laboratorio y año. Formato por confirmar (EP-01 P6).'),
  ('LME',  'INFORME_ENSAYO',          'IE {LAB} N° {N:3}/{AAAA}',                'anual',    FALSE, TRUE,
   'EP-01 §6: numeración del informe LME-PG01-IT03 por confirmar.'),
  ('SVE',  'INFORME_ENSAYO',          'IE.DQO.{LAB} Nº {OT_N}/{AAAA}',           'anual',    FALSE, TRUE,
   'EP-03 5.1: Nº del IE = Nº de la OT (LCC y LTX). Prefijo y dos documentos por OT por confirmar (EP-03 P3).'),
  ('SVE',  'IVC',                     'IVC.DQO.{LAB} Nº {OT_N}/{AAAA}',          'anual',    FALSE, FALSE,
   'EP-03 §6: «IVC.DQO.{LAB} Nº {OT}/{año}» (IVC reales del LCC).'),
  ('LRB',  NULL,                      'IDIC DSA SAM LRB Nº J.{OT_N}/{AAAA}',     'anual',    FALSE, FALSE,
   'EP-05 §6: Informe de Ensayos, CRB e Informe de Rechazo del LRB.'),
  ('SVM',  'IVC',                     'IDIC DSA SVM N.º {OT_N}/{AAAA}',          'anual',    FALSE, FALSE,
   'EP-05 §6: IVC SVM (por subtipo /01, /02 cuando hay varios documentos).'),
  ('LEM',  'IVC',                     'IVC.IDIC.DSA.SEM.LEM N°{OT_N}/{AAAA}',    'anual',    FALSE, FALSE,
   'EP-05 §6: IVC LEM.'),
  ('LEM',  'INFORME_ENSAYO',          'IE {LAB} N°{N:3}/{AAAA}',                 'anual',    FALSE, TRUE,
   'EP-05 §6: IE LEM correlativo anual («003/2026») o igual al Nº de OT. Por confirmar (EP-05 P20).'),
  ('LEM',  'RESPUESTA_OI',            '{OT_N}/{NI_N}/{N}',                       'anual',    FALSE, TRUE,
   'EP-05 4.10: la respuesta del LEM a una orden interna se numera <OT>/<NORINT>/<correlativo>.'),
  ('BPCH', 'INFORME_INSPECCION',      '{CODSUCDEL}/{N:4}/{OT_N:5}/{MUESTRA_N:6}', 'continuo', TRUE,  TRUE,
   'EP-10 §6 y contrato §4.6.4: <CODSUCDEL>/<código>/<OT>/<muestra>. El 2.º tramo es un correlativo por unidad inspectora hasta que el IDIC confirme su significado (EP-10 P5).'),
  ('BPCH', 'CERTIFICADO_CONFORMIDAD', '{NUM_INFORME}/CC',                        'continuo', FALSE, TRUE,
   'EP-10 10.13: el certificado lleva el número del Informe de Inspección; el LIMS añade /CC porque el número de un documento es único (EP-10 P5).'),
  ('BPCH', 'INFORME_INCUMPLIMIENTO',  '{NUM_INFORME}/II',                        'continuo', FALSE, TRUE,
   'EP-10 10.14: el incumplimiento lleva el número del Informe de Inspección; el LIMS añade /II porque el número de un documento es único (EP-10 P5).'),
  (NULL,   'RESPUESTA_OI',            'I.E. N° {NI_N}/{AAAA}',                   'anual',    FALSE, FALSE,
   'EP-01 §6 y EP-03 §6: el informe de análisis interno se numera «I.E. N° {Nº interno}/{año}».')
 ) AS v(unidad, tipo, formato, reinicio, por_unidad, por_confirmar, fuente)
  LEFT JOIN unidad u ON u.tenant_id = t.id AND u.codigo = v.unidad
 WHERE (v.unidad IS NULL OR u.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM numeracion_documento n
      WHERE n.tenant_id = t.id
        AND n.unidad_id IS NOT DISTINCT FROM u.id
        AND n.tipo_documento IS NOT DISTINCT FROM v.tipo);

-- --- 5 · Permiso -------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'documento.numeracion', 'documento', 'numeracion',
   'Configurar el formato del número oficial de los documentos por laboratorio y tipo (Administración › Numeración de documentos)')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'documento.numeracion'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'CALIDAD')
ON CONFLICT DO NOTHING;
