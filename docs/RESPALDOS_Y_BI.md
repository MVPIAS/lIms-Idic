# Respaldos programados e inteligencia de negocio (Metabase)

Contrato LIMS IDIC: **§4.8.4** (respaldos) y **§4.7.5 / §4.5.7 / §4.6.5** (inteligencia de negocio).
Código: `scripts/backup/respaldo-programado.sh`, `scripts/metabase/`, `apps/api/src/sistema/`,
pantallas `/admin/respaldos` y `/bi`, SQL `packages/db/align_brechas_6.sql`.

---

## 1. Respaldos de la base de datos

### 1.1 Qué respalda y quién

| Despliegue | Quién hace el respaldo | Dónde quedan |
|---|---|---|
| Preproducción (`docker-compose.prod.yml`) | Servicio **`respaldo`** (contenedor `lims-respaldo`, imagen `postgres:16-alpine`) | `RESPALDO_HOST_DIR` del `.env` (por defecto `/opt/lims-idic/respaldos`) |
| On-premise (`docker-compose.onpremise.yml`) | `scripts/backup/backup.sh` por systemd (`lims-backup.timer`, 02:15) + WAL/PITR + exportación portable cifrada | `/srv/lims-backup` (ver `deploy/onpremise/GUIA_ONPREMISE.md` §7) |

Los dos registran cada ejecución en la tabla **`respaldo_registro`** (fecha, tamaño, duración, resultado y mensaje) y su política en **`respaldo_servicio`**, que es lo que muestra la pantalla **Administración › Respaldos**.

El servicio `respaldo` reutiliza las reglas de `backup.sh`:

- `pg_dump -Fc -Z6 --no-owner --no-privileges` (comprimido, restaurable en cualquier PostgreSQL 16 sin depender de los roles);
- **verificación**: `pg_restore --list` debe recorrer el archivo y declarar más de 100 objetos; si no, la copia se descarta y queda como **Falló**;
- la base de Metabase (`lims_metabase`) se vuelca aparte (`metabase-<fecha>.dump`);
- `SHA256SUMS` y `MANIFIESTO.txt` en cada carpeta;
- el respaldo del domingo se **promociona a semanal por enlace duro** (no ocupa espacio extra);
- rotación: se conservan los N diarios y M semanales más recientes; lo demás se borra.

Estructura: `respaldos/diarios/AAAAMMDD-HHMMSS/lims_idic-AAAAMMDD-HHMMSS.dump` y `respaldos/semanales/…`.

### 1.2 Política (configurable sin reiniciar)

**Parámetros del sistema › «Respaldos de la base de datos»** (permiso `catalogo.gestionar`). El servicio los relee cada minuto.

| Parámetro | Por defecto | Efecto |
|---|---|---|
| Hora del respaldo diario | 2 (02:00 hora de Chile) | Si cambia la hora a una que ya pasó hoy, se hace un respaldo enseguida |
| Respaldos diarios que se conservan | 14 | |
| Respaldos semanales (domingo) | 8 | 0 = sin semanales |
| Horas sin respaldo correcto para el rojo | 26 | Estado en rojo y aviso diario a los administradores |
| Avisar a los administradores | Sí | Aviso en «Mi bandeja» (y correo si está configurado) por cada fallo y una vez al día si se atrasa |

Mientras la base no tenga esos parámetros rigen `RESPALDO_HORA`, `RESPALDO_RETENCION_DIARIOS` y `RESPALDO_RETENCION_SEMANALES` del `.env`.
Al arrancar, si no hay respaldo del último turno (p. ej. el servidor estaba apagado a las 02:00), el servicio lo hace en ese momento.

### 1.3 Pantalla y avisos

**Administración › Respaldos** (permiso `admin.respaldos`: roles Administración y Superadministración):

- estado **verde** («Respaldo al día») o **rojo** («Respaldo con problemas») con los motivos: último respaldo fallido, último correcto con más de 26 h, servicio sin señal más de 5 min o no instalado;
- último respaldo, próximo programado, estado del servicio (espacio libre, carpeta), política de retención;
- historial de las 60 últimas ejecuciones (n.º, tipo, inicio, duración, tamaño, resultado, archivo «en disco» o «ya rotado», mensaje);
- botón **«💾 Respaldar ahora»**: deja una solicitud que el servicio empieza en menos de un minuto (solo en preproducción: en on-premise el respaldo lo lanza systemd).

