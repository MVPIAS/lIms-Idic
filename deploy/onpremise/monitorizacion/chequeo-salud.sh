#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Chequeo de salud y alertas · Ejército de Chile · Aiuken
# =============================================================================
# MONITORIZACIÓN DE NIVEL 1 · siempre activa · consumo ~0
#
# Lo ejecuta lims-chequeo.timer cada 5 minutos. Vigila los seis puntos que de
# verdad tumban el servicio en un laboratorio aislado:
#
#   1. Contenedores          (¿están todos arriba y "healthy"?)
#   2. API /api/health       (¿responde y ve la base de datos?)
#   3. PostgreSQL            (¿acepta consultas? ¿cuántas conexiones?)
#   4. Espacio en disco      (datos y respaldos)
#   5. Certificado TLS       (¿cuántos días le quedan?)
#   6. Copias de seguridad   (¿hay una correcta y reciente?)
#   7. WAL archiving + PITR  (¿archiva el WAL? ¿basebackup fresco? ¿pg_wal se llena?)
#
# Salida:
#   · journal del sistema        -> journalctl -u lims-chequeo
#   · correo al relay INTERNO    -> solo si hay alertas y hay SMTP configurado
#   · fichero .prom para Prometheus (si está la monitorización de nivel 2)
#
# Sin dependencias externas: bash, coreutils, openssl y docker. En un servidor
# aislado no se puede instalar nada, así que el envío SMTP se hace con /dev/tcp
# en vez de con mailx o msmtp.
#
#   ./chequeo-salud.sh              # chequeo normal (el del timer)
#   ./chequeo-salud.sh --verboso    # muestra también lo que está correcto
#   ./chequeo-salud.sh --probar-correo  # envía un correo de prueba y termina
# =============================================================================
set -uo pipefail    # sin -e: un chequeo que falla no debe abortar los demás

APP_DIR="${APP_DIR:-/opt/lims-idic}"
[ -f "$APP_DIR/.env" ] || { echo "ERROR: no se encuentra $APP_DIR/.env"; exit 1; }
set -a; . "$APP_DIR/.env"; set +a

COMPOSE="docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $APP_DIR/.env"
DATA_DIR="${LIMS_DATA_DIR:-/srv/lims-idic}"
BACKUP_DIR="${LIMS_BACKUP_DIR:-/srv/lims-backup}"
ESTADO_DIR="/var/lib/lims-monitor"
PROM_DIR="/var/lib/node_exporter/textfile"
UMBRAL_DISCO="${UMBRAL_DISCO_PCT:-85}"
UMBRAL_CERT="${UMBRAL_CERT_DIAS:-30}"
UMBRAL_BACKUP="${UMBRAL_BACKUP_HORAS:-26}"
UMBRAL_WAL_HORAS="${UMBRAL_WAL_ARCHIVO_HORAS:-2}"
UMBRAL_BASEBACKUP_DIAS="${UMBRAL_BASEBACKUP_DIAS:-8}"
# Backlog de segmentos WAL esperando a archivarse. Por encima de esto, el
# archivado está atascado y pg_wal crecerá hasta llenar el disco.
UMBRAL_WAL_PENDIENTES="${UMBRAL_WAL_PENDIENTES:-20}"
# Un mismo problema no debe generar un correo cada 5 minutos: se reenvía cada 6h
# mientras persista. Un buzón inundado es un buzón que se ignora.
REPETIR_ALERTA_SEG=$((6*3600))

VERBOSO="no"
mkdir -p "$ESTADO_DIR"

ALERTAS=(); METRICAS=()
adv()  { ALERTAS+=("$1"); printf '\033[1;31m ✗\033[0m %s\n' "$1"; }
bien() { [ "$VERBOSO" = "si" ] && printf '\033[1;32m ✓\033[0m %s\n' "$1"; return 0; }
metrica() { METRICAS+=("$1"); }

