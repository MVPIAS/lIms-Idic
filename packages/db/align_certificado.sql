-- =============================================================================
-- LIMS IDIC · align_certificado.sql
-- Emisión REAL de informes/certificados (RF F01 «Generación de documentos» y
-- F02 «Numeración»). Cierra los huecos que la auditoría marca en §4.6 / §5.9:
--   · la plantilla no tenía CUERPO -> `plantilla_informe.cuerpo_html`
--   · el correlativo lo aportaba el llamador -> `certificado.numero` + contador
--     atómico por (tenant, año)
--   · no había anti-repudio -> `certificado.codigo_verificacion` + el HTML
--     canónico sellado (`documento_html`) sobre el que se calcula el hash
--
-- Se aplica DESPUÉS de schema.sql + align_schema_to_prisma.sql + align_final.sql
-- y DESPUÉS de seed_plantillas.sql (siembra cuerpos sobre las 114 plantillas ya
-- insertadas). Es 100% idempotente: solo ADD COLUMN IF NOT EXISTS (todas
-- nullable), CREATE TABLE/INDEX IF NOT EXISTS y UPDATE ... WHERE ... IS NULL.
-- No elimina ni renombra nada.
--
-- Ejecución:
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < packages/db/align_certificado.sql
--
-- NOTA DE DESPLIEGUE: este fichero NO está dado de alta en `provision.sh`
-- (fuera del dominio de edición de este cambio). Añádalo a la lista de scripts
-- justo después de `align_final.sql` al integrar.
-- =============================================================================


-- =============================================================================
-- 1. plantilla_informe · CUERPO de la plantilla
-- -----------------------------------------------------------------------------
-- Hasta ahora la tabla solo guardaba metadatos (repid, nombre, tipo, emision) y
-- `archivo_ref`, una ruta a un .doc que la API no sabe leer. El motor de
-- renderizado necesita el documento como HTML con placeholders {{campo}}.
-- =============================================================================

ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS cuerpo_html TEXT;

-- Columnas que el modelo Prisma PlantillaInforme declara y que el schema.sql
-- original no creó (se insertan por si la BD viva viene del schema.sql base).
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS version    VARCHAR(10) DEFAULT 'v1';
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;


-- =============================================================================
-- 2. certificado · correlativo, anti-repudio y documento sellado
-- -----------------------------------------------------------------------------
-- `numero`              correlativo generado por el SISTEMA: CERT-AAAA-NNNN.
--                       Se escribe TAMBIÉN en `codigo`, que ya tiene
--                       UNIQUE(tenant_id, codigo) -> ese constraint es el
--                       cierre duro de la unicidad (ver §3).
-- `codigo_verificacion` código corto imprimible (anti-repudio): permite validar
--                       un certificado en papel sin exponer datos del cliente.
-- `documento_html`      HTML CANÓNICO del documento emitido. Es el objeto sobre
--                       el que se calcula `hash_sha256`, de modo que la
--                       verificación es reproducible:
--                           sha256(documento_html) == hash_sha256
--                       Sin esto el hash no sería comprobable, porque los
--                       resultados de la OT pueden cambiar después de emitir y
--                       un re-render daría otro hash.
-- `emitido_por`         quién emitió (schema.sql ya lo trae; se repite por
--                       idempotencia para BDs derivadas de otros aligns).
-- =============================================================================

ALTER TABLE certificado ADD COLUMN IF NOT EXISTS numero              VARCHAR(30);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS codigo_verificacion VARCHAR(24);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS documento_html      TEXT;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS emitido_por         UUID;
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS plantilla_id        UUID;

-- `hash_sha256` es NOT NULL en schema.sql. La API siempre lo escribe, pero
-- relajarlo evita un 500 en filas históricas/migradas sin hash.
ALTER TABLE certificado ALTER COLUMN hash_sha256 DROP NOT NULL;

-- Backfill: las filas ya emitidas (antes de existir el correlativo) conservan su
-- `codigo` como `numero` para que /informes/:id/pdf y el listado no vean nulos.
UPDATE certificado SET numero = codigo WHERE numero IS NULL;

-- Unicidad del código de verificación por tenant. Parcial: la columna es
-- nullable y las filas históricas no lo tienen.
CREATE UNIQUE INDEX IF NOT EXISTS ux_certificado_codver
  ON certificado (tenant_id, codigo_verificacion)
  WHERE codigo_verificacion IS NOT NULL;

-- Unicidad del correlativo por tenant (refuerza UNIQUE(tenant_id, codigo)).
CREATE UNIQUE INDEX IF NOT EXISTS ux_certificado_numero
  ON certificado (tenant_id, numero)
  WHERE numero IS NOT NULL;

