# Guía de despliegue on-premise · LIMS IDIC

**Instituto de Investigaciones y Control del Ejército de Chile**
Documento técnico de instalación, operación y contingencia

**AIUKEN** · Versión 1.0 · Julio 2026

---

## Índice

1. [Alcance y arquitectura](#1-alcance-y-arquitectura)
2. [Requisitos de hardware, sistema operativo y red](#2-requisitos)
3. [Preparación del servidor](#3-preparación-del-servidor)
4. [Certificados TLS](#4-certificados-tls)
5. [Instalación](#5-instalación)
6. [Verificación de la puesta en marcha](#6-verificación)
7. [Copias de seguridad y restauración](#7-copias-de-seguridad-y-restauración)
8. [Monitorización](#8-monitorización)
9. [Diagnóstico de averías](#9-diagnóstico-de-averías)
10. [Actualización de versión](#10-actualización-de-versión)
11. [Vuelta atrás (rollback)](#11-vuelta-atrás-rollback)
12. [Anexos](#12-anexos)

---

## 1. Alcance y arquitectura

### 1.1 Qué cubre este documento

La instalación del LIMS IDIC en un servidor **propio del Ejército**, **aislado de Internet**, con datos reales del laboratorio. No cubre el entorno de preproducción en la nube, que se documenta aparte (`guia_despliegue_preprod.html`).

Las dos instalaciones son deliberadamente distintas. Conviene tener presente en qué:

| Aspecto | Preproducción (nube) | **Producción on-premise (este documento)** |
|---|---|---|
| Imágenes Docker | Se construyen en el servidor (`--build`) | **Llegan construidas en `.tar` y se cargan con `docker load`** |
| Certificado TLS | Let's Encrypt automático (ACME) | **Certificado de la CA del Ejército, sin ACME** |
| Salida a Internet | Sí | **No. Ninguna** |
| Datos | Sintéticos (seeds de demostración) | **Reales del IDIC. Sin datos demo** |
| Reinicio | `unless-stopped` | **`always`** (recuperación sola tras corte de luz) |
| Almacenamiento | Volúmenes Docker con nombre | **Rutas de host** (respaldo trivial) |
| Monitorización | Ninguna | **Local: chequeo + alertas por correo interno** |

### 1.2 Componentes

Siete contenedores sobre una única red Docker (`lims-idic`):

```
                    Red del cuartel
                          │
                    :443 (HTTPS)
                          │
                   ┌──────▼──────┐
                   │    Caddy    │  TLS con certificado del Ejército
                   │  (proxy)    │  Único componente con puertos publicados
                   └──┬───────┬──┘
             /api/*   │       │   resto
                   ┌──▼──┐ ┌──▼──┐
                   │ API │ │ Web │       API: NestJS · Web: Next.js
                   └──┬──┘ └─────┘
          ┌───────────┼───────────┐
     ┌────▼────┐ ┌────▼───┐ ┌─────▼────┐   ┌──────────┐
     │Postgres │ │ Redis  │ │  MinIO   │   │ Metabase │
     │  (BD)   │ │(colas) │ │(archivos)│   │   (BI)   │
     └─────────┘ └────────┘ └──────────┘   └──────────┘
        ── Sin puertos publicados: solo accesibles por la red interna ──
```

> **Nota de seguridad.** Solo Caddy publica puertos (80 y 443). PostgreSQL, Redis, MinIO y Metabase **no son accesibles desde la red del cuartel**: solo desde dentro de la red Docker. Esto es intencionado y no debe modificarse sin una evaluación de seguridad.

### 1.3 Dónde viven los datos

Todo el estado persistente está bajo `LIMS_DATA_DIR` (por defecto `/srv/lims-idic`):

```
/srv/lims-idic/
├── postgres/     Base de datos (muestras, ensayos, resultados, custodia)
├── minio/        Documentos, informes y certificados firmados
├── redis/        Colas de trabajo
├── metabase/     Complementos de BI
├── certs/        Certificado y clave TLS   ← permisos 700
└── caddy/        Estado y registro de accesos del proxy

/srv/lims-backup/ Copias de seguridad         ← permisos 700
├── diarios/      7 últimas
├── semanales/    4 últimas
└── mensuales/    12 últimas
```

**Esto es lo único que hay que respaldar.** Se usan rutas de host en vez de volúmenes Docker precisamente para que la copia, la auditoría y la migración a otro servidor sean operaciones triviales de sistema de ficheros.

---

## 2. Requisitos

### 2.1 Hardware

| Recurso | Mínimo | **Recomendado** | Motivo |
|---|---|---|---|
| CPU | 4 núcleos | **8 núcleos** | PostgreSQL y Metabase compiten al generar informes |
| RAM | 8 GB | **16 GB** | El compose configura `shared_buffers=2GB` para 16 GB |
| Disco sistema/datos | 200 GB SSD | **500 GB SSD** | Base + documentos + histórico |
| Disco de respaldo | 200 GB | **1 TB, disco distinto** | Un respaldo en el mismo disco no protege de un fallo físico |

> **Aviso.** Con menos de 16 GB de RAM hay que ajustar `shared_buffers` y `effective_cache_size` en `docker-compose.onpremise.yml`. La regla habitual: `shared_buffers` = 25 % de la RAM, `effective_cache_size` = 50-75 %.

> **Aviso.** El disco de respaldo debe ser una **unidad física distinta** (o un NAS montado). Si `/srv/lims-idic` y `/srv/lims-backup` comparten disco, un fallo del disco se lleva por delante los datos *y* las copias a la vez.

### 2.2 Sistema operativo

- **Ubuntu Server 22.04 LTS o 24.04 LTS** (validado por Aiuken), o Rocky/Alma Linux 9.
- Arquitectura **x86_64**. Las imágenes del kit son `linux/amd64`.
- Docker Engine **24+** con el complemento `docker compose` **v2**.
- **No se requiere Windows Server ni ninguna licencia de pago.** La solución completa es software libre: PostgreSQL, Redis, MinIO, Caddy, Metabase y Docker. Coste de licencia: cero.

### 2.3 Red

| Elemento | Valor |
|---|---|
| IP | Fija, asignada por el IDIC |
| Nombre DNS | Debe resolver en el DNS interno **y coincidir con el certificado** |
| Puertos entrantes | 443/tcp (usuarios), 80/tcp (redirección), 22/tcp (administración) |
| Salida a Internet | **Ninguna.** El sistema está diseñado para no necesitarla |
| NTP | Servidor horario interno **obligatorio** (ver §3.3) |
| Relay SMTP | Interno, para las alertas (ver §8) |

---

## 3. Preparación del servidor

### 3.1 Instalar Docker sin Internet

El instalador **no puede** descargar Docker: en el cuartel no hay red. Debe estar presente de antemano. Dos vías:

**Opción A · Repositorio interno del Ejército** (preferible, si existe):

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

**Opción B · Paquetes `.deb` desde el USB.** Descárguelos en la máquina con Internet:

```bash
# En la máquina CON Internet
mkdir -p docker-offline && cd docker-offline
apt-get download docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Copie el directorio al USB junto con el kit
```

En el servidor del IDIC:

```bash
sudo dpkg -i ./docker-offline/*.deb
sudo systemctl enable --now docker
docker --version && docker compose version   # debe responder ambas
```

### 3.2 Cortafuegos

```bash
sudo ufw allow 22/tcp      # administración (restrinja el origen si es posible)
sudo ufw allow 80/tcp      # redirección a HTTPS
sudo ufw allow 443/tcp     # LIMS
sudo ufw --force enable
sudo ufw status verbose
```

> **Recomendación.** Limite el acceso SSH a la subred de administración:
> `sudo ufw allow from 10.x.x.0/24 to any port 22 proto tcp`

### 3.3 Hora del sistema (no es un detalle menor)

Un reloj desviado provoca tres problemas reales: el certificado TLS se considera inválido, los sellos de tiempo de la **cadena de custodia** dejan de ser fiables (con las consecuencias legales que eso tiene en un peritaje), y las copias de seguridad se ordenan mal.

```bash
sudo timedatectl set-timezone America/Santiago
# Apunte al servidor NTP interno del cuartel:
sudo sed -i 's/^#*NTP=.*/NTP=ntp.interno.ejercito.cl/' /etc/systemd/timesyncd.conf
sudo systemctl restart systemd-timesyncd
timedatectl status    # "System clock synchronized: yes"
```

### 3.4 Comprobación previa

El instalador puede diagnosticar sin tocar nada:

```bash
sudo ./instalar-onpremise.sh --solo-verificar
```

---

## 4. Certificados TLS

### 4.1 Por qué no hay Let's Encrypt

Let's Encrypt valida el dominio conectándose al servidor **desde Internet**. Sin salida a Internet ni dominio público, es imposible por diseño. Por eso el `Caddyfile.onpremise` lleva `auto_https disable_certs` y una directiva `tls` explícita.

> Si esa línea se quitara, Caddy intentaría contactar con `acme-v02.api.letsencrypt.org` en cada arranque, agotaría los reintentos durante varios minutos y **dejaría de escuchar en el 443**. Es la causa más probable de un "no arranca y no sé por qué" en esta instalación.

### 4.2 Opción recomendada: certificado de la CA del Ejército

Solicite al área correspondiente un certificado de servidor con:

- **CN**: el nombre DNS del servidor (p. ej. `lims.idic.ejercito.cl`)
- **SAN**: el mismo nombre **y** `bi.<dominio>` para el módulo de BI
- Vigencia: la máxima que permita la política interna
- Clave privada **sin contraseña** (Caddy arranca desatendido; una clave con passphrase impediría el arranque automático tras un corte de luz)

Instalación:

```bash
sudo mkdir -p /srv/lims-idic/certs
# lims.crt = certificado del servidor + cadena intermedia CONCATENADA, en este orden
sudo cp servidor.crt intermedia.crt > /srv/lims-idic/certs/lims.crt   # o: cat servidor.crt intermedia.crt > lims.crt
sudo cp servidor.key /srv/lims-idic/certs/lims.key
sudo chmod 600 /srv/lims-idic/certs/lims.key
sudo chmod 644 /srv/lims-idic/certs/lims.crt
sudo chown root:root /srv/lims-idic/certs/*
```

> **Error frecuente.** Si falta la cadena intermedia, algunos navegadores aceptan el certificado y otros no, de forma aparentemente aleatoria. Concatene siempre el intermedio detrás del certificado del servidor.

Compruebe la correspondencia entre certificado y clave (el instalador también lo hace, y aborta si no coinciden):

```bash
openssl x509 -noout -modulus -in /srv/lims-idic/certs/lims.crt | openssl md5
openssl rsa  -noout -modulus -in /srv/lims-idic/certs/lims.key | openssl md5
# Los dos hashes deben ser IDÉNTICOS
```

### 4.3 Opción provisional: autofirmado

Solo para pruebas de aceptación. Los navegadores mostrarán un aviso de seguridad.

```bash
sudo ./instalar-onpremise.sh --autofirmado
```

Para que el aviso desaparezca en los puestos del laboratorio, distribuya `lims.crt` como CA de confianza mediante GPO/Ansible. **Aun así, lo correcto en producción es un certificado de la CA del Ejército.**

### 4.4 Renovación (tarea planificada, no automática)

**No hay renovación automática.** El sistema avisa por correo 30 días antes de la caducidad (§8). Al recibir el aviso:

```bash
sudo cp nuevo.crt /srv/lims-idic/certs/lims.crt
sudo cp nuevo.key /srv/lims-idic/certs/lims.key
sudo chmod 600 /srv/lims-idic/certs/lims.key
# Recarga sin cortar el servicio:
cd /opt/lims-idic && docker compose -f docker-compose.onpremise.yml restart caddy
```

Verifique: `echo | openssl s_client -connect localhost:443 -servername $DOMAIN 2>/dev/null | openssl x509 -noout -dates`

---

## 5. Instalación

### 5.1 Fase 1 · Preparar el kit (máquina CON Internet)

Esta es la **única** fase que necesita Internet, y **no** ocurre en el IDIC.

```bash
cd lims-idic/deploy/onpremise        # el kit vive dentro del propio repositorio
./exportar-imagenes.sh --version 1.0.0
# Con paneles de monitorización (opcional, ver §8):
./exportar-imagenes.sh --version 1.0.0 --con-monitorizacion
# Cierre de sesión por inactividad distinto de 20 min (se fija al compilar):
IDLE_MINUTES=15 ./exportar-imagenes.sh --version 1.0.0
```

Genera `salida/kit-lims-idic-1.0.0.tar.gz` (≈ 2-3 GB) con las imágenes en `.tar.gz`, el código, los SQL, la configuración, esta guía y el `MANIFIESTO.txt` con el **SHA-256 de cada artefacto**.

> **MinIO ya no se descarga de Internet.** Desde octubre de 2026 Docker Hub no entrega `minio/minio`: el fabricante retiró sus imágenes públicas. El exportador usa la copia local con el mismo digest que se validó en preproducción y lo anota en `MANIFIESTO.txt`. Si la máquina que construye el kit no la tiene, cárguela antes desde el resguardo que conserva Aiuken (`07_despliegue/imagenes_resguardo`): `docker load -i minio_minio__sha256-14cea493d9a3.tar.gz`.

### 5.2 Fase 2 · Traslado

Copie el paquete y su `.sha256` a un **USB cifrado (LUKS)**.

> **Aviso de seguridad.** El kit contiene el código y el esquema completo del LIMS del Ejército. Trátelo como material clasificado y regístrelo en el libro de soportes del IDIC.

### 5.3 Fase 3 · Instalar (servidor aislado)

```bash
# 1. Verificar el medio ANTES de nada
sha256sum -c kit-lims-idic-1.0.0.tar.gz.sha256      # debe decir: OK

# 2. Extraer
tar -xzf kit-lims-idic-1.0.0.tar.gz && cd kit-lims-idic-1.0.0

# 3. Primera pasada: genera el .env con secretos aleatorios y se detiene
sudo ./instalar-onpremise.sh

# 4. Revisar el .env: DOMAIN debe coincidir con el certificado
sudo nano /opt/lims-idic/.env

# 5. Segunda pasada: instala de verdad
sudo ./instalar-onpremise.sh
```

**La primera pasada se detiene a propósito.** Genera los secretos y pide revisión. Es el único momento cómodo para ajustar `DOMAIN`, las rutas de datos y el relay SMTP.

### 5.4 Qué hace el instalador

1. **Prerequisitos**: root, arquitectura, Docker, CPU/RAM, reloj.
2. **Integridad**: verifica el SHA-256 de cada artefacto. Si uno falla, **aborta**.
3. **Carga de imágenes**: `docker load` de cada `.tar.gz`. Sin red.
4. **Código y configuración** a `/opt/lims-idic`.
5. **`.env`**: lo genera con `openssl rand` o valida el existente. **Falla si un secreto está vacío, es corto o conserva un valor de ejemplo.**
6. **Datos y certificado**: crea el árbol y valida que certificado y clave se correspondan y cubran `DOMAIN`.
7. **Arranque**: `docker compose up -d`, sin build y sin pull.
8. **Base de datos**: aplica todos los SQL del manifiesto `packages/db/ORDEN_SQL.txt` en su orden (§5.5). Si falta alguno en el kit, **aborta**. Los errores SQL se cuentan y se listan al final; con `--estricto` el primero detiene la instalación.
9. **Administrador y temporizadores**: crea el usuario `admin` y activa respaldo y chequeo.
10. **Verificación final**: espera a que cada servicio esté en marcha y sano y pide la pantalla de ingreso a través del proxy. Si el LIMS no está en condiciones de uso termina con **INSTALACIÓN INCOMPLETA** y código de error; ya no muestra el mensaje de éxito con un servicio caído. Metabase tarda varios minutos en su primer arranque: si aún no está sano, avisa sin dar la instalación por fallida.

> **Idempotente.** Se puede reejecutar sin miedo. Registra en la tabla `_lims_instalacion` qué SQL aplicó y con qué checksum, y omite los que ya están al día. Si un script cambia (actualización), lo detecta por el checksum y lo reaplica. La única excepción es `schema.sql`: crea la base desde cero y solo se aplica en la instalación inicial; los cambios posteriores del esquema llegan siempre por los `align_*.sql`.

### 5.5 Datos de demostración: por qué NO se instalan

El orden de los SQL sale de un único manifiesto, `packages/db/ORDEN_SQL.txt`, que leen tanto `provision.sh` (preproducción) como este instalador. Así los dos entornos no pueden divergir: la CI del repositorio falla si un `.sql` nuevo no figura en él. La única diferencia entre entornos es la siguiente.

`provision.sh` (nube) aplica también `seed_preprod_demo.sql` y `seed_operacion_demo.sql`: clientes, órdenes de trabajo y resultados **inventados**. En preproducción es correcto. En el IDIC, **no**: contaminarían la trazabilidad del laboratorio y la analítica de Metabase con ensayos que nunca existieron.

Por eso el instalador **los omite por defecto**. Ahora bien, hay una trampa: `seed_operacion_demo.sql` **mezcla datos demo con DDL imprescindible** (diez columnas de la tabla `resultado`: `ot_id`, `muestra_id`, `replicas`, `promedio`, `desviacion`, `cv`, `veredicto`, `analista_id`, `fecha`, `deleted_at`). Ningún otro script las aporta —se ha verificado uno a uno—, y sin ellas la API falla al capturar resultados.

La solución: `packages/db/align_resultado_operacion.sql` replica **solo** esa DDL y ocupa la misma posición del orden, marcado `sin-demo` en el manifiesto (los dos seeds de ejemplo van marcados `demo`). Se optó por un fichero nuevo en vez de modificar `seed_operacion_demo.sql` para no alterar el entorno de preproducción, que está operativo.

Ensayo del 13-10-2026 sobre una base vacía: 41 ficheros en modo producción y 42 en modo demostración, **0 errores SQL** en ambos, y esquema idéntico entre los dos (178 tablas, mismas columnas e índices). En modo producción la base queda con 0 clientes y 0 órdenes de trabajo.

Si necesita datos demo (formación, demostración a mando):

```bash
sudo ./instalar-onpremise.sh --con-datos-demo    # NUNCA sobre datos reales
```

---

### 5.6 Ingreso con las cuentas del dominio (LDAP)

El LIMS arranca con **usuarios locales** (`LDAP_ENABLED=false`). Para que el personal entre con su cuenta del Directorio Activo del Ejército, TI del IDIC debe aportar cuatro datos y abrir una regla de red:

| Variable del `.env` | Qué es | Quién lo aporta |
|---|---|---|
| `LDAP_URL` | `ldap://<controlador>:389` o `ldaps://<controlador>:636` | TI del IDIC |
| `LDAP_BIND_DN` | Cuenta de servicio de **solo lectura** (DN completo) | TI del IDIC |
| `LDAP_BIND_CREDENTIALS` | Contraseña de esa cuenta | TI del IDIC |
| `LDAP_SEARCH_BASE` | OU donde están los usuarios del IDIC | TI del IDIC |
| `LDAP_SEARCH_FILTER` | Vacío = `(sAMAccountName={{username}})` | — |

```bash
sudo nano /opt/lims-idic/.env        # LDAP_ENABLED=true y los cuatro valores
cd /opt/lims-idic && docker compose -f docker-compose.onpremise.yml --env-file .env up -d api
```

- El servidor del LIMS debe alcanzar el controlador de dominio por la red interna (puerto 389 o 636).
- El directorio **autentica**; los **permisos** se siguen asignando en el LIMS (Administración → Usuarios y roles). Un usuario del dominio sin rol asignado no ve nada.
- Los usuarios con contraseña local (el administrador) siguen entrando aunque el directorio no responda: es la vía de acceso de emergencia.
- No se ha probado contra el directorio real del Ejército: hay que validarlo en la puesta en marcha con una cuenta de prueba.

## 6. Verificación

Recorra esta lista tras instalar. **No dé el sistema por entregado hasta que los ocho puntos pasen.**

| # | Comprobación | Orden | Esperado |
|---|---|---|---|
| 1 | Contenedores | `docker compose -f /opt/lims-idic/docker-compose.onpremise.yml ps` | 7, todos `running`/`healthy` |
| 2 | API | `curl -k https://$DOMAIN/api/health` | `{"status":"ok",...}` |
| 3 | Certificado | `echo \| openssl s_client -connect localhost:443 -servername $DOMAIN 2>/dev/null \| openssl x509 -noout -subject -dates` | CN y fechas correctos |
| 4 | Base de datos | `docker exec lims-postgres psql -U lims -d lims_idic -c "SELECT count(*) FROM metodo"` | > 100 métodos |
| 5 | Puertos | `ss -tlnp \| grep -E ':(5432\|6379\|9000)'` | **Vacío**: no deben estar publicados |
| 6 | Web | Abrir `https://<dominio>` e iniciar sesión con `admin` | Entra sin aviso de certificado |
| 7 | Respaldo | `sudo /opt/lims-idic/scripts/backup/backup.sh --tipo diario` | "COPIA CORRECTA Y VERIFICADA" |
| 8 | Chequeo | `sudo /opt/lims-idic/monitorizacion/chequeo-salud.sh --verboso` | "Todo correcto" |

> **El punto 5 es de seguridad.** Si aparece algo, alguien ha añadido `ports:` a un servicio interno y ha expuesto la base de datos a la red del cuartel.

Además, pruebe **una vez** la cadena de alertas:

```bash
sudo /opt/lims-idic/monitorizacion/chequeo-salud.sh --probar-correo
```

---

## 7. Copias de seguridad y restauración

### 7.1 Qué se respalda

`backup.sh` genera, cada madrugada a las 02:15:

| Fichero | Contenido | Por qué |
|---|---|---|
| `lims_idic-<fecha>.dump` | PostgreSQL (`pg_dump -Fc -Z6`) | Todo el laboratorio: muestras, ensayos, resultados, custodia |
| `minio-<fecha>.tar.gz` | Objetos de MinIO | Informes y certificados firmados |
| `config-<fecha>.tar.gz` | `.env`, certificados, compose | **Sin el `.env`, un dump no reconstruye el servicio**: otro `JWT_SECRET` invalida las sesiones y otras claves de MinIO dejan los documentos inaccesibles |
| `SHA256SUMS` | Checksums | Detección de corrupción |
| `MANIFIESTO.txt` | Fecha, versión, tipo | Trazabilidad |

### 7.2 Rotación GFS

**7 diarios · 4 semanales · 12 mensuales** (`RETENCION_*` en el `.env`).

Se hace **un solo `pg_dump` al día**. La copia nace como diaria y se *promociona* a semanal (domingos) y mensual (día 1) mediante **enlaces duros**: aparece en los tres niveles sin ocupar espacio adicional. El fichero solo se libera del disco cuando se borra el último nivel que lo referencia. Ventana de recuperación: **un año hacia atrás**.

### 7.3 Verificación de integridad

Una copia que no se puede restaurar no es una copia. `backup.sh` **no da por buena** una copia hasta que `pg_restore --list` recorre la tabla de contenidos del dump y encuentra más de 100 objetos. Un `pg_dump` interrumpido a medias produce un fichero de tamaño convincente pero ilegible: comprobar solo el tamaño no detecta ese caso. **Si la verificación falla, la copia se descarta y se emite una alerta.**

### 7.4 Simulacro de restauración (trimestral, obligatorio)

Restaura a una base **temporal**, junto a la productiva, sin tocar los datos vivos:

```bash
sudo /opt/lims-idic/scripts/backup/restore.sh --listar
sudo /opt/lims-idic/scripts/backup/restore.sh \
     --desde /srv/lims-backup/diarios/20260717-021500 \
     --a-bd-temporal simulacro_q3

# Al terminar, elimine la base temporal (ocupa espacio en el mismo disco):
docker exec lims-postgres psql -U lims -d postgres -c 'DROP DATABASE "simulacro_q3";'
```

El script muestra el recuento de filas por tabla para contrastarlo con la producción. **Registre el resultado en el libro de operación del IDIC.**

### 7.5 Restauración real sobre producción

> **DESTRUCTIVO.** Solo ante pérdida real de datos.

```bash
sudo /opt/lims-idic/scripts/backup/restore.sh \
     --desde /srv/lims-backup/diarios/20260717-021500 --sobre-produccion
```

Salvaguardas del script:

1. Verifica los checksums y la legibilidad del dump; si fallan, **no restaura**.
2. Exige teclear literalmente `RESTAURAR PRODUCCION`. No basta con "s".
3. **Respalda el estado actual antes de sobrescribirlo** (`pre-restauracion-<fecha>.dump`). Si la copia elegida resulta ser la equivocada, ese fichero es la única vuelta atrás.
4. Detiene `api` y `web` para liberar conexiones (si no, el `DROP DATABASE` falla).
5. Verifica el resultado y muestra el recuento por tabla.

Los objetos de MinIO **no** se restauran salvo que añada `--con-minio`: normalmente se recupera la base pero se conservan los documentos actuales.

> Todo lo que haya entrado en el LIMS **después** de la copia se pierde. Con el respaldo diario `pg_dump` la ventana máxima de pérdida sería de **24 horas**. Por eso el kit incluye además **WAL archiving + PITR** (§7.7), que reduce esa ventana a **≈5 minutos** y permite restaurar a un instante concreto.

### 7.7 WAL archiving y PITR (recuperación a un instante)

Sobre el `pg_dump` diario, el kit añade un segundo mecanismo que baja la ventana de pérdida de 24 h a **minutos** y permite restaurar a un **segundo concreto del pasado** (p. ej. justo antes de un borrado accidental):

- **Archivado continuo de WAL**: PostgreSQL archiva cada segmento comprimido en `${LIMS_BACKUP_DIR}/wal` (`archive_command` → `scripts/backup/archive-wal.sh`).
- **Basebackup semanal** (`scripts/backup/basebackup.sh`, `lims-basebackup.timer`, domingos 03:00): la copia física de partida. Rota y **purga el WAL ya cubierto** para que no crezca sin límite.
- **Restauración PITR** (`scripts/backup/restore-pitr.sh`): reconstruye a un instante en una **instancia aislada** (nunca sobre la base viva).

```bash
sudo /opt/lims-idic/scripts/backup/restore-pitr.sh --listar
sudo /opt/lims-idic/scripts/backup/restore-pitr.sh --target-time "2026-07-17 14:35:00"
```

> **Riesgo a vigilar.** Si el archivado de WAL falla de forma persistente (disco de respaldo lleno o desmontado, permisos), PostgreSQL **retiene el WAL en `pg_wal` y puede llenar el disco de datos hasta detenerse**. La monitorización lo vigila (§8.2, fila WAL) y alerta. Procedimiento completo, RPO/RTO, requisitos de disco y diagnóstico en **`PITR.md`**.

### 7.6 Copia externa (responsabilidad del IDIC)

El kit deja las copias en `/srv/lims-backup`, en el propio servidor. **Eso no protege de un incendio, un robo o la destrucción del equipo.** El IDIC debe llevarlas fuera según su política: NAS, cinta o USB cifrado en otra dependencia.

---

## 8. Monitorización

### 8.1 Qué se eligió y por qué

El contexto manda: **un solo servidor, aislado, sin Internet, con datos de FFAA y sin personal dedicado a vigilarlo**. Eso descarta de entrada cualquier SaaS (Datadog, Grafana Cloud, Sentry): no hay conectividad y, aunque la hubiera, enviar telemetría de un sistema del Ejército a un tercero es inaceptable.

Quedaba elegir entre un stack Prometheus/Grafana completo o algo más liviano. Se optó por **dos niveles**, y el ligero es el que va activado por defecto:

**Nivel 1 · Chequeo + alerta por correo interno (siempre activo, por defecto)**

- `chequeo-salud.sh` cada 5 minutos vía temporizador de systemd.
- Consumo: **prácticamente cero** (un script de bash, unos segundos cada 5 min).
- Sin dependencias: bash, coreutils, openssl y docker. En un servidor aislado **no se puede instalar nada**, así que hasta el envío SMTP se hace con `/dev/tcp` en lugar de `mailx` o `msmtp`.
- Alerta al **relay SMTP interno** del Ejército.

**Por qué este es el nivel por defecto:** un stack Prometheus + Grafana + Alertmanager + exportadores son 5 contenedores y ~1,2 GB de RAM **para vigilar 7**. Y el argumento decisivo: **la API del LIMS no expone `/metrics`**. Prometheus no tendría métricas de aplicación que raspar; se limitaría a CPU/memoria de contenedores, que es justo lo que menos falla. Lo que de verdad tumba este sistema —el certificado caducado, el disco lleno, el respaldo que dejó de ejecutarse— se detecta mejor con seis comprobaciones directas que con un TSDB.

**Nivel 2 · Prometheus + Grafana (opcional)**

Aporta lo que el nivel 1 no puede: **histórico y tendencias**. Ver la base creciendo mes a mes, o el disco llenándose, permite anticipar en vez de reaccionar (incluye una alerta `predict_linear` que avisa 7 días antes de que el disco se llene). Actívelo si el servidor tiene ≥16 GB y el IDIC quiere paneles.

No hay duplicidad entre niveles: `chequeo-salud.sh` escribe sus resultados como métricas en un fichero `.prom` que `node-exporter` publica. El nivel 1 es el **origen de datos** del nivel 2, no un competidor.

```bash
# Activar el nivel 2 (requiere haber exportado el kit con --con-monitorizacion)
cd /opt/lims-idic
docker compose -f docker-compose.onpremise.yml \
               -f monitorizacion/docker-compose.monitor.yml --env-file .env up -d

# Grafana NO publica puerto. Acceso por túnel SSH desde el puesto del administrador:
ssh -L 3000:localhost:3000 operador@<servidor>     # → http://localhost:3000
```

Grafana va con `GF_ANALYTICS_*` y la comprobación de actualizaciones **desactivadas**: sin ellas intentaría contactar `grafana.com` en cada arranque, tardaría minutos en levantar y, sobre todo, emitiría telemetría. Lo mismo con `MINIO_UPDATE=off` y `MB_ANON_TRACKING_ENABLED=false` en el stack principal.

### 8.2 Qué se vigila

| # | Punto | Umbral | Por qué importa |
|---|---|---|---|
| 1 | Contenedores (7) | Caído o `unhealthy` > 5 min | El servicio se cae |
| 1b | Reinicios | > 5 acumulados | Un contenedor en bucle "está `running`" cada vez que se mira; el contador lo delata |
| 2 | API `/api/health` | `status != ok` | El laboratorio no puede trabajar |
| 2b | API vía Caddy (HTTPS) | No responde | Valida además TLS y proxy: es lo que ve el usuario |
| 3 | PostgreSQL | No acepta conexiones | Sin BD no hay LIMS |
| 3b | Conexiones | > 80 % del máximo | Agotarlas deja el LIMS inaccesible |
| 4 | Disco | > 85 % (crítico > 95 %) | Al 100 %, PostgreSQL **se detiene** |
| 5 | Certificado TLS | < 30 días | **No hay renovación automática.** Tramitarlo lleva días |
| 6 | Copias | Fallida, o > 26 h sin una correcta | Sin copias válidas no hay recuperación |
| 6b | **WAL archiving** | Atascado (> 20 segmentos pendientes) o > 2 h sin archivar | Si el archivado falla, `pg_wal` **llena el disco y detiene PostgreSQL** (ver PITR.md §6) |
| 6c | **Basebackup PITR** | Fallido o > 8 días | Sin basebackup fresco la ventana PITR se degrada |
| 7 | El propio chequeo | > 30 min sin ejecutarse | *Vigilar al vigilante*: si el chequeo muere, el silencio parecería "todo bien" |

Las alertas **no se repiten cada 5 minutos**: se envían al detectarse y se recuerdan cada 6 horas mientras persistan. Cuando todo vuelve a la normalidad se envía un aviso de **resolución**. Un buzón inundado es un buzón que se ignora.

### 8.3 Configurar el correo

En `/opt/lims-idic/.env`:

```ini
ALERTA_SMTP_HOST=relay.interno.ejercito.cl
ALERTA_SMTP_PORT=25
ALERTA_MAIL_DE=lims-idic@ejercito.cl
ALERTA_MAIL_PARA=soporte.idic@ejercito.cl
```

Pruebe: `sudo /opt/lims-idic/monitorizacion/chequeo-salud.sh --probar-correo`

> Si se deja `ALERTA_SMTP_HOST` vacío, el chequeo sigue funcionando y registrando en el journal, **pero nadie se entera de las averías**. Configúrelo.

### 8.4 Consultas de operación

```bash
systemctl list-timers lims-*                    # próximas ejecuciones
journalctl -u lims-chequeo --since today        # histórico de chequeos
journalctl -u lims-backup --since "7 days ago"  # histórico de respaldos
sudo /opt/lims-idic/monitorizacion/chequeo-salud.sh --verboso
```

---

## 9. Diagnóstico de averías

### 9.1 Primer reflejo

```bash
cd /opt/lims-idic
docker compose -f docker-compose.onpremise.yml ps
docker compose -f docker-compose.onpremise.yml logs --tail=100 <servicio>
sudo ./monitorizacion/chequeo-salud.sh --verboso
```

### 9.2 Averías frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Error: image not found` / intenta descargar | `LIMS_VERSION` del `.env` no coincide con las imágenes cargadas | `docker images \| grep lims-idic` y ajuste `LIMS_VERSION` |
| Caddy no escucha en 443 | Certificado ausente o clave que no corresponde | §4.2. `docker compose logs caddy` |
| Navegador: "certificado no válido" | `DOMAIN` no coincide con CN/SAN, o falta la intermedia | §4.2 |
| API reiniciándose | `JWT_SECRET` de menos de 32 caracteres | La API aborta a propósito. Corrija el `.env` |
| API `degraded` | No ve PostgreSQL | `docker compose logs postgres` |
| `pg_dump: Permission denied` | `/srv/lims-backup` no pertenece al uid 999 | `sudo chown 999:999 /srv/lims-backup/diarios/<fecha>` |
| Todo lento | Poca RAM para `shared_buffers=2GB` | §2.1 |
| Metabase no arranca | Necesita hasta 3 min la primera vez | Espere; `start_period` es de 180 s |
| Sin alertas por correo | `ALERTA_SMTP_HOST` sin configurar | §8.3 |

### 9.3 Reinicio completo

```bash
cd /opt/lims-idic
docker compose -f docker-compose.onpremise.yml --env-file .env restart          # suave
docker compose -f docker-compose.onpremise.yml --env-file .env down             # parar
docker compose -f docker-compose.onpremise.yml --env-file .env up -d            # arrancar
```

> `down` **no** borra datos: están en `/srv/lims-idic`, en el host. **Nunca** use `down -v`.

---

## 10. Actualización de versión

> **Regla de oro:** toda actualización se valida antes en preproducción. Y **antes de tocar nada, una copia manual**.

```bash
# 1. Copia previa (imprescindible)
sudo /opt/lims-idic/scripts/backup/backup.sh --tipo diario

# 2. Anote la versión actual (la necesitará si hay que volver atrás)
grep LIMS_VERSION /opt/lims-idic/.env

# 3. Verifique y extraiga el kit nuevo
sha256sum -c kit-lims-idic-1.1.0.tar.gz.sha256
tar -xzf kit-lims-idic-1.1.0.tar.gz && cd kit-lims-idic-1.1.0

# 4. Instale: carga las imágenes nuevas, aplica solo los SQL que hayan cambiado
sudo ./instalar-onpremise.sh

# 5. Actualice la versión y recree los contenedores
sudo sed -i 's/^LIMS_VERSION=.*/LIMS_VERSION=1.1.0/' /opt/lims-idic/.env
cd /opt/lims-idic
docker compose -f docker-compose.onpremise.yml --env-file .env up -d

# 6. Verifique (§6)
curl -k https://$DOMAIN/api/health
```

El instalador detecta por checksum qué SQL han cambiado y **solo reaplica esos**. Los ya aplicados y sin cambios se omiten.

> **No borre las imágenes de la versión anterior** hasta que la nueva lleve unos días estable: son su vuelta atrás inmediata. Nada de `docker image prune -a`.

---

## 11. Vuelta atrás (rollback)

### 11.1 Solo la aplicación (el esquema no cambió)

Rápido, sin pérdida de datos:

```bash
sudo sed -i 's/^LIMS_VERSION=.*/LIMS_VERSION=1.0.0/' /opt/lims-idic/.env
cd /opt/lims-idic
docker compose -f docker-compose.onpremise.yml --env-file .env up -d
curl -k https://$DOMAIN/api/health
```

Funciona porque las imágenes antiguas siguen en el disco (§10).

### 11.2 La actualización tocó el esquema

Los SQL de alineación son **aditivos** (`ADD COLUMN IF NOT EXISTS`), así que la versión anterior suele convivir con columnas nuevas que ignora. Intente primero §11.1.

Si no basta, hay que restaurar la copia previa a la actualización, **asumiendo la pérdida de lo introducido desde entonces**:

```bash
sudo /opt/lims-idic/scripts/backup/restore.sh --listar

# 1. Compruebe primero que la copia es buena, sin tocar producción:
sudo /opt/lims-idic/scripts/backup/restore.sh --desde <copia> --a-bd-temporal verificacion
# 2. Solo si el recuento de filas es correcto:
sudo /opt/lims-idic/scripts/backup/restore.sh --desde <copia> --sobre-produccion
# 3. Vuelva también la aplicación a la versión anterior (§11.1)
```

**Restaure siempre primero a una base temporal.** Restaurar sobre producción una copia que resulta estar mal es la única forma de convertir una avería en un desastre.

### 11.3 Desastre total (servidor perdido)

1. Servidor nuevo con los requisitos de §2 y Docker (§3.1).
2. Instale el kit de la versión correspondiente (§5.3).
3. Recupere `config-<fecha>.tar.gz` de la copia: contiene el `.env` **y los certificados originales**. Sin ese `.env`, los documentos de MinIO quedan inaccesibles y todas las sesiones se invalidan.
4. Restaure con `--sobre-produccion --con-minio`.
5. Verifique (§6).

---

## 12. Anexos

### 12.1 Estructura del kit

```
kit-lims-idic-<versión>/
├── instalar-onpremise.sh        Instalador (idempotente)
├── GUIA_ONPREMISE.md            Este documento
├── PITR.md                      WAL archiving y recuperación a un instante (§7.7)
├── MANIFIESTO.txt               Versión, digests de origen y checksums
├── MANIFIESTO.sha256            Checksum de cada fichero del kit
├── imagenes/
│   ├── *.tar.gz                 7 imágenes (+5 si hay monitorización)
│   └── SHA256SUMS
├── codigo/
│   ├── docker-compose.onpremise.yml
│   ├── packages/db/*.sql        Esquema, catálogos y alineaciones
│   ├── packages/db/ORDEN_SQL.txt   Orden de aplicación (fuente única)
│   ├── scripts/orden-sql.sh     Interpreta el manifiesto (demo / sin-demo)
│   └── scripts/backup/          backup.sh, restore.sh (pg_dump/GFS)
│                                archive-wal.sh, basebackup.sh, restore-pitr.sh (PITR)
└── conf/
    ├── Caddyfile.onpremise      TLS propio, sin ACME
    ├── env.onpremise.example
    ├── monitorizacion/
    └── systemd/
```

### 12.2 Órdenes de uso diario

```bash
cd /opt/lims-idic
export C="docker compose -f docker-compose.onpremise.yml --env-file .env"

$C ps                                  # estado
$C logs -f api                         # registros en vivo
$C restart caddy                       # recargar tras cambiar el certificado
sudo ./monitorizacion/chequeo-salud.sh --verboso
sudo ./scripts/backup/backup.sh --tipo diario
sudo ./scripts/backup/restore.sh --listar
systemctl list-timers lims-*
docker exec -it lims-postgres psql -U lims -d lims_idic
```

### 12.3 Lista de comprobación de entrega

- [ ] Hardware conforme a §2.1 y **disco de respaldo independiente**
- [ ] Reloj sincronizado con el NTP interno (§3.3)
- [ ] Certificado de la CA del Ejército instalado; **no** autofirmado (§4.2)
- [ ] Fecha de caducidad del certificado **anotada en el calendario del IDIC**
- [ ] `.env` con permisos 600 y secretos generados (nunca los de ejemplo)
- [ ] Los 8 puntos de verificación de §6, superados
- [ ] Sin datos demo en la base (salvo petición expresa)
- [ ] Relay SMTP configurado y **correo de prueba recibido** (§8.3)
- [ ] `lims-backup.timer`, `lims-basebackup.timer` y `lims-chequeo.timer` activos
- [ ] **Simulacro de restauración ejecutado con éxito** (§7.4)
- [ ] **WAL archiving activo** (`SELECT * FROM pg_stat_archiver` con `archived_count` creciente) y **PITR probado** al menos una vez (`restore-pitr.sh`, ver PITR.md §7)
- [ ] Política de copia externa acordada con el IDIC (§7.6)
- [ ] Contraseña del administrador entregada por canal seguro y cambiada
- [ ] Kit y USB registrados en el libro de soportes

### 12.4 Decisiones de diseño

| Decisión | Motivo |
|---|---|
| Imágenes en `.tar` en vez de registro | No hay Internet. `docker save`/`load` es la única vía |
| Referencia por **etiqueta** + digest fijado al exportar | `docker save`/`load` no preserva `RepoDigests` de forma fiable: una referencia por digest haría que Compose intentara un `pull` que aquí **fallaría**. El digest se fija y verifica al exportar; la integridad la garantiza el SHA-256 del `.tar` |
| `pull_policy: never` | Ante una imagen ausente, error claro e inmediato en vez de un cuelgue buscando red |
| `minio:lims-idic`, `metabase:lims-idic` | Sus upstreams solo publican `:latest`, que es una etiqueta **móvil**. Re-etiquetar congela la versión validada |
| Rutas de host, no volúmenes Docker | Respaldo, auditoría y migración triviales |
| `restart: always` | Tras un corte de luz el LIMS vuelve solo |
| `pg_dump -Fc` en vez de `-Fp` | Comprimido, restauración selectiva y **verificable** con `pg_restore --list` |
| Enlaces duros para el GFS | Tres niveles de retención al coste de uno |
| Monitorización de nivel 1 por defecto | La API no expone `/metrics`; lo que falla se detecta mejor con 6 comprobaciones directas que con un TSDB (§8.1) |
| `align_resultado_operacion.sql` propio | Separa la DDL imprescindible de los datos demo sin tocar preproducción (§5.5) |
| Metabase en su propia base (`lims_metabase`) | En la base del LIMS su migración chocaba con la tabla `audit_log` y el BI no arrancaba (tampoco en preproducción). El respaldo diario la incluye (`metabase-<fecha>.dump`) |
| La web arranca con `node`, sin `pnpm` | Con `pnpm start`, el contenedor descargaba pnpm de Internet en cada arranque: en el servidor aislado entraba en bucle de reinicio |
| Sonda de Caddy por el nombre real | El sitio solo responde a `DOMAIN`; con `https://localhost` la sonda fallaba siempre y el contenedor figuraba «unhealthy» |
| `ORDEN_SQL.txt` como fuente única del orden | La lista copiada en el instalador se quedó en 20 de 42 ficheros sin que nada avisara; con un manifiesto compartido y comprobado en la CI no puede repetirse |
| Kit dentro del repositorio (`deploy/onpremise`) | El instalador se versiona junto al código que instala: cada kit sale de un commit identificable (figura en `MANIFIESTO.txt`) |
| WAL archiving comprimido + basebackup semanal | Baja la ventana de pérdida de 24 h a ≈5 min sin licencias ni segundo servidor (§7.7, PITR.md) |
| `/walarchive` en montaje propio, no bajo `/backup` | El archivador corre como `postgres` (uid 70), no root, y `/backup` es 700 root: intransitable. Montaje propio cedido a `postgres` |
| PITR siempre a instancia aislada | Recuperar a un instante sin arriesgar jamás la base viva (`restore-pitr.sh`) |

### 12.5 Limitaciones conocidas

1. ~~**Ventana de pérdida de 24 h.**~~ **Resuelto:** el kit incluye **WAL archiving + PITR** (§7.7, `PITR.md`), que baja la ventana a **≈5 min** y permite restaurar a un instante concreto. Queda como límite que el RPO ≈ 0 exigiría replicación en streaming a un segundo servidor (servidor único, ver punto 3).
2. **La API no expone `/metrics`.** Sin latencias ni errores por endpoint. Propuesta v2: instrumentar con `prom-client`.
3. **Servidor único.** Sin alta disponibilidad: una avería de hardware implica restaurar en otro equipo (§11.3). Un LIMS de laboratorio con horario de oficina lo admite; si el IDIC exige HA, es un cambio de alcance.
4. **Copia externa manual.** El kit deja las copias en el propio servidor (§7.6).
5. **Renovación del certificado manual.** Inevitable sin ACME. Mitigado con el aviso a 30 días.
7. **MinIO sin actualizaciones.** La imagen empaquetada es la última pública que se validó (septiembre de 2025) y el fabricante ya no publica nuevas. Funciona y no está expuesta fuera de la red interna de Docker, pero no recibirá parches. Queda por decidir si se sustituye por otro almacén compatible con S3 mantenido.
8. **Restaurar Metabase es manual.** `restore.sh` restaura la base del LIMS. Los paneles del BI se recuperan con `pg_restore -d lims_metabase metabase-<fecha>.dump`.
6. **El volcado de MinIO es un `tar` en caliente.** Consistente por objeto; un fichero subido *durante* el volcado podría no entrar. Por eso el respaldo corre a las 02:15.

---

**AIUKEN** · LIMS IDIC · Guía de despliegue on-premise · v1.1 · Octubre 2026
Documento técnico para el Instituto de Investigaciones y Control del Ejército de Chile.
