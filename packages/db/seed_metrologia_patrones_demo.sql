-- =============================================================================
-- LIMS IDIC · Metrología · patrones de ejemplo · DATOS DE DEMOSTRACIÓN · Aiuken
-- =============================================================================
-- SOLO demo (ORDEN_SQL.txt: etiqueta «demo», justo después de align_metrologia.sql): datos
-- INVENTADOS para la base de demostración y preproducción. Nunca en la base real
-- del IDIC: la instalación «sin-demo» deja la estructura sin estas filas.
-- 4 patrones ficticios (inactivos desde align_metrologia_1510.sql). Los patrones
-- reales del IDIC (IDIC-PG11-Anexo02) no son de este fichero.
-- Separado de align_metrologia.sql el 24-10-2026 (arranque «sin-demo» limpio). Idempotente:
-- una pasada deja lo mismo que dos.
-- =============================================================================

-- Un par de patrones de ejemplo (no PII) para el tenant IDIC; emisor FICTICIO (D04-28)
INSERT INTO met_patron (tenant_id, magnitud_id, codigo, nombre, marca, modelo, serie, clase, u_expandida, deriva, n_certificado, vence, emisor, trazabilidad)
SELECT t.id, m.id, v.codigo, v.nombre, v.marca, v.modelo, v.serie, v.clase, v.u, v.der, v.cert, v.vence::date, v.emisor, v.tz
FROM (VALUES
 ('masa','MP-E2-01','Juego de masas patrón E2','Mettler Toledo','E2','MP-778','E2',0.00015,0.00005,'LC001-2025-114','2026-11-30','Laboratorio de Calibración Prueba 2 Aiuken S.A.','SIM/BIPM'),
 ('presion','PT-01','Manómetro digital patrón','Fluke','700G31','PT-9004','0,05 %',0.012,0.0,'LC001-2025-089','2026-09-15','Laboratorio de Calibración Prueba 2 Aiuken S.A.','SIM/BIPM'),
 ('fuerza','FT-01','Transductor de fuerza clase 00','HBM','C10','FT-450','00',0.09,0.0,'LC001-2025-071','2026-12-01','Laboratorio de Calibración Prueba 2 Aiuken S.A.','SIM/BIPM'),
 ('temperatura','TP-01','Termómetro patrón PT-100','Fluke','5615','TP-330','—',0.03,0.0,'LC001-2025-060','2026-10-20','Laboratorio de Calibración Prueba 2 Aiuken S.A.','SIM/BIPM')
) AS v(mag,codigo,nombre,marca,modelo,serie,clase,u,der,cert,vence,emisor,tz)
JOIN met_magnitud m ON m.codigo = v.mag
JOIN tenant t ON t.codigo = 'IDIC'
WHERE NOT EXISTS (SELECT 1 FROM met_patron p WHERE p.codigo = v.codigo);