# --- Envío de correo por SMTP interno, sin cliente de correo instalado --------
enviar_correo() {
  local asunto="$1" cuerpo="$2"
  [ -n "${ALERTA_SMTP_HOST:-}" ] || { echo "  (sin ALERTA_SMTP_HOST: no se envía correo)"; return 1; }
  local host="$ALERTA_SMTP_HOST" puerto="${ALERTA_SMTP_PORT:-25}"
  local de="${ALERTA_MAIL_DE:-lims-idic@ejercito.cl}" para="${ALERTA_MAIL_PARA:-}"
  [ -n "$para" ] || { echo "  (sin ALERTA_MAIL_PARA: no se envía correo)"; return 1; }

  exec 3<>"/dev/tcp/$host/$puerto" 2>/dev/null || { echo "  ERROR: no se pudo conectar al relay SMTP $host:$puerto"; return 1; }
  # Conversación SMTP mínima. El relay del cuartel acepta correo interno sin
  # autenticación desde la IP del servidor (requisito acordado con el IDIC).
  {
    printf 'HELO %s\r\n' "$(hostname -f 2>/dev/null || hostname)"
    printf 'MAIL FROM:<%s>\r\n' "$de"
    printf 'RCPT TO:<%s>\r\n' "$para"
    printf 'DATA\r\n'
    printf 'From: LIMS IDIC <%s>\r\n' "$de"
    printf 'To: <%s>\r\n' "$para"
    printf 'Subject: %s\r\n' "$asunto"
    printf 'X-Priority: 1\r\n'
    printf 'Content-Type: text/plain; charset=UTF-8\r\n'
    printf '\r\n'
    printf '%s\r\n' "$cuerpo"
    printf '.\r\n'
    printf 'QUIT\r\n'
  } >&3
  timeout 10 cat <&3 >/dev/null 2>&1
  exec 3<&-; exec 3>&-
  echo "  Aviso enviado a $para"
  return 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --verboso) VERBOSO="si"; shift ;;
    --probar-correo)
      enviar_correo "[LIMS IDIC] Correo de prueba" \
        "Prueba de la cadena de alertas del LIMS IDIC.

Servidor: $(hostname)
Fecha:    $(date '+%Y-%m-%d %H:%M:%S %Z')

Si recibe este mensaje, las alertas están correctamente configuradas.

--
Aiuken · LIMS IDIC"
      exit $? ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1"; exit 1 ;;
  esac
done

echo "── LIMS IDIC · chequeo de salud · $(date '+%Y-%m-%d %H:%M:%S')"

# =============================================================================
# 1 · Contenedores
# =============================================================================
ESPERADOS="lims-caddy lims-web lims-api lims-postgres lims-redis lims-minio lims-metabase"
for c in $ESPERADOS; do
  estado="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo ausente)"
  salud="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-sonda{{end}}' "$c" 2>/dev/null || echo ausente)"
  if [ "$estado" != "running" ]; then
    adv "Contenedor $c NO está en ejecución (estado: $estado)"
    metrica "lims_contenedor_activo{contenedor=\"$c\"} 0"
  elif [ "$salud" = "unhealthy" ]; then
    adv "Contenedor $c está UNHEALTHY"
    metrica "lims_contenedor_activo{contenedor=\"$c\"} 0"
  else
    bien "Contenedor $c: $estado/$salud"
    metrica "lims_contenedor_activo{contenedor=\"$c\"} 1"
  fi
  # Un contenedor que se reinicia en bucle "está running" cada vez que se mira:
  # el contador de reinicios es lo que delata el problema.
  reinicios="$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo 0)"
  metrica "lims_contenedor_reinicios{contenedor=\"$c\"} $reinicios"
  [ "${reinicios:-0}" -gt 5 ] && adv "Contenedor $c lleva $reinicios reinicios: algo lo está tumbando"
done

# =============================================================================
# 2 · API
# =============================================================================
SALUD_API="$(docker exec lims-api wget -q -O - http://localhost:3001/api/health 2>/dev/null)"
if echo "$SALUD_API" | grep -q '"status":"ok"'; then
  bien "API /api/health: ok"
  metrica 'lims_api_salud 1'
