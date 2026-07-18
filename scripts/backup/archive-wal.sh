#!/bin/sh
# =============================================================================
# LIMS IDIC · Archivado continuo de WAL · Ejercito de Chile · Aiuken
# =============================================================================
# Lo INVOCA PostgreSQL, no un operador. Es el `archive_command` configurado en
# docker-compose.onpremise.yml. PostgreSQL lo llama UNA VEZ POR CADA SEGMENTO
# WAL completado (16 MB) o cada `archive_timeout` segundos.
#
#   archive_command = '/bin/sh /usr/local/bin/archive-wal.sh "%p" "%f" /walarchive'
#     %p  ruta del segmento WAL dentro de PGDATA (origen)
#     %f  nombre del segmento (p.ej. 000000010000000000000007)
#     3er arg (opcional): directorio de archivo. Por defecto /walarchive.
#
# CONTRATO DE PostgreSQL (crítico, de ahí el cuidado de este script):
#   · Debe devolver 0 SOLO si el segmento quedó archivado de forma DURADERA.
#   · Si devuelve !=0, PostgreSQL REINTENTA el mismo segmento y NO lo recicla:
#     el WAL se acumula en pg_wal y, si el fallo persiste, LLENA EL DISCO y
#     detiene la base. Por eso jamás debe devolver 0 sin haber escrito el fichero.
#   · No debe SOBRESCRIBIR un archivo ya existente con contenido distinto
#     (indicaría corrupción del histórico). Sí puede considerar OK un reintento
#     de un segmento ya archivado (idempotencia).
#
# Se ejecuta como el usuario `postgres` (uid 70 en la imagen alpine) dentro del
# contenedor, sobre /bin/sh (busybox de postgres:16-alpine): NADA de bashismos.
#
# El destino /walarchive es un montaje propio sobre ${LIMS_BACKUP_DIR}/wal (disco
# de respaldo, ideal en una unidad DISTINTA a los datos), cedido al usuario
# `postgres` porque el archivador NO corre como root. Así el WAL archivado entra
# automaticamente en la copia externa del IDIC junto con los basebackups.
#
# Compresion gzip: un segmento forzado por archive_timeout en horas de poca
# actividad esta casi vacio y comprime a unos pocos KB; sin comprimir ocuparia
# los 16 MB completos. Es la diferencia entre ~5 GB/dia y unos MB/dia en reposo.
# =============================================================================
set -u

ORIGEN="${1:?archive-wal.sh: falta %p (ruta del segmento)}"
NOMBRE="${2:?archive-wal.sh: falta %f (nombre del segmento)}"

# Directorio de archivo: 3er argumento (lo pasa archive_command), o la variable
# WAL_ARCHIVE_DIR, o /walarchive por defecto (el montaje del compose).
ARCHIVO_DIR="${3:-${WAL_ARCHIVE_DIR:-/walarchive}}"

DEST="$ARCHIVO_DIR/$NOMBRE.gz"
# Temporal en el MISMO sistema de ficheros que el destino: el mv final es
# atomico y evita que PostgreSQL o pg_archivecleanup vean un .gz a medio escribir.
TMP="$ARCHIVO_DIR/.$NOMBRE.$$.tmp"

# El directorio debe existir. Lo crea el instalador y basebackup.sh, pero si
# faltara (p.ej. NAS no montado) hay que FALLAR, no crear un archivo huerfano
# en una ruta equivocada que despues no entre en la copia.
[ -d "$ARCHIVO_DIR" ] || {
  echo "archive-wal.sh: no existe el directorio de archivo $ARCHIVO_DIR" >&2
  exit 1
}

# Idempotencia: si el segmento ya esta archivado, damoslo por bueno. Los nombres
# de segmento WAL son unicos y monotonos; que exista significa que un intento
# previo lo completo. NO lo reescribimos (podria estar en la copia externa ya).
if [ -f "$DEST" ]; then
  exit 0
fi

# Comprimir a temporal. Si algo falla (disco lleno, permiso), se borra el
# temporal y se devuelve error para que PostgreSQL reintente.
if ! gzip -c "$ORIGEN" > "$TMP" 2>/dev/null; then
  rm -f "$TMP"
  echo "archive-wal.sh: fallo al comprimir $NOMBRE hacia $TMP (disco lleno?)" >&2
  exit 1
fi

# Publicacion atomica.
if ! mv "$TMP" "$DEST"; then
  rm -f "$TMP"
  echo "archive-wal.sh: fallo al mover $TMP a $DEST" >&2
  exit 1
fi

# fsync del directorio (best-effort): garantiza que la entrada del nuevo fichero
# llega a disco. Si `sync` no esta, no es fatal: el mv ya publico el dato.
sync 2>/dev/null || true

exit 0
