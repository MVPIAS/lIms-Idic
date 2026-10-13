#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Comprueba que ORDEN_SQL.txt y packages/db/*.sql coinciden · Aiuken
# =============================================================================
# Falla (exit 1) si hay un .sql en packages/db que no figura en el manifiesto
# —el caso que dejó al instalador on-premise aplicando 20 de 42 ficheros— o si
# el manifiesto nombra un fichero que no existe o lo repite.
# Se ejecuta en la CI y antes de empaquetar el kit (exportar-imagenes.sh).
# =============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$AQUI/../packages/db"
ORDEN_SQL="${ORDEN_SQL:-$DB_DIR/ORDEN_SQL.txt}"

LISTADOS="$(tr -d '\r' < "$ORDEN_SQL" | awk '$1 != "" && $1 !~ /^#/ {print $1}')"
FALLOS=0

REPETIDOS="$(printf '%s\n' "$LISTADOS" | sort | uniq -d)"
if [ -n "$REPETIDOS" ]; then
  echo "✗ Repetidos en ORDEN_SQL.txt:"; printf '    %s\n' $REPETIDOS; FALLOS=1
fi

for f in $LISTADOS; do
  [ -f "$DB_DIR/$f" ] || { echo "✗ ORDEN_SQL.txt nombra $f, que no existe en packages/db"; FALLOS=1; }
done

for ruta in "$DB_DIR"/*.sql; do
  f="$(basename "$ruta")"
  printf '%s\n' "$LISTADOS" | grep -qxF "$f" \
    || { echo "✗ packages/db/$f no está en ORDEN_SQL.txt: ningún despliegue lo aplicaría"; FALLOS=1; }
done

[ "$FALLOS" -eq 0 ] || exit 1
echo "✓ ORDEN_SQL.txt al día: $(printf '%s\n' "$LISTADOS" | wc -l | tr -d ' ') ficheros (demo: $("$AQUI/orden-sql.sh" demo | wc -l | tr -d ' ') · sin-demo: $("$AQUI/orden-sql.sh" sin-demo | wc -l | tr -d ' '))"
