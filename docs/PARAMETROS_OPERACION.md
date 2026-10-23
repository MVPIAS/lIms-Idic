# Parámetros de la operación · qué se edita y dónde · LIMS IDIC

Reglas de la entrega R1 que el IDIC puede ajustar sin intervención técnica. Antes
solo se veían la etiqueta, el orden y «Activo» de cada fila de `parametro_sistema`;
el VALOR no se veía ni se editaba (salvo los porcentajes de la tasa de internación,
frente K). Ahora el valor se ve y se cambia con un formulario según su tipo, con
motivo obligatorio e historial.

## Dónde

**Administración › Parámetros del sistema** (`/catalogo/parametros`), recuadro
**«Parámetros de la operación»** (debajo de la tabla de combos y encima de
«Porcentajes de la tasa de internación»).

- Cada grupo dice **dónde rige** y, si el valor es por defecto a la espera del
  IDIC, lleva la marca «Por confirmar» con la pregunta abierta.
- Columna «Valor vigente» en texto legible (Sí/No, 12 %, 12 meses, la opción elegida…).
- Botón **«Cambiar»** en cada fila → formulario con un campo según el tipo y el
  **motivo** (mínimo 5 caracteres) → «Guardar cambio».
- **«＋ Añadir laboratorio»** (producto obligatorio) y **«＋ Añadir campo»** (campos
  propios de la recepción) para dar de alta filas nuevas, también con motivo.
- **«Historial de cambios»**: fecha, quién, parámetro, antes, después y motivo.

Un cambio rige desde ese momento; lo ya registrado (cotizaciones numeradas,
muestras recibidas, encuestas creadas) no cambia.

## Quién

| Acción | Quién | Regla |
|---|---|---|
| Ver el recuadro | `catalogo.gestionar` (Calidad, Administración y jefaturas) | `GET /parametros/configurables` (403 sin el permiso) |
| Cambiar o dar de alta | `catalogo.gestionar` **con alcance global** (Calidad, Administración) | Es una tabla común del instituto: `AlcanceCatalogoGuard` rechaza (403) a quien tiene el permiso solo para su laboratorio. La pantalla lo sabe por `puedeEditar` y a los demás les muestra el recuadro en solo lectura |

Es el mismo permiso que ya exigían la tabla de parámetros y los porcentajes de la
tasa; no hay permiso nuevo. (Los porcentajes de la tasa ahora también devuelven
`puedeEditar` y ocultan «Cambiar» a las jefaturas, que antes lo veían y recibían 403.)

## Qué parámetros

