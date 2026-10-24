-- =============================================================================
-- LIMS IDIC · SAEC · casos, evidencias, armas y custodia de ejemplo · DATOS DE DEMOSTRACIÓN · Aiuken
-- =============================================================================
-- SOLO demo (ORDEN_SQL.txt: etiqueta «demo», justo después de saec.sql): datos
-- INVENTADOS para la base de demostración y preproducción. Nunca en la base real
-- del IDIC: la instalación «sin-demo» deja la estructura sin estas filas.
-- 2 casos, 6 evidencias, 3 armas (propietario y RUT ficticios) y su ingreso a bodega.
-- Separado de saec.sql el 24-10-2026 (arranque «sin-demo» limpio). Idempotente:
-- una pasada deja lo mismo que dos.
-- =============================================================================

BEGIN;

-- ============================================================
-- SEED idempotente · tenant IDIC
-- La unicidad de (tenant_id, numero_caso) / (tenant_id, codigo) hace
-- idempotente el re-run.
-- ============================================================

-- 2 casos SAEC
INSERT INTO saec_caso
  (tenant_id, numero_caso, uuid_ibis, agencia_origen_ref, agencia_origen_nombre,
   tipo_evento_codigo, tipo_evento_texto, fecha_ocurrencia, estado, restringido, alto_perfil, comentario, origen)
SELECT t.id, v.num, v.uuid_ibis, v.ag_ref, v.ag_nom, v.ev_cod, v.ev_txt, v.fecha, v.estado, v.restr, v.perfil, v.coment, v.origen
FROM tenant t, (VALUES
  ('CASO-2026-0001','IBIS-CASE-QQWW1001','Ministerio Público','Fiscalía Local de Santiago Centro',
   'HOM','Homicidio', TIMESTAMPTZ '2026-03-12 22:40:00-03', 'en_proceso', FALSE, TRUE,
   'Homicidio con arma de fuego en la vía pública. Se recuperan 4 vainillas y 1 proyectil.', 'manual'),
  ('CASO-2026-0002','IBIS-CASE-QQWW1002','Policía Militar','Destacamento de Policía Militar Nº1',
   'DRA','Drogas y armas', TIMESTAMPTZ '2026-04-02 09:15:00-03', 'abierto', FALSE, FALSE,
   'Incautación en control vehicular: 1 pistola con serie limada y munición.', 'manual')
) AS v(num, uuid_ibis, ag_ref, ag_nom, ev_cod, ev_txt, fecha, estado, restr, perfil, coment, origen)
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, numero_caso) DO NOTHING;

-- 6 evidencias/elementos
INSERT INTO evidencia
  (tenant_id, codigo, uuid_ibis, caso_id, exhibit_number, tipo, descripcion,
   categoria_codigo, categoria_texto, calibre_codigo, calibre_texto,
   firing_pin_shape, breech_face_class, marca, composicion, hit_count,
   estado, codigo_barras, soporte, procedencia, organismo_solicitante)
SELECT
  t.id, v.codigo, v.uuid_ibis,
  (SELECT c.id FROM saec_caso c WHERE c.tenant_id = t.id AND c.numero_caso = v.caso AND c.deleted_at IS NULL LIMIT 1),
  v.exhibit, v.tipo, v.descripcion, v.cat_cod, v.cat_txt, v.cal_cod, v.cal_txt,
  v.fps, v.bfc, v.marca, v.comp, v.hits, v.estado, v.barras, v.soporte, v.proc, v.org
