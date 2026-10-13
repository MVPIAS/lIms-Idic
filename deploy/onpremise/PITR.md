# WAL archiving y PITR · LIMS IDIC

**Instituto de Investigaciones y Control del Ejército de Chile**
Recuperación a un instante concreto (Point-In-Time Recovery)

**AIUKEN** · Complemento de `GUIA_ONPREMISE.md` · Julio 2026

---

## 1. Qué resuelve y por qué

La copia de seguridad base del kit (`backup.sh`) hace un `pg_dump` **diario** a las
02:15. Es sólida y verificada, pero deja una **ventana de pérdida de hasta 24 h**:
si el disco de datos falla a las 14:00, se pierde todo lo introducido en el LIMS
desde el volcado de esa madrugada (órdenes de trabajo, resultados, cadena de
custodia).

El **WAL archiving + PITR** reduce esa ventana de **24 h a minutos** y, además,
permite restaurar a un **segundo concreto del pasado** — por ejemplo, al instante
justo *antes* de un borrado accidental o de una actualización que salió mal.

No sustituye a `backup.sh`; lo **complementa**:

| Mecanismo | Qué es | Cuándo | Sirve para |
|---|---|---|---|
| `backup.sh` (ya existente) | `pg_dump` lógico + MinIO + config, rotación GFS | Diario 02:15 | Copia portable, verificable, restauración completa o selectiva; migración entre servidores |
| `basebackup.sh` (**nuevo**) | Copia **física** con `pg_basebackup` | Semanal, dom 03:00 | Punto de partida del PITR |
| **WAL archiving** (**nuevo**) | Flujo continuo de segmentos WAL comprimidos | Continuo (cada commit / ≤5 min) | Rellenar el hueco entre basebackups → PITR |

```
  basebackup (dom 03:00) ──┐
   WAL  WAL  WAL  WAL  WAL  │ ← se puede restaurar a CUALQUIER punto de esta línea
  ─────────────────────────┴──────────────────────────────>  tiempo
   lun   mar   mié   jue   vie ...
```

---

## 2. Arquitectura

### 2.1 Archivado continuo de WAL

PostgreSQL escribe todos los cambios primero en el **WAL** (Write-Ahead Log), en
segmentos de 16 MB dentro de `pg_wal/`. Con `archive_mode=on`, cada vez que
completa un segmento (o cada `archive_timeout`), invoca `archive_command`, que en
este kit es:

```
archive_command = '/bin/sh /usr/local/bin/archive-wal.sh "%p" "%f" /walarchive'
```

El script `scripts/backup/archive-wal.sh`:

1. Comprime el segmento con gzip a un fichero **temporal** en `/walarchive`.
2. Lo publica con un `mv` **atómico** (`%f.gz`). Nunca deja un `.gz` a medias que
   PostgreSQL o `pg_archivecleanup` pudieran leer.
3. Es **idempotente**: si el segmento ya está archivado, devuelve OK sin
   reescribirlo.
4. **Sólo devuelve 0 si el segmento quedó escrito de forma duradera.** Si algo
   falla (disco lleno, permisos), devuelve error → PostgreSQL **retiene** el WAL y
   lo reintenta (ver §6, el riesgo del disco).

`/walarchive` es un **punto de montaje propio** sobre `${LIMS_BACKUP_DIR}/wal`
(disco de respaldo). No va bajo `/backup` porque el archivador corre como el
usuario `postgres` (uid 70 en la imagen alpine), **no como root**, y `/backup` es
`700` de root: el archivador no podría ni entrar. El instalador cede `/walarchive`
a `postgres` (paso 7).

### 2.2 Basebackup

`scripts/backup/basebackup.sh` ejecuta semanalmente:

```
pg_basebackup -Ft -z -Xstream --checkpoint=fast
```

- `-Ft -z`: formato tar comprimido (`base.tar.gz`, `pg_wal.tar.gz`).
- `-Xstream`: incluye el WAL generado *durante* el backup por una 2.ª conexión de
  replicación → el basebackup es **autoconsistente**.
