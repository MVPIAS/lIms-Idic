#!/usr/bin/env bash
# =============================================================================
# LIMS IDIC · Respaldo programado en contenedor (contrato §4.8.4) · Aiuken
# =============================================================================
# Lo ejecuta el servicio «respaldo» de docker-compose.prod.yml (imagen
# postgres:16-alpine: trae pg_dump, pg_restore y psql de la misma versión que la
# base). Es la versión «en contenedor» de backup.sh (on-premise, systemd) y
# reutiliza sus reglas: pg_dump -Fc -Z6 sin dueños ni privilegios, verificación
# con pg_restore --list (más de 100 objetos), base de Metabase aparte, SHA256SUMS
# y MANIFIESTO, promoción semanal por ENLACE DURO y rotación por niveles.
#
# Cada minuto:
#   1. lee la política de «Parámetros del sistema › Respaldos de la base de
#      datos» (hora, retención, horas de alerta); sin fila, las variables
#      RESPALDO_* del entorno;
#   2. deja un latido en `respaldo_servicio` con lo que está aplicando;
#   3. atiende una solicitud «Respaldar ahora» de la pantalla (fila SOLICITADO);
#   4. si ya pasó la hora de hoy y aún no hay respaldo programado de este turno,
#      lo hace (también al arrancar: si el servidor estuvo apagado a la hora, el
#      respaldo se hace en cuanto vuelve).
# Cada ejecución queda en `respaldo_registro` (fecha, tamaño, duración,
# resultado, mensaje). La API avisa a los administradores si falla.
#
# Uso (dentro del contenedor):
#   respaldo-programado.sh            # servicio: bucle sin fin
#   respaldo-programado.sh --ahora    # un respaldo manual inmediato y termina
#   respaldo-programado.sh --una-vez  # una sola vuelta del bucle y termina
#
# Conexión: variables estándar PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
# =============================================================================
set -uo pipefail
# Los volcados contienen todos los datos del laboratorio: solo los lee root.
umask 077

DIR="${RESPALDO_DIR:-/respaldos}"
ZONA="${ZONA_HORARIA:-America/Santiago}"
INTERVALO="${RESPALDO_INTERVALO_S:-60}"
MIN_OBJETOS="${RESPALDO_MIN_OBJETOS:-100}"
MIN_LIBRE_MB="${RESPALDO_MIN_LIBRE_MB:-1024}"
MB_DB="${METABASE_DB:-lims_metabase}"
SERVIDOR="${RESPALDO_SERVIDOR:-$(hostname)}"
export PGDATABASE="${PGDATABASE:-lims_idic}"

MODO="servicio"
case "${1:-}" in
  --ahora) MODO="ahora" ;;
  --una-vez) MODO="una-vez" ;;
  "") ;;
  -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
  *) echo "Argumento desconocido: $1"; exit 1 ;;
esac

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# psql sin .psqlrc, salida sin adornos y con variables :'x' (vía stdin: con -c
# psql NO sustituye variables). Las cadenas viajan siempre como variables
# citadas por psql, nunca pegadas al SQL.
sql() { psql -X -q -A -t -v ON_ERROR_STOP=1 -v zona="$ZONA" -v srv="$SERVIDOR" "$@" -f -; }

# --- Política -------------------------------------------------------------------
entero_en() { # valor defecto min max
  local v="$1"
  if [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge "$3" ] && [ "$v" -le "$4" ]; then echo "$v"; else echo "$2"; fi
}
param() { # codigo
  sql -v cod="$1" <<'SQL' 2>/dev/null | head -1 | tr -d '[:space:]'
SELECT valor FROM parametro_sistema
 WHERE categoria = 'respaldos' AND codigo = :'cod' AND activo
 ORDER BY created_at LIMIT 1;
SQL
}
cargar_politica() {
  HORA="$(entero_en "$(param hora)" "$(entero_en "${RESPALDO_HORA:-2}" 2 0 23)" 0 23)"
  RET_D="$(entero_en "$(param retencion_diarios)" "$(entero_en "${RESPALDO_RETENCION_DIARIOS:-14}" 14 1 365)" 1 365)"
  RET_S="$(entero_en "$(param retencion_semanales)" "$(entero_en "${RESPALDO_RETENCION_SEMANALES:-8}" 8 0 104)" 0 104)"
}

