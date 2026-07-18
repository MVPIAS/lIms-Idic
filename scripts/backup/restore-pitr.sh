#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Restauración PITR (a un instante concreto) · Ejército · Aiuken
# =============================================================================
# Reconstruye la base a un SEGUNDO concreto del pasado combinando:
#   basebackup (copia física)  +  WAL archivado (archive-wal.sh)
#
# SEGURIDAD POR DISEÑO: SIEMPRE restaura a una INSTANCIA Y VOLUMEN SEPARADOS
# (un contenedor `lims-postgres-pitr` aislado, sin red, sin puertos), NUNCA sobre
# la base productiva. Recuperar el dato y luego decidir qué hacer con él es una
# operación deliberada del operador, no un automatismo destructivo.
#
# Uso:
#   # Restaurar al instante justo antes de un borrado accidental:
#   ./restore-pitr.sh --target-time "2026-07-17 14:35:00"
#
#   # Elegir basebackup y destino a mano:
#   ./restore-pitr.sh --target-time "2026-07-17 14:35:00" \
#       --basebackup /srv/lims-backup/basebackups/20260714-030000 \
#       --a-directorio /srv/restauracion/prueba
#
#   ./restore-pitr.sh --listar          # basebackups y ventana WAL disponibles
#   ./restore-pitr.sh --descartar       # para y borra la instancia de recuperación
#
# Tras la recuperación, el operador inspecciona la instancia aislada y, si es la
# correcta, EXTRAE los datos (pg_dump) para llevarlos a producción con
# restore.sh. Ver PITR.md §restauración paso a paso.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lims-idic}"
[ -f "$APP_DIR/.env" ] || { echo "ERROR: no se encuentra $APP_DIR/.env"; exit 1; }
set -a; . "$APP_DIR/.env"; set +a

BACKUP_DIR="${LIMS_BACKUP_DIR:-/srv/lims-backup}"
DATA_DIR="${LIMS_DATA_DIR:-/srv/lims-idic}"
WAL_DIR_HOST="$BACKUP_DIR/wal"
BASE_DIR_HOST="$BACKUP_DIR/basebackups"
IMG="${POSTGRES_IMAGE:-postgres:16-alpine}"
CONT="lims-postgres-pitr"          # nombre fijo de la instancia de recuperación
RED="lims-idic"                    # solo para referencia; el contenedor va sin red

TARGET_TIME=""; BASEBACKUP=""; DEST=""; MODO="restaurar"

log()   { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m ⚠\033[0m %s\n' "$*" >&2; }
fatal() { printf '\033[1;31m ✗ ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --target-time)  TARGET_TIME="${2:-}"; shift 2 ;;
    --basebackup)   BASEBACKUP="${2:-}"; shift 2 ;;
    --a-directorio) DEST="${2:-}"; shift 2 ;;
    --listar)       MODO="listar"; shift ;;
    --descartar)    MODO="descartar"; shift ;;
    -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
    *) fatal "Argumento desconocido: $1" ;;
  esac
done

# Convierte un nombre de basebackup (YYYYmmdd-HHMMSS, hora local) a epoch.
fecha_dir_a_epoch() {
  local n="$1"  # 20260717-021500
  local f="${n:0:4}-${n:4:2}-${n:6:2} ${n:9:2}:${n:11:2}:${n:13:2}"
  date -d "$f" +%s 2>/dev/null || echo 0
}

# =============================================================================
# MODO listar
# =============================================================================
if [ "$MODO" = "listar" ]; then
  printf '\n  BASEBACKUPS DISPONIBLES EN %s\n\n' "$BASE_DIR_HOST"
  if [ -d "$BASE_DIR_HOST" ]; then
    for d in $(find "$BASE_DIR_HOST" -maxdepth 1 -type d -name '20*' | sort); do
      printf '    %-20s %8s   start_wal=%s\n' "$(basename "$d")" \
        "$(du -sh "$d" 2>/dev/null | cut -f1)" "$(cat "$d/START_WAL" 2>/dev/null || echo '?')"
    done
  fi
  echo
  if [ -d "$WAL_DIR_HOST" ]; then
    N="$(find "$WAL_DIR_HOST" -maxdepth 1 -name '*.gz' | wc -l)"
    PRIMERO="$(find "$WAL_DIR_HOST" -maxdepth 1 -name '*.gz' -printf '%f\n' 2>/dev/null | sort | head -1)"
    ULTIMO="$(find "$WAL_DIR_HOST" -maxdepth 1 -name '*.gz' -printf '%T+ %f\n' 2>/dev/null | sort | tail -1)"
    printf '  WAL ARCHIVADO: %s segmentos · %s\n' "$N" "$(du -sh "$WAL_DIR_HOST" 2>/dev/null | cut -f1)"
    printf '    primero: %s\n' "${PRIMERO:-ninguno}"
    printf '    último : %s   (marca de tiempo del fichero = fin aproximado de la ventana PITR)\n' "${ULTIMO:-ninguno}"
    echo
    echo "  La ventana PITR va desde el START del basebackup más antiguo hasta el"
    echo "  último WAL archivado. Elija --target-time DENTRO de esa ventana."
  fi
  echo
  exit 0