elif echo "$SALUD_API" | grep -q '"status":"degraded"'; then
  adv "API DEGRADADA: responde pero no ve la base de datos ($SALUD_API)"
  metrica 'lims_api_salud 0'
else
  adv "API NO responde en /api/health"
  metrica 'lims_api_salud 0'
fi

# A través de Caddy: valida además el TLS y el proxy, que es lo que ve el usuario.
if curl -sk --max-time 10 "https://localhost/api/health" 2>/dev/null | grep -q '"status"'; then
  bien "API accesible a través de Caddy (HTTPS)"
  metrica 'lims_proxy_salud 1'
else
  adv "La API NO es accesible a través de Caddy por HTTPS: los usuarios no pueden entrar"
  metrica 'lims_proxy_salud 0'
fi

# =============================================================================
# 3 · PostgreSQL
# =============================================================================
if docker exec lims-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
  bien "PostgreSQL acepta conexiones"
  metrica 'lims_postgres_activo 1'
  CONEX="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" lims-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
           -c "SELECT count(*) FROM pg_stat_activity WHERE datname='$POSTGRES_DB'" 2>/dev/null | tr -d '[:space:]')"
  MAXCON="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" lims-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
           -c "SHOW max_connections" 2>/dev/null | tr -d '[:space:]')"
  metrica "lims_postgres_conexiones ${CONEX:-0}"
  metrica "lims_postgres_conexiones_max ${MAXCON:-200}"
  if [ -n "${CONEX:-}" ] && [ -n "${MAXCON:-}" ] && [ "$MAXCON" -gt 0 ]; then
    PCT=$((CONEX * 100 / MAXCON))
    [ "$PCT" -gt 80 ] && adv "PostgreSQL al ${PCT}% de sus conexiones ($CONEX/$MAXCON): riesgo de agotarlas"
    bien "Conexiones PostgreSQL: $CONEX/$MAXCON (${PCT}%)"
  fi
  # Tamaño de la base: crecimiento anómalo = algo que investigar.
  TAM="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" lims-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
         -c "SELECT pg_database_size('$POSTGRES_DB')" 2>/dev/null | tr -d '[:space:]')"
  metrica "lims_postgres_tamano_bytes ${TAM:-0}"
else
  adv "PostgreSQL NO acepta conexiones: el LIMS está caído"
  metrica 'lims_postgres_activo 0'
fi

# =============================================================================
# 4 · Espacio en disco
# =============================================================================
for punto in "$DATA_DIR" "$BACKUP_DIR" "/var/lib/docker"; do
  [ -d "$punto" ] || continue
  uso="$(df -P "$punto" | awk 'NR==2{print $5}' | tr -d '%')"
  libre="$(df -Ph "$punto" | awk 'NR==2{print $4}')"
  etiqueta="$(echo "$punto" | tr -d '/' | tr '/' '_')"
  metrica "lims_disco_uso_pct{ruta=\"$punto\"} ${uso:-0}"
  if [ "${uso:-0}" -ge "$UMBRAL_DISCO" ]; then
    adv "Disco de $punto al ${uso}% (quedan $libre). Umbral: ${UMBRAL_DISCO}%"
  else
    bien "Disco de $punto: ${uso}% usado, $libre libres"
  fi
done

# =============================================================================
# 5 · Certificado TLS
# =============================================================================
# En el cuartel no hay renovación automática: si el certificado caduca, el LIMS
# deja de ser accesible y hay que tramitar uno nuevo con la CA del Ejército, lo
# que lleva días. Por eso se avisa con 30 días de antelación.
CERT="$DATA_DIR/certs/lims.crt"
if [ -f "$CERT" ]; then
  FIN_EPOCH="$(date -d "$(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)" +%s 2>/dev/null)"
  AHORA="$(date +%s)"
  DIAS=$(( (FIN_EPOCH - AHORA) / 86400 ))
  metrica "lims_certificado_dias_restantes $DIAS"
  if [ "$DIAS" -lt 0 ]; then
    adv "El certificado TLS CADUCÓ hace $((-DIAS)) días. El LIMS es inaccesible."
  elif [ "$DIAS" -le "$UMBRAL_CERT" ]; then
    adv "El certificado TLS caduca en $DIAS días ($(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)). Solicite la renovación a la CA del Ejército YA."
  else
    bien "Certificado TLS: $DIAS días restantes"
  fi
