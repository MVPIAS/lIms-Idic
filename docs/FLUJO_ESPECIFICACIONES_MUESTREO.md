# Especificaciones técnicas del cliente y muestreo NCh 43/44 · LIMS IDIC

Entrega R2, frente r2b. Temas transversales T11 (especificaciones del cliente y
reglas de veredicto) y T13 (muestreo). Especificación: EP-01 1.1; EP-02 1.1 y 3.10;
EP-03 0.4, 0.5, 1.3, 3.6 y 3.7; EP-05 3.2 y 5.1–5.3; EP-10 10.4. Backlog BL-042,
BL-043, BL-045, BL-046, BL-047 y BL-049 (R2); la clase de defecto y la regla del
lote de BL-091 y BL-057 (R3) quedan configurables.

- SQL: `packages/db/align_r2b_especificacion_tecnica.sql` y `align_r2b_muestreo.sql`
  (antes de `align_cierre_permisos.sql`).
- Reglas puras con pruebas: `apps/api/src/muestreo/nch44.ts`, `reglas-muestreo.ts`,
  `apps/api/src/especificacion-tecnica/reglas-et.ts`, `aplicar-et.ts` (entrada
  guardada) y `apps/api/src/laboratorio/requisito-compuesto.ts`.
- Recorrido contra la API: `scripts/verificacion/r2-r2b.js`.

## 1. Biblioteca de especificaciones técnicas (E.T.)

Pantalla **Laboratorio › Especificaciones técnicas (E.T.)** (`/especificaciones`).

| Dato | Regla |
|---|---|
| Código y versión | El código es único; cada cambio de una E.T. publicada es una versión nueva (v1, v2…) |
| Tipo | E.T. del cliente · contrato · norma · reglamento (p. ej. RSA) |
| Cliente, mandante, licitación, producto | Informativos; la licitación y el producto ayudan a buscarla |
| Laboratorios | Donde se usa. Define quién la gestiona. Vacía = general (solo Calidad o Administración) |
| ¿Reutilizable? | No = solo en OT de su cliente (E.T. de una licitación) |
| PDF | Uno por versión, máx. 10 MB, se valida que sea PDF |

Ciclo: **borrador** (se edita) → «**Publicar → vigente**» (se congela y se elige en
las OT; la vigente anterior del mismo código queda **reemplazada**, y las OT que la
eligieron la conservan) → «**Nueva versión**» (motivo obligatorio; copia los puntos en
un borrador v+1, sin el PDF) · «**Anular**» (motivo; ya no se elige).

Cada **punto**: Punto · Componente · Característica · Ensayo del catálogo (método y,
si tiene varios, analito) · Tipo · Requisito · Unidad · Clase de defecto.

| Tipo | Requisito |
|---|---|
| Numérico | Mín / Nom / Máx; admite una **segunda condición** de la misma fila («X kgf con Y mm»): qué se mide, Mín/Máx y unidad. Cumple solo si cumplen las dos |
| Atributo | Texto; Cumple / No cumple |
| Inspección | Checklist del producto (modelo, etiquetado, empaque…): no es una muestra ni lleva componente |
| Plan de clases | n, c, m y M (vacío = 2 clases) del RSA: cada réplica es una unidad. No cumple si alguna supera M o si más de c superan m |

Al publicar se exige al menos un punto, todos válidos, y un solo requisito por
ensayo y componente. Un punto sin ensayo del catálogo queda en la E.T. pero no se
puede capturar (se avisa).

## 2. La E.T. en la OT

- Se elige al **registrar la OT** (selector opcional en «Registrar OT») o en
  **OT › Cabecera › «Especificación técnica del cliente (E.T.)»** con «Elegir E.T. →
  requisitos de los ensayos». Solo versiones vigentes, del laboratorio de la OT y del
  cliente si no es reutilizable. Una **muestra** puede tener la suya (manda sobre la de
  la OT).
- Los ensayos que se generan después nacen con el requisito de su punto, marcado
  «**E.T. <código> v<n> · punto <p>**» (pastilla turquesa en la captura). Regla de
  correspondencia: el punto del mismo analito y componente; si el punto solo indica
  el método, vale cuando el método tiene un único analito en la muestra.
- «**Aplicar requisitos de la E.T. → veredicto**» lleva el requisito a los ensayos ya
  registrados y aún sin revisar, y recalcula el veredicto de los que tienen valor.
  Cambiar un requisito que vino del catálogo es de la **jefatura** (misma regla que la
  especificación de la orden): al analista se le informa como omitido. La copia del
  catálogo se conserva.
- **Componentes e inspecciones** (EP-03 1.3): por muestra del producto, el plan de la
  E.T. (producto, cada componente, checklist de inspecciones, puntos sin ensayo) y
  «**Confirmar plan de ensayos → asignar**», que crea una submuestra trazable por
  componente (`<muestra>-C<k>`, `parent_muestra_id`, con la recepción del producto) con
  sus ensayos, y agrega al producto sus ensayos y las inspecciones. Repetirlo no
  duplica.

## 3. Captura con requisito compuesto

En «Captura y revisión por OT» el formulario del ensayo pide la **segunda condición**
(obligatoria si el requisito la tiene) y, en un **plan de clases**, los valores de las
n unidades. Sin la segunda condición el ensayo queda Pendiente. La captura rápida de
la tabla no se ofrece para estos ensayos. El ajuste del factor conserva ambas reglas.

**Clase de la no conformidad** (EP-05 5.2): la trae el punto (crítico, mayor, menor);
la jefatura (`resultado.aprobar`) la cambia con motivo en el formulario
(«Clasificar → veredicto de lote»), con historial en la OT.

## 4. Muestreo (OT › Muestreo)