fi

# =============================================================================
# MODO descartar
# =============================================================================
if [ "$MODO" = "descartar" ]; then
  if docker inspect "$CONT" >/dev/null 2>&1; then
    log "Deteniendo y eliminando la instancia de recuperación '$CONT'..."
    docker rm -f "$CONT" >/dev/null 2>&1 || true
    ok "Contenedor '$CONT' eliminado."
  else
    ok "No hay contenedor '$CONT' que eliminar."
  fi
  echo
  echo "  El VOLUMEN de recuperación NO se borra automáticamente (puede contener"
  echo "  datos que aún no ha extraído). Bórrelo a mano cuando ya no lo necesite:"
  echo "     sudo rm -rf <directorio que indicó en --a-directorio>"
  echo
  exit 0
fi

# =============================================================================
# MODO restaurar
# =============================================================================
command -v docker >/dev/null || fatal "docker no está disponible."
[ -d "$BASE_DIR_HOST" ] || fatal "No existe $BASE_DIR_HOST: no hay basebackups. Ejecute basebackup.sh primero."

# uid/gid del usuario postgres EN LA IMAGEN (70 en alpine, 999 en debian). El
# PGDATA restaurado debe pertenecerle o PostgreSQL no podrá leerlo.
PG_UID="$(docker run --rm "$IMG" id -u postgres 2>/dev/null || echo 70)"
PG_GID="$(docker run --rm "$IMG" id -g postgres 2>/dev/null || echo 70)"

# --- 1. Elegir basebackup -----------------------------------------------------
if [ -z "$BASEBACKUP" ]; then
  # El basebackup válido es el MÁS RECIENTE cuyo inicio sea <= target-time.
  # (Restaurar sobre uno posterior al objetivo es imposible: aún no existían
  # esos datos.) Sin target-time, se toma el más reciente.
  if [ -n "$TARGET_TIME" ]; then
    TT_EPOCH="$(date -d "$TARGET_TIME" +%s 2>/dev/null)" || fatal "Fecha --target-time no válida: '$TARGET_TIME' (use 'YYYY-MM-DD HH:MM:SS')."
    ELEGIDO=""
    for d in $(find "$BASE_DIR_HOST" -maxdepth 1 -type d -name '20*' | sort); do
      BE="$(fecha_dir_a_epoch "$(basename "$d")")"
      [ "$BE" -le "$TT_EPOCH" ] && ELEGIDO="$d"
    done
    BASEBACKUP="$ELEGIDO"
    [ -n "$BASEBACKUP" ] || fatal "No hay ningún basebackup anterior a $TARGET_TIME. El objetivo es más antiguo que la copia más vieja: no se puede restaurar a ese instante."
  else
    BASEBACKUP="$(find "$BASE_DIR_HOST" -maxdepth 1 -type d -name '20*' | sort | tail -1)"
    [ -n "$BASEBACKUP" ] || fatal "No hay ningún basebackup en $BASE_DIR_HOST."
  fi
fi
[ -d "$BASEBACKUP" ] || fatal "No existe el basebackup: $BASEBACKUP"
[ -f "$BASEBACKUP/base.tar.gz" ] || fatal "El basebackup $BASEBACKUP no contiene base.tar.gz"
log "Basebackup de partida: $BASEBACKUP"
[ -f "$BASEBACKUP/MANIFIESTO.txt" ] && sed 's/^/    /' "$BASEBACKUP/MANIFIESTO.txt"

# --- 2. Integridad del basebackup --------------------------------------------
log "Verificando la integridad del basebackup..."
if [ -f "$BASEBACKUP/SHA256SUMS" ]; then
  ( cd "$BASEBACKUP" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ) \
    || fatal "CHECKSUM INCORRECTO en $BASEBACKUP. Copia corrupta: NO se restaura."
  ok "Checksums correctos"
fi
gzip -t "$BASEBACKUP/base.tar.gz" 2>/dev/null || fatal "base.tar.gz está corrupto."
[ -f "$BASEBACKUP/pg_wal.tar.gz" ] && { gzip -t "$BASEBACKUP/pg_wal.tar.gz" 2>/dev/null || fatal "pg_wal.tar.gz está corrupto."; }
ok "base.tar.gz íntegro"