- Verifica la integridad (`gzip -t` + `backup_manifest`), guarda el **primer WAL
  necesario** (`START_WAL`) y sella con `SHA256SUMS`.
- Rota (conserva `RETENCION_BASEBACKUPS`, por defecto 4) y **purga el WAL ya
  cubierto** con `pg_archivecleanup` (todo lo anterior al basebackup más antiguo
  retenido ya no hace falta).

### 2.3 Dónde vive todo

```
/srv/lims-backup/
├── diarios/ semanales/ mensuales/   ← backup.sh (pg_dump, GFS) — sin cambios
├── wal/                             ← WAL archivado y comprimido (montado en /walarchive)
│   ├── 0000000100000000000000A3.gz
│   └── ...
└── basebackups/                     ← basebackup.sh
    ├── 20260714-030000/
    │   ├── base.tar.gz  pg_wal.tar.gz  backup_manifest
    │   ├── START_WAL  MANIFIESTO.txt  SHA256SUMS
    └── ...
```

Todo bajo `${LIMS_BACKUP_DIR}` (700 root): entra en la **copia externa** del IDIC
(§7.6 de la guía) igual que el resto.

---

## 3. Parámetros elegidos y por qué

| Parámetro | Valor | Motivo |
|---|---|---|
| `wal_level` | `replica` | Nivel mínimo que permite archivar WAL y `pg_basebackup`. Es el valor por defecto en PG16; se fija explícito. |
| `archive_mode` | `on` | Activa el archivado. **Cambiarlo exige recrear el contenedor** (`up -d`), no basta un reload. |
| `archive_command` | script gzip atómico | Comprime (clave para el disco, ver §5) y nunca da un OK falso. |
| `archive_timeout` | `300` (5 min) | **Acota el RPO**: fuerza el cambio de segmento cada 5 min aunque haya poco tráfico, así un commit se archiva en ≤5 min. Bajarlo reduce el RPO pero genera más segmentos. |
| `wal_compression` | `on` | Comprime las imágenes de página completa *dentro* del WAL: menos WAL generado, archivado más rápido. |
| `max_wal_senders` | `10` (por defecto) | `pg_basebackup -Xstream` usa 2 conexiones de replicación; el defecto sobra. |
| `RETENCION_BASEBACKUPS` | `4` | Ventana PITR de ~1 mes hacia atrás (4 basebackups semanales + su WAL). |

---

## 4. RPO y RTO resultantes (números honestos)

**RPO** (Recovery Point Objective — cuántos datos se pueden perder):

| Escenario | RPO |
|---|---|
| **Antes** (solo `pg_dump` diario) | hasta **24 h** |
| Falla el disco de **datos**, sobrevive el de respaldo | **≤ 5 min** (`archive_timeout`): sólo las transacciones del segmento en curso aún sin archivar. En la práctica, menos. |
| Se pierde **el servidor entero** (incendio, robo) | = antigüedad de la **última copia externa** de `/srv/lims-backup` (cadencia que fija el IDIC, §7.6 de la guía). El WAL local se pierde con la máquina. |
| RPO ≈ **0** | Requiere **replicación en streaming** a un segundo servidor (réplica síncrona). **Fuera de alcance**: el LIMS del IDIC es de servidor único. |

> El salto real de este trabajo: de **24 h** a **≈5 min** de ventana de pérdida
> ante el fallo más probable (disco de datos), sin coste de licencia ni hardware
> adicional más allá del disco de respaldo que ya se recomienda.

**RTO** (Recovery Time Objective — cuánto se tarda en recuperar):

- Un PITR **no es instantáneo**; sirve para recuperar *correctamente*, no
  *rápido*. Tiempo ≈ desplegar el basebackup (minutos) + **reproducir el WAL**
  desde el basebackup hasta el instante objetivo.
- El WAL a reproducir es, como mucho, el de **una semana** (hasta el basebackup
  anterior). Estimación típica para esta base: **10–40 min** hasta tener la
  instancia recuperada en pie. Cuanto más cerca esté el objetivo de un basebackup,
  menos WAL hay que reproducir y más rápido termina.
