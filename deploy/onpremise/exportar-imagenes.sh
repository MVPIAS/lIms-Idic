#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Exportación de imágenes para sitio AISLADO · Aiuken
# =============================================================================
# SE EJECUTA EN UNA MÁQUINA CON INTERNET (portátil del ingeniero, runner de CI).
# NO se ejecuta en el servidor del IDIC: allí no hay red.
#
# Qué hace:
#   1. Construye las imágenes propias (api, web) desde el monorepo.
#   2. Descarga las imágenes de terceros FIJADAS POR DIGEST (reproducibilidad).
#   3. Las exporta a .tar comprimidos y calcula el SHA-256 de cada artefacto.
#   4. Copia el código necesario (SQL, compose, scripts) y la configuración.
#   5. Deja un kit completo listo para llevar en medio físico (USB cifrado).
#
# Uso (desde deploy/onpremise, dentro del propio monorepo):
#   ./exportar-imagenes.sh --version 1.0.0
#   ./exportar-imagenes.sh --version 1.0.0 --con-monitorizacion
#   ./exportar-imagenes.sh --version 1.0.0 --repo /otra/copia/del/monorepo
#
# Resultado:  ./salida/kit-lims-idic-<version>/  + kit-lims-idic-<version>.tar.gz
# =============================================================================
set -euo pipefail

# --- Digests de las imágenes de terceros -------------------------------------
# Fijados por DIGEST, no por etiqueta. Corresponden EXACTAMENTE a las imágenes
# verificadas y en verde en preproducción a fecha 2026-07-17.
# Una etiqueta como ":latest" o incluso ":16-alpine" se mueve; el digest no.
# Al actualizar, revalidar primero en preproducción y anotar el digest nuevo.
CADDY_REF="caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
POSTGRES_REF="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
REDIS_REF="redis:7-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99"
MINIO_REF="minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
METABASE_REF="metabase/metabase@sha256:8dddca0f6d77ffb647b080b00fb50348ed62b222c63a9a45d6c12812815db6b3"

# Etiqueta local estable con la que el compose referencia cada imagen.
CADDY_TAG="caddy:2-alpine"
POSTGRES_TAG="postgres:16-alpine"
REDIS_TAG="redis:7-alpine"
MINIO_TAG="minio/minio:lims-idic"        # upstream solo publica :latest (móvil)
METABASE_TAG="metabase/metabase:lims-idic"

# Monitorización opcional (nivel 2, ver GUIA_ONPREMISE.md §8)
PROM_REF="prom/prometheus:v2.53.0"
NODEEXP_REF="prom/node-exporter:v1.8.1"
CADVISOR_REF="gcr.io/cadvisor/cadvisor:v0.49.1"
GRAFANA_REF="grafana/grafana-oss:11.1.0"
ALERTMGR_REF="prom/alertmanager:v0.27.0"

REPO_DIR=""
VERSION=""
CON_MONITOR="no"
PLATAFORMA="${PLATAFORMA:-linux/amd64}"   # el servidor del IDIC es x86_64
KIT_DIR=""

log()   { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m ⚠\033[0m %s\n' "$*" >&2; }
fatal() { printf '\033[1;31m ✗ ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Argumentos ---------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)               REPO_DIR="${2:-}"; shift 2 ;;
    --version)            VERSION="${2:-}"; shift 2 ;;
    --con-monitorizacion) CON_MONITOR="si"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) fatal "Argumento desconocido: $1" ;;
  esac
done

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "$VERSION" ]  || fatal "Falta --version (ej: --version 1.0.0)"
# El kit vive en deploy/onpremise del monorepo: por defecto, el repo es su raíz.
[ -n "$REPO_DIR" ] || REPO_DIR="$AQUI/../.."
[ -d "$REPO_DIR" ] || fatal "No existe el repositorio: $REPO_DIR"
REPO_DIR="$(cd "$REPO_DIR" && pwd)"
[ -f "$REPO_DIR/pnpm-workspace.yaml" ] || fatal "$REPO_DIR no parece el monorepo lims-idic"

# Ningún .sql puede quedar fuera del manifiesto: lo que no figura en
# packages/db/ORDEN_SQL.txt no se aplica en el servidor del IDIC.
bash "$REPO_DIR/scripts/verificar-orden-sql.sh" || fatal "ORDEN_SQL.txt no está al día. Corríjalo antes de empaquetar."

