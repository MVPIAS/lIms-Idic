# Integración con IBIS · registro balístico de las armas importadas

El IDIC todavía no tiene IBIS. El LIMS queda preparado para que, el día en que se instale, baste con
apuntar a la carpeta donde IBIS deja su archivo diario.

## El proceso

1. **DGMN.** La resolución de internación lista las armas. Con ella nace la orden de trabajo (OT) en
   *BPCH · SAEC › Certificación de armas*.
2. **Registro de entrada.** Se programa la recepción, se registra la llegada (aduana u oficinas del
   IDIC) y se firma el acta comparada con la resolución.
3. **Codificación** de cada arma: muestra de la OT, etiqueta con código de barras y acuñación.
4. **Clasificación.** El armero indica si el arma está **permitida o prohibida** en el país.
   - Si es **prohibida**, no sigue el camino de ensayos. Su permisibilidad queda «No cumple» y el
     informe de la OT lo dice.
   - Si es **permitida**, continúa con la inspección visual y los ensayos de su camino (CIP o prueba
     completa).
5. **Disparo de prueba en IBIS.** Cada arma se dispara y deja dos **evidencias de prueba**: la
   **vaina** y el **proyectil**. IBIS guarda su huella balística y las compara con las evidencias de
   delitos; una coincidencia es un **hit**.
6. **Archivo diario de IBIS.** IBIS deja cada día un XML con las armas y sus evidencias de prueba
   (ESI 3.2). El LIMS lo recoge solo:
   - el **arma** espera en «IBIS · armas importadas» hasta asociarse a su OT por el número de serie;
   - al asociarla, se crean en el **banco de evidencias** la vaina y el proyectil, ligados al arma y a
     la OT, cada uno con su código (EV-AAAA-NNNN) y su código de barras;
   - si un XML posterior trae un hit nuevo, el contador se actualiza en el arma y en sus evidencias.
7. **Certificado por arma.** Incluye el bloque «Registro balístico IBIS»: identificador, fecha de
   prueba, con o sin hit y sus evidencias. Sin resultado todavía, dice «Pendiente de IBIS».
8. **Custodia tipo biblioteca.** Cada evidencia tiene su **ubicación en texto** (por ejemplo
   «Almacén 1 · estante 3 · línea 4 · caja 5») y una **ficha imprimible** con código de barras, serie,
   marca, modelo, calibre, OT, fecha del disparo y ubicación.
9. **¿Dónde está?** Desde *BPCH · SAEC › ¿Dónde está la evidencia?* se busca por la serie del arma,
   el código de la evidencia o el número que trae un hit, y se ve dónde está guardada y si está
   prestada, a quién y hasta cuándo.
10. **Préstamos.** Fiscalía, PDI u otro organismo piden la evidencia: solicitud, aprobación, salida
    con acta, devolución y nueva ubicación, con la cadena de custodia.

## Lo que el LIMS lee del XML (ESI 3.2)

| Elemento | Qué se toma |
|---|---|
| `<Exhibit>` con `<Type>Firearm</Type>` | `UUID`, `ExhibitNumber`, `SerialNumber` (con él se asocia al arma de la OT), `Make`, `Model`, `Caliber`, `FirearmType`, `CountryOfOrigin`, `RegistrationDate`, `HitIndicator Count` |
| `<Exhibit>` con `<Type>Cartridge Case</Type>` (vaina) o `<Type>Bullet</Type>` (proyectil) | `UUID`, `ExhibitNumber`, **`TestFirearmExhibitUUID`** (el arma con la que se disparó), `Caliber`, `FiringPinShape`, `BreechFaceClassCharacteristics`, `LastAcquisitionDate` (fecha del disparo), `HitIndicator Count` |
| `<RemovedExhibits>` | Baja de lo que IBIS eliminó, salvo que ya sea una evidencia del banco |

- **Archivo de ejemplo:** `docs/ibis/ejemplo_internacion_PRUEBA.xml`. Tiene datos ficticios marcados
  «PRUEBA»: un arma, su vaina y su proyectil.
- **Repetición:** un archivo ya procesado no se vuelve a cargar, porque se controla su huella SHA-256.

## Puesta en marcha cuando exista IBIS

1. **Carpeta de IBIS.** Pedir al proveedor que IBIS deje el XML diario (exportación ESI 3.2,
   incremental de 24 h) en la carpeta compartida del servidor, `IBIS_DIR/entrada`.
2. **Barrido automático.** Activarlo en el servidor con `IBIS_CRON_HABILITADO=true` e
   `IBIS_CRON_HORA=02:00`, y en *Administración › IBIS* con la configuración activa.
3. **Prueba del recorrido.** Copiar el XML de ejemplo a la carpeta y pulsar «Barrer ahora» en
   *IBIS · armas importadas*. Asociar el arma a su OT y comprobar:
   - que se crean las dos evidencias;
   - que aparecen en «¿Dónde está?»;
   - que el certificado por arma muestra el bloque de IBIS.
4. **Datos de prueba.** Al terminar, dar de baja la OT y las evidencias marcadas «PRUEBA».
