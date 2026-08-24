-- =============================================================================
-- align_metrologia.sql · Módulo Metrología (LMT) · Aiuken · LIMS IDIC
-- -----------------------------------------------------------------------------
-- Los 12 procesos de calibración del Laboratorio de Metrología con su motor
-- GUM parametrizado (componentes de incertidumbre por magnitud, divisores por
-- distribución, tolerancias OIML) + calibraciones y sus resultados. El cálculo
-- (uᵢ=|v|/divisor, uc=√Σuᵢ², U=k·uc, En) lo hace el backend (metrologia.calc.ts)
-- y se persiste aquí. Idempotente.
-- =============================================================================

-- Magnitudes ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS met_magnitud (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     VARCHAR(20) UNIQUE NOT NULL,     -- masa, presion, fuerza, volumen, temperatura
  nombre     VARCHAR(80) NOT NULL,
  unidad     VARCHAR(10) NOT NULL,
  decimales  INT NOT NULL DEFAULT 3
);

-- Distribuciones de probabilidad → divisor (tabla editable) -------------------
CREATE TABLE IF NOT EXISTS met_distribucion (
  codigo   VARCHAR(30) PRIMARY KEY,           -- "normal k=2", "rectangular ½", ...
  divisor  DOUBLE PRECISION NOT NULL,
  uso      VARCHAR(120)
);

-- Componentes de incertidumbre por magnitud (config del balance GUM) ----------
CREATE TABLE IF NOT EXISTS met_componente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  magnitud_id   UUID NOT NULL REFERENCES met_magnitud(id) ON DELETE CASCADE,
  simbolo       VARCHAR(20) NOT NULL,
  nombre        VARCHAR(120) NOT NULL,
  distribucion  VARCHAR(30) NOT NULL REFERENCES met_distribucion(codigo),
  fuente        VARCHAR(20) NOT NULL,          -- uPatron|rep|deriva|hist|<campo global>
  orden         INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_met_comp_mag ON met_componente(magnitud_id, orden);