| Grupo (categoría) | Parámetro (código) | Tipo y validación | Por defecto | Dónde rige | Lo lee |
|---|---|---|---|---|---|
| Numeración de la cotización (`numeracion_cotizacion`) · por confirmar EP-00 §10 P6 | Formato (`formato`) | Texto con `{AAAA}` y `{N}` (este una sola vez), máx. 40, solo letras, dígitos, `- _ / .` y espacio. Muestra un ejemplo | `{AAAA}-{N}` | Al crear una cotización | `cotizacion/numeracion-cotizacion.ts` |
| | Dígitos mínimos (`digitos`) | Entero 1–10 | 5 | idem | idem |
| | Reinicio (`reinicio`) | Opción: nunca (global) · cada año (anual) | global | idem | idem |
| | Último número ya usado (`inicio`) | Entero 0–999.999.999. El siguiente es este + 1; bajarlo no reutiliza números | 0 | idem | idem |
| Circuito de la cotización (`circuito_cotizacion`) · por confirmar EP-00 §10 P1–P2 | V°B° de la respuesta del laboratorio (`vb_niveles`) | Opción: laboratorio y departamento · solo laboratorio · ninguno | lab_depto | Costeo con el laboratorio | `cotizacion/circuito-config.ts` |
| | Exigir consulta al laboratorio antes de firmar (`exigir_consulta_laboratorio`) | Sí / No | No | Firma de la cotización | idem |
| | Exigir la firma del Jefe DCO para aceptar (`exigir_firma_para_aceptar`) | Sí / No | Sí | «Registrar aceptación» de la cotización: con «No» se acepta sin firma | idem |
| | CFA del Formulario de costeo (`cfa_pct`) | Porcentaje 0–100, coma decimal, hasta 4 decimales | 12 | FORM05 | `cotizacion/form05.ts` |
| | Recargo del precio particular (`margen_particular_pct`) | Porcentaje 0–100 | 20 | FORM05 | idem |
| Encuestas de satisfacción (`encuesta`) | Orígenes de OT que NO generan encuesta (`excluir_origenes`) | Casillas: Cotización, Disposición, Interlaboratorio, OT interna, Internación, Reinspección, Producción Nacional, Prototipo. Ninguna marcada = toda OT genera encuesta | OT interna, Interlaboratorio | Al cerrar o finalizar la OT | `fn_encuesta_al_cerrar_ot` (`align_encuestas_satisfaccion.sql`) |
| Metrología · cierre (`metrologia`) | El cierre exige la devolución de cada instrumento (`cierre_exige_devolucion`) | Sí / No | Sí | Cerrar la OT de calibración y la lista «OT por cerrar» | `metrologia/metrologia-ot.datos.ts`, `ot/ot-cierre.controller.ts` |
| Metrología · ficha de calibración y certificado (`metrologia_ficha`) · por confirmar EP-04 §10 P5, P6, P9, P13 | Criterio del error normalizado (`criterio_en`) | Opción: ≤ 1 · < 1 | ≤ 1 | Ficha › Error normalizado | `metrologia/ficha.reglas.ts` (`configFicha`) |
| | Punto fuera del rango calibrado del patrón (`patron_fuera_rango`) | Opción: bloquear · avisar | bloquear | Guardar la calibración | idem |
| | Aviso por correo al emitir (`notificar_emision`) | Sí / No | Sí | Emisión del certificado | idem |
| | Actualizar el equipo del laboratorio dueño (`actualizar_equipo`) | Opción: al emitir · al entregar · no | al emitir | Emisión o entrega | idem |
| | El cierre técnico exige el informe técnico o el servicio externo del no calibrable (`no_apto_exige_documento`) | Sí / No | No | OT › Cerrar técnicamente | idem |
| Recepción · producto obligatorio (`recepcion_producto_obligatorio`) | Un código por laboratorio (`LME`, `LPN`, `LQC`, `LCC`, `LTX`…) | Sí / No (se guarda en la columna `activo`). «＋ Añadir laboratorio» para otro laboratorio o sucursal | Sí en LME y LPN; No en LQC, LCC y LTX | Recepción de la muestra y aviso de recepción incompleta | `recepcion/recepcion.service.ts`, `ot/avance-ot.controller.ts` |
| Recepción · Nº de muestra interno (`numeracion_muestra`) | Primer Nº (`inicio`) | Entero ≥ 1 | 1 | «Asignar número» | `recepcion/reglas-recepcion.ts` |
| Recepción · plazos de retención (`retencion_muestra`) | Testigo (`testigo`), contramuestra (`contramuestra`) | Entero 1–600 meses | 1 y 12 | Muestras recibidas desde el cambio: no se destruyen antes del plazo | idem |
| Recepción · campos propios (`recepcion_campo`) | Uno por campo: `<LAB>.<campo>` (p. ej. `LME.lote`) | Formulario, no JSON: tipo de dato (texto, número, entero, fecha, lista, casilla), obligatorio, activo, ayuda (máx. 300) y, si es lista, sus opciones (valor y texto visible; al menos una, sin repetir, máx. 30). El destino de la muestra (`clase_custodia`) solo admite analisis, testigo, custodia o contramuestra. Se valida con el mismo lector que usa la recepción. «＋ Añadir campo» con laboratorio, código y nombre visible | Los de `align_recepcion_custodia_equipo_lme.sql` | Recepción de la muestra | `recepcion/reglas-recepcion.ts` |
| Captura · equipo usado (`captura_equipo`) | Equipo obligatorio al capturar (`obligatorio`) | Opción: solo los métodos marcados · todo ensayo numérico · todo ensayo | metodo | Captura y revisión por OT | `laboratorio/equipo-captura.ts` |
| Captura · «< LD» (`captura_ld`) · por confirmar EP-02 §10.2 | Veredicto de un «< LD» que no se puede decidir (`indeterminado`) | Opción: pendiente (lo decide el revisor) · no cumple · cumple | pendiente | Captura y revisión por OT (lo que se capture desde el cambio) | `laboratorio/veredicto.ts` (`criterioIndeterminado`) |
| Revisión y aprobación de resultados (`segregacion_resultado`) · por confirmar | Revisión y aprobación (`revisor_aprobador`) | Opción: por personas distintas · la misma persona puede | distintas | Aprobar un resultado y «Aprobar todo lo revisado» | `rbac/alcance-resultado.ts` (`configSegregacion`) |
| | Laboratorios donde la misma persona revisa y aprueba (`excepciones`) | Casillas con los laboratorios, sucursales y delegaciones de la base (solo códigos que existen). Ninguno = la regla vale en todos | Ninguno | idem | idem |
| Plazo de la OT de internación (`ot_plazo`) · por confirmar EP-06 | Plazo (`internacion_dias`) | Entero 1–365 días corridos | 10 | Fecha de compromiso de la OT al generarla desde la internación (las ya generadas no cambian) | `bpch/ot-desde-proceso.service.ts` |
| Muestreo · plan NCh 44 (`muestreo_plan`) · por confirmar EP-05 §10 P6 y P15, EP-03 §0.4 y §3.7 | Nivel de inspección (`nivel`) | Opción: S-1…S-4, I, II, III | II | Plan con que se abre cada lote en OT › Muestreo (los registrados no cambian) | `muestreo/muestreo.module.ts` (`parametros`) |
| | AQL crítico / mayor / menor (`aql_critico`, `aql_mayor`, `aql_menor`) | Opción: sin AQL o una columna de la tabla 2-A | ninguno · 2,5 · 4 | idem | idem |
| Veredicto del lote (`veredicto_lote`) · por confirmar EP-05 §10 P15 y P19 | Clase sin Ac/Re en el plan (`regla_sin_plan`) | Opción: una NC de cualquier clase rechaza · solo crítica o mayor rechaza | cualquier_nc | OT › Muestreo › Conclusión del lote | idem (`nch44.ts` · `veredictoLote`) |
| Captura · formulario especializado por método (`captura_variante_metodo`) · por confirmar EP-02 P1 | Una fila por método del catálogo (código del método) | Opción: estándar · registro de disparos (LRB) · HCP por vehículo (SVM) · inspección por atributos (AQL) · microbiología (LMB) · panel sensorial (LES); «Activa» (inactiva = rige la captura estándar). «＋ Añadir método» valida que el código exista en `cat_metodo` | LRB 8 métodos → disparos; SVM 16 → HCP; LCC 3704/3705 → AQL; LMB 12 y LES 6 **inactivas** | Captura y revisión por OT: el ensayo se registra en su formulario y la captura estándar lo rechaza (409 con el motivo) | `formularios/variantes.ts`, `formularios/reglas-captura.service.ts` |
| Captura · formulario especializado por laboratorio (`captura_variante_laboratorio`) | Una fila por laboratorio | Igual que la anterior; solo para métodos sin fila propia (manda el método) | Ninguna | idem | idem |
| LRB · registro de disparos (`lrb`) · por confirmar EP-05 P3, P4, P5 | Tabla de amenazas (`amenazas`) | **Tabla** (máx. 60 filas): clave, norma, nivel, elemento (chaleco/casco/probeta), munición, masa (g), V mín./máx. (m/s), disparos, trauma máx. (mm), trauma en disparos 1 a N, testigo, criterio. Buscar, páginas de 20, «＋ Fila», «Pegar desde Excel» (tabulado; la primera fila puede ser el encabezado). Errores por fila; claves únicas; V máx. ≥ V mín. | 9 filas de los informes reales del LRB (NIJ 0101.04/0101.06, UL 752) | Planilla de trabajo, registro de disparos, CRB e Informe de Rechazo | `formularios/lrb.ts` (`leerAmenazas`) |
| | Velocidad que se compara (`velocidad_manda`) | Opción: V1 · V2 · promedio | V1 | Ventana de velocidad de cada disparo | `formularios/lrb.ts` |
| | Plazo de apelación (`plazo_apelacion`) | Entero 1–60 días hábiles | 5 | Texto del Informe de Ensayo de Rechazo | idem |
| Inspección por atributos (`inspeccion_aql`) · por confirmar EP-03 P5, EP-05 P15 | Nivel (`nivel`), AQL del IVC (`aql_inspeccion`), AQL por clase A/B/C del SVM (`aql_clase_a/b/c`) | Opción: nivel S-1…S-4, I, II, III; AQL de la tabla II-A de NCh 44 / ISO 2859-1; clase con «Una N/C rechaza (Ac 0 / Re 1)» | II · 2,5 · A 0, B 2,5, C 6,5 | Inspección AQL del LCC (sección V del IVC) y regla de lote de la HCP del SVM | `formularios/aql.ts`, `formularios/hcp.ts` |
| SVM · HCP por tipo de vehículo (`hcp_plantilla`) · por confirmar EP-05 P16 | Una fila por tipo de vehículo (`VLCB`…) | Tabla de ítems (máx. 600): ítem, grupo, subgrupo, requisito, cantidad, clase A/B/C, método del catálogo al que pasa el veredicto, mín., máx., unidad (ítem cuantitativo si tiene mín. o máx.). «＋ Añadir plantilla» con código en mayúsculas y nombre | VLCB (LVM-PG01-IT03-FORM02 Rev03): 379 ítems; 4.2.1 ≤ 16 m, 4.3.1 ≤ 36,7 m, 4.4.1 25–35°, 4.5.1 14–18° | Paquete técnico y HCP por vehículo | `formularios/hcp.ts` (`leerPlantilla`) |
| Preparación de muestras · campos (`preparacion_campo`) | Uno por campo: `<LAB>.<campo>` | Formulario: tipo (texto, número, entero, fecha, lista, casilla, equipo del laboratorio), obligatorio, activo, unidad, ayuda, opciones y **«Bloquea la captura»** (casilla sin marcar, fecha vencida o equipo no apto). Agrupados por laboratorio. «＋ Añadir campo» | 77 campos de 13 laboratorios (LQC, LPN, LME, LQA, LMB, LES, LCC, LTX, LRB, LEM, LAM, SEO, SVM) tomados de sus planillas | OT › Preparación › «Preparación y acondicionamiento de muestras» | `formularios/preparacion.ts` |
| Preparación de muestras · obligatoria (`preparacion_obligatoria`) | Uno por laboratorio | Sí / No | No en los 13 laboratorios | Si es Sí, la muestra no se captura sin preparación registrada | `formularios/reglas-captura.service.ts` |
| DSA · aprobación del trabajo (`preparacion_trabajo`) · por confirmar EP-05 P2 | Laboratorios que aprueban antes de ejecutar (`exige_aprobacion`) | Casillas LRB, LAM, SEO, SVM (LEM no figura: se aprueba solo si el trabajo es en terreno) | LRB, SVM | Planilla de trabajo / paquete técnico (EP-05 2.3) | `formularios/trabajo.ts` |
| | La captura espera la aprobación (`bloquea_captura`) | Sí / No | Sí | Registro de disparos, HCP y captura estándar | idem |
| LMB · microbiología (`micro`) · por confirmar EP-02 P3 | Lecturas programadas (`lecturas_h`) | Casillas de horas | 24, 48, 72 | Formulario «Siembra, incubación y lectura» (solo si se activa la variante) | `formularios/micro.ts` |
| LMB · planes del RSA (`rsa_criterios`) · por confirmar EP-02 P2 | Planes por ensayo y producto (`tabla`) | Tabla (máx. 200): método, producto, n, c, m, M, artículo del RSA | Vacía (sin plan, el resultado es informativo) | idem | idem |
| LES · panel sensorial (`sensorial`) · por confirmar EP-02 P4 | α (`alfa`), jueces mínimos (`jueces_min`), rangos por atributo (`rangos`) | Opción 0,05/0,01/0,001 · entero 1–60 · tabla prueba, atributo, mín., máx. (máx. 60 filas) | 0,05 · 6 · rangos del Listado LES | Formulario «Panel sensorial» (solo si se activa la variante) | `formularios/sensorial.ts` |
| BPCH · prototipos (`bpch_prototipo`) · por confirmar EP-08 P4 | La OT de evaluación exige la parametrización validada (`exige_parametrizacion`) | Sí / No | No | «Generar OT» del prototipo (paso 5) | `bpch/prototipos/prototipos.service.ts` (`exigeParametrizacion`) |
| Delegación Nº 11 (`d11`) · por confirmar EP-11 P1, P4, P11 | Ensayos del registro (`metodos_registro`) | Casillas con los métodos D11 | 1292 | Registro del arma como muestra (IT05) | `saec/d11/reglas-d11.ts` (`configD11`) |
| | Ensayos del camino «Con cuño CIP» (`metodos_cip`) | idem | 1291, 3500 | Clasificación y camino del arma | idem |
| | Ensayos del camino «Sin cuño CIP · prueba completa» (`metodos_completa`) | idem | 1213, 1202, 1203, 3500 | idem | idem |
| | Ensayos de un accesorio (`metodos_accesorio`) / de una máquina recargadora (`metodos_maquina`) | idem | 2322 / 3706 | idem | idem |
| | Ensayos con fuego real que gastan munición de prueba (`metodos_fuego`) | idem | 1203 | «Registrar ensayos» del arma: exige lote y cartuchos y los descuenta del inventario (EP-11 11.17) | idem y `saec/d11/municion.service.ts` |
| | Un arma con cuño CIP también se acuña (`acunacion_cip`) | Sí / No | No | Acuñación IT08 | idem |
| | Vigencia del certificado por arma (`vigencia_anios`) | Entero 1–10 años | 4 | Emisión del certificado por arma | idem |

