-- ============================================================
-- Seed de datos DEMO para preproducción (sintéticos) · LIMS IDIC · Aiuken
-- Clientes, proveedores y listas de precio para poder testear el flujo.
-- Idempotente. tenant IDIC. NO usar en producción con datos reales.
-- ============================================================

-- Clientes demo
INSERT INTO cliente (tenant_id, rut, razon_social, tipo, ciudad, region, telefono, dias_credito)
SELECT t.id, v.rut, v.razon, v.tipo, 'Santiago', 'RM', v.tel, 30
FROM tenant t, (VALUES
  ('61.104.000-8','FAMAE · Fábricas y Maestranzas del Ejército','institucional','+56 2 2345 0000'),
  ('61.101.049-9','DGMN · Dir. Gral. Movilización Nacional','gubernamental','+56 2 2410 1000'),
  ('91.021.000-9','CAP Acero · Compañía Acero del Pacífico','externo','+56 41 240 0000'),
  ('96.529.310-8','Empresas Carozzi S.A.','externo','+56 2 2444 0000'),
  ('61.219.000-3','JUNAEB','gubernamental','+56 2 2595 0000'),
  ('61.307.000-5','SAG · Servicio Agrícola y Ganadero','gubernamental','+56 2 2345 1100'),
  ('61.001.000-1','DIVLOG · División Logística del Ejército','institucional','+56 2 2693 0000'),
  ('71.541.400-1','Carabineros de Chile · DEPTOL5','gubernamental','+56 2 2922 0000')
) AS v(rut, razon, tipo, tel)
WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, rut) DO NOTHING;

-- Proveedores demo
INSERT INTO proveedor (tenant_id, rut, razon_social, rubro, condicion_pago, estado)
SELECT t.id, v.rut, v.razon, v.rubro, '30 días', 'habilitado'
FROM tenant t, (VALUES
  ('96.800.570-7','Agilent Technologies Chile','Equipos / reactivos HPLC-AAS'),
  ('88.412.100-6','Merck S.A. Chile','Reactivos y estándares'),
  ('77.198.320-4','Calibraciones Metrológicas Ltda.','Servicio calibración patrones'),
  ('79.685.230-2','Instru-Lab Chile','Instrumentos de ensayo mecánico'),
  ('96.912.330-8','Gases y Equipos Indura','Gases de laboratorio')
) AS v(rut, razon, rubro)
WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, rut) DO NOTHING;

-- Listas de precio + ítems (servicios/HH/HM/viáticos)
INSERT INTO lista_precio (tenant_id, codigo, nombre, moneda)
SELECT t.id, 'PRECIOS-2026', 'Lista de precios 2026', 'CLP'
FROM tenant t WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, codigo) DO NOTHING;

INSERT INTO lista_precio_item (lista_precio_id, codigo, descripcion, cc, tipo, precio)
SELECT lp.id, v.codigo, v.descr, v.cc, v.tipo, v.precio
FROM lista_precio lp
JOIN tenant t ON t.id = lp.tenant_id AND t.codigo='IDIC' AND lp.codigo='PRECIOS-2026'
CROSS JOIN (VALUES
  ('SVC-QC-001','Metales por AAS (ASTM E350) · por analito','LQC','servicio',28000),
  ('SVC-QA-014','Índice de peróxidos en aceites','LQA','servicio',22000),
  ('SVC-LCC-006','Ensayo de tracción cuero (IUP 6)','LCC','servicio',35000),
  ('SVC-LEM-010','Ensayo de tracción / torque','LEM','servicio',48000),
  ('SVC-LMT-002','Calibración de balanza (OIML R76)','LMT','servicio',55000),
  ('HH-A','Hora hombre · Cat. A (Jefe técnico)','','HH',25000),
  ('HM-AAS','Hora máquina · Absorción atómica','LQC','HM',35000),
  ('VIA-B','Viático Tipo B · Regiones','','viatico',45000)
) AS v(codigo, descr, cc, tipo, precio)
ON CONFLICT DO NOTHING;

-- Centros de costo (laboratorios)
INSERT INTO centro_costo (tenant_id, codigo, nombre, laboratorio)
SELECT t.id, v.codigo, v.nombre, v.lab
FROM tenant t, (VALUES
  ('LQC-001','Lab. Químico Central','LQC'),('LQA-001','Lab. Química de Alimentos','LQA'),
  ('LCC-001','Lab. Cuero y Calzado','LCC'),('LTX-001','Lab. Textil','LTX'),
  ('LEM-001','Lab. Ensayos Mecánicos','LEM'),('LMT-001','Lab. Metrología','LMT')
) AS v(codigo, nombre, lab)
WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, codigo) DO NOTHING;
