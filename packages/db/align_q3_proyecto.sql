-- =============================================================================
-- align_q3_proyecto.sql · Proyecto en la cotización (quinto envío IDIC, lote 3)
-- -----------------------------------------------------------------------------
-- El IDIC (correo del 20-11-2026) pide un campo «Proyecto» en la cotización con
-- código PROY/correlativo/año + nombre, filtrable en la Zona de informes. Los
-- detalles aún no están respondidos: los valores de aquí son PROVISIONALES y
-- quedan como parámetros editables (Administración › Parámetros del sistema ›
-- «Numeración de proyectos»).
--
--  1 · Tabla `proyecto` (ya estaba en schema.sql, sin uso): se asegura y se le
--      agregan año, correlativo y trazas de alta/edición. Un proyecto es de UN
--      solo cliente (cliente_id); la API exige que la cotización sea del mismo.
--  2 · Contador atómico `proyecto_correlativo` (tenant, serie): misma técnica
--      que el correlativo de OT (align_ot_correlativo.sql) y el de cotización
--      (INSERT … ON CONFLICT DO UPDATE … RETURNING).
--  3 · `cotizacion.proyecto_id` y `orden_trabajo.proyecto_id`: la OT lo hereda
--      al aceptarse la cotización. `ot_encargo.proyecto` (texto que imprime el
--      IVC como «Nombre del proyecto») se sigue usando: la API lo rellena con
--      «PROY/001/2026 · Nombre» si estaba vacío.
--  4 · Parámetros `numeracion_proyecto` (formato PROY/{N}/{AAAA}, 3 dígitos,
--      reinicio anual). Solo INSERT … ON CONFLICT DO NOTHING: no pisa lo ya
--      configurado.
--  5 · Permiso nuevo `proyecto.gestionar` (crear, renombrar, activar o
--      desactivar proyectos) para el Ejecutivo de Ventas (COMERCIAL) y
--      SUPERADMIN, una sola vez (sql_paso_aplicado): si el IDIC se lo quita a
--      un rol, no se vuelve a dar. Ver proyectos = `cotizacion.ver`.
--
-- Aditivo e idempotente. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- --- 1 · Proyecto ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proyecto (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  codigo              VARCHAR(40) NOT NULL,
  nombre              VARCHAR(300) NOT NULL,
  descripcion         TEXT,
  cliente_id          UUID REFERENCES cliente(id),
  fecha_inicio        DATE,
  fecha_fin           DATE,
  presupuesto_clp     NUMERIC(14,2),
  activo              BOOLEAN DEFAULT TRUE,
  UNIQUE (tenant_id, codigo)
);

ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS anio        INTEGER;
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS correlativo INTEGER;
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES usuario(id);
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS updated_by  UUID REFERENCES usuario(id);

COMMENT ON TABLE proyecto IS
  'Proyecto del cliente (quinto envío IDIC): código PROY/correlativo/año + nombre. Se elige en la cotización y lo hereda la OT; filtro de la Zona de informes.';
COMMENT ON COLUMN proyecto.cliente_id IS 'Cliente dueño del proyecto: solo sus cotizaciones pueden llevarlo.';
COMMENT ON COLUMN proyecto.anio IS 'Año de la serie del correlativo (año de Chile al crear el proyecto).';
COMMENT ON COLUMN proyecto.correlativo IS 'Correlativo dentro de la serie (proyecto_correlativo).';

CREATE INDEX IF NOT EXISTS ix_proyecto_cliente ON proyecto (tenant_id, cliente_id);
CREATE INDEX IF NOT EXISTS ix_proyecto_activo  ON proyecto (tenant_id, activo);

-- --- 2 · Correlativo atómico -----------------------------------------------------
CREATE TABLE IF NOT EXISTS proyecto_correlativo (
  tenant_id  UUID        NOT NULL REFERENCES tenant(id),
  serie      VARCHAR(10) NOT NULL,
  ultimo     INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, serie)
);
COMMENT ON TABLE proyecto_correlativo IS
  'Contador atómico del código de proyecto por tenant y serie (año, o «global» sin reinicio). Se incrementa con INSERT … ON CONFLICT DO UPDATE RETURNING.';

-- Continúa sobre proyectos ya numerados con el formato por defecto (no reinicia ni choca con el UNIQUE).
INSERT INTO proyecto_correlativo (tenant_id, serie, ultimo)
SELECT p.tenant_id, substring(p.codigo from '^PROY/\d+/(\d{4})$'), MAX((substring(p.codigo from '^PROY/(\d+)/\d{4}$'))::INT)
  FROM proyecto p
 WHERE p.codigo ~ '^PROY/\d+/\d{4}$'
 GROUP BY p.tenant_id, substring(p.codigo from '^PROY/\d+/(\d{4})$')
ON CONFLICT (tenant_id, serie) DO UPDATE SET ultimo = GREATEST(proyecto_correlativo.ultimo, EXCLUDED.ultimo);

-- --- 3 · Enlaces -------------------------------------------------------------------
ALTER TABLE cotizacion    ADD COLUMN IF NOT EXISTS proyecto_id UUID REFERENCES proyecto(id);
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS proyecto_id UUID REFERENCES proyecto(id);
CREATE INDEX IF NOT EXISTS ix_cotizacion_proyecto    ON cotizacion (proyecto_id) WHERE proyecto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_orden_trabajo_proyecto ON orden_trabajo (proyecto_id) WHERE proyecto_id IS NOT NULL;
COMMENT ON COLUMN cotizacion.proyecto_id IS 'Proyecto del cliente (opcional). Lo hereda la OT al aceptarse.';
COMMENT ON COLUMN orden_trabajo.proyecto_id IS 'Proyecto heredado de la cotización. ot_encargo.proyecto conserva el texto que imprime el IVC.';

-- --- 4 · Parámetros de la numeración (provisionales) --------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, 90, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('numeracion_proyecto', 'formato', 'Formato del código de proyecto', 'PROY/{N}/{AAAA}'),
  ('numeracion_proyecto', 'digitos', 'Dígitos mínimos del correlativo del proyecto', '3'),
  ('numeracion_proyecto', 'reinicio', 'Reinicio del correlativo del proyecto', 'anual')
 ) AS v(categoria, codigo, etiqueta, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 5 · Permiso proyecto.gestionar ---------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'proyecto.gestionar', 'proyecto', 'gestionar',
   'Crear proyectos de cliente, cambiar su nombre y activarlos o desactivarlos (verlos: cotizacion.ver)')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

DO $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion)
  VALUES ('q3.proyecto.permiso', 'Proyecto en la cotización: proyecto.gestionar para COMERCIAL y SUPERADMIN (lote 3)')
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r.id, p.id
      FROM rol r JOIN permiso p ON p.codigo = 'proyecto.gestionar'
     WHERE COALESCE(r.alias_de, r.codigo) IN ('COMERCIAL', 'SUPERADMIN')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
