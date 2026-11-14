#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Ajustes POST-RESTAURACIÓN de la base · Ejército de Chile · Aiuken
# =============================================================================
# Un volcado restaurado con `pg_restore --no-owner --no-privileges` (restore.sh,
# o a mano) NO trae dos cosas que viven fuera de las tablas:
#   · la zona horaria por defecto de la base (ALTER DATABASE … SET timezone),
#   · los permisos del usuario de solo lectura del BI (`lims_lectura`).
# Este paso las vuelve a dejar como las deja el instalador, reaplicando los SQL
# de ajuste de la lista SQL_AJUSTE (todos idempotentes: una pasada deja lo mismo
# que dos). Si un SQL nuevo deja estado fuera de las tablas, se añade AQUÍ.
#
# Uso:
#   ./post-restauracion.sh <base>          # p. ej. lims_idic o la base temporal del simulacro
#   ./post-restauracion.sh --listar        # muestra qué SQL aplica
#
# restore.sh lo ejecuta solo al terminar. Úselo a mano si restaura de otra forma.
# =============================================================================
set -euo pipefail

# SQL de ajuste que se reaplican tras restaurar, en este orden. Mismo orden
# relativo que en packages/db/ORDEN_SQL.txt.
SQL_AJUSTE=(
  align_zona_horaria.sql   # zona horaria por defecto de la base (America/Santiago)
  align_brechas_6.sql      # vistas bi_* y permisos de lims_lectura (BI de solo lectura)
)

APP_DIR="${APP_DIR:-/opt/lims-idic}"
SQL_DIR="${SQL_DIR:-$APP_DIR/packages/db}"

if [ "${1:-}" = "--listar" ]; then
  printf '%s\n' "${SQL_AJUSTE[@]}"
  exit 0
fi
case "${1:-}" in -h|--help|"") sed -n '2,18p' "$0"; exit 0 ;; esac

BD="$1"
case "$BD" in *[!a-zA-Z0-9_]*) echo "ERROR: nombre de base no válido: $BD" >&2; exit 1 ;; esac

[ -f "$APP_DIR/.env" ] || { echo "ERROR: no se encuentra $APP_DIR/.env" >&2; exit 1; }
set -a; . "$APP_DIR/.env"; set +a
COMPOSE="${COMPOSE:-docker compose -f $APP_DIR/docker-compose.onpremise.yml --env-file $APP_DIR/.env}"

ok()   { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ⚠\033[0m %s\n' "$*" >&2; }

FALLOS=0
for f in "${SQL_AJUSTE[@]}"; do
  if [ ! -f "$SQL_DIR/$f" ]; then
    warn "Falta $SQL_DIR/$f: no se pudo reaplicar."; FALLOS=$((FALLOS+1)); continue
  fi
  if $COMPOSE exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$BD" -f - \
       < "$SQL_DIR/$f" >/dev/null 2>"${TMPDIR:-/tmp}/post-restauracion.$$.err"; then
    ok "Reaplicado $f en '$BD'"
  else
    warn "Falló $f en '$BD':"
    sed 's/^/        /' "${TMPDIR:-/tmp}/post-restauracion.$$.err" | head -5 >&2
    FALLOS=$((FALLOS+1))
  fi
  rm -f "${TMPDIR:-/tmp}/post-restauracion.$$.err"
done

if [ "$FALLOS" -gt 0 ]; then
  warn "$FALLOS ajuste(s) post-restauración sin aplicar en '$BD'. Los datos están restaurados,
   pero la zona horaria o el acceso del BI pueden no ser los correctos. Corrija la causa y
   repita:  $0 $BD"
  exit 1
fi
