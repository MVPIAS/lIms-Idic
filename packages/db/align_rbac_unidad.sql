-- ============================================================
-- ALIGN RBAC · UNIDAD · multi-unidad + 2º Jefe de Laboratorio · LIMS IDIC (Aiuken)
-- ------------------------------------------------------------
-- Objetivo: soportar "cada laboratorio = grupo con 2 Jefes de Laboratorio
-- (titular + subrogante) + N Técnicos", acotado por unidad.
--
-- Problema resuelto:
--   1) usuario_rol tenía PK (usuario_id, rol_id) -> un usuario NO podía tener el
--      MISMO rol en dos unidades (JEFE_LAB en la unidad A y en la B chocaba).
--   2) unidad.jefe_usuario_id es un único UUID -> solo un jefe titular; no había
--      forma de registrar el 2º jefe (subrogante) de forma explícita.
--
-- Solución (aditiva, NO destructiva de datos):
--   1) Se sustituye la PK compuesta por una PK sintética `id` (gen_random_uuid())
--      y se crea un ÍNDICE ÚNICO sobre (usuario_id, rol_id, COALESCE(unidad_id,
--      '000…')). unidad_id es NULLABLE y una PK no admite NULL; el COALESCE trata
--      "rol global" (unidad_id NULL) como un valor concreto para que la unicidad
--      funcione. Así un usuario puede ser JEFE_LAB en 2 unidades distintas sin
--      duplicar la MISMA asignación (usuario, rol, unidad).
--   2) Se crea la tabla unidad_jefe para registrar hasta 2 jefes por laboratorio
--      (titular | subrogante). unidad.jefe_usuario_id se mantiene por compat.
--
-- 100% idempotente: IF EXISTS / IF NOT EXISTS + bloques DO con guardas. Se puede
-- reaplicar sin error y sin efectos secundarios.
-- ============================================================

-- ------------------------------------------------------------
-- 1) usuario_rol: PK sintética `id` + índice único por (usuario, rol, unidad)
-- ------------------------------------------------------------

-- 1.a) Añade la columna `id` (si no existe). Al usar un DEFAULT volátil,
--      PostgreSQL rellena las filas existentes con UUIDs distintos.
ALTER TABLE usuario_rol
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- 1.b) Asegura que ninguna fila quede con id NULL y fija NOT NULL.
UPDATE usuario_rol SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE usuario_rol ALTER COLUMN id SET NOT NULL;
ALTER TABLE usuario_rol ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 1.c) Sustituye la PK actual (sea cual sea su nombre y columnas) por PK (id),
--      salvo que la PK ya sea exactamente (id) -> entonces no hace nada.
DO $$
DECLARE
  v_conname text;
  v_is_id_pk boolean;
  v_id_attnum smallint;
BEGIN
  SELECT attnum INTO v_id_attnum
    FROM pg_attribute
   WHERE attrelid = 'usuario_rol'::regclass AND attname = 'id' AND NOT attisdropped;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'usuario_rol'::regclass
       AND c.contype = 'p'
       AND c.conkey = ARRAY[v_id_attnum]
  ) INTO v_is_id_pk;

  IF NOT v_is_id_pk THEN
    SELECT conname INTO v_conname
      FROM pg_constraint
     WHERE conrelid = 'usuario_rol'::regclass AND contype = 'p';
    IF v_conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE usuario_rol DROP CONSTRAINT %I', v_conname);
    END IF;
    ALTER TABLE usuario_rol ADD CONSTRAINT usuario_rol_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- 1.d) Índice único que preserva "no duplicar la misma (usuario, rol, unidad)",
--      tratando unidad_id NULL (rol global) como un valor concreto.
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_rol_usuario_rol_unidad
  ON usuario_rol (
    usuario_id,
    rol_id,
    COALESCE(unidad_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ------------------------------------------------------------
-- 2) unidad_jefe: 2º jefe formalizado (titular | subrogante)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unidad_jefe (
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  unidad_id   UUID NOT NULL REFERENCES unidad(id)  ON DELETE CASCADE,
  usuario_id  UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  rol         VARCHAR(20) NOT NULL DEFAULT 'titular'
              CHECK (rol IN ('titular', 'subrogante')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (unidad_id, usuario_id)
);

-- A lo sumo un 'titular' por laboratorio (el 2º jefe entra como 'subrogante').
CREATE UNIQUE INDEX IF NOT EXISTS ux_unidad_jefe_titular
  ON unidad_jefe (unidad_id)
  WHERE rol = 'titular';

-- ============================================================
-- Verificación (tras aplicar):
--   -- La PK de usuario_rol debe ser (id):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid='usuario_rol'::regclass AND contype='p';
--   -- Debe existir el índice único de (usuario, rol, COALESCE(unidad,'000…')):
--   SELECT indexname FROM pg_indexes WHERE tablename='usuario_rol';
--   -- 2 jefes de un mismo laboratorio:
--   SELECT unidad_id, usuario_id, rol FROM unidad_jefe ORDER BY unidad_id, rol;
-- ============================================================
