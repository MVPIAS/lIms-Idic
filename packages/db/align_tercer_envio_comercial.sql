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
