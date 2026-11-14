-- =============================================================================
-- align_nuevo_f2.sql · Exportación de facturas para el sistema de facturación
-- electrónica del IDIC y documento de cobro en PDF (frente nuevo-f2, 14-11-2026).
-- Idempotente: ADD COLUMN IF NOT EXISTS e INSERT ... ON CONFLICT DO NOTHING; no
-- borra ni cambia valores ya configurados.
-- Se aplica antes de align_cierre_permisos.sql (ver ORDEN_SQL.txt).
-- Documentación: docs/EXPORTACION_FACTURACION.md. Sin permisos nuevos: usa
-- factura.ver (exportar, PDF) y factura.emitir (marcar exenta).
-- =============================================================================

-- --- 1 · Exención de IVA de la factura ----------------------------------------
-- true = exenta de IVA (DTE 34, p. ej. la tasa de internación del BPCH),
-- false = afecta (DTE 33), NULL = se deduce: IVA 0 % = exenta. Finanzas la marca
-- en «Revisar y emitir» mientras la factura está pendiente.
ALTER TABLE factura ADD COLUMN IF NOT EXISTS exenta_iva BOOLEAN;
COMMENT ON COLUMN factura.exenta_iva IS
  'Exportación para facturación: true = exenta de IVA (DTE 34), false = afecta (DTE 33), NULL = se deduce (IVA 0 % = exenta).';

-- --- 2 · Comuna del cliente (receptor del DTE) --------------------------------
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS comuna VARCHAR(80);
COMMENT ON COLUMN cliente.comuna IS 'Comuna del cliente: dato obligatorio del receptor en la factura electrónica.';

-- --- 3 · Datos del IDIC como emisor de la factura -----------------------------
-- Valores de EJEMPLO («PRUEBA»): el IDIC los reemplaza en Administración ›
-- Parámetros del sistema › «Emisor de la factura» (con motivo e historial).
-- El RUT de ejemplo 11.111.111-1 solo pasa el dígito verificador: no es del IDIC.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, 'emisor_facturacion', v.codigo, v.etiqueta, v.orden, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('rut',                 'RUT del emisor',                                  1, '11.111.111-1'),
  ('razon_social',        'Razón social',                                    2, 'PRUEBA · Razón social del emisor'),
  ('giro',                'Giro',                                            3, 'PRUEBA · Servicios de laboratorio de ensayo y control'),
  ('acteco',              'Código de actividad económica (Acteco)',          4, 'PRUEBA'),
  ('direccion',           'Dirección',                                       5, 'PRUEBA · Dirección del emisor'),
  ('comuna',              'Comuna',                                          6, 'PRUEBA'),
  ('ciudad',              'Ciudad',                                          7, 'PRUEBA'),
  ('codigo_sucursal_sii', 'Código de sucursal ante el SII (si corresponde)', 8, ''),
  ('correo',              'Correo de facturación',                           9, ''),
  ('telefono',            'Teléfono de facturación',                        10, '')
 ) AS v(codigo, etiqueta, orden, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
