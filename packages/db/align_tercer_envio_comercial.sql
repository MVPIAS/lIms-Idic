-- =============================================================================
-- align_tercer_envio_comercial.sql · Respuestas del IDIC, tercer envío (17-11-2026)
-- -----------------------------------------------------------------------------
-- Área Comercial y Finanzas (hoja 2) y punto (b) de contraseñas. Idempotente:
-- se puede correr dos veces. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- Marca «aplicado una vez» (auditoría 17-11-2026). Los pasos que fijan una
-- decisión del IDIC (parámetros, matriz de firmas, permisos) se aplican UNA sola
-- vez por base: si el IDIC los cambia después en Administración, volver a correr
-- el SQL (cada despliegue repite ORDEN_SQL.txt) no los pisa ni deja historial.
-- La usan también align_tercer_envio_bpch.sql y los align_* posteriores.
CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE sql_paso_aplicado IS
  'Pasos de datos de los align_*.sql que se aplican una sola vez (decisiones del IDIC que luego se administran desde la pantalla). Borrar la fila = volver a aplicarlo en el próximo despliegue.';

-- Ayudante de esta sesión (pg_temp): TRUE solo la primera vez que se pide el paso
-- (y lo deja marcado). Patrón: DO $$ BEGIN IF pg_temp.te_primera_vez(...) THEN … END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.te_primera_vez(p_codigo TEXT, p_descripcion TEXT)
RETURNS boolean AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion) VALUES (p_codigo, p_descripcion)
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- Ayudante de esta sesión (pg_temp: desaparece al terminar el script). Fija el
-- valor de un parámetro por decisión del IDIC y deja constancia en
-- parametro_sistema_historial. Si el parámetro no existe lo crea. Se llama solo
-- dentro de un paso te_primera_vez; además, si el historial ya registra esta
-- misma decisión (base donde el script corrió antes de existir la marca), no
-- vuelve a tocar el parámetro.
CREATE OR REPLACE FUNCTION pg_temp.te_fijar_param(p_cat TEXT, p_cod TEXT, p_valor TEXT, p_etiqueta TEXT, p_ref TEXT)
RETURNS void AS $$
DECLARE
  v_motivo TEXT := 'Respuesta IDIC tercer envío 17-11-2026 (' || p_ref || ')';
BEGIN
  INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
  SELECT t.id, p_cat, p_cod, p_etiqueta, p_valor, 90, TRUE FROM tenant t
  ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

  WITH cambiados AS (
    SELECT p.id, p.tenant_id, p.valor AS antes
      FROM parametro_sistema p
     WHERE p.categoria = p_cat AND p.codigo = p_cod
       AND btrim(coalesce(p.valor, '')) IS DISTINCT FROM p_valor
       AND NOT EXISTS (SELECT 1 FROM parametro_sistema_historial h
                        WHERE h.parametro_id = p.id AND h.motivo = v_motivo)
  ), upd AS (
    UPDATE parametro_sistema p SET valor = p_valor, activo = TRUE, updated_at = now()
      FROM cambiados c WHERE p.id = c.id
    RETURNING p.id
  )
  INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
  SELECT c.tenant_id, c.id, p_cat, p_cod, c.antes, p_valor, v_motivo, NULL
    FROM cambiados c JOIN upd u ON u.id = c.id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- COM-14 · COM-39 · La encuesta de satisfacción nace solo cuando la OT queda
