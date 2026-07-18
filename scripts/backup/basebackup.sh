#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Basebackup para PITR · Ejército de Chile · Aiuken
# =============================================================================
# La copia base sobre la que se aplica el WAL archivado para lograr PITR
# (recuperación a un instante concreto). Se ejecuta SEMANALMENTE (lims-basebackup
# .timer). Entre dos basebackups, el flujo continuo de WAL (archive-wal.sh) es lo
# que permite restaurar a cualquier segundo intermedio.
#
#   basebackup semanal  ──┐
#   WAL WAL WAL WAL WAL   │  = se puede restaurar a CUALQUIER punto de esta línea
#   ──────────────────────┴──────────────────────>  tiempo
#
# NO sustituye a backup.sh (pg_dump + MinIO + config con rotación GFS): lo
# COMPLEMENTA. pg_dump sigue siendo la copia lógica portable y verificable;
# basebackup + WAL son la copia física que baja el RPO a minutos. Ver PITR.md.
#
# Uso:
#   ./basebackup.sh                 # crea un basebackup y purga el WAL cubierto
#   ./basebackup.sh --solo-verificar  # verifica el último basebackup, no crea
#   ./basebackup.sh --solo-purgar-wal  # solo recicla WAL ya cubierto (no crea)
#
# Código de salida 0 = basebackup creado y VERIFICADO (o verificación correcta).
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lims-idic}"
[ -f "$APP_DIR/.env" ] || { echo "ERROR: no se encuentra $APP_DIR/.env"; exit 1; }
set -a; . "$APP_DIR/.env"; set +a

COMPOSE="docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $APP_DIR/.env"
BACKUP_DIR="${LIMS_BACKUP_DIR:-/srv/lims-backup}"
WAL_DIR_HOST="$BACKUP_DIR/wal"
BASE_DIR_HOST="$BACKUP_DIR/basebackups"
# Rutas DENTRO del contenedor. El WAL tiene su propio montaje (/walarchive, cedido
# a postgres); los basebackups van bajo /backup (BACKUP_DIR montado ahí).
WAL_DIR_CONT="/walarchive"
BASE_DIR_CONT="/backup/basebackups"
RET_BASE="${RETENCION_BASEBACKUPS:-4}"
# Lo consume la monitorización (chequeo-salud.sh) igual que .ultimo-estado.
ESTADO="$BACKUP_DIR/.ultimo-basebackup"

MODO="crear"
while [ $# -gt 0 ]; do
  case "$1" in
    --solo-verificar)   MODO="verificar"; shift ;;
    --solo-purgar-wal)  MODO="purgar"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1"; exit 1 ;;
  esac
done

