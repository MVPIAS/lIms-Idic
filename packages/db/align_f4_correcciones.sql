-- =============================================================================
-- LIMS IDIC · Frente f4 · Diferencias del recorrido de los manuales v2.1 (24-10)
-- y nombres ficticios en los datos de demostración · Aiuken
-- =============================================================================
-- Cada bloque lleva el ID de la diferencia (Diferencias_Recorrido_MP-*_Aiuken.xlsx).
-- Aditivo e idempotente: una pasada deja lo mismo que dos. No borra filas.
-- Va ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- D04-28 · Empresas reales en los datos de demostración → nombres ficticios.
--   Las semillas ya siembran los nombres ficticios; aquí se renombran las filas
--   que esas semillas crearon ANTES en las bases ya desplegadas. Coherencia con
--   la semilla (trampa del 24-10): cada fila se reconoce por su clave estable
--   (código del proveedor, Nº de certificado, código del patrón, serie del arma)
--   MÁS el nombre real exacto. Como la semilla usa esa misma clave con
--   ON CONFLICT / NOT EXISTS, reaplicarla antes o después de este bloque nunca
--   crea un duplicado ni deja el original sin renombrar. Un dato real del IDIC
--   (otro código, otro certificado) no coincide y no se toca.
-- -----------------------------------------------------------------------------

-- a) Proveedores de seed_preprod_demo.sql (PROV-001 … PROV-005).
UPDATE proveedor p
   SET razon_social = v.razon_nueva, rut = v.rut_nuevo, telefono = v.tel_nuevo
  FROM (VALUES
    ('PROV-001', 'Agilent Technologies Chile',       '96.800.570-3', 'Proveedor Prueba 1 Aiuken S.A.', '99.999.911-5', '+56 2 2000 0101'),
    ('PROV-002', 'Merck S.A. Chile',                 '88.412.100-6', 'Proveedor Prueba 2 Aiuken S.A.', '99.999.912-3', '+56 2 2000 0102'),
    ('PROV-003', 'Calibraciones Metrológicas Ltda.', '77.198.320-8', 'Proveedor Prueba 3 Aiuken S.A.', '99.999.913-1', '+56 2 2000 0103'),
    ('PROV-004', 'Instru-Lab Chile',                 '79.685.230-0', 'Proveedor Prueba 4 Aiuken S.A.', '99.999.914-K', '+56 2 2000 0104'),
    ('PROV-005', 'Gases y Equipos Indura',           '96.912.330-0', 'Proveedor Prueba 5 Aiuken S.A.', '99.999.915-8', '+56 2 2000 0105')
  ) AS v(codigo, razon_vieja, rut_viejo, razon_nueva, rut_nuevo, tel_nuevo)
 WHERE p.codigo = v.codigo AND p.razon_social = v.razon_vieja AND p.rut IS NOT DISTINCT FROM v.rut_viejo;

--    El nombre del proveedor copiado como texto en el muestreo o el encargo de
--    la OT, solo en las bases que tienen esos proveedores de demostración.
UPDATE ot_muestreo m
   SET proveedor = v.razon_nueva
  FROM (VALUES
    ('PROV-001', 'Agilent Technologies Chile',       'Proveedor Prueba 1 Aiuken S.A.'),
    ('PROV-002', 'Merck S.A. Chile',                 'Proveedor Prueba 2 Aiuken S.A.'),
    ('PROV-003', 'Calibraciones Metrológicas Ltda.', 'Proveedor Prueba 3 Aiuken S.A.'),
    ('PROV-004', 'Instru-Lab Chile',                 'Proveedor Prueba 4 Aiuken S.A.'),
    ('PROV-005', 'Gases y Equipos Indura',           'Proveedor Prueba 5 Aiuken S.A.')
  ) AS v(codigo, razon_vieja, razon_nueva)
 WHERE m.proveedor = v.razon_vieja
   AND EXISTS (SELECT 1 FROM proveedor p WHERE p.tenant_id = m.tenant_id AND p.codigo = v.codigo AND p.razon_social = v.razon_nueva);