-- CERRADA (cierre final, enviada; en paralelo con la facturación). Antes nacía
-- también al FINALIZAR (cierre técnico del laboratorio).
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_encuesta_al_cerrar_ot ON orden_trabajo;
CREATE TRIGGER trg_encuesta_al_cerrar_ot
  AFTER UPDATE OF estado ON orden_trabajo
  FOR EACH ROW
  WHEN (NEW.estado = 'cerrada' AND OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION fn_encuesta_al_cerrar_ot();

-- Encuestas que nacieron al finalizar y siguen pendientes sin registrar: se
-- retiran (volverán a nacer, solas, cuando la OT se cierre). No toca las ya
-- registradas ni las marcadas «sin respuesta».
DELETE FROM encuesta_satisfaccion e
 USING orden_trabajo o
 WHERE e.ot_id = o.id
   AND o.estado <> 'cerrada'
   AND e.estado = 'pendiente'
   AND e.respuestas IS NULL
   AND e.registrada_at IS NULL;

COMMENT ON COLUMN encuesta_satisfaccion.estado IS
  'pendiente (nace al CERRAR la OT, COM-14/COM-39) → registrada (Comercial anota las respuestas del cliente) · sin_respuesta (con motivo). Heredados sin uso: enviada, respondida, vencida, anulada.';

-- -----------------------------------------------------------------------------
-- COM-11 · Cotización = año vigente + correlativo que reinicia cada año.
-- El código ya corrige el defecto previo (numeracion-cotizacion.ts): «inicio»
-- solo rige en el año «inicio_anio»; los demás años parten en 1.
-- -----------------------------------------------------------------------------
-- Una sola vez por base (marca te1711.COM-11): si después el IDIC vuelve a
-- «global» o cambia «inicio_anio» en Parámetros, no se pisa.
DO $$
BEGIN
  IF pg_temp.te_primera_vez('te1711.COM-11', 'Cotización: reinicio anual del correlativo (COM-11)') THEN
    -- Para no repetir números del año en curso al pasar de «global» a «anual», la
    -- serie del año actual continúa desde donde iba el contador global.
    INSERT INTO cotizacion_correlativo (tenant_id, serie, ultimo)
    SELECT c.tenant_id, to_char(now() AT TIME ZONE 'America/Santiago', 'YYYY'), c.ultimo
      FROM cotizacion_correlativo c
      JOIN parametro_sistema p ON p.tenant_id = c.tenant_id AND p.categoria = 'numeracion_cotizacion'
                              AND p.codigo = 'reinicio' AND btrim(coalesce(p.valor, '')) <> 'anual'
     WHERE c.serie = 'global'
    ON CONFLICT (tenant_id, serie) DO UPDATE SET ultimo = GREATEST(cotizacion_correlativo.ultimo, EXCLUDED.ultimo), updated_at = now();

    -- «inicio» (último número del Sistema Comercial) sigue rigiendo en el año actual.
    IF EXISTS (SELECT 1 FROM parametro_sistema p WHERE p.categoria = 'numeracion_cotizacion' AND p.codigo = 'reinicio'
                  AND btrim(coalesce(p.valor, '')) <> 'anual') THEN
      PERFORM pg_temp.te_fijar_param('numeracion_cotizacion', 'inicio_anio',
              to_char(now() AT TIME ZONE 'America/Santiago', 'YYYY'),
              'Año del último número usado (con reinicio anual, «inicio» solo rige ese año)', 'COM-11');
    END IF;
    PERFORM pg_temp.te_fijar_param('numeracion_cotizacion', 'reinicio', 'anual',
            'Reinicio del correlativo (global | anual)', 'COM-11');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- COM-02 · Reabrir cotización (valor cotizado → valor finalmente trabajado).
-- La pide el Ejecutivo con motivo obligatorio; la autoriza el Jefe DCO o su
-- subrogante (permiso nuevo cotizacion.reabrir); se guarda cada versión y el
-- valor final pasa a la OT (que conserva su número) y a la factura pendiente.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizacion_reapertura (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID         NOT NULL REFERENCES tenant(id),
  cotizacion_id         UUID         NOT NULL REFERENCES cotizacion(id),
  version               INTEGER      NOT NULL CHECK (version >= 2),
  estado                VARCHAR(12)  NOT NULL DEFAULT 'solicitada'
                          CHECK (estado IN ('solicitada', 'autorizada', 'rechazada', 'cerrada')),
  motivo                TEXT         NOT NULL CHECK (length(btrim(motivo)) >= 10),
  solicitada_por        UUID REFERENCES usuario(id),
  solicitada_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  resuelta_por          UUID REFERENCES usuario(id),
  resuelta_at           TIMESTAMPTZ,
  comentario_resolucion TEXT,
  moneda                VARCHAR(3),
  total_anterior        NUMERIC(14, 2),
  version_anterior      JSONB,
  total_final           NUMERIC(14, 2),
  version_final         JSONB,
  cerrada_por           UUID REFERENCES usuario(id),
  cerrada_at            TIMESTAMPTZ,
  ot_codigo             VARCHAR(30),
  factura_numero        VARCHAR(30),
  UNIQUE (cotizacion_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_reapertura_viva
  ON cotizacion_reapertura (cotizacion_id) WHERE estado IN ('solicitada', 'autorizada');
CREATE INDEX IF NOT EXISTS idx_cotizacion_reapertura_estado ON cotizacion_reapertura (tenant_id, estado);
COMMENT ON TABLE cotizacion_reapertura IS
  'COM-02: reaperturas (versiones) de una cotización aceptada. solicitada (Ejecutivo, motivo) → autorizada | rechazada (Jefe DCO o subrogante) → cerrada (valor final a la OT y a la factura pendiente). version_anterior/version_final = líneas y totales.';

-- Valor final de la OT (el valor inicial es el total cotizado al aceptar).
ALTER TABLE ot_encargo ADD COLUMN IF NOT EXISTS valor_final        NUMERIC(14, 2);
ALTER TABLE ot_encargo ADD COLUMN IF NOT EXISTS valor_final_at     TIMESTAMPTZ;
ALTER TABLE ot_encargo ADD COLUMN IF NOT EXISTS valor_final_motivo VARCHAR(300);
COMMENT ON COLUMN ot_encargo.valor_final IS 'COM-02: valor finalmente trabajado (total de la cotización tras su reapertura autorizada por el Jefe DCO), en la moneda del encargo.';

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'cotizacion.reabrir', 'cotizacion', 'reabrir',
   'Autorizar o rechazar la reapertura de una cotización aceptada (Jefe DCO o su subrogante).')
ON CONFLICT (codigo) DO NOTHING;

-- Jefe de Departamento (el Jefe DCO; su subrogante recibe el mismo rol con vigencia).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r JOIN permiso p ON p.codigo = 'cotizacion.reabrir'
 WHERE COALESCE(r.alias_de, r.codigo) IN ('JEFE_DEPTO')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- COM-05 · Bloqueo por mora: 30 días aviso, 60 bloqueo, 90 alerta CDE. La
-- excepción la autoriza el Jefe DCO (o su subrogante) con motivo.
-- -----------------------------------------------------------------------------
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS bloqueo_origen VARCHAR(10);
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS bloqueado_at   TIMESTAMPTZ;
COMMENT ON COLUMN cliente.bloqueo_origen IS
  'COM-05: mora (automático por facturas vencidas; se levanta solo al pagar) | manual (ficha del cliente). NULL = sin bloqueo o anterior a COM-05.';
UPDATE cliente SET bloqueo_origen = 'manual' WHERE bloqueado AND bloqueo_origen IS NULL;

ALTER TABLE cliente_desbloqueo ADD COLUMN IF NOT EXISTS facturas  UUID[];
COMMENT ON COLUMN cliente_desbloqueo.facturas IS
  'COM-05: facturas vencidas que cubre la excepción del Jefe DCO (ya no bloquean al cliente; una factura distinta que llegue al tramo de bloqueo, sí).';

INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
SELECT t.id, 'mora_cliente', v.codigo, v.etiqueta, v.valor, v.orden, TRUE
  FROM tenant t
 CROSS JOIN (VALUES
   ('activo',       'Aplicar el bloqueo automático por mora (si | no)', 'si', 1),
   ('dias_aviso',   'Días de mora para avisar a Comercial y Finanzas', '30', 2),
   ('dias_bloqueo', 'Días de mora para bloquear al cliente (sin cotizaciones ni OT nuevas)', '60', 3),
   ('dias_cde',     'Días de mora para alertar «derivar al Consejo de Defensa del Estado»', '90', 4)
 ) AS v(codigo, etiqueta, valor, orden)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- La excepción / desbloqueo usa el permiso cliente.bloquear (align_sesiones_s1.sql,
-- Jefe de Departamento) y exige ser jefatura del DCO (cliente.service.ts).

-- -----------------------------------------------------------------------------
-- COM-38 · Ensayo con precio en USD en una cotización en pesos: se convierte con
-- el «dólar observado» del día de la cotización, ingresado a mano (el LIMS no
-- tiene internet). La línea guarda el precio en USD y el tipo de cambio usado.
-- -----------------------------------------------------------------------------
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS dolar_observado       NUMERIC(12, 4);
ALTER TABLE cotizacion ADD COLUMN IF NOT EXISTS dolar_observado_fecha DATE;
COMMENT ON COLUMN cotizacion.dolar_observado IS
  'COM-38: dólar observado (CLP por USD) del día de la cotización en pesos, ingresado a mano; convierte los ensayos con precio en USD.';
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS precio_usd  NUMERIC(14, 2);
ALTER TABLE linea_cotizacion ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(12, 4);
COMMENT ON COLUMN linea_cotizacion.precio_usd IS 'COM-38: precio en USD de la lista, convertido a pesos con tipo_cambio (dólar observado de la cotización).';

-- -----------------------------------------------------------------------------
-- COM-30 · Documento tributario «boleta» (asistencia técnica de la Delegación
-- Nº 11) además de la factura. Se elige al emitir; el folio es por tipo.
-- -----------------------------------------------------------------------------
ALTER TABLE factura ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(10) NOT NULL DEFAULT 'factura';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_factura_tipo_documento') THEN
    ALTER TABLE factura ADD CONSTRAINT ck_factura_tipo_documento CHECK (tipo_documento IN ('factura', 'boleta'));
  END IF;
END $$;
COMMENT ON COLUMN factura.tipo_documento IS 'COM-30: factura | boleta (asistencia técnica de la Delegación Nº 11). El folio (numero) es correlativo por tipo.';
-- El folio deja de ser único entre tipos: una boleta y una factura pueden tener
-- el mismo número. `codigo` replica a `numero` (fn_factura_codigo,
-- align_firma_cierre.sql) y su UNIQUE (tenant_id, codigo) pasa a ser por tipo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'factura_tenant_id_codigo_key' AND conrelid = 'factura'::regclass) THEN
    ALTER TABLE factura DROP CONSTRAINT factura_tenant_id_codigo_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'factura_tenant_id_numero_key' AND conrelid = 'factura'::regclass) THEN
    ALTER TABLE factura DROP CONSTRAINT factura_tenant_id_numero_key;
  END IF;