else
  adv "No se encuentra el certificado TLS en $CERT"
  metrica "lims_certificado_dias_restantes -1"
fi

# =============================================================================
# 6 · Copias de seguridad
# =============================================================================
# Se comprueba el resultado que deja backup.sh, no la mera existencia de un
# fichero: una copia que existe pero no se pudo verificar NO es una copia.
ESTADO_BK="$BACKUP_DIR/.ultimo-estado"
if [ -f "$ESTADO_BK" ]; then
  BK_ESTADO="$(grep '^estado=' "$ESTADO_BK" | cut -d= -f2)"
  BK_FECHA="$(grep '^fecha=' "$ESTADO_BK" | cut -d= -f2-)"
  BK_EPOCH="$(date -d "$BK_FECHA" +%s 2>/dev/null || echo 0)"
  HORAS=$(( ($(date +%s) - BK_EPOCH) / 3600 ))
  metrica "lims_backup_horas_desde_ultimo $HORAS"
  metrica "lims_backup_correcto $([ "$BK_ESTADO" = "OK" ] && echo 1 || echo 0)"
  if [ "$BK_ESTADO" != "OK" ]; then
    adv "La última copia de seguridad FALLÓ: $(grep '^mensaje=' "$ESTADO_BK" | cut -d= -f2-)"
  elif [ "$HORAS" -gt "$UMBRAL_BACKUP" ]; then
    adv "La última copia correcta es de hace $HORAS horas (umbral: $UMBRAL_BACKUP). ¿Está activo lims-backup.timer?"
  else
    bien "Última copia correcta hace $HORAS horas"
  fi
  N_COPIAS="$(find "$BACKUP_DIR" -maxdepth 2 -type d -name '20*' 2>/dev/null | wc -l)"
  metrica "lims_backup_copias_totales $N_COPIAS"
else
  adv "No hay constancia de ninguna copia de seguridad ($ESTADO_BK no existe)"
  metrica 'lims_backup_correcto 0'
fi

