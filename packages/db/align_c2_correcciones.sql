-- =============================================================================
-- LIMS IDIC · Frente c2 · Correcciones del recorrido de los manuales de
-- proceso (emisión, documentos, Metrología y SAEC) · Aiuken
-- =============================================================================
-- Backlog_Correcciones_Recorrido_Aiuken.xlsx, pestaña «Plan», frente 2.
--   B-003 · El oficio conductor tiene su propia serie: no repite el número de
--           un documento emitido (disparador de unicidad oficio ↔ documento).
--   B-022 · La plantilla guarda su tipo de documento («Automático» lo toma de ella).
--   B-026 · Cuerpo de la plantilla IVCOR según IDIC-PG09 Anexo 01.
--   B-075 · Membrete «Laboratorio Químico Central» en el informe del LQC.
--   B-029 · Entrega del certificado externo validado de Metrología.
-- Aditivo e idempotente. Va ANTES de align_cierre_permisos.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B-003 · Número del oficio distinto del de cualquier documento emitido
-- -----------------------------------------------------------------------------
-- Antes, el oficio de un laboratorio con una regla «todos los tipos» (LRB:
-- «IDIC DSA SAM LRB Nº J.{OT_N}/{AAAA}») tomaba el mismo número que el Informe
-- de Ensayo de Rechazo que conducía. La API ya elige la serie OFICIO; este
-- disparador lo garantiza también en la base.
CREATE OR REPLACE FUNCTION fn_oficio_numero_unico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NOT NULL AND EXISTS (
       SELECT 1 FROM certificado c
        WHERE c.tenant_id = NEW.tenant_id AND (c.numero = NEW.numero OR c.codigo = NEW.numero)) THEN
    RAISE EXCEPTION 'El número % ya lo tiene un documento emitido: el oficio lleva su propia serie (OFICIO).', NEW.numero
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_oficio_numero_unico ON oficio;
CREATE TRIGGER trg_oficio_numero_unico
  BEFORE INSERT OR UPDATE OF numero ON oficio
  FOR EACH ROW EXECUTE FUNCTION fn_oficio_numero_unico();

-- Oficios aún no firmados que quedaron con el número de un documento: se les
-- libera el número para que al reenviarlos a firma reciban el de su serie.
-- Los firmados o despachados no se tocan (son documentos oficiales).
UPDATE oficio o
   SET numero = NULL, updated_at = now()
 WHERE o.estado IN ('borrador', 'devuelto')
   AND o.numero IS NOT NULL
   AND EXISTS (SELECT 1 FROM certificado c
                WHERE c.tenant_id = o.tenant_id AND (c.numero = o.numero OR c.codigo = o.numero));

-- -----------------------------------------------------------------------------
-- B-022 · El tipo de documento lo define la plantilla
-- -----------------------------------------------------------------------------
-- «Automático» deducía el tipo del tipo genérico de la plantilla (SCCII es
-- «I.TECNICO» → Informe técnico, con firmas y numeración de otro documento).
-- Ahora la plantilla guarda su tipo de documento de la matriz y «Automático» lo
-- toma de ella. Se edita en Configuración del laboratorio › Plantillas de informe.
ALTER TABLE plantilla_informe ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(40);
COMMENT ON COLUMN plantilla_informe.tipo_documento IS
  'Tipo de documento de la matriz de firmas y de la numeración que emite la plantilla (INFORME_INSPECCION, CERTIFICADO_CONFORMIDAD...). NULL = se deduce del tipo de plantilla y de la unidad de la OT.';

-- Solo rellena las que aún no lo tienen: respeta lo que haya cambiado Calidad.
UPDATE plantilla_informe p
   SET tipo_documento = v.tipo
  FROM (VALUES
    ('SCCII',     NULL::text,                   'INFORME_INSPECCION'),
    ('ASTEC',     'SCC Informe de Inspección',  'INFORME_INSPECCION'),
    ('SCCCC',     NULL,                         'CERTIFICADO_CONFORMIDAD'),
    ('SCCDG',     NULL,                         'CERTIFICADO_CONFORMIDAD'),
    ('SCCIN',     NULL,                         'INFORME_INCUMPLIMIENTO'),
    ('SCCID',     NULL,                         'INFORME_INCUMPLIMIENTO'),
    ('CERTARMA',  NULL,                         'CERTIFICADO_ARMA'),
    ('LRB-CRB',   NULL,                         'CERTIFICADO_RESISTENCIA_BALISTICA'),
    ('LRB-RECH',  NULL,                         'INFORME_RECHAZO'),
    ('PROTO-APR', NULL,                         'CERTIFICADO_CONFORMIDAD'),
    ('PROTO-REC', NULL,                         'INFORME_INCUMPLIMIENTO')
  ) AS v(repid, nombre, tipo)
 WHERE p.repid = v.repid
   AND (v.nombre IS NULL OR p.nombre = v.nombre)
   AND p.tipo_documento IS NULL;

