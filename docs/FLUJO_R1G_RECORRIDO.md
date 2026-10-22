# Correcciones del recorrido en pantalla MP-02 y MP-06 (frente r1g)

Recorrido real en el navegador, hecho como usuario de prueba para escribir los manuales
de proceso MP-02 (Sección Alimentos) y MP-06 (BPCH · Internaciones). Las 43 diferencias
están en `06_entregables_cliente/Manuales_de_Proceso/Diferencias_Recorrido_MP02_MP06_Aiuken.xlsx`;
su estado tras este frente, en la copia `…_estado.xlsx`.

SQL: `packages/db/align_r1g_recorrido.sql` (aditivo e idempotente) y
`packages/db/seed_r1g_demo.sql` (solo demo). Guion: `scripts/verificacion/r1-r1g.js`.

## 1. Alcance por ensayo dentro de la OT (D02-02, D02-04)

Una OT tiene un laboratorio responsable, pero una muestra puede llevar ensayos
derivados a otro laboratorio por **orden interna**. El dueño de cada ensayo lo da la
función SQL `lims_lab_de_resultado(resultado)`:

- derivado por una orden interna no anulada (el método del ensayo está entre los
  ensayos de la orden y la muestra coincide) → el **laboratorio de destino**;
- si no → el laboratorio responsable de la OT.

Reglas (`apps/api/src/rbac/alcance-resultado.ts`, servicio `AlcanceResultadoService`):

| Acción | Ensayo propio de la OT | Ensayo derivado |
|---|---|---|
| Ver | quien ve el laboratorio responsable | el responsable (solo lectura) y el destino |
| Capturar, especificación, factor | el responsable | **solo el destino**, con la orden **recibida** |
| Revisar, devolver, veredicto | el responsable | solo el destino, con la orden recibida |
| Aprobar | el responsable | solo el destino, con la orden recibida |
| Reabrir | el responsable | el destino, con la orden recibida o cerrada (la orden vuelve a «recibida») |

- Fuera de su laboratorio: 403 con el motivo («se derivó a LMB por la orden interna
  OI-…; lo capturan, revisan y aprueban en LMB. Usted lo ve en solo lectura»). Con la
  orden aún no recibida o ya cerrada: 409.
- **Cerrar la orden interna exige los ensayos derivados aprobados** por el destino
  (cerrada la orden, nadie más podría aprobarlos). `orden-interna.reglas.ts`.
- La aplican: `POST /flujo/resultado/:id/{valor,especificacion,factor}`,
  `POST /resultados/:id/{revisar,aprobar,devolver,veredicto,reabrir,recapturar}`,
  `PATCH/DELETE/GET /resultados/:id`, `POST /resultados/ot/:id/{revisar,aprobar}` (solo
  sobre lo que el usuario puede; informa `deOtrosLaboratorios`),
  `GET /flujo/ot/:id/resultados` (cada fila trae `laboratorio`, `derivado`,
  `ordenInterna` y `puedo`), `GET /flujo/ot/:id/equipos`, `GET /resultados/bandeja` y las
  tarjetas de resultados de Mi bandeja.
- Pantalla «Captura y revisión por OT»: botones según `puedo`, etiqueta del
  laboratorio dueño y «solo lectura», aviso de los derivados; el destino ve solo lo suyo.

**Por confirmar con el IDIC:** EP-01 3.7 dice que el solicitante «evalúa el resultado
interno igual que uno propio», mientras EP-02 4.1 dice que cada laboratorio aprueba su
parte. Se aplicó EP-02 (cada laboratorio aprueba lo suyo; el responsable integra en
solo lectura). Si en Química el solicitante debe aprobar, basta con cambiar la regla de
la acción «aprobar» para los derivados ya cerrados.

## 2. Resultados bajo el límite de detección (D02-03)

- `«< 10»`, `«<10 ufc/g»`, `«≤ 1,8»`, `«> 2400 NMP/100 mL»` se leen como valor censurado
  (`veredicto.ts · leerCensurado / veredictoCensurado`).
- Se decide contra Mín/Máx cuando **todo valor posible** cae del mismo lado:
  `< 10` frente a Máx 100 (o Máx 10) → Cumple; `< 10` frente a Mín 20 → No cumple.
- Si no se puede decidir (`< 10` frente a Máx 5, o frente a un Mín 5) vale el parámetro
  **`captura_ld.indeterminado`** (Catálogo › Parámetros): `pendiente` (por defecto),
  `no_cumple` o `cumple`.
- **Un resultado sin veredicto no se revisa ni se aprueba (409)** y no se emite un
  informe con resultados «Pendiente». Lo resuelve el revisor con «Decidir…» (o el
  aprobador si quedó así); nunca quien lo capturó.

**Por confirmar con el IDIC** (EP-02 §10.2): criterio cuando el límite es menor que el
LD; planes de 2 y 3 clases del RSA (n, c, m, M); límites escritos como texto
(«< 2» en el catálogo), que hoy siguen comparándose como texto.

## 3. Revisión y aprobación por personas distintas (D06-05)

Quien revisó un resultado no lo aprueba (409 «Lo revisó usted…»). Parámetros
`segregacion_resultado.revisor_aprobador` (`distintas` | `misma_persona`) y
`segregacion_resultado.excepciones` (códigos de laboratorio de dos personas; vacío).
En `docs/` solo hay documentado el caso de laboratorios de dos personas para la
emisión del certificado de calibración (Metrología), que no usa esta regla.

## 4. Otras reglas

- **BigInt** (D02-01): todo BigInt de Prisma se responde como texto (`common/bigint-json.ts`).
- **Fechas sin hora** (D06-01, D02-18): `fecha()` muestra las columnas DATE tal cual;
  los valores por defecto usan el día de Chile (`hoyISO()`); la cotización se emite
  con `hoyEnChile()`.
- **Valor inicial de la OT** (D02-09): costo estimado = total de la cotización; horas
  hombre = las del costeo respondido.
- **OT de internación** (D06-09): fecha de compromiso = hoy + `ot_plazo.internacion_dias`
  (10 días corridos por defecto; por confirmar).
- **Mi bandeja** (D06-02, D02-11): «Internaciones por analizar» (SCC y jefatura BPCH),
  «Lotes por inspeccionar» (unidad que inspecciona), «OT por recepcionar» (rol
  Recepción). `GET /bpch/internaciones?pendiente=analisis|inspeccion`.
- **Recepción de Alimentos** (D02-10): campo «Temperatura de llegada (°C)» en LQA, LMB y
  LES (opcional; obligatorio por producto POR CONFIRMAR).
- **Pago** (D02-13): medio de pago de la lista `medio_pago` (obligatorio) y Nº de
  boletín de ingreso.
- **Cliente** (D02-16): giro, dirección, forma de pago habitual y contacto principal.
- **Encuesta** (D02-14): el nombre de quien responde es opcional; el cargo, obligatorio.
- **Documentación de la tasa** (D06-03): CIF, tipo de cambio, IVA de internación y otros
  documentos al registrar la recepción; se proponen en el cálculo.

## 5. Pendiente del IDIC o fuera de alcance

Ver la columna «Estado tras r1g» del Excel de diferencias. En resumen: plantilla propia
de Alimentos (IBC01), precio del costeo frente al total de la cotización, IVA de la
cotización, límites del catálogo (densidad 0–0), vigencia y observaciones del
certificado, Comunicación Breve, firmante del certificado, aviso por correo al
importador; y como funciones nuevas: adjunto de la aceptación como fichero y
«Remitir a DCO».
