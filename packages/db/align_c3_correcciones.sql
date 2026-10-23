-- =============================================================================
-- LIMS IDIC · Frente c3 · Correcciones del recorrido de los manuales de proceso
-- (comercial, facturación, formularios, captura y transversal) · Aiuken
-- =============================================================================
-- Cada bloque lleva el ID del backlog (Backlog_Correcciones_Recorrido_Aiuken.xlsx).
-- Aditivo e idempotente: una pasada deja lo mismo que dos. Va ANTES de
-- align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B-030 · Fechas
--   a) La preparación del LQA y del LMB registra fecha Y hora (EP-02 3.1).
--      Solo se cambia el campo que sigue con el tipo de fábrica («fecha»).
--   b) La fecha de ingreso de la OT elegida en un calendario se guardó como
--      medianoche UTC (= 21:00 del día anterior en Chile) y el certificado de
--      Metrología imprimía el día anterior. Se lleva a las 12:00 de Chile del
--      mismo día. Una vez corregida deja de ser medianoche UTC: idempotente.
-- -----------------------------------------------------------------------------
UPDATE parametro_sistema
   SET valor = jsonb_set(valor::jsonb, '{tipo}', '"fechahora"')::text
 WHERE categoria = 'preparacion_campo'
   AND codigo IN ('LQA.fecha', 'LMB.fecha')
   AND valor::jsonb->>'tipo' = 'fecha';

UPDATE orden_trabajo
   SET fecha_recepcion = (((fecha_recepcion AT TIME ZONE 'UTC')::date + time '12:00') AT TIME ZONE 'America/Santiago')
 WHERE fecha_recepcion IS NOT NULL
   AND fecha_recepcion = date_trunc('day', fecha_recepcion AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

-- -----------------------------------------------------------------------------
-- B-031 · Rótulos y unidades de las lecturas (campos C1..Cn de cada método).
--   El catálogo heredado traía por método varias plantillas de campos mezcladas
--   (p. ej. plomo: C1 «ppm», C2 «ppm», C3 «F»), así que el rótulo no coincidía
--   con la fórmula. Se deja un juego único y ordenado de campos por método; los
--   demás quedan inactivos (no se borran). EP-01 §5.
--   a) Absorción atómica, plantilla «ppm × F / (g × 100)»: los métodos cuyos
--      analitos usan TODOS esa fórmula (plomo 269 y otros 18).
--   b) Cloruro de sodio 243: V1 blanco, V2 muestra, N, masa y rendimiento.
--   c) Espesor 472: un solo campo «Espesor medido».
--   d) Viscosidad Stormer 659-663: unidad K.U. (no «grs»).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS c3_campos_metodo;
CREATE TEMP TABLE c3_campos_metodo (metodo_id uuid, tenant_id uuid, orden int, nombre text, unidad text);

-- a) plantilla ppm × F / (g × 100)
INSERT INTO c3_campos_metodo
SELECT m.id, m.tenant_id, v.orden, v.nombre, v.unidad
  FROM cat_metodo m
 CROSS JOIN (VALUES (1, 'Concentración dada por el equipo', 'ppm'),
                    (2, 'Factor de dilución (F)', NULL),
                    (3, 'Masa de muestra tomada', 'g')) AS v(orden, nombre, unidad)
 WHERE EXISTS (SELECT 1 FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL)
   AND NOT EXISTS (
         SELECT 1 FROM cat_analito a
          WHERE a.metodo_id = m.id AND a.deleted_at IS NULL
            AND regexp_replace(lower(coalesce(a.formula, '')), '\s', '', 'g')
                NOT LIKE '%acum:=acum+(val(ssql[1,2])*val(ssql[2,2]))/((val(ssql[3,2]))*100)%');

-- b) cloruro de sodio (volumetría con nitrato de plata)
INSERT INTO c3_campos_metodo
SELECT m.id, m.tenant_id, v.orden, v.nombre, v.unidad
  FROM cat_metodo m
 CROSS JOIN (VALUES (1, 'V1 · nitrato de plata gastado en el blanco', 'mL'),
                    (2, 'V2 · nitrato de plata gastado en la muestra', 'mL'),
                    (3, 'N · normalidad del nitrato de plata', 'N'),
                    (4, 'Masa de muestra', 'g'),
                    (5, 'Rendimiento (porciones)', NULL)) AS v(orden, nombre, unidad)
 WHERE m.codigo = '243';

-- c) espesor
INSERT INTO c3_campos_metodo
SELECT m.id, m.tenant_id, 1, 'Espesor medido', 'mm' FROM cat_metodo m WHERE m.codigo = '472';