-- Búsqueda por código de verificación (endpoint público GET /informes/verificar/:codigo).
CREATE INDEX IF NOT EXISTS idx_certificado_codver ON certificado (codigo_verificacion);


-- =============================================================================
-- 3. Correlativo seguro ante concurrencia · certificado_correlativo
-- -----------------------------------------------------------------------------
-- El correlativo de OT/COT (`common/codigo.ts:generarCodigoOt`) es un
-- read-then-write sin bloqueo: dos peticiones simultáneas calculan el MISMO
-- número y la segunda muere con un 500 contra el UNIQUE (auditoría §5.15).
--
-- Aquí NO se repite ese patrón. Se usa un contador por (tenant, año) y se
-- incrementa con un UPSERT atómico:
--
--   INSERT INTO certificado_correlativo (tenant_id, anio, ultimo)
--   VALUES ($1, $2, 1)
--   ON CONFLICT (tenant_id, anio)
--   DO UPDATE SET ultimo = certificado_correlativo.ultimo + 1
--   RETURNING ultimo;
--
-- GARANTÍA: `INSERT ... ON CONFLICT DO UPDATE` es atómico en PostgreSQL. La
-- rama DO UPDATE toma un lock de fila exclusivo sobre la fila del contador; una
-- transacción concurrente sobre el mismo (tenant, anio) se BLOQUEA en ese lock
-- hasta el commit/rollback de la primera y entonces vuelve a leer la fila ya
-- incrementada. Es el mismo efecto que un SELECT ... FOR UPDATE pero sin la
-- ventana read-then-write, y además resuelve el caso "la fila aún no existe"
-- (que FOR UPDATE no puede bloquear). Por tanto dos emisiones simultáneas
-- obtienen NNNN distintos, nunca el mismo.
--
-- Se ejecuta dentro de la MISMA transacción que crea el certificado: si la
-- inserción falla, el rollback devuelve el contador (deja hueco solo si la
-- transacción aborta, nunca duplica).
--
-- Defensa en profundidad: UNIQUE(tenant_id, codigo) + ux_certificado_numero.
-- Aunque alguien inserte por fuera del contador, la BD rechaza el duplicado.
--
-- `ultimo` es INTEGER, no texto: no hay orden lexicográfico que se rompa al
-- pasar de 9999 (el bug del correlativo de OT). NNNN se rellena a 4 dígitos al
-- formatear, y a partir de 10000 simplemente crece a 5 dígitos.
-- =============================================================================

CREATE TABLE IF NOT EXISTS certificado_correlativo (
  tenant_id  UUID    NOT NULL REFERENCES tenant(id),
  anio       INTEGER NOT NULL,
  ultimo     INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, anio)
);

COMMENT ON TABLE certificado_correlativo IS
  'Contador atómico del correlativo de certificados por tenant y anio (CERT-AAAA-NNNN). Se incrementa con INSERT ... ON CONFLICT DO UPDATE RETURNING dentro de la transaccion de emision.';

-- Siembra el contador con el máximo ya emitido por tenant/año, para que al
-- aplicar este script sobre una BD con certificados previos la numeración
-- CONTINÚE en lugar de chocar contra el UNIQUE.
INSERT INTO certificado_correlativo (tenant_id, anio, ultimo)
SELECT c.tenant_id,
       EXTRACT(YEAR FROM COALESCE(c.fecha, now()))::INT AS anio,
       MAX(COALESCE(NULLIF(regexp_replace(c.numero, '^CERT-\d{4}-', ''), ''), '0')::INT)
FROM certificado c
WHERE c.numero ~ '^CERT-\d{4}-\d+$'
GROUP BY c.tenant_id, EXTRACT(YEAR FROM COALESCE(c.fecha, now()))::INT
ON CONFLICT (tenant_id, anio) DO NOTHING;