latido() {
  local libre; libre="$(df -Pm "$DIR" 2>/dev/null | awk 'NR==2{print $4}')"
  sql -v hora="$HORA" -v rd="$RET_D" -v rs="$RET_S" -v dir="$DIR" -v libre="${libre:-0}" <<'SQL' >/dev/null 2>&1 || true
INSERT INTO respaldo_servicio (id, modo, latido_at, detalle)
VALUES (1, 'contenedor', now(), jsonb_build_object(
  'hora', lpad(:'hora', 2, '0') || ':00', 'zona', :'zona',
  'retencion_diarios', :'rd'::int, 'retencion_semanales', :'rs'::int, 'retencion_mensuales', 0,
  'directorio', :'dir', 'libre_mb', :'libre'::bigint, 'servidor', :'srv', 'manual', true))
ON CONFLICT (id) DO UPDATE SET modo = EXCLUDED.modo, latido_at = EXCLUDED.latido_at, detalle = EXCLUDED.detalle;
SQL
}

# --- Turnos ---------------------------------------------------------------------
# ¿Ya pasó la hora de hoy (o la de ayer, si aún no llega la de hoy) sin un
# respaldo programado desde entonces? Se calcula en la base con su base de
# zonas horarias: el horario de verano de Chile no depende del contenedor.
toca_programado() {
  local r
  r="$(sql -v hora="$HORA" <<'SQL' 2>/dev/null
WITH z AS (SELECT now() AT TIME ZONE :'zona' AS local),
turno AS (
  SELECT ((CASE WHEN local::time >= make_time(:hora, 0, 0) THEN local::date ELSE local::date - 1 END)
          + make_time(:hora, 0, 0)) AT TIME ZONE :'zona' AS t
    FROM z)
SELECT CASE WHEN EXISTS (SELECT 1 FROM respaldo_registro, turno
                          WHERE tipo = 'programado' AND solicitado_at >= turno.t) THEN 'no' ELSE 'si' END
  FROM turno;
SQL
)"
  [ "$(echo "$r" | tr -d '[:space:]')" = "si" ]
}

crear_registro() { # tipo
  sql -v tipo="$1" <<'SQL' | head -1 | tr -d '[:space:]'
INSERT INTO respaldo_registro (tipo, resultado, inicio, servidor)
VALUES (:'tipo', 'EN_CURSO', now(), :'srv') RETURNING id;
SQL
}

