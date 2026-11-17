-- =============================================================================
-- align_fx5_a.sql · Correcciones v4 (recorrido de manuales 12-11-2026), frente fx5-a
-- Parámetros, permisos y pantallas transversales. Idempotente: solo INSERT ...
-- ON CONFLICT DO NOTHING; no borra ni cambia valores ya configurados.
-- Se aplica antes de align_cierre_permisos.sql (ver ORDEN_SQL.txt).
-- =============================================================================

-- --- 1 · Parámetros de la operación que falten (F076) -------------------------
-- Toda instalación debe tener una fila por cada parámetro fijo definido en
-- apps/api/src/catalogo/parametro-configurable.ts (GRUPOS_CONFIG[].codigos), con
-- el valor que ya rige cuando la fila falta («porDefecto»): el comportamiento no
-- cambia y el primer cambio queda con motivo e historial. Faltaban, p. ej., en
-- preproducción segregacion_resultado.revision y .sin_revision_labs.
-- Las tablas (lrb.amenazas, rsa_criterios.tabla, sensorial.rangos,
-- bpch_lugar_inspeccion.tabla) no tienen valor por defecto: las siembran
-- align_r2a_formularios.sql y align_sesiones_s3.sql.
-- La prueba parametro-semilla-fx5a.spec.ts exige que esta lista siga completa.
INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
SELECT t.id, v.categoria, v.codigo, v.etiqueta, 90, v.valor
  FROM tenant t
 CROSS JOIN (VALUES
  ('numeracion_cotizacion', 'formato', 'Formato del número', '{AAAA}-{N}'),
  ('numeracion_cotizacion', 'digitos', 'Dígitos mínimos del correlativo', '5'),
  ('numeracion_cotizacion', 'reinicio', 'Reinicio del correlativo', 'global'),
  ('numeracion_cotizacion', 'inicio', 'Último número ya usado', '0'),
  ('circuito_cotizacion', 'vb_niveles', 'V°B° que exige la respuesta del laboratorio', 'lab_depto'),
  ('circuito_cotizacion', 'exigir_consulta_laboratorio', 'Exigir al menos una consulta al laboratorio antes de firmar', 'no'),
  ('circuito_cotizacion', 'exigir_firma_para_aceptar', 'Exigir la firma del Jefe DCO antes de registrar la aceptación', 'si'),
  ('circuito_cotizacion', 'cfa_pct', 'Costo indirecto (CI) sobre el costo directo', '20'),
  ('circuito_cotizacion', 'margen_particular_pct', 'Recargo del precio particular sobre el costo total', '30'),
  ('circuito_cotizacion', 'iva_pct', 'IVA sobre el neto', '19'),
  ('circuito_cotizacion', 'precio_ejercito', 'Precio de la lista que toma un cliente Ejército', 'ficha'),
  ('encuesta', 'excluir_origenes', 'Orígenes de OT que NO generan encuesta', 'OT_INTERNA,INTERLABORATORIO'),
  ('metrologia', 'cierre_exige_devolucion', 'El cierre exige registrar la devolución de cada instrumento', 'si'),
  ('metrologia_ficha', 'criterio_en', 'Criterio del error normalizado (informativo)', '<=1'),
  ('metrologia_ficha', 'patron_fuera_rango', 'Punto medido con un patrón fuera de su rango calibrado', 'bloquear'),
  ('metrologia_ficha', 'notificar_emision', 'Al emitir, enviar el certificado por correo al contacto de la OT', 'si'),
  ('metrologia_ficha', 'actualizar_equipo', 'Actualizar el equipo del laboratorio dueño (OT interna)', 'emitir'),
  ('metrologia_ficha', 'no_apto_exige_documento', 'El cierre de la OT (técnico y final) exige el informe técnico emitido o el servicio externo validado del ítem no calibrable', 'no'),
  ('numeracion_muestra', 'inicio', 'Primer Nº de muestra interno', '1'),
  ('retencion_muestra', 'testigo', 'Muestra testigo · tiempo en bodega antes de destruirla', '1'),
  ('retencion_muestra', 'contramuestra', 'Contramuestra · tiempo de retención', '12'),
  ('captura_equipo', 'obligatorio', 'Equipo obligatorio al capturar', 'metodo'),
  ('captura_ld', 'indeterminado', 'Veredicto de un «< LD» que no se puede decidir', 'pendiente'),
  ('resultados', 'advertencia_margen_pct', 'Margen de advertencia (% del intervalo Mín–Máx o del límite único)', '10'),
  ('resultados', 'reanalisis_automatico', 'Re-análisis automático al capturar', 'no_cumple'),
  ('resultados', 'advertencia_correo', 'Avisar por correo al laboratorio las advertencias y los re-análisis', 'si'),
  ('consumibles', 'descuento_automatico', 'Descontar el consumo del método al capturar', 'si'),
  ('consumibles', 'sin_stock', 'Si no hay stock vigente suficiente', 'avisar'),
  ('consumibles', 'bodega_consumo', 'Bodega de la que se descuenta el consumo de un ensayo', 'laboratorio_primero'),
  ('costo_real', 'semaforo_amarillo_pct', 'Amarillo desde esta desviación del costo real sobre el estimado', '10'),
  ('costo_real', 'semaforo_rojo_pct', 'Rojo desde esta desviación del costo real sobre el estimado', '20'),
  ('captura_reglas', 'modo', 'Regla de aceptación no cumplida', 'avisar'),
  ('qc', 'bloqueo', 'Sin el QC exigido aprobado', 'ejecucion'),
  ('metodo_version', 'motivo', 'Motivo al modificar un método', 'obligatorio'),
  ('segregacion_resultado', 'revisor_aprobador', 'Revisión y aprobación de un resultado', 'distintas'),
  ('segregacion_resultado', 'excepciones', 'Laboratorios donde la misma persona puede revisar y aprobar', ''),
  ('segregacion_resultado', 'revision', 'Revisión previa a la aprobación', 'obligatoria'),
  ('segregacion_resultado', 'sin_revision_labs', 'Laboratorios que aprueban sin revisión', ''),
  ('ot_plazo', 'defecto_dias', 'Plazo por defecto (OT directa, institucional y el resto)', '10'),
  ('ot_plazo', 'internacion_dias', 'Plazo de la OT de internación', '10'),
  ('ot_plazo', 'produccion_nacional_dias', 'Plazo de la OT de Producción Nacional', '10'),
  ('ot_plazo', 'prototipo_dias', 'Plazo de la OT de prototipo', '10'),
  ('ot_plazo', 'reinspeccion_dias', 'Plazo de la OT de reinspección', '10'),
  ('avisos', 'dias_por_vencer', 'Días antes del compromiso en que se avisa «por vencer»', '3'),
  ('avisos', 'revision_automatica', 'Revisar los plazos cada hora y avisar al laboratorio y al ejecutivo', 'si'),
  ('avisos', 'enviar_correo', 'Enviar también por correo los avisos', 'si'),
  ('avisos', 'no_cumple_al_cliente', 'Avisar al cliente por correo un resultado No cumple o Contaminado al aprobarlo', 'no'),
  ('avisos', 'documento_listo', 'Avisar a Comercial cuando un documento queda oficial', 'si'),
  ('sesion', 'inactividad_minutos', 'Minutos sin actividad hasta cerrar la sesión', '20'),
  ('menu', 'ocultos', 'Módulos que no se muestran en el menú', ''),
  ('respaldos', 'hora', 'Hora del respaldo diario (hora de Chile)', '2'),
  ('respaldos', 'retencion_diarios', 'Respaldos diarios que se conservan', '14'),
  ('respaldos', 'retencion_semanales', 'Respaldos semanales (del domingo) que se conservan', '8'),
  ('respaldos', 'horas_alerta', 'Horas sin un respaldo correcto para dar el estado en rojo y avisar', '26'),
  ('respaldos', 'avisar_fallo', 'Avisar a los administradores si un respaldo falla o se atrasa', 'si'),
  ('integracion', 'auditar_lecturas', 'Registrar también las consultas (GET) de las integraciones', 'si'),
  ('oficio_conductor', 'exige_tipos', 'Documentos que salen con oficio conductor', 'IVC,INFORME_TECNICO,INFORME_RECHAZO'),
  ('oficio_conductor', 'exige_departamentos', 'Departamentos donde rige', 'DSA'),
  ('aceptacion_oc', 'tolerancia', 'Diferencia que no se considera discrepancia', '0'),
  ('cotizacion_lrb', 'reposicion', 'Unidades de reposición que se suman al lote', '4'),
  ('aceptacion_comprobante', 'exige', 'Exigir el comprobante adjunto (salvo la disposición del Director)', 'si'),
  ('ot_disposicion', 'meses_opi', 'Meses para regularizar la OPI', '2'),
  ('cotizacion_vencidas', 'anular_dias', 'Días tras el vencimiento para anularla (0 = no se anula)', '0'),
  ('cliente_moroso', 'dias_gracia', 'Días de gracia tras el vencimiento de la factura', '0'),
  ('ot_institucional', 'exige_oficio', 'Exigir el Nº y la fecha del oficio', 'si'),
  ('tasa_informe', 'difusion', 'Destinatarios de la difusión', 'DIRECCION,SUBDIRECCION,BPCH,CONTRALORIA,DFZ'),
  ('muestreo_plan', 'nivel', 'Nivel de inspección', 'II'),
  ('muestreo_plan', 'aql_critico', 'AQL de los defectos críticos', 'ninguno'),
  ('muestreo_plan', 'aql_mayor', 'AQL de los defectos mayores', '2.5'),
  ('muestreo_plan', 'aql_menor', 'AQL de los defectos menores', '4'),
  ('veredicto_lote', 'regla_sin_plan', 'Clase sin Ac/Re en el plan', 'cualquier_nc'),
  ('lrb', 'velocidad_manda', 'Velocidad que se compara con la ventana', 'v1'),
  ('lrb', 'plazo_apelacion', 'Plazo de apelación del Informe de Rechazo', '5'),
  ('inspeccion_aql', 'nivel', 'Nivel de inspección', 'II'),
  ('inspeccion_aql', 'aql_inspeccion', 'AQL por defecto de una inspección del IVC', '2,5'),
  ('inspeccion_aql', 'aql_clase_a', 'AQL clase A (crítico)', '0'),
  ('inspeccion_aql', 'aql_clase_b', 'AQL clase B (mayor)', '2,5'),
  ('inspeccion_aql', 'aql_clase_c', 'AQL clase C (menor)', '6,5'),
  ('preparacion_trabajo', 'exige_aprobacion', 'Laboratorios cuya documentación se aprueba antes de ejecutar', 'LRB,SVM'),
  ('preparacion_trabajo', 'bloquea_captura', 'La captura espera la aprobación', 'si'),
  ('micro', 'lecturas_h', 'Lecturas programadas (horas desde el inicio de la incubación)', '24,48,72'),
  ('sensorial', 'alfa', 'Nivel de significancia α', '0,05'),
  ('sensorial', 'jueces_min', 'Jueces válidos mínimos', '6'),
  ('bpch_prototipo', 'exige_parametrizacion', 'La OT de evaluación exige la parametrización validada', 'no'),
  ('d11', 'metodos_registro', 'Ensayos al registrar el arma (clasificación)', '1292'),
  ('d11', 'metodos_cip', 'Ensayos del camino «Con cuño CIP · reconocimiento»', '1291,3500'),
  ('d11', 'metodos_completa', 'Ensayos del camino «Sin cuño CIP · prueba completa»', '1213,1202,1203,3500'),
  ('d11', 'metodos_accesorio', 'Ensayos de un accesorio (directo al certificado)', '2322'),
  ('d11', 'metodos_maquina', 'Ensayos de una máquina recargadora (directo al certificado)', '3706'),
  ('d11', 'metodos_fuego', 'Ensayos con fuego real (IT04) que gastan munición de prueba', '1203'),
  ('d11', 'acunacion_cip', 'Un arma con cuño CIP también se acuña con el cuño BPCH', 'no'),
  ('d11', 'vigencia_anios', 'Vigencia del certificado por arma', '4'),
  ('bpch_resolucion', 'vigencia_dias', 'Días de vigencia de la resolución', '180'),
  ('terreno', 'laboratorios', 'Laboratorios que trabajan en terreno', 'SVM,LAM,SEO')
 ) AS v(categoria, codigo, etiqueta, valor)
ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;

-- --- 2 · Avisos de oficios que ya no están pendientes (F091) ------------------
-- «Oficio … · V°B° pendiente» seguía en Mi bandeja con el oficio anulado. Desde
-- este frente, anular, devolver o firmar da por leídos esos avisos; aquí se
-- resuelven los que ya quedaron colgados (solo marca leido_at; no borra nada).
UPDATE aviso a
   SET leido_at = now()
  FROM oficio_firma f
 WHERE a.tipo = 'oficio_firma'
   AND a.leido_at IS NULL
   AND a.clave = 'oficio_firma:' || f.id::text
   AND f.estado <> 'pendiente';
