-- ============================================================
-- ALIGN RBAC · corrección en caliente de rol_permiso · LIMS IDIC (Aiuken)
-- ------------------------------------------------------------
-- Propósito: garantizar que la BD viva contiene EXACTAMENTE la matriz RBAC
-- canónica (06_entregables_cliente/RBAC_Roles_Permisos_LIMS_IDIC_Aiuken.xlsx),
-- más la corrección ISO 17025 de coherencia aprobar/revisar en dirección.
--
-- Idempotente: solo INSERT ... SELECT con subselects por CÓDIGO y
-- ON CONFLICT DO NOTHING (PK = rol_permiso(rol_id, permiso_id)). No borra nada.
-- Se puede reaplicar sin efectos secundarios.
--
-- Tenant: mono-tenant IDIC. Los roles cuelgan de tenant.codigo='IDIC'.
--
-- Corrección clave (ISO/IEC 17025, separación de deberes):
--   DIRECTOR tenía resultado.aprobar pero NO resultado.revisar → podía aprobar
--   pero no devolver un resultado (incentivo perverso). Se añade resultado.revisar
--   a DIRECTOR. JEFE_LAB ya poseía ambos. resultado.aprobar queda reservado a
--   SUPERADMIN / DIRECTOR / JEFE_LAB (ADMIN es admin de sistema, no autoridad de lab).
--
-- Alcance: SOLO los 38 permisos "núcleo" de la matriz Excel. Los permisos de los
--   módulos posteriores (SAEC evidencia.*/arma.*/caso.*/ibis.*/peritaje.registrar/
--   saec.certificado.emitir y equipos) YA están sembrados por saec.sql y
--   equipos_custodia.sql; NO se tocan aquí para no duplicar ni divergir.
-- ============================================================

-- 0) Asegura que existen los 4 permisos "nuevos" que la matriz usa (idempotente).
INSERT INTO permiso (codigo, modulo, accion, descripcion) VALUES
  ('plantilla.ver','plantilla','ver','Ver repositorio de plantillas de informe'),
  ('plantilla.gestionar','plantilla','gestionar','Cargar/editar/versionar plantillas y asignarlas a flujos'),
  ('firma.registrar','firma','registrar','Registrar la imagen de firma propia'),
  ('catalogo.gestionar','catalogo','gestionar','Gestionar catálogo (grupos, familias, tipos de muestra, analitos)')
ON CONFLICT (codigo) DO NOTHING;

