-- =============================================================================
-- seed_tercer_envio_demo.sql · Datos de PRUEBA para el tercer envío IDIC
-- (17-11-2026) · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- SOLO ENTORNOS DE DEMOSTRACIÓN (etiqueta `demo` en ORDEN_SQL.txt). Nunca se
-- aplica en la instalación de producción del IDIC.
--
--   · BPCH-19: el número del Informe de Inspección BPCH lleva el Código de
--     empresa del cliente ({EMPRESA}) y sin él el documento oficial no se
--     emite. Los clientes de prueba que usan el BPCH reciben un código de
--     PRUEBA (9001, 9002…) si aún no tienen uno, para que preproducción siga
--     emitiendo. No se pisa un código ya registrado.
--   (Los dos inspectores por sucursal, BPCH-48, están en seed_accesos_demo.sql.)
--
-- IDEMPOTENTE. Va después de align_tercer_envio_bpch.sql (columna codigo_empresa).
-- =============================================================================

WITH clientes_bpch AS (
  SELECT DISTINCT o.cliente_id AS id
    FROM orden_trabajo o
    JOIN unidad u ON u.id = o.unidad_principal
    LEFT JOIN unidad p ON p.id = u.padre_id
   WHERE o.cliente_id IS NOT NULL AND (u.codigo = 'BPCH' OR p.codigo = 'BPCH')
  UNION SELECT cliente_id FROM bpch_internacion  WHERE cliente_id IS NOT NULL
  UNION SELECT cliente_id FROM bpch_reinspeccion WHERE cliente_id IS NOT NULL
  UNION SELECT cliente_id FROM bpch_oc_operativa WHERE cliente_id IS NOT NULL
  UNION SELECT cliente_id FROM bpch_prototipo    WHERE cliente_id IS NOT NULL
), sin_codigo AS (
  SELECT c.id, row_number() OVER (ORDER BY c.razon_social, c.id) AS n
    FROM cliente c JOIN clientes_bpch b ON b.id = c.id
   WHERE btrim(COALESCE(c.codigo_empresa, '')) = ''
), base AS (
  -- Continúa después del mayor código de prueba ya asignado (9001, 9002…).
  SELECT COALESCE(max(codigo_empresa::int), 9000) AS ultimo
    FROM cliente WHERE codigo_empresa ~ '^9[0-9]{3}$'
)
UPDATE cliente c
   SET codigo_empresa = (base.ultimo + s.n)::text, updated_at = now()
  FROM sin_codigo s, base
 WHERE c.id = s.id;