-- -----------------------------------------------------------------------------
-- B-026 · Cuerpo de la plantilla IVCOR (IDIC-PG09 Anexo 01)
-- -----------------------------------------------------------------------------
-- La plantilla «Informe de Verificación de Calidad» (IVCOR) no tenía cuerpo y se
-- emitía con el genérico del tipo IVC: membrete «Laboratorio de Ensayo y
-- Calibración», producto terminado tras la conclusión y firmas fijas. Se carga
-- la estructura del Anexo 01 (portada; I Antecedentes; II Material; III
-- Trabajos efectuados; IV Resultados; V Conclusión) con el membrete del
-- laboratorio de la OT. Las firmas las pone el circuito de la matriz (en la
-- vista previa y en el documento). Solo se carga si la plantilla sigue vacía:
-- lo que ya haya cargado Calidad no se pisa. Ajustable con las respuestas del IDIC.
UPDATE plantilla_informe
   SET cuerpo_html = $ivc$<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; {{departamento.nombre}} &middot; {{seccion.nombre}} &middot; {{unidad.nombre}}</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>IDIC-PG09-Anexo01 &middot; {{plantilla.version}}</span>
  </div>
</div>

<h1>INFORME DE VERIFICACIÓN DE CALIDAD</h1>
{{portada}}

<h2>Índice</h2>
<p>I. Antecedentes · II. Material · III. Trabajos efectuados · IV. Resultados · V. Conclusión</p>

<h2>I. Antecedentes</h2>
<table class="meta">
  <tr><th>Solicitante</th><td colspan="3">{{cliente.razonSocial}}</td></tr>
  <tr><th>Atención</th><td>{{ot.solicitante}}</td><th>O/T</th><td>{{ot.codigo}} · {{ot.fechaRecepcion}}</td></tr>
</table>
{{#si ot.descripcionTrabajo}}<p>{{ot.descripcionTrabajo}}</p>{{/si}}

<h2>II. Material</h2>
{{tabla_muestras}}
{{identificacion_muestras}}

<h2>III. Trabajos efectuados</h2>
<p>Plan de muestreo, normas, métodos y especificaciones técnicas aplicadas:</p>
{{tabla_metodos}}

<h2>IV. Resultados</h2>
{{tabla_resultados}}
{{#si aql.hay}}
<h3>Inspección por atributos (AQL)</h3>
{{tabla_aql}}
{{/si}}
{{producto_terminado}}
{{referencias}}
<p class="nota">La «Condición» es la correspondencia entre el «Requisito» y el «Resultado»: «Cumple» o «No cumple».</p>

<h2>V. Conclusión</h2>
{{conclusion_texto}}

{{anexo_fotografico}}

<div class="firmas">
  <div class="firma"><span class="linea"></span>Aprobación técnica · Jefe de Sección</div>
  <div class="firma"><span class="linea"></span>Oficialización · Jefe de Departamento</div>
</div>$ivc$
 WHERE repid = 'IVCOR'
   AND (cuerpo_html IS NULL OR btrim(cuerpo_html) = '');

-- -----------------------------------------------------------------------------
-- B-075 · Membrete del informe del LQC (IDIC-PG09 Anexo 02-02)
-- -----------------------------------------------------------------------------
-- El membrete decía «Laboratorio de Química (LQC)»; el nombre oficial es
-- «Laboratorio Químico Central». Solo cambia el texto antiguo (idempotente).
UPDATE plantilla_informe
   SET cuerpo_html = replace(cuerpo_html, 'Laboratorio de Química (LQC)', 'Laboratorio Químico Central')
 WHERE repid = 'PG09A2-LQC' AND cuerpo_html LIKE '%Laboratorio de Química (LQC)%';

-- -----------------------------------------------------------------------------
-- B-029 · Entrega del certificado externo validado (EP-04 §8.1)
-- -----------------------------------------------------------------------------
-- Cada ítem termina con su documento emitido y entregado: el certificado
-- externo validado se entrega al cliente igual que el informe técnico.
ALTER TABLE met_servicio_externo ADD COLUMN IF NOT EXISTS entregado_at         TIMESTAMPTZ;
ALTER TABLE met_servicio_externo ADD COLUMN IF NOT EXISTS entrega_medio        VARCHAR(30);
ALTER TABLE met_servicio_externo ADD COLUMN IF NOT EXISTS entrega_destinatario VARCHAR(160);
ALTER TABLE met_servicio_externo ADD COLUMN IF NOT EXISTS entrega_observacion  TEXT;
ALTER TABLE met_servicio_externo ADD COLUMN IF NOT EXISTS entregado_por        UUID REFERENCES usuario(id);
