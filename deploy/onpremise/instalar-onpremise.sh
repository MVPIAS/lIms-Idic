#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Instalador ON-PREMISE · Ejército de Chile · Aiuken
# =============================================================================
# Para un servidor Linux LIMPIO y AISLADO (sin salida a Internet).
# Se ejecuta desde el kit extraído del USB. No descarga NADA de la red.
#
#   sudo ./instalar-onpremise.sh                 # instalación de producción
#   sudo ./instalar-onpremise.sh --autofirmado   # genera cert. autofirmado
#   sudo ./instalar-onpremise.sh --con-datos-demo    # incluye seeds de ejemplo
#   sudo ./instalar-onpremise.sh --solo-verificar    # diagnóstico, no cambia nada
#   sudo ./instalar-onpremise.sh --estricto          # se detiene al primer error SQL
#
# IDEMPOTENTE: se puede reejecutar tantas veces como haga falta. Registra en la
# tabla `_lims_instalacion` qué SQL se aplicó y con qué checksum, y omite los ya
# aplicados sin cambios. Si un script cambia (actualización), lo reaplica.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lims-idic}"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $APP_DIR/.env"
LOG_FILE="/var/log/lims-instalacion-$(date +%Y%m%d-%H%M%S).log"

AUTOFIRMADO="no"
CON_DEMO="no"
SOLO_VERIFICAR="no"
ESTRICTO="no"

# --- Presentación -------------------------------------------------------------
log()   { printf '\033[1;34m>>\033[0m %s\n' "$*" | tee -a "$LOG_FILE"; }
ok()    { printf '\033[1;32m ✓\033[0m %s\n' "$*" | tee -a "$LOG_FILE"; }
warn()  { printf '\033[1;33m ⚠\033[0m %s\n' "$*" | tee -a "$LOG_FILE" >&2; }
fatal() { printf '\033[1;31m ✗ ERROR:\033[0m %s\n' "$*" | tee -a "$LOG_FILE" >&2; exit 1; }
paso()  { printf '\n\033[1;37m─── %s\033[0m\n' "$*" | tee -a "$LOG_FILE"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --autofirmado)    AUTOFIRMADO="si"; shift ;;
    --con-datos-demo) CON_DEMO="si"; shift ;;
    --solo-verificar) SOLO_VERIFICAR="si"; shift ;;
    --estricto)       ESTRICTO="si"; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) fatal "Argumento desconocido: $1" ;;
  esac
done

touch "$LOG_FILE" 2>/dev/null || { echo "Ejecute como root."; exit 1; }
log "LIMS IDIC · instalación on-premise · $(date '+%Y-%m-%d %H:%M:%S')"
log "Registro completo en: $LOG_FILE"

# =============================================================================
paso "1/9 · Prerequisitos del servidor"
# =============================================================================
[ "$(id -u)" -eq 0 ] || fatal "Debe ejecutarse como root (use sudo)."

# SO
if [ -r /etc/os-release ]; then
  . /etc/os-release
  ok "Sistema: ${PRETTY_NAME:-desconocido}"
  case "${ID:-}" in
    ubuntu|debian|rocky|almalinux|rhel|centos) : ;;
    *) warn "Distribución no validada por Aiuken. Se continúa, pero pruebe antes en un entorno igual." ;;
  esac
else
  warn "No se pudo identificar la distribución."
fi

# Arquitectura: las imágenes del kit son linux/amd64.
ARCH="$(uname -m)"
[ "$ARCH" = "x86_64" ] || fatal "Arquitectura $ARCH no soportada: el kit contiene imágenes linux/amd64."
ok "Arquitectura: $ARCH"

# Docker (debe venir preinstalado: aquí no hay Internet para get.docker.com)
command -v docker >/dev/null 2>&1 || fatal \
  "Docker no está instalado y este servidor no tiene Internet.
   Instálelo desde los paquetes .deb/.rpm del repositorio interno del Ejército
   o desde el USB del kit. Ver GUIA_ONPREMISE.md §3.1."
docker info >/dev/null 2>&1 || fatal "El demonio Docker no responde (¿systemctl start docker?)."
docker compose version >/dev/null 2>&1 || fatal \
  "Falta el plugin 'docker compose' v2. Ver GUIA_ONPREMISE.md §3.1."
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) · Compose $(docker compose version --short)"

