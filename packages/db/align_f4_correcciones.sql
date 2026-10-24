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
