#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Exportación portable cifrada (contrato §4.8.4) · Aiuken
# =============================================================================
# Además de la copia diaria (backup.sh, formato custom de PostgreSQL), el
# contrato pide copias en formatos ABIERTOS: SQL y CSV, como mínimo cada 15
# días. Esta exportación genera, en una sola ejecución:
#   1. lims_idic.sql   · volcado SQL PLANO (pg_dump -Fp), legible y restaurable
#                        con psql en cualquier PostgreSQL ≥ 16, sin herramientas
#                        propias del LIMS.
#   2. csv/<tabla>.csv · una tabla por fichero (esquema public, con cabecera,
#                        UTF-8, separador «,» y comillas RFC 4180), que se abre
#                        en Excel o LibreOffice.
#   3. MANIFIESTO.txt  · fecha, versión, filas por tabla y SHA-256 de cada fichero.
# Todo se empaqueta en un .tar.gz y se CIFRA con AES-256 (openssl, PBKDF2 con
# 600 000 iteraciones) con la clave RESPALDO_CLAVE del .env: el fichero que sale
# del servidor (disco externo, NAS) no se puede leer sin ella. Sin cifrar no
# queda nada en disco: el paquete se cifra en la misma tubería.
#
# Programación: lims-exportacion.timer (domingos 04:00, cada semana: el doble
# de frecuencia que exige el contrato). Retención: RETENCION_PORTABLES (8 por
# defecto, unos dos meses).
#
# Uso:
#   ./exportar-portable.sh                 # exportación completa
#   ./exportar-portable.sh --verificar F   # descifra F a memoria y comprueba los SHA-256
# Restauración: restaurar-portable.sh (GUIA_ONPREMISE.md §7.6).
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lims-idic}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
[ -f "$ENV_FILE" ] || { echo "ERROR: no se encuentra $ENV_FILE"; exit 1; }
set -a; . "$ENV_FILE"; set +a

COMPOSE="${COMPOSE:-docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $ENV_FILE}"
SERVICIO_PG="${SERVICIO_PG:-postgres}"
BACKUP_DIR="${LIMS_BACKUP_DIR:-/srv/lims-backup}"
DESTINO_DIR="$BACKUP_DIR/portables"
RETENCION="${RETENCION_PORTABLES:-8}"
ITERACIONES=600000

