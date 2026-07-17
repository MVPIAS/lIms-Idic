#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Restauración de copia de seguridad · Ejército de Chile · Aiuken
# =============================================================================
# DOS MODOS, y el seguro es el que va por defecto:
#
#   --a-bd-temporal <nombre>   Restaura a una base NUEVA junto a la productiva.
#                              No toca los datos vivos. Es el modo por defecto y
#                              el que se debe usar para el SIMULACRO TRIMESTRAL
#                              de restauración (GUIA_ONPREMISE.md §7.4).
#
#   --sobre-produccion         DESTRUCTIVO. Reemplaza la base productiva.
#                              Solo ante pérdida real de datos. Exige teclear una
#                              frase de confirmación completa; no basta con "s".
#
# Uso:
#   ./restore.sh --desde /srv/lims-backup/diarios/20260717-021500 --a-bd-temporal prueba_restauracion
#   ./restore.sh --desde /srv/lims-backup/mensuales/20260701-021500 --sobre-produccion
#   ./restore.sh --listar
#
# Una copia de seguridad que nunca se ha restaurado no es una copia de
# seguridad: es una suposición. Este script existe para poder probarlo sin
# arriesgar la base viva.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lims-idic}"
[ -f "$APP_DIR/.env" ] || { echo "ERROR: no se encuentra $APP_DIR/.env"; exit 1; }
set -a; . "$APP_DIR/.env"; set +a

COMPOSE="docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $APP_DIR/.env"
BACKUP_DIR="${LIMS_BACKUP_DIR:-/srv/lims-backup}"
DATA_DIR="${LIMS_DATA_DIR:-/srv/lims-idic}"

DESDE=""; BD_TEMPORAL=""; SOBRE_PROD="no"; LISTAR="no"; CON_MINIO="no"

log()   { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m ⚠\033[0m %s\n' "$*" >&2; }
fatal() { printf '\033[1;31m ✗ ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --desde)          DESDE="${2:-}"; shift 2 ;;
    --a-bd-temporal)  BD_TEMPORAL="${2:-}"; shift 2 ;;
    --sobre-produccion) SOBRE_PROD="si"; shift ;;
    --con-minio)      CON_MINIO="si"; shift ;;
    --listar)         LISTAR="si"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) fatal "Argumento desconocido: $1" ;;
  esac
done

psql_adm() { $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U "$POSTGRES_USER" -d postgres "$@"; }

# --- Listado de copias disponibles -------------------------------------------
if [ "$LISTAR" = "si" ]; then
  printf '\n  COPIAS DISPONIBLES EN %s\n\n' "$BACKUP_DIR"
  for nivel in diarios semanales mensuales; do
    [ -d "$BACKUP_DIR/$nivel" ] || continue
    printf '  \033[1m%s\033[0m\n' "$nivel"
    for d in $(find "$BACKUP_DIR/$nivel" -maxdepth 1 -type d -name '20*' | sort -r); do
      printf '    %-24s %8s   %s\n' "$(basename "$d")" "$(du -sh "$d" | cut -f1)" \
        "$(grep -h '^fecha_utc' "$d/MANIFIESTO.txt" 2>/dev/null | cut -d: -f2- | xargs || echo '(sin manifiesto)')"
    done
    echo
  done
  exit 0
fi

[ -n "$DESDE" ] || fatal "Falta --desde <directorio de copia>. Use --listar para ver las disponibles."
[ -d "$DESDE" ] || fatal "No existe el directorio de copia: $DESDE"

if [ "$SOBRE_PROD" = "no" ] && [ -z "$BD_TEMPORAL" ]; then
  fatal "Indique el destino: --a-bd-temporal <nombre> (seguro) o --sobre-produccion (destructivo)."
fi
if [ "$SOBRE_PROD" = "si" ] && [ -n "$BD_TEMPORAL" ]; then
  fatal "--a-bd-temporal y --sobre-produccion son excluyentes."
fi

DUMP="$(find "$DESDE" -maxdepth 1 -name 'lims_idic-*.dump' | head -1)"
[ -n "$DUMP" ] || fatal "No hay ningún fichero lims_idic-*.dump en $DESDE"

