-- =============================================================================
-- LIMS IDIC · F028 (perfil activo por sesión) y FEA del certificado de evidencia SAEC · Aiuken
-- =============================================================================
-- Aditivo e idempotente: se puede aplicar N veces.
--
-- 1) F028 · el perfil de trabajo de una persona con jefaturas duales («¿Con qué
--    perfil va a trabajar?») ya no se guarda por usuario en usuario_perfil_activo:
--    viaja en el token de la sesión (claim `pu`), de modo que elegirlo en un
--    navegador no cambia el de otro ingreso y cada ingreso vuelve a preguntar.
--    La tabla deja de leerse y escribirse; se vacía para que no quede un perfil
--    «pegado» si se vuelve a una versión anterior, y se conserva por compatibilidad.
--
-- 2) FEA · el certificado de evidencia del SAEC (`saec_certificado`) es un origen
--    más de la firma electrónica avanzada (origen «saec»). Ver
--    docs/FLUJO_FEA_DOCUMENTOS.md. El permiso documento.fea.gestionar ya existe
--    (align_nuevo_f4.sql) y no cambia.
-- =============================================================================

-- 1) F028 ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.usuario_perfil_activo') IS NOT NULL THEN
    DELETE FROM usuario_perfil_activo;
    COMMENT ON TABLE usuario_perfil_activo IS
      'OBSOLETO (F028): el perfil activo viaja en el token de cada sesión (claim pu). No se lee ni se escribe.';
  END IF;
END $$;

-- 2) FEA del certificado de evidencia SAEC -----------------------------------
DO $$
BEGIN
  IF to_regclass('public.documento_fea_archivo') IS NOT NULL THEN
    ALTER TABLE documento_fea_archivo DROP CONSTRAINT IF EXISTS documento_fea_archivo_origen_check;
    ALTER TABLE documento_fea_archivo
      ADD CONSTRAINT documento_fea_archivo_origen_check CHECK (origen IN ('informe', 'metrologia', 'saec'));
  END IF;
END $$;

-- Parámetro «fea»: por defecto no se exige (igual que los demás tipos).
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, 90, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('fea', 'certificado_evidencia_saec', 'Certificado de evidencia y peritaje (SAEC): exige FEA antes de entregar', 'no')
 ) AS v(categoria, codigo, etiqueta, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
