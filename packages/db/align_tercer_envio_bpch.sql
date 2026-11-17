-- =============================================================================
-- LIMS IDIC · Tercer envío IDIC (17-11-2026) · BPCH · Aiuken
--   Cambios de datos y parámetros que acompañan a las respuestas del IDIC de la
--   hoja «15 BPCH». Idempotente: se puede ejecutar dos veces.
--
--   BPCH-19 · Numeración 3000 / empresa / OT / muestra:
--     · cliente.codigo_empresa (código de empresa, token {EMPRESA});
--     · el Informe de Inspección BPCH pasa de {N:4} a {EMPRESA} en el 2.º tramo;
--     · el Certificado de Conformidad y el Informe de Incumplimiento repiten el
--       número del informe, sin los sufijos /CC e /II;
--     · el número es único POR TIPO de documento (antes, en todo el tenant).
--     Solo se cambian las reglas que conservan el formato sembrado: una regla
--     que el IDIC ya editó en Administración › Numeración no se pisa.
--   BPCH-48 · modalidad (TERRENO / ADMINISTRATIVO) e inspector_ids (personas
--     con rol INSPECTOR de la unidad) en bpch_cabecera_ot, bpch_internacion y
--     bpch_reinspeccion.
--     El texto libre «inspectores» se conserva para los registros anteriores.
--   BPCH-43 · Matriz de firmas: sin V°B° del Director en el Informe de
--     Incumplimiento (que también usa el informe de rechazo de prototipo).
--   BPCH-42 · Plantillas SCC: imprimen el contacto ({{bpch.contacto}}).
--   BPCH-03 · Producción Nacional siempre sin cobro: las O/C operativas
--     vigentes quedan «sin cobro» (las OT ya generadas no se tocan).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1 · BPCH-19 · código de empresa en el cliente
-- -----------------------------------------------------------------------------
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS codigo_empresa VARCHAR(20);
COMMENT ON COLUMN cliente.codigo_empresa IS
  'Código de empresa (BPCH-19): 2.º tramo del número del Informe de Inspección BPCH (3000/<empresa>/OT/muestra), token {EMPRESA}. Opcional.';

-- -----------------------------------------------------------------------------
-- 2 · BPCH-19 · formatos de numeración BPCH (solo si siguen como se sembraron)
-- -----------------------------------------------------------------------------
UPDATE numeracion_documento n
   SET formato = '{CODSUCDEL}/{EMPRESA}/{OT_N:5}/{MUESTRA_N:6}',
       por_confirmar = FALSE,
       fuente = 'Respuesta IDIC tercer envío 17-11-2026 (BPCH-19): 3000 / empresa / OT / muestra; el 2.º tramo es el código de empresa del cliente.',
       updated_at = now()
  FROM unidad u
 WHERE u.id = n.unidad_id AND u.codigo = 'BPCH'
   AND n.tipo_documento = 'INFORME_INSPECCION'
   AND n.formato = '{CODSUCDEL}/{N:4}/{OT_N:5}/{MUESTRA_N:6}';

UPDATE numeracion_documento n
   SET formato = '{NUM_INFORME}',
       por_confirmar = FALSE,
       fuente = 'Respuesta IDIC tercer envío 17-11-2026 (BPCH-19): el certificado repite el número del Informe de Inspección (sin /CC); el número es único por tipo de documento.',
       updated_at = now()
  FROM unidad u
 WHERE u.id = n.unidad_id AND u.codigo = 'BPCH'
   AND n.tipo_documento = 'CERTIFICADO_CONFORMIDAD'
   AND n.formato = '{NUM_INFORME}/CC';

