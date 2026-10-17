-- =============================================================================
-- align_informe_ensayo.sql · Informe de ensayo correcto, completo y de dos tipos
-- LIMS IDIC (Aiuken) · 17-10-2026
-- -----------------------------------------------------------------------------
-- ADITIVO e IDEMPOTENTE (se puede reaplicar sin error ni efectos dobles).
-- Reglas: docs/FLUJO_INFORME_ENSAYO.md.
--
-- 1. Retira los requisitos de agua de la NCh 409 Of.84 que trajo el catálogo
--    del LIMS anterior (el laboratorio pidió eliminarlos; no se migran). No se
--    borra nada: las especificaciones quedan con activo = false y registradas
--    en cat_especificacion_retirada (lote NCH409_OF84) para poder revertirlo.
--    Esos analitos quedan SIN requisito: el analista lo fija por OT
--    (especificación de la orden) hasta recibir la tabla NCh 409/1 vigente.
-- 2. Modalidad del documento (cumplimiento / solo resultados) y datos propios
--    del documento (conclusión libre, portada del IVC) en `certificado`.
-- 3. Formato del informe parametrizable por plantilla (`config_informe`).
-- 4. Estructura del informe: sección y componente de cada ensayo
--    (resultado_informe), para numerar 4.1 Materiales › 4.1.1 Tela base.
-- 5. Fotos de la OT / muestra / ensayo para el anexo fotográfico (ot_foto).
-- 6. Plantilla «Informe de ensayo Textil y Confección (PG09 Anexo 02-02)» y
--    formato por defecto de las plantillas IVC.
--
-- Permisos: no crea permisos nuevos. Usa resultado.crear / certificado.emitir
-- (fotos), certificado.emitir / resultado.aprobar (estructura) y
-- plantilla.gestionar (formato de la plantilla).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. NCh 409 Of.84: retiro reversible de los requisitos de agua
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cat_especificacion_retirada (
  especificacion_id UUID PRIMARY KEY REFERENCES cat_especificacion(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  lote              VARCHAR(40) NOT NULL,
  motivo            TEXT NOT NULL,
  -- Copia de lo retirado (para el informe y para revertir con conocimiento).
  metodo_codigo     VARCHAR(30),
  analito_nombre    VARCHAR(240),
  limite_inf        VARCHAR(120),
  nominal           VARCHAR(120),
  limite_sup        VARCHAR(120),
  unidad            VARCHAR(60),
  retirada_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cat_espec_retirada_lote ON cat_especificacion_retirada (lote);

-- Conjunto Of.84 (identificado contra el catálogo cargado por seed_catalogo_v2.sql):
--   · métodos del LQC con norma «Agua» (agua potable): 289 Amonio, 290 Arsénico,
--     291 Cadmio, 293 Cloruro, 294 Cobre, 295 Cromo, 296 Flúor, 297 Hierro,
--     298 Magnesio, 299 Manganeso, 300 Mercurio, 301 Plomo, 304 Cinc,
--     305 Residuos sólidos filtrables, 306 Selenio, 308 Nitrato, 309 Nitrito,
--     310 Sulfato y 2984 Cloro libre;
--   · 1127 Cianuro (máx. 0,20 mg/L CN, valor de la Of.84; el método no trae norma);
--   · 251 pH, la especificación 6,0 – 8,5 (la de agua de la Of.84; la otra
--     especificación del método, vacía, no se toca).
-- Solo especificaciones con algún valor (Mín / Nom / Máx).
INSERT INTO cat_especificacion_retirada
       (especificacion_id, tenant_id, lote, motivo, metodo_codigo, analito_nombre,
        limite_inf, nominal, limite_sup, unidad)
SELECT s.id, s.tenant_id, 'NCH409_OF84',
       'Requisito de agua potable de la NCh 409 Of.84 (versión anterior). El laboratorio pidió eliminarlo; el requisito se fija por OT hasta cargar la NCh 409/1 vigente.',
       m.codigo, a.nombre, s.limite_inf, s.nominal, s.limite_sup, s.unidad
  FROM cat_especificacion s
  JOIN cat_analito a ON a.id = s.analito_id
  JOIN cat_metodo  m ON m.id = a.metodo_id
 WHERE s.deleted_at IS NULL
   AND (NULLIF(TRIM(s.limite_inf), '') IS NOT NULL
        OR NULLIF(TRIM(s.nominal), '') IS NOT NULL
        OR NULLIF(TRIM(s.limite_sup), '') IS NOT NULL)
   AND (
         (m.norma = 'Agua' AND m.codigo IN ('289','290','291','293','294','295','296','297','298',
                                            '299','300','301','304','305','306','308','309','310','2984'))
      OR (m.codigo = '1127' AND a.nombre = 'Cianuro' AND TRIM(s.limite_sup) = '0.20')
      OR (m.codigo = '251'  AND a.nombre = 'pH' AND TRIM(s.limite_inf) = '6.0' AND TRIM(s.limite_sup) = '8.5')
       )
ON CONFLICT (especificacion_id) DO NOTHING;

UPDATE cat_especificacion s
   SET activo = FALSE
  FROM cat_especificacion_retirada r
 WHERE r.especificacion_id = s.id
   AND r.lote = 'NCH409_OF84'
   AND s.activo;

-- Para REVERTIR el retiro (no forma parte de la instalación):
--   UPDATE cat_especificacion s SET activo = TRUE
--     FROM cat_especificacion_retirada r
--    WHERE r.especificacion_id = s.id AND r.lote = 'NCH409_OF84';
--   DELETE FROM cat_especificacion_retirada WHERE lote = 'NCH409_OF84';
-- (Reaplicar este fichero después volvería a retirarlas.)
-- Los resultados ya generados conservan su copia de la especificación: no se tocan.

-- ---------------------------------------------------------------------------
-- 2. Modalidad y datos propios del documento
-- ---------------------------------------------------------------------------
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS modalidad     VARCHAR(20);
ALTER TABLE certificado ADD COLUMN IF NOT EXISTS datos_informe JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_certificado_modalidad') THEN
    ALTER TABLE certificado ADD CONSTRAINT ck_certificado_modalidad
      CHECK (modalidad IS NULL OR modalidad IN ('cumplimiento', 'solo_resultados'));
  END IF;
END $$;
COMMENT ON COLUMN certificado.modalidad IS
  'cumplimiento (con requisito y veredicto) | solo_resultados (sin requisito ni veredicto). NULL = documento anterior a esta versión.';
COMMENT ON COLUMN certificado.datos_informe IS
  'Datos propios del documento elegidos al emitir: conclusión libre, portada del IVC (propósito, contrato, proveedor…).';

-- ---------------------------------------------------------------------------
-- 3. Formato del informe por plantilla
-- ---------------------------------------------------------------------------
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS config_informe JSONB;
COMMENT ON COLUMN plantilla_informe.config_informe IS
  'Formato del informe (agrupación, numeración, columnas, referencias, anexo fotográfico, conclusión fija, portada). Ver apps/api/src/plantilla-render/config-informe.ts.';

-- ---------------------------------------------------------------------------
-- 4. Estructura del informe: sección y componente de cada ensayo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resultado_informe (
  resultado_id UUID PRIMARY KEY REFERENCES resultado(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  ot_id        UUID NOT NULL REFERENCES orden_trabajo(id),
  seccion      VARCHAR(120),
  componente   VARCHAR(160),
  orden        INTEGER,
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resultado_informe_ot ON resultado_informe (ot_id);

-- ---------------------------------------------------------------------------
-- 5. Fotos para el anexo fotográfico
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_foto (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  ot_id        UUID NOT NULL REFERENCES orden_trabajo(id),
  muestra_id   UUID REFERENCES muestra(id),
  resultado_id UUID REFERENCES resultado(id) ON DELETE SET NULL,
  nombre       VARCHAR(200),
  mime         VARCHAR(20) NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  bytes        INTEGER NOT NULL,
  datos        TEXT NOT NULL,           -- base64 (sin prefijo data:)
  hash_sha256  VARCHAR(64) NOT NULL,
  pie          VARCHAR(500),
  en_informe   BOOLEAN NOT NULL DEFAULT TRUE,
  orden        INTEGER NOT NULL DEFAULT 0,
  subida_por   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ot_foto_ot ON ot_foto (ot_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ot_foto_resultado ON ot_foto (resultado_id) WHERE resultado_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Formatos sembrados
-- ---------------------------------------------------------------------------
-- 6a. IVC (Textil, Vestuario y Equipo; Cecinas…): portada, secciones numeradas
--     desde el punto 4, referencias de No cumple, anexo fotográfico y conclusión.
UPDATE plantilla_informe
   SET config_informe = '{
     "agrupacion": "seccion", "numeracion": "4", "portada": "ivc",
     "referencias": true, "anexoFotografico": true,
     "conclusionFija": "Los registros y resultados de las pruebas se encuentran disponibles para consultas, los cuales se mantendrán archivados en el laboratorio por un período de 5 años.",
     "etiquetas": {"ensayo": "Característica", "metodo": "Método de verificación", "veredicto": "Grado de cumplimiento"}
   }'::jsonb
 WHERE tipo = 'IVC' AND config_informe IS NULL;

-- 6b. Informe de ensayo de Textil y Confección (IDIC-PG09 Anexo 02-02), por tenant.
INSERT INTO plantilla_informe (tenant_id, repid, nombre, tipo, emision, version, activo, cuerpo_html, config_informe)
SELECT t.id, 'PG09A2', 'Informe de ensayo Textil y Confección (PG09 Anexo 02-02)', 'I.ENSAYO', 'conjunto', 'rev05', TRUE,
$cuerpo$<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Departamento Químico</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>IDIC-PG09-Anexo02-02 &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME DE ENSAYOS N.º {{certificado.numero}}</h1>

<h2>1. Antecedentes</h2>
<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Atención</th><td>{{ot.solicitante}}</td><th>Orden de Trabajo</th><td>{{ot.codigo}}</td></tr>
  <tr><th>Dirección</th><td>{{cliente.direccion}}</td><th>Fecha O/T</th><td>{{ot.fechaRecepcion}}</td></tr>
  <tr><th>Fecha de recepción</th><td>{{ot.fechaRecepcion}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
</table>

<h2>2. Identificación de la muestra</h2>
{{tabla_muestras}}

<h2>3. Identificación de normas, métodos y/o especificaciones técnicas</h2>
{{#si ot.descripcionTrabajo}}<p>{{ot.descripcionTrabajo}}</p>{{/si}}
<p>Los métodos de cada ensayo se indican en la tabla de resultados.</p>

<h2>4. Resultados</h2>
{{tabla_resultados}}

{{referencias}}

{{anexo_fotografico}}

{{conclusion}}

<div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe de Laboratorio</div>
  <div class="firma"><span class="linea"></span>Jefe de Departamento</div>
</div>$cuerpo$,
'{
  "agrupacion": "seccion", "numeracion": "4", "portada": "ninguna",
  "referencias": true, "anexoFotografico": true,
  "conclusionFija": "Los registros y resultados de las pruebas se encuentran disponibles para consultas, los cuales se mantendrán archivados en el laboratorio por un período de 5 años.",
  "etiquetas": {"ensayo": "Ensayo", "metodo": "Método", "veredicto": "Condición"}
}'::jsonb
  FROM tenant t
 WHERE NOT EXISTS (SELECT 1 FROM plantilla_informe p WHERE p.tenant_id = t.id AND p.repid = 'PG09A2');
