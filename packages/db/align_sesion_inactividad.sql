-- =============================================================================
-- Sesión · minutos de inactividad hasta el cierre (contrato §4.7.6).
-- Parámetros del sistema › «Sesión de los usuarios». La web los lee en
-- GET /auth/sesion-config al abrir cada pantalla (por defecto 20 minutos).
-- Idempotente: no pisa un valor ya configurado.
-- =============================================================================
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden)
SELECT t.id, 'sesion', 'inactividad_minutos', 'Minutos sin actividad hasta cerrar la sesión (2 a 480)', '20', 1
  FROM tenant t
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