# Recursos. Mínimos de Aiuken para el IDIC: 8 CPU, 16 GB RAM, 200 GB libres.
CPUS="$(nproc)"
RAM_MB="$(free -m | awk '/^Mem:/{print $2}')"
[ "$CPUS" -ge 4 ]      || warn "Solo $CPUS CPU. Recomendado: 8 (mínimo 4)."
[ "$RAM_MB" -ge 15000 ] || warn "Solo ${RAM_MB} MB de RAM. Recomendado: 16 GB. Postgres está configurado para 16 GB (shared_buffers=2GB): con menos, ajuste docker-compose.onpremise.yml."
ok "Recursos: ${CPUS} CPU · ${RAM_MB} MB RAM"

# Reloj: un desfase invalida la verificación del certificado y los sellos de
# tiempo de la cadena de custodia. En un sitio aislado no hay NTP público.
if command -v timedatectl >/dev/null 2>&1; then
  SINCRO="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo no)"
  [ "$SINCRO" = "yes" ] || warn "El reloj NO está sincronizado por NTP. Configure el servidor NTP interno del cuartel: la trazabilidad del laboratorio y la validez del certificado dependen de la hora. Ver GUIA_ONPREMISE.md §3.3."
  ok "Hora del sistema: $(date '+%Y-%m-%d %H:%M:%S %Z')"
fi

if [ "$SOLO_VERIFICAR" = "si" ]; then
  paso "Modo --solo-verificar: no se ha modificado nada."
  exit 0
fi

# =============================================================================
paso "2/9 · Verificación de integridad del kit"
# =============================================================================
[ -d "$KIT_DIR/imagenes" ] || fatal "No se encuentra $KIT_DIR/imagenes. ¿Kit incompleto?"
if [ -f "$KIT_DIR/imagenes/SHA256SUMS" ]; then
  log "Comprobando SHA-256 de los artefactos (puede tardar unos minutos)..."
  ( cd "$KIT_DIR/imagenes" && sha256sum -c SHA256SUMS ) >>"$LOG_FILE" 2>&1 \
    || fatal "CHECKSUM INCORRECTO. El medio físico está corrupto o alterado.
   NO continúe: reescriba el USB desde el paquete original y repita."
  ok "Todos los artefactos íntegros ($(wc -l < "$KIT_DIR/imagenes/SHA256SUMS") ficheros)"
else
  warn "No hay SHA256SUMS en el kit: no se puede verificar la integridad."
fi