La API revisa cada 15 minutos y avisa a quien tenga `admin.respaldos` (aviso de tipo «respaldo», severidad alta, enlace a la pantalla).

### 1.4 Puesta en marcha en el servidor de preproducción

En `/opt/lims-idic`, como root (todos los bloques de esta guía suponen las variables del `.env` cargadas):

```bash
cd /opt/lims-idic && set -a && . ./.env && set +a
# 1. Código y SQL nuevo (las tablas deben existir antes de arrancar el servicio)
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < packages/db/align_brechas_6.sql
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < packages/db/align_cierre_permisos.sql

# 2. (opcional) carpeta propia para los respaldos en el .env: RESPALDO_HOST_DIR=/srv/lims-respaldos
# 3. Construir y arrancar
docker compose -f docker-compose.prod.yml --env-file .env build api web
docker compose -f docker-compose.prod.yml --env-file .env up -d api web respaldo

# 4. Comprobar: el primer respaldo se hace al arrancar
docker logs -f lims-respaldo          # «═══ Correcto · … bytes · … s»
ls -l /opt/lims-idic/respaldos/diarios/
```

Respaldo inmediato desde la consola (además del botón de la pantalla):

```bash
docker compose -f docker-compose.prod.yml run --rm respaldo --ahora
```

### 1.5 Cómo restaurar

> Restaurar es una tarea del administrador de la plataforma en el servidor, nunca desde el LIMS. **Primero siempre a una base de prueba.**

**Verificar el archivo elegido** (la pantalla indica su nombre y si sigue en disco):

```bash
cd /opt/lims-idic/respaldos/diarios/20261104-020000 && sha256sum -c SHA256SUMS
```

**A una base de prueba** (no toca la base en uso; sirve también de simulacro periódico):

```bash
cd /opt/lims-idic
C=docker-compose.prod.yml
docker compose -f $C run --rm --entrypoint createdb respaldo prueba_restauracion
docker compose -f $C run --rm --entrypoint pg_restore respaldo --no-owner --no-privileges \
  -d prueba_restauracion /respaldos/diarios/20261104-020000/lims_idic-20261104-020000.dump
docker compose -f $C exec -T postgres psql -U "$POSTGRES_USER" -d prueba_restauracion \
  -c "SELECT count(*) AS ot FROM orden_trabajo" -c "SELECT count(*) AS resultados FROM resultado"
# Al terminar:
docker compose -f $C exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c 'DROP DATABASE prueba_restauracion'
```

**Sobre la base en uso** (solo ante una pérdida real de datos; todo lo registrado después del respaldo se pierde):

```bash
cd /opt/lims-idic; C=docker-compose.prod.yml; F=/respaldos/diarios/20261104-020000/lims_idic-20261104-020000.dump
docker compose -f $C run --rm respaldo --ahora                       # copia del estado actual ANTES de sobrescribir
docker compose -f $C stop api web respaldo metabase                  # libera las conexiones
docker compose -f $C exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"${POSTGRES_DB}_anterior_$(date +%Y%m%d%H%M)\""
docker compose -f $C exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose -f $C run --rm --entrypoint pg_restore respaldo --no-owner --no-privileges -d "$POSTGRES_DB" "$F"
# Ajustes de la base que no viajan en el volcado: zona horaria y permisos del usuario de solo lectura
for f in align_zona_horaria.sql align_brechas_6.sql; do
  docker compose -f $C exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < packages/db/$f
done
docker compose -f $C up -d api web respaldo metabase
```

La base renombrada (`…_anterior_…`) es la vuelta atrás: bórrela solo cuando se haya comprobado la restauración.
Los tableros de Metabase se recuperan igual con `metabase-<fecha>.dump` sobre la base `lims_metabase` (con Metabase detenido).

En **on-premise** use los procedimientos de `deploy/onpremise/GUIA_ONPREMISE.md`: §7.4 simulacro (`restore.sh --a-bd-temporal`), §7.5 restauración real (`restore.sh --sobre-produccion`), §7.7 recuperación a un instante (PITR) y §7.8 exportación portable cifrada SQL/CSV.

### 1.6 Copia fuera del servidor

