#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Copia de seguridad · Ejército de Chile · Aiuken
# =============================================================================
# Respalda, en una sola ejecución consistente:
#   1. La base PostgreSQL (pg_dump formato custom, comprimido)
#   2. Los objetos de MinIO (informes, certificados firmados, adjuntos)
#   3. La configuración (.env, certificados, compose, Caddyfile)
#
# Rotación GFS (abuelo-padre-hijo):  7 diarios · 4 semanales · 12 mensuales
# Los tres niveles comparten fichero mediante ENLACES DUROS: una copia
# promocionada a semanal/mensual NO ocupa espacio adicional en disco.
#
# Uso:
#   ./backup.sh                    # --tipo auto (lo que usa el timer systemd)
#   ./backup.sh --tipo diario      # fuerza un diario
#   ./backup.sh --tipo mensual     # fuerza un mensual
#   ./backup.sh --solo-verificar   # verifica la última copia, no crea ninguna
#
# Código de salida 0 = copia correcta y VERIFICADA. El chequeo de salud se basa
# en ello: una copia que no se ha podido verificar es una copia que no existe.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lims-idic}"
[ -f "$APP_DIR/.env" ] || { echo "ERROR: no se encuentra $APP_DIR/.env"; exit 1; }
set -a; . "$APP_DIR/.env"; set +a

COMPOSE="docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $APP_DIR/.env"
BACKUP_DIR="${LIMS_BACKUP_DIR:-/srv/lims-backup}"
DATA_DIR="${LIMS_DATA_DIR:-/srv/lims-idic}"
RET_D="${RETENCION_DIARIOS:-7}"
RET_S="${RETENCION_SEMANALES:-4}"
RET_M="${RETENCION_MENSUALES:-12}"
# Lo consume la monitorización (chequeo-salud.sh) para saber si hay copia fresca.
ESTADO="$BACKUP_DIR/.ultimo-estado"

TIPO="auto"
SOLO_VERIFICAR="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --tipo) TIPO="${2:-auto}"; shift 2 ;;
    --solo-verificar) SOLO_VERIFICAR="si"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1"; exit 1 ;;
  esac
done

# Salida al journal cuando lo lanza systemd, y a la consola cuando es manual.
log()   { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fatal() {
  log "ERROR: $*"
  printf 'estado=ERROR\nfecha=%s\nmensaje=%s\n' "$(date -Is)" "$*" > "$ESTADO" 2>/dev/null || true
  exit 1
}

FECHA="$(date '+%Y%m%d-%H%M%S')"
DIA_MES="$(date '+%d')"
DIA_SEM="$(date '+%u')"     # 1=lunes .. 7=domingo

# --- Verificación de una copia (se usa al crearla y con --solo-verificar) -----
# $1 = ruta del dump DENTRO del contenedor (bajo /backup).
verificar_dump() {
  local dump_cont="$1" dump_host="$2"
  [ -s "$dump_host" ] || { log "  el dump está vacío"; return 1; }
  # pg_restore --list recorre la tabla de contenidos del fichero: si el dump
  # está truncado o corrupto, falla aquí. Es la verificación real; comprobar
  # solo el tamaño no detecta un pg_dump interrumpido a medias.
  local objetos
  objetos="$($COMPOSE exec -T postgres pg_restore --list "$dump_cont" 2>/dev/null | grep -cv '^;' || true)"
  [ "${objetos:-0}" -gt 100 ] || { log "  el dump solo declara ${objetos:-0} objetos (se esperan >100)"; return 1; }
  log "  dump legible y coherente: $objetos objetos"
  return 0
}

if [ "$SOLO_VERIFICAR" = "si" ]; then
  ULTIMO="$(find "$BACKUP_DIR/diarios" -maxdepth 1 -type d -name '20*' | sort | tail -1)"
  [ -n "$ULTIMO" ] || fatal "No hay ninguna copia que verificar."
  log "Verificando la última copia: $ULTIMO"
  ( cd "$ULTIMO" && sha256sum -c SHA256SUMS ) || fatal "Checksums incorrectos en $ULTIMO"
  log "Copia íntegra."
  exit 0
fi

# --- Decisión de nivel GFS ----------------------------------------------------
# El timer llama con --tipo auto todos los días: la copia siempre se crea como
# diaria y se PROMOCIONA (enlace duro) a semanal los domingos y a mensual el
# día 1. Así solo se hace un pg_dump al día, sin importar cuántos niveles toque.
PROMOVER_SEMANAL="no"; PROMOVER_MENSUAL="no"
case "$TIPO" in
  auto)
    [ "$DIA_SEM" = "7" ]  && PROMOVER_SEMANAL="si"
    [ "$DIA_MES" = "01" ] && PROMOVER_MENSUAL="si" ;;
  diario)  ;;
  semanal) PROMOVER_SEMANAL="si" ;;
  mensual) PROMOVER_MENSUAL="si" ;;
  *) fatal "Tipo no válido: $TIPO (use auto|diario|semanal|mensual)" ;;