-- Los 12 procesos ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS met_proceso (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       VARCHAR(20) UNIQUE NOT NULL,    -- ITM01, ITM02, ...
  magnitud_id  UUID NOT NULL REFERENCES met_magnitud(id),
  nombre       VARCHAR(160) NOT NULL,
  metodo       VARCHAR(200),
  norma        VARCHAR(120),
  activo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Patrones de referencia (trazabilidad + deriva + vencimiento) ---------------
CREATE TABLE IF NOT EXISTS met_patron (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  magnitud_id   UUID REFERENCES met_magnitud(id),
  codigo        VARCHAR(40),
  nombre        VARCHAR(160) NOT NULL,
  marca         VARCHAR(80),
  modelo        VARCHAR(80),
  serie         VARCHAR(80),
  clase         VARCHAR(40),
  u_expandida   DOUBLE PRECISION,              -- U del patrón (del certificado)
  deriva        DOUBLE PRECISION,
  n_certificado VARCHAR(60),
  vence         DATE,
  emisor        VARCHAR(120),
  trazabilidad  VARCHAR(120),
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_met_patron_tenant ON met_patron(tenant_id) WHERE deleted_at IS NULL;

-- Tolerancias OIML R 111 (mg) ------------------------------------------------
CREATE TABLE IF NOT EXISTS met_tolerancia_oiml (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nominal  VARCHAR(20) NOT NULL,
  clase    VARCHAR(10) NOT NULL,
  mpe_mg   DOUBLE PRECISION NOT NULL,
  UNIQUE (nominal, clase)
);

-- Calibraciones + puntos ------------------------------------------------------
CREATE TABLE IF NOT EXISTS met_calibracion (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  codigo       VARCHAR(30) NOT NULL,           -- CAL-2026-0001
  proceso_id   UUID NOT NULL REFERENCES met_proceso(id),
  ot_id        UUID REFERENCES orden_trabajo(id),
  patron_id    UUID REFERENCES met_patron(id),
  instrumento  JSONB DEFAULT '{}',             -- descripción, marca, serie, cap, res, rango, cliente
  patron_snap  JSONB DEFAULT '{}',             -- copia del patrón usado (para el certificado)
  ambiente     JSONB DEFAULT '{}',             -- temp, tempU, hum, humU
  cond         JSONB DEFAULT '{}',             -- resolución, mpe y contribuciones por magnitud
  u_max        DOUBLE PRECISION,               -- mayor U(k=2) encontrada
  conforme     BOOLEAN,                        -- todos los puntos dentro de MPE
  intervalo_meses INT DEFAULT 12,
  estado       VARCHAR(20) NOT NULL DEFAULT 'borrador', -- borrador, calculada, emitida
  certificado_hash VARCHAR(64),
  emitido_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  created_by   UUID REFERENCES usuario(id),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_met_cal_tenant ON met_calibracion(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS met_calibracion_punto (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calibracion_id UUID NOT NULL REFERENCES met_calibracion(id) ON DELETE CASCADE,
  orden          INT NOT NULL DEFAULT 0,
  nominal        DOUBLE PRECISION,
  correccion     DOUBLE PRECISION,
  u_patron       DOUBLE PRECISION,
  deriva         DOUBLE PRECISION,
  lecturas       JSONB DEFAULT '[]',
  media          DOUBLE PRECISION,
  repetibilidad  DOUBLE PRECISION,
  referencia     DOUBLE PRECISION,
  error          DOUBLE PRECISION,
  uc             DOUBLE PRECISION,
  u_exp          DOUBLE PRECISION,
  en_norm        DOUBLE PRECISION,
  dentro         BOOLEAN,
  componentes    JSONB DEFAULT '[]'            -- balance de incertidumbre del punto
);
CREATE INDEX IF NOT EXISTS idx_met_punto_cal ON met_calibracion_punto(calibracion_id, orden);

-- ============================ SEED ==========================================
INSERT INTO met_magnitud (codigo, nombre, unidad, decimales) VALUES
 ('masa','Masa','g',5),('presion','Presión','bar',3),('fuerza','Fuerza','kN',3),
 ('volumen','Volumen','mL',4),('temperatura','Temperatura','°C',3)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO met_distribucion (codigo, divisor, uso) VALUES
 ('normal k=2', 2, 'Certificado de patrón (U con k=2)'),
 ('normal (tipo A)', 1, 'Repetibilidad (desviación estándar)'),
 ('rectangular ½', 3.4641016151377544, 'Resolución, cero, histéresis (semi-intervalo)'),
 ('rectangular', 1.7320508075688772, 'Deriva, reversibilidad'),
 ('triangular', 2.449489742783178, 'Valor central más probable')
ON CONFLICT (codigo) DO NOTHING;

-- Componentes por magnitud
INSERT INTO met_componente (magnitud_id, simbolo, nombre, distribucion, fuente, orden)
SELECT m.id, c.simbolo, c.nombre, c.dist, c.fuente, c.orden FROM (VALUES
 ('masa','uC','Incertidumbre de las masas patrón','normal k=2','uPatron',1),
 ('masa','uS','Repetibilidad del instrumento','normal (tipo A)','rep',2),
 ('masa','ud','Resolución del instrumento','rectangular ½','resolucion',3),
 ('masa','uecc','Error de excentricidad','rectangular ½','excentricidad',4),
 ('masa','urest','Restitución de cero','rectangular ½','cero',5),
 ('masa','uDer','Deriva del patrón','rectangular','deriva',6),
 ('presion','uP','Incertidumbre del patrón','normal k=2','uPatron',1),
 ('presion','ub','Repetibilidad de la lectura','normal (tipo A)','rep',2),
 ('presion','ur','Resolución del manómetro','rectangular ½','resolucion',3),
 ('presion','uh','Histéresis (subida−bajada)','rectangular ½','hist',4),
 ('presion','ufo','Error de cero','rectangular ½','cero',5),
 ('presion','uDh','Diferencia de altura','rectangular ½','altura',6),
 ('presion','uder','Deriva del patrón','rectangular','deriva',7),
 ('fuerza','uP','Incertidumbre del patrón','normal k=2','uPatron',1),
 ('fuerza','ub','Repetibilidad','normal (tipo A)','rep',2),
 ('fuerza','ur','Resolución','rectangular','resolucion',3),
 ('fuerza','uv','Reversibilidad','rectangular','reversibilidad',4),
 ('fuerza','uf0','Error del cero','rectangular','cero',5),
 ('fuerza','uder','Deriva del patrón','rectangular','deriva',6),
 ('volumen','uP','Incertidumbre de la balanza/patrón','normal k=2','uPatron',1),
 ('volumen','ub','Repetibilidad','normal (tipo A)','rep',2),
 ('volumen','ur','Resolución / lectura del menisco','rectangular ½','resolucion',3),
 ('volumen','uT','Temperatura y dilatación','rectangular ½','tempc',4),
 ('volumen','uder','Deriva del patrón','rectangular','deriva',5),
 ('temperatura','uP','Incertidumbre de calibración del patrón','normal k=2','uPatron',1),
 ('temperatura','uTind','Repetibilidad del isotermo','normal (tipo A)','rep',2),
 ('temperatura','udTres','Resolución del isotermo','rectangular ½','resolucion',3),
 ('temperatura','udTgrad','Gradiente de temperatura','rectangular ½','gradiente',4),
 ('temperatura','udTv','Estabilidad térmica','rectangular ½','estabilidad',5),
 ('temperatura','udTcarga','Efecto de carga','rectangular ½','carga',6),
 ('temperatura','uder','Deriva del patrón','rectangular','deriva',7)
) AS c(mag,simbolo,nombre,dist,fuente,orden)
JOIN met_magnitud m ON m.codigo = c.mag
WHERE NOT EXISTS (SELECT 1 FROM met_componente x JOIN met_magnitud mm ON mm.id=x.magnitud_id WHERE mm.codigo=c.mag AND x.simbolo=c.simbolo AND x.orden=c.orden);

-- Los 12 procesos
INSERT INTO met_proceso (codigo, magnitud_id, nombre, metodo, norma)
SELECT p.codigo, m.id, p.nombre, p.metodo, p.norma FROM (VALUES
 ('ITM01','masa','Calibración de masas patrón','LMT-PG01-P01-ITM01 · Masas patrón','OIML R111 / Guía SIM 2009'),
 ('ITM02','masa','Instrumentos de pesar (balanzas)','LMT-PG01-P01-ITM02 · Instrumentos de pesar no automáticos','Guía SIM 2009'),
 ('ITM03','masa','Masas no normalizadas','LMT-PG01-P01-ITM03 · Masas no normalizadas','OIML R111 / Guía SIM 2009'),
 ('ITP01','presion','Manómetros con balanza de pesos muertos','LMT-PG01-P01-ITP01 · Balanza de pesos muertos','EURAMET cg-17'),
 ('ITP02','presion','Manómetro vs manómetro','LMT-PG01-P01-ITP02 · Comparación de manómetros','EURAMET cg-17'),
 ('ITF01','fuerza','Máquinas de ensayos uniaxiales con transductor','LMT-PG01-P01-ITF01 · Transductor de fuerza','ISO 7500-1'),
 ('ITF03','fuerza','Máquinas de ensayos uniaxial con pesos muertos','LMT-PG01-P01-ITF03 · Pesos muertos','ISO 7500-1'),
 ('ITV02a','volumen','Material volumétrico aforado','LMT-PG01-P01-ITV02 F01 · Aforado','ISO 4787 (gravimétrico)'),
 ('ITV02g','volumen','Material volumétrico graduado','LMT-PG01-P01-ITV02 F02 · Graduado','ISO 4787 (gravimétrico)'),
 ('ITV02c','volumen','Material volumétrico contenedores','LMT-PG01-P01-ITV02 F03 · Contenedores','ISO 4787 (gravimétrico)'),
 ('ITV05','volumen','Instrumentos por pistón/émbolo (micropipetas)','LMT-PG01-P01-ITV05 · Pistón o émbolo','ISO 8655 (gravimétrico)'),
 ('ITT02','temperatura','Medios isotermos (baños termostáticos)','LMT-PG01-P01-ITT02 · Caracterización de isotermos','EURAMET cg-13')
) AS p(codigo,mag,nombre,metodo,norma)
JOIN met_magnitud m ON m.codigo = p.mag
ON CONFLICT (codigo) DO NOTHING;

-- Tolerancias OIML R111 (mg)
INSERT INTO met_tolerancia_oiml (nominal, clase, mpe_mg) VALUES
 ('1 g','E2',0.006),('1 g','F1',0.020),('1 g','F2',0.06),
 ('10 g','E2',0.020),('10 g','F1',0.060),('10 g','F2',0.20),
 ('100 g','E2',0.050),('100 g','F1',0.16),('100 g','F2',0.50),
 ('1 kg','E2',0.50),('1 kg','F1',1.6),('1 kg','F2',5.0),
 ('10 kg','E2',5.0),('10 kg','F1',16),('10 kg','F2',50)
ON CONFLICT (nominal, clase) DO NOTHING;

-- Un par de patrones de ejemplo (no PII) para el tenant IDIC
INSERT INTO met_patron (tenant_id, magnitud_id, codigo, nombre, marca, modelo, serie, clase, u_expandida, deriva, n_certificado, vence, emisor, trazabilidad)
SELECT t.id, m.id, v.codigo, v.nombre, v.marca, v.modelo, v.serie, v.clase, v.u, v.der, v.cert, v.vence::date, v.emisor, v.tz
FROM (VALUES
 ('masa','MP-E2-01','Juego de masas patrón E2','Mettler Toledo','E2','MP-778','E2',0.00015,0.00005,'LC001-2025-114','2026-11-30','CESMEC','SIM/BIPM'),
 ('presion','PT-01','Manómetro digital patrón','Fluke','700G31','PT-9004','0,05 %',0.012,0.0,'LC001-2025-089','2026-09-15','CESMEC','SIM/BIPM'),
 ('fuerza','FT-01','Transductor de fuerza clase 00','HBM','C10','FT-450','00',0.09,0.0,'LC001-2025-071','2026-12-01','CESMEC','SIM/BIPM'),
 ('temperatura','TP-01','Termómetro patrón PT-100','Fluke','5615','TP-330','—',0.03,0.0,'LC001-2025-060','2026-10-20','CESMEC','SIM/BIPM')
) AS v(mag,codigo,nombre,marca,modelo,serie,clase,u,der,cert,vence,emisor,tz)
JOIN met_magnitud m ON m.codigo = v.mag
JOIN tenant t ON t.codigo = 'IDIC'
WHERE NOT EXISTS (SELECT 1 FROM met_patron p WHERE p.codigo = v.codigo);

-- Permisos del módulo
INSERT INTO permiso (codigo, modulo, accion, descripcion) VALUES
 ('metrologia.ver','metrologia','ver','Ver calibraciones y procesos de metrología'),
 ('metrologia.crear','metrologia','crear','Registrar y calcular calibraciones'),
 ('metrologia.emitir','metrologia','emitir','Emitir certificados de calibración'),
 ('metrologia.config','metrologia','config','Configurar componentes, divisores y tolerancias')
ON CONFLICT (codigo) DO NOTHING;

-- Otorgar a SUPERADMIN, ADMIN, DIRECTOR y a los roles de laboratorio
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM rol r
JOIN permiso p ON p.codigo IN ('metrologia.ver','metrologia.crear','metrologia.emitir','metrologia.config')
WHERE r.codigo IN ('SUPERADMIN','ADMIN','DIRECTOR','JEFE_LAB','ANALISTA_SR')
ON CONFLICT DO NOTHING;
-- ANALISTA/TECNICO: ver + crear (no config ni emitir)
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r
JOIN permiso p ON p.codigo IN ('metrologia.ver','metrologia.crear')
WHERE r.codigo IN ('ANALISTA','TECNICO')
ON CONFLICT DO NOTHING;
