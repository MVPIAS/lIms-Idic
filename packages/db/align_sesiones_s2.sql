-- =============================================================================
-- LIMS IDIC · Sesiones en preproducción (27-10 → 09-11-2026) · frente S2:
-- laboratorio, calidad, firmas y menú · Aiuken
--
--   1. Metrología: certificado MODIFICADO (mismo número con versión, OT abierta) o
--      de REEMPLAZO (número nuevo) y comentarios internos de la hoja de control (LNF, R9).
--   2. Catálogo › Métodos: decimales del resultado (redondeo, p. ej. brillo en
--      enteros; LPN, R7) y condiciones ambientales no aplican / opcionales /
--      obligatorias (LME, R8).
--   3. Programas de mantención auditables, con sus planes y lo ejecutado (Químico, R5).
--   4. Reemplazos temporales (R8): usuario_rol guarda a quién reemplaza y por qué.
--   5. Perfil activo de las personas con jefaturas duales (Comercial, R1).
--   6. Rol «Asesor Técnico» como firmante alternativo (subrogante) del Jefe de
--      Departamento en la matriz de firmas (LME, R8).
--   7. Parámetro «menu · ocultos» para sacar del menú módulos heredados (R1, R10).
--
-- Idempotente: se puede aplicar varias veces.
-- =============================================================================

-- --- 1. Metrología -------------------------------------------------------------
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS reemision_modalidad VARCHAR(12);
ALTER TABLE met_calibracion ADD COLUMN IF NOT EXISTS comentarios_hoja    TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_met_calibracion_reemision_modalidad') THEN
    ALTER TABLE met_calibracion ADD CONSTRAINT ck_met_calibracion_reemision_modalidad
      CHECK (reemision_modalidad IS NULL OR reemision_modalidad IN ('reemplazo', 'modificacion'));
  END IF;
END $$;
COMMENT ON COLUMN met_calibracion.reemision_modalidad IS
  'Reemisión: reemplazo (número nuevo, «reemplaza al N°») o modificacion (mismo número con -V2…, «certificado modificado»; solo con la OT abierta).';
COMMENT ON COLUMN met_calibracion.comentarios_hoja IS 'Comentarios internos de la hoja de control (no se imprimen en el certificado).';

-- --- 2. Reglas del resultado por método -----------------------------------------
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS decimales_resultado     SMALLINT;
ALTER TABLE cat_metodo ADD COLUMN IF NOT EXISTS condiciones_ambientales VARCHAR(12) NOT NULL DEFAULT 'opcional';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cat_metodo_decimales_resultado') THEN
    ALTER TABLE cat_metodo ADD CONSTRAINT ck_cat_metodo_decimales_resultado
      CHECK (decimales_resultado IS NULL OR decimales_resultado BETWEEN 0 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cat_metodo_condiciones_ambientales') THEN
    ALTER TABLE cat_metodo ADD CONSTRAINT ck_cat_metodo_condiciones_ambientales
      CHECK (condiciones_ambientales IN ('no_aplica', 'opcional', 'obligatoria'));
  END IF;
END $$;
COMMENT ON COLUMN cat_metodo.decimales_resultado IS 'Decimales del resultado final (0 = entero; redondeo al medio hacia afuera). NULL = sin redondeo.';
COMMENT ON COLUMN cat_metodo.condiciones_ambientales IS 'Temperatura y humedad del ensayo en la captura: no_aplica | opcional | obligatoria.';

-- --- 3. Programas de mantención -------------------------------------------------
CREATE TABLE IF NOT EXISTS programa_mantencion (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         NOT NULL REFERENCES tenant(id),
  codigo           VARCHAR(40)  NOT NULL,
  nombre           VARCHAR(200) NOT NULL,
  anio             INT          NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  unidad_id        UUID         REFERENCES unidad(id),
  -- Código del registro en el sistema de gestión de calidad (lo da el IDIC).
  documento_codigo VARCHAR(60),
  observaciones    TEXT,
  estado           VARCHAR(12)  NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'aprobado', 'cerrado')),
  creado_por       UUID         REFERENCES usuario(id),
  creado_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ,
  aprobado_por     UUID         REFERENCES usuario(id),
  aprobado_at      TIMESTAMPTZ,
  cerrado_por      UUID         REFERENCES usuario(id),
  cerrado_at       TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);
