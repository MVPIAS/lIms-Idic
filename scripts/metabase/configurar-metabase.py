#!/usr/bin/env python3
# =============================================================================
# LIMS IDIC · Alta de la base del LIMS y tableros iniciales en Metabase · Aiuken
# Contrato §4.7.5 / §4.5.7 / §4.6.5 · guía: docs/RESPALDOS_Y_BI.md §2
# =============================================================================
# Qué hace (idempotente: lo que ya existe con el mismo nombre no se duplica):
#   1. Si Metabase está recién instalado, crea su administrador (asistente
#      inicial) en español y sin telemetría; si no, ingresa con ese administrador.
#   2. Da de alta la base del LIMS «LIMS IDIC (solo lectura)» con el usuario
#      lims_lectura (contraseña METABASE_LECTURA_PASSWORD del .env).
#   3. Crea la colección «LIMS IDIC» con tres tableros sobre las vistas bi_*
#      de align_brechas_6.sql:
#        · Órdenes de trabajo por estado y mes
#        · Plazos de las órdenes de trabajo
#        · Resultados «No cumple» por laboratorio
#
# Uso (en el servidor, carpeta del LIMS; solo biblioteca estándar de Python 3):
#   MB_ADMIN_EMAIL=bi-admin@idic.cl python3 scripts/metabase/configurar-metabase.py
#   (pide la contraseña del administrador de Metabase si no está en MB_ADMIN_PASSWORD)
# Opciones: --url https://bi.<dominio> (por defecto URL_BI o https://bi.$DOMAIN del .env)
#           --env /opt/lims-idic/.env
# Ningún secreto se escribe en el repositorio ni se imprime.
# =============================================================================
import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

NOMBRE_BD = "LIMS IDIC (solo lectura)"
NOMBRE_COLECCION = "LIMS IDIC"

# (tablero, descripción, [(pregunta, visualización, ajustes, SQL)])
TABLEROS = [
    (
        "Órdenes de trabajo por estado y mes",
        "OT recibidas cada mes según su estado actual, y por laboratorio. Fuente: vista bi_ot_estado_mes.",
        [
            ("OT por mes y estado", "bar",
             {"graph.dimensions": ["mes", "estado"], "graph.metrics": ["ot"], "stackable.stack_type": "stacked"},
             "SELECT mes, estado, sum(ot) AS ot FROM bi_ot_estado_mes GROUP BY 1, 2 ORDER BY 1, 2"),
            ("OT por laboratorio y estado", "bar",
             {"graph.dimensions": ["laboratorio", "estado"], "graph.metrics": ["ot"], "stackable.stack_type": "stacked"},
             "SELECT laboratorio, estado, sum(ot) AS ot FROM bi_ot_estado_mes GROUP BY 1, 2 ORDER BY 1, 2"),
        ],
    ),
    (
        "Plazos de las órdenes de trabajo",
        "OT abiertas según su plazo comprometido y cumplimiento del plazo de las cerradas. Fuentes: bi_ot_plazos y bi_ot_cumplimiento_mes.",
        [
            ("OT abiertas por situación de plazo", "pie",
             {"pie.dimension": "situacion", "pie.metric": "ot"},
             "SELECT situacion, count(*) AS ot FROM bi_ot_plazos GROUP BY 1 ORDER BY 2 DESC"),
            ("Cumplimiento del plazo de las OT cerradas por mes", "bar",
             {"graph.dimensions": ["mes"], "graph.metrics": ["en_plazo", "con_atraso"], "stackable.stack_type": "stacked"},
             "SELECT mes, sum(en_plazo) AS en_plazo, sum(con_atraso) AS con_atraso FROM bi_ot_cumplimiento_mes GROUP BY 1 ORDER BY 1"),
            ("OT abiertas vencidas", "table", {},
             "SELECT ot, laboratorio, estado, fecha_compromiso, dias_de_atraso FROM bi_ot_plazos WHERE situacion = 'Vencida' ORDER BY dias_de_atraso DESC"),
        ],
    ),
    (
        "Resultados «No cumple» por laboratorio",
        "Resultados con veredicto No cumple frente al total con veredicto, por laboratorio dueño del ensayo. Fuente: bi_resultado_no_cumple_lab.",
        [
            ("No cumple por laboratorio", "bar",
             {"graph.dimensions": ["laboratorio"], "graph.metrics": ["no_cumple"]},
             "SELECT laboratorio, sum(no_cumple) AS no_cumple, sum(resultados) AS resultados, "
             "round(100.0 * sum(no_cumple) / NULLIF(sum(resultados), 0), 1) AS pct_no_cumple "
             "FROM bi_resultado_no_cumple_lab GROUP BY 1 ORDER BY 2 DESC"),
            ("No cumple por mes y laboratorio", "table", {},
             "SELECT mes, laboratorio, resultados, no_cumple, pct_no_cumple FROM bi_resultado_no_cumple_lab ORDER BY mes DESC, no_cumple DESC"),
        ],
    ),
]


def leer_env(ruta):
    datos = {}
    if not os.path.isfile(ruta):
        return datos
    with open(ruta, encoding="utf-8") as f:
        for linea in f:
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            k, v = linea.split("=", 1)
            datos[k.strip()] = v.strip().strip('"').strip("'")
    return datos


