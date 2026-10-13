-- =============================================================================
-- LIMS IDIC · Alineación de `resultado` con el modelo Prisma · instalación SIN datos demo
-- =============================================================================
-- POR QUÉ EXISTE ESTE FICHERO
--
-- En packages/db, el script `seed_operacion_demo.sql` mezcla dos cosas que en
-- producción hay que separar:
--
--   a) SECCIÓN 1 · DDL: diez `ADD COLUMN` sobre `resultado` (ot_id, muestra_id,
--      replicas, promedio, desviacion, cv, veredicto, analista_id, fecha,
--      deleted_at) + dos índices. El modelo Prisma `Resultado` y los servicios
--      de apps/api/src/laboratorio esperan estas columnas: sin ellas la API
--      falla en tiempo de ejecución al capturar resultados.
--   b) SECCIONES 2+ · DATOS DEMO: 6 órdenes de trabajo, muestras y resultados
--      sintéticos, más clientes de ejemplo.
--
-- En preproducción se aplica el fichero entero y no pasa nada: son datos
-- sintéticos. En el IDIC, en cambio, la base arranca con datos REALES del
-- Ejército y NO puede contener OT ni resultados inventados: contaminarían la
-- trazabilidad del laboratorio y la analítica de Metabase.
--
-- Pero si el instalador se limitase a omitir `seed_operacion_demo.sql`, se
-- perdería también su DDL, que NINGÚN otro script aporta (se ha verificado
-- uno a uno: `align_resultado_estado.sql` añade estado/revisado_n1_*/aprobado_*/
-- resultado_final/formula_aplicada, y `align_resultado_equipo.sql` añade
-- equipo_id; ninguno añade las diez columnas de arriba).
--
-- Este fichero replica EXACTAMENTE la SECCIÓN 1 y nada más. Se aplica en
-- producción en la misma posición del orden en que se aplicaría el seed demo.
-- No se ha modificado `seed_operacion_demo.sql` para no alterar el entorno
-- cloud de preproducción, que está en verde y usa provision.sh.
--
-- ADITIVO E IDEMPOTENTE: solo ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS. No borra ni altera columnas existentes; se puede reejecutar.
--
-- MANTENIMIENTO: si algún día cambia la SECCIÓN 1 de seed_operacion_demo.sql,
-- hay que replicar el cambio aquí.
--
-- ORDEN: figura en packages/db/ORDEN_SQL.txt con la etiqueta `sin-demo`, en la
-- posición de seed_operacion_demo.sql (etiqueta `demo`). Se aplica uno u otro.
-- =============================================================================

BEGIN;

ALTER TABLE resultado ADD COLUMN IF NOT EXISTS ot_id       UUID REFERENCES orden_trabajo(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS muestra_id  UUID REFERENCES muestra(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS replicas    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS promedio    NUMERIC(18,6);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS desviacion  NUMERIC(18,6);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS cv          NUMERIC(8,2);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS veredicto   VARCHAR(20);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS analista_id UUID REFERENCES usuario(id);
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS fecha       TIMESTAMPTZ DEFAULT now();
ALTER TABLE resultado ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_resultado_muestra_id ON resultado(muestra_id);
CREATE INDEX IF NOT EXISTS idx_resultado_ot_id      ON resultado(ot_id);

COMMIT;
