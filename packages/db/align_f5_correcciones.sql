-- =============================================================================
-- LIMS IDIC · Frente f5 · Maestros y combos del Mapa de migración v2.1 · Aiuken
-- =============================================================================
-- Fallos que destapó la pestaña «Maestros y combos» de
-- 07_migracion/analisis_2026-10/Mapa_Migracion_v2.1_Aiuken.xlsx.
-- Aditivo e idempotente: una pasada deja lo mismo que dos. No borra filas ni
-- convierte datos guardados. Va ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Moneda: el LIMS trabaja solo en CLP y USD (pedido del IDIC).
--   · Regla de la API: apps/api/src/common/moneda.ts. Lista de las pantallas:
--     el parámetro «moneda» (parametro_sistema), que solo admite CLP y USD.
--   · Lo NUEVO se rechaza en la base con un disparador (no con un CHECK): el
--     CHECK, aunque sea NOT VALID, impide también ACTUALIZAR una fila vieja (p. ej.
--     desactivar una lista en UF). El disparador solo mira la moneda cuando se
--     inserta una fila o se CAMBIA su moneda; lo ya guardado en UF, EUR… sigue
--     tal cual, como histórico de solo lectura.
--   · La carga de datos históricos (ETL de migración) lo salta con
--       SET lims.migracion = 'on';
--   · factura no lleva el disparador: hereda la moneda de su cotización y no se
--     elige en ninguna pantalla.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lims_moneda_operacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.moneda IS NULL OR upper(NEW.moneda) IN ('CLP', 'USD') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.moneda IS NOT DISTINCT FROM OLD.moneda THEN
    RETURN NEW;  -- fila histórica que se actualiza en otra columna
  END IF;
  IF coalesce(current_setting('lims.migracion', true), '') = 'on' THEN
    RETURN NEW;  -- carga de datos históricos
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = 'check_violation',
    MESSAGE = format('%s: moneda %s no admitida. El LIMS trabaja solo en CLP y USD.', TG_TABLE_NAME, NEW.moneda);
END
$$;

COMMENT ON FUNCTION lims_moneda_operacion() IS
  'Frente f5: lo nuevo solo en CLP o USD; las filas históricas (UF, EUR…) se conservan. ETL histórico: SET lims.migracion = ''on''.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lista_precio', 'cotizacion', 'ot_encargo', 'oportunidad', 'orden_compra'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tg_moneda_operacion ON %I', t);
      EXECUTE format('CREATE TRIGGER tg_moneda_operacion BEFORE INSERT OR UPDATE OF moneda ON %I
                        FOR EACH ROW EXECUTE FUNCTION lims_moneda_operacion()', t);
    END IF;
  END LOOP;
END $$;

-- La cotización tenía la regla como CHECK NOT VALID (align_comercial_r2.sql): un
-- CHECK impide anular o tocar una cotización histórica en UF. La sustituye el
-- disparador. align_comercial_r2.sql lo vuelve a crear en cada pasada y este
-- bloque lo retira: el estado final es el mismo con una pasada o con dos.
ALTER TABLE cotizacion DROP CONSTRAINT IF EXISTS ck_cotizacion_moneda;

-- Alta de una lista de precios desde la pantalla: vigente_desde es obligatoria y
-- no tenía valor por defecto (el modelo Prisma lo da por hecho): el alta fallaba.
ALTER TABLE lista_precio ALTER COLUMN vigente_desde SET DEFAULT CURRENT_DATE;

-- El parámetro «moneda» (lista de las pantallas): CLP y USD activos; cualquier
-- otro código que se hubiera dado de alta queda inactivo (no se borra: puede
-- estar guardado y su texto se sigue mostrando).
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo)
SELECT t.id, 'moneda', v.codigo, v.etiqueta, v.orden, TRUE
  FROM tenant t,
       (VALUES ('CLP', 'Pesos chilenos (CLP)', 1), ('USD', 'Dólar (US$)', 2)) AS v(codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

UPDATE parametro_sistema SET activo = FALSE
 WHERE categoria = 'moneda' AND codigo NOT IN ('CLP', 'USD') AND activo IS NOT FALSE;