# --- 3. Destino: SIEMPRE separado de la base viva -----------------------------
[ -n "$DEST" ] || DEST="$BACKUP_DIR/restauracion-pitr/$(date '+%Y%m%d-%H%M%S')"
# Salvaguarda dura: jamás sobre el volumen productivo.
case "$(readlink -f "$DEST" 2>/dev/null || echo "$DEST")" in
  "$(readlink -f "$DATA_DIR/postgres" 2>/dev/null)"|"$DATA_DIR/postgres")
    fatal "El destino apunta al volumen PRODUCTIVO ($DATA_DIR/postgres). PROHIBIDO." ;;
esac
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  fatal "El directorio de destino '$DEST' ya existe y NO está vacío. Indique otro con --a-directorio o bórrelo."
fi

if docker inspect "$CONT" >/dev/null 2>&1; then
  fatal "Ya existe un contenedor '$CONT' de una recuperación anterior.
   Ciérrelo antes de empezar otra:  $0 --descartar"
fi

# --- 4. Confirmación explícita ------------------------------------------------
VENTANA_FIN="$(find "$WAL_DIR_HOST" -maxdepth 1 -name '*.gz' -printf '%TY-%Tm-%Td %TH:%TM:%TS\n' 2>/dev/null | sort | tail -1 | cut -d. -f1)"
cat <<TXT

  ╔════════════════════════════════════════════════════════════════════╗
  ║              RESTAURACIÓN A UN INSTANTE (PITR)                       ║
  ╚════════════════════════════════════════════════════════════════════╝

     Instante objetivo : ${TARGET_TIME:-<fin del WAL archivado (lo más reciente)>}
     Basebackup base   : $(basename "$BASEBACKUP")
     Destino (aislado) : $DEST
     Instancia         : contenedor '$CONT' (sin red, sin puertos)
     Último WAL aprox. : ${VENTANA_FIN:-desconocido}

  Esto NO toca la base productiva. Levanta una instancia PostgreSQL separada,
  reproduce el WAL hasta el instante indicado y se detiene ahí para que usted
  inspeccione el resultado. Consume disco (~el tamaño de la base) en el destino.

TXT
printf '  Para continuar, teclee: \033[1mRESTAURAR PITR\033[0m\n  > '
read -r RESP
[ "$RESP" = "RESTAURAR PITR" ] || { echo; fatal "Confirmación incorrecta. No se ha hecho nada."; }

# --- 5. Desplegar el basebackup en el destino ---------------------------------
log "Desplegando el basebackup en $DEST ..."
mkdir -p "$DEST/pg_wal"
# --no-same-owner + chown posterior: reproducible sea cual sea el uid del tar.
tar --no-same-owner -xzf "$BASEBACKUP/base.tar.gz"   -C "$DEST"
tar --no-same-owner -xzf "$BASEBACKUP/pg_wal.tar.gz" -C "$DEST/pg_wal"
# PostgreSQL debe ser dueño del PGDATA y exige permisos 700.
chown -R "$PG_UID:$PG_GID" "$DEST"
chmod 700 "$DEST"
ok "Basebackup desplegado (PGDATA cedido a uid $PG_UID)"

# --- 6. Configuración de recuperación ----------------------------------------
# recovery.signal -> PostgreSQL arranca en modo recuperación de archivo.
touch "$DEST/recovery.signal"; chown "$PG_UID:$PG_GID" "$DEST/recovery.signal"
{
  echo ""
  echo "# --- PITR generado por restore-pitr.sh $(date -Is) ---"
  # restore_command: descomprime cada segmento pedido desde el archivo (montado
  # de solo lectura en /walarchive). Es el inverso exacto de archive-wal.sh.
  echo "restore_command = 'gunzip -c /walarchive/%f.gz > %p'"
  # Zona horaria explícita: el target-time se interpreta en esta zona, sin
  # ambigüedad respecto al reloj del contenedor.
  echo "timezone = 'America/Santiago'"
  echo "log_timezone = 'America/Santiago'"
  if [ -n "$TARGET_TIME" ]; then
    echo "recovery_target_time = '$TARGET_TIME'"
    echo "recovery_target_inclusive = on"
  fi
  # Al alcanzar el objetivo, PROMOCIONA (sale de recuperación y queda usable).
  echo "recovery_target_action = 'promote'"
} >> "$DEST/postgresql.auto.conf"
chown "$PG_UID:$PG_GID" "$DEST/postgresql.auto.conf"
ok "Recuperación configurada (restore_command + objetivo)"