UPDATE ot_encargo e
   SET proveedor = v.razon_nueva
  FROM (VALUES
    ('PROV-001', 'Agilent Technologies Chile',       'Proveedor Prueba 1 Aiuken S.A.'),
    ('PROV-002', 'Merck S.A. Chile',                 'Proveedor Prueba 2 Aiuken S.A.'),
    ('PROV-003', 'Calibraciones Metrológicas Ltda.', 'Proveedor Prueba 3 Aiuken S.A.'),
    ('PROV-004', 'Instru-Lab Chile',                 'Proveedor Prueba 4 Aiuken S.A.'),
    ('PROV-005', 'Gases y Equipos Indura',           'Proveedor Prueba 5 Aiuken S.A.')
  ) AS v(codigo, razon_vieja, razon_nueva)
 WHERE e.proveedor = v.razon_vieja
   AND EXISTS (SELECT 1 FROM proveedor p WHERE p.tenant_id = e.tenant_id AND p.codigo = v.codigo AND p.razon_social = v.razon_nueva);

-- b) Laboratorios externos de las calibraciones de ejemplo (equipos EQ-*-001):
--    se reconocen por su Nº de certificado de ejemplo y el nombre real exacto.
UPDATE calibracion c
   SET ejecutada_por = v.nuevo
  FROM (VALUES
    ('Lab. Metrología Aplicada Ltda.', 'Laboratorio de Calibración Prueba 1 Aiuken S.A.'),
    ('CESMEC S.A.',                    'Laboratorio de Calibración Prueba 2 Aiuken S.A.'),
    ('PerkinElmer Chile SpA',          'Laboratorio de Calibración Prueba 3 Aiuken S.A.'),
    ('Hanna Instruments Chile',        'Laboratorio de Calibración Prueba 4 Aiuken S.A.'),
    ('Instron Chile Ltda.',            'Laboratorio de Calibración Prueba 5 Aiuken S.A.')
  ) AS v(viejo, nuevo)
 WHERE c.ejecutada_por = v.viejo
   AND c.certificado_ref IN ('CAL-2024-HPLC-118', 'CAL-2025-HPLC-402', 'CAL-2024-GCMS-077', 'CAL-2025-GCMS-311',
                             'CAL-2023-BAL-021', 'CAL-2024-BAL-233', 'CAL-2025-FTIR-014', 'CAL-2023-MUF-009',
                             'CAL-2024-MUF-188', 'CAL-2025-EST-055', 'CAL-2025-PHM-091', 'CAL-2025-DUR-137');

-- c) Emisor de los 4 patrones de ejemplo de align_metrologia.sql (inactivos desde
--    align_metrologia_1510.sql). La trazabilidad REAL de los patrones del IDIC
--    (fuente IDIC-PG11-…) no se toca.
UPDATE met_patron
   SET emisor = 'Laboratorio de Calibración Prueba 2 Aiuken S.A.'
 WHERE emisor = 'CESMEC' AND fuente IS NULL
   AND (codigo, n_certificado) IN (('MP-E2-01', 'LC001-2025-114'), ('PT-01', 'LC001-2025-089'),
                                   ('FT-01', 'LC001-2025-071'), ('TP-01', 'LC001-2025-060'));

-- d) Propietario del arma inscrita de ejemplo del SAEC: persona y RUT ficticios.
UPDATE arma
   SET propietario_registrado = 'Propietario Prueba Aiuken', rut_propietario = '11.111.111-1'
 WHERE serie = 'FN-4471290' AND marca = 'FN Herstal'
   AND propietario_registrado = 'Juan Pérez Soto' AND rut_propietario = '13.884.221-5';

