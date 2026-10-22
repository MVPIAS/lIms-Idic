-- =============================================================================
-- LIMS IDIC · Frente r4b · Delegación Nº 11 (armas) y documentos BPCH · Aiuken
-- =============================================================================
-- Especificación: EP-11 (11.1, 11.4–11.9, 11.11–11.12, 11.15/11.20, 11.22,
-- 11.23, 11.27, 11.42) y EP-10 10.15. Contrato: docs/FLUJO_D11_ARMAS.md.
--
--   1 · Catálogos del arma: marcas (con país), modelos y calibres (CIP).
--   2 · Listado de armas de la resolución DGMN (internación con la D11).
--   3 · Expediente D11 de la OT: programación, aviso de llegada y acta.
--   4 · Arma de la OT (= muestra): clasificación, camino CIP, acuñación IT08.
--   5 · Custodia del arma importada (movimientos inmutables) y entrega.
--   6 · Certificado por arma: vigencia, emisiones (rangos de numeración).
--   7 · Matriz de firmas de la D11 (tipos de documento nuevos) y numeración.
--   8 · Notificación a DGMN del incumplimiento (EP-10 10.15).
--   9 · Parámetros de la operación (camino del arma, acuñación, vigencia).
--  10 · Permisos.
--  11 · Plantilla del certificado por arma.
--
-- Aditivo e idempotente: una pasada y dos dejan el mismo estado. Va ANTES de
-- align_cierre_permisos.sql (que reparte en cascada los permisos nuevos).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Catálogos maestros del arma (EP-11 11.8; adopción por confirmar, P9)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS d11_marca (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  nombre      VARCHAR(160) NOT NULL,
  pais        VARCHAR(80),
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  origen      VARCHAR(20)  NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'catalogo')),
  created_by  UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE d11_marca IS 'Marcas de armas (D11). País de origen propio: en el LIMS actual venía mezclado con la marca («MARCA ( PAÍS )»).';
CREATE UNIQUE INDEX IF NOT EXISTS ux_d11_marca ON d11_marca (tenant_id, upper(nombre), upper(COALESCE(pais, '')));

CREATE TABLE IF NOT EXISTS d11_modelo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  marca_id    UUID         NOT NULL REFERENCES d11_marca(id),
  nombre      VARCHAR(160) NOT NULL,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by  UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_d11_modelo ON d11_modelo (marca_id, upper(nombre));

