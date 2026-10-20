-- =============================================================================
-- align_admin_roles.sql · Administración de roles con alcance por laboratorio
-- LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- Qué hace (100 % ADITIVO e IDEMPOTENTE, se puede reaplicar sin efectos):
--   a) unidad: árbol organizacional (tipo, padre_id, sigla, icono, color,
--      codsucdel, centro_costo, orden). La columna de vigencia YA existe y se
--      llama `activa` (schema.sql); la API la expone como `activo`.
--   b) Siembra el organigrama IDIC (upsert por codigo). Las filas existentes
--      (LCC, LTX, LQA, ..., COM, DCO, SCC, BPCH) NO se duplican: solo se
--      completan los campos que estén vacíos (COALESCE). El nombre se ajusta
--      únicamente la primera vez (cuando la unidad aún no tenía `tipo`), para
--      no pisar renombres hechos después desde Administración.
--   c) rol: nivel, alcance, alias_de, orden + catálogo de roles + matriz por
--      defecto rol→permiso (solo INSERT ... ON CONFLICT DO NOTHING; no se
--      revoca nada). Alias: JEFELAB≈JEFE_LAB, JEFEDCO≈JEFE_DEPTO,
--      ANALISTA_SR≈REVISOR (las BD antiguas usan esos códigos).
--   d) flujo_firma: matriz de firmas por tipo de documento, con reglas por
--      defecto (unidad_id NULL) y overrides por laboratorio/sección/depto.
--   e) usuario_rol.unidad_id → FK a unidad (NOT VALID: no falla con huérfanos).
--
-- Compatible con:
--   · BD construida con schema.sql + align_*.sql (roles JEFE_LAB, ...).
--   · BD antigua creada con `prisma db push` (ids sin DEFAULT, roles JEFELAB...).
--     Por eso todos los INSERT pasan el id explícito con gen_random_uuid().
-- Requiere align_rbac_unidad.sql (usuario_rol.id + unidad_jefe) aplicado antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) unidad · columnas del árbol
-- -----------------------------------------------------------------------------
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS tipo          VARCHAR(20);
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS padre_id      UUID REFERENCES unidad(id);
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS sigla         VARCHAR(20);
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS icono         VARCHAR(8);
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS color         VARCHAR(20);
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS codsucdel     VARCHAR(40);
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS centro_costo  VARCHAR(40);
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS orden         INT DEFAULT 0;
-- `activa` ya existe en ambas variantes de BD; se asegura por si acaso.
ALTER TABLE unidad ADD COLUMN IF NOT EXISTS activa        BOOLEAN DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unidad_tipo_check') THEN
    ALTER TABLE unidad ADD CONSTRAINT unidad_tipo_check CHECK (
      tipo IS NULL OR tipo IN ('DIRECCION','DEPARTAMENTO','SECCION','LABORATORIO','SUCURSAL','DELEGACION','APOYO'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unidad_padre_no_self') THEN
    ALTER TABLE unidad ADD CONSTRAINT unidad_padre_no_self CHECK (padre_id IS NULL OR padre_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_unidad_padre ON unidad(padre_id);

-- -----------------------------------------------------------------------------
-- b) Organigrama IDIC (fuente: «Organigrama IDIC general y LIMS-VF» + CODSUCDEL
--    de StarLIMS). sede: código de sede preferente (si no existe → STGO → la 1ª).
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _org_idic (
  codigo VARCHAR(20), nombre VARCHAR(200), tipo VARCHAR(20), padre VARCHAR(20),
  sigla VARCHAR(20), icono VARCHAR(8), color VARCHAR(20), codsucdel VARCHAR(40),
  centro_costo VARCHAR(40), orden INT, sede VARCHAR(20)
);
TRUNCATE _org_idic;
INSERT INTO _org_idic VALUES
  -- Dirección
  ('DIR',    'Dirección IDIC',                               'DIRECCION',    NULL,  'DIR',  '★', '#6d28d9', NULL, NULL,   0, 'STGO'),
  -- Depto. Comercial
  ('DCO',    'Departamento Comercial',                       'DEPARTAMENTO', 'DIR', 'DCO',  '◱', '#0e7490', NULL, NULL,  10, 'STGO'),
  ('SVT',    'Sección Ventas',                               'SECCION',      'DCO', 'SVT',  '◱', '#0e7490', NULL, NULL,  11, 'STGO'),
  ('SPC',    'Sección Planificación y Control',              'SECCION',      'DCO', 'SPC',  '◱', '#0e7490', NULL, NULL,  12, 'STGO'),
  ('MUE',    'Sección Muestreo',                             'SECCION',      'DCO', 'MUE',  '◱', '#0e7490', '9999', '400495110', 13, 'STGO'),
  -- Depto. Químico
  ('DQO',    'Departamento Químico',                         'DEPARTAMENTO', 'DIR', 'DQO',  '⚗', '#15803d', NULL, NULL,  20, 'STGO'),
  ('SQU',    'Sección Química',                              'SECCION',      'DQO', 'SQU',  '⚗', '#15803d', NULL, NULL,  21, 'STGO'),
  ('LME',    'Laboratorio de Material Energético',           'LABORATORIO',  'SQU', 'LME',  '⚗', '#15803d', '7005', NULL, 22, 'STGO'),
  ('LQC',    'Laboratorio Químico Central',                  'LABORATORIO',  'SQU', 'LQC',  '⚗', '#15803d', '7003', NULL, 23, 'STGO'),
  ('LPN',    'Laboratorio de Pinturas',                      'LABORATORIO',  'SQU', 'LPN',  '⚗', '#15803d', '7004', NULL, 24, 'STGO'),
  ('SAL',    'Sección Alimentos',                            'SECCION',      'DQO', 'SAL',  '⚗', '#15803d', '7007', NULL, 25, 'STGO'),
  ('LQA',    'Laboratorio de Química de Alimentos',          'LABORATORIO',  'SAL', 'LQA',  '⚗', '#15803d', '7009', NULL, 26, 'STGO'),
  ('LMB',    'Laboratorio de Microbiología',                 'LABORATORIO',  'SAL', 'LMB',  '⚗', '#15803d', '7010', NULL, 27, 'STGO'),
  ('LES',    'Laboratorio de Evaluación Sensorial',          'LABORATORIO',  'SAL', 'LES',  '⚗', '#15803d', '7008', NULL, 28, 'STGO'),
  ('SVE',    'Sección Vestuario y Equipos',                  'SECCION',      'DQO', 'SVE',  '⚗', '#15803d', NULL, NULL,  29, 'STGO'),
  ('LCC',    'Laboratorio de Cuero y Calzado',               'LABORATORIO',  'SVE', 'LCC',  '⚗', '#15803d', '7006', NULL, 30, 'STGO'),
  ('LTX',    'Laboratorio Textil',                           'LABORATORIO',  'SVE', 'LTX',  '⚗', '#15803d', '7011', NULL, 31, 'STGO'),
  -- Depto. Armamento y Munición
  ('DSA',    'Departamento Armamento y Munición',            'DEPARTAMENTO', 'DIR', 'DSA',  '⌖', '#b45309', NULL, NULL,  40, 'STGO'),
  ('LRB',    'Laboratorio de Resistencia Balística',         'LABORATORIO',  'DSA', 'LRB',  '⌖', '#b45309', '4009', NULL, 41, 'STGO'),
  ('LAM',    'Laboratorio de Armamento y Municiones',        'LABORATORIO',  'DSA', 'LAM',  '⌖', '#b45309', '4008', NULL, 42, 'STGO'),
  ('SEO',    'Laboratorio de Electrónica y Optrónica',       'LABORATORIO',  'DSA', 'SEO',  '⌖', '#b45309', '400440110', NULL, 43, 'STGO'),
  ('SVM',    'Laboratorio de Vehículos Militares',           'LABORATORIO',  'DSA', 'SVM',  '⌖', '#b45309', '4007', NULL, 44, 'STGO'),
  ('SEM',    'Sección Ensayos Mecánicos',                    'SECCION',      'DSA', 'SEM',  '⌖', '#b45309', NULL, NULL,  45, 'STGO'),
  ('LEM',    'Laboratorio de Ensayos Mecánicos',             'LABORATORIO',  'SEM', 'LEM',  '⌖', '#b45309', '4006', NULL, 46, 'STGO'),
  ('SAM',    'Sección Metrología',                           'SECCION',      'DSA', 'SAM',  '⌖', '#b45309', NULL, NULL,  47, 'STGO'),
  ('LMT',    'Lab. Calibración Área Mecánica',               'LABORATORIO',  'SAM', 'LMT',  '⌖', '#b45309', '400450130', NULL, 48, 'STGO'),
  ('LMTE',   'Calibración Área Eléctrica',                   'LABORATORIO',  'SAM', 'LMTE', '⌖', '#b45309', '400450140', NULL, 49, 'STGO'),
  ('LNF',    'Laboratorio Nacional de Fuerza',               'LABORATORIO',  'SAM', 'LNF',  '⌖', '#b45309', '400450150', NULL, 50, 'STGO'),
  ('LCAD',   'Laboratorio LCAD (Metrología)',                'LABORATORIO',  'SAM', 'LCAD', '⌖', '#b45309', '400450120', NULL, 51, 'STGO'),
  -- Banco de Pruebas de Chile
  ('BPCH',   'Banco de Pruebas de Chile',                    'DEPARTAMENTO', 'DIR', 'BPCH', '✹', '#b91c1c', NULL, NULL,  60, 'BPCH-Q'),
  ('SCC',    'Sección Certificación de la Conformidad',      'SECCION',      'BPCH','SCC',  '✹', '#b91c1c', '3002', NULL, 61, 'BPCH-Q'),
  ('SSTGO',  'Sucursal Santiago',                            'SUCURSAL',     'BPCH','SSTGO','✹', '#b91c1c', '3000', NULL, 62, 'BPCH-Q'),
  ('SANTOF', 'Sucursal Antofagasta',                         'SUCURSAL',     'BPCH','SANTOF','✹','#b91c1c', '3001', NULL, 63, 'BPCH-Q'),
  ('SSEREN', 'Sucursal La Serena',                           'SUCURSAL',     'BPCH','SSEREN','✹','#b91c1c', '3005', NULL, 64, 'BPCH-Q'),
  ('SCALAM', 'Sucursal Calama',                              'SUCURSAL',     'BPCH','SCALAM','✹','#b91c1c', '3010', NULL, 65, 'BPCH-Q'),
  ('SCOPIAP','Sucursal Copiapó',                             'SUCURSAL',     'BPCH','SCOPIAP','✹','#b91c1c','3003', NULL, 66, 'BPCH-Q'),
  ('SIQUIQU','Sucursal Iquique',                             'SUCURSAL',     'BPCH','SIQUIQU','✹','#b91c1c','3004', NULL, 67, 'BPCH-Q'),
  ('D11',    'Delegación Nº 11',                             'DELEGACION',   'BPCH','D11',  '✹', '#b91c1c', '3009/3008', NULL, 68, 'BPCH-Q'),
  -- Unidades de apoyo
  ('DGC',    'Gestión de Calidad',                           'APOYO',        'DIR', 'DGC',  '✔', '#4338ca', NULL, NULL,  80, 'STGO'),
  ('DFZ',    'Finanzas',                                     'APOYO',        'DIR', 'DFZ',  '$', '#475569', NULL, NULL,  81, 'STGO'),
  ('SAB',    'Abastecimiento',                               'APOYO',        'DIR', 'SAB',  '▦', '#475569', NULL, NULL,  82, 'STGO');

INSERT INTO unidad (id, tenant_id, sede_id, codigo, nombre, tipo, sigla, icono, color, codsucdel, centro_costo, orden, activa, created_at)
SELECT gen_random_uuid(), t.id,
       COALESCE(
         (SELECT s.id FROM sede s WHERE s.tenant_id = t.id AND s.codigo = o.sede LIMIT 1),
         (SELECT s.id FROM sede s WHERE s.tenant_id = t.id AND s.codigo = 'STGO' LIMIT 1),
         (SELECT s.id FROM sede s WHERE s.tenant_id = t.id ORDER BY s.created_at LIMIT 1)),
       o.codigo, o.nombre, o.tipo, o.sigla, o.icono, o.color, o.codsucdel, o.centro_costo, o.orden, TRUE, now()
FROM _org_idic o
CROSS JOIN tenant t
WHERE t.codigo = 'IDIC'
  AND EXISTS (SELECT 1 FROM sede s WHERE s.tenant_id = t.id)
ON CONFLICT (tenant_id, codigo) DO UPDATE SET
  -- El nombre solo se corrige la 1ª vez (unidad aún sin tipo): respeta renombres posteriores.
  nombre       = CASE WHEN unidad.tipo IS NULL THEN EXCLUDED.nombre ELSE unidad.nombre END,
  tipo         = COALESCE(unidad.tipo, EXCLUDED.tipo),
  sigla        = COALESCE(unidad.sigla, EXCLUDED.sigla),
  icono        = COALESCE(unidad.icono, EXCLUDED.icono),
  color        = COALESCE(unidad.color, EXCLUDED.color),
  codsucdel    = COALESCE(unidad.codsucdel, EXCLUDED.codsucdel),
  centro_costo = COALESCE(unidad.centro_costo, EXCLUDED.centro_costo),
  orden        = CASE WHEN COALESCE(unidad.orden, 0) = 0 THEN EXCLUDED.orden ELSE unidad.orden END;

-- Padres (solo donde aún no hay padre: no deshace movimientos hechos en la UI).
UPDATE unidad u
   SET padre_id = p.id
  FROM _org_idic o
  JOIN tenant t ON t.codigo = 'IDIC'
  JOIN unidad p ON p.tenant_id = t.id AND p.codigo = o.padre
 WHERE u.tenant_id = t.id
   AND u.codigo = o.codigo
   AND u.padre_id IS NULL
   AND p.id <> u.id;

-- Legacy COM («Comercial», seed antiguo) → cuelga de DCO como sección. Se
-- conserva la fila (puede tener OT / asignaciones apuntándola).
UPDATE unidad u
   SET padre_id    = COALESCE(u.padre_id, d.id),
       tipo        = COALESCE(u.tipo, 'SECCION'),
       icono       = COALESCE(u.icono, '◱'),
       color       = COALESCE(u.color, '#0e7490'),
       orden       = CASE WHEN COALESCE(u.orden, 0) = 0 THEN 19 ELSE u.orden END,
       descripcion = COALESCE(u.descripcion, 'Unidad legacy «Comercial»: equivale al Departamento Comercial (DCO).')
  FROM unidad d
 WHERE u.codigo = 'COM' AND d.codigo = 'DCO' AND d.tenant_id = u.tenant_id AND d.id <> u.id;

-- Cualquier otra unidad preexistente sin tipo queda como LABORATORIO colgando de DIR
-- (visible en el árbol; el administrador la reubica).
UPDATE unidad u
   SET tipo = 'LABORATORIO',
       padre_id = COALESCE(u.padre_id, d.id)
  FROM unidad d
 WHERE u.tipo IS NULL AND d.codigo = 'DIR' AND d.tenant_id = u.tenant_id AND d.id <> u.id;

-- -----------------------------------------------------------------------------
-- e) usuario_rol.unidad_id → unidad(id). NOT VALID: no valida filas antiguas.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuario_rol_unidad_id_fkey') THEN
    ALTER TABLE usuario_rol
      ADD CONSTRAINT usuario_rol_unidad_id_fkey FOREIGN KEY (unidad_id)
      REFERENCES unidad(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_usuario_rol_unidad ON usuario_rol(unidad_id);

-- -----------------------------------------------------------------------------
-- c) rol · nivel / alcance / alias / orden + catálogo
-- -----------------------------------------------------------------------------
ALTER TABLE rol ADD COLUMN IF NOT EXISTS nivel       VARCHAR(20);
ALTER TABLE rol ADD COLUMN IF NOT EXISTS alcance     VARCHAR(20);
ALTER TABLE rol ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE rol ADD COLUMN IF NOT EXISTS orden       INT DEFAULT 0;
-- Alias: código canónico al que equivale un rol legado (JEFELAB → JEFE_LAB).
ALTER TABLE rol ADD COLUMN IF NOT EXISTS alias_de    VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rol_nivel_check') THEN
    ALTER TABLE rol ADD CONSTRAINT rol_nivel_check CHECK (
      nivel IS NULL OR nivel IN ('OPERATIVO','JEFATURA','DIRECCION','SOPORTE','SISTEMA'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rol_alcance_check') THEN
    ALTER TABLE rol ADD CONSTRAINT rol_alcance_check CHECK (
      alcance IS NULL OR alcance IN ('UNIDAD','DESCENDENCIA','GLOBAL'));
  END IF;
END $$;

CREATE TEMP TABLE IF NOT EXISTS _rol_idic (
  codigo VARCHAR(40), nombre VARCHAR(120), nivel VARCHAR(20), alcance VARCHAR(20),
  descripcion TEXT, orden INT
);
TRUNCATE _rol_idic;
INSERT INTO _rol_idic VALUES
  ('SUPERADMIN',    'Super Administrador',             'SISTEMA',   'GLOBAL',       'Acceso total. Solo TI Aiuken / IDIC.', 1),
  ('ADMIN',         'Administrador del sistema',       'SISTEMA',   'GLOBAL',       'Usuarios, roles, estructura, matriz de firmas y parámetros.', 2),
  ('DIRECTOR',      'Director',                        'DIRECCION', 'GLOBAL',       'Ve todo el instituto; firma oficios y da VB a disposiciones.', 10),
  ('SUBDIRECTOR',   'Subdirector',                     'DIRECCION', 'GLOBAL',       'Subroga al Director; mismo alcance.', 11),
  ('JEFE_DEPTO',    'Jefe de Departamento',            'JEFATURA',  'DESCENDENCIA','Oficializa y firma informes de todo su departamento.', 20),
  ('JEFE_SECCION',  'Jefe de Sección',                 'JEFATURA',  'DESCENDENCIA','Firma/oficializa en su sección y laboratorios dependientes.', 21),
  ('JEFE_LAB',      'Jefe de Laboratorio / Sucursal',  'JEFATURA',  'UNIDAD',       'Aprueba y firma resultados e informes de su laboratorio (titular o subrogante).', 22),
  ('REVISOR',       'Analista revisor',                'OPERATIVO', 'UNIDAD',       'Revisa (nivel 1) resultados del laboratorio.', 30),
  ('ANALISTA',      'Analista',                        'OPERATIVO', 'UNIDAD',       'Ejecuta ensayos y captura resultados.', 31),
  ('TECNICO',       'Técnico de laboratorio',          'OPERATIVO', 'UNIDAD',       'Preparación de muestras y captura de resultados.', 32),
  ('INSPECTOR',     'Inspector (LCA · BPCH)',          'OPERATIVO', 'UNIDAD',       'Inspecciones de lotes en sucursales y Santiago.', 33),
  ('METROLOGO',     'Metrólogo',                       'OPERATIVO', 'UNIDAD',       'Ejecuta calibraciones (motor GUM) y elabora certificados.', 34),
  ('RECEPCION',     'Recepción de muestras',           'OPERATIVO', 'GLOBAL',       'Recepción central, accessioning y cadena de custodia inicial.', 35),
  ('COMERCIAL',     'Ejecutivo de Ventas',             'OPERATIVO', 'GLOBAL',       'Clientes, cotizaciones, OT comerciales, listas de precio.', 40),
  ('PLANIFICACION', 'Planificación y Control',         'OPERATIVO', 'GLOBAL',       'Control de OT (SPC), costeo y reportes de gestión.', 41),
  ('MUESTREO',      'Muestreo',                        'OPERATIVO', 'GLOBAL',       'Toma de muestras en terreno (Sección Muestreo, unidad 9999).', 42),
  ('FINANZAS',      'Finanzas',                        'SOPORTE',   'GLOBAL',       'Facturas, pagos y notas de crédito.', 50),
  ('COBRANZA',      'Cobranza',                        'SOPORTE',   'GLOBAL',       'Cobranza y avisos de pago.', 51),
  ('ABASTECIMIENTO','Abastecimiento (SAB)',            'SOPORTE',   'GLOBAL',       'Órdenes de compra y solicitudes de adquisición.', 52),
  ('CALIDAD',       'Gestión de Calidad',              'SOPORTE',   'GLOBAL',       'QC, documentos, auditoría y no conformidades.', 53),
  ('LECTOR',        'Lector / Auditor',                'SOPORTE',   'GLOBAL',       'Solo lectura de todo el sistema.', 60),
  ('CLIENTE',       'Cliente externo',                 'SOPORTE',   'UNIDAD',       'Portal cliente (acotado; el filtro por cliente es aparte).', 70);

INSERT INTO rol (id, tenant_id, codigo, nombre, descripcion, es_sistema, nivel, alcance, orden, created_at)
SELECT gen_random_uuid(), t.id, r.codigo, r.nombre, r.descripcion, TRUE, r.nivel, r.alcance, r.orden, now()
FROM _rol_idic r CROSS JOIN tenant t
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO UPDATE SET
  nivel       = COALESCE(rol.nivel, EXCLUDED.nivel),
  alcance     = COALESCE(rol.alcance, EXCLUDED.alcance),
  descripcion = COALESCE(rol.descripcion, EXCLUDED.descripcion),
  orden       = CASE WHEN COALESCE(rol.orden, 0) = 0 THEN EXCLUDED.orden ELSE rol.orden END;

-- Alias de códigos legados (BD antiguas). Heredan nivel/alcance del canónico.
UPDATE rol SET alias_de = 'JEFE_LAB'   WHERE codigo = 'JEFELAB'     AND alias_de IS NULL;
UPDATE rol SET alias_de = 'JEFE_DEPTO' WHERE codigo = 'JEFEDCO'     AND alias_de IS NULL;
UPDATE rol SET alias_de = 'REVISOR'    WHERE codigo = 'ANALISTA_SR' AND alias_de IS NULL;
UPDATE rol a
   SET nivel   = COALESCE(a.nivel, c.nivel),
       alcance = COALESCE(a.alcance, c.alcance),
       orden   = CASE WHEN COALESCE(a.orden, 0) = 0 THEN c.orden ELSE a.orden END
  FROM rol c
 WHERE a.alias_de IS NOT NULL AND c.codigo = a.alias_de AND c.tenant_id = a.tenant_id;
-- Roles personalizados preexistentes sin clasificar → OPERATIVO / UNIDAD.
UPDATE rol SET nivel = 'OPERATIVO' WHERE nivel IS NULL;
UPDATE rol SET alcance = 'UNIDAD'  WHERE alcance IS NULL;

-- -----------------------------------------------------------------------------
-- c.2) Permisos nuevos de administración
-- -----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'admin.usuarios',   'admin', 'usuarios',   'Gestionar usuarios y sus asignaciones de rol'),
  (gen_random_uuid(), 'admin.estructura', 'admin', 'estructura', 'Gestionar la estructura organizacional (unidades y jefaturas)'),
  (gen_random_uuid(), 'admin.roles',      'admin', 'roles',      'Gestionar roles y la matriz rol→permiso'),
  (gen_random_uuid(), 'admin.firmas',     'admin', 'firmas',     'Gestionar la matriz de firmas por tipo de documento')
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- c.3) Matriz por defecto rol → permiso (aditiva). Se concede al rol canónico y
--      a sus alias (COALESCE(alias_de, codigo)). Permisos inexistentes en la BD
--      (p. ej. metrologia.* si align_metrologia.sql no se aplicó) se ignoran.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _rp_idic (rol VARCHAR(40), perm VARCHAR(80));
TRUNCATE _rp_idic;

