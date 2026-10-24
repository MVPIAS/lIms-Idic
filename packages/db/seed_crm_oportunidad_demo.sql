-- =============================================================================
-- LIMS IDIC · CRM · oportunidades de ejemplo · DATOS DE DEMOSTRACIÓN · Aiuken
-- =============================================================================
-- SOLO demo (ORDEN_SQL.txt: etiqueta «demo», justo después de crm_oportunidad.sql): datos
-- INVENTADOS para la base de demostración y preproducción. Nunca en la base real
-- del IDIC: la instalación «sin-demo» deja la estructura sin estas filas.
-- 6 oportunidades ficticias del tenant IDIC, ligadas a clientes de la demo por RUT.
-- Separado de crm_oportunidad.sql el 24-10-2026 (arranque «sin-demo» limpio). Idempotente:
-- una pasada deja lo mismo que dos.
-- =============================================================================

BEGIN;

-- ------------------------------------------------------------
-- Seed idempotente: ~6 oportunidades del tenant IDIC, ligadas a
-- clientes existentes por RUT (subselect). Etapas/montos variados.
-- La unicidad de `codigo` hace idempotente el re-run (ON CONFLICT).
-- ------------------------------------------------------------
INSERT INTO oportunidad
  (tenant_id, codigo, titulo, cliente_id, contacto, monto_estimado, moneda, probabilidad, etapa, estado, origen, fecha_cierre_estimada, notas)
SELECT
  t.id,
  v.codigo,
  v.titulo,
  (SELECT c.id FROM cliente c WHERE c.tenant_id = t.id AND c.rut = v.rut AND c.deleted_at IS NULL LIMIT 1),
  v.contacto,
  v.monto,
  'CLP',
  v.prob,
  v.etapa,
  v.estado,
  v.origen,
  v.cierre,
  v.notas
FROM tenant t, (VALUES
  ('OPP-2026-0001','Renovación análisis de aceros estructurales', '99.999.902-6','Ing. P. Muñoz',  48500000, 60, 'propuesta',   'viva',    'referido',   DATE '2026-09-30','Propuesta enviada; pendiente aprobación técnica del cliente.'),
  ('OPP-2026-0002','Ensayos balísticos munición 5.56 lote 2026',  '61.104.000-8','Cap. R. Torres',  92000000, 75, 'negociacion', 'viva',    'licitacion', DATE '2026-08-15','En negociación de plazos y penalidades.'),
  ('OPP-2026-0003','Servicio de peritaje armas incautadas',       '71.541.400-7','Subof. L. Rojas', 15300000, 40, 'calificada',  'viva',    'evento',     DATE '2026-10-20','Levantamiento de requisitos con DEPTOL5.'),
  ('OPP-2026-0004','Control de calidad alimentos programa escolar','61.219.000-3','Sra. C. Díaz',    27800000, 30, 'prospecto',   'viva',    'web',        DATE '2026-11-10','Primer contacto; interesados en acreditación.'),
  ('OPP-2026-0005','Certificación fitosanitaria exportación',     '61.307.000-1','Ing. A. Vega',    36400000,100, 'ganada',      'ganada',  'referido',   DATE '2026-06-01','Adjudicada. Pasar a cotización/OT.'),
  ('OPP-2026-0006','Auditoría metrológica movilización',          '61.101.049-4','Tte. F. Soto',    21000000,  0, 'perdida',     'perdida', 'licitacion', DATE '2026-05-15','Perdida: presupuesto adjudicado a competidor.')
) AS v(codigo, titulo, rut, contacto, monto, prob, etapa, estado, origen, cierre, notas)
WHERE t.codigo = 'IDIC'
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
