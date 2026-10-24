-- =============================================================================
-- LIMS IDIC · Frente c3 · Datos de demostración para recorrer los manuales · Aiuken
-- =============================================================================
-- B-097 (MP-01 D01-19, MP-04 D04-07): la base de demostración no permitía
-- registrar el equipo de la captura (balanza del LQC vencida, LPN y LME sin
-- equipos) ni registrar una OT interlaboratorio (sin cliente de ese tipo).
--   1 · Equipos de demostración con calibración vigente por laboratorio.
--   2 · Cliente interno de tipo «Interlaboratorio» (ficticio).
-- SOLO demo (ORDEN_SQL.txt: etiqueta «demo»). Idempotente: una pasada = dos.
-- Los patrones de temperatura de Metrología son del frente c2 (B-028).
-- =============================================================================

-- 1 · Equipos vigentes (calibrados hace 30 días, vencen en 335) ----------------
INSERT INTO equipo (tenant_id, codigo, nombre, descripcion, fabricante, modelo, unidad_id, estado,
                    fecha_ultima_calibracion, proxima_calibracion, ubicacion)
SELECT u.tenant_id, v.codigo, v.nombre, v.nombre || ' (equipo de demostración)', 'Demostración', v.modelo, u.id, 'operativo',
       CURRENT_DATE - 30, CURRENT_DATE + 335, v.ubicacion
  FROM (VALUES
    ('LQC', 'DEMO-LQC-BAL-02', 'Balanza analítica 0,1 mg', 'BA-220', 'Sala de balanzas'),
    ('LPN', 'DEMO-LPN-VIS-01', 'Viscosímetro Stormer', 'KU-2', 'Sala de pinturas'),
    ('LPN', 'DEMO-LPN-ESP-01', 'Medidor de espesor de película', 'EP-1', 'Sala de pinturas'),
    ('LPN', 'DEMO-LPN-BAL-01', 'Balanza de precisión 0,01 g', 'BP-600', 'Sala de pinturas'),
    ('LME', 'DEMO-LME-BAL-01', 'Balanza analítica 0,001 g', 'BA-120', 'Sala de balanzas'),
    ('LME', 'DEMO-LME-HOR-01', 'Horno de secado', 'HS-60', 'Sala de explosivos'),
    ('LES', 'DEMO-LES-BAL-01', 'Balanza de precisión 0,01 g', 'BP-600', 'Sala sensorial'),
    ('LTX', 'DEMO-LTX-DIN-01', 'Dinamómetro', 'DT-5', 'Sala de textiles'),
    ('LEM', 'DEMO-LEM-DIN-01', 'Máquina universal de ensayos', 'MU-50', 'Sala de ensayos mecánicos'),
    ('LRB', 'DEMO-LRB-VEL-01', 'Cronógrafo balístico', 'CB-2', 'Túnel de tiro'),
    ('LAM', 'DEMO-LAM-BAL-01', 'Balanza de precisión 0,01 g', 'BP-600', 'Sala de armamento')
  ) AS v(lab, codigo, nombre, modelo, ubicacion)
  JOIN unidad u ON u.codigo = v.lab
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Su calibración en el historial del equipo (una por equipo).
INSERT INTO calibracion (tenant_id, equipo_id, fecha, ejecutada_por, resultado, proxima_fecha, certificado_ref, observaciones)
SELECT e.tenant_id, e.id, e.fecha_ultima_calibracion, 'Laboratorio de demostración', 'conforme', e.proxima_calibracion,
       'CERT-' || e.codigo, 'Calibración de demostración'
  FROM equipo e
 WHERE e.codigo LIKE 'DEMO-%'
   AND e.codigo IN ('DEMO-LQC-BAL-02', 'DEMO-LPN-VIS-01', 'DEMO-LPN-ESP-01', 'DEMO-LPN-BAL-01', 'DEMO-LME-BAL-01', 'DEMO-LME-HOR-01',
                    'DEMO-LES-BAL-01', 'DEMO-LTX-DIN-01', 'DEMO-LEM-DIN-01', 'DEMO-LRB-VEL-01', 'DEMO-LAM-BAL-01')
   AND NOT EXISTS (SELECT 1 FROM calibracion c WHERE c.equipo_id = e.id AND c.deleted_at IS NULL);

-- 2 · Cliente interno «Interlaboratorio» (ficticio) ----------------------------
INSERT INTO cliente (tenant_id, rut, razon_social, tipo, ciudad, region, dias_credito)
SELECT t.id, '77.777.777-7', 'IDIC · Interlaboratorio (cliente interno de demostración)', 'interlaboratorio', 'Santiago', 'RM', 0
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM cliente c WHERE c.tenant_id = t.id AND c.tipo = 'interlaboratorio' AND c.deleted_at IS NULL);