| Aceptación por O/C (`aceptacion_oc`) · por confirmar EP-00 4.2 | Diferencia que no es discrepancia (`tolerancia`) | Entero 0–100.000.000 CLP | 0 | Registrar aceptación con O/C: si la O/C difiere más, se exige la discrepancia o anular la orden del cliente | `cotizacion/aceptacion-oc.ts` |
| Cotización del LRB (`cotizacion_lrb`) · por confirmar EP-05 0.2 | Unidades de reposición (`reposicion`) | Entero 0–50 | 4 | «Sumar N a cada ensayo» en la cotización del LRB | `cotizacion/cotizacion.service.ts` (`config`) |
| OT institucional (`ot_institucional`) · por confirmar EP-01 §10 P17 | Exigir Nº y fecha de oficio (`exige_oficio`) | Sí / No | Sí | Registrar OT con origen «Institucional sin cobro» y Datos del encargo | `ot/reglas-ot.ts`, `ot/encargo/reglas-encargo.ts` |
| Informe mensual de la tasa (`tasa_informe`) · por confirmar EP-06 6.23 | Destinatarios de la difusión (`difusion`) | Casillas: Dirección, Subdirección, BPCH, Contraloría interna, DFZ, DCO | Dirección, Subdirección, BPCH, Contraloría interna, DFZ | «Emitir informe mensual → difusión» | `internacion/tasa-mensual.ts` |

