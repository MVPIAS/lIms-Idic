-- =============================================================================
-- seed_r1g_demo.sql · Datos de DEMOSTRACIÓN del recorrido MP-02 (solo demo)
-- -----------------------------------------------------------------------------
-- Idempotente. No va a producción (etiqueta «demo» en ORDEN_SQL.txt).
-- D02-15: el LQA no tenía ningún equipo apto en la base de demostración, así que
-- la captura quedaba «Sin equipo». Se siembran una estufa, una balanza y un
-- digestor Kjeldahl del LQA, y una incubadora del LMB, operativos y con la
-- calibración vigente (un año desde la siembra). Códigos «DEMO-…» para que no
-- se confundan con equipos reales.
-- =============================================================================
INSERT INTO equipo (tenant_id, codigo, nombre, descripcion, fabricante, modelo, unidad_id, estado,
                    fecha_ultima_calibracion, proxima_calibracion, ubicacion)
SELECT u.tenant_id, v.codigo, v.nombre, v.nombre || ' (equipo de demostración)', 'Demostración', v.modelo, u.id, 'operativo',
       CURRENT_DATE - 30, CURRENT_DATE + 335, v.ubicacion
  FROM (VALUES
    ('LQA', 'DEMO-LQA-EST-01', 'Estufa de secado', 'ES-100', 'Sala de gravimetría'),
    ('LQA', 'DEMO-LQA-BAL-01', 'Balanza analítica 0,1 mg', 'BA-220', 'Sala de balanzas'),
    ('LQA', 'DEMO-LQA-KJE-01', 'Digestor y destilador Kjeldahl', 'KJ-6', 'Sala de volumetría'),
    ('LMB', 'DEMO-LMB-INC-01', 'Incubadora 35 °C', 'IN-35', 'Sala de incubación')
  ) AS v(lab, codigo, nombre, modelo, ubicacion)
  JOIN unidad u ON u.codigo = v.lab
ON CONFLICT (tenant_id, codigo) DO NOTHING;
