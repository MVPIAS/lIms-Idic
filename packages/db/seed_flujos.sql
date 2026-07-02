-- ============================================================================
-- SEED · MOTOR BPM: 12 flujos de OT por clasificación (Plantilla F) como datos
-- Idempotente por (tenant,codigo). Ejecutar tras schema.sql.
-- ============================================================================
BEGIN;

-- ---- FLU-COM · Proceso Comercial · Cotización a OT ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-COM') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-COM','Proceso Comercial · Cotización a OT','Comercial',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Solicitud de cotización',NULL) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Generación de cotización',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Revisión y firma (Jefe DCO)',720) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Remite cotización al cliente',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'ESPERA','Aceptación del cliente (OPI/OC)',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'AUTO','Generación de OT',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',7,'FIN','OT generada') RETURNING id INTO v_ok;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_ok);
END $$;

-- ---- FLU-QUI · Flujo OT · Químico / Explosivos ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-QUI') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-QUI','Flujo OT · Químico / Explosivos','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción de muestra',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Registro + cadena de custodia',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Preparación (digestión/dilución)',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Análisis instrumental',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'AUTO','Cálculo automático (fórmula)',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Control de calidad',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p7',7,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',8,'DECISION','¿Cumple especificación?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',9,'FIN','Informe de Ensayos') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',10,'FIN','Informe + No Conformidad') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-ALI · Flujo OT · Bromatológico / Alimentos ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-ALI') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-ALI','Flujo OT · Bromatológico / Alimentos','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción de muestra',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Registro + custodia',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Preparación de muestra',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Análisis (proximal/fisicoquímico)',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'AUTO','Cálculo automático',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',7,'DECISION','¿Cumple requisito?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',8,'FIN','Informe de Ensayos') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',9,'FIN','Informe + No Conformidad') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-ENE · Flujo OT · Materiales Energéticos ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-ENE') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-ENE','Flujo OT · Materiales Energéticos','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción del lote',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Registro + custodia',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Muestreo',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Ensayo (detonación/densidad/funcionamiento)',2880) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'AUTO','Cálculo',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',7,'DECISION','¿Lote conforme?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',8,'FIN','Certificado de Conformidad') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',9,'FIN','Informe de Incumplimiento') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-BAL · Flujo OT · Balística / Evidencias (SAEC) ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-BAL') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-BAL','Flujo OT · Balística / Evidencias (SAEC)','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción de evidencia/elemento',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Registro + custodia + código de barras',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Ensayo de disparo / captura en IBIS',2880) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'AUTO','Importación de resultados IBIS (FTP)',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'ACTIVIDAD','Almacén / ubicación de evidencia',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Aprobación (supervisor)',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',7,'DECISION','¿Lote/elemento aprobado?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',8,'FIN','Certificado con HASH') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',9,'FIN','Rechazo documentado') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-MEC · Flujo OT · Metalúrgico / Mecánicos ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-MEC') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-MEC','Flujo OT · Metalúrgico / Mecánicos','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción del ítem',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Acondicionamiento',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Control dimensional / ensayo',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Comparación con ficha técnica',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',6,'DECISION','¿Conforme?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',7,'FIN','IVC / Informe Técnico') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',8,'FIN','IVC con defecto mayor/menor') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-MET · Flujo OT · Metrología (calibración) ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-MET') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-MET','Flujo OT · Metrología (calibración)','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción del instrumento',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Verificación contra patrón',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Mediciones (planilla de registro)',960) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Planilla de incertidumbre',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'AUTO','Cálculo U expandida (k=2)',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Aprobación (jefe metrología)',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',7,'DECISION','¿Conforme a tolerancia?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',8,'FIN','Certificado de calibración') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',9,'FIN','Certificado con observaciones') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-CUE · Flujo OT · Cuero y Calzado ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-CUE') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-CUE','Flujo OT · Cuero y Calzado','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción de probeta',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Acondicionamiento climático',2880) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Corte de probetas',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Ensayo de tracción (dinamómetro)',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'AUTO','Cálculo área y alargamiento',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',7,'DECISION','¿Cumple NCh 624?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',8,'FIN','Informe de Ensayos') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',9,'FIN','Informe + No Conformidad') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-TEX · Flujo OT · Textil ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-TEX') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-TEX','Flujo OT · Textil','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción de muestra textil',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Acondicionamiento',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Ensayo (tracción/composición/solidez)',960) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'AUTO','Cálculo',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',6,'DECISION','¿Cumple especificación?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',7,'FIN','Informe de Ensayos') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',8,'FIN','Informe + No Conformidad') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-SEO · Flujo OT · Electrónica y Óptica ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-SEO') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-SEO','Flujo OT · Electrónica y Óptica','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción del equipo',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Inspección documental',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Pruebas funcionales (operacional)',960) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Mediciones (campo visión/divergencia)',960) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',6,'DECISION','¿Conforme?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',7,'FIN','Informe Técnico / IVC') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',8,'FIN','Informe + No Conformidad') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-SEN · Flujo OT · Evaluación Sensorial ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-SEN') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-SEN','Flujo OT · Evaluación Sensorial','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción de muestra',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Preparación muestras codificadas',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Sesión de panel (jueces)',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Tabulación de escalas',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'AUTO','Análisis estadístico',NULL) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Aprobación (jefe lab)',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',7,'DECISION','¿Dentro de rango?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',8,'FIN','Informe sensorial') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',9,'FIN','Informe + No Conformidad') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-MIC · Flujo OT · Microbiología ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-MIC') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-MIC','Flujo OT · Microbiología','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción de muestra',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Preparación de medios',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Siembra',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ESPERA','Incubación (temporizada)',2880) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'ACTIVIDAD','Recuento de colonias',240) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p6',6,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',7,'DECISION','¿Dentro de límite?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',8,'FIN','Informe microbiológico') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',9,'FIN','Informe + No Conformidad') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

