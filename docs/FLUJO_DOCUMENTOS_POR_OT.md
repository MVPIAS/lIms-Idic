# Varios documentos vigentes por OT

Frente r1b · tema transversal T02 (EP-01 5.1, EP-02 4.2 y 5.1).
SQL: `packages/db/align_r1b_documentos_ot.sql`. Código:
`apps/api/src/plantilla-render/cobertura-documento.ts` (reglas puras,
`cobertura-documento.spec.ts`), `cobertura-ot.ts` (hechos de la OT) y
`plantilla-render.service.ts` (emisión).

## Qué cambia

Antes una OT admitía **un** documento vigente por plantilla. Ahora cada
documento dice **qué cubre** y la OT puede tener varios vigentes de la misma
plantilla mientras no se solapen:

| Cobertura | Para qué | Fuente |
|---|---|---|
| Toda la OT | El caso de siempre (por defecto) | — |
| Una muestra | LQC: un informe por cada muestra cuando la OT lo pide | EP-01 5.1 |
| Un producto | LPN: un IE por producto = las muestras del mismo elemento del catálogo (sin producto, cada muestra es el suyo) | EP-01 5.1 |
| Un laboratorio | Alimentos: los resultados de LQA, LMB o LES de una muestra que pasa por varios | EP-02 4.2 y 5.1 (por confirmar, P5) |

## Pantalla

**Laboratorio › Emitir informe o certificado** (`/informes`), bloque
«1 · Documento a emitir» › **«¿Qué cubre el documento?»**: Toda la OT / Una
muestra / Un producto / Un laboratorio (con la sugerida del laboratorio de la
OT marcada «Sugerido»), y la muestra, producto o laboratorio elegido con sus
resultados aprobados y los documentos que ya tiene. Si se emite por partes, un
aviso dice **qué falta cubrir para cerrar la OT**. Botón **«Registrar que no se
emite»** (con motivo). La lista de documentos de la OT tiene la columna
**«Cubre»** y el estado «No emitido».

Cada documento sigue el circuito de siempre: «Emitir y enviar a firma» →
«Documentos por firmar» (matriz) → «Registrar entrega» → cuenta para el cierre.

## Reglas

- **Validación** (`erroresCobertura`): por muestra, exactamente una muestra de
  la OT; por producto, muestras del mismo producto; por laboratorio, uno que
  trabaje en la OT (responsable, destino de una orden interna u «otros
  laboratorios» de la recepción).
- **Solapes** (`solapan`): toda la OT choca con cualquiera; muestra/producto
  chocan si comparten una muestra; laboratorio con laboratorio si es el mismo;
  laboratorio con muestra/producto, siempre. Un documento vigente (en firma u
  oficial) o un «no emitido» ocupa su cobertura; los anulados y devueltos no
  (se reemiten como nueva versión, que conserva la cobertura).
- **Qué imprime**: solo las muestras y resultados que cubre (la previsualización
  lo avisa). `{{documento.cobertura}}` está disponible en las plantillas.
- **Condiciones de emisión**: deben estar aprobados los resultados que cubre
  (no los de toda la OT).
- **Firmas y número**: un documento por laboratorio se firma con la matriz de
  ESE laboratorio y toma su numeración; el resto, con el laboratorio responsable
  de la OT. `{MUESTRA}` del número es la primera muestra que cubre.
- **Alcance**: emite quien tiene la OT en su alcance; un documento por
  laboratorio también lo puede emitir quien tiene ese laboratorio, si trabaja en la OT.
- **No emitido** (`POST /informes/no-emitido`, `certificado.emitir`): para una
  muestra, producto o laboratorio; motivo obligatorio (mínimo 5 caracteres).
  Reserva el número oficial (no se reutiliza), lo deja **anulado** con «No
  emitido: …» y cubre esa parte de la OT para el cierre.
- **Cierre** (`pendientesCobertura` en `faltantesParaCerrar`): si la OT tiene
  documentos por muestra, producto o laboratorio y ninguno de toda la OT, cada
  muestra (o laboratorio) con resultados debe tener su documento vigente o su
  «no emitido». Lo muestran el panel de cierre y la Ruta de la OT.

## Configuración (por confirmar con el IDIC)

`documento_cobertura_unidad` propone la cobertura por laboratorio (la hereda la
unidad hija). Sembrado: LPN → producto; LQC → toda la OT (por muestra se elige al
emitir); Sección Alimentos (SAL: LQA, LMB, LES) → laboratorio, **por confirmar**
(EP-02 P5: ¿un informe por OT o uno por laboratorio?). Quien emite puede elegir otra.

## API

| Ruta | Permiso | Qué hace |
|---|---|---|
| `POST /informes/condiciones` · `previsualizar` · `emitir` | `certificado.emitir` | Aceptan `cobertura: { cobertura, muestraIds?, unidadId? }` |
| `GET /informes/ot/:otId/cobertura` | `certificado.emitir` | Muestras (con producto) y laboratorios de la OT, sus resultados y documentos, y lo que falta cubrir |
| `POST /informes/no-emitido` | `certificado.emitir` | Registra un documento no emitido con su motivo |
| `POST /informes/propuesta` | `certificado.emitir` | Devuelve además `cobertura` (la sugerida) |

Recorrido verificado: `scripts/verificacion/r1-r1b.js` (sección DOC): OT de LQC
con dos muestras, informe de la muestra 1 (409 si se repite o si se pide toda
la OT), cierre bloqueado por la muestra 2, «no emitido» de la muestra 2, firmas,
entrega y cierre de la OT.
