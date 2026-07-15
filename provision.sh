#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Provisión de servidor (Ubuntu 22.04 / 24.04) · Aiuken
# Sirve para staging cloud (Hetzner CX22) y para producción on-premise.
# Uso:
#   Modo A (git):   REPO_URL=git@github.com:TU_ORG/lims-idic.git bash provision.sh
#   Modo B (copia): copiar el repo a /opt/lims-idic con scp, luego: bash provision.sh
# Ejecutar como root en un servidor limpio.
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-}"          # vacío = el código ya está en APP_DIR (modo copia/scp)
APP_DIR="${APP_DIR:-/opt/lims-idic}"

echo ">> 1/7 · Actualizando sistema e instalando utilidades..."
apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw

echo ">> 2/7 · Instalando Docker + Compose..."
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
docker --version && docker compose version

echo ">> 3/7 · Firewall (22/80/443)..."
ufw allow OpenSSH || true; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable

echo ">> 4/7 · Swap de 4G (ayuda a los builds en servidores pequeños)..."
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo ">> 5/7 · Obteniendo el código en ${APP_DIR}..."
if [ -n "${REPO_URL}" ]; then
  if [ ! -d "${APP_DIR}/.git" ]; then git clone "${REPO_URL}" "${APP_DIR}"; else git -C "${APP_DIR}" pull --ff-only; fi
else
  [ -d "${APP_DIR}" ] || { echo "ERROR: ${APP_DIR} no existe. Copie el repo con scp o defina REPO_URL."; exit 1; }
  echo "   (modo copia: usando el código ya presente en ${APP_DIR})"
fi
cd "${APP_DIR}"

echo ">> 6/7 · Preparando .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo ">> ⚠️  Edita ${APP_DIR}/.env (DOMAIN, contraseñas, JWT) y vuelve a ejecutar: bash provision.sh"
  exit 0
fi

echo ">> 7/7 · Build + arranque del stack (caddy, web, api, postgres, redis, minio, metabase)..."
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

echo ">> Esperando a PostgreSQL y aplicando schema + seeds..."
set -a; source .env; set +a
until docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do sleep 3; done
for f in \
  packages/db/schema.sql \
  packages/db/seed_rbac.sql \
  packages/db/seed_gran_grupo_grupo.sql \
  packages/db/seed_plantillas.sql \
  packages/db/seed_catalogos_metodos.sql \
  packages/db/seed_flujos.sql \
  packages/db/seed_preprod_demo.sql \
  packages/db/align_schema_to_prisma.sql \
  packages/db/seed_analitos_limites.sql \
  packages/db/crm_oportunidad.sql \
  packages/db/seed_operacion_demo.sql \
  packages/db/align_orden_compra.sql \
  packages/db/align_final.sql \
  packages/db/align_resultado_estado.sql \
  packages/db/align_certificado.sql \
  packages/db/equipos_custodia.sql \
  packages/db/saec.sql; do
  if [ -f "$f" ]; then
    echo "   aplicando $f"
    docker compose -f docker-compose.prod.yml exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < "$f" || echo "   (aviso: $f ya aplicado o con avisos)"
  fi
done

echo ">> Creando usuario administrador (si no existe)..."
docker compose -f docker-compose.prod.yml exec -T api node dist/cli/crear-admin.js --usuario admin --rol SUPERADMIN --nombre "Administrador Aiuken" || echo "   (crea el admin manualmente si la API aún no está lista)"

echo ""
echo ">> LISTO. Verifica: https://${DOMAIN}   ·  API en /api  ·  BI en bi.${DOMAIN}"
echo ">> Estado:  docker compose -f docker-compose.prod.yml ps"
