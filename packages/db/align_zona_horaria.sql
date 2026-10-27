-- =============================================================================
-- LIMS IDIC · Frente f8 · Zona horaria de la base (America/Santiago) · Aiuken
-- =============================================================================
-- El IDIC trabaja en hora de Chile. Pasadas las 21:00 (verano) o las 20:00
-- (invierno) en UTC ya es el día siguiente, y todo lo que en SQL corta el día
-- —`current_date`, `now()::date`, `x::date` y `date_trunc('day'|'month', x)`
-- sobre `timestamptz`, los DEFAULT CURRENT_DATE (fecha de emisión de la factura,
-- de la orden de compra, vigencias…)— depende de la zona de la SESIÓN.
--
-- Regla (docs/ZONA_HORARIA.md):
--   · los `timestamptz` se guardan en UTC (no se toca ningún dato);
--   · la API fija la zona de SU sesión con `options=-c TimeZone=<ZONA_HORARIA>`
--     en la conexión (apps/api/src/common/zona-entorno.ts);
--   · este fichero fija la zona POR DEFECTO de la base para el resto de las
--     sesiones (psql, semillas, respaldos, Metabase, informes externos), para que
--     no dependan de cómo se inicializó el servidor de Postgres.
--
-- Aditivo e idempotente: si la base ya tiene una zona propia (ALTER DATABASE …
-- SET timezone, p. ej. otra zona configurada a mano), se respeta; si no, se fija
-- America/Santiago. Sin privilegios para ALTER DATABASE solo avisa (no aborta la
-- instalación). Una pasada deja lo mismo que dos.
-- Aplica a las sesiones NUEVAS (las abiertas siguen con su zona).
-- =============================================================================

DO $$
DECLARE
  v_zona text;
BEGIN
  SELECT split_part(c, '=', 2)
    INTO v_zona
    FROM pg_db_role_setting s
    JOIN pg_database d ON d.oid = s.setdatabase
         CROSS JOIN LATERAL unnest(s.setconfig) AS c
   WHERE d.datname = current_database()
     AND s.setrole = 0
     AND lower(split_part(c, '=', 1)) = 'timezone'
   LIMIT 1;

  IF v_zona IS NOT NULL THEN
    RAISE NOTICE 'Zona horaria de la base %: ya configurada (%), se respeta.', current_database(), v_zona;
    RETURN;
  END IF;

  BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Santiago');
    RAISE NOTICE 'Zona horaria de la base %: America/Santiago.', current_database();
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sin privilegio para fijar la zona de la base %: la API la fija igualmente en su sesión (ZONA_HORARIA).', current_database();
  END;
END $$;
