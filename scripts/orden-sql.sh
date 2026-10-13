#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Lista ordenada de los .sql a aplicar · Aiuken
# =============================================================================
# Lee packages/db/ORDEN_SQL.txt (fuente única del orden) y escribe, uno por
# línea, los ficheros que corresponden al modo pedido:
#
#   scripts/orden-sql.sh demo       # preproducción: todo + seeds de ejemplo
#   scripts/orden-sql.sh sin-demo   # producción: sin datos inventados
#
# La ruta del manifiesto se puede cambiar con ORDEN_SQL (lo usa el instalador
# on-premise, donde el código vive en /opt/lims-idic).
# =============================================================================
set -euo pipefail

MODO="${1:-}"
case "$MODO" in
  demo|sin-demo) : ;;
  *) echo "Uso: $0 demo|sin-demo" >&2; exit 2 ;;
esac

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORDEN_SQL="${ORDEN_SQL:-$AQUI/../packages/db/ORDEN_SQL.txt}"
[ -r "$ORDEN_SQL" ] || { echo "No se puede leer $ORDEN_SQL" >&2; exit 1; }

# tr -d '\r': el manifiesto puede llegar con finales de línea de Windows.
tr -d '\r' < "$ORDEN_SQL" | while read -r fichero etiqueta _; do
  case "$fichero" in ''|\#*) continue ;; esac
  case "${etiqueta:-}" in
    '')       echo "$fichero" ;;
    demo)     [ "$MODO" = "demo" ]     && echo "$fichero" || true ;;
    sin-demo) [ "$MODO" = "sin-demo" ] && echo "$fichero" || true ;;
    *) echo "Etiqueta desconocida '$etiqueta' en $fichero ($ORDEN_SQL)" >&2; exit 1 ;;
  esac
done