Barra de pasos: **Formulario · Plan y unidades · Entregar al laboratorio · Recibido
conforme · Conclusión del lote**. «＋ Nuevo muestreo» con el formulario y su **Nº
único** en el instituto.

| Formulario | Campos obligatorios para entregar |
|---|---|
| Selección y extracción (Sección Muestreo, EP-03 0.4) | Nº, fecha y hora, lugar, producto/E.T., proveedor, tamaños de lote y muestra, sellos, registro fotográfico (Nº o fotos) |
| NUMFORM (Alimentos, EP-02 1.1) | Nº, fecha y hora, lugar, producto, proveedor, cantidad, tamaño de lote, devolución del excedente, solicitado por |
| IT01-FORM06 (toma en terreno, EP-01 1.1) | Nº, fecha y hora, lugar, responsable, cantidad y envase |
| Planilla NCh 44 (lote, EP-05 3.2 y EP-10 10.4) | Nº, fecha y hora, lugar, identificación y tamaño del lote, tamaño de muestra y plan NCh 44 (o línea móvil con su plan) |

La fecha y hora se escribe y se muestra en hora de Chile; no puede ser futura.

**Plan NCh 44** (tablas en `nch44.ts`): nivel (S-1…S-4, I, II, III), tabla y AQL por
clase → letra (tabla 1) y, con la tabla 2-A, n y Ac/Re por clase con las flechas
resueltas (la letra y n cambian); 100 % si n alcanza al lote; la muestra a extraer es
el mayor n. Cambiar n exige motivo. Con las tablas 2-B y 2-C (no cargadas) se
escriben n, Ac y Re con motivo. El tamaño de muestra del formulario es el n del plan.

**Selección NCh 43**: período = ⌊lote / muestra⌋, punto de partida escrito o
sorteado → tabla de **unidades seleccionadas** (posición, serie, talla, panel) y
«**Reemplazar…**» con motivo (la unidad queda tachada y se agrega la de reemplazo).
**Sellos** (separados por coma) y **registro fotográfico** (PNG o JPEG, 2 MB).

«**Registrar muestreo → entregar al laboratorio**» lista lo que falta. Luego el
laboratorio marca «**Recibido conforme → recepcionar muestras**» o «No conforme…» (con
motivo; aviso en la Ruta de la OT). Un muestreo entregado no se edita: se anula con
motivo (antes de recibirlo) y se registra otro. Las muestras se enlazan al muestreo
al registrarlas o en la misma pestaña.

**Ruta de la OT**: mientras haya un muestreo en preparación, el siguiente paso de la
Recepción es «Completar el muestreo Nº … y entregarlo al laboratorio» (Sección
Muestreo); entregado, «Recibir el muestreo Nº … y recepcionar sus muestras».

### 4.1 Conclusión del lote

Tras recibirlo: por clase, unidades no conformes (cada muestra cuenta una vez por
clase; sus submuestras cuentan con ella; sin muestras enlazadas, las de la OT) frente
a Ac/Re del plan: acepta con defectuosas ≤ Ac, rechaza con ≥ Re; el lote se rechaza si
una clase rechaza. Una clase sin Ac/Re sigue el parámetro `veredicto_lote`. Una no
conformidad sin clase cuenta como mayor. La jefatura puede corregir las unidades
verificadas (con motivo) y registra la conclusión: «**Concluir → revisión técnica**».
Sin ensayos o con ensayos sin decidir queda pendiente.

## 5. Permisos y alcance

| Permiso | Roles | Alcance |
|---|---|---|
| `et.ver` | Laboratorio (analista, revisor, técnico, inspector, metrólogo), jefaturas, Calidad, Comercial, Planificación, Muestreo, Recepción, Dirección, Lector | Las E.T. generales y las de sus laboratorios |
| `et.gestionar` | Jefaturas de laboratorio, sección y departamento, Calidad, Administración | Solo E.T. cuyos laboratorios estén todos en su alcance; las generales, solo alcance global |
| `muestreo.registrar` | Muestreo, analista, revisor, técnico, inspector, jefaturas, Administración | OT de su alcance |
| (existentes) | Elegir la E.T.: `ot.crear` o `muestra.crear`; aplicar requisitos: `resultado.crear`; desglose y recepción del muestreo: `muestra.crear`; clase de NC y conclusión del lote: `resultado.aprobar` | OT de su alcance |

## 6. Parámetros de la operación (por confirmar con el IDIC)

Administración › Parámetros del sistema › «Parámetros de la operación»:

| Grupo | Parámetro | Por defecto | Pregunta |
|---|---|---|---|
| `muestreo_plan` | Nivel de inspección | II | EP-05 §10 P6; EP-03 §0.4 |
| | AQL crítico / mayor / menor | ninguno / 2,5 / 4,0 | EP-05 §10 P15; EP-03 §3.7 |
| `veredicto_lote` | Clase sin Ac/Re en el plan | Una unidad no conforme rechaza el lote | EP-05 §10 P15 y P19; carta LEM-01 y SVM-02 |

## 7. Por confirmar con el IDIC

1. Tablas 2-B y 2-C de su NCh 44 (hoy n y Ac/Re a mano) y columnas de AQL > 10.
2. Plan aplicable en la línea de fabricación móvil (IT10 no aplica).
3. Quién digitaliza las E.T. (hoy jefaturas y Calidad) y las 10 más usadas (EP-05 P18).
4. Valores n, c, m, M por producto y artículo del RSA (EP-02 P2).
5. Regla del lote y quién clasifica mayor/menor en LEM y SVM (EP-05 P15, P19).
6. Que una no conformidad sin clase cuente como mayor.
7. Formularios de muestreo reales (IT01-FORM06, NUMFORM, selección y extracción): no recibidos.
