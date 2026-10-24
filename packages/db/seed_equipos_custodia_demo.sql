-- =============================================================================
-- LIMS IDIC · Equipos y calibraciones de ejemplo · DATOS DE DEMOSTRACIÓN · Aiuken
-- =============================================================================
-- SOLO demo (ORDEN_SQL.txt: etiqueta «demo», justo después de equipos_custodia.sql): datos
-- INVENTADOS para la base de demostración y preproducción. Nunca en la base real
-- del IDIC: la instalación «sin-demo» deja la estructura sin estas filas.
-- 8 equipos (2 vencidos, 1 fuera de servicio, 1 en calibración) y 12 calibraciones de laboratorios ficticios.
-- Separado de equipos_custodia.sql el 24-10-2026 (arranque «sin-demo» limpio). Idempotente:
-- una pasada deja lo mismo que dos.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 5) SEED · 8 equipos del tenant IDIC
-- Fechas RELATIVAS a CURRENT_DATE para que la demo del bloqueo por calibración
-- vencida funcione siempre, se aplique el seed el día que se aplique:
--   · EQ-BAL-001 (LQC) y EQ-MUF-001 (LEM) => VENCIDOS (proxima_calibracion pasada)
--   · EQ-PHM-001                          => fuera_servicio (tampoco es apto)
--   · EQ-FTIR-001                         => en_calibracion (tampoco es apto)
--   · el resto                            => operativos y vigentes
-- =============================================================================
INSERT INTO equipo (
  tenant_id, codigo, nombre, descripcion, fabricante, modelo, serie,
  ubicacion, unidad_id, estado, fecha_ultima_calibracion, proxima_calibracion, responsable_id
)
SELECT
  t.id, v.codigo, v.nombre, v.descripcion, v.fabricante, v.modelo, v.serie,
  v.ubicacion,
  (SELECT u.id FROM unidad u WHERE u.tenant_id = t.id AND u.codigo = v.unidad_codigo LIMIT 1),
  v.estado,
  CURRENT_DATE + (v.ultima_offset || ' days')::interval,
  CURRENT_DATE + (v.proxima_offset || ' days')::interval,
  (SELECT us.id FROM usuario us WHERE us.tenant_id = t.id AND us.username = v.responsable LIMIT 1)
FROM tenant t
CROSS JOIN (VALUES
  ('EQ-HPLC-001','Cromatógrafo líquido HPLC','Cromatógrafo de líquidos de alta resolución con detector DAD','Agilent','1260 Infinity II','DEAAB12345','LQC · Sala instrumental','LQC','operativo',            -155, 210, 'm.gonzalez'),
  ('EQ-GCMS-001','Cromatógrafo de gases GC-MS','Cromatógrafo de gases acoplado a espectrómetro de masas','Shimadzu','GCMS-QP2020 NX','O2091500321','LQC · Sala instrumental','LQC','operativo',                 -95, 270, 'm.gonzalez'),
  ('EQ-BAL-001','Balanza analítica 0,1 mg','Balanza analítica de precisión, cámara de pesaje antiestática','Mettler Toledo','XPR205','B845102934','LQC · Sala de pesaje','LQC','operativo',                    -400, -35, 'm.gonzalez'),
  ('EQ-FTIR-001','Espectrofotómetro FTIR','Espectrofotómetro infrarrojo por transformada de Fourier con ATR','PerkinElmer','Spectrum Two','108772','LQA · Laboratorio químico','LQA','en_calibracion',          -180, 185, 'r.munoz'),
  ('EQ-MUF-001','Horno mufla 1200 °C','Horno mufla para calcinación y ensayos de cenizas','Nabertherm','LT 15/12','N221904471','LEM · Sala de hornos','LEM','operativo',                                       -430, -62, 'r.munoz'),
  ('EQ-EST-001','Estufa de secado 250 °C','Estufa de convección forzada para secado y desecación','Memmert','UF110','M2210447','LCC · Sala de acondicionamiento','LCC','operativo',                           -120, 245, 'j.soto'),
  ('EQ-PHM-001','pH-metro de sobremesa','pH-metro con electrodo combinado y compensación automática de T°','Hanna Instruments','HI5221','H51120087','LQA · Laboratorio químico','LQA','fuera_servicio',        -210, 155, 'r.munoz'),
  ('EQ-DUR-001','Durómetro Shore A/D','Durómetro digital para elastómeros y suelas','Instron','S1-Shore-A','IN774120','LCC · Sala de ensayos físicos','LCC','operativo',                                       -70, 295, 'j.soto')
) AS v(codigo, nombre, descripcion, fabricante, modelo, serie, ubicacion, unidad_codigo, estado, ultima_offset, proxima_offset, responsable)
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- =============================================================================
-- 6) SEED · calibraciones (historial coherente con el estado del equipo)
-- `proxima_fecha` de la ÚLTIMA calibración == `equipo.proxima_calibracion`.
-- =============================================================================
INSERT INTO calibracion (
  tenant_id, equipo_id, fecha, ejecutada_por, norma_calibracion,
  certificado_ref, resultado, proxima_fecha, observaciones, registrada_por
)
SELECT
  e.tenant_id, e.id,
  CURRENT_DATE + (v.fecha_offset || ' days')::interval,
  v.ejecutada_por, v.norma, v.certificado_ref, v.resultado,
  CURRENT_DATE + (v.proxima_offset || ' days')::interval,
  v.observaciones,
  (SELECT us.id FROM usuario us WHERE us.tenant_id = e.tenant_id AND us.username = 'm.gonzalez' LIMIT 1)