class Metabase:
    def __init__(self, url):
        self.url = url.rstrip("/")
        self.sesion = None

    def llamar(self, metodo, ruta, cuerpo=None):
        datos = None if cuerpo is None else json.dumps(cuerpo).encode("utf-8")
        req = urllib.request.Request(self.url + ruta, data=datos, method=metodo)
        req.add_header("Content-Type", "application/json")
        if self.sesion:
            req.add_header("X-Metabase-Session", self.sesion)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                txt = r.read().decode("utf-8")
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            detalle = e.read().decode("utf-8", "replace")[:400]
            raise RuntimeError(f"{metodo} {ruta} → HTTP {e.code}: {detalle}") from None

    @staticmethod
    def lista(r):
        # Según la versión, los listados vienen como lista o como {"data": [...]}.
        return r.get("data", []) if isinstance(r, dict) else (r or [])


def main():
    ap = argparse.ArgumentParser(description="Alta de la base del LIMS y tableros iniciales en Metabase.")
    ap.add_argument("--env", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))
    ap.add_argument("--url", default=None)
    args = ap.parse_args()

    env = {**leer_env(args.env), **os.environ}
    url = args.url or env.get("URL_BI") or (f"https://bi.{env['DOMAIN']}" if env.get("DOMAIN") else None)
    if not url:
        sys.exit("ERROR: indique --url https://bi.<dominio> (o URL_BI / DOMAIN en el .env).")
    lectura = env.get("METABASE_LECTURA_PASSWORD")
    if not lectura:
        sys.exit("ERROR: falta METABASE_LECTURA_PASSWORD en el .env (y ejecute antes scripts/metabase/crear-usuario-lectura.sh).")
    email = env.get("MB_ADMIN_EMAIL") or input("Correo del administrador de Metabase: ").strip()
    clave = env.get("MB_ADMIN_PASSWORD") or getpass.getpass("Contraseña del administrador de Metabase: ")

    mb = Metabase(url)
    print(f">> Metabase en {url}")
    props = mb.llamar("GET", "/api/session/properties")
    if not props.get("has-user-setup"):
        print(">> Metabase recién instalado: se crea su administrador (asistente inicial).")
        r = mb.llamar("POST", "/api/setup", {
            "token": props.get("setup-token"),
            "user": {"first_name": "Administrador", "last_name": "BI", "email": email, "password": clave, "site_name": "LIMS IDIC"},
            "prefs": {"site_name": "LIMS IDIC · Inteligencia de negocio", "site_locale": "es", "allow_tracking": False},
        })
        mb.sesion = r["id"]
    else:
        mb.sesion = mb.llamar("POST", "/api/session", {"username": email, "password": clave})["id"]

    # 2. Base del LIMS con el usuario de solo lectura.
    bd = next((d for d in mb.lista(mb.llamar("GET", "/api/database")) if d.get("name") == NOMBRE_BD), None)
    if bd:
        print(f">> La base «{NOMBRE_BD}» ya está dada de alta (id {bd['id']}).")
    else:
        bd = mb.llamar("POST", "/api/database", {
            "engine": "postgres",
            "name": NOMBRE_BD,
            "details": {
                "host": env.get("METABASE_LIMS_HOST", "postgres"),
                "port": int(env.get("METABASE_LIMS_PORT", "5432")),
                "dbname": env.get("POSTGRES_DB", "lims_idic"),
                "user": "lims_lectura",
                "password": lectura,
                "ssl": False,
                "tunnel-enabled": False,
            },
            "is_full_sync": True,
        })
        print(f">> Base «{NOMBRE_BD}» dada de alta (id {bd['id']}), usuario lims_lectura.")

    # 3. Colección y tableros.
    col = next((c for c in mb.lista(mb.llamar("GET", "/api/collection")) if c.get("name") == NOMBRE_COLECCION and not c.get("archived")), None)
    if not col:
        try:
            col = mb.llamar("POST", "/api/collection", {"name": NOMBRE_COLECCION, "description": "Tableros del LIMS IDIC (brechas §4.7.5)."})
        except RuntimeError:
            # Versiones antiguas exigen color.
            col = mb.llamar("POST", "/api/collection", {"name": NOMBRE_COLECCION, "color": "#509EE3"})
    items = mb.lista(mb.llamar("GET", f"/api/collection/{col['id']}/items?models=dashboard"))
    existentes = {i.get("name") for i in items}

    for nombre, descripcion, preguntas in TABLEROS:
        if nombre in existentes:
            print(f">> Tablero «{nombre}» ya existe: no se toca.")
            continue
        tarjetas = []
        for i, (pregunta, display, ajustes, sql) in enumerate(preguntas):
            card = mb.llamar("POST", "/api/card", {
                "name": pregunta,
                "display": display,
                "visualization_settings": ajustes,
                "collection_id": col["id"],
                "dataset_query": {"type": "native", "native": {"query": sql, "template-tags": {}}, "database": bd["id"]},
            })
            tarjetas.append({"id": -(i + 1), "card_id": card["id"], "row": (i // 2) * 7, "col": (i % 2) * 12,
                             "size_x": 12, "size_y": 7, "parameter_mappings": [], "visualization_settings": {}})
        dash = mb.llamar("POST", "/api/dashboard", {"name": nombre, "description": descripcion, "collection_id": col["id"]})
        mb.llamar("PUT", f"/api/dashboard/{dash['id']}", {"dashcards": tarjetas})
        print(f">> Tablero «{nombre}» creado con {len(tarjetas)} pregunta(s): {url}/dashboard/{dash['id']}")

    print(">> LISTO. Dé acceso a las personas en Metabase › Administración › Personas (grupo con permiso de solo «ver»).")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(f"ERROR: {e}")
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: no se pudo conectar con Metabase ({e.reason}). ¿Está en marcha y resuelve bi.<dominio>?")