-- Base de laboratorio (lectura + firma propia), común a todo el personal técnico.
INSERT INTO _rp_idic
SELECT r, p FROM unnest(ARRAY['ANALISTA','TECNICO','METROLOGO','INSPECTOR','REVISOR','JEFE_LAB','JEFE_SECCION','JEFE_DEPTO']) r
CROSS JOIN unnest(ARRAY['ot.ver','muestra.ver','resultado.ver','metodo.ver','equipo.ver','plantilla.ver','flujo.ver','firma.registrar','resultado.crear','muestra.crear']) p;

INSERT INTO _rp_idic VALUES
  -- Operativos
  ('TECNICO','muestra.transferir'),
  ('INSPECTOR','muestra.transferir'),
  ('METROLOGO','metrologia.ver'), ('METROLOGO','metrologia.crear'), ('METROLOGO','equipo.gestionar'),
  -- Revisor = analista + revisión nivel 1
  ('REVISOR','resultado.revisar'), ('REVISOR','muestra.transferir'),
  -- Jefe de laboratorio / sucursal: aprueba y firma en su lab, asigna analistas
  ('JEFE_LAB','resultado.revisar'), ('JEFE_LAB','resultado.aprobar'),
  ('JEFE_LAB','certificado.emitir'), ('JEFE_LAB','certificado.firmar'),
  ('JEFE_LAB','muestra.transferir'), ('JEFE_LAB','metodo.crear'), ('JEFE_LAB','metodo.aprobar'),
  ('JEFE_LAB','equipo.gestionar'), ('JEFE_LAB','nc.gestionar'), ('JEFE_LAB','audit.ver'),
  ('JEFE_LAB','catalogo.gestionar'), ('JEFE_LAB','cotizacion.ver'), ('JEFE_LAB','ot.cerrar'),
  ('JEFE_LAB','metrologia.ver'), ('JEFE_LAB','metrologia.crear'), ('JEFE_LAB','metrologia.emitir'),
  ('JEFE_LAB','evidencia.ver'), ('JEFE_LAB','ibis.ver'), ('JEFE_LAB','ibis.asignar'),
  -- Jefe de sección: todo lo del jefe de lab en su descendencia + oficializar
  ('JEFE_SECCION','resultado.revisar'), ('JEFE_SECCION','resultado.aprobar'),
  ('JEFE_SECCION','certificado.emitir'), ('JEFE_SECCION','certificado.firmar'),
  ('JEFE_SECCION','muestra.transferir'), ('JEFE_SECCION','metodo.crear'), ('JEFE_SECCION','metodo.aprobar'),
  ('JEFE_SECCION','equipo.gestionar'), ('JEFE_SECCION','nc.gestionar'), ('JEFE_SECCION','audit.ver'),
  ('JEFE_SECCION','catalogo.gestionar'), ('JEFE_SECCION','cotizacion.ver'), ('JEFE_SECCION','ot.cerrar'),
  ('JEFE_SECCION','cliente.ver'), ('JEFE_SECCION','metrologia.ver'), ('JEFE_SECCION','metrologia.emitir'),
  ('JEFE_SECCION','evidencia.ver'), ('JEFE_SECCION','saec.certificado.emitir'),
  -- Jefe de departamento: + aprobar cotizaciones de su ámbito, ver facturación
  ('JEFE_DEPTO','resultado.revisar'), ('JEFE_DEPTO','resultado.aprobar'),
  ('JEFE_DEPTO','certificado.emitir'), ('JEFE_DEPTO','certificado.firmar'),
  ('JEFE_DEPTO','metodo.aprobar'), ('JEFE_DEPTO','equipo.gestionar'), ('JEFE_DEPTO','nc.gestionar'),
  ('JEFE_DEPTO','audit.ver'), ('JEFE_DEPTO','catalogo.gestionar'), ('JEFE_DEPTO','ot.cerrar'),
  ('JEFE_DEPTO','cotizacion.ver'), ('JEFE_DEPTO','cotizacion.aprobar'), ('JEFE_DEPTO','cliente.ver'),
  ('JEFE_DEPTO','factura.ver'), ('JEFE_DEPTO','metrologia.ver'), ('JEFE_DEPTO','metrologia.emitir'),
  ('JEFE_DEPTO','evidencia.ver'), ('JEFE_DEPTO','saec.certificado.emitir'),
  -- Recepción
  ('RECEPCION','cliente.ver'), ('RECEPCION','muestra.ver'), ('RECEPCION','muestra.crear'),
  ('RECEPCION','muestra.transferir'), ('RECEPCION','ot.ver'),
  -- (sin SAEC: la recepción de evidencias es de la Delegación Nº 11 · align_alcance_fase0.sql)
  -- Comercial (Ejecutivo de Ventas)
  ('COMERCIAL','cliente.ver'), ('COMERCIAL','cliente.crear'), ('COMERCIAL','cliente.editar'),
  ('COMERCIAL','cotizacion.ver'), ('COMERCIAL','cotizacion.crear'), ('COMERCIAL','ot.ver'),
  ('COMERCIAL','ot.crear'), ('COMERCIAL','muestra.ver'), ('COMERCIAL','factura.ver'),
  ('COMERCIAL','plantilla.ver'), ('COMERCIAL','firma.registrar'),
  -- Planificación y Control (SPC): control de OT, costeo, reportes
  ('PLANIFICACION','ot.ver'), ('PLANIFICACION','ot.crear'), ('PLANIFICACION','cliente.ver'),
  ('PLANIFICACION','cotizacion.ver'), ('PLANIFICACION','cotizacion.crear'), ('PLANIFICACION','muestra.ver'),
  ('PLANIFICACION','resultado.ver'), ('PLANIFICACION','factura.ver'), ('PLANIFICACION','audit.ver'),
  ('PLANIFICACION','plantilla.ver'),
  -- Muestreo
  ('MUESTREO','ot.ver'), ('MUESTREO','muestra.ver'), ('MUESTREO','muestra.crear'),
  ('MUESTREO','muestra.transferir'), ('MUESTREO','cliente.ver'), ('MUESTREO','cotizacion.ver'),
  -- Finanzas / Cobranza: facturas, pagos, notas de crédito
  ('FINANZAS','factura.ver'), ('FINANZAS','factura.emitir'), ('FINANZAS','factura.cobrar'),
  ('FINANZAS','cliente.ver'), ('FINANZAS','cotizacion.ver'), ('FINANZAS','ot.ver'),
  ('COBRANZA','factura.ver'), ('COBRANZA','factura.emitir'), ('COBRANZA','factura.cobrar'),
  ('COBRANZA','cliente.ver'), ('COBRANZA','cotizacion.ver'), ('COBRANZA','ot.ver'),
  -- Abastecimiento: órdenes de compra (el módulo /adquisiciones lee con factura.ver
  -- y emite OC con factura.emitir; no hay permiso propio todavía)
  -- Sin ot.ver: Abastecimiento no ve OT ni informes (align_alcance_fase0.sql).
  ('ABASTECIMIENTO','factura.ver'), ('ABASTECIMIENTO','factura.emitir'), ('ABASTECIMIENTO','equipo.ver'),
  ('ABASTECIMIENTO','catalogo.gestionar'),
  -- Gestión de Calidad
  ('CALIDAD','audit.ver'), ('CALIDAD','nc.gestionar'), ('CALIDAD','metodo.ver'), ('CALIDAD','metodo.aprobar'),
  ('CALIDAD','plantilla.ver'), ('CALIDAD','plantilla.gestionar'), ('CALIDAD','catalogo.gestionar'),
  ('CALIDAD','resultado.ver'), ('CALIDAD','muestra.ver'), ('CALIDAD','ot.ver'), ('CALIDAD','equipo.ver'),
  ('CALIDAD','flujo.ver'), ('CALIDAD','certificado.firmar'), ('CALIDAD','firma.registrar'),
  ('CALIDAD','metrologia.ver'),
  -- Dirección: además de toda la lectura (abajo) firma, aprueba y da VB
  ('DIRECTOR','certificado.emitir'), ('DIRECTOR','certificado.firmar'), ('DIRECTOR','resultado.aprobar'),
  ('DIRECTOR','resultado.revisar'), ('DIRECTOR','cotizacion.aprobar'), ('DIRECTOR','metodo.aprobar'),
  ('DIRECTOR','nc.gestionar'), ('DIRECTOR','ot.cerrar'), ('DIRECTOR','firma.registrar'),
  ('DIRECTOR','metrologia.emitir'), ('DIRECTOR','saec.certificado.emitir'), ('DIRECTOR','evidencia.aprobar'),
  ('SUBDIRECTOR','certificado.emitir'), ('SUBDIRECTOR','certificado.firmar'), ('SUBDIRECTOR','resultado.aprobar'),
  ('SUBDIRECTOR','resultado.revisar'), ('SUBDIRECTOR','cotizacion.aprobar'), ('SUBDIRECTOR','metodo.aprobar'),
  ('SUBDIRECTOR','nc.gestionar'), ('SUBDIRECTOR','ot.cerrar'), ('SUBDIRECTOR','firma.registrar'),
  -- Administración del sistema
  ('ADMIN','admin.usuarios'), ('ADMIN','admin.estructura'), ('ADMIN','admin.roles'), ('ADMIN','admin.firmas'),
  ('ADMIN','audit.ver'), ('ADMIN','catalogo.gestionar'), ('ADMIN','plantilla.gestionar'),
  ('ADMIN','flujo.editar'), ('ADMIN','flujo.publicar'), ('ADMIN','metrologia.config'),
  -- Cliente externo (portal)
  ('CLIENTE','cotizacion.ver'), ('CLIENTE','ot.ver');