reclamar_solicitud() {
  sql <<'SQL' 2>/dev/null | head -1 | tr -d '[:space:]'
UPDATE respaldo_registro SET resultado = 'EN_CURSO', inicio = now(), servidor = :'srv'
 WHERE id = (SELECT id FROM respaldo_registro WHERE resultado = 'SOLICITADO'
              ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id;
SQL
}

terminar() { # id resultado mensaje [tamano objetos archivo nivel duracion]
  sql -v id="$1" -v res="$2" -v msg="$3" -v tam="${4:-}" -v obj="${5:-}" -v arch="${6:-}" -v niv="${7:-}" -v dur="${8:-}" <<'SQL' >/dev/null
UPDATE respaldo_registro
   SET resultado = :'res', fin = now(), mensaje = NULLIF(:'msg', ''),
       tamano_bytes = NULLIF(:'tam', '')::bigint, objetos = NULLIF(:'obj', '')::int,
       archivo = NULLIF(:'arch', ''), nivel = NULLIF(:'niv', ''),
       duracion_s = COALESCE(NULLIF(:'dur', '')::int, GREATEST(0, extract(epoch FROM now() - inicio))::int)
 WHERE id = :'id'::bigint;
SQL
}

# --- Un respaldo ------------------------------------------------------------------
ejecutar() { # id tipo
  local id="$1" tipo="$2" t0 fecha isodow dest dump err objetos libre tam nivel
  t0="$(date +%s)"
  # Fecha y día de la semana en hora de Chile (la base lo resuelve, no el contenedor).
  read -r fecha isodow < <(sql <<'SQL'
SELECT to_char(now() AT TIME ZONE :'zona', 'YYYYMMDD-HH24MISS') || ' ' || extract(isodow FROM now() AT TIME ZONE :'zona')::int;
SQL
)
  dest="$DIR/diarios/$fecha"
  dump="lims_idic-$fecha.dump"
  err="$(mktemp)"
  log "═══ Respaldo $tipo n.º $id → $dest"

  fallo() {
    log "ERROR: $1"
    rm -rf "$dest"
    terminar "$id" ERROR "$1" "" "" "" "" "$(( $(date +%s) - t0 ))" || log "No se pudo registrar el fallo en la base."
    rm -f "$err"
    return 1
  }

  mkdir -p "$dest" && chmod 700 "$DIR" "$dest" || { fallo "No se pudo crear la carpeta $dest (¿está montado el volumen de respaldos?)."; return 1; }
  # Un pg_dump que llena el disco puede detener PostgreSQL si comparten disco.
  libre="$(df -Pm "$DIR" | awk 'NR==2{print $4}')"
  [ "${libre:-0}" -gt "$MIN_LIBRE_MB" ] || { fallo "Solo quedan ${libre:-0} MB libres en la carpeta de respaldos (mínimo $MIN_LIBRE_MB MB). Libere espacio o reduzca la retención."; return 1; }

  # 1. Volcado (formato custom: comprimido, restauración selectiva y verificable).
  if ! pg_dump -Fc -Z6 --no-owner --no-privileges -f "$dest/$dump" 2>"$err"; then
    fallo "pg_dump falló: $(tail -c 400 "$err" | tr '\n' ' ')"; return 1
  fi
  [ -s "$dest/$dump" ] || { fallo "pg_dump no generó el archivo $dump."; return 1; }

  # 2. Verificación: un volcado truncado tiene un tamaño convincente pero es ilegible.
  objetos="$(pg_restore --list "$dest/$dump" 2>"$err" | grep -cv '^;' || true)"
  [ "${objetos:-0}" -gt "$MIN_OBJETOS" ] || { fallo "El volcado no supera la verificación: declara ${objetos:-0} objetos (se esperan más de $MIN_OBJETOS). $(tail -c 200 "$err" | tr '\n' ' ')"; return 1; }
  log "  verificado: $objetos objetos"

  # Base de Metabase (tableros y preguntas del BI). Si no existe, se omite.
  if [ "$(psql -X -At -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$(printf %s "$MB_DB" | tr -cd 'A-Za-z0-9_')'" 2>/dev/null)" = "1" ]; then
    pg_dump -Fc -Z6 --no-owner --no-privileges -d "$MB_DB" -f "$dest/metabase-$fecha.dump" 2>/dev/null \
      || log "  AVISO: no se pudo volcar la base de Metabase ($MB_DB); el respaldo del LIMS sigue siendo válido."
  fi

  # 3. Sellado.
  ( cd "$dest" && sha256sum ./*.dump > SHA256SUMS )
  {
    echo "LIMS IDIC · respaldo de la base de datos"
    echo "fecha       : $fecha (hora de Chile)"
    echo "tipo        : $tipo"
    echo "registro    : $id"
    echo "servidor    : $SERVIDOR"
    echo "base_datos  : $PGDATABASE"
    echo "verificada  : si (pg_restore --list, $objetos objetos)"
  } > "$dest/MANIFIESTO.txt"

  # 4. Promoción semanal (domingo) por enlace duro: no ocupa espacio extra.
  nivel="diario"
  if [ "$tipo" = "programado" ] && [ "$isodow" = "7" ] && [ "$RET_S" -gt 0 ]; then
    mkdir -p "$DIR/semanales/$fecha" && chmod 700 "$DIR/semanales" "$DIR/semanales/$fecha"
    for f in "$dest"/*; do ln "$f" "$DIR/semanales/$fecha/" 2>/dev/null || cp "$f" "$DIR/semanales/$fecha/"; done
    nivel="diario+semanal"
    log "  promovido a semanal"
  fi

  tam="$(stat -c %s "$dest"/* | awk '{s+=$1} END {print s+0}')"
  terminar "$id" OK "Respaldo correcto y verificado ($objetos objetos)." "$tam" "$objetos" "$dump" "$nivel" "$(( $(date +%s) - t0 ))" \
    || log "AVISO: el respaldo está en disco pero no se pudo registrar en la base."
  rm -f "$err"
  log "═══ Correcto · $tam bytes · $(( $(date +%s) - t0 )) s"

  rotar diarios "$RET_D"
  rotar semanales "$RET_S"
  marcar_disponibles
  return 0
}

# Conserva los N más recientes de un nivel (nombres AAAAMMDD-HHMMSS: el orden
# alfabético es el cronológico). Un archivo enlazado en otro nivel sigue en disco.
rotar() { # nivel conservar
  local d="$DIR/$1" n=0
  [ -d "$d" ] || return 0
  for x in $(ls -1 "$d" | grep -E '^20[0-9]{6}-[0-9]{6}$' | sort -r | tail -n +"$(( $2 + 1 ))"); do
    rm -rf "${d:?}/$x"; n=$((n + 1))
  done
  [ "$n" -gt 0 ] && log "  rotación $1: se conservan $2, se borraron $n"
  return 0
}

# Marca en el registro los volcados que la rotación ya borró del disco.
marcar_disponibles() {
  local id arch
  sql <<'SQL' 2>/dev/null | while IFS='|' read -r id arch; do
SELECT id || '|' || archivo FROM respaldo_registro WHERE resultado = 'OK' AND disponible AND archivo IS NOT NULL;
SQL
    [ -n "$arch" ] || continue
    # (con pipefail, «find … | grep» fallaría si falta el nivel semanal)
    if [ -z "$(find "$DIR/diarios" "$DIR/semanales" -name "$arch" 2>/dev/null)" ]; then
      sql -v id="$id" <<'SQL' >/dev/null 2>&1 || true
UPDATE respaldo_registro SET disponible = FALSE WHERE id = :'id'::bigint;
SQL
    fi
  done
}

esperar_bd() {
  until pg_isready -q; do log "Esperando a PostgreSQL ($PGHOST)…"; sleep 5; done
  until sql <<'SQL' >/dev/null 2>&1
SELECT 1 FROM respaldo_registro LIMIT 1;
SQL
  do
    log "Falta la tabla respaldo_registro: aplique packages/db/align_brechas_6.sql. Reintento en 60 s."
    sleep 60
  done
}

# --- Principal ------------------------------------------------------------------
mkdir -p "$DIR" && chmod 700 "$DIR"
esperar_bd
cargar_politica

if [ "$MODO" = "ahora" ]; then
  id="$(crear_registro manual)" || { log "No se pudo crear el registro."; exit 1; }
  ejecutar "$id" manual; exit $?
fi

# Un respaldo que quedó EN_CURSO es uno que se cortó (reinicio del contenedor o del servidor).
sql <<'SQL' >/dev/null 2>&1 || true
UPDATE respaldo_registro SET resultado = 'ERROR', fin = now(),
       mensaje = 'El respaldo se interrumpió: el servicio de respaldo se reinició antes de terminar.'
 WHERE resultado = 'EN_CURSO';
SQL
log "Servicio de respaldo en marcha · hora $(printf %02d "$HORA"):00 ($ZONA) · conserva $RET_D diarios y $RET_S semanales · carpeta $DIR"

while true; do
  cargar_politica
  latido
  id="$(reclamar_solicitud)"
  if [ -n "$id" ]; then
    ejecutar "$id" manual || true
  elif toca_programado; then
    id="$(crear_registro programado)" && [ -n "$id" ] && { ejecutar "$id" programado || true; }
  fi
  [ "$MODO" = "una-vez" ] && break
  sleep "$INTERVALO"
done
