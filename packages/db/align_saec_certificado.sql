-- ===========================================================================
-- RF-K07.1 · Documento del certificado SAEC
--
-- Aditivo e IDEMPOTENTE: se puede aplicar N veces sobre una base viva sin
-- efecto acumulado y sin tocar datos existentes. No borra ni reescribe nada.
--
--   psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f align_saec_certificado.sql
--
-- CONTEXTO
-- --------
-- `saec_certificado` (packages/db/saec.sql) registraba el certificado con su
-- código, su código de verificación y un HASH, pero NO guardaba el documento:
-- la columna `documento_id` quedó como gancho para un PDF externo que nunca se
-- rellenó. Sin documento almacenado, un certificado no se puede reimprimir ni
-- verificar de verdad: solo se podía comparar el hash contra... nada.
--
-- Este script añade `documento_html`, el CUERPO sellado del certificado, con la
-- misma semántica que `certificado.documento_html` de los informes:
--
--     hash_documento = sha256(documento_html)
--
-- y la verificación pública RECALCULA ese hash sobre lo guardado en vez de leer
-- la columna, de modo que también detecta una manipulación de `hash_documento`
-- directa en la base de datos.
--
-- SOBRE LOS CERTIFICADOS ANTERIORES
-- ---------------------------------
-- Antes de este cambio `hash_documento` era el sha256 de un snapshot JSON
-- (`contenido`), no de un documento. Se comprobó en la base de producción que
-- `saec_certificado` está VACÍA (0 filas), así que no hay ningún certificado
-- emitido con la semántica antigua y el cambio no reinterpreta nada existente.
-- Aun así, el endpoint de verificación trata `documento_html IS NULL` como
-- "emitido por una versión anterior: no se puede comprobar la integridad" en
-- lugar de darlo por válido — degradar a válido sin poder comprobarlo sería
-- exactamente el fallo que este módulo debe evitar.
-- ===========================================================================

-- Cuerpo HTML sellado del certificado. TEXT: el documento no tiene tope útil de
-- tamaño y PostgreSQL almacena TEXT fuera de línea (TOAST) automáticamente.
ALTER TABLE saec_certificado
  ADD COLUMN IF NOT EXISTS documento_html TEXT;

COMMENT ON COLUMN saec_certificado.documento_html IS
  'Cuerpo HTML sellado del certificado. hash_documento = sha256(documento_html). '
  'El PDF/A se regenera siempre desde aquí: NUNCA se re-renderiza a partir de la '
  'evidencia, para que el documento sea reproducible aunque el peritaje o la '
  'cadena de custodia cambien después de emitirlo.';

COMMENT ON COLUMN saec_certificado.documento_id IS
  'OBSOLETO. Gancho a un documento externo que nunca se usó: el certificado se '
  'renderiza y se sella en documento_html, y el PDF/A se genera al vuelo desde '
  'ahí. Se mantiene por compatibilidad; no lo escribe nadie.';

-- Los certificados se listan y se descargan por código de verificación desde la
-- pantalla pública. `ux_saec_cert_verificacion` (en saec.sql) ya cubre esa
-- búsqueda; aquí no hace falta índice nuevo.