-- d) viscosidad Stormer
INSERT INTO c3_campos_metodo
SELECT m.id, m.tenant_id, 1, 'Viscosidad Stormer', 'K.U.'
  FROM cat_metodo m WHERE m.codigo IN ('659', '660', '661', '662', '663');

-- Los demás campos de esos métodos quedan inactivos …
UPDATE paso_metodo p
   SET activo = false
 WHERE p.activo
   AND p.cat_metodo_id IN (SELECT metodo_id FROM c3_campos_metodo)
   AND NOT EXISTS (SELECT 1 FROM c3_campos_metodo c
                    WHERE c.metodo_id = p.cat_metodo_id AND c.orden = p.orden AND c.nombre = p.nombre);

-- … y el juego único queda activo, en orden y con su unidad.
INSERT INTO paso_metodo (tenant_id, cat_metodo_id, orden, nombre, tipo_dato, unidad, obligatorio, activo)
SELECT c.tenant_id, c.metodo_id, c.orden, c.nombre, 'numero', c.unidad, true, true
  FROM c3_campos_metodo c
ON CONFLICT (tenant_id, cat_metodo_id, orden, nombre)
DO UPDATE SET activo = true, unidad = EXCLUDED.unidad, deleted_at = NULL;

UPDATE cat_analito a
   SET unidad = 'K.U.'
  FROM cat_metodo m
 WHERE a.metodo_id = m.id AND m.codigo IN ('659', '660', '661', '662', '663')
   AND a.unidad IS DISTINCT FROM 'K.U.';

DROP TABLE IF EXISTS c3_campos_metodo;

-- -----------------------------------------------------------------------------
-- B-032 · «Decidir…» un veredicto (p. ej. un «< LD» frente a un máximo) exige
--   motivo; queda en la bitácora del resultado y el informe lo anota
--   (EP-02 3.5, §10.2).
-- -----------------------------------------------------------------------------
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS veredicto_motivo text;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS veredicto_decidido_por uuid;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS veredicto_decidido_at timestamptz;
COMMENT ON COLUMN resultado.veredicto_motivo IS 'Motivo del veredicto decidido a mano por el revisor (Decidir…); se anota en el informe.';

-- Si el veredicto cambia por otra vía (nueva captura, reapertura, recálculo),
-- la decisión manual deja de valer: se limpia para que el informe no la anote.
CREATE OR REPLACE FUNCTION fn_resultado_veredicto_decidido() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.veredicto IS DISTINCT FROM OLD.veredicto
     AND COALESCE(NULLIF(current_setting('lims.origen', true), ''), 'sistema') <> 'veredicto_manual' THEN
    NEW.veredicto_motivo := NULL;
    NEW.veredicto_decidido_por := NULL;
    NEW.veredicto_decidido_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resultado_veredicto_decidido ON resultado;
CREATE TRIGGER trg_resultado_veredicto_decidido
  BEFORE UPDATE OF veredicto ON resultado
  FOR EACH ROW EXECUTE FUNCTION fn_resultado_veredicto_decidido();

-- -----------------------------------------------------------------------------
-- B-038 · Contacto principal de la ficha del cliente → Contactos.
--   Los clientes con «Contacto principal» en la ficha y sin un contacto de ese
--   nombre lo reciben en Contactos, como principal si el cliente no tenía otro.
--   NOT EXISTS: idempotente.
-- -----------------------------------------------------------------------------
INSERT INTO contacto (cliente_id, nombre, cargo, email, telefono, principal, es_principal, activo)
SELECT cl.id, LEFT(trim(cl.contacto_nombre), 160), NULLIF(cl.contacto_cargo, ''), NULLIF(cl.contacto_email, '')::citext,
       NULLIF(cl.contacto_telefono, ''), pr.sin_principal, pr.sin_principal, true
  FROM cliente cl
 CROSS JOIN LATERAL (
       SELECT NOT EXISTS (SELECT 1 FROM contacto x WHERE x.cliente_id = cl.id AND x.deleted_at IS NULL
                           AND (COALESCE(x.principal, false) OR COALESCE(x.es_principal, false))) AS sin_principal) pr
 WHERE cl.deleted_at IS NULL
   AND COALESCE(trim(cl.contacto_nombre), '') <> ''
   AND NOT EXISTS (SELECT 1 FROM contacto x
                    WHERE x.cliente_id = cl.id AND x.deleted_at IS NULL
                      AND lower(trim(x.nombre)) = lower(trim(cl.contacto_nombre)));