- Después, llevar los datos a producción (§8) añade el tiempo de un `pg_dump` +
  `pg_restore`.

---

## 5. Requisitos de disco

- **Segmento WAL** = 16 MB en `pg_wal`. Con `archive_timeout=300s`, en reposo se
  fuerza uno cada 5 min. Sin comprimir serían ~4,6 GB/día de segmentos casi
  vacíos; **gzip los reduce a unos pocos KB cada uno** (comprimen casi a cero
  porque van casi vacíos). En reposo, el archivo de WAL crece **unos MB/día**.
- **Bajo carga**, el volumen de WAL archivado ≈ 40–60 % del WAL bruto generado
  (`wal_compression` ya recorta las imágenes de página). Regla práctica para
  dimensionar: *WAL archivado/día ≈ 0,4 × (WAL bruto/día)*.
- **Basebackup**: cada uno ocupa aproximadamente el tamaño de la base **comprimida**
  (~0,3–0,6 × el tamaño de la base, según datos e índices). Con
  `RETENCION_BASEBACKUPS=4` → ~4 × ese tamaño.
- **Total PITR** en el disco de respaldo ≈ *(4 × basebackup) + (WAL de ~1 mes)*.
  El disco de respaldo de **1 TB** que recomienda §2.1 de la guía lo absorbe con
  holgura para el volumen esperado de un LIMS de laboratorio.

> La **purga automática** (`basebackup.sh` con `pg_archivecleanup`) impide que el
> WAL crezca sin límite: al rotar un basebackup se recicla el WAL que ya no
> respalda ningún basebackup retenido.

---

## 6. Qué vigilar — el riesgo real: `archive_command` fallando

Éste es **el** riesgo que hay que entender antes de activar PITR:

> Si `archive_command` **falla de forma persistente**, PostgreSQL **retiene** los
> segmentos WAL en `pg_wal` (no los recicla) y los **reintenta indefinidamente**.
> `pg_wal` crece sin parar y, al **llenar el disco de datos**, PostgreSQL **SE
> DETIENE**. El LIMS deja de funcionar.

Causas típicas de fallo del archivado:
- El disco de respaldo (o el NAS) se **desmonta** o se **llena**.
- `/walarchive` deja de pertenecer a `postgres` (permisos).
- Un error en el propio `archive_command`.

**Vigilancia (ya integrada en la monitorización del kit):**

`monitorizacion/chequeo-salud.sh` (cada 5 min) añade un bloque **7 · WAL archiving
y basebackup** que comprueba:

| Señal | Fuente | Alerta si |
|---|---|---|
| Backlog de segmentos sin archivar | `pg_wal/archive_status/*.ready` | `> 20` (**crítico**: pg_wal se llenará) |
| Antigüedad del último WAL archivado | `pg_stat_archiver.last_archived_time` | `> 2 h` (con `archive_timeout=300s` debería llegar uno cada 5 min) |
| Fallos del archivador | `pg_stat_archiver.failed_count` | `> 3` en 1 h |
| Frescura del basebackup | `.ultimo-basebackup` | Falló, o `> 8 días` |

Con la monitorización de **nivel 2** (Prometheus, opcional), `alertas.yml` incluye
`LimsWalArchivadoAtascado` (crítica), `LimsWalArchivadoParado`,
`LimsWalFallosArchivado`, `LimsBasebackupFallido` y `LimsBasebackupAntiguo`.

**Si salta la alerta de WAL atascado, actúe YA:**

