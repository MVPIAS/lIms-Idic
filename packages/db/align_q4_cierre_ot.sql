-- =============================================================================
-- align_q4_cierre_ot.sql · Lote 4 del quinto envío del IDIC (20–21-11-2026)
-- -----------------------------------------------------------------------------
-- Cierre de la OT (Analisis_envio_IDIC_2026-11-21.md §2 «BPCH: cierre por
-- resultado negativo», §3 COORD-02 y LQC, lote 4):
--
--  1 · «Cerrar por incumplimiento»: los ensayos pendientes de la OT pasan al
--      estado de resultado `no_ejecutado` con motivo, quién y cuándo (no se
--      borran). El resultado `no_ejecutado` no se captura, no se cobra y no
--      impide emitir ni cerrar. Columnas nuevas en `resultado` y en
--      `orden_trabajo` (quién lo decidió, cuándo y por qué). Permiso nuevo
--      `ot.cerrar_incumplimiento` → Jefe de Laboratorio (la cascada de
--      align_cierre_permisos.sql lo lleva a Jefe de Sección y de Departamento)
--      y SUPERADMIN.
--  2 · Cierre con planilla de costos cerrada: parámetro por laboratorio.
--  3 · Tres cierres con fecha real (COORD-02): analista, jefe de laboratorio y
--      jefe de departamento, cada uno con su usuario y fecha. `fecha_cierre`
--      sigue siendo el cierre final. Permisos `ot.cierre_analista`,
--      `ot.cierre_jefe_lab` y `ot.cierre_jefe_depto`.
--  4 · Aviso de OT terminada sin cerrar (IDIC-PG03: 10 días con la Hoja de
--      Costos Reales): parámetro con el número de días hábiles.
--
-- Valores PROVISIONALES (el IDIC aún no responde): todos se cambian en
-- Administración › Parámetros del sistema › «Cierre de la OT».
-- Las columnas nuevas no están en el modelo Prisma (se leen con SQL, como las
-- de align_firma_cierre.sql).
-- Idempotente. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
-- =============================================================================

BEGIN;

-- --- 1 · Ensayos «No ejecutado» ---------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS no_ejecutado_motivo TEXT;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS no_ejecutado_por    UUID;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS no_ejecutado_at     TIMESTAMPTZ;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS estado_previo_no_ejecutado VARCHAR(20);
COMMENT ON COLUMN resultado.no_ejecutado_motivo IS
  'Lote 4 (quinto envío): motivo con que el ensayo quedó «No ejecutado» al cerrar la OT por incumplimiento (BPCH). El ensayo no se borra.';
COMMENT ON COLUMN resultado.estado_previo_no_ejecutado IS
  'Estado del resultado antes de pasar a «No ejecutado» (pendiente, capturado, revisado_n1, devuelto o rechazado).';

ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS incumplimiento_cerrado_at     TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS incumplimiento_cerrado_por    UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS incumplimiento_cerrado_motivo TEXT;
COMMENT ON COLUMN orden_trabajo.incumplimiento_cerrado_at IS
  'Lote 4: «Cerrar por incumplimiento» (un ensayo dio negativo; los pendientes quedaron «No ejecutado»). Quién: incumplimiento_cerrado_por; por qué: incumplimiento_cerrado_motivo.';

-- --- 3 · Tres cierres con fecha real (COORD-02) ------------------------------
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cierre_analista_at    TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cierre_analista_por   UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cierre_jefe_lab_at    TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cierre_jefe_lab_por   UUID;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cierre_jefe_depto_at  TIMESTAMPTZ;
ALTER TABLE orden_trabajo ADD COLUMN IF NOT EXISTS cierre_jefe_depto_por UUID;
COMMENT ON COLUMN orden_trabajo.cierre_analista_at IS
  'COORD-02: cierre del analista (fecha real). Le siguen el del jefe de laboratorio y el del jefe de departamento; fecha_cierre es el cierre final de la OT.';

