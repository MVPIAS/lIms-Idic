-- =============================================================================
-- align_q5_bpch.sql · Respuestas del IDIC del 24-11-2026 (checklist, pestaña
-- «BPCH Sucursales») · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: una pasada deja la misma base que dos. No pisa una
-- regla que el IDIC ya haya creado en Administración › Matriz de firmas.
-- Va ANTES de align_cierre_permisos.sql. No crea permisos.
--
--   Sucursales 10 y 20 (D2) · La sucursal emite el Certificado de Conformidad y
--   el Jefe de Sucursal firma todos los certificados. Hasta hoy el Certificado
--   de Conformidad lo firmaba siempre el Jefe de la Sección Certificación de la
--   Conformidad (regla por defecto, unidad fija SCC). Se agrega una regla propia
--   para cada sucursal de provincia (Antofagasta, La Serena, Calama, Copiapó e
--   Iquique): firma el Jefe de la misma sucursal (rol JEFE_LAB, titular o
--   subrogante). La Sección Certificación y la Sucursal Santiago siguen con la
--   regla por defecto hasta que el IDIC confirme a quién corresponde en Santiago.
-- =============================================================================

INSERT INTO flujo_firma (id, tenant_id, tipo_documento, unidad_id, orden, accion, rol_id,
                         nivel_unidad, unidad_destino_id, obligatorio, activo, descripcion)
SELECT gen_random_uuid(), t.id, 'CERTIFICADO_CONFORMIDAD', u.id, 1, 'FIRMA', r.id, 'MISMA', NULL, TRUE, TRUE,
       'Firma el Jefe de Sucursal (respuesta IDIC 24-11-2026: el Jefe de Sucursal firma todos los certificados)'
  FROM tenant t
  JOIN unidad u ON u.tenant_id = t.id AND u.codigo IN ('SANTOF', 'SSEREN', 'SCALAM', 'SCOPIAP', 'SIQUIQU')
  JOIN rol r    ON r.tenant_id = t.id AND r.codigo = 'JEFE_LAB'
 WHERE t.codigo = 'IDIC'
   AND NOT EXISTS (SELECT 1 FROM flujo_firma x
                    WHERE x.tenant_id = t.id AND x.tipo_documento = 'CERTIFICADO_CONFORMIDAD' AND x.unidad_id = u.id);
