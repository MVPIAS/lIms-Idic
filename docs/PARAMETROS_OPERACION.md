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
| Recepción · producto obligatorio (`recepcion_producto_obligatorio`) | Un código por laboratorio (`LME`, `LPN`, `LQC`, `LCC`, `LTX`…) | Sí / No (se guarda en la columna `activo`). «＋ Añadir laboratorio» para otro laboratorio o sucursal | Sí en LME y LPN; No en LQC, LCC y LTX | Recepción de la muestra y aviso de recepción incompleta | `recepcion/recepcion.service.ts`, `ot/avance-ot.controller.ts` |
| Recepción · Nº de muestra interno (`numeracion_muestra`) | Primer Nº (`inicio`) | Entero ≥ 1 | 1 | «Asignar número» | `recepcion/reglas-recepcion.ts` |
| Recepción · plazos de retención (`retencion_muestra`) | Testigo (`testigo`), contramuestra (`contramuestra`) | Entero 1–600 meses | 1 y 12 | Muestras recibidas desde el cambio: no se destruyen antes del plazo | idem |
| Recepción · campos propios (`recepcion_campo`) | Uno por campo: `<LAB>.<campo>` (p. ej. `LME.lote`) | Formulario, no JSON: tipo de dato (texto, número, entero, fecha, lista, casilla), obligatorio, activo, ayuda (máx. 300) y, si es lista, sus opciones (valor y texto visible; al menos una, sin repetir, máx. 30). El destino de la muestra (`clase_custodia`) solo admite analisis, testigo, custodia o contramuestra. Se valida con el mismo lector que usa la recepción. «＋ Añadir campo» con laboratorio, código y nombre visible | Los de `align_recepcion_custodia_equipo_lme.sql` | Recepción de la muestra | `recepcion/reglas-recepcion.ts` |
| Captura · equipo usado (`captura_equipo`) | Equipo obligatorio al capturar (`obligatorio`) | Opción: solo los métodos marcados · todo ensayo numérico · todo ensayo | metodo | Captura y revisión por OT | `laboratorio/equipo-captura.ts` |

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

Recorrido de prueba: `scripts/verificacion/r1-r1f.js` (con Calidad, que puede, y
con el Jefe de LQC y Comercial, que no).