FROM tenant t, (VALUES
  ('EV-2026-0001','IBIS-EXH-CC1000','CASO-2026-0001','CC1000','vainilla',
   'Vainilla percutada recuperada en el sitio del suceso, calle Merced 1120.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum','Circular hemisférico','Paralelas verticales',
   'PMC','Latón', 2, 'analizada','7801234000018','fisica','Levantamiento en sitio del suceso','Ministerio Público'),
  ('EV-2026-0002','IBIS-EXH-CC1001','CASO-2026-0001','CC1001','vainilla',
   'Vainilla percutada recuperada a 3 m de la anterior.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum','Circular hemisférico','Paralelas verticales',
   'PMC','Latón', 2, 'analizada','7801234000025','fisica','Levantamiento en sitio del suceso','Ministerio Público'),
  ('EV-2026-0003','IBIS-EXH-BU2000','CASO-2026-0001','BU2000','proyectil',
   'Proyectil deformado extraído durante la autopsia.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum',NULL,'6 estrías dextrógiras',
   'Desconocida','Plomo encamisado', 1, 'analizada','7801234000032','fisica','Autopsia SML','Ministerio Público'),
  ('EV-2026-0004','IBIS-EXH-TF1003','CASO-2026-0002','TF1003','vainilla',
   'Vainilla de disparo de prueba (test fire) del arma incautada EV-2026-0005.',
   'TF','Test Fire','9MMP','9 mm Parabellum','Circular hemisférico','Paralelas verticales',
   'CBC','Latón', 1, 'analizada','7801234000049','fisica','Disparo de prueba en polígono IDIC','IDIC'),
  ('EV-2026-0005',NULL,'CASO-2026-0002','AR1000','arma',
   'Pistola semiautomática incautada en control vehicular, con número de serie limado.',
   'CE','Crime Evidence','9MMP','9 mm Parabellum',NULL,NULL,
   'Glock',NULL, 0, 'en_analisis','7801234000056','fisica','Incautación en control vehicular','Policía Militar'),
  ('EV-2026-0006',NULL,'CASO-2026-0002','EX3000','explosivo',
   'Artefacto explosivo improvisado desactivado; peritaje no balístico (registro manual de resultados).',
   'CE','Crime Evidence',NULL,NULL,NULL,NULL,
   NULL,'Nitrato de amonio / combustible', 0, 'ingresada','7801234000063','mixta','Hallazgo en inmueble','Fiscalía Local')
) AS v(codigo, uuid_ibis, caso, exhibit, tipo, descripcion, cat_cod, cat_txt, cal_cod, cal_txt,
       fps, bfc, marca, comp, hits, estado, barras, soporte, proc, org)
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- 3 fichas de arma (una ligada al elemento EV-2026-0005)
INSERT INTO arma
  (tenant_id, evidencia_id, serie, serie_borrada, marca, modelo, calibre, tipo,
   estado_registral, inscripcion_dgmn, fecha_inscripcion_dgmn, propietario_registrado, rut_propietario,
   estado, observaciones)
SELECT
  t.id,
  (SELECT e.id FROM evidencia e WHERE e.tenant_id = t.id AND e.codigo = v.ev AND e.deleted_at IS NULL LIMIT 1),
  v.serie, v.borrada, v.marca, v.modelo, v.calibre, v.tipo, v.reg, v.dgmn, v.fdgmn, v.prop, v.rut, v.estado, v.obs
FROM tenant t, (VALUES
  ('EV-2026-0005', NULL, TRUE, 'Glock','17 Gen4','9 mm Parabellum','pistola',
   'no_inscrita', NULL, NULL::date, NULL, NULL, 'en_analisis',
   'Serie limada; se solicita restauración de numeración por ataque químico. Consulta DGMN pendiente.'),
  (NULL, 'FN-4471290', FALSE, 'FN Herstal','FNP-9','9 mm Parabellum','pistola',
   'inscrita', 'DGMN-2019-114872', DATE '2019-07-04', 'Propietario Prueba Aiuken', '11.111.111-1', 'en_custodia',
   'Arma inscrita, ingresada por encargo vigente comunicado por la DGMN.'),
  (NULL, 'HECHIZA-0031', FALSE, 'Artesanal','Hechiza','12 mm','hechiza',
   'decomisada', NULL, NULL::date, NULL, NULL, 'en_custodia',
   'Arma hechiza decomisada por Aduanas; pendiente de destrucción autorizada.')
) AS v(ev, serie, borrada, marca, modelo, calibre, tipo, reg, dgmn, fdgmn, prop, rut, estado, obs)
WHERE t.codigo = 'IDIC'
  AND NOT EXISTS (
    SELECT 1 FROM arma a
     WHERE a.tenant_id = t.id
       AND a.marca = v.marca AND a.modelo = v.modelo
       AND COALESCE(a.serie, '~') = COALESCE(v.serie, '~')
  );

-- Cadena de custodia inicial de las evidencias sembradas (entrada a bodega).
-- Idempotente por NOT EXISTS: la tabla es inmutable, no admite ON CONFLICT DO UPDATE.
INSERT INTO evidencia_movimiento
  (tenant_id, evidencia_id, evento, fecha, desde_organismo, hacia_organismo, motivo, sello_numero, sello_integro, firma_nombre)
SELECT t.id, e.id, 'entrada', e.created_at, e.organismo_solicitante, 'IDIC · Bodega de evidencias',
       'Ingreso inicial de la evidencia al banco del SAEC (acta de recepción).',
       'SELLO-' || right(e.codigo, 4), TRUE, 'Suboficial de guardia · Recepción SAEC'
FROM tenant t
JOIN evidencia e ON e.tenant_id = t.id AND e.deleted_at IS NULL
WHERE t.codigo = 'IDIC'
  AND e.codigo LIKE 'EV-2026-%'
  AND NOT EXISTS (
    SELECT 1 FROM evidencia_movimiento m WHERE m.evidencia_id = e.id AND m.evento = 'entrada'
  );

COMMIT;