UPDATE numeracion_documento n
   SET formato = '{NUM_INFORME}',
       por_confirmar = FALSE,
       fuente = 'Respuesta IDIC tercer envío 17-11-2026 (BPCH-19): el informe de incumplimiento repite el número del Informe de Inspección (sin /II); el número es único por tipo de documento.',
       updated_at = now()
  FROM unidad u
 WHERE u.id = n.unidad_id AND u.codigo = 'BPCH'
   AND n.tipo_documento = 'INFORME_INCUMPLIMIENTO'
   AND n.formato = '{NUM_INFORME}/II';

-- -----------------------------------------------------------------------------
-- 3 · BPCH-19 · unicidad del número por tipo de documento
--     Antes: UNIQUE(tenant_id, codigo) y ux_certificado_numero (tenant_id, numero).
--     Ahora: (tenant_id, tipo de documento, codigo|numero).
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_certificado_tipo_codigo
  ON certificado (tenant_id, COALESCE(tipo_documento, ''), codigo);
CREATE UNIQUE INDEX IF NOT EXISTS ux_certificado_tipo_numero
  ON certificado (tenant_id, COALESCE(tipo_documento, ''), numero)
  WHERE numero IS NOT NULL;
-- Índice de búsqueda que declara el schema Prisma (@@index([tenantId, codigo])).
CREATE INDEX IF NOT EXISTS certificado_tenant_id_codigo_idx ON certificado (tenant_id, codigo);

-- Quita la unicidad global por (tenant_id, codigo), sea cual sea su nombre.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid AND rel.relname = 'certificado'
     WHERE con.contype = 'u'
       AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
              FROM unnest(con.conkey) k JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
           = ARRAY['codigo', 'tenant_id']
  LOOP
    EXECUTE format('ALTER TABLE certificado DROP CONSTRAINT %I', r.conname);
  END LOOP;
  -- Índices únicos sueltos con esas mismas dos columnas (p. ej. creados por Prisma).
  FOR r IN
    SELECT i.relname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid AND t.relname = 'certificado'
     WHERE x.indisunique AND NOT x.indisprimary
       AND x.indexprs IS NULL
       AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
              FROM unnest(x.indkey::int2[]) k JOIN pg_attribute att ON att.attrelid = x.indrelid AND att.attnum = k)
           = ARRAY['codigo', 'tenant_id']
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.relname);
  END LOOP;
END $$;
DROP INDEX IF EXISTS ux_certificado_numero;

-- -----------------------------------------------------------------------------
-- 4 · BPCH-48 · modalidad de la inspección e inspectores elegidos
-- -----------------------------------------------------------------------------
ALTER TABLE bpch_cabecera_ot ADD COLUMN IF NOT EXISTS modalidad VARCHAR(20);
ALTER TABLE bpch_cabecera_ot ADD COLUMN IF NOT EXISTS inspector_ids UUID[];
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bpch_cabecera_modalidad') THEN
    ALTER TABLE bpch_cabecera_ot ADD CONSTRAINT ck_bpch_cabecera_modalidad
      CHECK (modalidad IS NULL OR modalidad IN ('TERRENO', 'ADMINISTRATIVO'));
  END IF;
END $$;
COMMENT ON COLUMN bpch_cabecera_ot.modalidad IS
  'BPCH-48: TERRENO (exige dos inspectores para programar) o ADMINISTRATIVO (basta uno).';
