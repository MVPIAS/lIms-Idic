-- ============================================================================
-- SEED formato_informe · Catálogo de Informes Personalizados (>=20) · Aiuken
-- ----------------------------------------------------------------------------
-- Objetivo contractual (Bases 1867-1-LP26, §4.8.2 / §5.9): disponer de al menos
-- 20 formatos de informe personalizados y representativos, activos en el LIMS.
--
-- Estado previo: 13 formatos activos (SCC*, IVC*, RES01, IBC01, DAL01, i2bas,
-- inbas, STGO1). Este seed AÑADE 12 formatos adicionales -> 25 activos.
--
-- Cada formato usa como `codigo` el REPID de una plantilla_informe REAL ya
-- sembrada (seed_plantillas.sql, 114 plantillas legacy del LIMS), de modo que
-- el formato queda mapeado a una plantilla base existente.
--
-- Idempotente:
--   * ON CONFLICT (tenant_id, codigo) DO UPDATE reactiva y refresca la
--     descripción; NO duplica los 13 formatos ya activos.
--   * Se aplica solo al tenant IDIC (mono-tenant).
-- ============================================================================

INSERT INTO formato_informe (tenant_id, codigo, descripcion, veredicto, organismo, destino, activo)
SELECT t.id, f.codigo, f.descripcion, f.veredicto, f.organismo, f.destino, true
FROM tenant t
CROSS JOIN (VALUES
  -- ---- Laboratorio · Informe de Ensayo (plantillas I.ENSAYO) -----------------
  ('IFINN', 'Informe de Ensayo con certificación INN',            NULL,        NULL, 'cliente'),
  ('IFTUV', 'Informe de Ensayo con certificación TÜV',            NULL,        NULL, 'cliente'),
  ('IFSL',  'Informe de Ensayo sin certificación',                NULL,        NULL, 'cliente'),
  -- ---- Laboratorio · Certificado / Boletín de Análisis ----------------------
  ('BolAn', 'Boletín de Análisis con especificación',             'cumple',    NULL, 'cliente'),
  ('PTNC',  'Boletín de Análisis con especificación (No Cumple)', 'no_cumple', NULL, 'cliente'),
  ('PLAPI', 'Certificado / Planilla de Resultados',               NULL,        NULL, 'cliente'),
  -- ---- Laboratorio · Explosivos (certificados especializados) ---------------
  ('SSTG3', 'Certificado Velocidad de Detonación (Producción)',   'cumple',    NULL, 'cliente'),
  ('SSTG4', 'Certificado de Iniciadores',                         'cumple',    NULL, 'cliente'),
  ('cervt', 'Certificado Tiempo de Combustión',                   'cumple',    NULL, 'cliente'),
  -- ---- SAEC · Armas / Evidencias forenses -----------------------------------
  ('ASTEC', 'Certificado de Armas (SAEC)',                        NULL,        NULL, 'cliente'),
  ('RECUN', 'Reconocimiento de Cuño (SAEC)',                      NULL,        NULL, 'cliente'),
  -- ---- Textil / Prendas (Informe Técnico) -----------------------------------
  ('InfT2', 'Informe de Prendas',                                 NULL,        NULL, 'cliente')
) AS f(codigo, descripcion, veredicto, organismo, destino)
WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      veredicto   = EXCLUDED.veredicto,
      organismo   = EXCLUDED.organismo,
      destino     = EXCLUDED.destino,
      activo      = true,
      deleted_at  = NULL;

-- Verificación: debe devolver >= 20.
SELECT count(*) AS formatos_informe_activos
FROM formato_informe
WHERE activo AND deleted_at IS NULL;