esac

DESTINO="$BACKUP_DIR/diarios/$FECHA"
mkdir -p "$DESTINO"
chmod 700 "$BACKUP_DIR"
# El contenedor de PostgreSQL corre como uid 999 (usuario `postgres`) y es quien
# escribe el volcado en este directorio a través del montaje /backup. Sin este
# chown, pg_dump falla con "Permission denied". Los 700 se mantienen: el
# directorio contiene datos reales del Ejército y el .env con los secretos.
chown 999:999 "$DESTINO"
chmod 700 "$DESTINO"

log "═══ LIMS IDIC · copia de seguridad ($TIPO) → $DESTINO"

# Espacio libre: un pg_dump que llena el disco puede tumbar PostgreSQL.
LIBRE_MB="$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')"
[ "$LIBRE_MB" -gt 2048 ] || fatal "Solo quedan ${LIBRE_MB} MB libres en $BACKUP_DIR. Se aborta antes de empezar."
log "Espacio libre en destino: ${LIBRE_MB} MB"

$COMPOSE ps postgres --status running 2>/dev/null | grep -q lims-postgres \
  || fatal "El contenedor de PostgreSQL no está en ejecución."

# --- 1. PostgreSQL ------------------------------------------------------------
# $BACKUP_DIR está montado como /backup dentro del contenedor de PostgreSQL
# (ver docker-compose.onpremise.yml): pg_dump escribe ahí directamente, sin
# pasar el volcado por una tubería del host.
DUMP_NOMBRE="lims_idic-$FECHA.dump"
DUMP_CONT="/backup/diarios/$FECHA/$DUMP_NOMBRE"
DUMP_HOST="$DESTINO/$DUMP_NOMBRE"

log "1/4 · Volcando PostgreSQL (pg_dump -Fc)..."
# -Fc (custom): comprimido, permite restauración selectiva y verificación con
# pg_restore --list. -Z6: buen equilibrio tamaño/CPU.
# --no-owner/--no-privileges: la restauración no depende de que existan los
# mismos roles, algo que importa al restaurar en un servidor de contingencia.
# La contraseña va por variable de entorno del proceso, nunca en la línea de
# órdenes (sería visible en el `ps` de cualquier usuario del contenedor).
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z6 \
          --no-owner --no-privileges -f "$DUMP_CONT" \
  || fatal "pg_dump falló. ¿Tiene el usuario 'postgres' del contenedor permiso de escritura en $BACKUP_DIR? (chown 999:999)"

[ -s "$DUMP_HOST" ] || fatal "pg_dump no generó el fichero esperado en $DUMP_HOST"
log "  $(du -h "$DUMP_HOST" | cut -f1) volcados"

# --- 2. Verificación de integridad (antes de dar la copia por buena) ---------
log "2/4 · Verificando la integridad del volcado..."
verificar_dump "$DUMP_CONT" "$DUMP_HOST" \
  || { rm -rf "$DESTINO"; fatal "El volcado NO supera la verificación. Copia descartada."; }