-- =============================================================================
-- 4. Cuerpos HTML por defecto (membrete institucional IDIC)
-- -----------------------------------------------------------------------------
-- Siembra un cuerpo por defecto para los tipos principales (CERTIFICADO,
-- I.ENSAYO, I.TECNICO). Solo rellena plantillas SIN cuerpo: nunca pisa uno ya
-- editado -> reejecutable.
--
-- Los tipos restantes (IVC, PLANILLA, BOLETIN, OTRO) se dejan a propósito sin
-- cuerpo: el motor cae a la plantilla por defecto en runtime y lo avisa en la
-- respuesta (`avisos[]`), que es la señal para que Operaciones cargue el
-- formato real desde 06_entregables_cliente/Plantillas_Informes/Formatos/.
--
-- Placeholders: {{ruta.punteada}} sobre el contexto del expediente,
-- {{tabla_resultados}} / {{tabla_muestras}} como bloques generados, y
-- {{#si ruta}}...{{/si}} como condicional.
--
-- ATENCIÓN: estos cuerpos son un ESPEJO de `plantilla-defecto.ts` en
-- apps/api/src/plantilla-render/ (fuente de verdad del fallback en runtime).
-- Si cambia uno, cambie el otro.
--
-- Se usa dollar-quoting ($cuerpo$) para no escapar comillas del HTML.
-- =============================================================================

-- ---------- CERTIFICADO ----------
UPDATE plantilla_informe SET cuerpo_html = $cuerpo$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejercito de Chile &middot; Laboratorio de Ensayo y Calibracion</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>CERTIFICADO DE ANALISIS</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emision</th><td>{{fecha}}</td></tr>
  <tr><th>Subdireccion</th><td>{{ot.subdireccionAsignada}}</td><th>N.o de muestras</th><td>{{n_muestras}}</td></tr>
</table>

{{#si ot.descripcionTrabajo}}
<h2>Trabajo solicitado</h2>
<p>{{ot.descripcionTrabajo}}</p>
{{/si}}

<h2>Resultados de los ensayos</h2>
{{tabla_resultados}}

<h2>Muestras analizadas</h2>
{{tabla_muestras}}

<p class="nota">Los resultados de este certificado se refieren exclusivamente a las muestras
sometidas a ensayo. Este documento no podra ser reproducido parcialmente sin la autorizacion
escrita del Instituto.</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Analista responsable</div>
  <div class="firma"><span class="linea"></span>Jefe de Laboratorio</div>
</div>
$cuerpo$
WHERE tipo = 'CERTIFICADO' AND cuerpo_html IS NULL;

-- ---------- I.ENSAYO ----------
UPDATE plantilla_informe SET cuerpo_html = $cuerpo$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejercito de Chile &middot; Laboratorio de Ensayo y Calibracion</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME DE ENSAYO</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emision</th><td>{{fecha}}</td></tr>
  <tr><th>Solicitante</th><td>{{ot.solicitante}}</td><th>Fecha de recepcion</th><td>{{ot.fechaRecepcion}}</td></tr>
  <tr><th>Subdireccion</th><td>{{ot.subdireccionAsignada}}</td><th>N.o de muestras</th><td>{{n_muestras}}</td></tr>
</table>

{{#si ot.descripcionTrabajo}}
<h2>Objeto del ensayo</h2>
<p>{{ot.descripcionTrabajo}}</p>
{{/si}}

<h2>Muestras sometidas a ensayo</h2>
{{tabla_muestras}}

<h2>Resultados</h2>
{{tabla_resultados}}

<p class="nota">Los resultados se refieren unicamente a las muestras ensayadas y a las
condiciones descritas. DE: desviacion estandar; CV: coeficiente de variacion.</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Analista responsable</div>
  <div class="firma"><span class="linea"></span>Jefe de Laboratorio</div>
</div>
$cuerpo$
WHERE tipo = 'I.ENSAYO' AND cuerpo_html IS NULL;

-- ---------- I.TECNICO ----------
UPDATE plantilla_informe SET cuerpo_html = $cuerpo$
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejercito de Chile &middot; Subdireccion Tecnica</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME TECNICO</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emision</th><td>{{fecha}}</td></tr>
  <tr><th>Tipo de trabajo</th><td>{{ot.tipoTrabajo}}</td><th>Subdireccion</th><td>{{ot.subdireccionAsignada}}</td></tr>
</table>

<h2>Antecedentes</h2>
{{#si ot.descripcionTrabajo}}<p>{{ot.descripcionTrabajo}}</p>{{/si}}
{{#no ot.descripcionTrabajo}}<p>Sin descripcion de trabajo registrada en la orden.</p>{{/no}}

<h2>Desarrollo y resultados</h2>
{{tabla_resultados}}

{{#si ot.notas}}
<h2>Observaciones</h2>
<p>{{ot.notas}}</p>
{{/si}}

<div class="firmas">
  <div class="firma"><span class="linea"></span>Profesional responsable</div>
  <div class="firma"><span class="linea"></span>Jefe de Departamento</div>
</div>
$cuerpo$
WHERE tipo = 'I.TECNICO' AND cuerpo_html IS NULL;


-- =============================================================================
-- 5. Verificación rápida (informativa)
-- =============================================================================
DO $$
DECLARE
  con_cuerpo INT;
  sin_cuerpo INT;
BEGIN
  SELECT count(*) INTO con_cuerpo FROM plantilla_informe WHERE cuerpo_html IS NOT NULL;
  SELECT count(*) INTO sin_cuerpo FROM plantilla_informe WHERE cuerpo_html IS NULL;
  RAISE NOTICE 'align_certificado: plantillas con cuerpo=% ; sin cuerpo (usaran el fallback y avisaran)=%',
    con_cuerpo, sin_cuerpo;
END $$;
