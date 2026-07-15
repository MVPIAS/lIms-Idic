-- =============================================================================
-- SEED · DATOS DE OPERACIÓN PARA FLUJO DE LABORATORIO END-TO-END · LIMS IDIC
-- =============================================================================
-- OBJETIVO: la BD viva ya tiene 8 clientes, 136 métodos, 272 analitos (con
-- límites en norma_limite) y el tenant IDIC, pero `orden_trabajo` y `muestra`
-- están vacías y `resultado` no tiene filas. Eso deja el Expediente OT
-- (apps/web/app/(app)/ot/[id]/page.tsx), el maestro de Muestras
-- (apps/web/app/(app)/muestras/page.tsx) y la Captura de resultados
-- (apps/web/app/(app)/captura/page.tsx) sin datos que mostrar.
--
-- Este script SOLO agrega datos operativos (+ alineación aditiva mínima de
-- `resultado`, que es la única de las tres tablas con columnas Prisma
-- faltantes). Es 100% idempotente: se puede ejecutar tantas veces como se
-- quiera sin duplicar filas ni romper nada existente.
--
-- VERIFICACIÓN DE ALINEACIÓN SCHEMA.SQL vs PRISMA (packages/db/prisma/schema.prisma)
-- para las 3 tablas objetivo, revisando también apps/api/src/ot/ot.controller.ts
-- y apps/api/src/laboratorio/laboratorio.module.ts (MuestraService/ResultadoService):
--
--   - orden_trabajo (modelo OrdenTrabajo): YA ALINEADA. schema.sql líneas
--     1486-1495 ya agregan subdireccion_asignada, tipo_trabajo, documento_word,
--     fecha_entrega_cliente, fecha_recep_dco, dias_atraso, medio_envio,
--     estado_envio, descripcion_trabajo (todas las columnas que el modelo
--     Prisma OrdenTrabajo espera y que no estaban en la definición original de
--     la tabla). No requiere ALTER adicional.
--
--   - muestra (modelo Muestra): YA ALINEADA. schema.sql línea 2228-2229 agrega
--     gran_grupo_id/grupo_id y align_schema_to_prisma.sql agrega nombre,
--     cliente_id, codigo_barras, ubicacion, deleted_at. No requiere ALTER
--     adicional.
--
--   - resultado (modelo Resultado): DIVERGENTE. La tabla real (schema.sql
--     líneas 860-881) fue diseñada alrededor de analisis_programado_id
--     (analisis_programado -> corrida -> resultado), mientras que el modelo
--     Prisma Resultado y ResultadoService.capturar() (laboratorio.module.ts)
--     esperan columnas planas: ot_id, muestra_id, replicas (Json), promedio,
--     desviacion, cv, veredicto, analista_id, fecha, deleted_at. Ninguna de
--     esas columnas existe en la tabla real → SECCIÓN 1 las agrega vía
--     ADD COLUMN IF NOT EXISTS (aditivo, sin tocar columnas existentes).
--     `analito_id` y `unidad` ya existían y se reutilizan tal cual.
--
--     NOTA (fuera de alcance de este script, solo se documenta): las columnas
--     preexistentes `resultado.tenant_id` y `resultado.analisis_programado_id`
--     son NOT NULL sin DEFAULT y el modelo Prisma Resultado no las conoce, por
--     lo que ResultadoService.capturar() (POST /resultados) seguirá fallando
--     en runtime contra una BD nueva hasta que alguien relaje esas 2
--     restricciones — no se tocan aquí porque la instrucción de alineación de
--     este script es estrictamente ADD COLUMN (no ALTER de columnas
--     existentes). Para las filas que este script inserta, ambas columnas se
--     rellenan igualmente con valores reales (ver SECCIÓN 4: se crean filas
--     puente en `analisis_programado`), de modo que los datos demo quedan
--     100% consistentes con el esquema real.
--
-- Ejecutar DESPUÉS de: schema.sql + align_schema_to_prisma.sql +
-- seed_catalogos_metodos.sql + seed_gran_grupo_grupo.sql +
-- seed_analitos_limites.sql + seed_preprod_demo.sql (clientes IDIC).
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- SECCIÓN 1 · Alineación aditiva de `resultado` con el modelo Prisma Resultado
-- -----------------------------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS ot_id       UUID REFERENCES orden_trabajo(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS muestra_id  UUID REFERENCES muestra(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS replicas    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS promedio    NUMERIC(18,6);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS desviacion  NUMERIC(18,6);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS cv          NUMERIC(8,2);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS veredicto   VARCHAR(20);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS analista_id UUID REFERENCES usuario(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS fecha       TIMESTAMPTZ DEFAULT now();
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_resultado_muestra_id ON resultado(muestra_id);
CREATE INDEX IF NOT EXISTS idx_resultado_ot_id       ON resultado(ot_id);

-- -----------------------------------------------------------------------------
-- SECCIÓN 2 · Órdenes de Trabajo (orden_trabajo) · tenant IDIC
-- 6 OT, cada una ligada a un cliente real ya sembrado (por rut), con estados,
-- prioridades y fechas variadas. Idempotente por UNIQUE(tenant_id, codigo).
-- -----------------------------------------------------------------------------
INSERT INTO orden_trabajo (
  tenant_id, codigo, cliente_id, unidad_principal, prioridad,
  fecha_recepcion, fecha_compromiso, fecha_cierre,
  solicitante, numero_ley, origen_trabajo, estado, estado_envio, notas
)
SELECT
  t.id, v.codigo, c.id, u.id, v.prioridad,
  now() - make_interval(days => v.dias_recep_ago),
  (CURRENT_DATE + make_interval(days => v.dias_compromiso_off))::date,
  CASE WHEN v.dias_cierre_ago IS NULL THEN NULL ELSE now() - make_interval(days => v.dias_cierre_ago) END,
  v.solicitante, v.numero_ley, v.origen, v.estado, v.estado_envio, v.notas
FROM tenant t
JOIN (VALUES
  ('OT-2026-0001','61.104.000-8','LEM','alta',   'en_analisis', 12,  5, NULL,
     'Cap. Juan Pérez Soto',    '17.798-2026-0142', 'Control de calidad de producción',
     'No enviado', 'Verificación balística de lote de municiones y pólvora.'),
  ('OT-2026-0002','61.101.049-4','LMT','normal', 'recibida',     3, 20, NULL,
     'Tte. Cnel. Marcelo Rojas','17.798-2026-0158', 'Internación de armamento',
     'No enviado', 'Verificación técnica previa a internación de armamento.'),
  ('OT-2026-0003','91.021.000-9','LEM','normal', 'finalizada',  35, -3, 5,
     'Ing. Patricia Soto',       NULL,               'Control de calidad de coladas',
     'Enviado',    'Ensayos mecánicos de probetas de acero para certificación de colada.'),
  ('OT-2026-0004','96.529.310-8','LQA','urgente','en_analisis',  8,  2, NULL,
     'Rodrigo Fuentes',          NULL,               'Control bromatológico de lote',
     'No enviado', 'Análisis fisicoquímico de productos alimenticios previo a despacho.'),
  ('OT-2026-0005','61.307.000-1','LQA','normal', 'validacion',  18,  1, NULL,
     'M.V. Camila Ibáñez',       NULL,               'Monitoreo ambiental agrícola',
     'No enviado', 'Análisis de agua de riego y suelo agrícola.'),
  ('OT-2026-0006','71.541.400-7','LES','alta',   'cerrada',     50,-15, 20,
     'Cptn. Álvaro Núñez',       '17.798-2026-0099', 'Peritaje forense',
     'Enviado',    'Peritaje de artefacto explosivo y sustancia incautada en sitio del suceso.')
) AS v(codigo, rut, unidad_cod, prioridad, estado, dias_recep_ago, dias_compromiso_off, dias_cierre_ago,
       solicitante, numero_ley, origen, estado_envio, notas) ON TRUE
JOIN cliente c ON c.tenant_id = t.id AND c.rut = v.rut
LEFT JOIN unidad u ON u.tenant_id = t.id AND u.codigo = v.unidad_cod
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- SECCIÓN 3 · Muestras (muestra) · 2-3 por OT, ligadas a su ot_id real
-- tipo_muestra_id resuelto por código de la taxonomía raíz (schema.sql).
-- gran_grupo_id/grupo_id resueltos solo cuando aplica (eje producto armas);
-- se dejan NULL para muestras de tipo alimentos/agua/química general (son
-- columnas nullable, no hay grupo de producto real para esas matrices).
-- cliente_id heredado de la OT. Idempotente por UNIQUE(tenant_id, codigo).
-- -----------------------------------------------------------------------------
INSERT INTO muestra (
  tenant_id, ot_id, codigo, tipo_muestra_id, gran_grupo_id, grupo_id, cliente_id,
  nombre, estado, fecha_muestreo, recepcionada_at
)
SELECT
  t.id, o.id, v.codigo, tm.id, gg.id, gr.id, o.cliente_id,
  v.nombre, v.estado,
  now() - make_interval(days => v.dias_ago),
  now() - make_interval(days => v.dias_ago) + interval '2 hours'
FROM tenant t
JOIN (VALUES
  ('M-2026-0001','OT-2026-0001','metales',    'M','93', 'Cartucho fusil SIG cal. 5.56 - lote A12',              'en_analisis',10),
  ('M-2026-0002','OT-2026-0001','explosivos', 'E','2',  'Pólvora base doble - lote B7',                         'recibida',   10),
  ('M-2026-0003','OT-2026-0002','metales',    'A','45', 'Fusil SG 540 N/S 12345 - internación',                 'recibida',    3),
  ('M-2026-0004','OT-2026-0002','metales',    'M','91', 'Munición 7.62mm - lote internación 2026-04',           'recibida',    3),
  ('M-2026-0005','OT-2026-0003','metales',    NULL,NULL,'Probeta acero SAE 1045 - colada 2201',                 'finalizada', 35),
  ('M-2026-0006','OT-2026-0003','metales',    NULL,NULL,'Probeta acero SAE 4140 - colada 2202',                 'finalizada', 35),
  ('M-2026-0007','OT-2026-0003','metales',    NULL,NULL,'Alambrón trefilado - lote 889',                        'finalizada', 35),
  ('M-2026-0008','OT-2026-0004','alimentos',  NULL,NULL,'Galletas integrales - lote G0456',                     'en_analisis', 8),
  ('M-2026-0009','OT-2026-0004','alimentos',  NULL,NULL,'Cereal de desayuno chocolatado - lote C1123',           'en_analisis', 8),
  ('M-2026-0010','OT-2026-0004','alimentos',  NULL,NULL,'Aceite vegetal - lote A778',                           'recibida',    8),
  ('M-2026-0011','OT-2026-0005','agua',       NULL,NULL,'Agua de riego - Predio Los Aromos',                    'finalizada', 18),
  ('M-2026-0012','OT-2026-0005','quimica',    NULL,NULL,'Suelo agrícola - sector norte',                        'finalizada', 18),
  ('M-2026-0013','OT-2026-0006','explosivos', 'AU','198','Restos de artefacto explosivo - sitio del suceso',    'finalizada', 50),
  ('M-2026-0014','OT-2026-0006','quimica',    'AU','199','Sustancia incautada - análisis pirotécnico',          'finalizada', 50)
) AS v(codigo, ot_codigo, tipo_cod, gg_cod, cgrupo, nombre, estado, dias_ago) ON TRUE
JOIN orden_trabajo o   ON o.tenant_id = t.id AND o.codigo = v.ot_codigo
LEFT JOIN tipo_muestra tm ON tm.tenant_id = t.id AND tm.codigo = v.tipo_cod
LEFT JOIN gran_grupo gg   ON gg.tenant_id = t.id AND gg.codigo = v.gg_cod
LEFT JOIN grupo gr        ON gr.tenant_id = t.id AND gr.gran_grupo_id = gg.id AND gr.cgrupo = v.cgrupo
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- SECCIÓN 4 · Puente analisis_programado (requerido por resultado.analisis_
-- programado_id, NOT NULL en la tabla real) para las 10 combinaciones
-- muestra × analito que recibirán resultado en la SECCIÓN 5.
-- metodo_version_id se resuelve desde el propio analito elegido (su FK
-- original NOT NULL a metodo_version, garantizado por el catálogo sembrado).
-- Idempotente vía WHERE NOT EXISTS sobre (ot_id, muestra_id, metodo_version_id).
-- -----------------------------------------------------------------------------
WITH catalogo AS (
  SELECT
    a.id AS analito_id, a.metodo_version_id, a.unidad,
    COALESCE(nl.nominal, ROUND((COALESCE(nl.limite_inf,0) + nl.limite_sup) / 2.0, 3)) AS nominal,
    ROW_NUMBER() OVER (ORDER BY a.id) AS rn
  FROM analito a
  JOIN metodo m ON m.id = a.metodo_id
  JOIN tenant t2 ON t2.id = m.tenant_id AND t2.codigo = 'IDIC'
  JOIN norma_limite nl ON nl.analito_id = a.id
  WHERE a.metodo_id IS NOT NULL AND nl.limite_sup IS NOT NULL
),
asignaciones AS (
  SELECT * FROM (VALUES
    ('M-2026-0005', 1, 'completado'),
    ('M-2026-0005', 2, 'completado'),
    ('M-2026-0006', 3, 'completado'),
    ('M-2026-0007', 4, 'completado'),
    ('M-2026-0011', 5, 'completado'),
    ('M-2026-0012', 6, 'completado'),
    ('M-2026-0012', 7, 'completado'),
    ('M-2026-0013', 8, 'completado'),
    ('M-2026-0014', 9, 'completado'),
    ('M-2026-0001', 10,'en_curso')
  ) AS x(muestra_codigo, rn, ap_estado)
),
base AS (
  SELECT tn.id AS tenant_id, mu.id AS muestra_id, mu.ot_id AS ot_id,
         c.analito_id, c.metodo_version_id, c.unidad, c.nominal, asg.ap_estado
  FROM asignaciones asg
  JOIN catalogo c ON c.rn = asg.rn
  JOIN muestra mu ON mu.codigo = asg.muestra_codigo
  JOIN tenant tn  ON tn.id = mu.tenant_id AND tn.codigo = 'IDIC'
)
INSERT INTO analisis_programado (ot_id, muestra_id, metodo_version_id, estado, fecha_programada, fecha_inicio, fecha_fin)
SELECT b.ot_id, b.muestra_id, b.metodo_version_id, b.ap_estado, CURRENT_DATE,
       now(), CASE WHEN b.ap_estado = 'completado' THEN now() ELSE NULL END
FROM base b
WHERE NOT EXISTS (
  SELECT 1 FROM analisis_programado ap
  WHERE ap.ot_id = b.ot_id AND ap.muestra_id = b.muestra_id AND ap.metodo_version_id = b.metodo_version_id
);

-- -----------------------------------------------------------------------------
-- SECCIÓN 5 · Resultados (resultado) · 1-2 por algunas muestras
-- 3 réplicas generadas alrededor del valor nominal del límite del analito
-- (norma_limite), por lo que promedio/desviación/CV quedan coherentes y el
-- veredicto 'Cumple' es consistente con el rango real del catálogo.
-- tenant_id y analisis_programado_id (columnas legacy NOT NULL de la tabla
-- real) se resuelven al puente creado en la SECCIÓN 4. Idempotente: evita
-- duplicar por (muestra_id, analito_id).
-- -----------------------------------------------------------------------------
WITH catalogo AS (
  SELECT
    a.id AS analito_id, a.metodo_version_id, a.unidad,
    COALESCE(nl.nominal, ROUND((COALESCE(nl.limite_inf,0) + nl.limite_sup) / 2.0, 3)) AS nominal,
    ROW_NUMBER() OVER (ORDER BY a.id) AS rn
  FROM analito a
  JOIN metodo m ON m.id = a.metodo_id
  JOIN tenant t2 ON t2.id = m.tenant_id AND t2.codigo = 'IDIC'
  JOIN norma_limite nl ON nl.analito_id = a.id
  WHERE a.metodo_id IS NOT NULL AND nl.limite_sup IS NOT NULL
),
asignaciones AS (
  SELECT * FROM (VALUES
    ('M-2026-0005', 1),
    ('M-2026-0005', 2),
    ('M-2026-0006', 3),
    ('M-2026-0007', 4),
    ('M-2026-0011', 5),
    ('M-2026-0012', 6),
    ('M-2026-0012', 7),
    ('M-2026-0013', 8),
    ('M-2026-0014', 9),
    ('M-2026-0001', 10)
  ) AS x(muestra_codigo, rn)
),
base AS (
  SELECT tn.id AS tenant_id, mu.id AS muestra_id, mu.ot_id AS ot_id,
         c.analito_id, c.metodo_version_id, c.unidad, c.nominal
  FROM asignaciones asg
  JOIN catalogo c ON c.rn = asg.rn
  JOIN muestra mu ON mu.codigo = asg.muestra_codigo
  JOIN tenant tn  ON tn.id = mu.tenant_id AND tn.codigo = 'IDIC'
)
INSERT INTO resultado (
  tenant_id, analisis_programado_id, analito_id, ot_id, muestra_id,
  replicas, promedio, desviacion, cv, unidad, veredicto, estado, fecha
)
SELECT
  b.tenant_id, ap.id, b.analito_id, b.ot_id, b.muestra_id,
  jsonb_build_array(reps.r1, reps.r2, reps.r3),
  ROUND(st.promedio, 6),
  ROUND(st2.desviacion, 6),
  ROUND(CASE WHEN st.promedio = 0 THEN 0 ELSE (st2.desviacion / ABS(st.promedio)) * 100 END, 2),
  b.unidad,
  'Cumple',
  'aprobado',
  now()
FROM base b
JOIN analisis_programado ap
  ON ap.ot_id = b.ot_id AND ap.muestra_id = b.muestra_id AND ap.metodo_version_id = b.metodo_version_id
CROSS JOIN LATERAL (
  VALUES (ROUND(b.nominal * 0.99, 3), ROUND(b.nominal, 3), ROUND(b.nominal * 1.01, 3))
) AS reps(r1, r2, r3)
CROSS JOIN LATERAL (
  VALUES ((reps.r1 + reps.r2 + reps.r3) / 3.0)
) AS st(promedio)
CROSS JOIN LATERAL (
  VALUES (SQRT((POWER(reps.r1 - st.promedio, 2) + POWER(reps.r2 - st.promedio, 2) + POWER(reps.r3 - st.promedio, 2)) / 2))
) AS st2(desviacion)
WHERE NOT EXISTS (
  SELECT 1 FROM resultado r2 WHERE r2.muestra_id = b.muestra_id AND r2.analito_id = b.analito_id
);

COMMIT;

-- =============================================================================
-- FIN
-- =============================================================================
