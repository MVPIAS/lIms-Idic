#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Usuario de SOLO LECTURA para Metabase (contrato §4.7.5) · Aiuken
# =============================================================================
# align_brechas_6.sql crea el rol `lims_lectura` SIN contraseña y sin poder
# ingresar, con SELECT sobre las tablas del LIMS salvo los secretos (contraseñas,
# segundo factor, clave del correo). Este script le da la contraseña que está en
# la variable METABASE_LECTURA_PASSWORD del .env y lo habilita para ingresar.
# La contraseña NO se escribe en el repositorio, ni en la línea de órdenes (no
# aparece en `ps`): viaja por variable de entorno hasta psql (\getenv).
#
# Uso (en el servidor, carpeta del LIMS):
#   bash scripts/metabase/crear-usuario-lectura.sh                 # preproducción (docker-compose.prod.yml)
#   COMPOSE_FILE=docker-compose.onpremise.yml bash scripts/metabase/crear-usuario-lectura.sh
# Para cambiar la contraseña: edite el .env y vuelva a ejecutarlo.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$APP_DIR"
[ -f .env ] || { echo "ERROR: no se encuentra $APP_DIR/.env"; exit 1; }
set -a; . ./.env; set +a
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [ -z "${METABASE_LECTURA_PASSWORD:-}" ]; then
  echo "ERROR: falta METABASE_LECTURA_PASSWORD en el .env."
  echo "       Genérela con:  echo \"METABASE_LECTURA_PASSWORD=\$(openssl rand -hex 24)\" >> .env"
  exit 1
fi
case "$METABASE_LECTURA_PASSWORD" in CAMBIAR*) echo "ERROR: METABASE_LECTURA_PASSWORD sigue con el valor de ejemplo del .env.example."; exit 1 ;; esac
[ "${#METABASE_LECTURA_PASSWORD}" -ge 16 ] || { echo "ERROR: METABASE_LECTURA_PASSWORD debe tener al menos 16 caracteres."; exit 1; }

export LECTURA_PWD="$METABASE_LECTURA_PASSWORD"
docker compose -f "$COMPOSE_FILE" --env-file .env exec -T -e LECTURA_PWD postgres \
  psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - <<'SQL'
\getenv pwd LECTURA_PWD
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lims_lectura') THEN
    RAISE EXCEPTION 'Falta el rol lims_lectura: aplique antes packages/db/align_brechas_6.sql';
  END IF;
END $$;
ALTER ROLE lims_lectura WITH LOGIN PASSWORD :'pwd';
SQL

echo ">> Usuario lims_lectura habilitado (solo lectura) en la base ${POSTGRES_DB}."
echo ">> Siguiente paso: python3 scripts/metabase/configurar-metabase.py  (da de alta la base y los tableros en Metabase)"