-- --- Permisos ---------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'ot.cerrar_incumplimiento', 'ot', 'cerrar_incumplimiento',
   'Cerrar la OT por incumplimiento: los ensayos pendientes quedan «No ejecutado» con motivo (Jefe de Laboratorio).'),
  (gen_random_uuid(), 'ot.cierre_analista',   'ot', 'cierre_analista',   'Registrar el cierre del analista de la OT (COORD-02).'),
  (gen_random_uuid(), 'ot.cierre_jefe_lab',   'ot', 'cierre_jefe_lab',   'Registrar el cierre del jefe de laboratorio de la OT (COORD-02).'),
  (gen_random_uuid(), 'ot.cierre_jefe_depto', 'ot', 'cierre_jefe_depto', 'Registrar el cierre del jefe de departamento de la OT (COORD-02).')
ON CONFLICT (codigo) DO NOTHING;

-- Jefe de Laboratorio (la cascada de align_cierre_permisos.sql: Jefe de Sección y de Departamento) y SUPERADMIN.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r JOIN permiso p ON p.codigo IN ('ot.cerrar_incumplimiento', 'ot.cierre_jefe_lab', 'ot.cierre_analista')
 WHERE COALESCE(r.alias_de, r.codigo) IN ('JEFE_LAB', 'SUPERADMIN')
ON CONFLICT DO NOTHING;

-- Cierre del analista: quien captura resultados (permiso resultado.crear).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, pn.id
  FROM rol_permiso rp
  JOIN permiso pc ON pc.id = rp.permiso_id AND pc.codigo = 'resultado.crear'
  JOIN permiso pn ON pn.codigo = 'ot.cierre_analista'
ON CONFLICT DO NOTHING;

-- Cierre del jefe de departamento: Jefe de Departamento, Dirección y SUPERADMIN (no el Jefe de Laboratorio).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r JOIN permiso p ON p.codigo = 'ot.cierre_jefe_depto'
 WHERE COALESCE(r.alias_de, r.codigo) IN ('JEFE_DEPTO', 'DIRECTOR', 'SUBDIRECTOR', 'SUPERADMIN')
ON CONFLICT DO NOTHING;

-- --- Parámetros (PROVISIONALES) --------------------------------------------
-- incumplimiento_labs: códigos de unidad separados por coma (TODOS = todos los
-- laboratorios). Por defecto el Banco de Pruebas, su sección de certificación y
-- sus sucursales (sin la Delegación Nº 11, que tiene su propio informe).
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, x.categoria, x.codigo, x.etiqueta, x.valor, x.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
   ('ot_cierre', 'incumplimiento_labs', 'Laboratorios con «Cerrar por incumplimiento»', 1, 'BPCH,SCC,SSTGO,SANTOF,SSEREN,SCALAM,SCOPIAP,SIQUIQU'),
   ('ot_cierre', 'planilla_costos_labs', 'Laboratorios cuyo cierre exige la planilla de costos cerrada', 2, 'LQC'),
   ('ot_cierre', 'exige_tres_cierres', 'El cierre final exige los tres cierres (analista, jefe de laboratorio y jefe de departamento)', 3, 'no'),
   ('ot_cierre', 'dias_cierre', 'Días hábiles para cerrar la OT terminada (IDIC-PG03)', 4, '10')
 ) AS x(categoria, codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

COMMIT;

-- Verificación:
-- SELECT codigo, valor FROM parametro_sistema WHERE categoria = 'ot_cierre' ORDER BY orden;
-- SELECT r.codigo, p.codigo FROM rol_permiso rp JOIN rol r ON r.id = rp.rol_id JOIN permiso p ON p.id = rp.permiso_id
--  WHERE p.codigo LIKE 'ot.cierre%' OR p.codigo = 'ot.cerrar_incumplimiento' ORDER BY 2, 1;
