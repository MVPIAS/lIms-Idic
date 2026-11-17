-- =============================================================================
-- align_tercer_envio_comercial.sql · Respuestas del IDIC, tercer envío (17-11-2026)
-- -----------------------------------------------------------------------------
-- Área Comercial y Finanzas (hoja 2) y punto (b) de contraseñas. Idempotente:
-- se puede correr dos veces. Va en ORDEN_SQL.txt ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- Ayudante de esta sesión (pg_temp: desaparece al terminar el script). Fija el
-- valor de un parámetro por decisión del IDIC y deja constancia en
-- parametro_sistema_historial. Si el parámetro no existe lo crea. Idempotente:
-- si ya tiene ese valor no hace nada.
CREATE OR REPLACE FUNCTION pg_temp.te_fijar_param(p_cat TEXT, p_cod TEXT, p_valor TEXT, p_etiqueta TEXT, p_ref TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
  SELECT t.id, p_cat, p_cod, p_etiqueta, p_valor, 90, TRUE FROM tenant t
  ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

  WITH cambiados AS (
    SELECT p.id, p.tenant_id, p.valor AS antes
      FROM parametro_sistema p
     WHERE p.categoria = p_cat AND p.codigo = p_cod
       AND btrim(coalesce(p.valor, '')) IS DISTINCT FROM p_valor
  ), upd AS (
    UPDATE parametro_sistema p SET valor = p_valor, activo = TRUE, updated_at = now()
      FROM cambiados c WHERE p.id = c.id
    RETURNING p.id
  )
  INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
  SELECT c.tenant_id, c.id, p_cat, p_cod, c.antes, p_valor,
         'Respuesta IDIC tercer envío 17-11-2026 (' || p_ref || ')', NULL
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
SELECT pg_temp.te_fijar_param('numeracion_cotizacion', 'inicio_anio',
       to_char(now() AT TIME ZONE 'America/Santiago', 'YYYY'),
       'Año del último número usado (con reinicio anual, «inicio» solo rige ese año)', 'COM-11')
 WHERE NOT EXISTS (SELECT 1 FROM parametro_sistema p WHERE p.categoria = 'numeracion_cotizacion' AND p.codigo = 'inicio_anio');
SELECT pg_temp.te_fijar_param('numeracion_cotizacion', 'reinicio', 'anual',
       'Reinicio del correlativo (global | anual)', 'COM-11');

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

ALTER TABLE cliente_desbloqueo ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id);
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

INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'cliente.desbloquear', 'cliente', 'desbloquear',
   'Autorizar la excepción o el desbloqueo de un cliente bloqueado (Jefe DCO o su subrogante), con motivo.')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r JOIN permiso p ON p.codigo = 'cliente.desbloquear'
 WHERE COALESCE(r.alias_de, r.codigo) IN ('JEFE_DEPTO')
ON CONFLICT DO NOTHING;

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
