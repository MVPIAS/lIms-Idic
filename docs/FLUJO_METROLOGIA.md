# Flujo de Metrología (LMT, LMTE, LNF)

Módulo `apps/api/src/metrologia` y pantallas `apps/web/app/(app)/metrologia`.
Pertenece a la Sección Metrología (`@AmbitoUnidad("SAM")`): solo entra quien
trabaja en SAM o en sus laboratorios, o quien tiene alcance global.

## 1. Procesos y cómo se calcula cada uno

Cada proceso (`met_proceso`) pertenece a un laboratorio (`laboratorio`) y se
calcula con un motor:

| Laboratorio | Procesos | Cálculo |
|---|---|---|
| LMT · Área Mecánica | ITM01, ITM02, ITP01, ITP02, ITL01, ITL02, ITL06, ITL07, ITV02a/g/c, ITF01, ITF03, ITPT01 | Motor validado de su IT: 1531 de 1531 valores idénticos a los Excel del LMT (16 casos reales) |
| LMT | ITM03, ITV05 | Motor GUM parametrizado (no hay caso real) |
| LMTE · Área Eléctrica | ITT01, ITT02 (temperatura) | Motor validado (49/49 y 52/52) |
| LMTE | ITME01 (eléctrica), ITE03 (tiempo y frecuencia) | Formulario estándar por puntos (el IDIC no entregó planilla ni instrucción) |
| LNF · Laboratorio Nacional de Fuerza | LCPNF-IT01 (ISO 376) | Motor validado contra la planilla LCPN-F-PG01-P01-IT01 Rev. 19: 483 de 483 valores idénticos (caso LCPNF-010.26) |
| Cualquiera de la sección | PTS01 | Formulario estándar por puntos; quien calibra elige el laboratorio |

La acreditación que se imprime en el certificado sale de `met_proceso.acreditacion`
(LC 001…LC 155 para los procesos del LMT y la temperatura). LNF, eléctrica y
tiempo quedan «sin acreditación declarada» hasta que el IDIC la confirme
(hallazgo G10 del LNF).

### Motor ISO 376 del LNF (`motores/lnf.ts`)

Entradas: lecturas brutas de las 6 series (I1, I2 a 0°; I3/I4 a 120°; I5/I6 a
240°), ceros iniciales y finales, precargas, resolución del indicador,
divisiones, UREL95 del SMP, temperaturas de cada serie. Salidas, como la
planilla: deflexiones, Xr, Xwr, b, b', ajuste S=f(F) y F=f(S) (grados 1, 2 y 3,
sin término independiente), fc, v, f0, fluencia estimada, clase por criterio y
por rango (00 / 0,5 / 1 / 2 / N/C), incertidumbre casos C y D, balance general
y tabla de interpolación del certificado.

La matriz normal del ajuste cúbico está muy mal condicionada (≈ 2·10¹⁵): se
invierte con LU y pivoteo parcial, que reproduce MINVERSE de Excel bit a bit.

Correcciones propuestas (desactivadas = planilla): G3 k = 2 en vez de 1,96;
G4 fluencia sin el /100 adicional; G6 U mínima leída de la fila correcta.

### Formulario estándar por puntos (`motores/puntos.ts`)

N puntos × n series (3 por defecto) con la lectura del instrumento y la del
patrón; cada punto puede tener su función/rango y su unidad.

```
eⱼ  = lectura del instrumento − lectura del patrón
ē   = promedio de eⱼ                      (error del punto)
u_A = s(eⱼ) / √n                          (tipo A)
u_p = U_patrón / k_patrón                 (certificado del patrón; k = 2 por defecto)
u_r = d / (2·√3)                          (solo si se informa la resolución)
u_c = √(u_A² + u_p² + u_r²)
U   = 2 · u_c
Veredicto, solo si hay tolerancia (EMP): |ē| + U ≤ EMP   (o |ē| ≤ EMP con la regla simple)
```

Todo lo que el IDIC no ha definido (tolerancia, regla de decisión, resolución)
queda vacío y editable. Sin tolerancia, el punto se informa «sin tolerancia».

## 2. Circuito del certificado