FROM equipo e
JOIN (VALUES
  -- Laboratorios de calibración FICTICIOS (D04-28; renombrado de las bases ya desplegadas en align_f4_correcciones.sql).
  -- equipo        fecha  proveedor                         norma                certificado         resultado            proxima  observaciones
  ('EQ-HPLC-001',  -520, 'Laboratorio de Calibración Prueba 1 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2024-HPLC-118', 'conforme',            -155, 'Verificación de caudal y linealidad del DAD dentro de tolerancia.'),
  ('EQ-HPLC-001',  -155, 'Laboratorio de Calibración Prueba 1 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2025-HPLC-402', 'conforme',             210, 'Calibración anual. Sin desviaciones.'),
  ('EQ-GCMS-001',  -460, 'Laboratorio de Calibración Prueba 2 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2024-GCMS-077', 'conforme_con_obs',     -95, 'Se recomienda reemplazo del septum en la próxima mantención.'),
  ('EQ-GCMS-001',   -95, 'Laboratorio de Calibración Prueba 2 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2025-GCMS-311', 'conforme',             270, 'Sintonía del cuadrupolo conforme. Sensibilidad OK.'),
  -- VENCIDO: última calibración conforme pero su vigencia expiró hace 35 días.
  ('EQ-BAL-001',   -765, 'Laboratorio de Calibración Prueba 1 Aiuken S.A.', 'OIML R76 / NCh2103','CAL-2023-BAL-021',  'conforme',            -400, 'Calibración con pesas patrón clase E2.'),
  ('EQ-BAL-001',   -400, 'Laboratorio de Calibración Prueba 1 Aiuken S.A.', 'OIML R76 / NCh2103','CAL-2024-BAL-233',  'conforme',             -35, 'VIGENCIA EXPIRADA: recalibración pendiente. Equipo NO apto para ensayo.'),
  ('EQ-FTIR-001',  -180, 'Laboratorio de Calibración Prueba 3 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2025-FTIR-014', 'conforme',             185, 'Verificación con patrón de poliestireno.'),
  -- VENCIDO: además la última calibración fue NO CONFORME.
  ('EQ-MUF-001',   -795, 'Laboratorio de Calibración Prueba 2 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2023-MUF-009',  'conforme',            -430, 'Mapeo térmico de cámara conforme.'),
  ('EQ-MUF-001',   -430, 'Laboratorio de Calibración Prueba 2 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2024-MUF-188',  'no_conforme',          -62, 'Desviación de +9 °C en el punto de 550 °C. Requiere ajuste del controlador PID.'),
  ('EQ-EST-001',   -120, 'Laboratorio de Calibración Prueba 1 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2025-EST-055',  'conforme',             245, 'Uniformidad térmica dentro de ±2 °C.'),
  ('EQ-PHM-001',   -210, 'Laboratorio de Calibración Prueba 4 Aiuken S.A.', 'NCh-ISO/IEC 17025', 'CAL-2025-PHM-091',  'conforme',             155, 'Calibración a 3 puntos (pH 4,01 / 7,00 / 10,01).'),
  ('EQ-DUR-001',    -70, 'Laboratorio de Calibración Prueba 5 Aiuken S.A.', 'ASTM D2240',        'CAL-2025-DUR-137',  'conforme',             295, 'Verificación con bloques patrón Shore A y D.')
) AS v(equipo_codigo, fecha_offset, ejecutada_por, norma, certificado_ref, resultado, proxima_offset, observaciones)
  ON v.equipo_codigo = e.codigo
JOIN tenant t ON t.id = e.tenant_id AND t.codigo = 'IDIC'
ON CONFLICT DO NOTHING;

COMMIT;
