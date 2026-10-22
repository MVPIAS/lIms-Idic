# Segundo recorrido MP-02 / MP-06 · correcciones del frente r1h · LIMS IDIC

Diferencias D02-25 a D02-30 y D06-20 del recorrido v1.1 de los manuales de proceso
(Sección Alimentos y BPCH · Internaciones), sobre la integración R1 (`5ebc897`), y
las reglas del frente r1g que aún no se editaban desde pantalla. Sin SQL nuevo: los
parámetros ya los siembra `align_r1g_recorrido.sql` y no hay permisos nuevos.

Recorrido de prueba: `scripts/verificacion/r1-r1h.js` (cada regla con un perfil que
puede y otro que no; con `--arrancar` lanza la API con `TZ=UTC`).

## 1. El analista del laboratorio de destino llega a su captura (D02-25)

Una orden interna deriva ensayos de una OT a otro laboratorio (r1b); el destino los
captura en la OT de origen y solo ve esos ensayos (alcance por ensayo, r1g). Faltaba
el camino:

| Dónde | Qué ve el analista del destino | Regla |
|---|---|---|
| **Mi bandeja** | Tarjeta **«Ensayos derivados por capturar»** (analista, revisor y jefatura) | Ensayos de órdenes internas **recibidas** dirigidas a sus laboratorios, sin valor o devueltos. Abre la captura en la bandeja «Derivados por capturar» (`GET /resultados/bandeja?derivados=1`, por laboratorio dueño del ensayo). Exige `resultado.ver` (Recepción no la ve) |
| **Laboratorio › Órdenes internas › ficha** | Botón **«Registrar resultados»** en el paso 3 | `puedo.capturar`: `resultado.crear` con alcance en el laboratorio de destino y la orden recibida. El «Siguiente paso» nombra al analista y a la jefatura |
| **Captura y revisión por OT › Orden de trabajo** | El buscador encuentra la OT de origen | `GET /ot?derivadas=1`: además de las OT de sus laboratorios, las que tienen órdenes internas vivas (no anuladas) dirigidas a ellos. Dentro solo ve los ensayos derivados. La lista «Órdenes de trabajo» no cambia |

## 2. Fecha y hora de Chile en documentos y PDF (D02-27)

Todo lo que se imprime con fecha y hora usa `America/Santiago`, sea cual sea la zona
del servidor (`apps/api/src/common/fecha-chile.ts`): firmas, emisión y sello del
informe, entrega, documentos BPCH y SAEC, cotización, correos de Mensajería. Las
fechas de calendario (columnas DATE) se muestran tal cual. El año de los números de
documento (OT, OI, informes, cotización, NC, compras, SAEC, Metrología) es el de
Chile. En la web, `fecha()` y `fechaHora()` también fijan la zona de Chile. Los
certificados de Metrología y la planilla de cálculos ya la usaban.

## 3. Otras correcciones

- **D02-26** · La Ruta de la OT se vuelve a pedir al emitir, editar o anular una orden
  interna desde la ficha de la OT.
- **D02-28** · Equipo usado: cada ensayo ofrece los equipos de su laboratorio dueño (el
  destino, si se derivó) y los comunes sin unidad; un equipo de otro laboratorio se
  rechaza al capturar (400), aunque quien captura trabaje también allí
  (`laboratorio/equipo-captura.ts`).
- **D02-29** · El informe de análisis interno muestra los números con coma decimal (el
  número manda sobre el texto guardado «7.2»). Las plantillas del servidor ya usaban coma.
- **D02-30** · «Atención» del informe: el solicitante de la OT; si no hay, el contacto
  principal de la ficha del cliente (con su cargo); si tampoco, el contacto marcado como
  principal (`plantilla-render/atencion.ts`).
- **D06-20** · «Aprobar todo lo revisado»: la ayuda dice que quedan fuera los que capturó
  y los que revisó el usuario, y debajo se lee cuántos por cada motivo. La API da por
  ensayo `bloqueoAprobar` según la configuración de la segregación.

## 4. Reglas de r1g en «Parámetros de la operación»

Administración › Parámetros del sistema, con tipo, motivo e historial (detalle en
`docs/PARAMETROS_OPERACION.md`):

- `captura_ld.indeterminado` · opción (pendiente · no cumple · cumple).
- `segregacion_resultado.revisor_aprobador` · opción; `segregacion_resultado.excepciones`
  · casillas con los laboratorios de la base.
- `ot_plazo.internacion_dias` · entero de 1 a 365 días corridos.

## Pendiente del IDIC

Siguen por confirmar los valores por defecto de r1g: criterio del «< LD» (EP-02 §10.2),
laboratorios de dos personas para la segregación y plazo real de la OT de internación.