# =============================================================================
# 7 · WAL archiving y basebackup (PITR)
# =============================================================================
# El riesgo REAL de esta funcionalidad: si archive_command falla, PostgreSQL
# RETIENE el WAL en pg_wal y lo reintenta indefinidamente. pg_wal crece sin
# límite y, al llenar el disco de datos, PostgreSQL SE DETIENE. Por eso se vigila
# el archivador de forma directa (pg_stat_archiver) y el backlog de segmentos.
if docker exec lims-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
  # archived_count | failed_count | seg desde el último archivado | último WAL fallido
  ARCH="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" lims-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
    -c "SELECT archived_count||'|'||failed_count||'|'||COALESCE(EXTRACT(EPOCH FROM (now()-last_archived_time))::bigint::text,'-1')||'|'||COALESCE(last_failed_wal,'-') FROM pg_stat_archiver" 2>/dev/null | tr -d '[:space:]')"
  ARCH_OK="$(echo "$ARCH" | cut -d'|' -f1)"
  ARCH_FAIL="$(echo "$ARCH" | cut -d'|' -f2)"
  ARCH_EDAD="$(echo "$ARCH" | cut -d'|' -f3)"
  ARCH_ULTFALLO="$(echo "$ARCH" | cut -d'|' -f4)"
  metrica "lims_wal_archivados_total ${ARCH_OK:-0}"
  metrica "lims_wal_fallos_total ${ARCH_FAIL:-0}"
  metrica "lims_wal_ultimo_archivado_hace_seg ${ARCH_EDAD:--1}"

  # Backlog: segmentos marcados .ready pero aún sin archivar. Es el indicador
  # más directo de un archivado atascado.
  PEND="$(docker exec lims-postgres sh -c 'ls -1 /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]')"
  metrica "lims_wal_pendientes ${PEND:-0}"

  # Diagnóstico combinado.
  if [ "${PEND:-0}" -ge "$UMBRAL_WAL_PENDIENTES" ]; then
    adv "WAL archiving ATASCADO: ${PEND} segmentos pendientes (umbral $UMBRAL_WAL_PENDIENTES). pg_wal crecerá hasta LLENAR EL DISCO. Último fallo: ${ARCH_ULTFALLO}. Revise /backup/wal (¿existe, hay espacio, es del uid 999?) y PITR.md."
  elif [ "${ARCH_EDAD:--1}" -ge 0 ] && [ "${ARCH_EDAD}" -gt $((UMBRAL_WAL_HORAS*3600)) ]; then
    adv "El último WAL se archivó hace $((ARCH_EDAD/3600)) h (umbral ${UMBRAL_WAL_HORAS} h). Con archive_timeout=300s debería llegar uno cada 5 min: el archivado puede estar fallando (${ARCH_FAIL:-0} fallos, último ${ARCH_ULTFALLO})."
  elif [ "${ARCH_EDAD:--1}" -lt 0 ] && [ "${ARCH_OK:-0}" = "0" ]; then
    # Nunca ha archivado nada: normal recién instalado; aviso suave solo si hay .ready.
    [ "${PEND:-0}" -gt 0 ] && adv "Hay ${PEND} WAL pendientes y aún no se ha archivado ninguno: archive_command podría estar mal. Revise PITR.md."
    bien "WAL archiving: aún sin segmentos archivados (instalación reciente)"
  else
    bien "WAL archiving: $ARCH_OK archivados, $ARCH_FAIL fallos, último hace ${ARCH_EDAD}s, $PEND pendientes"
  fi

  # Tamaño del archivo de WAL (crecimiento anómalo = purga que no corre).
  if [ -d "$BACKUP_DIR/wal" ]; then
    WAL_BYTES="$(du -sb "$BACKUP_DIR/wal" 2>/dev/null | cut -f1)"
    metrica "lims_wal_archivo_bytes ${WAL_BYTES:-0}"
  fi
fi

# Frescura del basebackup: sin uno reciente, la ventana PITR se degrada y, al
# rotar, se podría perder WAL que ya no tiene basebackup que lo respalde.
ESTADO_BB="$BACKUP_DIR/.ultimo-basebackup"
if [ -f "$ESTADO_BB" ]; then
  BB_ESTADO="$(grep '^estado=' "$ESTADO_BB" | cut -d= -f2)"
  BB_FECHA="$(grep '^fecha=' "$ESTADO_BB" | cut -d= -f2-)"
  BB_EPOCH="$(date -d "$BB_FECHA" +%s 2>/dev/null || echo 0)"
  BB_HORAS=$(( ($(date +%s) - BB_EPOCH) / 3600 ))
  metrica "lims_basebackup_horas_desde_ultimo $BB_HORAS"
  metrica "lims_basebackup_correcto $([ "$BB_ESTADO" = "OK" ] && echo 1 || echo 0)"
  if [ "$BB_ESTADO" != "OK" ]; then
    adv "El último basebackup para PITR FALLÓ: $(grep '^mensaje=' "$ESTADO_BB" | cut -d= -f2-)"
  elif [ "$BB_HORAS" -gt $((UMBRAL_BASEBACKUP_DIAS*24)) ]; then
    adv "El último basebackup correcto es de hace $((BB_HORAS/24)) días (umbral ${UMBRAL_BASEBACKUP_DIAS}). ¿Activo lims-basebackup.timer?"
  else
    bien "Último basebackup correcto hace $((BB_HORAS/24)) días"
  fi
else
  # Aviso suave: puede que aún no se haya ejecutado el primer basebackup semanal.
  metrica 'lims_basebackup_correcto 0'
  bien "Aún no hay basebackup para PITR (se crea el primer domingo tras la instalación)"
fi