log()   { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
fatal() { log "ERROR: $*"; exit 1; }

command -v openssl >/dev/null || fatal "Falta openssl."
[ -n "${RESPALDO_CLAVE:-}" ] && [ "${RESPALDO_CLAVE}" != "<<GENERAR>>" ] \
  || fatal "RESPALDO_CLAVE no está definida en $ENV_FILE (el instalador la genera; guárdela fuera del servidor)."
[ "${#RESPALDO_CLAVE}" -ge 20 ] || fatal "RESPALDO_CLAVE es demasiado corta (mínimo 20 caracteres)."
export RESPALDO_CLAVE

descifrar() { openssl enc -d -aes-256-cbc -pbkdf2 -iter "$ITERACIONES" -md sha256 -pass env:RESPALDO_CLAVE -in "$1"; }

# --- Verificación de un paquete ya generado ----------------------------------
if [ "${1:-}" = "--verificar" ]; then
  F="${2:-}"; [ -f "$F" ] || fatal "Indique el fichero .tar.gz.enc a verificar."
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  descifrar "$F" | tar -xzf - -C "$TMP" || fatal "No se pudo descifrar $F (¿clave distinta?)."
  ( cd "$TMP"/* && sha256sum -c --quiet SHA256SUMS ) || fatal "Los SHA-256 no coinciden en $F."
  log "Paquete íntegro: $(find "$TMP" -path '*/csv/*.csv' | wc -l) tablas CSV + SQL plano."
  exit 0
fi

FECHA="$(date '+%Y%m%d-%H%M%S')"
mkdir -p "$DESTINO_DIR"; chmod 700 "$DESTINO_DIR"
TRABAJO="$(mktemp -d "$BACKUP_DIR/.exportando-XXXXXX")"
trap 'rm -rf "$TRABAJO"' EXIT
chmod 700 "$TRABAJO"
CARPETA="$TRABAJO/lims_idic-$FECHA"
mkdir -p "$CARPETA/csv"

LIBRE_MB="$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')"
[ "$LIBRE_MB" -gt 2048 ] || fatal "Solo quedan ${LIBRE_MB} MB libres en $BACKUP_DIR."

PSQL="$COMPOSE exec -T -e PGPASSWORD=$POSTGRES_PASSWORD $SERVICIO_PG psql -U $POSTGRES_USER -d $POSTGRES_DB -v ON_ERROR_STOP=1 -qAt"

log "═══ LIMS IDIC · exportación portable → $DESTINO_DIR"

# --- 1. SQL plano -------------------------------------------------------------
log "1/3 · Volcado SQL plano (pg_dump -Fp)..."
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" "$SERVICIO_PG" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fp --no-owner --no-privileges </dev/null > "$CARPETA/lims_idic.sql" \
  || fatal "pg_dump falló."
grep -q "PostgreSQL database dump complete" "$CARPETA/lims_idic.sql" || fatal "El volcado SQL está incompleto."
log "  $(du -h "$CARPETA/lims_idic.sql" | cut -f1) de SQL"

# --- 2. CSV por tabla ---------------------------------------------------------
log "2/3 · Tablas a CSV..."
# Tablas normales y tablas particionadas (la madre, con todas sus filas); las
# particiones sueltas no, para no duplicar filas (audit_log por mes).
TABLAS="$($PSQL -c "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition ORDER BY c.relname" </dev/null)"
N=0
{
  echo "tabla;filas"
  for t in $TABLAS; do
    # Nombre validado (solo [a-z0-9_]): pg_tables lo da, pero no se interpola nada raro.
    case "$t" in *[!a-z0-9_]*) log "  se omite la tabla de nombre no estándar: $t"; continue ;; esac
    $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" "$SERVICIO_PG" \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -qAt \
      -c "COPY (SELECT * FROM public.\"$t\") TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')" </dev/null > "$CARPETA/csv/$t.csv" \
      || fatal "No se pudo exportar la tabla $t."
    # Filas según la base (no líneas del CSV: un texto puede traer saltos de línea).
    filas="$($PSQL -c "SELECT count(*) FROM public.\"$t\"" </dev/null | tr -d '[:space:]')"
    echo "$t;$filas"
    N=$((N+1))
  done
} > "$CARPETA/FILAS.csv"
log "  $N tablas exportadas"

# --- 3. Manifiesto, sellado y cifrado ----------------------------------------
( cd "$CARPETA" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )
{
  echo "LIMS IDIC · exportación portable (contrato §4.8.4)"
  echo "fecha_utc : $(date -u -Is)"
  echo "version   : ${LIMS_VERSION:-desconocida}"
  echo "servidor  : $(hostname)"
  echo "base      : $POSTGRES_DB"
  echo "contenido : lims_idic.sql (SQL plano) · csv/ ($N tablas) · FILAS.csv · SHA256SUMS"
  echo "cifrado   : AES-256-CBC, PBKDF2-SHA256 $ITERACIONES iteraciones (openssl enc), clave RESPALDO_CLAVE"
} > "$CARPETA/MANIFIESTO.txt"

SALIDA="$DESTINO_DIR/lims_idic-$FECHA.tar.gz.enc"
log "3/3 · Empaquetando y cifrando..."
tar -czf - -C "$TRABAJO" "lims_idic-$FECHA" \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter "$ITERACIONES" -md sha256 -pass env:RESPALDO_CLAVE -out "$SALIDA" \
  || { rm -f "$SALIDA"; fatal "Falló el cifrado."; }
chmod 600 "$SALIDA"
sha256sum "$SALIDA" > "$SALIDA.sha256"

# Verificación: se descifra y se comprueban los SHA-256 internos antes de dar la copia por buena.
"$0" --verificar "$SALIDA" >/dev/null || { rm -f "$SALIDA" "$SALIDA.sha256"; fatal "La exportación no supera la verificación."; }

# --- Rotación -----------------------------------------------------------------
SOBRAN="$(find "$DESTINO_DIR" -maxdepth 1 -name 'lims_idic-*.tar.gz.enc' | sort | head -n "-$RETENCION")"
for f in $SOBRAN; do rm -f "$f" "$f.sha256"; done
printf 'estado=OK\nfecha=%s\nruta=%s\ntablas=%s\n' "$(date -Is)" "$SALIDA" "$N" > "$DESTINO_DIR/.ultimo-estado"

log "═══ EXPORTACIÓN CORRECTA Y VERIFICADA · $(du -h "$SALIDA" | cut -f1) · $SALIDA"
