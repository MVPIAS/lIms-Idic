-- ============================================================================
-- seed_maestros_idic.sql  ·  Aiuken · LIMS IDIC
-- ----------------------------------------------------------------------------
-- Semilla IDEMPOTENTE de MAESTROS / catálogos de referencia GENÉRICOS que el
-- modelo v2 necesita poblados desde el día 1 y que en preprod estaban VACÍOS.
--
-- Solo contiene catálogos genéricos y de conocimiento público (unidades de
-- medida, tipos de servicio/consumo, escalafón militar estándar del Ejército
-- de Chile). NO contiene PII real de clientes FFAA (RUT, contratos, precios
-- comerciales). Cumple §4.7.2 (datos reales solo on-premise).
--
-- Todas las sentencias usan ON CONFLICT DO NOTHING → re-ejecutable sin efecto.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) grado_militar  (global, UNIQUE(codigo)) — referenciado por usuario.grado_id
--    Escalafón estándar del Ejército de Chile + grados civiles genéricos.
--    jerarquia ascendente (menor = base, mayor = cúpula). Sin datos personales.
-- ----------------------------------------------------------------------------
INSERT INTO grado_militar (codigo, nombre, jerarquia, rama) VALUES
  ('TEC',    'Técnico',                       4,  'Civil'),
  ('CIVIL',  'Funcionario Civil',             5,  'Civil'),
  ('PROF',   'Profesional',                   6,  'Civil'),
  ('CABO2',  'Cabo 2°',                      20,  'Ejército'),
  ('CABO1',  'Cabo 1°',                      25,  'Ejército'),
  ('SGT2',   'Sargento 2°',                  30,  'Ejército'),
  ('SGT1',   'Sargento 1°',                  35,  'Ejército'),
  ('SOF',    'Suboficial',                   40,  'Ejército'),
  ('SOFM',   'Suboficial Mayor',             45,  'Ejército'),
  ('SUBTTE', 'Subteniente',                  50,  'Ejército'),
  ('TTE',    'Teniente',                     55,  'Ejército'),
  ('CAP',    'Capitán',                      60,  'Ejército'),
  ('MAY',    'Mayor',                        65,  'Ejército'),
  ('TCL',    'Teniente Coronel',             70,  'Ejército'),
  ('CRL',    'Coronel',                      75,  'Ejército'),
  ('GB',     'General de Brigada',           80,  'Ejército'),
  ('GD',     'General de División',          85,  'Ejército'),
  ('GE',     'General de Ejército',          90,  'Ejército')
ON CONFLICT (codigo) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2) unidad_medida  (global, PK=codigo) — referenciado por consumo_basico
--    Unidades SI + unidades de laboratorio de uso genérico.
-- ----------------------------------------------------------------------------
INSERT INTO unidad_medida (codigo, nombre, simbolo) VALUES
  ('UN',    'Unidad',                         'un'),
  ('PCT',   'Porcentaje',                     '%'),
  ('MG',    'Miligramo',                      'mg'),
  ('G',     'Gramo',                          'g'),
  ('KG',    'Kilogramo',                      'kg'),
  ('MG_KG', 'Miligramo por kilogramo',        'mg/kg'),
  ('ML',    'Mililitro',                      'mL'),
  ('L',     'Litro',                          'L'),
  ('MGL',   'Miligramo por litro',            'mg/L'),
  ('GL',    'Gramo por litro',                'g/L'),
  ('M',     'Metro',                          'm'),
  ('CM',    'Centímetro',                     'cm'),
  ('MM',    'Milímetro',                      'mm'),
  ('UM',    'Micrómetro',                     'µm'),
  ('PPM',   'Partes por millón',              'ppm'),
  ('PPB',   'Partes por billón',              'ppb'),
  ('C',     'Grado Celsius',                  '°C'),
  ('PH',    'Potencial de hidrógeno',         'pH'),
  ('N',     'Newton',                         'N'),
  ('KGF',   'Kilogramo fuerza',               'kgf'),
  ('MPA',   'Megapascal',                     'MPa'),
  ('HR',    'Hora',                           'h'),
  ('MIN',   'Minuto',                         'min'),
  ('SEG',   'Segundo',                        's'),
  ('UFC',   'Unidad formadora de colonias',   'UFC'),
  ('UFCG',  'UFC por gramo',                  'UFC/g'),
  ('MEQL',  'Miliequivalente por litro',      'meq/L')
ON CONFLICT (codigo) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3) servicio_tipo  (global, PK=codigo) — tipos de servicio del laboratorio
-- ----------------------------------------------------------------------------
INSERT INTO servicio_tipo (codigo, nombre, activo) VALUES
  ('ANALISIS',      'Análisis de laboratorio', TRUE),
  ('ENSAYO',        'Ensayo',                  TRUE),
  ('CALIBRACION',   'Calibración',             TRUE),
  ('MUESTREO',      'Muestreo en terreno',     TRUE),
  ('PERITAJE',      'Peritaje',                TRUE),
  ('CAPACITACION',  'Capacitación',            TRUE),
  ('ASESORIA',      'Asesoría técnica',        TRUE),
  ('CERTIFICACION', 'Certificación',           TRUE),
  ('INSPECCION',    'Inspección',              TRUE)
ON CONFLICT (codigo) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4) consumo_tipo  (global, PK=codigo) — tipos de consumo / insumo
-- ----------------------------------------------------------------------------
INSERT INTO consumo_tipo (codigo, nombre) VALUES
  ('REACTIVO',  'Reactivo químico'),
  ('MATERIAL',  'Material fungible'),
  ('PATRON',    'Patrón / estándar de referencia'),
  ('GAS',       'Gas'),
  ('VIDRIERIA', 'Vidriería'),
  ('EPP',       'Elemento de protección personal'),
  ('ENERGIA',   'Energía'),
  ('AGUA',      'Agua')
ON CONFLICT (codigo) DO NOTHING;

COMMIT;

-- Verificación rápida:
--   SELECT 'grado_militar' t, count(*) FROM grado_militar
--   UNION ALL SELECT 'unidad_medida', count(*) FROM unidad_medida
--   UNION ALL SELECT 'servicio_tipo', count(*) FROM servicio_tipo
--   UNION ALL SELECT 'consumo_tipo',  count(*) FROM consumo_tipo;