Los grupos `aceptacion_oc`, `cotizacion_lrb`, `ot_institucional` y `tasa_informe` los creó el
frente r4d (`align_r4d_comercial.sql`, ver `docs/FLUJO_R4D_COMERCIAL_OT_CALIDAD.md`). Usa además
`lrb.plazo_apelacion` (r2a) para el plazo de la apelación del Informe de Rechazo.

Los grupos `muestreo_plan` y `veredicto_lote` los creó el frente r2b
(`docs/FLUJO_ESPECIFICACIONES_MUESTREO.md`).

Los grupos `bpch_prototipo` y `d11` los creó el frente r4b
(`align_r4b_bpch.sql`, `align_r4b_d11.sql`, ver `docs/FLUJO_D11_ARMAS.md`).

Los grupos desde «Captura · formulario especializado» (`captura_variante_metodo` … `sensorial`) los creó el frente r2a
(`align_r2a_formularios.sql`, ver `docs/FLUJO_FORMULARIOS_ESPECIALIZADOS.md`). Los
tipos nuevos son **variante**, **tabla** y **campo de preparación**; la tabla se valida
fila a fila con el mismo lector que usa el formulario, y su historial guarda la tabla
completa antes y después.

Las reglas `captura_ld`, `segregacion_resultado` y `ot_plazo` las creó el frente r1g (recorrido MP-02/MP-06, `align_r1g_recorrido.sql`)
y desde el frente r1h se editan aquí como las demás, con motivo e historial. Las
excepciones de la segregación se guardan como antes (códigos separados por coma), así
que el lector no cambia; la captura muestra en «Aprobar todo lo revisado» cuántos
resultados deja fuera por esta regla.