```
borrador ──Enviar a revisión──▶ en_revision ──Emitir──▶ emitida
   ▲                                │
   └──────────Devolver (motivo)─────┘
```

| Acción | Quién | Regla |
|---|---|---|
| Guardar / editar borrador | `metrologia.crear` | Solo el autor edita su borrador |
| Enviar a revisión | `metrologia.crear` | Solo el autor; la calibración debe estar calculada |
| Devolver | `metrologia.emitir` | Motivo obligatorio (mín. 5 caracteres); no puede ser el autor |
| Emitir | `metrologia.emitir` | Solo lo enviado a revisión; no puede ser el autor |

Corresponde al flujo del LMT (LMT-PG01-Anexo 01: el metrólogo elabora, el jefe
del laboratorio revisa, valida y firma) y del LNF (Bizagi 4.2.10: firma del
metrólogo, revisión del jefe, aprueba o vuelve), y a la matriz de firmas
`CERTIFICADO_CALIBRACION` (ELABORA metrólogo → FIRMA jefe de laboratorio).
La segunda firma de la matriz (jefe de departamento) queda para el circuito de
firmas general.

Perfiles de prueba: `demo.lmt.analista1`, `demo.lmte.analista1`,
`demo.lnf.analista1` (METROLOGO: crean y envían); `demo.lmt.jefe`,
`demo.lmte.jefe`, `demo.lnf.jefe` (JEFE_LAB: emiten o devuelven lo de otros);
`demo.sam.jefe` (JEFE_SECCION: ve los tres laboratorios y emite).

Cada paso queda en `met_calibracion_evento` (CREADA, EDITADA, ENVIADA,
DEVUELTA, EMITIDA) con usuario, fecha y comentario. Las transiciones se
condicionan al estado leído: dos clics simultáneos no emiten dos veces.

Al emitir, el contenido (proceso, fecha, instrumento, puntos, resumen, autor y
emisor) se sella con SHA-256; el PDF muestra «Calibrado por», «Revisado y
emitido por» y la fecha real de emisión. Antes de emitir, el PDF sale con
marca de BORRADOR.

## 3. Código de la calibración

`CAL-AAAA-NNNN`: el año sale de la fecha de calibración (por defecto, hoy en
Chile), con correlativo por año. Si dos guardados toman el mismo número, se
reintenta con el siguiente.

## 4. Alcance

La calibración guarda su laboratorio (`met_calibracion.unidad_id`, desde el
proceso o, en PTS01, el elegido). La lista, el detalle y el registro se acotan
con `AlcanceService`: un metrólogo del LMT no ve ni registra calibraciones del
LNF. El jefe de sección SAM y los perfiles globales ven todo.

## 5. Pantallas

- **Calibraciones** (`/metrologia`): filtros por estado, laboratorio, autor y
  acciones según lo que el servidor permite a cada fila (Ver borrador /
  Certificado, Editar, Enviar a revisión, Devolver, Emitir). Las devueltas
  muestran el motivo.
- **Nueva calibración** (`/metrologia/nueva`, `?id=` para editar un borrador):
  procesos agrupados por laboratorio; el formulario abre **vacío**. «Cargar
  ejemplo» trae un caso real solo para formación (con aviso), y «Vaciar
  formulario» lo limpia.

## 6. Base de datos

`packages/db/align_metrologia_flujo.sql` (aditivo, idempotente, al final de
`ORDEN_SQL.txt`): magnitudes eléctrica, tiempo y general; columnas
`laboratorio` y `acreditacion` en `met_proceso`; procesos LCPNF-IT01, ITME01,
ITE03 y PTS01; columnas del circuito en `met_calibracion`; tabla
`met_calibracion_evento`. Las calibraciones antiguas en estado «calculada»
pasan a borrador y toman el laboratorio de su proceso.

## 7. Pendiente del IDIC

- LNF: acreditación vigente (G10), k = 1,96 o 2 (G3), fórmula de la fluencia
  (G4), U mínima por clase (G6), CMC por rango (G7), numeración LCPNF-NNN.AA.
- LMTE: instrucciones ITME01 e ITE03, patrones (calibrador multipropósito,
  multímetro y contador patrón) con su U, tolerancias y regla de decisión.
