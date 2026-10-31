-- =============================================================================
-- LIMS IDIC · Repositorio de plantillas con versiones (frente plantillas) · Aiuken
-- =============================================================================
-- Hasta ahora `plantilla_informe` guardaba UN cuerpo (cuerpo_html) y UN formato
-- (config_informe) que se pisaban al editar, sin historial ni rastro de qué
-- versión usó cada documento emitido. Este fichero añade:
--
--   · plantilla_informe_version: cada versión del cuerpo Y del formato de una
--     plantilla (los dos van juntos: el formato también se versiona), con
--     estado BORRADOR → VIGENTE → RETIRADA, quién la redactó, quién la aprobó y
--     el motivo del cambio. Una sola VIGENTE y un solo BORRADOR por plantilla.
--   · Migración: cada plantilla existente pasa a ser su versión 1 VIGENTE.
--   · plantilla_sincronizar_versiones(): si un SQL de despliegue cambia el
--     cuerpo o el formato de una plantilla (los align_* lo hacen con UPDATE),
--     la vigente anterior queda RETIRADA y lo nuevo entra como versión VIGENTE
--     con origen «script». Se llama aquí y otra vez en align_cierre_permisos.sql
--     (último fichero), para recoger los SQL que se añadan después de este.
--   · certificado.plantilla_version_id: versión con que se emitió cada
--     documento. Un disparador la rellena con la VIGENTE en cualquier ruta de
--     emisión que no la indique. Los documentos ya emitidos quedan con la
--     versión 1 migrada (aproximación: su contenido real es el documento_html
--     sellado, que no cambia).
--   · Permiso plantilla.aprobar (Gestión de Calidad, Dirección, Subdirección y
--     Jefatura de Departamento). Redactar sigue siendo plantilla.gestionar.
--
-- Las columnas plantilla_informe.cuerpo_html / config_informe se conservan como
-- ESPEJO de la versión VIGENTE (al aprobar se copian), para que todo el código
-- que ya las lee siga viendo lo vigente.
-- Aditivo e idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS plantilla_informe_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  plantilla_id    UUID NOT NULL REFERENCES plantilla_informe(id) ON DELETE CASCADE,
  numero          INT  NOT NULL,                              -- correlativo por plantilla: 1, 2, 3…
  cuerpo_html     TEXT,
  config_informe  JSONB,
  estado          VARCHAR(12) NOT NULL DEFAULT 'BORRADOR',
  motivo          TEXT,                                       -- motivo del cambio
  origen          VARCHAR(20) NOT NULL DEFAULT 'pantalla',    -- migracion | pantalla | script | restaurada | duplicada
  basada_en_id    UUID REFERENCES plantilla_informe_version(id),
  creado_por      UUID REFERENCES usuario(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por UUID REFERENCES usuario(id),
  actualizado_en  TIMESTAMPTZ,
  editores        UUID[] NOT NULL DEFAULT '{}',               -- todos los que escribieron el borrador (no lo aprueban)
  aprobado_por   UUID REFERENCES usuario(id),
  aprobado_en     TIMESTAMPTZ,
  retirado_en     TIMESTAMPTZ,
  CONSTRAINT ck_piv_estado CHECK (estado IN ('BORRADOR', 'VIGENTE', 'RETIRADA')),
  CONSTRAINT ux_piv_numero UNIQUE (plantilla_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_piv_vigente  ON plantilla_informe_version(plantilla_id) WHERE estado = 'VIGENTE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_piv_borrador ON plantilla_informe_version(plantilla_id) WHERE estado = 'BORRADOR';
CREATE INDEX IF NOT EXISTS idx_piv_tenant ON plantilla_informe_version(tenant_id);
COMMENT ON TABLE plantilla_informe_version IS
  'Versiones del cuerpo y del formato de cada plantilla. Una VIGENTE (la que usa el render) y como mucho un BORRADOR; las anteriores quedan RETIRADA.';

-- ------------------------------------------------ sincronización con espejo ---
CREATE OR REPLACE FUNCTION plantilla_sincronizar_versiones() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n  integer := 0;
  k  integer;
  r  record;
BEGIN
  -- 1. Plantillas sin ninguna versión: su contenido actual es la versión 1 VIGENTE.
  INSERT INTO plantilla_informe_version
    (tenant_id, plantilla_id, numero, cuerpo_html, config_informe, estado, motivo, origen, creado_en, aprobado_en)
  SELECT p.tenant_id, p.id, 1, p.cuerpo_html, p.config_informe, 'VIGENTE',
         'Versión inicial migrada desde la plantilla existente.', 'migracion',
         COALESCE(p.created_at, now()), COALESCE(p.created_at, now())
    FROM plantilla_informe p
   WHERE NOT EXISTS (SELECT 1 FROM plantilla_informe_version v WHERE v.plantilla_id = p.id);
  GET DIAGNOSTICS k = ROW_COUNT;
  n := n + k;

  -- 2. La vigente no coincide con el espejo: un SQL de despliegue cambió la plantilla.
  FOR r IN
    SELECT v.id, v.plantilla_id, p.tenant_id, p.cuerpo_html, p.config_informe
      FROM plantilla_informe_version v
      JOIN plantilla_informe p ON p.id = v.plantilla_id
     WHERE v.estado = 'VIGENTE'
       AND (v.cuerpo_html IS DISTINCT FROM p.cuerpo_html OR v.config_informe IS DISTINCT FROM p.config_informe)
  LOOP
    UPDATE plantilla_informe_version SET estado = 'RETIRADA', retirado_en = now() WHERE id = r.id;
    INSERT INTO plantilla_informe_version
      (tenant_id, plantilla_id, numero, cuerpo_html, config_informe, estado, motivo, origen, basada_en_id, aprobado_en)
    VALUES (r.tenant_id, r.plantilla_id,
            (SELECT COALESCE(MAX(numero), 0) + 1 FROM plantilla_informe_version WHERE plantilla_id = r.plantilla_id),
            r.cuerpo_html, r.config_informe, 'VIGENTE',
            'Actualización aplicada por un script de despliegue (packages/db).', 'script', r.id, now());
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

SELECT plantilla_sincronizar_versiones();

-- ------------------------------------------- versión usada por cada documento ---
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS plantilla_version_id UUID REFERENCES plantilla_informe_version(id);
CREATE INDEX IF NOT EXISTS idx_certificado_plantilla_version ON certificado(plantilla_version_id);
COMMENT ON COLUMN certificado.plantilla_version_id IS
  'Versión de la plantilla con que se emitió el documento. Los emitidos antes del versionado apuntan a la versión 1 migrada.';

-- Documentos anteriores al versionado: versión 1 migrada de su plantilla.
UPDATE certificado c
   SET plantilla_version_id = v.id
  FROM plantilla_informe_version v
 WHERE c.plantilla_version_id IS NULL
   AND c.plantilla_id IS NOT NULL
   AND v.plantilla_id = c.plantilla_id
   AND v.numero = 1
   AND v.origen = 'migracion';

-- Cualquier ruta de emisión que no indique versión toma la VIGENTE.
CREATE OR REPLACE FUNCTION certificado_version_plantilla() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plantilla_version_id IS NULL AND NEW.plantilla_id IS NOT NULL THEN
    SELECT id INTO NEW.plantilla_version_id
      FROM plantilla_informe_version
     WHERE plantilla_id = NEW.plantilla_id AND estado = 'VIGENTE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_certificado_version_plantilla ON certificado;
CREATE TRIGGER trg_certificado_version_plantilla BEFORE INSERT ON certificado
  FOR EACH ROW EXECUTE FUNCTION certificado_version_plantilla();

-- --------------------------------------------------------------- permisos ---
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'plantilla.aprobar', 'plantilla', 'aprobar',
   'Aprobar el borrador de una plantilla de informe: pasa a VIGENTE y la anterior a RETIRADA. No se aprueba el borrador propio.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('CALIDAD'), ('DIRECTOR'), ('SUBDIRECTOR'), ('JEFE_DEPTO'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo = 'plantilla.aprobar'
ON CONFLICT DO NOTHING;
