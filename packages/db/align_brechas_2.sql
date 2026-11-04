-- =============================================================================
-- align_brechas_2.sql · brechas del contrato LIMS (calidad analítica)
-- -----------------------------------------------------------------------------
-- Idempotente (IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING).
--
--  1. §4.2.4 / §4.3.8 · El QC exigido por el método impide la EJECUCIÓN del
--     análisis: parámetro qc.bloqueo («ejecucion» por defecto | «informe»).
--     Regla en apps/api/src/qc/qc-ejecucion.ts. Sin tablas nuevas: el QC
--     vigente es el qc_control aprobado de la misma OT y método.
--  2. §4.3.3 · Historial de versiones del método (cat_metodo_version): cada
--     alta o cambio de un método deja una revisión numerada con fecha,
--     responsable, motivo y qué cambió. Parámetro metodo_version.motivo
--     («obligatorio» por defecto | «opcional»). Regla en
--     apps/api/src/catalogo/metodo-version.ts. No se reutiliza la heredada
--     metodo_version: cuelga del catálogo antiguo (`metodo`), no de cat_metodo.
-- =============================================================================

-- ------------------------------------------------------------- parámetros ---
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'qc', 'bloqueo',
       'Sin el QC exigido por el método aprobado en la OT: bloquear captura y aprobación (ejecucion) o solo el informe (informe)', 1, 'ejecucion'
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'metodo_version', 'motivo',
       'Motivo del cambio al modificar un método (obligatorio | opcional): queda en su historial de versiones', 1, 'obligatorio'
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- ------------------------------------------------------ cat_metodo_version ---
CREATE TABLE IF NOT EXISTS cat_metodo_version (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  cat_metodo_id  UUID NOT NULL REFERENCES cat_metodo(id) ON DELETE CASCADE,
  numero         INTEGER NOT NULL,                       -- revisión 1, 2, 3…
  origen         VARCHAR(20) NOT NULL DEFAULT 'edicion', -- inicial | alta | edicion | qc | margen
  motivo         TEXT,
  cambios        JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{campo, etiqueta, antes, despues}]
  foto           JSONB NOT NULL DEFAULT '{}'::jsonb,     -- el método tal como quedó (fn_cat_metodo_foto)
  usuario_id     UUID REFERENCES usuario(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cat_metodo_version_numero UNIQUE (cat_metodo_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_cat_metodo_version_tenant ON cat_metodo_version(tenant_id);
COMMENT ON TABLE cat_metodo_version IS
  'Historial de versiones de los métodos del catálogo v2 (contrato 4.3.3): revisión numerada con fecha, responsable, motivo, cambios (antes → después) y foto del método.';

-- Foto del método con los campos que se versionan (los mismos que compara
-- metodo-version.ts · CAMPOS_VERSION). NULL si el método no existe.
CREATE OR REPLACE FUNCTION fn_cat_metodo_foto(p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
           'codigo', m.codigo,
           'nombre', m.nombre,
           'ensayo', CASE WHEN e.id IS NULL THEN NULL ELSE e.codigo || ' · ' || e.nombre END,
           'norma', m.norma,
           'instrumento', m.instrumento,
           'version', m.version,
           'servgrp', m.servgrp,
           'factorOperacion', m.factor_operacion,
           'factorValor', m.factor_valor,
           'factorDescripcion', m.factor_descripcion,
           'equipoRequerido', m.equipo_requerido,
           'qcRequerido', m.qc_requerido,
           'qcTipos', to_jsonb(m.qc_tipos),
           'qcCriterios', m.qc_criterios,
           'margenAdvertenciaPct', m.margen_advertencia_pct,
           'activo', m.activo)
    FROM cat_metodo m LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id
   WHERE m.id = p_id
$$;

-- Revisión 1 de partida de cada método que aún no tiene historial: el estado
-- del método al activar el control de versiones (sin responsable conocido).
INSERT INTO cat_metodo_version (tenant_id, cat_metodo_id, numero, origen, motivo, cambios, foto, created_at)
SELECT m.tenant_id, m.id, 1, 'inicial',
       'Estado del método al activar el control de versiones.', '[]'::jsonb, fn_cat_metodo_foto(m.id), m.created_at
  FROM cat_metodo m
 WHERE NOT EXISTS (SELECT 1 FROM cat_metodo_version v WHERE v.cat_metodo_id = m.id)
ON CONFLICT (cat_metodo_id, numero) DO NOTHING;
