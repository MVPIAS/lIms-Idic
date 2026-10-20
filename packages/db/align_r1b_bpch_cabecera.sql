-- =============================================================================
-- align_r1b_bpch_cabecera.sql · Cabecera de inspección en toda OT del BPCH
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt. Reglas: docs/FLUJO_BPCH_CABECERA_OT.md.
--
-- EP-10 10.3 («Registrar la cabecera de inspección») y EP-07 7.8: la cabecera
-- que imprimen el Informe de Inspección, el Certificado de Conformidad y el
-- Informe de Incumplimiento solo existía en los expedientes de Internación y
-- Reinspección. La OT directa de una sucursal y la de Producción Nacional
-- salían sin lugar, CNC, lote ni clase UN (v_bpch_cabecera_ot no las unía).
--
--   1. bpch_cabecera_ot: cabecera propia de la OT (lugar, dirección, comuna,
--      contacto, fecha, inspectores, procedimiento, documento de origen,
--      esquema, elementos, CNC-DGMN, clase y Nº UN, lote, tamaños, vencimiento
--      del producto, vigencia del informe y observaciones) + su historial.
--   2. v_bpch_cabecera_ot: añade dirección, comuna y contacto a Internación y
--      Reinspección, y dos ramas nuevas: Producción Nacional (con lo que ya
--      sabe el programa: RAF, O/C, producto, lote, lugar y fecha programada) y
--      OT directa.
--   3. Permiso bpch.cabecera.gestionar.
-- =============================================================================

-- --- 1 · Cabecera propia de la OT --------------------------------------------
CREATE TABLE IF NOT EXISTS bpch_cabecera_ot (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID         NOT NULL REFERENCES tenant(id),
  ot_id                       UUID         NOT NULL REFERENCES orden_trabajo(id),
  lugar_inspeccion            VARCHAR(240),
  direccion                   VARCHAR(240),
  comuna                      VARCHAR(120),
  contacto                    VARCHAR(200),
  fecha_inspeccion            DATE,
  inspectores                 VARCHAR(300),
  procedimiento               VARCHAR(120),
  documento_origen            VARCHAR(200),
  fecha_documento             DATE,
  esquema                     VARCHAR(10),
  elemento_generico           VARCHAR(240),
  elemento_especifico         VARCHAR(240),
  cnc_dgmn                    VARCHAR(60),
  clase_division_un           VARCHAR(40),
  numero_un                   VARCHAR(20),
  identificacion_lote         VARCHAR(200),
  tamano_lote                 INTEGER,
  tamano_muestra              INTEGER,
  fecha_vencimiento_producto  DATE,
  vigencia_informe            DATE,
  observaciones               TEXT,
  created_by                  UUID         REFERENCES usuario(id),
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by                  UUID         REFERENCES usuario(id),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_bpch_cabecera_ot UNIQUE (ot_id),
  CONSTRAINT ck_bpch_cabecera_esquema CHECK (esquema IS NULL OR esquema IN ('LOTES', 'TIPO')),
  CONSTRAINT ck_bpch_cabecera_tamanos CHECK (
    (tamano_lote IS NULL OR tamano_lote > 0) AND (tamano_muestra IS NULL OR tamano_muestra > 0)
    AND (tamano_lote IS NULL OR tamano_muestra IS NULL OR tamano_muestra <= tamano_lote))
);
COMMENT ON TABLE bpch_cabecera_ot IS
  'Cabecera de inspección de una OT del BPCH (EP-10 10.3): la de la OT directa y la de Producción Nacional; en Internación y Reinspección aporta dirección, comuna y contacto (el resto vive en su expediente).';
CREATE INDEX IF NOT EXISTS ix_bpch_cabecera_ot_tenant ON bpch_cabecera_ot (tenant_id);

