-- =============================================================================
-- align_q1_labs.sql · Quinto envío IDIC (21-11-2026) · lote 1, laboratorios
--
-- 1 · Depto. Químico sin revisor (Checklist DQO): en los seis laboratorios del
--     departamento (SQU: LQC, LPN, LME · SAL: LQA, LMB, LES) la jefatura aprueba
--     directo lo capturado. El resto de los laboratorios sigue con revisión
--     obligatoria. Quien captura nunca aprueba su propio resultado.
--     Se hace UNA sola vez y queda en el historial de parámetros; si después el
--     administrador lo cambia desde la pantalla, este archivo no lo pisa.
-- 2 · Acreditación DAkkS del LNF (D-K-18357-01-00, DIN EN ISO/IEC 17025), que
--     imprime el certificado de calibración del IDIC.
--
-- Idempotente. Va antes de align_cierre_permisos.sql en ORDEN_SQL.txt.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION pg_temp.q1_primera_vez(p_codigo TEXT, p_descripcion TEXT)
RETURNS boolean AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion) VALUES (p_codigo, p_descripcion)
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- --- 1 · Depto. Químico sin revisor ------------------------------------------
DO $$
BEGIN
  IF pg_temp.q1_primera_vez('q1.dqo.sin_revisor', 'Depto. Químico aprueba sin revisión previa (quinto envío 21-11-2026)') THEN
    INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
    SELECT t.id, 'segregacion_resultado', v.codigo, v.etiqueta, 90, v.defecto
      FROM tenant t
     CROSS JOIN (VALUES
       ('revision', 'Revisión previa a la aprobación', 'obligatoria'),
       ('sin_revision_labs', 'Laboratorios que aprueban sin revisión', '')
     ) AS v(codigo, etiqueta, defecto)
    ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

    WITH nuevo(codigo, valor) AS (VALUES
           ('revision', 'opcional'),
           ('sin_revision_labs', 'LQC,LPN,LME,LQA,LMB,LES')),
         antes AS (
           SELECT p.id, p.tenant_id, p.codigo, p.valor AS anterior, n.valor AS nuevo
             FROM parametro_sistema p JOIN nuevo n ON n.codigo = p.codigo
            WHERE p.categoria = 'segregacion_resultado'
              AND p.valor IS DISTINCT FROM n.valor),
         upd AS (
           UPDATE parametro_sistema p SET valor = a.nuevo
             FROM antes a WHERE p.id = a.id
           RETURNING p.id)
    INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
    SELECT a.tenant_id, a.id, 'segregacion_resultado', a.codigo, a.anterior, a.nuevo,
           'Quinto envío IDIC 21-11-2026 (Checklist Depto. Químico): se quita el revisor; la jefatura aprueba lo capturado en LQC, LPN, LME, LQA, LMB y LES.', NULL
      FROM antes a;
  END IF;
END $$;

-- --- 2 · Acreditación DAkkS del LNF ------------------------------------------
INSERT INTO acreditacion (tenant_id, unidad_id, organismo, numero, norma, observacion)
SELECT u.tenant_id, u.id, 'DAkkS', 'D-K-18357-01-00', 'DIN EN ISO/IEC 17025',
       'Acreditación del Laboratorio Nacional de Fuerza que se cita en el certificado de calibración (LNF IT03).'
  FROM unidad u
 WHERE u.codigo = 'LNF'
ON CONFLICT DO NOTHING;

COMMIT;