Los combos (tipo de cliente, forma de pago, toma de muestra, productos por
laboratorio…) siguen en la tabla de arriba, como antes. Los porcentajes de la tasa
de internación (`bpch_tasa`) siguen en su recuadro propio (frente K).

## Reglas

- **Motivo obligatorio** (5–500 caracteres) en cada cambio y alta.
- **Historial**: `parametro_sistema_historial` (la tabla del frente K) guarda el
  valor anterior y el nuevo tal como se guardan; la pantalla los muestra legibles.
  En el producto obligatorio se guarda «si»/«no»; en un campo de recepción, su
  definición con «activo».
- **Mismo valor que el vigente** → 409 («no hay nada que cambiar»).
- **Valor inválido para su tipo** → 400 con el motivo (p. ej. «El valor debe estar
  entre 1 y 600 meses»).
- **Tabla de combos**: en estas filas solo se cambian la etiqueta y el orden. Cambiar
  el valor, «Activo», la categoría o el código por `PATCH /parametros/:id`, darlas de
  alta por `POST /parametros` o borrarlas → 409 con el aviso de usar este recuadro
  (así nadie se salta el motivo ni el historial, y no se pueden desactivar sin dejar
  rastro: un parámetro inactivo hace que rija el valor por defecto).
- Las reglas son puras y están probadas en
  `apps/api/src/catalogo/parametro-configurable.spec.ts`, incluido que cada lector
  entiende lo que se guarda.

