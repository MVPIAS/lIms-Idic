-- =============================================================================
-- LIMS IDIC · Frente c2 · B-006 · Nombre de empresa ficticio en los datos de
-- demostración · Aiuken
-- =============================================================================
-- La plantilla de la HCP del VLCB (Parámetros de la operación › hcp_plantilla)
-- se sembró con el nombre de un contratista real en los requisitos 1.x. El
-- fichero align_r2a_formularios.sql ya siembra el nombre ficticio
-- «Contratista Prueba Aiuken S.A.», pero las bases ya desplegadas conservan el
-- texto antiguo porque aquella siembra es ON CONFLICT DO NOTHING.
--
-- Este fichero lo sustituye en cualquier columna de texto o JSON del esquema
-- public donde aparezca (plantilla, historial de parámetros, registros de la
-- HCP, documentos renderizados, bitácora de auditoría...). Se excluyen las
-- tablas protegidas por un disparador de inmutabilidad (movimientos de
-- custodia y auditoría SAEC), que nunca contienen la plantilla.
--
-- Idempotente: si el texto ya no aparece no actualiza nada. Va ANTES de
-- align_cierre_permisos.sql.
-- =============================================================================

DO $$
DECLARE
  c record;
  n bigint;
  patron constant text := 'salinas[[:space:]]+y[[:space:]]+fabres([[:space:]]+s\.?[[:space:]]*a\.?)?';
  nuevo  constant text := 'Contratista Prueba Aiuken S.A.';
BEGIN
  FOR c IN
    SELECT cl.relname AS tabla, a.attname AS columna, format_type(a.atttypid, a.atttypmod) AS tipo
      FROM pg_class cl
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE cl.relkind IN ('r', 'p')
       AND NOT cl.relispartition
       AND a.attgenerated = ''
       AND a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'jsonb'::regtype, 'json'::regtype)
       AND NOT EXISTS (
             SELECT 1 FROM pg_trigger tg
               JOIN pg_proc p ON p.oid = tg.tgfoid
              WHERE tg.tgrelid = cl.oid AND NOT tg.tgisinternal AND p.proname LIKE '%inmutable%')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = regexp_replace(%I::text, %L, %L, ''gi'')::%s WHERE %I::text ~* %L',
      c.tabla, c.columna, c.columna, patron, nuevo, c.tipo, c.columna, patron);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'B-006: % fila(s) corregidas en %.%', n, c.tabla, c.columna;
    END IF;
  END LOOP;
END $$;
