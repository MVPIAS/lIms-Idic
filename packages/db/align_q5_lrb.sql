-- =============================================================================
-- align_q5_lrb.sql · Respuestas del IDIC del 24-11-2026 (checklist, pestaña
-- «LRB») · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE: una pasada deja la misma base que dos. No pisa lo que
-- el IDIC ya cambió desde las pantallas. Va ANTES de align_cierre_permisos.sql.
-- No crea permisos.
--
--   1. LRB 3 · Tabla de amenazas: los chalecos pasan a la tabla oficial del LRB
--      (ficha LRB-PG01-P01-IT01, bloque 3, NIJ 0101.04: niveles I, II-A, II,
--      III-A, III y IV, trauma ≤ 44 mm). Cascos y probetas conservan los
--      valores de los informes reales: la tabla que llegó para ellos repite la
--      de chalecos y queda como consulta al IDIC. Solo si la tabla sigue como
--      la sembró align_r2a_formularios.sql y nadie la editó.
--   2. LRB 4 y 5 · La velocidad es requisito del ensayo, no resultado; se
--      informan V1 y V2 y ninguna manda: el parámetro lrb.velocidad_manda deja
--      de usarse y se desactiva.
--   3. LRB 9 · Matriz de firmas del Informe de Ensayo del LRB (registro de
--      firmas LRB-PG01-Anexo03 y flujograma LRB-PG01-Anexo01): elabora el
--      analista, aprueba y firma el Jefe LRB, oficializa el Jefe del
--      Departamento. El LRB no tiene revisor. Solo si el LRB no tiene ya su
--      propia regla.
--   4. LRB 10 · El laboratorio quiere firma electrónica: el CRB y el Informe de
--      Ensayo de Rechazo (documentos propios del LRB) exigen la FEA antes de la
--      entrega. Una sola vez por base; después se administra en Parámetros.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 1. Tabla de amenazas (chalecos NIJ 0101.04 oficial)
-- ---------------------------------------------------------------------------
WITH cambiados AS (
  UPDATE parametro_sistema p
     SET valor = $am$[{"clave":"NIJ0101-I-22LR","norma":"NIJ 0101.04","nivel":"I","elemento":"chaleco","municion":".22 LR LRN","masa_g":null,"v_min":320,"v_max":338,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-I-380","norma":"NIJ 0101.04","nivel":"I","elemento":"chaleco","municion":".380 ACP FMJ RN","masa_g":null,"v_min":313,"v_max":331,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-IIA-9MM","norma":"NIJ 0101.04","nivel":"II-A","elemento":"chaleco","municion":"9×19 mm FMJ","masa_g":null,"v_min":332,"v_max":350,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-IIA-40SW","norma":"NIJ 0101.04","nivel":"II-A","elemento":"chaleco","municion":".40 S&W FMJ","masa_g":null,"v_min":313,"v_max":331,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-II-9MM","norma":"NIJ 0101.04","nivel":"II","elemento":"chaleco","municion":"9×19 mm FMJ","masa_g":null,"v_min":358,"v_max":376,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-II-357","norma":"NIJ 0101.04","nivel":"II","elemento":"chaleco","municion":".357 Magnum JSP","masa_g":null,"v_min":427,"v_max":445,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-IIIA-9MM","norma":"NIJ 0101.04","nivel":"III-A","elemento":"chaleco","municion":"9×19 mm FMJ RN","masa_g":8.03,"v_min":427,"v_max":445,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-IIIA-44MAG","norma":"NIJ 0101.04","nivel":"III-A","elemento":"chaleco","municion":".44 Magnum SJHP","masa_g":15.6,"v_min":427,"v_max":445,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-III-762","norma":"NIJ 0101.04","nivel":"III","elemento":"chaleco","municion":"7,62×51 mm NATO FMJ (M80)","masa_g":null,"v_min":838,"v_max":856,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-IV-30AP","norma":"NIJ 0101.04","nivel":"IV","elemento":"chaleco","municion":".30 M2 AP","masa_g":null,"v_min":869,"v_max":887,"disparos":1,"trauma_max":44,"disparos_trauma":1,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0106-IIA-9MM","norma":"NIJ 0106.01","nivel":"II-A","elemento":"casco","municion":"9 mm FMJ","masa_g":8,"v_min":317,"v_max":347,"disparos":4,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración del casco ni de la placa testigo"},{"clave":"NIJ0106-IIA-357","norma":"NIJ 0106.01","nivel":"II-A","elemento":"casco","municion":".357 Magnum JSP","masa_g":10.2,"v_min":366,"v_max":396,"disparos":4,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración del casco ni de la placa testigo"},{"clave":"NIJ0108-IIIA","norma":"NIJ 0108.01","nivel":"IIIA","elemento":"probeta","municion":".44 Magnum","masa_g":15.55,"v_min":411,"v_max":441,"disparos":5,"trauma_max":null,"disparos_trauma":0,"testigo":false,"criterio":"Sin penetración"},{"clave":"NIJ0108-III","norma":"NIJ 0108.01","nivel":"III","elemento":"probeta","municion":"7,62×51 mm FMJ","masa_g":9.7,"v_min":823,"v_max":853,"disparos":5,"trauma_max":null,"disparos_trauma":0,"testigo":false,"criterio":"Sin penetración"},{"clave":"UL752-2","norma":"UL 752","nivel":"2","elemento":"probeta","municion":".357 Magnum","masa_g":10.2,"v_min":381,"v_max":419,"disparos":3,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración ni daño en el testigo"},{"clave":"UL752-3","norma":"UL 752","nivel":"3","elemento":"probeta","municion":".44 Magnum","masa_g":15.6,"v_min":411,"v_max":452,"disparos":3,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración ni daño en el testigo"},{"clave":"UL752-5","norma":"UL 752","nivel":"5","elemento":"probeta","municion":"7,62 mm FMJ","masa_g":9.7,"v_min":838,"v_max":922,"disparos":3,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración ni daño en el testigo"}]$am$, updated_at = now()
   WHERE p.categoria = 'lrb' AND p.codigo = 'amenazas'
     AND p.valor IS NOT NULL
     AND p.valor::jsonb = $old$[{"clave":"NIJ0101-IIIA-9MM","norma":"NIJ 0101.04","nivel":"IIIA","elemento":"chaleco","municion":"9×19 mm FMJ RN","masa_g":8.03,"v_min":427,"v_max":445,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0101-IIIA-44MAG","norma":"NIJ 0101.04","nivel":"IIIA","elemento":"chaleco","municion":".44 Magnum SJHP","masa_g":15.6,"v_min":427,"v_max":445,"disparos":6,"trauma_max":44,"disparos_trauma":3,"testigo":false,"criterio":"Sin penetración completa y trauma ≤ 44 mm"},{"clave":"NIJ0106-IIA-9MM","norma":"NIJ 0106.01","nivel":"II-A","elemento":"casco","municion":"9 mm FMJ","masa_g":8,"v_min":317,"v_max":347,"disparos":4,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración del casco ni de la placa testigo"},{"clave":"NIJ0106-IIA-357","norma":"NIJ 0106.01","nivel":"II-A","elemento":"casco","municion":".357 Magnum JSP","masa_g":10.2,"v_min":366,"v_max":396,"disparos":4,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración del casco ni de la placa testigo"},{"clave":"NIJ0108-IIIA","norma":"NIJ 0108.01","nivel":"IIIA","elemento":"probeta","municion":".44 Magnum","masa_g":15.55,"v_min":411,"v_max":441,"disparos":5,"trauma_max":null,"disparos_trauma":0,"testigo":false,"criterio":"Sin penetración"},{"clave":"NIJ0108-III","norma":"NIJ 0108.01","nivel":"III","elemento":"probeta","municion":"7,62×51 mm FMJ","masa_g":9.7,"v_min":823,"v_max":853,"disparos":5,"trauma_max":null,"disparos_trauma":0,"testigo":false,"criterio":"Sin penetración"},{"clave":"UL752-2","norma":"UL 752","nivel":"2","elemento":"probeta","municion":".357 Magnum","masa_g":10.2,"v_min":381,"v_max":419,"disparos":3,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración ni daño en el testigo"},{"clave":"UL752-3","norma":"UL 752","nivel":"3","elemento":"probeta","municion":".44 Magnum","masa_g":15.6,"v_min":411,"v_max":452,"disparos":3,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración ni daño en el testigo"},{"clave":"UL752-5","norma":"UL 752","nivel":"5","elemento":"probeta","municion":"7,62 mm FMJ","masa_g":9.7,"v_min":838,"v_max":922,"disparos":3,"trauma_max":null,"disparos_trauma":0,"testigo":true,"criterio":"Sin penetración ni daño en el testigo"}]$old$::jsonb
     AND NOT EXISTS (SELECT 1 FROM parametro_sistema_historial h WHERE h.parametro_id = p.id AND h.usuario_id IS NOT NULL)
  RETURNING p.id, p.tenant_id
)
INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
SELECT c.tenant_id, c.id, 'lrb', 'amenazas', 'Valores de los informes reales (9 filas)', 'Chalecos NIJ 0101.04 oficial (10 filas) + cascos y probetas sin cambio',
       'Respuesta IDIC 24-11-2026 (checklist LRB 3): tabla oficial de amenazas de chalecos, bloque 3 de la ficha LRB-PG01-P01-IT01.', NULL
  FROM cambiados c;

-- ---------------------------------------------------------------------------
-- 2. Velocidad: ninguna manda (V1 y V2 son requisito)
-- ---------------------------------------------------------------------------
WITH cambiados AS (
  UPDATE parametro_sistema p
     SET activo = FALSE, updated_at = now()
   WHERE p.categoria = 'lrb' AND p.codigo = 'velocidad_manda' AND p.activo
  RETURNING p.id, p.tenant_id, p.valor
)
INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
SELECT c.tenant_id, c.id, 'lrb', 'velocidad_manda', COALESCE(c.valor, '') || ' · activo', 'inactivo (ya no se usa)',
       'Respuesta IDIC 24-11-2026 (checklist LRB 4 y 5): la velocidad es requisito del ensayo; se informan V1 y V2 y ninguna manda.', NULL
  FROM cambiados c;

-- ---------------------------------------------------------------------------
-- 3. Matriz de firmas del Informe de Ensayo del LRB
-- ---------------------------------------------------------------------------
INSERT INTO flujo_firma (id, tenant_id, tipo_documento, unidad_id, orden, accion, rol_id,
                         nivel_unidad, unidad_destino_id, obligatorio, activo, descripcion)
SELECT gen_random_uuid(), t.id, 'INFORME_ENSAYO', u.id, f.orden, f.accion, r.id, f.nivel, NULL, TRUE, TRUE, f.descripcion
  FROM (VALUES
    (1, 'ELABORA',    'ANALISTA',   'MISMA',        'Elabora el analista del LRB (LRB-PG01-IT02)'),
    (2, 'FIRMA',      'JEFE_LAB',   'MISMA',        'Aprobación técnica y firma del Jefe LRB'),
    (3, 'OFICIALIZA', 'JEFE_DEPTO', 'DEPARTAMENTO', 'Aprobación de la documentación y despacho del Jefe del Departamento')
  ) AS f(orden, accion, rol, nivel, descripcion)
  JOIN tenant t ON t.codigo = 'IDIC'
  JOIN unidad u ON u.tenant_id = t.id AND u.codigo = 'LRB'
  JOIN rol r    ON r.tenant_id = t.id AND r.codigo = f.rol
 WHERE NOT EXISTS (SELECT 1 FROM flujo_firma x
                    WHERE x.tenant_id = t.id AND x.tipo_documento = 'INFORME_ENSAYO' AND x.unidad_id = u.id);

-- ---------------------------------------------------------------------------
-- 4. Firma electrónica en los documentos propios del LRB (una sola vez)
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion)
  VALUES ('q5.LRB-10', 'CRB e Informe de Rechazo del LRB exigen FEA (checklist LRB 10, 24-11-2026)')
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN; END IF;

  WITH cambiados AS (
    UPDATE parametro_sistema p
       SET valor = 'si', updated_at = now()
     WHERE p.categoria = 'fea' AND p.codigo IN ('certificado_resistencia_balistica', 'informe_rechazo')
       AND COALESCE(p.valor, 'no') <> 'si'
       AND NOT EXISTS (SELECT 1 FROM parametro_sistema_historial h WHERE h.parametro_id = p.id AND h.usuario_id IS NOT NULL)
    RETURNING p.id, p.tenant_id, p.codigo, p.valor
  )
  INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
  SELECT c.tenant_id, c.id, 'fea', c.codigo, 'no', 'si',
         'Respuesta IDIC 24-11-2026 (checklist LRB 10): el LRB quiere firma electrónica.', NULL
    FROM cambiados c;
END $$;