```bash
cd /opt/lims-idic
C="docker compose -f docker-compose.onpremise.yml --env-file .env"

# 1. ¿Qué dice el archivador?
$C exec postgres psql -U lims -d lims_idic -c "SELECT * FROM pg_stat_archiver;"

# 2. ¿Existe y tiene espacio el destino? ¿Es de postgres?
$C exec postgres sh -c 'ls -lad /walarchive; df -h /walarchive'
df -h /srv/lims-backup

# 3. Si /walarchive no es de postgres (p.ej. tras remontar el NAS), devuélvaselo:
$C exec -u 0 postgres sh -c 'chown postgres:postgres /walarchive && chmod 700 /walarchive'

# 4. Cuánto WAL retenido lleva acumulado (margen antes de llenar el disco):
$C exec postgres sh -c 'ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready | wc -l'
```

En cuanto el destino vuelve a estar disponible y escribible, PostgreSQL **archiva
el atraso solo** y `pg_wal` se vacía. No se pierde WAL: sólo estaba retenido.

---

## 7. Cómo se hace un PITR (paso a paso)

`scripts/backup/restore-pitr.sh` **siempre** restaura a una **instancia y volumen
separados** (un contenedor `lims-postgres-pitr` aislado, sin red ni puertos).
**Nunca toca la base productiva.**

**Paso 0 · Ver qué hay disponible y elegir el instante**

```bash
sudo /opt/lims-idic/scripts/backup/restore-pitr.sh --listar
```

Muestra los basebackups y la ventana de WAL (desde el basebackup más antiguo
hasta el último segmento archivado). Elija un `--target-time` **dentro** de esa
ventana.

**Paso 1 · Restaurar al instante deseado**

```bash
sudo /opt/lims-idic/scripts/backup/restore-pitr.sh \
     --target-time "2026-07-17 14:35:00"
```

El script, tras una **confirmación explícita** (`RESTAURAR PITR`):

1. Elige el basebackup válido (el más reciente **anterior** al objetivo).
2. Verifica su integridad (checksums + `gzip -t`).
3. Despliega el basebackup en un volumen **separado** (`/srv/lims-backup/
   restauracion-pitr/<fecha>`, o el que indique con `--a-directorio`).
4. Configura la recuperación: `restore_command` (descomprime desde `/walarchive`)
   y `recovery_target_time`.
5. Levanta la instancia aislada, **reproduce el WAL hasta el instante** y se
   detiene ahí (`recovery_target_action=promote`).
6. Verifica: recuento de tablas y filas, y el último LSN reproducido.

**Paso 2 · Inspeccionar el resultado**

```bash
docker exec -it lims-postgres-pitr psql -U lims -d lims_idic
# p.ej.:  SELECT count(*) FROM orden_trabajo;  -- ¿es el estado esperado?
```

**Paso 3 · Llevar los datos a producción (si es el estado correcto)**

El PITR deja los datos en una instancia aparte. Para llevarlos a la base viva se
usa la vía ya probada de `restore.sh` (con su simulacro y salvaguardas):

```bash
# 1. Extraer un dump de la instancia recuperada:
docker exec lims-postgres-pitr \
  pg_dump -U lims -d lims_idic -Fc -Z6 --no-owner --no-privileges \
  -f /var/lib/postgresql/data/recuperado.dump
docker cp lims-postgres-pitr:/var/lib/postgresql/data/recuperado.dump \
  /srv/lims-backup/pitr-recuperado/

# 2. Probar SIEMPRE primero en una base temporal (no toca producción):
sudo /opt/lims-idic/scripts/backup/restore.sh \
     --desde /srv/lims-backup/pitr-recuperado --a-bd-temporal verificacion_pitr

# 3. Sólo si el recuento es correcto, sobre producción (destructivo, exige frase):
sudo /opt/lims-idic/scripts/backup/restore.sh \
     --desde /srv/lims-backup/pitr-recuperado --sobre-produccion
```

**Paso 4 · Liberar el disco**

```bash
sudo /opt/lims-idic/scripts/backup/restore-pitr.sh --descartar   # para/borra el contenedor
sudo rm -rf /srv/lims-backup/restauracion-pitr/<fecha>           # borra el volumen
```

---

## 8. Operación diaria