-- Mismo dato en la inspección de Internación y de Reinspección (su cabecera vive en el expediente).
ALTER TABLE bpch_internacion  ADD COLUMN IF NOT EXISTS modalidad VARCHAR(20);
ALTER TABLE bpch_internacion  ADD COLUMN IF NOT EXISTS inspector_ids UUID[];
ALTER TABLE bpch_reinspeccion ADD COLUMN IF NOT EXISTS modalidad VARCHAR(20);
ALTER TABLE bpch_reinspeccion ADD COLUMN IF NOT EXISTS inspector_ids UUID[];
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bpch_internacion_modalidad') THEN
    ALTER TABLE bpch_internacion ADD CONSTRAINT ck_bpch_internacion_modalidad
      CHECK (modalidad IS NULL OR modalidad IN ('TERRENO', 'ADMINISTRATIVO'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bpch_reinspeccion_modalidad') THEN
    ALTER TABLE bpch_reinspeccion ADD CONSTRAINT ck_bpch_reinspeccion_modalidad
      CHECK (modalidad IS NULL OR modalidad IN ('TERRENO', 'ADMINISTRATIVO'));
  END IF;
END $$;
COMMENT ON COLUMN bpch_cabecera_ot.inspector_ids IS
  'BPCH-48: personas (usuario.id) con rol INSPECTOR de la unidad. La columna «inspectores» guarda sus iniciales (lo que imprimen los documentos); en registros anteriores, el texto libre de entonces.';

-- -----------------------------------------------------------------------------
-- 5 · BPCH-43 · sin V°B° del Director en el Informe de Incumplimiento
--     (también cubre el informe de rechazo de prototipo, que usa esa matriz)
-- -----------------------------------------------------------------------------
UPDATE flujo_firma ff
   SET activo = FALSE,
       descripcion = COALESCE(ff.descripcion, 'VB del Director') || ' · Desactivado: Respuesta IDIC tercer envío 17-11-2026 (BPCH-43)',
       updated_at = now()
  FROM rol r
 WHERE r.id = ff.rol_id AND r.codigo = 'DIRECTOR'
   AND ff.tipo_documento = 'INFORME_INCUMPLIMIENTO'
   AND ff.accion = 'VB'
   AND ff.activo;

-- -----------------------------------------------------------------------------
-- 6 · BPCH-42 · plantillas SCC: imprimir el contacto (nombre y correo)
--     Se añade una fila «Contacto» tras «Empresa / RUT» en las plantillas SCC
--     que aún no lo imprimen. Si una plantilla ya maquetada no tiene esa fila,
--     no se toca y se avisa (agregar {{bpch.contacto}} a mano en Plantillas).
-- -----------------------------------------------------------------------------
UPDATE plantilla_informe
   SET cuerpo_html = replace(
         cuerpo_html,
         '<tr><th>Empresa</th><td>{{bpch.empresa}}</td><th>RUT</th><td>{{bpch.rut}}</td></tr>',
         '<tr><th>Empresa</th><td>{{bpch.empresa}}</td><th>RUT</th><td>{{bpch.rut}}</td></tr>' || chr(10) ||
         '  <tr><th>Contacto</th><td colspan="3">{{bpch.contacto}}</td></tr>')
 WHERE repid IN ('SCCII', 'SCCCC', 'SCCDG', 'SCCIN', 'SCCID')
   AND cuerpo_html IS NOT NULL
   AND position('{{bpch.contacto}}' IN cuerpo_html) = 0
   AND position('<tr><th>Empresa</th><td>{{bpch.empresa}}</td><th>RUT</th><td>{{bpch.rut}}</td></tr>' IN cuerpo_html) > 0;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT repid, nombre FROM plantilla_informe
     WHERE repid IN ('SCCII', 'SCCCC', 'SCCDG', 'SCCIN', 'SCCID')
       AND cuerpo_html IS NOT NULL AND btrim(cuerpo_html) <> ''
       AND position('{{bpch.contacto}}' IN cuerpo_html) = 0
  LOOP
    RAISE NOTICE 'BPCH-42: la plantilla % (%) no imprime {{bpch.contacto}}; agréguelo en Administración › Plantillas.', r.repid, r.nombre;
  END LOOP;
END $$;

-- Versiones de plantilla: el cambio de arriba queda como nueva versión vigente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'plantilla_sincronizar_versiones') THEN
    PERFORM plantilla_sincronizar_versiones();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7 · BPCH-03 · Producción Nacional siempre sin cobro
-- -----------------------------------------------------------------------------
UPDATE bpch_oc_operativa
   SET con_cobro = FALSE, updated_at = now()
 WHERE con_cobro AND estado = 'vigente';

COMMIT;