log()   { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fatal() {
  log "ERROR: $*"
  printf 'estado=ERROR\nfecha=%s\nmensaje=%s\n' "$(date -Is)" "$*" > "$ESTADO" 2>/dev/null || true
  exit 1
}

FECHA="$(date '+%Y%m%d-%H%M%S')"

$COMPOSE ps postgres --status running 2>/dev/null | grep -q lims-postgres \
  || fatal "El contenedor de PostgreSQL no está en ejecución."

# psql administrativo (para pg_walfile_name). La contraseña va por entorno.
psql_q() { $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
             psql -U "$POSTGRES_USER" -d postgres -tAq "$@"; }

# --- Verificación de un basebackup -------------------------------------------
# $1 = ruta del basebackup en el host.
verificar_basebackup() {
  local dir="$1"
  [ -f "$dir/backup_manifest" ] || { log "  falta backup_manifest en $dir"; return 1; }
  grep -q '"WAL-Ranges"' "$dir/backup_manifest" || { log "  el manifest no declara WAL-Ranges"; return 1; }
  local tar
  for tar in "$dir"/base.tar.gz "$dir"/pg_wal.tar.gz; do
    [ -f "$tar" ] || { log "  falta $tar"; return 1; }
    # gzip -t recorre el fichero comprimido entero: detecta truncados y corruptos.
    gzip -t "$tar" 2>/dev/null || { log "  $tar está corrupto (gzip -t)"; return 1; }
  done
  log "  basebackup íntegro (base.tar.gz + pg_wal.tar.gz + manifest)"
  return 0
}

# =============================================================================
# MODO verificar
# =============================================================================
if [ "$MODO" = "verificar" ]; then
  ULTIMO="$(find "$BASE_DIR_HOST" -maxdepth 1 -type d -name '20*' 2>/dev/null | sort | tail -1)"
  [ -n "$ULTIMO" ] || fatal "No hay ningún basebackup que verificar en $BASE_DIR_HOST."
  log "Verificando el último basebackup: $ULTIMO"
  verificar_basebackup "$ULTIMO" || fatal "El basebackup NO supera la verificación."
  log "Basebackup íntegro."
  exit 0
fi

# --- Purga del WAL ya cubierto (compartida por 'crear' y 'purgar') -----------
# Conserva el WAL desde el START del basebackup MÁS ANTIGUO que se retiene, para
# poder restaurar a cualquier punto desde ese basebackup. Todo lo anterior es
# irrecuperable de todas formas (su basebackup ya se rotó) y solo ocupa disco.
purgar_wal() {
  local mas_antiguo start_wal
  mas_antiguo="$(find "$BASE_DIR_HOST" -maxdepth 1 -type d -name '20*' 2>/dev/null | sort | head -1)"
  [ -n "$mas_antiguo" ] || { log "No hay basebackups: no se purga WAL (se conserva todo)."; return 0; }
  if [ ! -f "$mas_antiguo/START_WAL" ]; then
    log "AVISO: $mas_antiguo no tiene START_WAL; no se purga WAL por seguridad."
    return 0
  fi
  start_wal="$(cat "$mas_antiguo/START_WAL")"
  [ -n "$start_wal" ] || { log "AVISO: START_WAL vacío; no se purga WAL."; return 0; }
  log "Reciclando WAL anterior a $start_wal (del basebackup más antiguo $(basename "$mas_antiguo"))..."
  # pg_archivecleanup borra todos los segmentos lógicamente ANTERIORES al indicado.
  # -x .gz: nuestros segmentos están comprimidos; hay que decírselo para que
  # compare bien los nombres y borre los .gz. Conserva siempre los .history.
  $COMPOSE exec -T postgres pg_archivecleanup -x .gz "$WAL_DIR_CONT" "$start_wal" 2>/dev/null \
    || log "AVISO: pg_archivecleanup terminó con error; revise $WAL_DIR_HOST a mano."
  log "WAL archivado tras la purga: $(find "$WAL_DIR_HOST" -maxdepth 1 -name '*.gz' 2>/dev/null | wc -l) segmentos, $(du -sh "$WAL_DIR_HOST" 2>/dev/null | cut -f1)"
}

if [ "$MODO" = "purgar" ]; then
  log "═══ LIMS IDIC · purga de WAL cubierto"
  purgar_wal
  exit 0
fi

# =============================================================================
# MODO crear (por defecto)
# =============================================================================
mkdir -p "$WAL_DIR_HOST" "$BASE_DIR_HOST"
chmod 700 "$WAL_DIR_HOST" "$BASE_DIR_HOST" 2>/dev/null || true
# El archivador de WAL corre como el usuario `postgres` (uid 70 en alpine), no
# como root. Se cede /walarchive a `postgres` DESDE DENTRO del contenedor, así
# funciona sea cual sea el uid de la imagen (70 alpine / 999 debian). Sin esto,
# archive_command daría "Permission denied" y el WAL se acumularía en pg_wal.
$COMPOSE exec -u 0 -T postgres sh -c 'chown postgres:postgres /walarchive && chmod 700 /walarchive' 2>/dev/null \
  || log "AVISO: no se pudo ceder /walarchive a postgres; si el archivado falla, revíselo."

DESTINO_HOST="$BASE_DIR_HOST/$FECHA"
DESTINO_CONT="$BASE_DIR_CONT/$FECHA"

log "═══ LIMS IDIC · basebackup para PITR → $DESTINO_HOST"

# Espacio libre: un basebackup ocupa aproximadamente lo que la base comprimida.
LIBRE_MB="$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')"
TAM_BD_MB="$(psql_q -c "SELECT (pg_database_size('$POSTGRES_DB')/1048576)::int" 2>/dev/null | tr -d '[:space:]' || echo 0)"
log "Tamaño de la base: ${TAM_BD_MB:-?} MB · libre en destino: ${LIBRE_MB} MB"
[ "$LIBRE_MB" -gt 2048 ] || fatal "Solo quedan ${LIBRE_MB} MB libres en $BACKUP_DIR. Se aborta."

# --- pg_basebackup ------------------------------------------------------------
# -Ft -z         : formato tar comprimido (base.tar.gz, pg_wal.tar.gz).
# -Xstream       : incluye el WAL generado DURANTE el backup por una 2ª conexión
#                  de replicación -> el basebackup es autoconsistente (puede
#                  alcanzar un estado coherente aunque falte el archivo).
# --checkpoint=fast : dispara el checkpoint de inmediato en vez de esperar.
# -P             : progreso al journal. -l : etiqueta legible.
# Conexión por el socket local del contenedor -> pg_hba `local replication all`
# (trust por defecto en la imagen). Se pasa PGPASSWORD por si el sitio endurece
# pg_hba a scram: no estorba con trust.
log "Ejecutando pg_basebackup (-Ft -z -Xstream)... puede tardar varios minutos."
if ! $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
       pg_basebackup -U "$POSTGRES_USER" -D "$DESTINO_CONT" \
                     -Ft -z -Xstream --checkpoint=fast -P \
                     -l "lims-idic basebackup $FECHA"; then
  rm -rf "$DESTINO_HOST" 2>/dev/null || true
  fatal "pg_basebackup falló. ¿pg_hba permite 'local replication'? Ver PITR.md §problemas."
fi

# --- Verificación -------------------------------------------------------------
log "Verificando la integridad del basebackup..."
verificar_basebackup "$DESTINO_HOST" \
  || { rm -rf "$DESTINO_HOST"; fatal "El basebackup NO supera la verificación. Descartado."; }

# --- START WAL: primer segmento necesario para restaurar DESDE este basebackup -
# Se obtiene del manifest (Start-LSN de la primera WAL-Range) y se traduce a
# nombre de segmento. Se guarda para que purgar_wal sepa hasta dónde reciclar y
# para que restore-pitr.sh sepa qué basebackup cubre un instante dado.
START_LSN="$(grep -o '"Start-LSN": *"[0-9A-Fa-f]*/[0-9A-Fa-f]*"' "$DESTINO_HOST/backup_manifest" \
             | head -1 | grep -o '[0-9A-Fa-f]*/[0-9A-Fa-f]*' || true)"
if [ -n "$START_LSN" ]; then
  START_WAL="$(psql_q -c "SELECT pg_walfile_name('$START_LSN')" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -n "$START_WAL" ]; then
    echo "$START_WAL" > "$DESTINO_HOST/START_WAL"
    log "  primer WAL necesario: $START_WAL (LSN $START_LSN)"
  else
    log "  AVISO: no se pudo traducir el LSN de inicio a nombre de WAL."
  fi
else
  log "  AVISO: no se pudo leer el Start-LSN del manifest."
fi

# Manifiesto legible junto al basebackup.
{
  echo "LIMS IDIC · basebackup para PITR"
  echo "fecha_utc   : $(date -u -Is)"
  echo "version     : ${LIMS_VERSION:-desconocida}"
  echo "servidor    : $(hostname)"
  echo "base_datos  : $POSTGRES_DB"
  echo "tam_base_mb : ${TAM_BD_MB:-?}"
  echo "start_lsn   : ${START_LSN:-?}"
  echo "start_wal   : $(cat "$DESTINO_HOST/START_WAL" 2>/dev/null || echo '?')"
  echo "formato     : tar.gz (-Ft -z -Xstream)"
} > "$DESTINO_HOST/MANIFIESTO.txt"

# Sellado por checksums (igual criterio que backup.sh).
( cd "$DESTINO_HOST" && sha256sum ./* > SHA256SUMS 2>/dev/null ) || true

TAM_BASE="$(du -sh "$DESTINO_HOST" | cut -f1)"
log "Basebackup verificado: $TAM_BASE"

# --- Rotación de basebackups --------------------------------------------------
# Conservar los RET_BASE más recientes. Al borrar los antiguos, su WAL asociado
# deja de ser necesario: por eso la purga de WAL va DESPUÉS, ya con la lista
# recortada.
SOBRAN="$(find "$BASE_DIR_HOST" -maxdepth 1 -type d -name '20*' | sort | head -n "-$RET_BASE" || true)"
BORRADOS=0
for d in $SOBRAN; do rm -rf "$d"; BORRADOS=$((BORRADOS+1)); done
log "Rotación de basebackups: se conservan $RET_BASE, se han borrado $BORRADOS"

# --- Purga del WAL ya cubierto ------------------------------------------------
purgar_wal

# --- Estado para la monitorización -------------------------------------------
printf 'estado=OK\nfecha=%s\nruta=%s\ntamano=%s\nstart_wal=%s\n' \
  "$(date -Is)" "$DESTINO_HOST" "$TAM_BASE" "$(cat "$DESTINO_HOST/START_WAL" 2>/dev/null || echo '?')" > "$ESTADO"

log "═══ BASEBACKUP CORRECTO Y VERIFICADO · $TAM_BASE · $DESTINO_HOST"
log "Basebackups retenidos: $(find "$BASE_DIR_HOST" -maxdepth 1 -type d -name '20*' | wc -l) · WAL archivado: $(du -sh "$WAL_DIR_HOST" 2>/dev/null | cut -f1)"