-- Jefaturas en cascada: el Jefe de Sección tiene todo lo del Jefe de Laboratorio
-- (lo sembrado aquí + lo que otros scripts ya le concedieron, p. ej. SAEC) y el
-- Jefe de Departamento todo lo del Jefe de Sección. Lo que cambia es el ALCANCE.
-- Excepción: la planilla de costos reales (costo_real.*) es solo del Jefe de
-- Laboratorio (align_quimicos_recepcion_calculo.sql: el Depto. Químico pidió sacar al
-- Jefe de Sección; el Jefe de Departamento solo la ve). Sin esta excepción, reaplicar
-- este fichero después de aquel copiaba la gestión de costos a las demás jefaturas.
INSERT INTO _rp_idic
SELECT 'JEFE_SECCION', perm FROM _rp_idic WHERE rol = 'JEFE_LAB' AND perm NOT LIKE 'costo\_real.%'
UNION
SELECT 'JEFE_SECCION', p.codigo
  FROM rol r JOIN rol_permiso rp ON rp.rol_id = r.id JOIN permiso p ON p.id = rp.permiso_id
 WHERE COALESCE(r.alias_de, r.codigo) = 'JEFE_LAB'
   AND p.codigo NOT LIKE 'costo\_real.%'
   AND r.tenant_id = (SELECT id FROM tenant WHERE codigo = 'IDIC');