## API

| Ruta | Permiso | Cuerpo |
|---|---|---|
| `GET /parametros/configurables` | `catalogo.gestionar` | — · devuelve `puedeEditar`, `grupos[].parametros[]` (valor tipado, texto, definición), `laboratorios` y `historial` |
| `PUT /parametros/configurables/:categoria/:codigo` | `catalogo.gestionar` global | `{ valor, motivo }`; `valor` según el tipo: número o texto, `true/false`, opción, lista de opciones, o `{ tipo, obligatorio, opciones, ayuda, activo }` |
| `POST /parametros/configurables/:categoria` | `catalogo.gestionar` global | `recepcion_producto_obligatorio`: `{ laboratorio, valor: true/false, motivo }` · `recepcion_campo`: `{ laboratorio, campo, etiqueta, valor: {…}, motivo }` |
| (r2a) mismo `POST` | idem | `captura_variante_metodo`: `{ codigo, valor: { variante, activo }, motivo }` · `captura_variante_laboratorio` y `preparacion_obligatoria`: `{ laboratorio, valor, motivo }` · `hcp_plantilla`: `{ codigo, etiqueta, valor: [filas], motivo }` · `preparacion_campo`: `{ laboratorio, campo, etiqueta, valor: { tipo, obligatorio, bloquea, unidad, opciones, ayuda, activo }, motivo }` |

Recorrido de prueba: `scripts/verificacion/r1-r1f.js` (con Calidad, que puede, y
con el Jefe de LQC y Comercial, que no) y, para las reglas de r1g,
`scripts/verificacion/r1-r1h.js`. Para los parámetros de r2a, `scripts/verificacion/r2-r2a.js`
(paso 1: Calidad cambia la tabla de amenazas y una variante; el Jefe de LQC no).