ALTER TABLE plan_mantencion ADD COLUMN IF NOT EXISTS programa_id UUID REFERENCES programa_mantencion(id);
ALTER TABLE mantencion      ADD COLUMN IF NOT EXISTS programa_id UUID REFERENCES programa_mantencion(id);
CREATE INDEX IF NOT EXISTS idx_plan_mantencion_programa ON plan_mantencion (programa_id) WHERE programa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mantencion_programa      ON mantencion (programa_id) WHERE programa_id IS NOT NULL;
COMMENT ON TABLE programa_mantencion IS 'Programa de mantención auditable (registro del SGC): agrupa planes de un laboratorio y año; aprobado no se modifica.';
COMMENT ON COLUMN mantencion.programa_id IS 'Programa con que se ejecutó la mantención (copia del plan al registrarla: queda como evidencia).';

-- --- 4. Reemplazos temporales -------------------------------------------------
ALTER TABLE usuario_rol ADD COLUMN IF NOT EXISTS reemplazo_de     UUID REFERENCES usuario(id);
ALTER TABLE usuario_rol ADD COLUMN IF NOT EXISTS motivo_reemplazo TEXT;
CREATE INDEX IF NOT EXISTS idx_usuario_rol_reemplazo ON usuario_rol (usuario_id, reemplazo_de) WHERE reemplazo_de IS NOT NULL;
COMMENT ON COLUMN usuario_rol.reemplazo_de IS 'Asignación temporal por reemplazo: persona a la que se reemplaza (la vigencia la acota).';

-- --- 5. Perfil activo -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_perfil_activo (
  usuario_id     UUID        PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  unidad_id      UUID        REFERENCES unidad(id) ON DELETE CASCADE,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE usuario_perfil_activo IS 'Perfil (unidad) con que trabaja una persona con jefaturas duales; sin fila = todas sus asignaciones.';

-- --- 6. Asesor Técnico: firmante alternativo del Jefe de Departamento -----------
INSERT INTO rol (tenant_id, codigo, nombre, descripcion, nivel, alcance, orden)
SELECT t.id, 'ASESOR_TECNICO', 'Asesor Técnico',
       'Firma en reemplazo del Jefe de Departamento (subrogante en la matriz de firmas). Se asigna en el departamento.',
       'OPERATIVO', 'DESCENDENCIA', 45
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM rol r WHERE r.tenant_id = t.id AND r.codigo = 'ASESOR_TECNICO');

-- Permisos: lo que el Jefe de Departamento puede VER y la bandeja de documentos por firmar.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT a.id, p.id
  FROM rol a
  JOIN rol j          ON j.tenant_id = a.tenant_id AND COALESCE(j.alias_de, j.codigo) = 'JEFE_DEPTO'
  JOIN rol_permiso jp ON jp.rol_id = j.id
  JOIN permiso p      ON p.id = jp.permiso_id
 WHERE a.codigo = 'ASESOR_TECNICO' AND (p.accion = 'ver' OR p.codigo IN ('documento.firmar', 'metrologia.ver'))
ON CONFLICT DO NOTHING;

-- Matriz de firmas: en cada paso del Jefe de Departamento sin responsable alternativo,
-- el Asesor Técnico del departamento firma cuando falta el jefe. Quitarlo en
-- Administración › Matriz de firmas lo desactiva sin tocar código.
UPDATE flujo_firma f
   SET rol_alternativo_id = a.id, nivel_unidad_alternativo = 'DEPARTAMENTO',
       alternativo_configurado_at = now(), updated_at = now()
  FROM rol r, rol a
 WHERE r.id = f.rol_id AND COALESCE(r.alias_de, r.codigo) = 'JEFE_DEPTO'
   AND a.tenant_id = f.tenant_id AND a.codigo = 'ASESOR_TECNICO'
   AND f.rol_alternativo_id IS NULL AND f.alternativo_configurado_at IS NULL;

-- --- 7. Menú: módulos heredados ocultos ---------------------------------------
-- Vacío por defecto: el IDIC indica qué módulos no usa (Parámetros del sistema).
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, 'menu', 'ocultos',
       'Rutas del menú que no se muestran (módulos heredados que el IDIC no usa), separadas por coma. Ej.: /crm, /encuestas',
       '', 1, TRUE
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM parametro_sistema p WHERE p.tenant_id = t.id AND p.categoria = 'menu' AND p.codigo = 'ocultos');
