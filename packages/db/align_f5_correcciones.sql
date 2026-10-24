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

-- -----------------------------------------------------------------------------
-- 2 · Tarifas de horas hombre (HH), horas máquina (HM) y servicios primarios.
--   Las tablas existían (schema.sql, «tablas rescatadas»: COM.hrshombre,
--   COM.phh_hh, COM.hrsmaquina y COM.lps_primaria) pero sin pantalla. Se
--   mantienen en Tablas maestras › Tarifas (apps/api/src/tarifas) con el CRUD de
--   las demás maestras: listar, buscar, crear, editar y activar o desactivar,
--   sin borrado físico. Ningún cálculo las lee todavía: el costeo (FORM05) y la
--   ficha de costos usan sus propios valores (docs/COMERCIAL_RONDA2.md § 8).
--   · Lectura: permiso nuevo tarifa.ver (Comercial, Planificación, Finanzas,
--     Calidad y jefaturas; Dirección, Administración y Lector por la cascada de
--     align_cierre_permisos.sql, que reparte todo permiso *.ver).
--   · Escritura: catalogo.gestionar con alcance global (AlcanceCatalogoGuard).
-- -----------------------------------------------------------------------------
ALTER TABLE hora_hombre_catalogo           ADD COLUMN IF NOT EXISTS activo     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE hora_hombre_catalogo           ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE hora_hombre_catalogo           ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE hora_hombre_perfil             ADD COLUMN IF NOT EXISTS activo     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE hora_hombre_perfil             ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE hora_hombre_perfil             ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE hora_maquina_catalogo          ADD COLUMN IF NOT EXISTS activo     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE hora_maquina_catalogo          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE hora_maquina_catalogo          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lista_precio_servicio_primario ADD COLUMN IF NOT EXISTS activo     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE lista_precio_servicio_primario ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lista_precio_servicio_primario ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- HM: el código del equipo en el Sistema Comercial (EQ###). La tarifa se puede
-- cargar antes de que el equipo exista en «Equipos y calibración» (equipo_id).
ALTER TABLE hora_maquina_catalogo ADD COLUMN IF NOT EXISTS codigo VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hora_maquina_codigo_vigencia
  ON hora_maquina_catalogo (tenant_id, codigo, vigente_desde) WHERE codigo IS NOT NULL;

-- Un perfil (civil, militar) una sola vez por instalación.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hora_hombre_perfil
  ON hora_hombre_perfil (tenant_id, lower(perfil)) WHERE perfil IS NOT NULL;

-- Valores ≥ 0 y vigencia coherente (los CHECK son nuevos: las tablas estaban vacías;
-- NOT VALID por si una base ya tuviera filas cargadas a mano).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hh_valor') THEN
    ALTER TABLE hora_hombre_catalogo ADD CONSTRAINT ck_hh_valor
      CHECK (valor_hora_clp >= 0 AND (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hm_valor') THEN
    ALTER TABLE hora_maquina_catalogo ADD CONSTRAINT ck_hm_valor
      CHECK (valor_hora_clp >= 0 AND (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_lps_primaria_valor') THEN
    ALTER TABLE lista_precio_servicio_primario ADD CONSTRAINT ck_lps_primaria_valor
      CHECK ((precio_clp IS NULL OR precio_clp >= 0) AND (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hh_perfil_ajuste') THEN
    ALTER TABLE hora_hombre_perfil ADD CONSTRAINT ck_hh_perfil_ajuste
      CHECK (ajuste_pct IS NULL OR ajuste_pct BETWEEN -100 AND 1000) NOT VALID;
  END IF;
END $$;

COMMENT ON TABLE hora_hombre_catalogo IS 'Tarifa de la hora hombre por categoría (A–E), en CLP y con vigencia (COM.hrshombre). Tablas maestras › Tarifas HH.';
COMMENT ON TABLE hora_hombre_perfil IS 'Ajuste % de la hora hombre por perfil (civil, militar) (COM.phh_hh). Tablas maestras › Perfiles HH.';
COMMENT ON TABLE hora_maquina_catalogo IS 'Tarifa de la hora máquina por equipo (EQ###), en CLP y con vigencia (COM.hrsmaquina). Tablas maestras › Tarifas HM.';
COMMENT ON TABLE lista_precio_servicio_primario IS 'Precio de los servicios primarios por código y vigencia, en CLP (COM.lps_primaria). Tablas maestras › Servicios primarios.';

INSERT INTO permiso (codigo, modulo, accion, descripcion) VALUES
  ('tarifa.ver', 'tarifa', 'ver',
   'Ver las tarifas de horas hombre, horas máquina y servicios primarios (Tablas maestras › Tarifas). Se mantienen con catalogo.gestionar de alcance global.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('COMERCIAL'), ('PLANIFICACION'), ('FINANZAS'), ('CALIDAD'), ('JEFE_LAB'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON r.codigo = m.rol
  JOIN permiso p ON p.codigo = 'tarifa.ver'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3 · Medios de envío: una sola lista, «Parámetros del sistema › medio_envio».
--   El seguimiento (envío conjunto), la entrega de documentos, el envío de la
--   cotización y la entrega de Metrología tenían su propia lista en el código y
--   duplicaban este parámetro, que solo tenía correo, mano, courier y fax. Se dan
--   de alta los demás códigos que ya se guardan, para que todo lo guardado siga
--   siendo válido y tenga su texto. La API comprueba que el medio esté activo
--   (apps/api/src/common/medios-envio.ts).
-- -----------------------------------------------------------------------------
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, activo)
SELECT t.id, 'medio_envio', v.codigo, v.etiqueta, v.orden, TRUE
  FROM tenant t,
       (VALUES ('correo',         'Correo electrónico',        1),
               ('mano',           'Entrega en mano',           2),
               ('courier',        'Correo postal / courier',   3),
               ('oficio',         'Oficio',                    4),
               ('oficina_partes', 'Oficina de partes',         5),
               ('libro',          'Libro de entrega',          6),
               ('plataforma',     'Plataforma del cliente',    7),
               ('otro',           'Otro medio',                8)) AS v(codigo, etiqueta, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- ot_envio fijaba la lista con un CHECK: un medio dado de alta en Parámetros no
-- se podría registrar. La valida la API contra el parámetro. Las filas
-- guardadas no cambian.
ALTER TABLE ot_envio DROP CONSTRAINT IF EXISTS ck_ot_envio_medio;