# =============================================================================
# Métricas para Prometheus (nivel 2, si está instalado)
# =============================================================================
# La API del LIMS no expone /metrics, así que este script hace de exportador:
# node_exporter publica cualquier .prom que encuentre en su directorio textfile.
# Escritura atómica (fichero temporal + mv) para que node_exporter nunca lea un
# fichero a medio escribir.
if [ -d "$PROM_DIR" ]; then
  TMP="$PROM_DIR/.lims.prom.$$"
  {
    echo "# HELP lims_chequeo_ultimo Marca de tiempo del último chequeo de salud"
    echo "# TYPE lims_chequeo_ultimo gauge"
    echo "lims_chequeo_ultimo $(date +%s)"
    echo "# HELP lims_alertas_activas Número de alertas activas en el último chequeo"
    echo "# TYPE lims_alertas_activas gauge"
    echo "lims_alertas_activas ${#ALERTAS[@]}"
    printf '%s\n' "${METRICAS[@]}"
  } > "$TMP" && mv "$TMP" "$PROM_DIR/lims.prom"
fi

# =============================================================================
# Resultado y alerta
# =============================================================================
if [ "${#ALERTAS[@]}" -eq 0 ]; then
  echo "── Todo correcto (7 servicios, API, BD, disco, certificado y copias)"
  # Al volver a la normalidad se avisa una vez: cerrar el incidente importa
  # tanto como abrirlo.
  if [ -f "$ESTADO_DIR/alerta-activa" ]; then
    enviar_correo "[LIMS IDIC] RESUELTO · el sistema vuelve a estar correcto" \
"Todas las comprobaciones del LIMS IDIC vuelven a pasar.

Servidor: $(hostname)
Fecha:    $(date '+%Y-%m-%d %H:%M:%S %Z')

Incidencia anterior:
$(cat "$ESTADO_DIR/alerta-activa" 2>/dev/null)

--
Aiuken · LIMS IDIC" || true
    rm -f "$ESTADO_DIR/alerta-activa" "$ESTADO_DIR/ultimo-aviso"
  fi
  exit 0
fi

echo "── ${#ALERTAS[@]} ALERTA(S) DETECTADA(S)"
CUERPO="Se han detectado ${#ALERTAS[@]} incidencia(s) en el LIMS del IDIC.

Servidor : $(hostname)
Fecha    : $(date '+%Y-%m-%d %H:%M:%S %Z')
Versión  : ${LIMS_VERSION:-desconocida}

INCIDENCIAS
$(printf '  · %s\n' "${ALERTAS[@]}")

QUÉ HACER
  1. Estado del stack:   docker compose -f $APP_DIR/docker-compose.onpremise.yml ps
  2. Registros:          docker compose -f $APP_DIR/docker-compose.onpremise.yml logs --tail=100
  3. Chequeo detallado:  $APP_DIR/monitorizacion/chequeo-salud.sh --verboso
  4. Guía de operación:  GUIA_ONPREMISE.md §9 (diagnóstico de averías)

--
Aiuken · LIMS IDIC · monitorización local"

# Se avisa cuando la incidencia es nueva (cambia respecto a la anterior) o
# cuando lleva más de 6 horas sin resolverse.
FIRMA="$(printf '%s\n' "${ALERTAS[@]}" | sha256sum | cut -d' ' -f1)"
FIRMA_PREV="$(cat "$ESTADO_DIR/firma-alerta" 2>/dev/null || echo)"
ULTIMO_AVISO="$(cat "$ESTADO_DIR/ultimo-aviso" 2>/dev/null || echo 0)"
AHORA="$(date +%s)"
if [ "$FIRMA" != "$FIRMA_PREV" ] || [ $((AHORA - ULTIMO_AVISO)) -gt "$REPETIR_ALERTA_SEG" ]; then
  enviar_correo "[LIMS IDIC] ALERTA · ${#ALERTAS[@]} incidencia(s) en $(hostname)" "$CUERPO" \
    && echo "$AHORA" > "$ESTADO_DIR/ultimo-aviso"
  echo "$FIRMA" > "$ESTADO_DIR/firma-alerta"
else
  echo "   (aviso ya enviado para esta misma incidencia; no se repite hasta dentro de 6 h)"
fi
printf '%s\n' "${ALERTAS[@]}" > "$ESTADO_DIR/alerta-activa"
exit 1