-- 1) Re-afirma la matriz rol_permiso completa (núcleo) para el tenant IDIC.
--    Cualquier fila que falte se inserta; las existentes se ignoran.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM (VALUES
  -- ---------- SUPERADMIN (todo el núcleo) ----------
  ('SUPERADMIN','admin.usuarios'),
  ('SUPERADMIN','audit.ver'),
  ('SUPERADMIN','catalogo.gestionar'),
  ('SUPERADMIN','certificado.emitir'),
  ('SUPERADMIN','certificado.firmar'),
  ('SUPERADMIN','cliente.crear'),
  ('SUPERADMIN','cliente.editar'),
  ('SUPERADMIN','cliente.ver'),
  ('SUPERADMIN','cotizacion.aprobar'),
  ('SUPERADMIN','cotizacion.crear'),
  ('SUPERADMIN','cotizacion.ver'),
  ('SUPERADMIN','equipo.gestionar'),
  ('SUPERADMIN','equipo.ver'),
  ('SUPERADMIN','factura.cobrar'),
  ('SUPERADMIN','factura.emitir'),
  ('SUPERADMIN','factura.ver'),
  ('SUPERADMIN','firma.registrar'),
  ('SUPERADMIN','flujo.editar'),
  ('SUPERADMIN','flujo.publicar'),
  ('SUPERADMIN','flujo.ver'),
  ('SUPERADMIN','metodo.aprobar'),
  ('SUPERADMIN','metodo.crear'),
  ('SUPERADMIN','metodo.ver'),
  ('SUPERADMIN','muestra.crear'),
  ('SUPERADMIN','muestra.transferir'),
  ('SUPERADMIN','muestra.ver'),
  ('SUPERADMIN','nc.gestionar'),
  ('SUPERADMIN','ot.cerrar'),
  ('SUPERADMIN','ot.crear'),
  ('SUPERADMIN','ot.ver'),
  ('SUPERADMIN','plantilla.gestionar'),
  ('SUPERADMIN','plantilla.ver'),
  ('SUPERADMIN','resultado.aprobar'),
  ('SUPERADMIN','resultado.crear'),
  ('SUPERADMIN','resultado.revisar'),
  ('SUPERADMIN','resultado.ver'),
  -- ---------- ADMIN (admin de sistema; sin autoridad de laboratorio) ----------
  ('ADMIN','admin.usuarios'),
  ('ADMIN','audit.ver'),
  ('ADMIN','catalogo.gestionar'),
  ('ADMIN','certificado.emitir'),
  ('ADMIN','cliente.crear'),
  ('ADMIN','cliente.editar'),
  ('ADMIN','cliente.ver'),
  ('ADMIN','cotizacion.aprobar'),
  ('ADMIN','cotizacion.crear'),
  ('ADMIN','cotizacion.ver'),
  ('ADMIN','equipo.gestionar'),
  ('ADMIN','equipo.ver'),
  ('ADMIN','factura.cobrar'),
  ('ADMIN','factura.emitir'),
  ('ADMIN','factura.ver'),
  ('ADMIN','firma.registrar'),
  ('ADMIN','flujo.editar'),
  ('ADMIN','flujo.publicar'),
  ('ADMIN','flujo.ver'),
  ('ADMIN','metodo.aprobar'),
  ('ADMIN','metodo.crear'),
  ('ADMIN','metodo.ver'),
  ('ADMIN','muestra.crear'),
  ('ADMIN','muestra.transferir'),
  ('ADMIN','muestra.ver'),
  ('ADMIN','nc.gestionar'),
  ('ADMIN','ot.cerrar'),
  ('ADMIN','ot.crear'),
  ('ADMIN','ot.ver'),
  ('ADMIN','plantilla.gestionar'),
  ('ADMIN','plantilla.ver'),
  ('ADMIN','resultado.crear'),
  ('ADMIN','resultado.revisar'),
  ('ADMIN','resultado.ver'),
  -- ---------- DIRECTOR (jefatura: aprueba y revisa) ----------
  ('DIRECTOR','audit.ver'),
  ('DIRECTOR','certificado.emitir'),
  ('DIRECTOR','certificado.firmar'),
  ('DIRECTOR','cliente.ver'),
  ('DIRECTOR','cotizacion.aprobar'),
  ('DIRECTOR','cotizacion.ver'),
  ('DIRECTOR','equipo.ver'),
  ('DIRECTOR','factura.ver'),
  ('DIRECTOR','firma.registrar'),
  ('DIRECTOR','flujo.ver'),
  ('DIRECTOR','metodo.aprobar'),
  ('DIRECTOR','metodo.ver'),
  ('DIRECTOR','muestra.ver'),
  ('DIRECTOR','nc.gestionar'),
  ('DIRECTOR','ot.cerrar'),
  ('DIRECTOR','ot.ver'),
  ('DIRECTOR','plantilla.ver'),
  ('DIRECTOR','resultado.aprobar'),
  ('DIRECTOR','resultado.revisar'),   -- <-- FIX ISO 17025 (faltaba en la BD viva)
  ('DIRECTOR','resultado.ver'),
  -- ---------- JEFE_LAB (jefatura de laboratorio: aprueba y revisa) ----------
  ('JEFE_LAB','audit.ver'),
  ('JEFE_LAB','catalogo.gestionar'),
  ('JEFE_LAB','certificado.emitir'),
  ('JEFE_LAB','certificado.firmar'),
  ('JEFE_LAB','equipo.gestionar'),
  ('JEFE_LAB','equipo.ver'),
  ('JEFE_LAB','firma.registrar'),
  ('JEFE_LAB','flujo.ver'),
  ('JEFE_LAB','metodo.aprobar'),
  ('JEFE_LAB','metodo.crear'),
  ('JEFE_LAB','metodo.ver'),
  ('JEFE_LAB','muestra.crear'),
  ('JEFE_LAB','muestra.transferir'),
  ('JEFE_LAB','muestra.ver'),
  ('JEFE_LAB','nc.gestionar'),
  ('JEFE_LAB','ot.ver'),
  ('JEFE_LAB','plantilla.ver'),
  ('JEFE_LAB','resultado.aprobar'),
  ('JEFE_LAB','resultado.revisar'),
  ('JEFE_LAB','resultado.ver'),
  -- ---------- ANALISTA_SR (crea y revisa; no aprueba) ----------
  ('ANALISTA_SR','equipo.ver'),
  ('ANALISTA_SR','firma.registrar'),
  ('ANALISTA_SR','metodo.ver'),
  ('ANALISTA_SR','muestra.ver'),
  ('ANALISTA_SR','ot.ver'),
  ('ANALISTA_SR','plantilla.ver'),
  ('ANALISTA_SR','resultado.crear'),
  ('ANALISTA_SR','resultado.revisar'),
  ('ANALISTA_SR','resultado.ver'),
  -- ---------- ANALISTA (crea resultados) ----------
  ('ANALISTA','equipo.ver'),
  ('ANALISTA','firma.registrar'),
  ('ANALISTA','metodo.ver'),
  ('ANALISTA','muestra.ver'),
  ('ANALISTA','ot.ver'),
  ('ANALISTA','resultado.crear'),
  ('ANALISTA','resultado.ver'),
  -- ---------- TECNICO (muestras) ----------
  ('TECNICO','equipo.ver'),
  ('TECNICO','muestra.crear'),
  ('TECNICO','muestra.transferir'),
  ('TECNICO','muestra.ver'),
  ('TECNICO','ot.ver'),
  ('TECNICO','resultado.ver'),
  -- ---------- RECEPCION (ingreso de muestras) ----------
  ('RECEPCION','cliente.ver'),
  ('RECEPCION','muestra.crear'),
  ('RECEPCION','muestra.transferir'),
  ('RECEPCION','muestra.ver'),
  ('RECEPCION','ot.ver'),
  -- ---------- COMERCIAL (clientes/cotizaciones/OT) ----------
  ('COMERCIAL','cliente.crear'),
  ('COMERCIAL','cliente.editar'),
  ('COMERCIAL','cliente.ver'),
  ('COMERCIAL','cotizacion.crear'),
  ('COMERCIAL','cotizacion.ver'),
  ('COMERCIAL','factura.ver'),
  ('COMERCIAL','ot.crear'),
  ('COMERCIAL','ot.ver'),
  ('COMERCIAL','plantilla.ver'),
  -- ---------- COBRANZA (facturación) ----------
  ('COBRANZA','cliente.ver'),
  ('COBRANZA','cotizacion.ver'),
  ('COBRANZA','factura.cobrar'),
  ('COBRANZA','factura.emitir'),
  ('COBRANZA','factura.ver'),
  ('COBRANZA','ot.ver'),
  -- ---------- CALIDAD (aseguramiento de calidad) ----------
  ('CALIDAD','audit.ver'),
  ('CALIDAD','catalogo.gestionar'),
  ('CALIDAD','equipo.ver'),
  ('CALIDAD','flujo.ver'),
  ('CALIDAD','metodo.aprobar'),
  ('CALIDAD','metodo.ver'),
  ('CALIDAD','muestra.ver'),
  ('CALIDAD','nc.gestionar'),
  ('CALIDAD','plantilla.gestionar'),
  ('CALIDAD','plantilla.ver'),
  ('CALIDAD','resultado.ver'),
  -- ---------- LECTOR (solo lectura) ----------
  ('LECTOR','audit.ver'),
  ('LECTOR','cliente.ver'),
  ('LECTOR','cotizacion.ver'),
  ('LECTOR','equipo.ver'),
  ('LECTOR','factura.ver'),
  ('LECTOR','flujo.ver'),
  ('LECTOR','metodo.ver'),
  ('LECTOR','muestra.ver'),
  ('LECTOR','ot.ver'),
  ('LECTOR','plantilla.ver'),
  ('LECTOR','resultado.ver'),
  -- ---------- CLIENTE (portal externo; deprecado en Excel, presente en BD) ----------
  ('CLIENTE','cotizacion.ver'),
  ('CLIENTE','ot.ver')
) AS m(rol_cod, perm_cod)
JOIN rol r     ON r.codigo = m.rol_cod
              AND r.tenant_id = (SELECT id FROM tenant WHERE codigo='IDIC')
JOIN permiso p ON p.codigo = m.perm_cod
ON CONFLICT DO NOTHING;

-- ============================================================
-- Verificación (ejecutar tras aplicar):
--   Ningún rol operativo debe quedar en 0 permisos:
--   SELECT r.codigo, count(*) FROM rol r
--     LEFT JOIN rol_permiso rp ON rp.rol_id=r.id GROUP BY 1 ORDER BY 1;
--
--   Coherencia dirección/jefatura (deben aparecer aprobar Y revisar):
--   SELECT r.codigo, p.codigo FROM rol r
--     JOIN rol_permiso rp ON rp.rol_id=r.id
--     JOIN permiso p ON p.id=rp.permiso_id
--    WHERE r.codigo IN ('DIRECTOR','JEFE_LAB')
--      AND p.codigo IN ('resultado.aprobar','resultado.revisar')
--    ORDER BY 1,2;
-- ============================================================
