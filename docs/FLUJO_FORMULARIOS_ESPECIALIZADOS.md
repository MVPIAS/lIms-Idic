# Formularios especializados, preparación de muestras y del trabajo · frente r2a · LIMS IDIC

Entregas R2 y R4 de los temas T10 (formularios especializados), T29 (preparación y
acondicionamiento de muestras) y T26 (preparación del trabajo del DSA), más el
arrastre de R1 BL-026 (CRB e Informe de Ensayo de Rechazo del LRB). Especificaciones
EP-02, EP-03 y EP-05.

Decisión del 14-10: hay **un** formulario de captura estándar. Los especializados son
**variantes** que se activan por método (o por laboratorio) en «Parámetros de la
operación»; el ensayo de un método con variante se registra en su formulario, que
calcula el veredicto y lo **lleva al resultado** del ensayo por el mismo camino que la
captura estándar (`PuenteAnalisisService.capturarValor`). La revisión, la aprobación,
la emisión y la Ruta de la OT no cambian.

SQL: `packages/db/align_r2a_formularios.sql` (aditivo e idempotente, antes de
`align_cierre_permisos.sql`). Recorrido de prueba: `scripts/verificacion/r2-r2a.js`.

## 1. Dónde se entra

| Dónde | Qué aparece | Regla |
|---|---|---|
| **Captura y revisión por OT** (`/captura-ot?otId=…`) | Recuadro **«Formularios especializados de esta OT»** con un botón por formulario («Registro de disparos · 0/1 ensayos →») y, en cada ensayo de una variante, el enlace **«Capturar en «Registro de disparos» →»** (o «Ver …» si ya está capturado) en lugar del campo de valor | El ensayo de un método con variante activa no se captura en la tabla estándar: la API responde 409 con el motivo y la ruta del formulario |
| **OT › pestaña «Preparación»** | «Preparación del trabajo · <lab>» (solo DSA) y «Preparación y acondicionamiento de muestras» | Ver §4 y §5 |
| **Laboratorio › Preparación del trabajo por aprobar** (`/preparacion-trabajo`) | Lo que espera la decisión de quien consulta | Permiso `ot.preparacion.aprobar` (Jefe de Lab, Jefe de Sección, Jefe de Depto, Superadmin) |
| **Mi bandeja** | Tarjeta **«Documentación del trabajo por aprobar»** / «Proyectos de Párrafo por aprobar» | Jefaturas con documentación pendiente en su alcance |
| **Ruta de la OT** | Etapa nueva **«Preparación del trabajo»** tras «Asignación» (solo si el laboratorio la exige) | Hecha cuando la documentación está aprobada o registrada |

## 2. Formularios de captura (T10)

Ruta común: `/captura-ot/<formulario>?otId=…`. Pasos numerados arriba, un formulario
por paso, botón «Verbo → siguiente», estado visible (veredicto del lote, «Concluido»)
y bitácora con quién, cuándo y el motivo de cada corrección.

### 2.1 LRB · registro de disparos (BL-040, EP-05 4.1) · `/captura-ot/disparos`

1. **Lote y muestreo** · material, tipo de certificación, tamaño del lote, lote/modelo,
   unidades de reposición, fabricación, garantía, fecha de ensayo, «Certificación de
   lote», nómina de series por talla y unidades muestreadas con su serie, talla,
   muestra de la OT, serie de reposición y paneles (zona + munición de la tabla de
   amenazas). **«Guardar lote → registro de disparos»**.
2. **Registro de disparos** · un disparo por fila: zona de impacto, V1, V2, trauma
   (obligatorio en los disparos que diga la tabla), láminas perforadas/del panel,
   penetración completa, daño en el testigo si aplica, observación. **«Guardar disparo
   → siguiente disparo»**; «Corregir» con motivo. Reglas: correlativo, plan de disparos
   de la amenaza, velocidad fuera de ventana = aviso para el Jefe LRB (EP-05 4.2),
   **penetración completa detiene el panel** (los disparos restantes quedan «-.-»).
   **«Cerrar panel → siguiente panel»**.
3. **Requisitos por norma** · la tabla de amenazas vigente (solo lectura).
4. **Conclusión y documento** · veredicto del lote (regla EP-05 5.2), unidades,
   disparos, penetración y el documento que corresponde. **«Concluir lote →
   documento»** lleva el veredicto a los ensayos; «Reabrir el registro» exige motivo.

La captura del LRB **espera la aprobación de la Planilla de trabajo** (§4).

### 2.2 SVM · HCP por vehículo (BL-041, BL-044, EP-05 4.6–4.8) · `/captura-ot/hcp`

1. **Lote y muestra** · HCP del tipo de vehículo (VLCB sembrada: 379 ítems), tamaño
   del lote y vehículos a inspeccionar (cada vehículo es una muestra de la OT).
   **«Guardar lote → inspección»**.