```bash
cd /opt/lims-idic
C="docker compose -f docker-compose.onpremise.yml --env-file .env"

# Estado del archivador
$C exec postgres psql -U lims -d lims_idic -c "SELECT * FROM pg_stat_archiver;"

# Forzar un basebackup ahora (además del semanal)
sudo ./scripts/backup/basebackup.sh

# Verificar el último basebackup sin crear otro
sudo ./scripts/backup/basebackup.sh --solo-verificar

# Reciclar WAL ya cubierto sin crear basebackup
sudo ./scripts/backup/basebackup.sh --solo-purgar-wal

# Ver basebackups y ventana PITR disponible
sudo ./scripts/backup/restore-pitr.sh --listar

# Temporizadores
systemctl list-timers lims-*     # incluye lims-basebackup.timer (dom 03:00)
journalctl -u lims-basebackup --since "8 days ago"
```

---

## 9. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `pg_stat_archiver`: `failed_count` sube, `archived_count` no | `/walarchive` no es de `postgres` o el disco está lleno/desmontado | §6, paso 3: `chown postgres:postgres /walarchive`; libere/monte el disco |
| Backlog de `.ready` creciendo | Archivado atascado | §6. En cuanto se resuelve, se archiva el atraso solo |
| `pg_basebackup: FATAL ... replication` | `pg_hba.conf` no permite `local replication` | La imagen lo trae por defecto (`local replication all trust`); si se endureció, reañádalo |
| PITR: "recovery_target_time is before ..." | El objetivo es anterior al basebackup elegido | Elija `--target-time` posterior, o un basebackup más antiguo |
| PITR se detiene al final del WAL sin llegar al objetivo | El objetivo es **posterior** al último WAL archivado | Elija un instante dentro de la ventana (`--listar`) |
| `archive_mode` no se activa | Se cambió en caliente | Recree el contenedor: `docker compose ... up -d` (no basta un reload) |

---

## 10. Validación realizada

El ciclo completo se probó de forma **aislada** (contenedores y volúmenes
desechables, borrados al terminar) reproduciendo la mecánica exacta del kit:

1. ✅ `archive_command` → `archive-wal.sh` archiva cada segmento **comprimido y
   atómico** en `/walarchive`; integridad `gzip -t` correcta.
2. ✅ `local replication all trust` está en el `pg_hba.conf` por defecto de
   `postgres:16-alpine` → `pg_basebackup -Ft -z -Xstream` funciona por el socket
   local.
3. ✅ Se derivó el `START_WAL` del `backup_manifest` (`pg_walfile_name`).
4. ✅ **PITR real**: partiendo del basebackup, con `restore_command`
   (`gunzip` desde `/walarchive`) y `recovery_target_time`, la instancia reprodujo
   el WAL y **se detuvo justo antes del borrado accidental**. La base recuperada
   contenía **exactamente el estado del instante objetivo** (se comprobó el
   recuento de filas), **sin** las operaciones posteriores al objetivo. La base
   primaria quedó **intacta**.
5. ✅ `pg_archivecleanup -x .gz` recicla correctamente el WAL anterior al
   `START_WAL` del basebackup más antiguo, conservando el resto.
6. ⚠ Detalle detectado y corregido en la validación: en `postgres:16-alpine` el
   usuario `postgres` es **uid 70** (no 999), y el archivador **no** corre como
   root; por eso `/walarchive` es un montaje propio cedido a `postgres` desde
   dentro del contenedor (acierta con el uid sea cual sea la imagen), en lugar de
   ir bajo `/backup` (700 root, intransitable para el archivador).

> No se probó sobre el servidor real del IDIC ni sobre la preproducción cloud. El
> procedimiento de restauración a producción (§7, paso 3) reutiliza `restore.sh`,
> ya validado en el kit. La orquestación en shell de los tres scripts nuevos se
> verificó por revisión; la mecánica novedosa (archivado, basebackup, replay PITR,
> purga) se probó de extremo a extremo como se describe arriba.

---

**AIUKEN** · LIMS IDIC · WAL archiving y PITR · Julio 2026
Complemento técnico de `GUIA_ONPREMISE.md` para el IDIC del Ejército de Chile.