# --- 1. Integridad ------------------------------------------------------------
log "1/4 · Verificando la integridad de la copia..."
if [ -f "$DESDE/SHA256SUMS" ]; then
  ( cd "$DESDE" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ) \
    || fatal "CHECKSUM INCORRECTO en $DESDE. La copia está corrupta: NO se restaura."
  ok "Checksums correctos"
else
  warn "La copia no tiene SHA256SUMS (¿copia antigua?). Se continúa sin esa verificación."
fi

# Ruta equivalente dentro del contenedor (BACKUP_DIR está montado en /backup).
DUMP_CONT="/backup/${DUMP#"$BACKUP_DIR"/}"
OBJETOS="$($COMPOSE exec -T postgres pg_restore --list "$DUMP_CONT" 2>/dev/null | grep -cv '^;' || echo 0)"
[ "$OBJETOS" -gt 100 ] || fatal "El dump no es legible o está incompleto ($OBJETOS objetos)."
ok "Dump legible: $OBJETOS objetos"
[ -f "$DESDE/MANIFIESTO.txt" ] && sed 's/^/    /' "$DESDE/MANIFIESTO.txt"

# --- 2. Confirmación ----------------------------------------------------------
if [ "$SOBRE_PROD" = "si" ]; then
  BD_DESTINO="$POSTGRES_DB"
  FILAS="$(psql_adm -tAq -d "$POSTGRES_DB" -c "SELECT count(*) FROM orden_trabajo" 2>/dev/null | tr -d '[:space:]' || echo '?')"
  cat <<TXT

  ╔════════════════════════════════════════════════════════════════════╗
  ║                    ⚠  OPERACIÓN DESTRUCTIVA  ⚠                     ║
  ╚════════════════════════════════════════════════════════════════════╝

  Va a REEMPLAZAR la base de datos PRODUCTIVA del LIMS del IDIC.

     Base destino     : $POSTGRES_DB  (contiene ahora $FILAS órdenes de trabajo)
     Copia de origen  : $DESDE
     Servidor         : $(hostname)

  TODO lo que haya entrado en el LIMS después de esa copia SE PERDERÁ:
  órdenes de trabajo, resultados de ensayo y cadena de custodia incluidos.

  Antes de continuar, valore restaurar primero a una base temporal:
     $0 --desde $DESDE --a-bd-temporal verificacion

TXT
  printf '  Para continuar, teclee exactamente: \033[1mRESTAURAR PRODUCCION\033[0m\n  > '
  read -r RESPUESTA
  [ "$RESPUESTA" = "RESTAURAR PRODUCCION" ] || { echo; fatal "Confirmación incorrecta. No se ha modificado nada."; }

  # Red de seguridad: por muy convencido que esté el operador, primero se
  # respalda el estado actual. Si la copia restaurada resulta ser la
  # equivocada, este volcado es la única vuelta atrás.
  log "Respaldando el estado ACTUAL antes de sobrescribirlo..."
  PREV="/backup/pre-restauracion-$(date '+%Y%m%d-%H%M%S').dump"
  $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z6 --no-owner --no-privileges -f "$PREV" \
    || fatal "No se pudo respaldar el estado actual. Se aborta la restauración."
  ok "Estado previo guardado en $BACKUP_DIR/$(basename "$PREV")"
else
  BD_DESTINO="$BD_TEMPORAL"
  case "$BD_TEMPORAL" in
    "$POSTGRES_DB") fatal "El nombre temporal no puede ser el de la base productiva ($POSTGRES_DB)." ;;
    *[!a-zA-Z0-9_]*) fatal "Nombre de base no válido: use solo letras, números y guion bajo." ;;
  esac
  log "Modo SEGURO: se restaura a la base temporal '$BD_TEMPORAL'. La base productiva '$POSTGRES_DB' no se toca."
fi

# --- 3. Restauración ----------------------------------------------------------
log "2/4 · Preparando la base '$BD_DESTINO'..."
if [ "$SOBRE_PROD" = "si" ]; then
  # La API mantiene un pool de conexiones abierto: sin cerrarlo, el DROP falla.
  log "Deteniendo api y web para liberar conexiones..."
  $COMPOSE stop api web >/dev/null 2>&1 || true
  psql_adm -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$BD_DESTINO' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
fi
psql_adm -q -c "DROP DATABASE IF EXISTS \"$BD_DESTINO\";" >/dev/null 2>&1 \
  || fatal "No se pudo eliminar la base '$BD_DESTINO' (¿hay conexiones abiertas?)."