CREATE TABLE IF NOT EXISTS bpch_cabecera_ot_historial (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenant(id),
  ot_id       UUID        NOT NULL REFERENCES orden_trabajo(id),
  cambios     JSONB       NOT NULL DEFAULT '{}',
  usuario_id  UUID        REFERENCES usuario(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE bpch_cabecera_ot_historial IS 'Cambios de la cabecera de inspección de la OT («queda en el historial», EP-10 10.3): campo → { antes, despues }.';
CREATE INDEX IF NOT EXISTS ix_bpch_cabecera_ot_historial ON bpch_cabecera_ot_historial (ot_id, created_at);

-- --- 2 · Vista de la cabecera de los documentos BPCH ---------------------------
-- Mismas columnas y orden que align_bpch_internacion_reinspeccion.sql + dirección,
-- comuna y contacto al final; las plantillas la leen como {{bpch.*}}.
DROP VIEW IF EXISTS v_bpch_cabecera_ot;
CREATE VIEW v_bpch_cabecera_ot AS
SELECT i.ot_id,
       'INTERNACION'::text                         AS proceso,
       i.numero                                    AS expediente,
       'Internación'::text                         AS origen,
       CASE i.esquema WHEN 'TIPO' THEN 'Tipo' ELSE 'Por lotes' END AS esquema,
       i.procedimiento,
       i.resolucion_numero || ' · ' || to_char(i.resolucion_fecha, 'DD-MM-YYYY') AS documento,
       cl.razon_social                             AS empresa,
       cl.rut                                      AS rut,
       u.nombre                                    AS organismo,
       i.lugar_inspeccion,
       to_char(i.fecha_inspeccion, 'DD-MM-YYYY')   AS fecha_inspeccion,
       i.inspectores,
       (SELECT string_agg(COALESCE(it.elemento_generico, ''), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS elemento_generico,
       (SELECT string_agg(it.elemento_especifico, ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS elemento_especifico,
       (SELECT string_agg(COALESCE(it.cnc_dgmn, '—'), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS cnc_dgmn,
       (SELECT string_agg(COALESCE(it.clase_division_un, '—') || ' · ' || COALESCE(it.numero_un, '—'), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS clase_un,
       (SELECT string_agg(COALESCE(it.identificacion_lote, '—'), ' / ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS lote,
       (SELECT string_agg(COALESCE(it.tamano_lote::text, '—') || ' / ' || COALESCE(it.tamano_muestra::text, '—'), ' · ' ORDER BY it.orden) FROM bpch_internacion_item it WHERE it.internacion_id = i.id) AS tamano_lote_muestra,
       to_char(i.fecha_vencimiento_producto, 'DD-MM-YYYY') AS vencimiento_producto,
       to_char(i.vigencia_informe, 'DD-MM-YYYY')   AS vigencia_informe,
       i.observaciones_inspeccion                  AS observaciones,
       NULL::text                                  AS motivo,
       c.direccion                                 AS direccion,
       c.comuna                                    AS comuna,
       c.contacto                                  AS contacto
  FROM bpch_internacion i
  JOIN cliente cl ON cl.id = i.cliente_id
  JOIN unidad u ON u.id = i.unidad_inspeccion_id
  LEFT JOIN bpch_cabecera_ot c ON c.ot_id = i.ot_id
 WHERE i.ot_id IS NOT NULL
UNION ALL
SELECT r.ot_id,
       'REINSPECCION'::text,
       r.numero,
       'Reinspección'::text,
       CASE r.esquema WHEN 'TIPO' THEN 'Tipo' ELSE 'Por lotes' END,
       r.procedimiento,
       COALESCE(r.documento_solicitud, 'Solicitud') || ' · ' || to_char(r.fecha_solicitud, 'DD-MM-YYYY'),
       cl.razon_social,
       cl.rut,
       u.nombre,
       r.lugar_inspeccion,
       to_char(r.fecha_inspeccion, 'DD-MM-YYYY'),
       r.inspectores,
       r.elemento_generico,
       r.elemento_especifico,
       r.cnc_dgmn,
       COALESCE(r.clase_division_un, '—') || ' · ' || COALESCE(r.numero_un, '—'),
       r.identificacion_lote,
       COALESCE(r.tamano_lote::text, '—') || ' / ' || COALESCE(r.tamano_muestra::text, '—'),
       to_char(r.fecha_vencimiento_producto, 'DD-MM-YYYY'),
       to_char(r.vigencia_informe, 'DD-MM-YYYY'),
       r.observaciones_inspeccion,
       r.motivo,
       c.direccion,
       c.comuna,
       c.contacto
  FROM bpch_reinspeccion r
  JOIN cliente cl ON cl.id = r.cliente_id
  JOIN unidad u ON u.id = r.unidad_inspeccion_id
  LEFT JOIN bpch_cabecera_ot c ON c.ot_id = r.ot_id
 WHERE r.ot_id IS NOT NULL
UNION ALL
-- Producción Nacional (EP-07 7.8): lo que no se registra en la cabecera sale del programa.
SELECT pi.ot_id,
       'PRODUCCION_NACIONAL'::text,
       oc.numero,
       'Producción Nacional'::text,
       CASE c.esquema WHEN 'TIPO' THEN 'Tipo' ELSE 'Por lotes' END,
       c.procedimiento,
       COALESCE(c.documento_origen || COALESCE(' · ' || to_char(c.fecha_documento, 'DD-MM-YYYY'), ''),
                'RAF ' || raf.numero || COALESCE(' · ' || to_char(raf.fecha, 'DD-MM-YYYY'), '')),
       cl.razon_social,
       cl.rut,
       u.nombre,
       COALESCE(c.lugar_inspeccion, pi.lugar),
       to_char(COALESCE(c.fecha_inspeccion, pi.fecha_programada), 'DD-MM-YYYY'),
       c.inspectores,
       c.elemento_generico,
       COALESCE(c.elemento_especifico, ocp.producto),
       c.cnc_dgmn,
       COALESCE(c.clase_division_un, '—') || ' · ' || COALESCE(c.numero_un, '—'),
       COALESCE(c.identificacion_lote, pi.lote),
       COALESCE(c.tamano_lote::text, '—') || ' / ' || COALESCE(c.tamano_muestra::text, '—'),
       to_char(c.fecha_vencimiento_producto, 'DD-MM-YYYY'),
       to_char(c.vigencia_informe, 'DD-MM-YYYY'),
       c.observaciones,
       NULL::text,
       c.direccion,
       c.comuna,
       c.contacto
  FROM bpch_pn_inspeccion pi
  JOIN bpch_oc_operativa oc ON oc.id = pi.oc_id
  JOIN bpch_raf raf ON raf.id = oc.raf_id
  JOIN bpch_oc_producto ocp ON ocp.id = pi.oc_producto_id
  JOIN cliente cl ON cl.id = oc.cliente_id
  JOIN unidad u ON u.id = pi.unidad_id
  LEFT JOIN bpch_cabecera_ot c ON c.ot_id = pi.ot_id
 WHERE pi.ot_id IS NOT NULL AND NOT pi.anulada
UNION ALL
-- OT directa de una sucursal (EP-10 10.1): solo con su cabecera registrada.
SELECT c.ot_id,
       'DIRECTA'::text,
       o.codigo,
       'OT directa'::text,
       CASE c.esquema WHEN 'TIPO' THEN 'Tipo' ELSE 'Por lotes' END,
       c.procedimiento,
       c.documento_origen || COALESCE(' · ' || to_char(c.fecha_documento, 'DD-MM-YYYY'), ''),
       cl.razon_social,
       cl.rut,
       u.nombre,
       c.lugar_inspeccion,
       to_char(c.fecha_inspeccion, 'DD-MM-YYYY'),
       c.inspectores,
       c.elemento_generico,
       c.elemento_especifico,
       c.cnc_dgmn,
       COALESCE(c.clase_division_un, '—') || ' · ' || COALESCE(c.numero_un, '—'),
       c.identificacion_lote,
       COALESCE(c.tamano_lote::text, '—') || ' / ' || COALESCE(c.tamano_muestra::text, '—'),
       to_char(c.fecha_vencimiento_producto, 'DD-MM-YYYY'),
       to_char(c.vigencia_informe, 'DD-MM-YYYY'),
       c.observaciones,
       NULL::text,
       c.direccion,
       c.comuna,
       c.contacto
  FROM bpch_cabecera_ot c
  JOIN orden_trabajo o ON o.id = c.ot_id
  LEFT JOIN cliente cl ON cl.id = o.cliente_id
  LEFT JOIN unidad u ON u.id = o.unidad_principal
 WHERE NOT EXISTS (SELECT 1 FROM bpch_internacion i WHERE i.ot_id = c.ot_id)
   AND NOT EXISTS (SELECT 1 FROM bpch_reinspeccion r WHERE r.ot_id = c.ot_id)
   AND NOT EXISTS (SELECT 1 FROM bpch_pn_inspeccion pi WHERE pi.ot_id = c.ot_id AND NOT pi.anulada);
COMMENT ON VIEW v_bpch_cabecera_ot IS
  'Cabecera común de los documentos BPCH por OT ({{bpch.*}} en las plantillas SCC): internación, reinspección, Producción Nacional y OT directa (align_r1b_bpch_cabecera.sql).';

-- --- 3 · Permiso ---------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'bpch.cabecera.gestionar', 'bpch', 'cabecera_gestionar',
   'Registrar la cabecera de inspección (lugar, fecha, inspectores, procedimiento, elemento, CNC, lote…) de una OT del BPCH de su alcance')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.cabecera.gestionar'
 WHERE r.codigo IN ('SUPERADMIN', 'ADMIN', 'JEFE_LAB', 'JEFELAB', 'JEFE_SECCION', 'INSPECTOR', 'SUBDIRECTOR', 'JEFE_DEPTO')
ON CONFLICT DO NOTHING;
