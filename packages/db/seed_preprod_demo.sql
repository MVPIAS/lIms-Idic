-- ============================================================
-- Seed de datos DEMO para preproducción (sintéticos) · LIMS IDIC · Aiuken
-- Clientes, proveedores, listas de precio y centros de costo para testear el flujo.
-- Idempotente. tenant IDIC. NO usar en producción con datos reales.
-- Alineado al schema real (columnas y CHECK valida_rut). Los RUT llevan DV válido.
-- ============================================================

-- Clientes demo (RUT con dígito verificador válido)
INSERT INTO cliente (tenant_id, rut, razon_social, tipo, ciudad, region, telefono, dias_credito)
SELECT t.id, v.rut, v.razon, v.tipo, 'Santiago', 'RM', v.tel, 30
FROM tenant t, (VALUES
  ('61.104.000-8','FAMAE · Fábricas y Maestranzas del Ejército','institucional','+56 2 2345 0000'),
  ('61.101.049-4','DGMN · Dir. Gral. Movilización Nacional','gubernamental','+56 2 2410 1000'),
  ('91.021.000-9','CAP Acero · Compañía Acero del Pacífico','externo','+56 41 240 0000'),
  ('96.529.310-8','Empresas Carozzi S.A.','externo','+56 2 2444 0000'),
  ('61.219.000-3','JUNAEB','gubernamental','+56 2 2595 0000'),
  ('61.307.000-1','SAG · Servicio Agrícola y Ganadero','gubernamental','+56 2 2345 1100'),
  ('61.001.000-8','DIVLOG · División Logística del Ejército','institucional','+56 2 2693 0000'),
  ('71.541.400-7','Carabineros de Chile · DEPTOL5','gubernamental','+56 2 2922 0000')
) AS v(rut, razon, tipo, tel)
WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, rut) DO NOTHING;

-- Proveedores demo (codigo NOT NULL + UNIQUE(tenant_id, codigo))
INSERT INTO proveedor (tenant_id, codigo, razon_social, rut, telefono, activo)
SELECT t.id, v.codigo, v.razon, v.rut, v.tel, TRUE
FROM tenant t, (VALUES
  ('PROV-001','Agilent Technologies Chile','96.800.570-3','+56 2 2570 0000'),   -- Equipos/reactivos HPLC-AAS
  ('PROV-002','Merck S.A. Chile','88.412.100-6','+56 2 2830 0000'),             -- Reactivos y estándares
  ('PROV-003','Calibraciones Metrológicas Ltda.','77.198.320-8','+56 2 2711 0000'), -- Calibración de patrones
  ('PROV-004','Instru-Lab Chile','79.685.230-0','+56 2 2685 0000'),             -- Instrumentos de ensayo mecánico
  ('PROV-005','Gases y Equipos Indura','96.912.330-0','+56 2 2530 0000')        -- Gases de laboratorio
) AS v(codigo, razon, rut, tel)
WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Lista de precio 2026 (vigente_desde es NOT NULL)
INSERT INTO lista_precio (tenant_id, codigo, nombre, moneda, vigente_desde)
SELECT t.id, 'PRECIOS-2026', 'Lista de precios 2026', 'CLP', DATE '2026-01-01'
FROM tenant t WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Ítems de la lista: un precio por cada método del catálogo (FK a metodo).
-- Precio base representativo; suficiente para probar cotización/costeo del flujo.
INSERT INTO lista_precio_item (lista_id, metodo_id, precio)
SELECT lp.id, m.id, 28000
FROM lista_precio lp
JOIN tenant t ON t.id = lp.tenant_id AND t.codigo='IDIC' AND lp.codigo='PRECIOS-2026'
CROSS JOIN metodo m
ON CONFLICT DO NOTHING;

-- Centros de costo (laboratorios) · columnas: codigo, sigla, descripcion, tipo
INSERT INTO centro_costo (tenant_id, codigo, sigla, descripcion, tipo)
SELECT t.id, v.codigo, v.sigla, v.descr, 'laboratorio'
FROM tenant t, (VALUES
  ('LQC-001','LQC','Lab. Químico Central'),
  ('LQA-001','LQA','Lab. Química de Alimentos'),
  ('LCC-001','LCC','Lab. Cuero y Calzado'),
  ('LTX-001','LTX','Lab. Textil'),
  ('LEM-001','LEM','Lab. Ensayos Mecánicos'),
  ('LMT-001','LMT','Lab. Metrología')
) AS v(codigo, sigla, descr)
WHERE t.codigo='IDIC' ON CONFLICT (tenant_id, codigo) DO NOTHING;
