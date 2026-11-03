#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Restauración de una exportación portable (contrato §4.8.4) · Aiuken
# =============================================================================
# Descifra un paquete de exportar-portable.sh, comprueba sus SHA-256 y:
#   --extraer DIR       deja el SQL plano y los CSV en DIR (para leerlos en
#                       Excel o cargarlos en otro sistema), o
#   --a-bd NOMBRE       restaura el SQL plano en una base NUEVA del PostgreSQL
#                       del LIMS (nunca sobre la base en uso: para volver a
#                       ella se cambia POSTGRES_DB en el .env tras revisarla).
#
# Uso:
#   ./restaurar-portable.sh <fichero.tar.gz.enc> --extraer /tmp/revision
#   ./restaurar-portable.sh <fichero.tar.gz.enc> --a-bd lims_restaurada
# La clave es RESPALDO_CLAVE del .env (o la variable de entorno del mismo nombre
# si se restaura en otro equipo).
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lims-idic}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  CLAVE_PREVIA="${RESPALDO_CLAVE:-}"
  set -a; . "$ENV_FILE"; set +a
  [ -n "$CLAVE_PREVIA" ] && RESPALDO_CLAVE="$CLAVE_PREVIA"
fi
COMPOSE="${COMPOSE:-docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $ENV_FILE}"
SERVICIO_PG="${SERVICIO_PG:-postgres}"
ITERACIONES=600000

log()   { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
fatal() { log "ERROR: $*"; exit 1; }

F="${1:-}"; MODO="${2:-}"; ARG="${3:-}"
[ -f "$F" ] || fatal "Uso: $0 <fichero.tar.gz.enc> --extraer DIR | --a-bd NOMBRE"
[ -n "${RESPALDO_CLAVE:-}" ] || fatal "Defina RESPALDO_CLAVE (en el .env o como variable de entorno)."
export RESPALDO_CLAVE

if [ -f "$F.sha256" ]; then
  ( cd "$(dirname "$F")" && sha256sum -c --quiet "$(basename "$F").sha256" ) || fatal "El fichero cifrado no coincide con su .sha256 (copia dañada)."
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; chmod 700 "$TMP"
openssl enc -d -aes-256-cbc -pbkdf2 -iter "$ITERACIONES" -md sha256 -pass env:RESPALDO_CLAVE -in "$F" | tar -xzf - -C "$TMP" \
  || fatal "No se pudo descifrar (¿clave distinta?)."
DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
( cd "$DIR" && sha256sum -c --quiet SHA256SUMS ) || fatal "Los SHA-256 internos no coinciden."
log "Paquete descifrado e íntegro: $(ls "$DIR/csv" | wc -l) tablas CSV."

case "$MODO" in
  --extraer)
    [ -n "$ARG" ] || fatal "Indique la carpeta de destino."
    mkdir -p "$ARG"; cp -r "$DIR"/. "$ARG"/; chmod -R go-rwx "$ARG"
    log "Extraído en $ARG (SQL plano en lims_idic.sql, tablas en csv/)." ;;
  --a-bd)
    [ -n "$ARG" ] || fatal "Indique el nombre de la base nueva."
    case "$ARG" in *[!a-z0-9_]*) fatal "Nombre de base no válido (solo minúsculas, números y _)." ;; esac
    [ "$ARG" != "${POSTGRES_DB:-}" ] || fatal "No se restaura sobre la base en uso (${POSTGRES_DB})."
    PG="$COMPOSE exec -T -e PGPASSWORD=$POSTGRES_PASSWORD $SERVICIO_PG"
    EXISTE="$($PG psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$ARG'" </dev/null | tr -d '[:space:]')"
    [ "$EXISTE" != "1" ] || fatal "La base $ARG ya existe: elija otro nombre o bórrela antes."
    $PG createdb -U "$POSTGRES_USER" "$ARG" </dev/null
    $PG psql -U "$POSTGRES_USER" -d "$ARG" -v ON_ERROR_STOP=1 -q < "$DIR/lims_idic.sql" >/dev/null \
      || fatal "La restauración del SQL falló (la base $ARG queda a medias: bórrela)."
    # Comprobación: filas por tabla iguales a las del manifiesto.
    DIF=0
    while IFS=';' read -r t filas; do
      [ "$t" = "tabla" ] && continue
      n="$($PG psql -U "$POSTGRES_USER" -d "$ARG" -tAc "SELECT count(*) FROM public.\"$t\"" </dev/null | tr -d '[:space:]')"
      [ "$n" = "$filas" ] || { log "  $t: $n filas (exportadas $filas)"; DIF=$((DIF+1)); }
    done < "$DIR/FILAS.csv"
    [ "$DIF" = 0 ] || fatal "$DIF tablas con un número de filas distinto al exportado (si la exportación se hizo con el sistema en uso, una tabla que recibía filas en ese momento puede diferir)."
    log "Restaurada en la base $ARG; filas idénticas a las exportadas en todas las tablas." ;;
  *) fatal "Indique --extraer DIR o --a-bd NOMBRE." ;;
esac