psql_adm -q -c "CREATE DATABASE \"$BD_DESTINO\" OWNER \"$POSTGRES_USER\";" >/dev/null \
  || fatal "No se pudo crear la base '$BD_DESTINO'."
ok "Base '$BD_DESTINO' creada vacía"

log "3/4 · Restaurando el volcado (puede tardar varios minutos)..."
# --exit-on-error NO: el dump se generó con --no-owner y puede emitir avisos
# benignos sobre extensiones o comentarios. Los errores reales se detectan
# después con el recuento de tablas.
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_restore -U "$POSTGRES_USER" -d "$BD_DESTINO" --no-owner --no-privileges -j 4 "$DUMP_CONT" \
  2>&1 | grep -viE 'warning|already exists' | head -20 || true

# --- 4. Verificación de lo restaurado ----------------------------------------
log "4/4 · Verificando el resultado..."
TABLAS="$($COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U "$POSTGRES_USER" -d "$BD_DESTINO" -tAq \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')"
[ "${TABLAS:-0}" -gt 20 ] || fatal "Solo se han restaurado ${TABLAS:-0} tablas. La restauración ha FALLADO."

printf '\n    %-22s %s\n' "TABLA" "FILAS"
for t in tenant usuario rol cliente metodo orden_trabajo muestra resultado; do
  n="$($COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U "$POSTGRES_USER" -d "$BD_DESTINO" -tAq \
       -c "SELECT count(*) FROM $t" 2>/dev/null | tr -d '[:space:]' || echo 'n/d')"
  printf '    %-22s %s\n' "$t" "$n"
done
echo
ok "$TABLAS tablas restauradas en '$BD_DESTINO'"

# --- MinIO --------------------------------------------------------------------
MINIO_TAR="$(find "$DESDE" -maxdepth 1 -name 'minio-*.tar.gz' | head -1)"
if [ -n "$MINIO_TAR" ] && [ "$SOBRE_PROD" = "si" ] && [ "$CON_MINIO" = "si" ]; then
  log "Restaurando los objetos de MinIO..."
  $COMPOSE stop minio >/dev/null 2>&1 || true
  mv "$DATA_DIR/minio" "$DATA_DIR/minio.previo-$(date +%s)"
  tar -xzf "$MINIO_TAR" -C "$DATA_DIR"
  chown -R 1000:1000 "$DATA_DIR/minio" 2>/dev/null || true
  $COMPOSE start minio >/dev/null 2>&1 || true
  ok "Objetos restaurados (el árbol anterior se conservó como minio.previo-*)"
elif [ -n "$MINIO_TAR" ] && [ "$SOBRE_PROD" = "si" ]; then
  warn "La copia incluye objetos de MinIO pero NO se han restaurado.
   Los documentos y certificados firmados siguen siendo los actuales.
   Si también necesita recuperarlos, repita añadiendo --con-minio."
fi

# --- Cierre -------------------------------------------------------------------
if [ "$SOBRE_PROD" = "si" ]; then
  log "Rearrancando api y web..."
  $COMPOSE start api web >/dev/null 2>&1 || true
  sleep 10
  cat <<TXT

  RESTAURACIÓN DE PRODUCCIÓN COMPLETADA
    · Compruebe la salud:  curl -k https://$DOMAIN/api/health
    · Estado previo a esta restauración, por si hay que volver atrás:
        $BACKUP_DIR/$(basename "$PREV")
    · Registre la incidencia y el motivo de la restauración en el
      libro de operación del IDIC.

TXT
else
  cat <<TXT

  SIMULACRO DE RESTAURACIÓN CORRECTO
    La copia $(basename "$DESDE") es restaurable: se ha reconstruido en la
    base temporal '$BD_TEMPORAL' sin tocar la productiva.

    Puede inspeccionarla con:
      docker compose -f $APP_DIR/docker-compose.onpremise.yml exec postgres \\
        psql -U $POSTGRES_USER -d $BD_TEMPORAL

    ELIMINE la base temporal cuando termine (ocupa espacio en el mismo disco):
      docker compose -f $APP_DIR/docker-compose.onpremise.yml exec -T postgres \\
        psql -U $POSTGRES_USER -d postgres -c 'DROP DATABASE "$BD_TEMPORAL";'

TXT
fi