2. **HCP por vehículo** · Nº en la muestra, inspectores (iniciales), chasis, motor,
   año, lugar, km, inicio y término; ítems por grupo con clase A/B/C, «C / N/C» o el
   valor medido en los cuantitativos (giro ≤ 16 m, frenado ≤ 36,7 m, pendientes
   25–35° y 14–18°). «Marcar pendientes como C» por grupo y filtro «Solo pendientes».
   **N/C exige observación**. **«Guardar vehículo → siguiente vehículo»**; corregir un
   vehículo inspeccionado pide motivo.
3. **Novedades del lote** · N/C por vehículo con la acción del proveedor, evaluación
   del lote por clase (AQL de «Parámetros», Ac/Re de NCh 44) y **«Emitir acta de
   novedades → evaluación del lote»**: acta con SHA-256, que se abre con «Ver acta»
   (HTML con CSP `default-src 'none'`).

La captura del SVM espera la aprobación del **Paquete técnico** (§4).

### 2.3 LCC · inspección por atributos AQL (BL-039, EP-03 3.7) · `/captura-ot/aql`

1. **Lote e inspecciones** · tamaño del lote y una fila por inspección (ensayos AQL de
   la OT + «＋ Inspección (solo informe)»): AQL, nivel, Ac/Re manual opcional y
   defectuosos. **«Evaluar AQL → informe»** calcula letra código, n, Ac y Re (tablas I
   y II-A de ISO 2859-1, con las flechas resueltas) y el cumplimiento, que pasa a sus
   ensayos.
2. **Sección V del IVC** · la tabla tal como se imprime. Las plantillas IVC muestran
   «V. Inspección por atributos (AQL)» con `{{tabla_aql}}`.

Métodos activados: 3704 y 3705 (el 1164 Tallaje se dejó fuera: tiene 95 analitos).

### 2.4 Alimentos (R3, **inactivas**) · `/captura-ot/micro`, `/captura-ot/sensorial`

- **LMB · siembra, incubación y lectura** (BL-082, BL-083): recuento en placa
  (UFC/g por dilución con la regla de recuento de ISO 7218), NMP por tabla o
  presencia/ausencia; lecturas programadas a 24/48/72 h con aviso de pendiente y
  vencida; plan n, c, m, M del RSA si está en «Parámetros». Botones «Registrar siembra
  → incubación», «Iniciar incubación → lecturas», «Registrar lectura → resultado»,
  «Confirmar → evaluación».
- **LES · panel sensorial** (BL-084, BL-085, BL-086): códigos aleatorios de 3 dígitos
  y orden de presentación por juez, cartilla por juez (escala, triangular, cocción),
  exclusión de atípicos con motivo y estadístico binomial de la triangular (ISO 4120)
  con el α de «Parámetros». «Generar cartillas → sesión», «Consolidar → evaluación».

Quedan **inactivas** hasta que el IDIC responda EP-02 P1 (¿formulario específico o
solo el resultado?): se activan por método en «Parámetros de la operación».

## 3. CRB e Informe de Ensayo de Rechazo del LRB (BL-026, EP-05 7.1)

**OT › Informe y cierre › Emitir informe**, plantillas **LRB-CRB** (Certificado de
Resistencia Balística) y **LRB-RECH** (Informe de Ensayo de Rechazo).

| Regla | Dónde |
|---|---|
| El Rechazo solo con lote **No cumple**; el CRB solo con lote **Cumple**, «Certificación de lote» marcada, nómina por talla y serie de reposición de cada unidad | Validador de emisión (`registrarValidadorEmision`): «Todavía no se puede emitir. Falta: …» |
| Registro concluido antes de emitir | idem |
| Número `IDIC DSA SAM LRB Nº J.<OT>/<AAAA>` | `plantilla-render/numeracion.ts` |
| Firmas: CRB · firma Jefe LRB, oficializa Jefe DSA; Rechazo · elabora Jefe LRB, firma Jefe DSA | `flujo_firma` (SQL) |
| Contenido: tabla de disparos, exigencia por amenaza, reemplazos, cantidad en palabras, plazo de apelación | Bloques `{{tabla_disparos}}`, `{{tabla_exigencia}}`, `{{tabla_reemplazos}}`, contexto `{{lrb.*}}` |

## 4. Preparación del trabajo del DSA (T26: BL-190, BL-191, BL-192, EP-05 2.1–2.3)

OT › Preparación › «Preparación del trabajo · <lab>» (LRB, LAM, SEO, SVM, LEM).

1. **Asignar personal y equipos** (BL-190) · Jefe de Comisión, inspectores (personal
   del laboratorio) y equipos reservados; un equipo con la calibración vencida aparece
   deshabilitado y la API lo rechaza. **«Asignar → preparar documentación»** (permiso
   `ot.asignar`).