INSERT INTO _rp_idic SELECT DISTINCT 'JEFE_DEPTO', perm FROM _rp_idic WHERE rol = 'JEFE_SECCION';

-- Lectura total (*.ver) para Dirección, Administración y Lector/Auditor.
-- Administración no consulta SAEC (evidencias, armas, casos, IBIS): es de la
-- Delegación Nº 11 (align_alcance_fase0.sql, frente L · fase 0).
INSERT INTO _rp_idic
SELECT r, p.codigo FROM unnest(ARRAY['DIRECTOR','SUBDIRECTOR','ADMIN','LECTOR']) r
CROSS JOIN permiso p WHERE p.accion = 'ver'
   AND NOT (r = 'ADMIN' AND p.codigo ~ '^(evidencia|arma|caso|ibis)\.');
-- SUPERADMIN: todos los permisos (el guard ya lo deja pasar; esto es para la matriz).
INSERT INTO _rp_idic SELECT 'SUPERADMIN', p.codigo FROM permiso p;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT r.id, p.id
FROM _rp_idic m
JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
              AND r.tenant_id = (SELECT id FROM tenant WHERE codigo = 'IDIC')
JOIN permiso p ON p.codigo = m.perm
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- d) flujo_firma · matriz de firmas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flujo_firma (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  tipo_documento    VARCHAR(40) NOT NULL CHECK (tipo_documento IN (
                      'INFORME_ENSAYO','IVC','INFORME_TECNICO','CERTIFICADO_CALIBRACION',
                      'INFORME_INSPECCION','CERTIFICADO_CONFORMIDAD','INFORME_INCUMPLIMIENTO',
                      'COTIZACION','OT_DISPOSICION','SOLICITUD_ADQUISICION','OFICIO')),
  -- NULL = regla por defecto; un lab / sección / depto puede sobrescribirla.
  unidad_id         UUID REFERENCES unidad(id) ON DELETE CASCADE,
  orden             INT NOT NULL DEFAULT 1,
  accion            VARCHAR(20) NOT NULL CHECK (accion IN ('ELABORA','REVISA','APRUEBA','FIRMA','OFICIALIZA','VB')),
  rol_id            UUID NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
  -- Dónde se busca al firmante, relativo a la unidad del documento.
  -- FIJA = la unidad indicada en unidad_destino_id (p. ej. SCC, SAB).
  nivel_unidad      VARCHAR(20) NOT NULL DEFAULT 'MISMA' CHECK (nivel_unidad IN (
                      'MISMA','SECCION','DEPARTAMENTO','DIRECCION','CALIDAD','COMERCIAL','FIJA')),
  unidad_destino_id UUID REFERENCES unidad(id) ON DELETE SET NULL,
  obligatorio       BOOLEAN NOT NULL DEFAULT TRUE,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  descripcion       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT flujo_firma_fija_destino CHECK (nivel_unidad <> 'FIJA' OR unidad_destino_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_flujo_firma_tipo ON flujo_firma(tenant_id, tipo_documento, unidad_id);

CREATE TEMP TABLE IF NOT EXISTS _ff_idic (
  tipo VARCHAR(40), unidad VARCHAR(20), orden INT, accion VARCHAR(20), rol VARCHAR(40),
  nivel VARCHAR(20), destino VARCHAR(20), obligatorio BOOLEAN, descripcion TEXT
);
TRUNCATE _ff_idic;
INSERT INTO _ff_idic VALUES
  -- Informe de ensayo (por defecto): revisor → jefe lab → jefe depto oficializa
  ('INFORME_ENSAYO', NULL, 1, 'REVISA',     'REVISOR',      'MISMA',        NULL, TRUE,  'Revisión técnica nivel 1'),
  ('INFORME_ENSAYO', NULL, 2, 'FIRMA',      'JEFE_LAB',     'MISMA',        NULL, TRUE,  'Aprueba y firma el informe'),
  ('INFORME_ENSAYO', NULL, 3, 'OFICIALIZA', 'JEFE_DEPTO',   'DEPARTAMENTO', NULL, TRUE,  'Oficializa la emisión'),
  -- LME (override): jefe lab → jefe depto → Gestión de Calidad firma
  ('INFORME_ENSAYO', 'LME', 1, 'FIRMA',      'JEFE_LAB',   'MISMA',        NULL, TRUE,  'Aprueba y firma'),
  ('INFORME_ENSAYO', 'LME', 2, 'OFICIALIZA', 'JEFE_DEPTO', 'DEPARTAMENTO', NULL, TRUE,  'Oficializa (Depto. Químico)'),
  ('INFORME_ENSAYO', 'LME', 3, 'FIRMA',      'CALIDAD',    'CALIDAD',      NULL, TRUE,  'Firma de Gestión de Calidad'),
  -- IVC: mismo circuito que el informe de ensayo
  ('IVC', NULL, 1, 'REVISA',     'REVISOR',    'MISMA',        NULL, TRUE, 'Revisión técnica nivel 1'),
  ('IVC', NULL, 2, 'FIRMA',      'JEFE_LAB',   'MISMA',        NULL, TRUE, 'Aprueba y firma'),
  ('IVC', NULL, 3, 'OFICIALIZA', 'JEFE_DEPTO', 'DEPARTAMENTO', NULL, TRUE, 'Oficializa la emisión'),
  -- Informe técnico
  ('INFORME_TECNICO', NULL, 1, 'FIRMA',      'JEFE_LAB',   'MISMA',        NULL, TRUE, 'Firma el informe técnico'),
  ('INFORME_TECNICO', NULL, 2, 'OFICIALIZA', 'JEFE_DEPTO', 'DEPARTAMENTO', NULL, TRUE, 'Oficializa'),
  -- Certificado de calibración (Sección Metrología: LMT, LMTE, LNF, LCAD)
  ('CERTIFICADO_CALIBRACION', 'SAM', 1, 'ELABORA', 'METROLOGO',  'MISMA',        NULL, TRUE, 'Calibrado por'),
  ('CERTIFICADO_CALIBRACION', 'SAM', 2, 'FIRMA',   'JEFE_LAB',   'MISMA',        NULL, TRUE, 'Revisa y firma (jefe del laboratorio)'),
  ('CERTIFICADO_CALIBRACION', 'SAM', 3, 'FIRMA',   'JEFE_DEPTO', 'DEPARTAMENTO', NULL, TRUE, 'Firma Jefe Depto. Armamento y Munición'),
  -- Informe de inspección (sucursales BPCH): firma el Jefe de Sucursal
  ('INFORME_INSPECCION', NULL, 1, 'FIRMA', 'JEFE_LAB', 'MISMA', NULL, TRUE, 'Firma el Jefe de Sucursal / Laboratorio'),
  -- Certificado de conformidad: Jefe de Sección SCC
  ('CERTIFICADO_CONFORMIDAD', NULL, 1, 'FIRMA', 'JEFE_SECCION', 'FIJA', 'SCC', TRUE, 'Firma el Jefe de la Sección Certificación de la Conformidad'),
  -- Informe de incumplimiento (→ DGMN): Jefe SCC firma, Director VB opcional
  ('INFORME_INCUMPLIMIENTO', NULL, 1, 'FIRMA', 'JEFE_SECCION', 'FIJA',      'SCC', TRUE,  'Firma el Jefe SCC'),
  ('INFORME_INCUMPLIMIENTO', NULL, 2, 'VB',    'DIRECTOR',     'DIRECCION', NULL,  FALSE, 'VB del Director (opcional)'),
  -- Cotización: comercial elabora → Jefe Depto. Comercial firma
  ('COTIZACION', NULL, 1, 'ELABORA', 'COMERCIAL',  'COMERCIAL', NULL, TRUE, 'Elabora el ejecutivo de ventas'),
  ('COTIZACION', NULL, 2, 'FIRMA',   'JEFE_DEPTO', 'COMERCIAL', NULL, TRUE, 'Firma el Jefe del Departamento Comercial'),
  -- Disposición de OT: VB del Jefe de Depto. o del Director (basta uno)
  ('OT_DISPOSICION', NULL, 1, 'VB', 'JEFE_DEPTO', 'DEPARTAMENTO', NULL, FALSE, 'VB alternativo: basta el del Jefe de Depto. o el del Director'),
  ('OT_DISPOSICION', NULL, 2, 'VB', 'DIRECTOR',   'DIRECCION',    NULL, FALSE, 'VB alternativo: basta el del Jefe de Depto. o el del Director'),
  -- Solicitud de adquisición: VB jefe lab → Abastecimiento
  ('SOLICITUD_ADQUISICION', NULL, 1, 'VB',      'JEFE_LAB',       'MISMA', NULL,  TRUE, 'VB del jefe del laboratorio solicitante'),
  ('SOLICITUD_ADQUISICION', NULL, 2, 'APRUEBA', 'ABASTECIMIENTO', 'FIJA',  'SAB', TRUE, 'Gestiona Abastecimiento (SAB)'),
  -- Oficio: Jefe de Depto. → Director firma
  ('OFICIO', NULL, 1, 'VB',    'JEFE_DEPTO', 'DEPARTAMENTO', NULL, TRUE, 'VB del Jefe de Departamento'),
  ('OFICIO', NULL, 2, 'FIRMA', 'DIRECTOR',   'DIRECCION',    NULL, TRUE, 'Firma el Director');

INSERT INTO flujo_firma (id, tenant_id, tipo_documento, unidad_id, orden, accion, rol_id,
                         nivel_unidad, unidad_destino_id, obligatorio, activo, descripcion)
SELECT gen_random_uuid(), t.id, f.tipo, u.id, f.orden, f.accion, r.id,
       f.nivel, d.id, f.obligatorio, TRUE, f.descripcion
FROM _ff_idic f
JOIN tenant t ON t.codigo = 'IDIC'
JOIN rol r    ON r.tenant_id = t.id AND r.codigo = f.rol
LEFT JOIN unidad u ON u.tenant_id = t.id AND u.codigo = f.unidad
LEFT JOIN unidad d ON d.tenant_id = t.id AND d.codigo = f.destino
WHERE (f.unidad IS NULL OR u.id IS NOT NULL)
  AND (f.destino IS NULL OR d.id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM flujo_firma x
     WHERE x.tenant_id = t.id AND x.tipo_documento = f.tipo AND x.orden = f.orden
       AND x.unidad_id IS NOT DISTINCT FROM u.id);

-- =============================================================================
-- Verificación:
--   SELECT u.codigo, u.tipo, p.codigo AS padre FROM unidad u LEFT JOIN unidad p ON p.id=u.padre_id ORDER BY u.orden;
--   SELECT codigo, nivel, alcance, alias_de FROM rol ORDER BY orden;
--   SELECT r.codigo, count(*) FROM rol r JOIN rol_permiso rp ON rp.rol_id=r.id GROUP BY 1 ORDER BY 1;
--   SELECT tipo_documento, orden, accion, nivel_unidad FROM flujo_firma ORDER BY 1, unidad_id NULLS FIRST, 2;
-- =============================================================================