Un respaldo en el mismo disco no protege de la pérdida del servidor. Copie periódicamente la carpeta de respaldos a otro equipo o almacenamiento (en on-premise, la exportación portable cifrada de §7.8 de la guía).

---

## 2. Inteligencia de negocio (Metabase)

Metabase corre en el subdominio **`bi.<DOMAIN>`** (bloque `bi.{$DOMAIN}` del `Caddyfile`) con su propia base (`lims_metabase`). Lee la base del LIMS con el usuario **`lims_lectura`**: solo lectura (`default_transaction_read_only`), máximo 120 s por consulta y 10 conexiones, sin acceso a contraseñas, segundo factor ni la clave del correo (`usuario.password_hash`, `usuario.totp_secret`, `usuario.token_version`, `configuracion_correo`).

En el LIMS: **Reportes y comunicación › Análisis e inteligencia de negocio (Metabase)** (permiso `reporte.ver`) abre Metabase en otra pestaña. La dirección sale de la variable `URL_BI` de la API (por defecto `https://bi.<DOMAIN>`); si está vacía o no es una URL, la pantalla dice que no está configurado.

### 2.1 Versión fija

`docker-compose.prod.yml` usa `metabase/metabase:v0.64.5.1` (línea LTS 0.64) en lugar de `latest`. **Metabase no puede volver a una versión anterior sobre su base.** Antes del primer despliegue con versión fija, compruebe la versión que corre hoy:

```bash
docker exec lims-metabase curl -s http://localhost:3000/api/session/properties | grep -o '"tag":"[^"]*"'
```

Si es **posterior** a v0.64.5.1, ponga esa versión en el `.env` (`METABASE_IMAGE=metabase/metabase:<versión>`). Para subir de versión más adelante: respaldo (incluye `lims_metabase`), cambiar `METABASE_IMAGE`, `docker compose … up -d metabase`.

### 2.2 Puesta en marcha

```bash
cd /opt/lims-idic
# 1. DNS: registro A de bi.<DOMAIN> hacia la IP del servidor (Caddy saca el certificado solo).
# 2. .env:
echo "METABASE_LECTURA_PASSWORD=$(openssl rand -hex 24)" >> .env
#    (opcional) URL_BI=https://bi.<DOMAIN>   ·   METABASE_IMAGE=… si aplica §2.1
# 3. SQL align_brechas_6.sql aplicado (§1.4) y servicios al día
docker compose -f docker-compose.prod.yml --env-file .env up -d metabase api
# 4. Usuario de solo lectura con la contraseña del .env
bash scripts/metabase/crear-usuario-lectura.sh
# 5. Alta de la base y tableros (pide la contraseña del administrador de Metabase;
#    si Metabase está recién instalado, crea ese administrador)
MB_ADMIN_EMAIL=<correo del administrador de Metabase> python3 scripts/metabase/configurar-metabase.py
```

`configurar-metabase.py` es idempotente: da de alta la base **«LIMS IDIC (solo lectura)»** y la colección **«LIMS IDIC»** con tres tableros sobre las vistas `bi_*`:

| Tablero | Preguntas | Vista |
|---|---|---|
| Órdenes de trabajo por estado y mes | OT por mes y estado · OT por laboratorio y estado | `bi_ot_estado_mes` |
| Plazos de las órdenes de trabajo | OT abiertas por situación de plazo · Cumplimiento del plazo de las OT cerradas por mes · OT abiertas vencidas | `bi_ot_plazos`, `bi_ot_cumplimiento_mes` |
| Resultados «No cumple» por laboratorio | No cumple por laboratorio · No cumple por mes y laboratorio | `bi_resultado_no_cumple_lab` |

Las personas que usarán Metabase se crean en Metabase › Administración › Personas (su ingreso es distinto al del LIMS).

### 2.3 Si no hay asistente en Python

Desde el navegador en `https://bi.<DOMAIN>`: Administración › Bases de datos › Agregar › PostgreSQL, host `postgres`, puerto `5432`, base `$POSTGRES_DB`, usuario `lims_lectura` y la contraseña de `METABASE_LECTURA_PASSWORD`. Las preguntas de los tableros son consultas SQL nativas sobre las vistas de la tabla anterior (el texto exacto está en `scripts/metabase/configurar-metabase.py`).