# =============================================================================
paso "3/9 · Carga de imágenes Docker desde el kit (sin red)"
# =============================================================================
CARGADAS=0
for tar in "$KIT_DIR"/imagenes/*.tar.gz; do
  [ -e "$tar" ] || fatal "No hay imágenes .tar.gz en el kit."
  printf '    cargando %s\n' "$(basename "$tar")" | tee -a "$LOG_FILE"
  # docker load es idempotente: si la imagen ya está, no hace nada.
  docker load -i "$tar" >>"$LOG_FILE" 2>&1 || fatal "Falló docker load de $(basename "$tar")"
  CARGADAS=$((CARGADAS+1))
done
ok "$CARGADAS imágenes cargadas en el demonio local"

# =============================================================================
paso "4/9 · Despliegue del código y la configuración en $APP_DIR"
# =============================================================================
mkdir -p "$APP_DIR"
cp -r "$KIT_DIR/codigo/." "$APP_DIR/"
cp "$KIT_DIR/conf/Caddyfile.onpremise" "$APP_DIR/"
cp -r "$KIT_DIR/conf/monitorizacion" "$APP_DIR/"
# La guía acompaña al sistema: las unidades systemd la referencian en
# Documentation= y el operador la necesita en el sitio, no en el USB.
cp "$KIT_DIR/GUIA_ONPREMISE.md" "$APP_DIR/" 2>/dev/null || true
# PITR.md: las unidades lims-basebackup la referencian en Documentation= y el
# operador la necesita en el sitio para las restauraciones a un instante.
cp "$KIT_DIR/PITR.md" "$APP_DIR/" 2>/dev/null || true
chmod +x "$APP_DIR"/scripts/backup/*.sh "$APP_DIR"/monitorizacion/*.sh 2>/dev/null || true
ok "Código, SQL y configuración desplegados"

# =============================================================================
paso "5/9 · Fichero .env y secretos"
# =============================================================================
generar_secreto() {
  # 32 bytes de /dev/urandom en base64url: ~43 caracteres, sin caracteres que
  # rompan el parseo del .env ni las cadenas de conexión (nada de ':' '@' '/').
  openssl rand -base64 32 | tr -d '\n=+/' | cut -c1-40
}
command -v openssl >/dev/null || fatal "Falta openssl (necesario para generar secretos)."

if [ ! -f "$APP_DIR/.env" ]; then
  log "No existe .env: se genera desde la plantilla con secretos aleatorios..."
  cp "$KIT_DIR/conf/env.onpremise.example" "$APP_DIR/.env"
  for var in POSTGRES_PASSWORD JWT_SECRET MINIO_ROOT_PASSWORD; do
    sec="$(generar_secreto)"
    # Delimitador '|' para no chocar con '/' del base64.
    sed -i "s|^${var}=<<GENERAR>>|${var}=${sec}|" "$APP_DIR/.env"
  done
  chmod 600 "$APP_DIR/.env"; chown root:root "$APP_DIR/.env"
  ok "Generado $APP_DIR/.env con secretos fuertes (chmod 600)"
  warn "REVISE $APP_DIR/.env ANTES DE CONTINUAR: ajuste DOMAIN al nombre DNS real
   del servidor (debe coincidir con el certificado) y los datos del relay SMTP.
   Después vuelva a ejecutar este instalador."
  exit 0
else
  ok "Se reutiliza el .env existente"
  chmod 600 "$APP_DIR/.env"
fi

set -a; . "$APP_DIR/.env"; set +a

# --- Validación estricta: se falla, no se inventan valores por defecto --------
FALLOS=0
exigir() {
  local nombre="$1" valor="${2:-}" minimo="${3:-1}"
  if [ -z "$valor" ]; then
    warn "$nombre está vacío en .env"; FALLOS=$((FALLOS+1)); return
  fi
  if [ "$valor" = "<<GENERAR>>" ]; then
    warn "$nombre sigue con el marcador <<GENERAR>>"; FALLOS=$((FALLOS+1)); return
  fi
  if printf '%s' "$valor" | grep -qiE 'CAMBIAR|changeme|password|123456|admin$'; then
    warn "$nombre contiene un valor de ejemplo o trivial"; FALLOS=$((FALLOS+1)); return
  fi
  if [ "${#valor}" -lt "$minimo" ]; then
    warn "$nombre es demasiado corto (${#valor} < $minimo caracteres)"; FALLOS=$((FALLOS+1)); return
  fi
}
exigir DOMAIN              "${DOMAIN:-}"              4
exigir LIMS_VERSION        "${LIMS_VERSION:-}"        1
exigir LIMS_DATA_DIR       "${LIMS_DATA_DIR:-}"       1
exigir POSTGRES_USER       "${POSTGRES_USER:-}"       3
exigir POSTGRES_DB         "${POSTGRES_DB:-}"         3
exigir POSTGRES_PASSWORD   "${POSTGRES_PASSWORD:-}"   20
# La API aborta el arranque si JWT_SECRET < 32; se exige aquí para fallar antes
# y con un mensaje comprensible, no con un contenedor en bucle de reinicio.
exigir JWT_SECRET          "${JWT_SECRET:-}"          32
exigir MINIO_ROOT_USER     "${MINIO_ROOT_USER:-}"     3
exigir MINIO_ROOT_PASSWORD "${MINIO_ROOT_PASSWORD:-}" 20
[ "$FALLOS" -eq 0 ] || fatal "$FALLOS problema(s) en $APP_DIR/.env. Corríjalos y reejecute."
ok "Secretos y variables validados"

# Las imágenes del .env deben existir tras el docker load.
for img in "${LIMS_REGISTRY:-lims-idic}/api:${LIMS_VERSION}" \
           "${LIMS_REGISTRY:-lims-idic}/web:${LIMS_VERSION}" \
           "${CADDY_IMAGE:-caddy:2-alpine}" "${POSTGRES_IMAGE:-postgres:16-alpine}" \
           "${REDIS_IMAGE:-redis:7-alpine}" "${MINIO_IMAGE:-minio/minio:lims-idic}" \
           "${METABASE_IMAGE:-metabase/metabase:lims-idic}"; do
  docker image inspect "$img" >/dev/null 2>&1 \
    || fatal "La imagen '$img' no está cargada. ¿LIMS_VERSION del .env coincide con el kit?
   Imágenes disponibles: $(docker images --format '{{.Repository}}:{{.Tag}}' | tr '\n' ' ')"
done
ok "Las 7 imágenes requeridas están presentes"

# =============================================================================
paso "6/9 · Directorios de datos y certificado TLS"
# =============================================================================
mkdir -p "$LIMS_DATA_DIR"/{postgres,redis,minio,metabase,certs,caddy/data,caddy/config}
mkdir -p "${LIMS_BACKUP_DIR:-/srv/lims-backup}"/{diarios,semanales,mensuales,wal,basebackups}
chmod 700 "$LIMS_DATA_DIR/certs" "${LIMS_BACKUP_DIR:-/srv/lims-backup}"
# Carpetas de intercambio con IBIS. Si no existen, Docker las crea como root al
# montar el volumen y el ETL de la API no puede mover los XML ya procesados.
IBIS_HOST_DIR="${IBIS_DIR:-$APP_DIR/ibis}"
case "$IBIS_HOST_DIR" in /*) : ;; *) IBIS_HOST_DIR="$APP_DIR/${IBIS_HOST_DIR#./}" ;; esac
mkdir -p "$IBIS_HOST_DIR"/{entrada,procesados,errores}
# WAL archiving (PITR): el directorio wal/ se monta como /walarchive y lo escribe
# el archivador de PostgreSQL, que corre como el usuario `postgres` (uid 70 en
# alpine), NO como root. Se le cede la propiedad DESPUÉS de levantar el stack
# (paso 7), desde dentro del contenedor, para acertar con el uid sea cual sea la
# imagen. Aquí solo se fijan permisos 700 (datos sensibles). Ver PITR.md.
chmod 700 "${LIMS_BACKUP_DIR:-/srv/lims-backup}"/wal "${LIMS_BACKUP_DIR:-/srv/lims-backup}"/basebackups
# MinIO y Metabase no corren como root dentro del contenedor.
chown -R 1000:1000 "$LIMS_DATA_DIR/minio" 2>/dev/null || true
chown -R 2000:2000 "$LIMS_DATA_DIR/metabase" 2>/dev/null || true
ok "Árbol de datos en $LIMS_DATA_DIR"

CERT="$LIMS_DATA_DIR/certs/lims.crt"
KEY="$LIMS_DATA_DIR/certs/lims.key"
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  if [ "$AUTOFIRMADO" = "si" ]; then
    warn "Generando certificado AUTOFIRMADO para $DOMAIN."
    warn "Es válido para pruebas de aceptación, pero los navegadores mostrarán
   aviso de seguridad. Para producción, solicite el certificado a la CA
   interna del Ejército y sustituya estos ficheros (GUIA_ONPREMISE.md §4)."
    openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
      -keyout "$KEY" -out "$CERT" \
      -subj "/C=CL/O=Ejercito de Chile/OU=IDIC/CN=$DOMAIN" \
      -addext "subjectAltName=DNS:$DOMAIN,DNS:bi.$DOMAIN" >>"$LOG_FILE" 2>&1
    ok "Certificado autofirmado generado (825 días)"
  else
    fatal "Falta el certificado TLS:
     $CERT
     $KEY
   Coloque el certificado emitido por la CA del Ejército (crt con la cadena
   intermedia concatenada + clave sin contraseña) y reejecute.
   Para una prueba de aceptación puede usar: sudo $0 --autofirmado
   Detalles en GUIA_ONPREMISE.md §4."
  fi
fi
chmod 600 "$KEY"; chmod 644 "$CERT"; chown root:root "$KEY" "$CERT"

# Coherencia certificado <-> DOMAIN: un fallo aquí deja la web inaccesible y es
# dificilísimo de diagnosticar después.
if ! openssl x509 -in "$CERT" -noout -text | grep -qF "$DOMAIN"; then
  warn "El certificado no menciona '$DOMAIN' ni en CN ni en SAN. Los navegadores
   rechazarán la conexión. Verifique DOMAIN en .env y el certificado."
fi
CERT_FIN="$(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)"
# La clave debe corresponder al certificado (modulus idéntico).
if [ "$(openssl x509 -noout -modulus -in "$CERT" | openssl md5)" \
   != "$(openssl rsa  -noout -modulus -in "$KEY"  | openssl md5)" ]; then
  fatal "El certificado y la clave privada NO se corresponden. Caddy no arrancará."
fi
ok "Certificado válido para $DOMAIN · caduca: $CERT_FIN"

# =============================================================================
paso "7/9 · Arranque del stack"
# =============================================================================
log "Levantando contenedores (sin build, sin pull: todo es local)..."
$COMPOSE up -d --remove-orphans 2>&1 | tee -a "$LOG_FILE"

log "Esperando a que PostgreSQL acepte conexiones..."
INTENTOS=0
until $COMPOSE exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  INTENTOS=$((INTENTOS+1))
  [ "$INTENTOS" -lt 60 ] || fatal "PostgreSQL no arrancó en 3 minutos. Revise: $COMPOSE logs postgres"
  sleep 3
done
ok "PostgreSQL operativo"

# WAL archiving: ceder /walarchive al usuario postgres del contenedor. Hasta este
# punto archive_command puede haber fallado unas veces (Permission denied) y el
# WAL estará esperando en pg_wal; en cuanto el directorio es suyo, PostgreSQL
# reintenta y archiva el atraso. Se hace desde dentro para acertar con el uid
# real de la imagen (70 alpine / 999 debian). Ver PITR.md §qué vigilar.
if $COMPOSE exec -u 0 -T postgres sh -c 'chown postgres:postgres /walarchive && chmod 700 /walarchive' 2>/dev/null; then
  ok "Directorio de archivo de WAL (/walarchive) cedido a postgres: archivado activo"
else
  warn "No se pudo ceder /walarchive a postgres. El archivado de WAL podría fallar;
   revíselo con: $COMPOSE exec postgres psql -U $POSTGRES_USER -c 'SELECT * FROM pg_stat_archiver' (ver PITR.md)."
fi

# =============================================================================
paso "8/9 · Esquema, catálogos y alineaciones"
# =============================================================================
psql_run() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }

# Registro de scripts aplicados: hace la instalación idempotente y deja
# constancia auditable de qué se aplicó, cuándo y con qué checksum.
psql_run -q -c "
  CREATE TABLE IF NOT EXISTS _lims_instalacion (
    fichero     TEXT PRIMARY KEY,
    sha256      TEXT NOT NULL,
    aplicado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     TEXT
  );" >/dev/null

# ORDEN CRÍTICO: se lee de packages/db/ORDEN_SQL.txt, la MISMA fuente que usa
# provision.sh en preproducción. Así los dos despliegues no pueden divergir (la
# lista que antes vivía copiada aquí llegó a quedarse en 20 de 42 ficheros).
#
#   Los ficheros marcados `demo` (seed_preprod_demo.sql, seed_operacion_demo.sql)
#   SOLO se aplican con --con-datos-demo: contienen clientes, OT y resultados
#   INVENTADOS. En el IDIC la base lleva datos reales del Ejército y no puede
#   contener ficción. La DDL que seed_operacion_demo.sql lleva embebida (columnas
#   de `resultado`) sí es imprescindible: la aporta align_resultado_operacion.sql,
#   marcado `sin-demo`, en esa misma posición del orden.
SQL_DIR="$APP_DIR/packages/db"
ORDEN_SQL="$SQL_DIR/ORDEN_SQL.txt"
[ -r "$ORDEN_SQL" ] || fatal "Falta $ORDEN_SQL. ¿Kit incompleto o anterior a la versión actual?"
MODO_SQL="sin-demo"; [ "$CON_DEMO" = "si" ] && MODO_SQL="demo"
LISTA=()
while IFS= read -r nombre; do
  [ -n "$nombre" ] && LISTA+=("$SQL_DIR/$nombre")
done < <(ORDEN_SQL="$ORDEN_SQL" bash "$APP_DIR/scripts/orden-sql.sh" "$MODO_SQL")
[ "${#LISTA[@]}" -gt 0 ] || fatal "ORDEN_SQL.txt no produjo ningún fichero para el modo $MODO_SQL."

# El kit tiene que traer TODOS los ficheros del manifiesto. Antes, uno ausente
# se omitía con un aviso y la base quedaba incompleta sin que nadie lo notara.
FALTAN=0
for f in "${LISTA[@]}"; do
  [ -f "$f" ] || { warn "Falta en el kit: $(basename "$f")"; FALTAN=$((FALTAN+1)); }
done
[ "$FALTAN" -eq 0 ] || fatal "$FALTAN fichero(s) SQL del manifiesto no están en $SQL_DIR. Regenere el kit."
ok "Manifiesto SQL: ${#LISTA[@]} ficheros en modo $MODO_SQL"

[ "$CON_DEMO" = "si" ] && warn "MODO DEMO: se sembrarán datos SINTÉTICOS. No usar con datos reales del IDIC."

APLICADOS=0; OMITIDOS=0; ERRORES_SQL=0; FICHEROS_CON_ERROR=()
for f in "${LISTA[@]}"; do
  nombre="$(basename "$f")"
  suma="$(sha256sum "$f" | cut -d' ' -f1)"
  previo="$(psql_run -tAq -c "SELECT sha256 FROM _lims_instalacion WHERE fichero='$nombre'" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "$previo" = "$suma" ]; then
    printf '    · %-32s (ya aplicado, sin cambios)\n' "$nombre" | tee -a "$LOG_FILE"
    OMITIDOS=$((OMITIDOS+1)); continue
  fi
  # schema.sql crea la base DESDE CERO (CREATE TABLE sin IF NOT EXISTS y con
  # ON_ERROR_STOP): sobre una base ya instalada aborta en la primera tabla. En
  # una actualización NO se reaplica; los cambios de esquema posteriores llegan
  # siempre por los align_*.sql, que son aditivos e idempotentes.
  if [ "$nombre" = "schema.sql" ] && [ -n "$previo" ]; then
    printf '    · %-32s (base ya creada: los cambios llegan por align_*)\n' "$nombre" | tee -a "$LOG_FILE"
    psql_run -q -c "UPDATE _lims_instalacion SET sha256='$suma', version='${LIMS_VERSION}' WHERE fichero='$nombre';" >/dev/null
    OMITIDOS=$((OMITIDOS+1)); continue
  fi
  [ -n "$previo" ] && log "    $nombre ha cambiado desde la última instalación: se reaplica"
  printf '    · %-32s aplicando...\n' "$nombre" | tee -a "$LOG_FILE"
  # Sin ON_ERROR_STOP: varios scripts contienen DDL condicional que emite avisos
  # benignos al reaplicarse (igual criterio que provision.sh en preproducción).
  # Pero los ERROR no se ignoran: se cuentan por fichero y se listan al final,
  # y con --estricto cualquiera de ellos detiene la instalación.
  SALIDA_SQL="$(mktemp)"
  if $COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$f" >"$SALIDA_SQL" 2>&1; then
    cat "$SALIDA_SQL" >>"$LOG_FILE"
    N_ERR="$(grep -c -E '^(psql:.*: )?ERROR:' "$SALIDA_SQL" || true)"
    if [ "${N_ERR:-0}" -gt 0 ]; then
      ERRORES_SQL=$((ERRORES_SQL+N_ERR))
      FICHEROS_CON_ERROR+=("$nombre ($N_ERR)")
      warn "$nombre terminó con $N_ERR error(es) SQL:"
      grep -E '^(psql:.*: )?ERROR:' "$SALIDA_SQL" | head -5 | sed 's/^/        /' | tee -a "$LOG_FILE" >&2
      if [ "$ESTRICTO" = "si" ]; then
        rm -f "$SALIDA_SQL"
        fatal "Modo --estricto: se detiene en $nombre. Detalle completo en $LOG_FILE"
      fi
    fi
    rm -f "$SALIDA_SQL"
    psql_run -q -c "INSERT INTO _lims_instalacion (fichero, sha256, version)
                    VALUES ('$nombre','$suma','${LIMS_VERSION}')
                    ON CONFLICT (fichero) DO UPDATE
                      SET sha256=EXCLUDED.sha256, aplicado_en=now(), version=EXCLUDED.version;" >/dev/null
    APLICADOS=$((APLICADOS+1))
  else
    cat "$SALIDA_SQL" >>"$LOG_FILE"; rm -f "$SALIDA_SQL"
    fatal "Falló $nombre. Revise el detalle en $LOG_FILE y corrija antes de seguir."
  fi
done
ok "SQL: $APLICADOS aplicados, $OMITIDOS omitidos por estar al día"
if [ "$ERRORES_SQL" -gt 0 ]; then
  warn "$ERRORES_SQL error(es) SQL en ${#FICHEROS_CON_ERROR[@]} fichero(s): ${FICHEROS_CON_ERROR[*]}
   La instalación continúa, pero NO dé el sistema por recibido sin que Aiuken
   revise cada uno en $LOG_FILE (busque 'ERROR:')."
else
  ok "Ningún error SQL en la aplicación del esquema"
fi

# Comprobación de que la base quedó poblada de verdad.
TABLAS="$(psql_run -tAq -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')"
ROLES="$(psql_run -tAq -c "SELECT count(*) FROM rol" 2>/dev/null | tr -d '[:space:]' || echo 0)"
METODOS="$(psql_run -tAq -c "SELECT count(*) FROM metodo" 2>/dev/null | tr -d '[:space:]' || echo 0)"
ok "Base de datos: $TABLAS tablas · $ROLES roles · $METODOS métodos de ensayo"
[ "${ROLES:-0}" -gt 0 ] || fatal "No hay roles: seed_rbac.sql no se aplicó correctamente."

# =============================================================================
paso "9/9 · Usuario administrador y monitorización"
# =============================================================================
log "Esperando a que la API responda..."
INTENTOS=0
until $COMPOSE exec -T api wget -q -O - http://localhost:3001/api/health 2>/dev/null | grep -q '"status":"ok"'; do
  INTENTOS=$((INTENTOS+1))
  [ "$INTENTOS" -lt 40 ] || { warn "La API no respondió en 2 minutos. Revise: $COMPOSE logs api"; break; }
  sleep 3
done

# crear-admin.js hace upsert: reejecutarlo no duplica el usuario.
log "Creando usuario administrador (si no existe)..."
SALIDA_ADMIN="$($COMPOSE exec -T api node dist/cli/crear-admin.js \
    --usuario admin --rol SUPERADMIN --nombre "Administrador IDIC" 2>&1 || true)"
echo "$SALIDA_ADMIN" | tee -a "$LOG_FILE"

# Monitorización de nivel 1 (siempre): timers systemd de chequeo y respaldo.
if [ -d "$KIT_DIR/conf/systemd" ]; then
  log "Instalando temporizadores systemd (respaldo y chequeo de salud)..."
  cp "$KIT_DIR"/conf/systemd/*.service "$KIT_DIR"/conf/systemd/*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now lims-backup.timer lims-basebackup.timer lims-chequeo.timer >>"$LOG_FILE" 2>&1 \
    && ok "Temporizadores activos: respaldo diario 02:15 · basebackup semanal dom 03:00 · chequeo cada 5 min" \
    || warn "No se pudieron activar los temporizadores. Actívelos a mano (GUIA_ONPREMISE.md §7)."
fi

# =============================================================================
echo | tee -a "$LOG_FILE"
$COMPOSE ps | tee -a "$LOG_FILE"
cat <<TXT | tee -a "$LOG_FILE"

╔══════════════════════════════════════════════════════════════════════╗
║  LIMS IDIC · instalación completada                          AIUKEN  ║
╚══════════════════════════════════════════════════════════════════════╝

  Acceso web    : https://$DOMAIN
  BI (Metabase) : https://bi.$DOMAIN
  Certificado   : caduca el $CERT_FIN
  Datos         : $LIMS_DATA_DIR
  Respaldos     : ${LIMS_BACKUP_DIR:-/srv/lims-backup}
  Registro      : $LOG_FILE

  ANOTE LA CONTRASEÑA DEL ADMINISTRADOR que aparece arriba: no se vuelve
  a mostrar. Cámbiela en el primer inicio de sesión.

  VERIFICACIÓN RECOMENDADA (GUIA_ONPREMISE.md §6):
    1. curl -k https://$DOMAIN/api/health          -> {"status":"ok"}
    2. Inicie sesión en la web con el usuario admin
    3. Fuerce un respaldo:  $APP_DIR/scripts/backup/backup.sh --tipo diario
    4. Chequeo de salud:    $APP_DIR/monitorizacion/chequeo-salud.sh

TXT
