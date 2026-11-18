-- =============================================================================
-- seed_cuarto_envio_tasa_demo.sql · Datos de PRUEBA · tasa de internación 1,5 %
-- (cuarto envío IDIC, 18-11-2026, COM-03) · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- SOLO ENTORNOS DE DEMOSTRACIÓN (etiqueta `demo` en ORDEN_SQL.txt). Nunca se
-- aplica en la instalación de producción del IDIC: allí el IDIC carga sus
-- agencias de aduana en Administración › Parámetros del sistema › «Agencia de
-- aduana (tasa de internación)».
--
--   · Dos agencias de aduana de PRUEBA para elegir en el cálculo de la tasa.
--
-- IDEMPOTENTE. No pisa una agencia que ya exista con el mismo código.
-- =============================================================================

INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo)
SELECT t.id, 'agencia_aduana', v.codigo, v.etiqueta, v.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
  ('PRUEBA_1', 'Agencia de aduana PRUEBA 1', 1),
  ('PRUEBA_2', 'Agencia de aduana PRUEBA 2', 2)
 ) AS v(codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