# Trazabilidad: qué commit exacto viaja en el USB.
GIT_COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo desconocido)"
if [ -n "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ]; then
  warn "El repositorio tiene cambios SIN CONFIRMAR: el kit no será reproducible desde git."
  GIT_COMMIT="$GIT_COMMIT+cambios-locales"
fi
KIT_DIR="$AQUI/salida/kit-lims-idic-$VERSION"

# --- 0. Prerequisitos ---------------------------------------------------------
log "0/6 · Verificando prerequisitos de la máquina de empaquetado..."
command -v docker >/dev/null || fatal "docker no está instalado"
docker info >/dev/null 2>&1  || fatal "el demonio Docker no responde"
# Esta máquina SÍ necesita Internet: es la única fase que lo requiere.
docker pull hello-world >/dev/null 2>&1 || fatal "sin acceso al registro Docker. Este script requiere Internet."
command -v sha256sum >/dev/null || fatal "falta sha256sum (coreutils)"
ok "docker $(docker --version | awk '{print $3}' | tr -d ,) y acceso a registro"

rm -rf "$KIT_DIR"
mkdir -p "$KIT_DIR"/{imagenes,codigo,conf}

# --- 1. Construir imágenes propias -------------------------------------------
log "1/6 · Construyendo imágenes propias (api, web) para $PLATAFORMA..."
# --pull: partir de las imágenes base más recientes en el momento del release.
# La reproducibilidad del artefacto la da el .tar + su SHA-256, no el build.
docker build --pull --platform "$PLATAFORMA" \
  -f "$REPO_DIR/apps/api/Dockerfile" -t "lims-idic/api:$VERSION" "$REPO_DIR"
ok "lims-idic/api:$VERSION"
# IDLE_MINUTES (opcional): minutos de inactividad hasta el cierre de sesión.
# Se incrusta al compilar la web; no se puede cambiar después en el servidor.
#   IDLE_MINUTES=15 ./exportar-imagenes.sh --version 1.0.0
docker build --pull --platform "$PLATAFORMA" \
  --build-arg NEXT_PUBLIC_IDLE_MINUTES="${IDLE_MINUTES:-}" \
  -f "$REPO_DIR/apps/web/Dockerfile" -t "lims-idic/web:$VERSION" "$REPO_DIR"
ok "lims-idic/web:$VERSION"

# --- 2. Descargar imágenes de terceros por digest -----------------------------
log "2/6 · Descargando imágenes de terceros (fijadas por digest)..."
descargar_y_etiquetar() {
  local ref="$1" tag="$2"
  docker pull --platform "$PLATAFORMA" "$ref" >/dev/null
  docker tag "$ref" "$tag"
  ok "$tag  <-  ${ref#*@}"
}
descargar_y_etiquetar "$CADDY_REF"    "$CADDY_TAG"
descargar_y_etiquetar "$POSTGRES_REF" "$POSTGRES_TAG"
descargar_y_etiquetar "$REDIS_REF"    "$REDIS_TAG"
descargar_y_etiquetar "$MINIO_REF"    "$MINIO_TAG"
descargar_y_etiquetar "$METABASE_REF" "$METABASE_TAG"

IMAGENES=("lims-idic/api:$VERSION" "lims-idic/web:$VERSION"
          "$CADDY_TAG" "$POSTGRES_TAG" "$REDIS_TAG" "$MINIO_TAG" "$METABASE_TAG")

if [ "$CON_MONITOR" = "si" ]; then
  log "    · incluyendo monitorización de nivel 2 (Prometheus/Grafana)..."
  for ref in "$PROM_REF" "$NODEEXP_REF" "$CADVISOR_REF" "$GRAFANA_REF" "$ALERTMGR_REF"; do
    docker pull --platform "$PLATAFORMA" "$ref" >/dev/null
    ok "$ref"
    IMAGENES+=("$ref")
  done
fi

# --- 3. Exportar a .tar + checksums ------------------------------------------
log "3/6 · Exportando imágenes a .tar.gz y calculando SHA-256..."
MANIFIESTO="$KIT_DIR/MANIFIESTO.txt"
{
  echo "==============================================================="
  echo " LIMS IDIC · Kit de despliegue on-premise · Aiuken"
  echo "==============================================================="
  echo " Versión del producto : $VERSION"
  echo " Commit del código    : $GIT_COMMIT"
  echo " Empaquetado el       : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo " Plataforma destino   : $PLATAFORMA"
  echo " Empaquetado por      : $(whoami)@$(hostname)"
  echo " Monitorización N2    : $CON_MONITOR"
  echo
  echo "--- Imágenes y su procedencia (digest de origen) ---------------"
  printf ' %-34s %s\n' "$CADDY_TAG"    "$CADDY_REF"
  printf ' %-34s %s\n' "$POSTGRES_TAG" "$POSTGRES_REF"
  printf ' %-34s %s\n' "$REDIS_TAG"    "$REDIS_REF"
  printf ' %-34s %s\n' "$MINIO_TAG"    "$MINIO_REF"
  printf ' %-34s %s\n' "$METABASE_TAG" "$METABASE_REF"
  printf ' %-34s %s\n' "lims-idic/api:$VERSION"  "construida desde el monorepo"
  printf ' %-34s %s\n' "lims-idic/web:$VERSION"  "construida desde el monorepo"
  echo
} > "$MANIFIESTO"

for img in "${IMAGENES[@]}"; do
  # nombre de fichero seguro: minio/minio:lims-idic -> minio_minio__lims-idic.tar.gz
  archivo="$(echo "$img" | tr '/:' '__').tar.gz"
  printf '    exportando %-40s -> %s\n' "$img" "$archivo"
  # gzip -1: el cuello de botella es el USB, no la CPU; -9 tarda 5x más para
  # ahorrar ~3%. docker load descomprime el gzip de forma transparente.
  docker save "$img" | gzip -1 > "$KIT_DIR/imagenes/$archivo"
done

log "    · calculando checksums..."
( cd "$KIT_DIR/imagenes" && sha256sum ./*.tar.gz > SHA256SUMS )
ok "$(wc -l < "$KIT_DIR/imagenes/SHA256SUMS") artefactos, $(du -sh "$KIT_DIR/imagenes" | cut -f1) en total"

{
  echo "--- Artefactos y checksum SHA-256 ------------------------------"
  sed 's|\./||' "$KIT_DIR/imagenes/SHA256SUMS"
  echo
  echo "Verificación en destino:  cd imagenes && sha256sum -c SHA256SUMS"
} >> "$MANIFIESTO"

# --- 4. Copiar código y configuración ----------------------------------------
log "4/6 · Copiando código, SQL y configuración al kit..."
# Solo lo que el servidor aislado necesita en tiempo de ejecución. NO se copian
# node_modules, .git ni fuentes: las imágenes ya vienen construidas.
mkdir -p "$KIT_DIR/codigo/packages/db" "$KIT_DIR/codigo/scripts"
cp "$REPO_DIR/docker-compose.onpremise.yml" "$KIT_DIR/codigo/"
cp -r "$REPO_DIR/scripts/backup"            "$KIT_DIR/codigo/scripts/"
# Todos los .sql de schema/seeds/align + el manifiesto con el orden de
# aplicación (ORDEN_SQL.txt) y el script que lo interpreta.
cp "$REPO_DIR"/packages/db/*.sql            "$KIT_DIR/codigo/packages/db/"
cp "$REPO_DIR/packages/db/ORDEN_SQL.txt"    "$KIT_DIR/codigo/packages/db/"
cp "$REPO_DIR/scripts/orden-sql.sh"         "$KIT_DIR/codigo/scripts/"
ok "$(ls -1 "$KIT_DIR"/codigo/packages/db/*.sql | wc -l) ficheros SQL + ORDEN_SQL.txt"

cp "$AQUI/conf/Caddyfile.onpremise"   "$KIT_DIR/conf/"
cp "$AQUI/conf/env.onpremise.example" "$KIT_DIR/conf/"
cp -r "$AQUI/monitorizacion"          "$KIT_DIR/conf/"
cp -r "$AQUI/systemd"                 "$KIT_DIR/conf/"
cp "$AQUI/instalar-onpremise.sh"      "$KIT_DIR/"
cp "$AQUI/GUIA_ONPREMISE.md"          "$KIT_DIR/"
cp "$AQUI/PITR.md"                    "$KIT_DIR/"
chmod +x "$KIT_DIR/instalar-onpremise.sh" "$KIT_DIR"/codigo/scripts/backup/*.sh \
         "$KIT_DIR"/conf/monitorizacion/*.sh 2>/dev/null || true
ok "configuración, guía e instalador"

# --- 5. Checksum global del kit ----------------------------------------------
log "5/6 · Sellando el kit completo..."
( cd "$KIT_DIR" && find . -type f ! -name 'MANIFIESTO.sha256' -print0 \
    | sort -z | xargs -0 sha256sum > MANIFIESTO.sha256 )
ok "MANIFIESTO.sha256 ($(wc -l < "$KIT_DIR/MANIFIESTO.sha256") ficheros)"

# --- 6. Empaquetado final -----------------------------------------------------
log "6/6 · Empaquetando para el medio físico..."
( cd "$AQUI/salida" && tar -czf "kit-lims-idic-$VERSION.tar.gz" "kit-lims-idic-$VERSION" )
KIT_TGZ="$AQUI/salida/kit-lims-idic-$VERSION.tar.gz"
sha256sum "$KIT_TGZ" | sed "s|$AQUI/salida/||" > "$KIT_TGZ.sha256"

echo
ok "KIT LISTO"
echo "   Directorio : $KIT_DIR"
echo "   Paquete    : $KIT_TGZ  ($(du -sh "$KIT_TGZ" | cut -f1))"
echo "   SHA-256    : $(cut -d' ' -f1 < "$KIT_TGZ.sha256")"
echo
cat <<TXT
   SIGUIENTES PASOS
   1. Copie el paquete y su .sha256 a un USB CIFRADO (LUKS o similar).
      El kit incluye el código y el esquema del LIMS del Ejército: trátelo
      como material clasificado y regístrelo en el libro de soportes.
   2. En el servidor del IDIC:
        sha256sum -c kit-lims-idic-$VERSION.tar.gz.sha256   # DEBE decir OK
        tar -xzf kit-lims-idic-$VERSION.tar.gz
        cd kit-lims-idic-$VERSION && sudo ./instalar-onpremise.sh
   3. Consulte GUIA_ONPREMISE.md para certificados, verificación y respaldos.
TXT