# --- 3. MinIO -----------------------------------------------------------------
log "3/4 · Volcando los objetos de MinIO..."
if [ -d "$DATA_DIR/minio" ]; then
  # MinIO escribe cada objeto de forma atómica, así que un tar del árbol es
  # consistente a nivel de objeto. Un objeto subido DURANTE el tar podría
  # quedar fuera: por eso el respaldo corre de madrugada (02:15).
  tar -czf "$DESTINO/minio-$FECHA.tar.gz" -C "$DATA_DIR" minio 2>/dev/null \
    || fatal "Falló el volcado de MinIO."
  log "  $(du -h "$DESTINO/minio-$FECHA.tar.gz" | cut -f1) en objetos"
else
  log "  AVISO: no existe $DATA_DIR/minio; se omite."
fi

# --- 4. Configuración ---------------------------------------------------------
# Sin .env ni certificados, un dump no sirve para reconstruir el servicio:
# JWT_SECRET distinto invalida las sesiones y las claves de MinIO no coincidirían.
log "4/4 · Volcando la configuración (.env, certificados, compose)..."
tar -czf "$DESTINO/config-$FECHA.tar.gz" \
    -C "$APP_DIR" .env docker-compose.onpremise.yml Caddyfile.onpremise \
    -C "$DATA_DIR" certs 2>/dev/null \
  || log "  AVISO: algún elemento de configuración no se pudo incluir."
chmod 600 "$DESTINO/config-$FECHA.tar.gz" 2>/dev/null || true

# --- Sellado ------------------------------------------------------------------
( cd "$DESTINO" && sha256sum ./* > SHA256SUMS 2>/dev/null )
{
  echo "LIMS IDIC · copia de seguridad"
  echo "fecha_utc   : $(date -u -Is)"
  echo "tipo        : $TIPO"
  echo "version     : ${LIMS_VERSION:-desconocida}"
  echo "servidor    : $(hostname)"
  echo "base_datos  : $POSTGRES_DB"
  echo "promocionada_semanal: $PROMOVER_SEMANAL"
  echo "promocionada_mensual: $PROMOVER_MENSUAL"
  echo "verificada  : si (pg_restore --list)"
} > "$DESTINO/MANIFIESTO.txt"

# --- Promoción GFS por enlace duro -------------------------------------------
promover() {
  local nivel="$1"
  local destino="$BACKUP_DIR/$nivel/$FECHA"
  mkdir -p "$destino"; chmod 700 "$destino"
  # cp -l: enlace duro. Ocupa 0 bytes extra; el fichero solo se libera del
  # disco cuando se borra el último nivel que lo referencia.
  cp -l "$DESTINO"/* "$destino"/ 2>/dev/null || cp "$DESTINO"/* "$destino"/
  log "Promocionada a $nivel"
}
[ "$PROMOVER_SEMANAL" = "si" ] && promover semanales
[ "$PROMOVER_MENSUAL" = "si" ] && promover mensuales

# --- Rotación -----------------------------------------------------------------
rotar() {
  local nivel="$1" conservar="$2" borradas=0
  local dir="$BACKUP_DIR/$nivel"
  [ -d "$dir" ] || return 0
  # Orden lexicográfico == cronológico (nombres YYYYmmdd-HHMMSS).
  local sobran
  sobran="$(find "$dir" -maxdepth 1 -type d -name '20*' | sort | head -n "-$conservar")"
  for d in $sobran; do rm -rf "$d"; borradas=$((borradas+1)); done
  log "Rotación $nivel: se conservan $conservar, se han borrado $borradas"
}
rotar diarios   "$RET_D"
rotar semanales "$RET_S"
rotar mensuales "$RET_M"

# --- Estado para la monitorización -------------------------------------------
printf 'estado=OK\nfecha=%s\nruta=%s\ntipo=%s\ntamano_bytes=%s\n' \
  "$(date -Is)" "$DESTINO" "$TIPO" "$(du -sb "$DESTINO" | cut -f1)" > "$ESTADO"

log "═══ COPIA CORRECTA Y VERIFICADA · $(du -sh "$DESTINO" | cut -f1) · $DESTINO"
log "Total en $BACKUP_DIR: $(du -sh "$BACKUP_DIR" | cut -f1) ($(find "$BACKUP_DIR" -maxdepth 2 -type d -name '20*' | wc -l) copias)"
