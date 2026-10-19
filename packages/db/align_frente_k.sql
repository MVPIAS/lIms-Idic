-- =============================================================================
-- align_frente_k.sql · Huecos de pantalla destapados al redactar los manuales v1.2
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente: una pasada deja la misma base que dos. Va al FINAL de
-- ORDEN_SQL.txt. Reglas: docs/FLUJO_LABORATORIO.md (órdenes internas),
-- docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md (clasificación del
-- producto de la O/C) y docs/FLUJO_METROLOGIA.md (emisión por el metrólogo).
--
--   1. Órdenes internas: ensayos que se derivan al laboratorio de destino,
--      quién la creó, anulación con motivo y su historial.
--   2. Parámetros del sistema: historial de los cambios de valor (porcentajes
--      de la tasa de internación y del IVA, `bpch_tasa`), con motivo.
--   3. Producción Nacional: historial de la clasificación de cada producto de
--      la O/C (asociar o cambiar después de crearla, con motivo).
--   4. Matriz de firmas: responsable ALTERNATIVO de un paso (rol y unidad). Se
--      siembra UNA sola vez para el paso de emisión del Certificado de
--      Calibración (el metrólogo habilitado puede emitir además del Jefe de
--      Departamento; decisión provisional, pendiente de confirmar con el IDIC).
--      Si el administrador lo quita, reaplicar este fichero no lo repone.
-- Sin permisos nuevos: órdenes internas ot.ver / ot.crear; tasa catalogo.gestionar;
-- O/C bpch.pn.gestionar; matriz admin.firmas.
-- =============================================================================

-- --- 1 · Órdenes internas ------------------------------------------------------
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS ensayos          UUID[]      NOT NULL DEFAULT '{}';
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS created_by       UUID        REFERENCES usuario(id);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS anulada_at       TIMESTAMPTZ;
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS anulada_por      UUID        REFERENCES usuario(id);
ALTER TABLE orden_interna ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

COMMENT ON COLUMN orden_interna.ensayos IS
  'Ensayos del catálogo (cat_ensayo.id) que se derivan al laboratorio de destino; deben ser de esa familia (destino_lab).';
COMMENT ON COLUMN orden_interna.estado IS
  'abierta (editable) → recibida → cerrada; anulada (con motivo, deja de dar acceso a la OT al laboratorio de destino).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_orden_interna_anulada_motivo') THEN
    ALTER TABLE orden_interna ADD CONSTRAINT ck_orden_interna_anulada_motivo CHECK (
      estado <> 'anulada' OR length(btrim(COALESCE(motivo_anulacion, ''))) >= 5
    ) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS orden_interna_historial (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  orden_interna_id  UUID NOT NULL REFERENCES orden_interna(id) ON DELETE CASCADE,
  accion            VARCHAR(20) NOT NULL CHECK (accion IN ('creada', 'editada', 'estado', 'anulada', 'eliminada')),
  detalle           JSONB,
  usuario_id        UUID REFERENCES usuario(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orden_interna_historial_oi ON orden_interna_historial (orden_interna_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orden_interna_destino ON orden_interna (destino_lab) WHERE deleted_at IS NULL;

-- --- 2 · Historial de los valores de los parámetros ------------------------------
CREATE TABLE IF NOT EXISTS parametro_sistema_historial (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  parametro_id   UUID NOT NULL REFERENCES parametro_sistema(id) ON DELETE CASCADE,
  categoria      VARCHAR(60) NOT NULL,
  codigo         VARCHAR(60) NOT NULL,
  valor_anterior TEXT,
  valor_nuevo    TEXT,
  motivo         TEXT NOT NULL CHECK (length(btrim(motivo)) >= 5),
  usuario_id     UUID REFERENCES usuario(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parametro_historial ON parametro_sistema_historial (tenant_id, categoria, codigo, created_at DESC);
COMMENT ON TABLE parametro_sistema_historial IS
  'Quién cambió el valor de un parámetro del sistema (p. ej. bpch_tasa.tasa_pct), cuándo, de qué a qué y por qué.';

-- --- 3 · Clasificación de los productos de la O/C (Producción Nacional) ---------
CREATE TABLE IF NOT EXISTS bpch_oc_producto_clasificacion_hist (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenant(id),
  oc_id                    UUID NOT NULL REFERENCES bpch_oc_operativa(id),
  oc_producto_id           UUID NOT NULL REFERENCES bpch_oc_producto(id) ON DELETE CASCADE,
  clasificacion_anterior   UUID REFERENCES bpch_clasificacion(id),
  clasificacion_nueva      UUID REFERENCES bpch_clasificacion(id),
  motivo                   TEXT,
  usuario_id               UUID REFERENCES usuario(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bpch_ocp_clas_hist ON bpch_oc_producto_clasificacion_hist (oc_producto_id, created_at);

-- --- 4 · Responsable alternativo de un paso de la matriz de firmas ---------------
ALTER TABLE flujo_firma ADD COLUMN IF NOT EXISTS rol_alternativo_id         UUID REFERENCES rol(id) ON DELETE SET NULL;
ALTER TABLE flujo_firma ADD COLUMN IF NOT EXISTS nivel_unidad_alternativo   VARCHAR(20);
ALTER TABLE flujo_firma ADD COLUMN IF NOT EXISTS alternativo_configurado_at TIMESTAMPTZ;
COMMENT ON COLUMN flujo_firma.rol_alternativo_id IS
  'Rol que también puede firmar este paso (además de rol_id), buscado en nivel_unidad_alternativo. NULL = sin alternativo.';
COMMENT ON COLUMN flujo_firma.alternativo_configurado_at IS
  'Cuándo se fijó o quitó el alternativo por primera vez (semilla o Administración): evita que reaplicar los SQL lo reponga.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_flujo_firma_nivel_alternativo') THEN
    ALTER TABLE flujo_firma ADD CONSTRAINT ck_flujo_firma_nivel_alternativo CHECK (
      nivel_unidad_alternativo IS NULL
      OR nivel_unidad_alternativo IN ('MISMA','SECCION','DEPARTAMENTO','DIRECCION','CALIDAD','COMERCIAL')
    );
  END IF;
END $$;

-- Certificado de Calibración (Sección Metrología): el paso de emisión del Jefe de
-- Departamento admite como alternativo al Metrólogo del mismo laboratorio (la API
-- exige además que esté habilitado para la magnitud en el registro de firmas).
-- Solo la primera vez: si el administrador lo quitó, alternativo_configurado_at
-- ya no es NULL y no se repone.
UPDATE flujo_firma f
   SET rol_alternativo_id         = m.id,
       nivel_unidad_alternativo   = 'MISMA',
       alternativo_configurado_at = now(),
       updated_at                 = now()
  FROM rol j, rol m
 WHERE f.tipo_documento = 'CERTIFICADO_CALIBRACION'
   AND f.accion = 'FIRMA'
   AND f.alternativo_configurado_at IS NULL
   AND j.id = f.rol_id AND COALESCE(j.alias_de, j.codigo) = 'JEFE_DEPTO'
   AND m.tenant_id = f.tenant_id AND m.codigo = 'METROLOGO';

-- Internación con una sola puerta: Cobranza seguía el cobro de la tasa en la
-- antigua «Comercial › Internaciones» (pedía cotizacion.ver u ot.ver). La pantalla
-- única pide bpch.internacion.ver: se le concede la consulta, como a Finanzas.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r JOIN permiso p ON p.codigo = 'bpch.internacion.ver'
 WHERE r.codigo = 'COBRANZA'
ON CONFLICT DO NOTHING;