END $$;
DROP INDEX IF EXISTS factura_tenant_id_numero_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_factura_tipo_codigo ON factura (tenant_id, tipo_documento, codigo);

-- -----------------------------------------------------------------------------
-- COM-08 · Oficio conductor de la cotización: firmantes Jefe DCO, Jefe de
-- Laboratorio, Subdirector y Director (matriz OFICIO_COTIZACION; la API la
-- resuelve con el laboratorio del centro de costo de la cotización). El número
-- lo asigna Registratura y se ingresa a mano al generar (vacío = lo asigna el
-- LIMS, como antes). Los demás oficios siguen con la matriz OFICIO.
-- -----------------------------------------------------------------------------
-- Tipo nuevo en la restricción, conservando los que ya tenga (otros align_* la recrean).
DO $$
DECLARE
  tipos TEXT[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO tipos
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z0-9_]+)''', 'g') AS m
   WHERE c.conname = 'flujo_firma_tipo_documento_check' AND c.conrelid = 'flujo_firma'::regclass;
  IF tipos IS NOT NULL AND NOT ('OFICIO_COTIZACION' = ANY (tipos)) THEN
    tipos := array_append(tipos, 'OFICIO_COTIZACION'::text);
    ALTER TABLE flujo_firma DROP CONSTRAINT flujo_firma_tipo_documento_check;
    EXECUTE format('ALTER TABLE flujo_firma ADD CONSTRAINT flujo_firma_tipo_documento_check CHECK (tipo_documento IN (%s))',
                   (SELECT string_agg(quote_literal(x), ',') FROM unnest(tipos) x));
  END IF;
END $$;

-- Una sola vez (te1711.COM-08): un paso que el IDIC borre de la matriz no vuelve.
DO $$
BEGIN
  IF pg_temp.te_primera_vez('te1711.COM-08', 'Matriz OFICIO_COTIZACION sembrada (COM-08)') THEN
    INSERT INTO flujo_firma (id, tenant_id, tipo_documento, unidad_id, orden, accion, rol_id, nivel_unidad, unidad_destino_id, obligatorio, activo, descripcion)
    SELECT gen_random_uuid(), t.id, 'OFICIO_COTIZACION', NULL, v.orden, v.accion, r.id, v.nivel, NULL, TRUE, TRUE, v.descripcion
      FROM tenant t
     CROSS JOIN (VALUES
       (1, 'VB',    'JEFE_DEPTO',  'COMERCIAL', 'V°B° del Jefe del Departamento Comercial'),
       (2, 'VB',    'JEFE_LAB',    'MISMA',     'V°B° del Jefe del Laboratorio de la cotización'),
       (3, 'VB',    'SUBDIRECTOR', 'DIRECCION', 'V°B° del Subdirector'),
       (4, 'FIRMA', 'DIRECTOR',    'DIRECCION', 'Firma el Director')
     ) AS v(orden, accion, rol, nivel, descripcion)
      JOIN rol r ON r.tenant_id = t.id AND r.codigo = v.rol
     WHERE NOT EXISTS (SELECT 1 FROM flujo_firma x WHERE x.tenant_id = t.id AND x.tipo_documento = 'OFICIO_COTIZACION'
                          AND x.unidad_id IS NULL AND x.orden = v.orden);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- COM-32 · Matriz COTIZACION, paso 1 «Elabora»: el Ejecutivo de Ventas y la
-- Jefa de Ventas, en la Sección Ventas (SVT). Antes buscaba al ejecutivo en el
-- DCO con unidad exacta (firmas-resolver.ts) y el paso quedaba sin responsable,
-- porque los ejecutivos están asignados a la Sección Ventas. La Jefa de Ventas
-- es el responsable alternativo (Jefe de Sección en la misma unidad fija).
-- -----------------------------------------------------------------------------
-- Una sola vez (te1711.COM-32): un cambio posterior del paso en Administración ›
-- Matriz de firmas no se pisa.
DO $$
BEGIN
  IF pg_temp.te_primera_vez('te1711.COM-32', 'Matriz COTIZACION: paso Elabora en la Sección Ventas (COM-32)') THEN
    UPDATE flujo_firma f
       SET nivel_unidad = 'FIJA',
           unidad_destino_id = svt.id,
           rol_alternativo_id = js.id,
           nivel_unidad_alternativo = 'MISMA',
           alternativo_configurado_at = COALESCE(f.alternativo_configurado_at, now()),
           descripcion = 'Elabora el Ejecutivo de Ventas o la Jefa de Ventas (Sección Ventas)',
           updated_at = now()
      FROM unidad svt, rol js, rol rc
     WHERE f.tipo_documento = 'COTIZACION' AND f.orden = 1 AND f.accion = 'ELABORA' AND f.unidad_id IS NULL
       AND svt.tenant_id = f.tenant_id AND svt.codigo = 'SVT'
       AND js.tenant_id = f.tenant_id AND js.codigo = 'JEFE_SECCION'
       AND rc.id = f.rol_id AND COALESCE(rc.alias_de, rc.codigo) = 'COMERCIAL'
       AND (f.nivel_unidad IS DISTINCT FROM 'FIJA' OR f.unidad_destino_id IS DISTINCT FROM svt.id OR f.rol_alternativo_id IS DISTINCT FROM js.id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- COM-18 · No hay adquisiciones en el LIMS (solo ingreso y consumo): se quitan
-- compra.ver y compra.gestionar a los roles (solo los conserva SUPERADMIN) y se
-- desactiva la regla SOLICITUD_ADQUISICION. El módulo no se borra.
-- El maestro de PROVEEDORES sigue en uso (insumos, servicio externo de
-- Metrología): pasa a sus propios permisos proveedor.ver / proveedor.gestionar,
-- que reciben quienes tenían compra.* (antes de quitarlos), Administración y
-- Abastecimiento. align_cierre_permisos.sql reparte proveedor.ver como cualquier
-- *.ver y ya no reparte compra.*; align_admin_roles.sql y
-- align_correcciones_manuales.sql tampoco.
-- -----------------------------------------------------------------------------
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'proveedor.ver',       'proveedor', 'ver',       'Ver el maestro de proveedores'),
  (gen_random_uuid(), 'proveedor.gestionar', 'proveedor', 'gestionar', 'Crear y modificar proveedores del maestro')
ON CONFLICT (codigo) DO NOTHING;

-- Una sola vez (te1711.COM-18): si el IDIC vuelve a dar compra.* a un rol, o
-- reactiva SOLICITUD_ADQUISICION, no se pisa.
DO $$
BEGIN
  IF pg_temp.te_primera_vez('te1711.COM-18', 'Sin órdenes de compra: compra.* solo SUPERADMIN; proveedores con permiso propio (COM-18)') THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT DISTINCT rp.rol_id, pn.id
      FROM rol_permiso rp
      JOIN permiso pc ON pc.id = rp.permiso_id
      JOIN permiso pn ON pn.codigo = replace(pc.codigo, 'compra.', 'proveedor.')
     WHERE pc.codigo IN ('compra.ver', 'compra.gestionar')
    ON CONFLICT DO NOTHING;
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r.id, p.id
      FROM rol r JOIN permiso p ON p.codigo IN ('proveedor.ver', 'proveedor.gestionar')
     WHERE COALESCE(r.alias_de, r.codigo) IN ('ADMIN', 'ABASTECIMIENTO', 'SUPERADMIN')
    ON CONFLICT DO NOTHING;

    DELETE FROM rol_permiso rp
     USING permiso p, rol r
     WHERE rp.permiso_id = p.id AND rp.rol_id = r.id
       AND p.codigo IN ('compra.ver', 'compra.gestionar')
       AND COALESCE(r.alias_de, r.codigo) <> 'SUPERADMIN';
    UPDATE flujo_firma SET activo = FALSE, updated_at = now()
     WHERE tipo_documento = 'SOLICITUD_ADQUISICION' AND activo;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- COM-09 · V°B° de la cotización solo del Jefe de Laboratorio; es requisito para
-- emitir; el analista hace la estimación (permiso cotizacion.costear).
-- Una sola vez (te1711.COM-09).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF pg_temp.te_primera_vez('te1711.COM-09', 'Circuito de cotización: V°B° solo del Jefe de Laboratorio (COM-09)') THEN
    PERFORM pg_temp.te_fijar_param('circuito_cotizacion', 'vb_niveles', 'lab',
            'V°B° que exige la respuesta del laboratorio (lab_depto | lab | ninguno)', 'COM-09');
    PERFORM pg_temp.te_fijar_param('circuito_cotizacion', 'exigir_consulta_laboratorio', 'si',
            'Exigir al menos una consulta al laboratorio antes de firmar (si | no)', 'COM-09');
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r.id, p.id
      FROM rol r JOIN permiso p ON p.codigo = 'cotizacion.costear'
     WHERE COALESCE(r.alias_de, r.codigo) = 'ANALISTA'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- COM-16 · OT sin OPI: la dispone el Director y, eventualmente, el Jefe de
-- Departamento (la matriz OT_DISPOSICION ya admite a cualquiera de los dos).
-- -----------------------------------------------------------------------------
UPDATE parametro_sistema SET etiqueta = 'Disposición del Director o del Jefe de Departamento', updated_at = now()
 WHERE categoria = 'origen_trabajo' AND codigo = 'DISPOSICION'
   AND etiqueta IS DISTINCT FROM 'Disposición del Director o del Jefe de Departamento';
UPDATE parametro_sistema SET etiqueta = 'Disposición del Director o del Jefe de Departamento (sin OPI previa)', updated_at = now()
 WHERE categoria = 'aceptacion_tipo' AND codigo = 'DISPOSICION_DIRECTOR'
   AND etiqueta IS DISTINCT FROM 'Disposición del Director o del Jefe de Departamento (sin OPI previa)';

-- -----------------------------------------------------------------------------
-- COM-36 · Precio para las FF.AA. y de Orden: costo directo de la lista vigente.
-- (El IVA incluido por tipo de cliente no se cambia aquí: ver informe.)
-- -----------------------------------------------------------------------------
-- Una sola vez (te1711.COM-36).
DO $$
BEGIN
  IF pg_temp.te_primera_vez('te1711.COM-36', 'Precio Ejército: costo directo de la lista (COM-36)') THEN
    PERFORM pg_temp.te_fijar_param('circuito_cotizacion', 'precio_ejercito', 'costo_directo',
            'Precio de la lista que toma un cliente Ejército (ficha | costo_directo | costo_total | neto)', 'COM-36');
  END IF;
END $$;
UPDATE parametro_sistema SET etiqueta = 'Precio de la lista que toma un cliente Ejército (ficha | costo_directo | costo_total | neto)'
 WHERE categoria = 'circuito_cotizacion' AND codigo = 'precio_ejercito'
   AND etiqueta IS DISTINCT FROM 'Precio de la lista que toma un cliente Ejército (ficha | costo_directo | costo_total | neto)';
