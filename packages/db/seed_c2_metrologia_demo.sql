-- =============================================================================
-- LIMS IDIC · Frente c2 · B-028 · Patrones de temperatura de DEMOSTRACIÓN · Aiuken
-- =============================================================================
-- El maestro de demostración solo tenía un patrón de temperatura (TP-01, ya
-- vencido): el LMTE no podía elegir ninguno y la calibración se emitía sin
-- patrón. Desde B-028 el envío a firma exige al menos un patrón, así que la
-- base de demostración necesita patrones vigentes de temperatura.
--
-- Datos INVENTADOS, marcados «(prueba)»: solo para preproducción (etiqueta
-- «demo» en ORDEN_SQL.txt). En producción los carga el LMTE con sus
-- certificados reales (Metrología › Configuración › Patrones).
-- Idempotente: no duplica por código ni pisa correcciones ya cargadas.
-- =============================================================================

INSERT INTO met_patron (tenant_id, magnitud_id, codigo, nombre, marca, modelo, serie, clase, u_expandida, deriva,
                        n_certificado, vence, emisor, trazabilidad, activo, tipo, rango, laboratorio, fuente,
                        rango_min, rango_max, unidad_rango, ultima_calibracion, intervalo_meses, observacion)
SELECT t.id, m.id, v.codigo, v.nombre, v.marca, v.modelo, v.serie, v.clase, v.u, 0,
       v.cert, (now() AT TIME ZONE 'America/Santiago')::date + 365, 'Laboratorio de prueba', 'SIM/BIPM (prueba)', TRUE, 'patron',
       v.rango, 'LMTE', 'Datos de demostración (B-028)', v.rmin, v.rmax, '°C',
       (now() AT TIME ZONE 'America/Santiago')::date - 30, 12, 'Patrón ficticio para la base de demostración.'
  FROM tenant t
  JOIN met_magnitud m ON m.codigo = 'temperatura'
 CROSS JOIN (VALUES
   ('TP-02', 'Termómetro de referencia PT-100 (prueba)', 'Marca de prueba', 'TR-100', 'PRUEBA-0001', '—', 0.05, 'PRUEBA-TP-02', '(-20 a 150) °C', -20.0, 150.0),
   ('TP-03', 'Termopar tipo K de referencia (prueba)',    'Marca de prueba', 'TK-300', 'PRUEBA-0002', '—', 0.5,  'PRUEBA-TP-03', '(0 a 600) °C',    0.0,   600.0)
 ) AS v(codigo, nombre, marca, modelo, serie, clase, u, cert, rango, rmin, rmax)
 WHERE NOT EXISTS (SELECT 1 FROM met_patron p WHERE p.tenant_id = t.id AND p.codigo = v.codigo AND p.deleted_at IS NULL);

-- Termohigrómetro PL-22: error de su certificado para corregir las condiciones
-- ambientales (valores de demostración; solo si aún no tiene correcciones).
UPDATE met_patron
   SET correcciones = '{"temp": {"error": -0.2, "U": 0.6}, "hum": {"error": 1.5, "U": 2.5}}'::jsonb
 WHERE codigo = 'PL-22' AND correcciones IS NULL AND deleted_at IS NULL;