CREATE TABLE IF NOT EXISTS d11_calibre (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  nombre      VARCHAR(80)  NOT NULL,
  cip         BOOLEAN      NOT NULL DEFAULT FALSE,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by  UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON COLUMN d11_calibre.cip IS 'Calibre de la tabla C.I.P. (Comisión Internacional Permanente). Por confirmar con el catálogo del IDIC (EP-11 P9).';
CREATE UNIQUE INDEX IF NOT EXISTS ux_d11_calibre ON d11_calibre (tenant_id, upper(nombre));

-- Marcas sembradas desde los elementos del catálogo de la D11 («MARCA ( PAÍS )»,
-- métodos DTCG-PG03): es la lista que el LIMS actual usa hoy. Se siembran una vez;
-- la D11 las corrige o desactiva en Certificación de armas › Catálogos.
INSERT INTO d11_marca (tenant_id, nombre, pais, origen)
SELECT DISTINCT ON (x.tenant_id, upper(x.nombre), upper(COALESCE(x.pais, '')))
       x.tenant_id, x.nombre, x.pais, 'catalogo'
  FROM (
    SELECT el.tenant_id,
           btrim(regexp_replace(el.nombre, '\s*\(.*$', '')) AS nombre,
           NULLIF(btrim(substring(el.nombre FROM '\(\s*([^)]*?)\s*\)?\s*$')), '') AS pais
      FROM cat_elemento el
     WHERE el.deleted_at IS NULL
       AND el.nombre ~ '^[^()]+\([^()]*\)?\s*$'
       AND EXISTS (SELECT 1 FROM cat_panel p JOIN cat_metodo m ON m.id = p.metodo_id
                    WHERE p.elemento_id = el.id AND m.norma ILIKE 'DTCG-PG03%')
  ) x
 WHERE length(x.nombre) BETWEEN 2 AND 160
   AND upper(x.nombre) NOT IN ('SIN MARCA')
   AND NOT EXISTS (SELECT 1 FROM d11_marca d
                    WHERE d.tenant_id = x.tenant_id AND upper(d.nombre) = upper(x.nombre)
                      AND upper(COALESCE(d.pais, '')) = upper(COALESCE(x.pais, '')))
ON CONFLICT DO NOTHING;

-- Calibres de uso común (designación técnica). La lista completa (316, 138 CIP)
-- es del módulo antiguo y no se entregó: por confirmar (EP-11 P9).
INSERT INTO d11_calibre (tenant_id, nombre, cip)
SELECT t.id, v.nombre, v.cip
  FROM tenant t
 CROSS JOIN (VALUES
  ('9 × 19 mm', TRUE), ('9 × 17 mm (.380 ACP)', TRUE), ('.22 LR', TRUE), ('.38 Special', TRUE),
  ('.357 Magnum', TRUE), ('.40 S&W', TRUE), ('.45 ACP', TRUE), ('12/70', TRUE), ('12/76', TRUE),
  ('16/70', TRUE), ('20/70', TRUE), ('.223 Remington', TRUE), ('5,56 × 45 mm', TRUE),
  ('7,62 × 39 mm', TRUE), ('7,62 × 51 mm', TRUE), ('.308 Winchester', TRUE), ('.30-06 Springfield', TRUE),
  ('6,35 mm (.25 ACP)', TRUE), ('7,65 mm (.32 ACP)', TRUE)
 ) AS v(nombre, cip)
 WHERE NOT EXISTS (SELECT 1 FROM d11_calibre c WHERE c.tenant_id = t.id AND upper(c.nombre) = upper(v.nombre));

-- -----------------------------------------------------------------------------
-- 2 · Listado de armas de la resolución DGMN (EP-11 11.1)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS d11_resolucion_arma (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenant(id),
  internacion_id    UUID         NOT NULL REFERENCES bpch_internacion(id) ON DELETE CASCADE,
  orden             INTEGER      NOT NULL,
  tipo              VARCHAR(40)  NOT NULL,
  marca             VARCHAR(160) NOT NULL,
  modelo            VARCHAR(160),
  calibre           VARCHAR(80),
  serie             VARCHAR(80),
  serie_normalizada VARCHAR(80),
  accesorios        VARCHAR(300),
  cantidad          INTEGER      NOT NULL DEFAULT 1 CHECK (cantidad >= 1),
  created_by        UUID,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE d11_resolucion_arma IS 'Listado de armas «según resolución» (EP-11 11.1): base del conteo del acta (11.6) y de la verificación (11.9).';
CREATE INDEX IF NOT EXISTS ix_d11_resolucion_arma ON d11_resolucion_arma (internacion_id, orden);

-- -----------------------------------------------------------------------------
-- 3 · Expediente D11 de la OT: programación (11.4), llegada (11.5) y acta (11.6)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS d11_expediente (
  ot_id                     UUID PRIMARY KEY REFERENCES orden_trabajo(id),
  tenant_id                 UUID         NOT NULL REFERENCES tenant(id),
  programacion_fecha        DATE,
  programacion_lugar        VARCHAR(240),
  programacion_responsable  UUID REFERENCES usuario(id),
  programada_por            UUID REFERENCES usuario(id),
  programada_at             TIMESTAMPTZ,
  llegada_fecha             DATE,
  llegada_transportista     VARCHAR(200),
  llegada_bultos            INTEGER CHECK (llegada_bultos IS NULL OR llegada_bultos >= 1),
  llegada_aviso_previo      BOOLEAN,
  llegada_observaciones     TEXT,
  llegada_registrada_por    UUID REFERENCES usuario(id),
  llegada_registrada_at     TIMESTAMPTZ,
  acta_bultos               INTEGER CHECK (acta_bultos IS NULL OR acta_bultos >= 0),
  acta_cantidad             INTEGER CHECK (acta_cantidad IS NULL OR acta_cantidad >= 0),
  acta_ubicacion            VARCHAR(160),
  acta_responsable          UUID REFERENCES usuario(id),
  acta_observaciones        TEXT,
  acta_resultado            VARCHAR(12) CHECK (acta_resultado IS NULL OR acta_resultado IN ('concuerda', 'diferencia')),
  acta_segun_resolucion     INTEGER,
  acta_firmada_por          UUID REFERENCES usuario(id),
  acta_firmada_at           TIMESTAMPTZ,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE d11_expediente IS 'Expediente de la OT de armas de la D11: programación con el importador, aviso de llegada y acta de recepción e inventario.';

-- -----------------------------------------------------------------------------
-- 4 · Ficha del arma (tabla SAEC «arma») y arma de la OT (= muestra)
-- -----------------------------------------------------------------------------
ALTER TABLE arma ADD COLUMN IF NOT EXISTS pais_origen VARCHAR(80);
ALTER TABLE arma ADD COLUMN IF NOT EXISTS marca_id    UUID REFERENCES d11_marca(id);
ALTER TABLE arma ADD COLUMN IF NOT EXISTS modelo_id   UUID REFERENCES d11_modelo(id);
ALTER TABLE arma ADD COLUMN IF NOT EXISTS calibre_id  UUID REFERENCES d11_calibre(id);
ALTER TABLE arma ADD COLUMN IF NOT EXISTS serie_normalizada VARCHAR(80);
COMMENT ON COLUMN arma.serie_normalizada IS 'Serie en mayúsculas, solo A–Z y 0–9 (EP-11 §5): la que se compara con la resolución e IBIS.';

-- Un número de serie lo asigna cada fabricante: dos armas de marcas distintas
-- pueden compartirlo. La unicidad pasa a ser serie + marca (antes, solo serie).
DROP INDEX IF EXISTS ux_arma_serie;
CREATE UNIQUE INDEX IF NOT EXISTS ux_arma_serie_marca
  ON arma (tenant_id, serie, upper(COALESCE(marca, '')))
  WHERE serie IS NOT NULL AND serie_borrada = FALSE AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS d11_arma_ot (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenant(id),
  ot_id               UUID         NOT NULL REFERENCES orden_trabajo(id),
  arma_id             UUID         NOT NULL REFERENCES arma(id),
  muestra_id          UUID         NOT NULL REFERENCES muestra(id),
  resolucion_arma_id  UUID         REFERENCES d11_resolucion_arma(id) ON DELETE SET NULL,
  orden               INTEGER      NOT NULL,
  tipo                VARCHAR(40)  NOT NULL,
  serie_normalizada   VARCHAR(80),
  sin_serie           BOOLEAN      NOT NULL DEFAULT FALSE,
  accesorios          VARCHAR(300),
  lote                VARCHAR(80),
  ubicacion           VARCHAR(160),
  -- Clasificación IT05 (11.11) y camino (11.12)
  clase               VARCHAR(20)  CHECK (clase IS NULL OR clase IN ('arma', 'accesorio', 'maquina_recargadora')),
  permisibilidad      VARCHAR(12)  CHECK (permisibilidad IS NULL OR permisibilidad IN ('permitida', 'prohibida')),
  camino              VARCHAR(12)  CHECK (camino IS NULL OR camino IN ('cip', 'completa', 'directo')),
  clasificada_por     UUID REFERENCES usuario(id),
  clasificada_at      TIMESTAMPTZ,
  -- Acuñación BPCH IT08 (11.22)
  acunacion_numero    VARCHAR(30),
  acunacion_anio      INTEGER CHECK (acunacion_anio IS NULL OR acunacion_anio BETWEEN 1990 AND 2100),
  acunada_por         UUID REFERENCES usuario(id),
  acunada_at          TIMESTAMPTZ,
  -- Entrega al importador (11.27)
  entrega_id          UUID,
  created_by          UUID,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (muestra_id)
);
COMMENT ON TABLE d11_arma_ot IS 'Arma registrada en una OT de la D11: una fila = una muestra de la OT (EP-11 11.8). Guarda clasificación, camino, acuñación y entrega.';
CREATE INDEX IF NOT EXISTS ix_d11_arma_ot ON d11_arma_ot (ot_id, orden);
CREATE UNIQUE INDEX IF NOT EXISTS ux_d11_arma_ot_serie ON d11_arma_ot (ot_id, serie_normalizada) WHERE serie_normalizada IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_d11_arma_ot_arma ON d11_arma_ot (arma_id);

-- -----------------------------------------------------------------------------
-- 5 · Custodia del arma importada (11.7) y guía de entrega (11.27)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS d11_entrega (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenant(id),
  ot_id               UUID         NOT NULL REFERENCES orden_trabajo(id),
  numero              VARCHAR(30)  NOT NULL,
  receptor_nombre     VARCHAR(200) NOT NULL,
  receptor_documento  VARCHAR(40),
  fecha               DATE         NOT NULL,
  observaciones       TEXT,
  created_by          UUID REFERENCES usuario(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero)
);
COMMENT ON TABLE d11_entrega IS 'Guía de entrega de armas al importador (EP-11 11.27): una por entrega; cada arma deja su movimiento de salida.';
CREATE INDEX IF NOT EXISTS ix_d11_entrega_ot ON d11_entrega (ot_id);

CREATE TABLE IF NOT EXISTS d11_arma_movimiento (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenant(id),
  arma_ot_id    UUID         NOT NULL REFERENCES d11_arma_ot(id),
  evento        VARCHAR(20)  NOT NULL CHECK (evento IN ('entrada', 'cambio_ubicacion', 'salida')),
  fecha         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ubicacion     VARCHAR(160),
  motivo        VARCHAR(300) NOT NULL,
  responsable   UUID REFERENCES usuario(id),
  receptor      VARCHAR(200),
  entrega_id    UUID REFERENCES d11_entrega(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE d11_arma_movimiento IS 'Cadena de custodia del arma importada (EP-11 11.7 y 11.27). Movimientos inmutables.';
CREATE INDEX IF NOT EXISTS ix_d11_arma_mov ON d11_arma_movimiento (arma_ot_id, fecha);

CREATE OR REPLACE FUNCTION d11_movimiento_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de custodia del arma no se modifican ni se borran: registre un movimiento nuevo.';
END $$;
DROP TRIGGER IF EXISTS trg_d11_movimiento_inmutable ON d11_arma_movimiento;
CREATE TRIGGER trg_d11_movimiento_inmutable BEFORE UPDATE OR DELETE ON d11_arma_movimiento
  FOR EACH ROW EXECUTE FUNCTION d11_movimiento_inmutable();

-- -----------------------------------------------------------------------------
-- 6 · Certificado por arma (11.23): vigencia y emisiones en bloque (rangos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS d11_emision (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenant(id),
  ot_id       UUID         NOT NULL REFERENCES orden_trabajo(id),
  desde       VARCHAR(80)  NOT NULL,
  hasta       VARCHAR(80)  NOT NULL,
  cantidad    INTEGER      NOT NULL CHECK (cantidad >= 1),
  created_by  UUID REFERENCES usuario(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE d11_emision IS 'Emisión en bloque de certificados por arma: rango de numeración desde–hasta y cantidad (maqueta «Rangos de certificados de la OT»).';
CREATE INDEX IF NOT EXISTS ix_d11_emision_ot ON d11_emision (ot_id, created_at);

CREATE TABLE IF NOT EXISTS d11_certificado_arma (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenant(id),
  arma_ot_id      UUID         NOT NULL REFERENCES d11_arma_ot(id),
  certificado_id  UUID         NOT NULL REFERENCES certificado(id),
  emision_id      UUID         REFERENCES d11_emision(id),
  vigente_desde   DATE         NOT NULL,
  vigente_hasta   DATE         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (certificado_id),
  CHECK (vigente_hasta > vigente_desde)
);
COMMENT ON TABLE d11_certificado_arma IS 'Certificado de un arma (DTCG-PG03-IT11): documento del circuito general (certificado) con su vigencia (por defecto 4 años).';
CREATE INDEX IF NOT EXISTS ix_d11_cert_arma ON d11_certificado_arma (arma_ot_id);

-- -----------------------------------------------------------------------------
-- 7 · Tipos de documento de la D11 en la matriz de firmas (11.42) y numeración
-- -----------------------------------------------------------------------------
ALTER TABLE flujo_firma DROP CONSTRAINT IF EXISTS flujo_firma_tipo_documento_check;
ALTER TABLE flujo_firma ADD CONSTRAINT flujo_firma_tipo_documento_check CHECK (tipo_documento IN (
  'INFORME_ENSAYO','IVC','INFORME_TECNICO','CERTIFICADO_CALIBRACION',
  'INFORME_INSPECCION','CERTIFICADO_CONFORMIDAD','INFORME_INCUMPLIMIENTO',
  'COTIZACION','OT_DISPOSICION','SOLICITUD_ADQUISICION','OFICIO',
  'CERTIFICADO_ARMA','INFORME_INCUMPLIMIENTO_ARMA','CERTIFICADO_EVIDENCIA','INFORME_PERICIAL','NOTA_NO_CONFORMIDAD'));

CREATE TEMP TABLE IF NOT EXISTS _ff_d11 (
  tipo VARCHAR(40), unidad VARCHAR(20), orden INT, accion VARCHAR(20), rol VARCHAR(40),
  nivel VARCHAR(20), obligatorio BOOLEAN, descripcion TEXT
);
TRUNCATE _ff_d11;
INSERT INTO _ff_d11 VALUES
  ('CERTIFICADO_ARMA',            'D11', 1, 'FIRMA', 'JEFE_LAB',   'MISMA',        TRUE,
   'Firma el Jefe de la Delegación Nº 11 (por confirmar: ¿cada certificado o cada OT?, EP-11 P2)'),
  ('INFORME_INCUMPLIMIENTO_ARMA', 'D11', 1, 'FIRMA', 'JEFE_LAB',   'MISMA',        TRUE,
   'Firma el Jefe de la Delegación Nº 11 (por confirmar, EP-11 P5)'),
  ('INFORME_INCUMPLIMIENTO_ARMA', 'D11', 2, 'VB',    'JEFE_DEPTO', 'DEPARTAMENTO', TRUE,
   'V°B° de la Subdirección BPCH, que informa a la DGMN (por confirmar, EP-11 P5)'),
  ('CERTIFICADO_EVIDENCIA',       'D11', 1, 'FIRMA', 'JEFE_LAB',   'MISMA',        TRUE,
   'Firma el Jefe de la Delegación Nº 11 (por confirmar, EP-11 11.36)'),
  ('INFORME_PERICIAL',            'D11', 1, 'ELABORA', 'INSPECTOR', 'MISMA',       TRUE,
   'Elabora el perito (por confirmar, EP-11 P13)'),
  ('INFORME_PERICIAL',            'D11', 2, 'FIRMA', 'JEFE_LAB',   'MISMA',        TRUE,
   'Firma el Jefe de la Delegación Nº 11 (por confirmar, EP-11 P13)'),
  ('NOTA_NO_CONFORMIDAD',         'D11', 1, 'FIRMA', 'JEFE_LAB',   'MISMA',        TRUE,
   'Firma el Jefe de la Delegación Nº 11 (EP-11 11.10; formato por confirmar, P5)');

INSERT INTO flujo_firma (id, tenant_id, tipo_documento, unidad_id, orden, accion, rol_id,
                         nivel_unidad, unidad_destino_id, obligatorio, activo, descripcion)
SELECT gen_random_uuid(), t.id, f.tipo, u.id, f.orden, f.accion, r.id, f.nivel, NULL, f.obligatorio, TRUE, f.descripcion
  FROM _ff_d11 f
  JOIN tenant t ON t.codigo = 'IDIC'
  JOIN rol r    ON r.tenant_id = t.id AND r.codigo = f.rol
  JOIN unidad u ON u.tenant_id = t.id AND u.codigo = f.unidad
 WHERE NOT EXISTS (
   SELECT 1 FROM flujo_firma x
    WHERE x.tenant_id = t.id AND x.tipo_documento = f.tipo AND x.orden = f.orden
      AND x.unidad_id IS NOT DISTINCT FROM u.id);

-- Número del certificado por arma: correlativo continuo de 6 cifras, como el LIMS
-- actual (344232…). Formato por confirmar (EP-11 P2); se cambia en Administración ›
-- Numeración de documentos.
INSERT INTO numeracion_documento
  (tenant_id, unidad_id, tipo_documento, formato, reinicio, correlativo_por_unidad, por_confirmar, fuente)
SELECT t.id, u.id, 'CERTIFICADO_ARMA', '{N:6}', 'continuo', FALSE, TRUE,
       'EP-11 11.23: un certificado por arma con correlativo en rangos (LIMS actual: 344232…). Formato por confirmar (EP-11 P2).'
  FROM tenant t JOIN unidad u ON u.tenant_id = t.id AND u.codigo = 'D11'
 WHERE NOT EXISTS (SELECT 1 FROM numeracion_documento n
                    WHERE n.tenant_id = t.id AND n.unidad_id = u.id AND n.tipo_documento = 'CERTIFICADO_ARMA');

-- -----------------------------------------------------------------------------
-- 8 · Notificación a DGMN del incumplimiento (EP-10 10.15)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_notificacion_dgmn (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenant(id),
  ot_id             UUID         NOT NULL REFERENCES orden_trabajo(id),
  certificado_id    UUID         NOT NULL REFERENCES certificado(id),
  destinatarios     TEXT[]       NOT NULL,
  medio             VARCHAR(20)  NOT NULL CHECK (medio IN ('oficina_partes', 'correo', 'integracion')),
  oficio_numero     VARCHAR(60),
  fecha_envio       DATE         NOT NULL,
  copia_internador  BOOLEAN      NOT NULL,
  observaciones     TEXT,
  created_by        UUID REFERENCES usuario(id),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (certificado_id)
);
COMMENT ON TABLE bpch_notificacion_dgmn IS 'Notificación a DGMN (y copia al internador) del Informe de Incumplimiento oficial (EP-10 10.15). Sin ella la OT no se cierra.';
CREATE INDEX IF NOT EXISTS ix_bpch_notif_dgmn_ot ON bpch_notificacion_dgmn (ot_id);

-- -----------------------------------------------------------------------------
-- 9 · Parámetros de la operación (Administración › Parámetros del sistema)
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'd11', v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('metodos_registro',  'Métodos que se cargan al registrar el arma (códigos del catálogo, separados por coma)', 1, '1292'),
  ('metodos_cip',       'Métodos del camino «Con cuño CIP · reconocimiento» (códigos, separados por coma)', 2, '1291,3500'),
  ('metodos_completa',  'Métodos del camino «Sin cuño CIP · prueba completa» (códigos, separados por coma)', 3, '1213,1202,1203,3500'),
  ('metodos_accesorio', 'Métodos de un accesorio (IT10), sin camino CIP (códigos, separados por coma)', 4, '2322'),
  ('metodos_maquina',   'Métodos de una máquina recargadora (IT12), sin camino CIP (códigos, separados por coma)', 5, '3706'),
  ('acunacion_cip',     'Un arma con cuño CIP también se acuña con el cuño BPCH (si | no)', 6, 'no'),
  ('vigencia_anios',    'Vigencia del certificado por arma, en años', 7, '4')
 ) AS v(codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 10 · Permisos
-- -----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'arma.registrar', 'arma', 'registrar',
   'D11: recepción de armas (aviso, acta), registro como muestra de la OT, clasificación, camino, ensayos, acuñación, custodia y entrega.'),
  (gen_random_uuid(), 'arma.programar', 'arma', 'programar',
   'D11: programar la recepción de las armas con el importador (Jefe de la Delegación Nº 11).'),
  (gen_random_uuid(), 'arma.catalogo', 'arma', 'catalogo',
   'D11: corregir o desactivar marcas, modelos y calibres del catálogo del arma.'),
  (gen_random_uuid(), 'bpch.dgmn.notificar', 'bpch', 'dgmn.notificar',
   'BPCH: registrar la notificación a DGMN y al internador de un Informe de Incumplimiento (EP-10 10.15).')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('INSPECTOR', 'arma.ver'), ('INSPECTOR', 'arma.registrar'),
    ('JEFE_LAB', 'arma.registrar'), ('JEFE_LAB', 'arma.programar'), ('JEFE_LAB', 'arma.catalogo'),
    ('JEFE_SECCION', 'arma.registrar'), ('JEFE_SECCION', 'arma.programar'), ('JEFE_SECCION', 'arma.catalogo'),
    ('JEFE_DEPTO', 'arma.registrar'), ('JEFE_DEPTO', 'arma.programar'), ('JEFE_DEPTO', 'arma.catalogo'),
    ('JEFE_DEPTO', 'bpch.dgmn.notificar'), ('SUBDIRECTOR', 'bpch.dgmn.notificar'), ('DIRECTOR', 'bpch.dgmn.notificar'),
    ('SUPERADMIN', 'arma.registrar'), ('SUPERADMIN', 'arma.programar'), ('SUPERADMIN', 'arma.catalogo'),
    ('SUPERADMIN', 'bpch.dgmn.notificar')
  ) AS m(rol, perm)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 11 · Plantilla del certificado por arma (DTCG-PG03-IT11 · formato por confirmar, P2)
-- -----------------------------------------------------------------------------
INSERT INTO plantilla_informe (tenant_id, repid, nombre, tipo, emision, activo, version)
SELECT t.id, 'CERTARMA', 'Certificado por arma (DTCG-PG03-IT11)', 'CERTIFICADO', 'conjunto', TRUE, 'v1'
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM plantilla_informe p WHERE p.tenant_id = t.id AND p.repid = 'CERTARMA');

UPDATE plantilla_informe SET cuerpo_html = $html$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>EJÉRCITO DE CHILE · INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Banco de Pruebas de Chile · Delegación Nº 11</span>
  </div>
  <div class="doc">
    <b>Nº {{certificado.numero}}</b>
    <span>DTCG-PG03-IT11 &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>CERTIFICADO DE ARMA</h1>

<table class="meta">
  <tr><th>Tipo</th><td>{{arma.tipo}}</td><th>Clase</th><td>{{arma.clase}}</td></tr>
  <tr><th>Marca</th><td>{{arma.marca}}</td><th>Modelo</th><td>{{arma.modelo}}</td></tr>
  <tr><th>Calibre</th><td>{{arma.calibre}}</td><th>País de origen</th><td>{{arma.pais}}</td></tr>
  <tr><th>Nº de serie</th><td>{{arma.serie}}</td><th>Accesorios</th><td>{{arma.accesorios}}</td></tr>
  <tr><th>Importador</th><td>{{arma.importador}}</td><th>Resolución DGMN</th><td>{{arma.resolucion}}</td></tr>
  <tr><th>Orden de trabajo</th><td>{{ot.codigo}} · muestra {{arma.muestra}}</td><th>Camino</th><td>{{arma.camino}}</td></tr>
</table>

<h2>Resultado</h2>
<table class="meta">
  <tr><th>Resultado</th><td><b>{{arma.resultado}}</b></td><th>Acuñación BPCH (IT08)</th><td>{{arma.acunacion}}</td></tr>
  <tr><th>Fecha de emisión</th><td>{{arma.vigente_desde}}</td><th>Vigente hasta</th><td><b>{{arma.vigente_hasta}}</b></td></tr>
</table>

{{tabla_resultados}}

{{qr_verificacion}}
<p>
  Verifique la autenticidad y la vigencia de este certificado con el código
  <b>{{certificado.codigo_verificacion}}</b> en {{arma.url_verificacion}}.
  La página pública no muestra datos personales.
</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Delegación Nº 11 · Banco de Pruebas de Chile</div>
</div>
$html$
WHERE repid = 'CERTARMA' AND (cuerpo_html IS NULL OR btrim(cuerpo_html) = '');