-- -----------------------------------------------------------------------------
-- D01-14 (resto de B-031) · Viscosidad Stormer en K.U.
--   c3 dejó la lectura y el analito en «K.U.», pero las especificaciones del
--   catálogo de esos métodos traían la unidad «grs», «ku», «k.u» o «K.U», y el
--   ensayo copia la unidad de su especificación: el resultado y el informe
--   seguían en «grs». Se normaliza a «K.U.» en el catálogo y en los ensayos aún
--   no aprobados (los aprobados conservan lo que se informó).
-- -----------------------------------------------------------------------------
UPDATE cat_especificacion e
   SET unidad = 'K.U.'
  FROM cat_analito a
  JOIN cat_metodo m ON m.id = a.metodo_id
 WHERE e.analito_id = a.id
   AND m.codigo IN ('659', '660', '661', '662', '663')
   AND e.unidad IS DISTINCT FROM 'K.U.';

UPDATE resultado r
   SET unidad = 'K.U.'
  FROM cat_metodo m
 WHERE r.cat_metodo_id = m.id
   AND m.codigo IN ('659', '660', '661', '662', '663')
   AND r.estado NOT IN ('aprobado', 'anulado')
   AND r.unidad IS DISTINCT FROM 'K.U.';

-- -----------------------------------------------------------------------------
-- D01-21 · Sólidos en peso, no volátiles y pigmento: tres lecturas, no seis.
--   La fórmula de esos métodos es ((C1 − C2) / C3) × 100 sobre los TRES primeros
--   campos (crisol o cápsula con el residuo, crisol o cápsula sola y masa de
--   muestra usada), pero el catálogo heredado traía además una segunda
--   plantilla de tres campos (crisol con no volátil, crisol con pintura, masa
--   de pintura usada). Mismo patrón que B-031 (align_c3_correcciones.sql): se
--   deja un juego único y ordenado de campos por método, con su unidad; los
--   demás quedan inactivos (no se borran). Solo los métodos cuyos analitos usan
--   TODOS esa fórmula y que tienen más de tres campos activos.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS f4_campos_metodo;
CREATE TEMP TABLE f4_campos_metodo (metodo_id uuid, tenant_id uuid, orden int, nombre text, unidad text);

INSERT INTO f4_campos_metodo
SELECT m.id, m.tenant_id, v.orden,
       CASE WHEN v.orden = 1 THEN 'Crisol o cápsula con ' || CASE WHEN lower(m.nombre) LIKE 'pigmento%' THEN 'pigmento' ELSE 'no volátil' END
            ELSE v.nombre END,
       'g'
  FROM cat_metodo m
 CROSS JOIN (VALUES (1, NULL), (2, 'Crisol o cápsula sola'), (3, 'Masa de muestra usada')) AS v(orden, nombre)
 WHERE EXISTS (SELECT 1 FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL)
   AND NOT EXISTS (
         SELECT 1 FROM cat_analito a
          WHERE a.metodo_id = m.id AND a.deleted_at IS NULL
            AND regexp_replace(lower(coalesce(a.formula, '')), '\s', '', 'g')
                NOT LIKE '%acum:=acum+((val(ssql[1,2])-val(ssql[2,2]))/val(ssql[3,2]))*100%')
   AND (SELECT count(*) FROM paso_metodo p WHERE p.cat_metodo_id = m.id AND p.activo AND p.deleted_at IS NULL) > 3;

-- En una segunda pasada ningún método tiene más de tres campos activos: no cambia nada.

UPDATE paso_metodo p
   SET activo = false
 WHERE p.activo
   AND p.cat_metodo_id IN (SELECT metodo_id FROM f4_campos_metodo)
   AND NOT EXISTS (SELECT 1 FROM f4_campos_metodo c
                    WHERE c.metodo_id = p.cat_metodo_id AND c.orden = p.orden AND c.nombre = p.nombre);

INSERT INTO paso_metodo (tenant_id, cat_metodo_id, orden, nombre, tipo_dato, unidad, obligatorio, activo)
SELECT c.tenant_id, c.metodo_id, c.orden, c.nombre, 'numero', c.unidad, true, true
  FROM f4_campos_metodo c
ON CONFLICT (tenant_id, cat_metodo_id, orden, nombre)
DO UPDATE SET activo = true, unidad = EXCLUDED.unidad, deleted_at = NULL;

DROP TABLE IF EXISTS f4_campos_metodo;
