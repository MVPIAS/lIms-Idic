# Firma Electrónica Avanzada (FEA) del Estado en el PDF final

Frente F4. SQL: `packages/db/align_nuevo_f4.sql`. Código: `apps/api/src/fea/`
(reglas puras en `fea.reglas.ts` con `fea.reglas.spec.ts`; lecturas comunes en
`fea.datos.ts`; servicio y API en `fea.service.ts` y `fea.module.ts`). Pantalla:
`apps/web/components/documentos/PanelFea.tsx` y **Laboratorio › Pendientes de firma FEA**
(`/informes/firma-fea`). Recorrido: `scripts/verificacion/fea.js`.

## Qué resuelve

Los documentos finales que van al cliente deben llevar la FEA del jefe que firma
(FirmaGob). FirmaGob es un servicio en la nube y el LIMS **no sale a internet**, así que
**no se integra**. Dentro del LIMS los circuitos internos (revisión, aprobación, firma)
siguen con la firma del sistema; la FEA va solo sobre el PDF final:

1. El documento queda **oficial** (todas las firmas internas).
2. El firmante abre la ficha del documento y pulsa **«Descargar PDF para firmar»**.
3. Lo firma en su equipo con FirmaGob o con su token, **sin modificarlo**.
4. Pulsa **«Subir versión firmada con FEA»** y elige el PDF firmado.
5. Desde ahí, la descarga del PDF, el envío por correo y la verificación pública por
   código usan la versión firmada y muestran «Firmado con firma electrónica avanzada por
   <nombre> el <fecha>». El PDF original del LIMS queda guardado.

## Documentos cubiertos

| Origen | Tabla | Documentos | Dónde está el panel |
|---|---|---|---|
| `informe` | `certificado` | Informes de ensayo, IVC, informes técnicos, informes de inspección del BPCH, certificados de conformidad, incumplimiento, rechazo, certificados por arma de la D11 | Ficha del documento (Informes y certificados, Documentos por firmar, cierre de la OT) y «Firma FEA» en *BPCH · SAEC › Certificación de armas* |
| `metrologia` | `met_calibracion` | Certificados de calibración | Ficha de la calibración (*Metrología › Calibraciones*) |

No cubre todavía el certificado de evidencia del SAEC (`saec_certificado`), que tiene su
propio circuito.

## Reglas al subir (`analizarSubida`)

- **PDF**: empieza con `%PDF-`; máximo 15 MB.
- **Firma digital**: al menos un diccionario de firma (`/Type /Sig`, o `/Filter`/`/SubFilter`
  de firma) con `/ByteRange [a b c d]` y `/Contents <hex>`. El hueco del `/ByteRange` debe ser
  exactamente el `/Contents`. Se leen `/Name` (firmante) y `/M` (fecha), si vienen.
- **Integridad**: si el CMS trae el atributo `messageDigest`, se compara con el resumen
  (SHA-1/256/384/512) de los tramos firmados; si no cuadra, el PDF se modificó después de
  firmar y se rechaza. La validez del certificado del firmante (cadena, revocación) no se
  puede comprobar sin internet: la muestra el lector de PDF.
- **Mismo documento**: una firma PAdES se agrega como actualización incremental, así que el
  PDF firmado empieza con los bytes exactos del PDF emitido. El LIMS compara contra el PDF
  que entregó con «Descargar PDF para firmar» (se congela la primera vez y se entrega siempre
  el mismo; si después el documento cambia —p. ej. un V°B° opcional—, se congela uno nuevo y
  se aceptan los dos).
  - Coincide → «Corresponde al documento emitido».
  - No coincide → 409. Solo una **jefatura con permiso** (`documento.fea.gestionar`) lo acepta
    escribiendo el motivo (mínimo 10 caracteres); queda en el historial como **excepción**.
- **Quién sube**: el firmante del documento (quien firmó el último paso obligatorio de la
  matriz; en Metrología, quien emitió) o una jefatura con `documento.fea.gestionar` que tenga
  el documento en su alcance. Se puede reemplazar la versión firmada; la anterior queda
  guardada.
- Se guarda el archivo con su SHA-256, quién lo subió y cuándo (`documento_fea_archivo`), y
  cada paso en `documento_fea_evento` (descarga para firmar, subida, excepción, rechazo).

## Parámetro (Administración › Parámetros del sistema › «Firma electrónica avanzada»)

Categoría `fea`, un «sí / no» por tipo de documento (código = tipo en minúsculas:
`informe_ensayo`, `ivc`, `informe_inspeccion`, `certificado_arma`,
`certificado_calibracion`…). Por defecto **no**. Con **sí**:

- «Registrar entrega» y «Enviar por correo» responden 409 con el mensaje que explica cómo
  seguir, hasta que se suba la versión firmada (informes: `POST /informes/:id/entregar` y
  `/enviar-correo`; Metrología: `POST /ot/:id/calibraciones/:cal/entregar` y `/enviar-correo`).
- El aviso automático al emitir un certificado de calibración no adjunta el PDF sin firmar
  (queda en la bitácora del certificado).

## API

| Ruta | Quién | Qué hace |
|---|---|---|
| `GET /fea/pendientes?todos=1&soloExigidos=1` | autenticado (`todos`: `documento.fea.gestionar`) | Documentos oficiales sin versión FEA que firmó el usuario (o los de su alcance) |
| `GET /fea/:origen/:id` | firmante o alcance | Estado: original congelado, versión firmada, anteriores, historial, `puedo` |
| `GET /fea/:origen/:id/original` | firmante o alcance | PDF emitido para firmar (siempre los mismos bytes) |
| `GET /fea/:origen/:id/firmado` | firmante o alcance | Versión firmada vigente |
| `POST /fea/:origen/:id/firmado` | firmante o `documento.fea.gestionar` | Multipart `archivo` (+ `motivoExcepcion` para la excepción) |

Además: `GET /informes/:id/pdf` y `GET /metrologia/calibraciones/:id/pdf` entregan la versión
FEA si existe; `GET /informes/verificar/:codigo` y `GET /metrologia/verificar/:codigo` añaden
`firmadoFea`, `firmanteFea`, `fechaFea`, `leyendaFea` y `hashFea`. La página pública
`/verificar/<código>` lo muestra (y ahora también encuentra los certificados de calibración).

## Permiso

`documento.fea.gestionar`: Jefe de Laboratorio, Jefe de Sección, Jefe de Departamento,
Director, Subdirector y SUPERADMIN.

## Prueba real

`node scripts/verificacion/fea.js` genera con openssl un certificado autofirmado «PRUEBA»
(no es FirmaGob), firma el PDF descargado del LIMS como actualización incremental
(`/SubFilter /ETSI.CAdES.detached`, CMS con atributos firmados), comprueba con
`openssl cms -verify` que el CMS firma exactamente los tramos del `/ByteRange` y recorre
subida, rechazo, excepción, entrega bloqueada y verificación pública en informes, D11 y
Metrología.

## Por confirmar con el IDIC

- Qué tipos de documento deben exigir la FEA antes de entregarse y desde qué fecha.
- Si FirmaGob (o el token que usen) agrega la firma como actualización incremental o
  reescribe el PDF: en el segundo caso todo PDF caería en «no corresponde» y habría que
  aceptarlo como excepción. Conviene probar con un PDF real firmado por un jefe.