2. **Preparar la documentación** (BL-191) · formulario por laboratorio: **Planilla de
   trabajo** LRB (norma/nivel/munición de la tabla de amenazas, plan de disparos,
   cartuchos, apoyo pedido a la Sección), plan de inspección LAM/SEO, **Paquete
   técnico** SVM (resolución, Proyecto de Párrafo O/D, HCP del tipo de vehículo,
   planilla de muestreo, guía de despacho, EE.TT., protocolo), **Proyecto de Párrafo**
   LEM (solo en terreno: lugar, fechas, personal, pasajes, combustible). Adjuntos PDF,
   PNG o JPEG hasta 5 MB (se comprueba el contenido, no la extensión). «Guardar
   borrador» y **«Enviar a aprobación → Jefe»** (LEM: «→ Jefe de Sección»), o
   «Registrar → ejecutar» donde no se aprueba.
3. **Aprobar la documentación** (BL-192) · documento renderizado, comentario,
   «Devolver con comentario» (vuelve a borrador) y **«Aprobar → ejecutar»**. LRB y SVM:
   aprueba el Jefe de Laboratorio. LEM en terreno: **«Validar → Jefe DSA»** del Jefe
   de Sección Ensayos Mecánicos y luego «Aprobar» del Jefe del Departamento (el Jefe
   DSA no aprueba antes de la validación). Bitácora con cada paso.

Mientras no esté aprobada, la ejecución espera (registro de disparos, HCP y captura
estándar responden 409 con «La documentación del trabajo … está pendiente de
aprobación»). Viáticos y rendición de la comisión quedan fuera de alcance (EP-05 P22).

## 5. Preparación y acondicionamiento de muestras (T29: BL-048)

OT › Preparación › «Preparación y acondicionamiento de muestras»: una fila por muestra
y laboratorio con ensayos, botón «Registrar» / «Ver / corregir». Los campos son los de
cada laboratorio (77 en 13 laboratorios: digestión y dilución LQC, probetas y curado
LPN, condiciones P02 y soluciones LME, homogeneización y asepsia LMB, acondicionamiento
LCC/LTX, caída y QC LRB…), editables en «Parámetros de la operación». **«Registrar
preparación → análisis»**.

- Un campo marcado «bloquea» **bloquea la captura** de esa muestra si la casilla está
  sin marcar, la fecha de vigencia venció o el equipo no está apto (calibración
  vencida). El estado lo dice («Bloquea la captura» con el motivo) y la captura
  estándar responde 409.
- Corregir lo registrado exige motivo; la bitácora guarda la versión anterior.
- Probetas: se numeran a partir del código de la muestra cuando el laboratorio las usa.
- «Preparación obligatoria antes de capturar» por laboratorio (por defecto no).

## 6. Permisos y alcance

| Acción | Quién |
|---|---|
| Ver formularios y preparación | `resultado.ver` con alcance en el laboratorio de la OT (o el dueño del ensayo) |
| Registrar disparos, HCP, AQL, micro, sensorial, preparación de muestras, documentación del trabajo | `resultado.crear` en ese laboratorio (analistas y jefatura) |
| Comisión y equipos | `ot.asignar` en ese laboratorio |
| Aprobar / validar / devolver la documentación | `ot.preparacion.aprobar` (nuevo) y el rol del paso en la rama del laboratorio |
| Parámetros | `catalogo.gestionar` con alcance global (Calidad, Administración) |

Las rutas nuevas (`/formularios/*`) están en `scripts/verificacion/alcance-por-laboratorio.js`.

## 7. Por confirmar con el IDIC (valores por defecto en «Parámetros de la operación»)

| Valor por defecto | Pregunta |
|---|---|
| Tabla de amenazas con 9 filas de los informes reales del LRB | EP-05 P3 |
| Manda V1; fuera de ventana = aviso, decide el Jefe LRB | EP-05 P4 |
| Trauma en los disparos 1 a 3 | EP-05 P5 |
| CRB: firma Jefe LRB, oficializa Jefe DSA; Rechazo: elabora Jefe LRB, firma Jefe DSA | EP-05 P2 |
| Plazo de apelación 5 días hábiles; textos del CRB y del Rechazo según los documentos reales recibidos | EP-05 P26 |
| Identificación del vehículo: chasis y motor obligatorios | EP-05 P14 |
| AQL por clase: A una N/C rechaza, B 2,5, C 6,5 | EP-05 P15 |
| Solo la HCP del VLCB | EP-05 P16 |
| Aprueban antes de ejecutar LRB y SVM; LEM solo en terreno | EP-05 2.3 (sin pregunta abierta) |
| Comisión sin viáticos ni rendición | EP-05 P22 |
| AQL nivel II, 2,5 | EP-03 P5 |
| Microbiología y sensorial inactivas | EP-02 P1 |
| Planes n, c, m, M vacíos | EP-02 P2 |
| Lecturas 24/48/72 h | EP-02 P3 |
| α 0,05, 6 jueces, rangos del Listado LES | EP-02 P4 |