-- ---- FLU-VEH · Flujo OT · Vehículos Militares ----
DO $$
DECLARE v_def UUID; v_ver UUID; v_prev UUID; v_paso UUID; v_dec UUID; v_ok UUID; v_nc UUID; v_ten UUID;
BEGIN
  SELECT id INTO v_ten FROM tenant WHERE codigo='IDIC';
  IF EXISTS (SELECT 1 FROM flujo_def WHERE tenant_id=v_ten AND codigo='FLU-VEH') THEN RETURN; END IF;
  INSERT INTO flujo_def (tenant_id,codigo,nombre,categoria,es_plantilla,descripcion)
    VALUES (v_ten,'FLU-VEH','Flujo OT · Vehículos Militares','Técnico',TRUE,'Plantilla inicial · generada desde la Ficha F') RETURNING id INTO v_def;
  INSERT INTO flujo_version (flujo_def_id,version,estado,vigente_desde)
    VALUES (v_def,'v1.0','publicado',now()) RETURNING id INTO v_ver;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p1',1,'INICIO','Recepción del vehículo',1440) RETURNING id INTO v_paso;
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p2',2,'ACTIVIDAD','Hoja de Control de Producto (HCP)',480) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p3',3,'ACTIVIDAD','Inspección y control',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p4',4,'ACTIVIDAD','Pruebas en ruta / banco',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad,sla_minutos)
    VALUES (v_ver,'p5',5,'ACTIVIDAD','Aprobación escalonada',1440) RETURNING id INTO v_paso;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_paso);
  v_prev := v_paso;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'dec',6,'DECISION','¿Conforme?') RETURNING id INTO v_dec;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id) VALUES (v_ver,v_prev,v_dec);
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_ok',7,'FIN','IVC vehicular / Informe Técnico') RETURNING id INTO v_ok;
  INSERT INTO flujo_paso (flujo_version_id,bpmn_element_id,numero,tipo,actividad)
    VALUES (v_ver,'fin_nc',8,'FIN','IVC con observaciones') RETURNING id INTO v_nc;
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_ok,'cumple == true','Sí',1);
  INSERT INTO flujo_transicion (flujo_version_id,origen_paso_id,destino_paso_id,condicion,etiqueta,orden)
    VALUES (v_ver,v_dec,v_nc,NULL,'No',2);
END $$;

COMMIT;
-- Verificación: SELECT d.codigo,d.nombre,count(p.id) pasos FROM flujo_def d JOIN flujo_version v ON v.flujo_def_id=d.id JOIN flujo_paso p ON p.flujo_version_id=v.id GROUP BY 1,2 ORDER BY 1;