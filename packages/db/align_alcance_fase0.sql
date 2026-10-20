-- =============================================================================
-- align_alcance_fase0.sql · Alcance por laboratorio, fase 0 · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE (deja el mismo estado con una pasada que con dos). Va al
-- FINAL de ORDEN_SQL.txt. Acompaña al alcance POR ASIGNACIÓN de la API
-- (apps/api/src/rbac/alcance.ts, docs/ADMIN_ROLES.md › «Alcance por asignación»)
-- y cierra los hallazgos de permisos de la auditoría de roles:
--
--   A2 · SAEC (evidencias, armas, casos, IBIS) es de la Delegación Nº 11.
--        Administración, Recepción y Calidad pierden sus permisos SAEC. Quedan:
--        Superadministración, Dirección y Subdirección, Lector/Auditor (solo
--        consulta) y las jefaturas (el ámbito D11 las limita a quien tiene la
--        Delegación en su alcance). La API ya no deja pasar el ámbito D11 por
--        tener un rol global (rbac.constants.ts › AMBITOS).
--   A4 · Abastecimiento no ve OT ni informes: pierde ot.ver. Su proceso
--        (órdenes de compra, proveedores, consumibles, solicitudes de
--        adquisición) no lo necesita: lo comprueba correcciones-manuales.js.
--   A5 · Los roles operativos genéricos (ANALISTA, ANALISTA_SR, TECNICO,
--        INSPECTOR, REVISOR) pierden SAEC y Metrología, que solo frenaba el
--        ámbito. Los conservan, por roles complementarios de alcance UNIDAD:
--          · PERITO_SAEC          → el personal operativo de la Delegación Nº 11;
--          · OPERADOR_METROLOGIA  → el personal operativo de las unidades de la
--                                   Sección Metrología (SAM: LMT, LMTE, LNF, LCAD).
--        (El METROLOGO ya tenía Metrología por su rol.)
--
-- Las concesiones retiradas también se quitaron de su fichero de ORIGEN
-- (saec.sql, align_admin_roles.sql, align_metrologia.sql,
-- align_permisos_ambito.sql): reaplicar un SQL anterior no las devuelve. Los
-- DELETE de abajo limpian las BD que ya las tenían.
-- =============================================================================

BEGIN;

-- --- 1. Roles complementarios ----------------------------------------------------
INSERT INTO rol (id, tenant_id, codigo, nombre, descripcion, es_sistema, nivel, alcance, orden, created_at)
SELECT gen_random_uuid(), t.id, v.codigo, v.nombre, v.descripcion, TRUE, 'OPERATIVO', 'UNIDAD', v.orden, now()
  FROM tenant t
 CROSS JOIN (VALUES
   ('PERITO_SAEC', 'Perito SAEC (Delegación Nº 11)',
    'Consulta, custodia y peritaje de evidencias, armas e IBIS. Solo para el personal de la Delegación Nº 11.', 37),
   ('OPERADOR_METROLOGIA', 'Operador de Metrología',
    'Consulta y registro de calibraciones. Para el personal operativo de la Sección Metrología que no es metrólogo.', 38)
 ) AS v(codigo, nombre, descripcion, orden)
 WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('PERITO_SAEC', 'evidencia.ver'), ('PERITO_SAEC', 'evidencia.custodiar'), ('PERITO_SAEC', 'arma.ver'),
    ('PERITO_SAEC', 'caso.ver'), ('PERITO_SAEC', 'ibis.ver'), ('PERITO_SAEC', 'peritaje.registrar'),
    ('OPERADOR_METROLOGIA', 'metrologia.ver'), ('OPERADOR_METROLOGIA', 'metrologia.crear')
  ) AS m(rol, perm)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;

-- --- 2. Permisos retirados (DELETE explícitos) -----------------------------------
-- A2 · SAEC fuera de la Delegación Nº 11: Administración, Recepción y Calidad.
-- A5 · SAEC y Metrología fuera de los roles operativos genéricos.
DELETE FROM rol_permiso rp
 USING rol r, permiso p
 WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
   AND COALESCE(r.alias_de, r.codigo) IN ('ADMIN', 'RECEPCION', 'CALIDAD',
                                          'ANALISTA', 'ANALISTA_SR', 'TECNICO', 'INSPECTOR', 'REVISOR')
   AND r.codigo NOT IN ('PERITO_SAEC', 'OPERADOR_METROLOGIA')
   AND (p.codigo ~ '^(evidencia|arma|caso|ibis)\.'
        OR p.codigo IN ('peritaje.registrar', 'saec.certificado.emitir'));

DELETE FROM rol_permiso rp
 USING rol r, permiso p
 WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
   AND COALESCE(r.alias_de, r.codigo) IN ('ANALISTA', 'ANALISTA_SR', 'TECNICO', 'INSPECTOR', 'REVISOR')
   AND r.codigo NOT IN ('PERITO_SAEC', 'OPERADOR_METROLOGIA')
   AND p.codigo ~ '^metrologia\.';

-- A4 · Abastecimiento sin OT ni informes.
DELETE FROM rol_permiso rp
 USING rol r, permiso p
 WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
   AND COALESCE(r.alias_de, r.codigo) = 'ABASTECIMIENTO'
   AND p.codigo = 'ot.ver';

-- --- 3. Quien trabaja en la Delegación Nº 11 o en Metrología conserva lo suyo ----
-- Cada asignación de un rol operativo genérico en la Delegación Nº 11 (o lo que
-- cuelga de ella) recibe PERITO_SAEC en la misma unidad y con la misma vigencia;
-- en la Sección Metrología, OPERADOR_METROLOGIA. Solo añade lo que falta.
WITH RECURSIVE rama AS (
  SELECT u.id, u.tenant_id, CASE u.codigo WHEN 'D11' THEN 'PERITO_SAEC' ELSE 'OPERADOR_METROLOGIA' END AS complemento
    FROM unidad u WHERE u.codigo IN ('D11', 'SAM')
  UNION
  SELECT h.id, h.tenant_id, r.complemento FROM unidad h JOIN rama r ON h.padre_id = r.id
), origen AS (
  SELECT DISTINCT ur.usuario_id, ur.unidad_id, ur.vigente_desde, ur.vigente_hasta, ra.complemento, ra.tenant_id
    FROM usuario_rol ur
    JOIN rol r   ON r.id = ur.rol_id
    JOIN rama ra ON ra.id = ur.unidad_id
   WHERE COALESCE(r.alias_de, r.codigo) IN ('ANALISTA', 'ANALISTA_SR', 'TECNICO', 'INSPECTOR', 'REVISOR')
     AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta > now())
)
INSERT INTO usuario_rol (id, usuario_id, rol_id, unidad_id, vigente_desde, vigente_hasta)
SELECT gen_random_uuid(), o.usuario_id, c.id, o.unidad_id, COALESCE(o.vigente_desde, now()), o.vigente_hasta
  FROM origen o
  JOIN rol c ON c.codigo = o.complemento AND c.tenant_id = o.tenant_id
 WHERE NOT EXISTS (
   SELECT 1 FROM usuario_rol x
    WHERE x.usuario_id = o.usuario_id AND x.rol_id = c.id AND x.unidad_id = o.unidad_id);

COMMIT;
