-- =============================================================================
-- align_retiro_flujo_e2e.sql · Retira el flujo de prueba «FLUJO-E2E» · LIMS IDIC (Aiuken)
-- -----------------------------------------------------------------------------
-- IDEMPOTENTE. Va al FINAL de ORDEN_SQL.txt, en los dos modos (demo y sin-demo).
--
-- Unas pruebas antiguas del motor de flujos genérico dejaron en preproducción
-- una definición `flujo_def` con código FLUJO-E2E («Flujo E2E de prueba»). No la
-- siembra ningún SQL, pero aparecía en el selector «Iniciar flujo» de la OT.
-- El motor queda oculto de la interfaz (frente M, docs/FLUJO_LABORATORIO.md),
-- y esta definición se retira de los datos:
--
--   · SIN instancias (ninguna OT la llegó a usar) → se BORRA con sus versiones,
--     pasos, transiciones y variables.
--   · CON instancias → no se borra nada (las instancias y su historial son
--     trazabilidad de OT reales): sus versiones pasan a «archivado», dejan de
--     estar vigentes y la definición queda marcada como retirada en su nombre y
--     descripción.
--
-- En una base donde no existe (instalación nueva) no hace nada.
-- Tablas reales (schema.sql › MOTOR BPM): flujo_def, flujo_version
-- (flujo_def_id), flujo_paso, flujo_transicion, flujo_variable (flujo_version_id),
-- flujo_instancia (flujo_version_id).
-- =============================================================================

DO $$
DECLARE
  d RECORD;
  n_inst INT;
BEGIN
  IF to_regclass('public.flujo_def') IS NULL THEN
    RETURN;
  END IF;

  FOR d IN SELECT id, tenant_id FROM flujo_def WHERE codigo = 'FLUJO-E2E' LOOP
    SELECT count(*) INTO n_inst
      FROM flujo_instancia i
      JOIN flujo_version v ON v.id = i.flujo_version_id
     WHERE v.flujo_def_id = d.id;

    IF n_inst = 0 THEN
      -- Orden explícito: las transiciones apuntan a los pasos sin ON DELETE CASCADE.
      DELETE FROM flujo_transicion WHERE flujo_version_id IN (SELECT id FROM flujo_version WHERE flujo_def_id = d.id);
      DELETE FROM flujo_variable   WHERE flujo_version_id IN (SELECT id FROM flujo_version WHERE flujo_def_id = d.id);
      DELETE FROM flujo_paso       WHERE flujo_version_id IN (SELECT id FROM flujo_version WHERE flujo_def_id = d.id);
      DELETE FROM flujo_version    WHERE flujo_def_id = d.id;
      DELETE FROM flujo_def        WHERE id = d.id;
      RAISE NOTICE 'FLUJO-E2E (tenant %) borrado: no tenía instancias.', d.tenant_id;
    ELSE
      UPDATE flujo_version
         SET estado = 'archivado',
             vigente_hasta = COALESCE(vigente_hasta, now())
       WHERE flujo_def_id = d.id AND estado IS DISTINCT FROM 'archivado';
      UPDATE flujo_def
         SET nombre = left('[Retirado] ' || nombre, 200),
             descripcion = concat_ws(E'\n', descripcion,
               'Retirado (frente M, oct-2026): flujo de prueba antiguo. Se conserva por tener ' || n_inst || ' instancia(s).')
       WHERE id = d.id AND nombre NOT LIKE '[Retirado]%';
      RAISE NOTICE 'FLUJO-E2E (tenant %) retirado: % instancia(s) conservadas.', d.tenant_id, n_inst;
    END IF;
  END LOOP;
END $$;