# --- 7. Levantar la instancia de recuperación aislada -------------------------
# --network none : sin red. Sin -p : sin puertos. Se accede solo por docker exec.
# El WAL archivado se monta de SOLO LECTURA en /walarchive: la recuperación jamás
# lo altera. NO se fija -u: la imagen arranca postgres con su propio uid (70/999)
# y los ficheros del PGDATA se ceden a ese usuario abajo.
log "Levantando la instancia de recuperación '$CONT' (aislada)..."
docker run -d --name "$CONT" \
  --network none \
  -e TZ=America/Santiago -e PGTZ=America/Santiago \
  -v "$DEST":/var/lib/postgresql/data \
  -v "$WAL_DIR_HOST":/walarchive:ro \
  "$IMG" >/dev/null \
  || fatal "No se pudo arrancar el contenedor de recuperación."

# --- 8. Esperar a que termine la recuperación ---------------------------------
log "Reproduciendo WAL hasta el objetivo (siga el detalle con: docker logs -f $CONT)..."
FIN="no"
for i in $(seq 1 120); do   # hasta 10 min
  sleep 5
  if ! docker inspect "$CONT" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    warn "El contenedor de recuperación se detuvo. Últimas líneas del registro:"
    docker logs --tail 30 "$CONT" 2>&1 | sed 's/^/    /'
    fatal "La recuperación falló. Revise el objetivo y la disponibilidad de WAL."
  fi
  # ¿Ya promovió? pg_is_in_recovery()=false -> recuperación terminada.
  EN_REC="$(docker exec "$CONT" psql -U "$POSTGRES_USER" -d postgres -tAq \
             -c 'SELECT pg_is_in_recovery()' 2>/dev/null | tr -d '[:space:]' || echo '')"
  if [ "$EN_REC" = "f" ]; then FIN="si"; break; fi
  # Señal de error frecuente: objetivo anterior al basebackup.
  if docker logs --tail 5 "$CONT" 2>&1 | grep -qi 'recovery_target_time.*before'; then
    docker logs --tail 20 "$CONT" 2>&1 | sed 's/^/    /'
    fatal "El instante objetivo es ANTERIOR al basebackup elegido. Elija --target-time posterior o un basebackup más antiguo."
  fi
done
[ "$FIN" = "si" ] || { docker logs --tail 30 "$CONT" 2>&1 | sed 's/^/    /'; fatal "La recuperación no terminó en 10 min. Revise docker logs $CONT."; }
ok "Recuperación completada: la instancia salió del modo recuperación"

# --- 9. Verificación ----------------------------------------------------------
log "Verificando la instancia recuperada..."
REPLAY="$(docker exec "$CONT" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
          -c 'SELECT pg_last_wal_replay_lsn()' 2>/dev/null | tr -d '[:space:]' || echo '?')"
TABLAS="$(docker exec "$CONT" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq \
          -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d '[:space:]' || echo 0)"
[ "${TABLAS:-0}" -gt 20 ] || fatal "Solo hay ${TABLAS:-0} tablas en la instancia recuperada. Algo falló."
printf '\n    %-22s %s\n' "TABLA" "FILAS"
for t in tenant usuario rol cliente metodo orden_trabajo muestra resultado; do
  n="$(docker exec "$CONT" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "SELECT count(*) FROM $t" 2>/dev/null | tr -d '[:space:]' || echo 'n/d')"
  printf '    %-22s %s\n' "$t" "$n"
done
echo
ok "$TABLAS tablas · último LSN reproducido: $REPLAY"

# --- 10. Cierre e instrucciones ----------------------------------------------
cat <<TXT

  RECUPERACIÓN PITR COMPLETADA (instancia aislada, producción intacta)

    Instante restaurado : ${TARGET_TIME:-fin del WAL archivado}
    Instancia           : contenedor '$CONT'
    Volumen             : $DEST

  INSPECCIONAR:
    docker exec -it $CONT psql -U $POSTGRES_USER -d $POSTGRES_DB

  EXTRAER los datos recuperados (para revisarlos o llevarlos a producción):
    docker exec -e PGPASSWORD='<no necesario: trust local>' $CONT \\
      pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -Z6 --no-owner --no-privileges \\
      -f /var/lib/postgresql/data/recuperado.dump
    docker cp $CONT:/var/lib/postgresql/data/recuperado.dump $BACKUP_DIR/

    -> ese .dump se restaura en producción, PREVIO SIMULACRO, con:
       restore.sh --desde <carpeta con el dump>  (ver PITR.md §llevar a producción)

  CUANDO TERMINE, libere el disco:
    $0 --descartar          # para y borra el contenedor
    sudo rm -rf $DEST       # borra el volumen de recuperación

TXT
