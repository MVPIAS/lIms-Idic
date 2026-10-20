#!/usr/bin/env node
/**
 * Verificación del frente L · fase 0: ALCANCE POR LABORATORIO, por asignación.
 *
 * Para TODOS los perfiles demo.* (los acotados a una unidad, sección o
 * departamento, los transversales y los de dos roles demo.multi.*):
 *   1. Listados del menú: ninguna fila fuera del alcance del permiso del
 *      listado (alcance por asignación, calculado aquí desde la BD, sin
 *      preguntarle a la API).
 *   2. Detalle por id de un registro de OTRO laboratorio en cada tipo (OT,
 *      muestra, resultado, informe, certificado heredado, equipo, ensayo,
 *      método, prototipo, clasificación, evidencia SAEC, calibración):
 *      403 o 404 (410 en la ruta retirada /certificados).
 *   3. Escrituras ajenas (equipo, precio de ensayo, anular cotización,
 *      prototipo, aprobar resultados de otro laboratorio): 403. Y controles
 *      positivos con el mismo valor (no cambian nada): pasan la autorización.
 *   4. Menú filtrado (navegacion.ts transpilado tal cual, con itemEnAmbito y
 *      /me/alcance): SAEC solo para la Delegación Nº 11 y sus excepciones;
 *      BPCH Certificación nunca para la D11 (salvo trabajo asignado); y
 *      ninguna entrada visible cuyo listado responda 403.
 * Lo que la fase 0 deja para la fase 1 (ver cotizaciones, CRM, clientes,
 * facturación) se mide y se informa, pero no cuenta como fallo.
 *
 * Uso:
 *   DATABASE_URL=postgresql://lims:lims@localhost:5432/<bd> \
 *   node scripts/verificacion/alcance-por-laboratorio.js [--arrancar] [--base http://localhost:4261/api]
 *        [--medicion <fichero.json>]   (guarda las cifras; con --solo-medir no falla)
 * DATABASE_URL hace falta siempre: la «verdad» (unidad de cada registro,
 * asignaciones y permisos de cada rol) se lee de la BD. Contraseña: CLAVE_DEMO
 * o la constante CLAVE_DEMO_EMBEBIDA. No modifica datos (las escrituras ajenas
 * esperan 403 y los controles positivos reescriben el mismo valor).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4261/api");
const ARRANCAR = args.includes("--arrancar");
const MEDICION = arg("--medicion", null);
const SOLO_MEDIR = args.includes("--solo-medir");

function claveDemo() {
  if (process.env.CLAVE_DEMO) return process.env.CLAVE_DEMO;
  const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/auth/auth.service.ts"), "utf8");
  const m = src.match(/CLAVE_DEMO_EMBEBIDA\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("No se encontró CLAVE_DEMO_EMBEBIDA; defina CLAVE_DEMO.");
  return m[1];
}
const CLAVE = claveDemo();
if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL (la verdad de cada registro se lee de la BD).");
  process.exit(2);
}

/* ------------------------------------------------------------- reglas --- */
const ROLES_SIEMPRE_GLOBALES = ["SUPERADMIN", "ADMIN", "DIRECTOR", "SUBDIRECTOR"];
const GLOBAL_EN_D11 = ["SUPERADMIN", "DIRECTOR", "SUBDIRECTOR", "LECTOR"];
const NIVELES_JEFATURA = ["JEFATURA", "DIRECCION"];

/* ----------------------------------------------------------------- HTTP --- */
const sesiones = {};
async function login(username) {
  if (sesiones[username]) return sesiones[username];
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: CLAVE }),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!j.accessToken) return null;
    const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
    sesiones[username] = { token: j.accessToken, permisos: new Set(carga.permisos ?? []), roles: carga.roles ?? [] };
    return sesiones[username];
  }
  return null;
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j ?? "")).slice(0, 160);

/* ------------------------------------------------------------ arranque --- */
let hijo = null;
async function esperarApi(ms = 90000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (hijo && hijo.exitCode !== null) throw new Error("La API se detuvo al arrancar");
    try { const r = await fetch(`${BASE}/health`); if (r.status < 500) return; } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`La API no respondió en ${BASE}`);
}
function arrancarApi() {
  const puerto = new URL(BASE).port || "4261";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-alcance-por-laboratorio-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ------------------------------------------------- la verdad, de la BD --- */
const SQL_MAPA = String.raw`
with ou as (select o.id, o.codigo, u.codigo uc from orden_trabajo o left join unidad u on u.id = o.unidad_principal),
famu as (select f.id fid, u.codigo c from cat_familia f join unidad u on u.tenant_id = f.tenant_id
          and f.codsucdel = any(string_to_array(regexp_replace(coalesce(u.codsucdel, ''), '[\s,;]', '/', 'g'), '/'))),
cot as (
  select c.id, array_remove(array_agg(distinct x.c), null) u from cotizacion c left join lateral (
     select ou.uc c from ou where ou.id = c.ot_id
     union select ou2.uc from orden_trabajo o2 join ou ou2 on ou2.id = o2.id where o2.cotizacion_id = c.id
     union select u.codigo from centro_costo cc join unidad u on u.id = cc.unidad_id where cc.id = c.centro_costo_id
     union select famu.c from linea_cotizacion l join cat_ensayo e on e.id = l.cat_ensayo_id join famu on famu.fid = e.familia_id where l.cotizacion_id = c.id
  ) x on true group by c.id),
proto as (select p.id, p.clasificacion_id, coalesce(uo.codigo, up.codigo) c from bpch_prototipo p
          left join orden_trabajo o on o.id = p.ot_id left join unidad uo on uo.id = o.unidad_principal left join unidad up on up.id = p.unidad_id),
m as (
 select 'ot' t, id, array_remove(array[uc], null) u from ou
 union all select 'muestra', mu.id, array_remove(array[ou.uc], null) from muestra mu left join ou on ou.id = mu.ot_id
 union all select 'resultado', r.id, array_remove(array[ou.uc], null) from resultado r left join ou on ou.id = r.ot_id
 union all select 'certificado', c.id, array_remove(array[coalesce(u.codigo, ou.uc)], null) from certificado c left join unidad u on u.id = c.unidad_id left join ou on ou.id = c.ot_id
 union all select 'cotizacion', id, u from cot
 union all select 'factura', f.id, array_remove(array[(select uc from ou where ou.id = f.ot_id)] || coalesce((select u from cot where cot.id = f.cotizacion_id), '{}'), null) from factura f
 union all select 'cliente', cl.id, array_remove(array(select distinct uc from ou join orden_trabajo o on o.id = ou.id where o.cliente_id = cl.id
                                   union select unnest(cot.u) from cot join cotizacion c on c.id = cot.id where c.cliente_id = cl.id), null) from cliente cl
 union all select 'oportunidad', op.id, array_remove(array(select uc from ou where ou.id = op.ot_id union select unnest(u) from cot where cot.id = op.cotizacion_id), null) from oportunidad op
 union all select 'orden_interna', oi.id, array_remove(array(select distinct x from unnest(array[ou.uc,
              (select c from famu where famu.fid = oi.origen_lab limit 1), (select c from famu where famu.fid = oi.destino_lab limit 1)]) x), null)
             from orden_interna oi left join ou on ou.id = oi.ot_id
 union all select 'met_calibracion', c.id, array_remove(array[coalesce(u.codigo, ou.uc)], null) from met_calibracion c left join unidad u on u.id = c.unidad_id left join ou on ou.id = c.ot_id
 union all select 'bpch_internacion', b.id, array_remove(array[u.codigo], null) from bpch_internacion b left join unidad u on u.id = b.unidad_inspeccion_id
 union all select 'bpch_reinspeccion', b.id, array_remove(array[u.codigo], null) from bpch_reinspeccion b left join unidad u on u.id = b.unidad_inspeccion_id
 union all select 'bpch_prototipo', id, array_remove(array[c], null) from proto
 union all select 'bpch_clasificacion', b.id, array_remove(array(select ou.uc from ou where ou.id = b.ot_id union select c from proto where proto.clasificacion_id = b.id), null) from bpch_clasificacion b
 union all select 'saec_caso', s.id, array['D11'] from saec_caso s
 union all select 'evidencia', e.id, array['D11'] from evidencia e
 union all select 'equipo', e.id, array_remove(array[u.codigo], null) from equipo e left join unidad u on u.id = e.unidad_id where e.deleted_at is null
 union all select 'calibracion_equipo', c.id, array_remove(array[u.codigo], null) from calibracion c join equipo e on e.id = c.equipo_id left join unidad u on u.id = e.unidad_id
 union all select 'cat_ensayo', e.id, array(select c from famu where famu.fid = e.familia_id) from cat_ensayo e where e.deleted_at is null
 union all select 'cat_metodo', mm.id, array(select c from famu join cat_ensayo e on e.familia_id = famu.fid where e.id = mm.ensayo_id) from cat_metodo mm where mm.deleted_at is null
)
select json_build_object(
 'mapa', (select json_agg(json_build_object('t', t, 'id', id, 'u', u)) from m),
 'otCodigo', (select json_object_agg(codigo, coalesce(uc, '')) from ou),
 'unidades', (select json_agg(json_build_object('codigo', codigo, 'padre', (select codigo from unidad p where p.id = un.padre_id))) from unidad un),
 'roles', (select json_object_agg(r.codigo, json_build_object('canon', coalesce(r.alias_de, r.codigo), 'alcance', r.alcance, 'nivel', r.nivel,
            'permisos', coalesce((select json_agg(p.codigo) from rol_permiso rp join permiso p on p.id = rp.permiso_id where rp.rol_id = r.id), '[]'::json))) from rol r),
 'asignaciones', (select json_agg(json_build_object('username', us.username, 'rol', r.codigo, 'unidad', un.codigo)) from usuario us
            join usuario_rol ur on ur.usuario_id = us.id join rol r on r.id = ur.rol_id left join unidad un on un.id = ur.unidad_id
           where us.es_demo and us.estado = 'activo' and us.deleted_at is null
             and (ur.vigente_desde is null or ur.vigente_desde <= now()) and (ur.vigente_hasta is null or ur.vigente_hasta > now())),
 'jefaturas', (select json_agg(json_build_object('username', us.username, 'unidad', un.codigo)) from unidad_jefe j
            join usuario us on us.id = j.usuario_id join unidad un on un.id = j.unidad_id where us.es_demo),
 'datos', json_build_object(
   'equipos', (select json_agg(json_build_object('id', e.id, 'u', u.codigo, 'descripcion', e.descripcion)) from equipo e left join unidad u on u.id = e.unidad_id where e.deleted_at is null),
   'ensayos', (select json_agg(json_build_object('id', e.id, 'precio', e.precio, 'u', (select c from famu where famu.fid = e.familia_id limit 1)))
                 from cat_ensayo e where e.deleted_at is null and e.familia_id is not null and exists (select 1 from famu where famu.fid = e.familia_id)),
   'otsConResultados', (select json_agg(json_build_object('id', o.id, 'u', u.codigo)) from orden_trabajo o join unidad u on u.id = o.unidad_principal
                         where exists (select 1 from resultado r where r.ot_id = o.id))
 )
)`;

async function leerVerdad() {
  const { PrismaClient } = require(require.resolve("@prisma/client", { paths: [path.join(RAIZ, "apps/api")] }));
  const prisma = new PrismaClient();
  try {
    const filas = await prisma.$queryRawUnsafe(`select (${SQL_MAPA}) as j`);
    return filas[0].j;
  } finally {
    await prisma.$disconnect();
  }
}

/* -------------------------------------- alcance esperado (independiente) --- */
let V, porId, hijos;
function subarbol(c) {
  const s = new Set([c]);
  const cola = [c];
  while (cola.length) { const x = cola.pop(); for (const h of hijos[x] || []) if (!s.has(h)) { s.add(h); cola.push(h); } }
  return s;
}
/** Alcance esperado de UN permiso para un usuario: { global, rolesGlobales, unidades (propias) }. */
function esperado(username, permiso) {
  const asig = V.asignaciones.filter((a) => a.username === username);
  const jef = (V.jefaturas || []).filter((j) => j.username === username).map((j) => j.unidad);
  const rolDe = (a) => V.roles[a.rol] || { canon: a.rol, permisos: [] };
  const tieneJefatura = asig.some((a) => NIVELES_JEFATURA.includes((rolDe(a).nivel || "").toUpperCase()));
  const rolesGlobales = new Set();
  const unidades = new Set();
  let amplia = false;
  for (const a of asig) {
    const r = rolDe(a);
    if (permiso && !r.permisos.includes(permiso)) continue;
    const alc = ROLES_SIEMPRE_GLOBALES.includes(r.canon) ? "GLOBAL" : (r.alcance || "UNIDAD").toUpperCase();
    if (alc === "GLOBAL" || !a.unidad) { rolesGlobales.add(r.canon); continue; }
    if (alc === "DESCENDENCIA") subarbol(a.unidad).forEach((u) => unidades.add(u));
    else unidades.add(a.unidad);
    if (!tieneJefatura || NIVELES_JEFATURA.includes((r.nivel || "").toUpperCase())) amplia = true;
  }
  if (amplia) for (const j of jef) subarbol(j).forEach((u) => unidades.add(u));
  return { global: rolesGlobales.size > 0, rolesGlobales, unidades };
}
const enD11 = (e) => (e.global && [...e.rolesGlobales].some((r) => GLOBAL_EN_D11.includes(r))) || [...e.unidades].some((u) => subarbol("D11").has(u));

/* ----------------------------------------------------- listados del menú --- */
// regla: unidad (fila en el alcance) · bpch (además, con la SCC todo) · equipo (sin unidad = común)
//        saec (el listado solo si entra en la D11) · comun (no se comprueban filas) · retirada (410)
const LISTADOS = [
  { n: "Órdenes de trabajo", r: "/ot?limit=200", p: "ot.ver", t: "ot", regla: "unidad", href: "/ot" },
  { n: "Muestras", r: "/muestras?limit=200", p: "muestra.ver", t: "muestra", regla: "unidad", href: "/muestras" },
  { n: "Resultados", r: "/resultados?limit=200", p: "resultado.ver", t: "resultado", regla: "unidad" },
  { n: "Informes y certificados", r: "/informes/documentos?limit=200", p: "ot.ver", t: "certificado", regla: "unidad", href: "/certificados" },
  { n: "Certificados (ruta retirada)", r: "/certificados?limit=200", p: "ot.ver", regla: "retirada" },
  { n: "Órdenes internas", r: "/ordenes-internas?limit=200", p: "ot.ver", t: "orden_interna", regla: "unidad", href: "/ordenes-internas" },
  { n: "Buscador de documentos", r: "/documentos?limit=200", p: "ot.ver", t: "certificado", regla: "unidad", href: "/documentos" },
  { n: "Control estadístico (SPC)", r: "/spc/series", p: "resultado.ver", t: "ot", regla: "unidad", href: "/spc" },
  { n: "Equipos", r: "/equipos?limit=200", p: "equipo.ver", t: "equipo", regla: "equipo", href: "/equipos" },
  { n: "Calibraciones de equipos", r: "/calibraciones?limit=200", p: "equipo.ver", t: "calibracion_equipo", regla: "equipo" },
  { n: "Metrología · calibraciones", r: "/metrologia/calibraciones?limit=200", p: "metrologia.ver", t: "met_calibracion", regla: "unidad", href: "/metrologia" },
  { n: "BPCH internaciones", r: "/bpch/internaciones?limit=200", p: "bpch.internacion.ver", t: "bpch_internacion", regla: "bpch", href: "/bpch/internaciones" },
  { n: "Internaciones OT (heredada)", r: "/internaciones/ot?limit=200", p: "ot.ver", t: "ot", regla: "bpch" },
  { n: "BPCH reinspecciones", r: "/bpch/reinspecciones?limit=200", p: "bpch.reinspeccion.ver", t: "bpch_reinspeccion", regla: "bpch", href: "/bpch/reinspecciones" },
  { n: "BPCH prototipos", r: "/bpch/prototipos", p: "bpch.prototipo.ver", t: "bpch_prototipo", regla: "bpch", href: "/bpch/prototipos" },
  { n: "BPCH clasificaciones", r: "/bpch/clasificaciones", p: "bpch.clasificacion.ver", t: "bpch_clasificacion", regla: "bpch", href: "/bpch/clasificaciones" },
  { n: "BPCH codificación única", r: "/bpch/codificacion?limit=50", p: "bpch.codificacion.ver", regla: "comun", href: "/bpch/codificacion" },
  { n: "BPCH producción nacional", r: "/bpch/pn/oc?limit=50", p: "bpch.pn.ver", regla: "comun", href: "/bpch/produccion-nacional" },
  { n: "SAEC casos", r: "/saec/casos?limit=200", p: "caso.ver", regla: "saec" },
  { n: "SAEC evidencias", r: "/evidencias?limit=200", p: "evidencia.ver", regla: "saec", href: "/saec" },
  { n: "SAEC armas", r: "/armas?limit=200", p: "arma.ver", regla: "saec", href: "/saec/armas" },
  { n: "SAEC IBIS", r: "/ibis/importaciones", p: "ibis.ver", regla: "saec", href: "/saec/ibis" },
  // Fase 1 (decisión del usuario): se mide y se informa, no cuenta como fallo.
  { n: "Cotizaciones (fase 1)", r: "/cotizaciones?limit=200", p: "cotizacion.ver", t: "cotizacion", regla: "unidad", fase1: true, href: "/cotizaciones" },
  { n: "Clientes (fase 1)", r: "/clientes?limit=200", p: "cliente.ver", t: "cliente", regla: "unidad", fase1: true, href: "/clientes" },
  { n: "Oportunidades CRM (fase 1)", r: "/oportunidades?limit=200", p: "cotizacion.ver", t: "oportunidad", regla: "unidad", fase1: true, href: "/crm" },
  { n: "Facturas (fase 1)", r: "/facturas?limit=200", p: "factura.ver", t: "factura", regla: "unidad", fase1: true, href: "/facturas" },
];

function filasDe(j) {
  if (Array.isArray(j)) return j;
  for (const k of ["data", "items", "puntos"]) if (j && Array.isArray(j[k])) return j[k];
  return null;
}
function unidadesFila(f, tipo) {
  for (const k of ["id", "certificadoId", "documentoId"]) {
    const v = f?.[k];
    if (v && porId.has(`${tipo}:${v}`)) return porId.get(`${tipo}:${v}`);
  }
  const ot = f?.otId ?? f?.ot_id ?? f?.ot?.id;
  if (ot && porId.has(`ot:${ot}`)) return porId.get(`ot:${ot}`);
  const oc = f?.otCodigo ?? f?.ot_codigo ?? f?.ot?.codigo ?? (typeof f?.codigo === "string" && f.codigo.startsWith("OT-") ? f.codigo : null);
  if (oc && V.otCodigo[oc] !== undefined) return V.otCodigo[oc] ? [V.otCodigo[oc]] : [];
  return null;
}

/* ---------------------------------------------------------- resultados --- */
const R = { perfiles: 0, comprobaciones: 0, fallos: [], fase1: [], medicion: { filasFuera: 0, filasFueraFase1: 0, detallesAjenosAbiertos: 0, escriturasAjenasAceptadas: 0, menuIndebido: 0 } };
function comprobar(cond, texto, categoria) {
  R.comprobaciones++;
  if (!cond) {
    R.fallos.push(texto);
    if (categoria) R.medicion[categoria] = (R.medicion[categoria] || 0) + 1;
  }
  return cond;
}

/* ------------------------------------------------------------- el menú --- */
function cargarMenu() {
  const ts = require(require.resolve("typescript", { paths: [RAIZ, path.join(RAIZ, "apps/web")] }));
  const src = fs.readFileSync(path.join(RAIZ, "apps/web/lib/navegacion.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  // Sin itemEnAmbito (código anterior): la regla vieja de Sidebar.tsx.
  const enAmbito = mod.exports.itemEnAmbito || ((i, alc) => {
    if (!i.ambito || !alc?.ambitos || alc.esGlobal) return true;
    return [].concat(i.ambito).some((c) => alc.ambitos?.[c] !== false);
  });
  return { NAV: mod.exports.NAV, enAmbito };
}

/* ---------------------------------------------------------------- main --- */
async function main() {
  V = await leerVerdad();
  porId = new Map();
  for (const r of V.mapa || []) porId.set(`${r.t}:${r.id}`, r.u || []);
  hijos = {};
  for (const u of V.unidades) if (u.padre) (hijos[u.padre] ||= []).push(u.codigo);
  const { NAV, enAmbito } = cargarMenu();

  if (ARRANCAR) { arrancarApi(); await esperarApi(); }
  const cfg = await (await fetch(`${BASE}/auth/accesos-demo`)).json();
  const perfiles = [...new Set([...(cfg.usuarios || []).map((u) => u.username), ...V.asignaciones.map((a) => a.username)])]
    .filter((u) => u.startsWith("demo."))
    .sort();
  const multi = perfiles.filter((u) => new Set(V.asignaciones.filter((a) => a.username === u).map((a) => a.rol)).size > 1);

  // Trabajo asignado a la D11 en BPCH (internación, reinspección, prototipo, clasificación).
  const d11 = subarbol("D11");
  const d11ConTrabajo = (V.mapa || []).some((r) => ["bpch_internacion", "bpch_reinspeccion", "bpch_prototipo", "bpch_clasificacion"].includes(r.t) && (r.u || []).some((u) => d11.has(u)));

  console.log(`Alcance por laboratorio · ${perfiles.length} perfiles demo (${multi.length} con dos roles: ${multi.join(", ") || "—"})`);
  const porPerfil = [];

  for (const username of perfiles) {
    const s = await login(username);
    if (!s) { console.log(`  (sin acceso) ${username}`); continue; }
    R.perfiles++;
    const fila = { username, fuera: 0, detalle: 0, menu: 0, escrituras: 0 };
    const alcApi = (await llamar(username, "GET", "/me/alcance")).json || {};
    const tiene = (p) => s.roles.includes("SUPERADMIN") || s.permisos.has(p);

    /* 1 · listados */
    const estadoListado = {};
    for (const L of LISTADOS) {
      const e = esperado(username, L.p);
      const r = await llamar(username, "GET", L.r);
      estadoListado[L.r] = r.status;
      if (L.regla === "retirada") {
        comprobar(r.status === 410, `${username} · ${L.n}: ${r.status} (se esperaba 410 Gone)`, "filasFuera");
        continue;
      }
      if (r.status !== 200) continue;
      if (L.regla === "saec") {
        comprobar(enD11(e), `${username} · ${L.n}: 200 sin pertenecer a la Delegación Nº 11 (ni ser excepción)`, "filasFuera");
        continue;
      }
      if (L.regla === "comun" || e.global) continue;
      const filas = filasDe(r.json);
      if (!filas) continue;
      const scc = L.regla === "bpch" && e.unidades.has("SCC");
      if (scc) continue;
      let fuera = 0;
      let ejemplo = "";
      for (const f of filas) {
        const u = unidadesFila(f, L.t);
        if (u === null) continue; // fila no atribuible (p. ej. NC transversal)
        if (u.length === 0) {
          if (L.regla === "equipo") continue; // equipamiento común
          if (L.regla === "bpch" || L.fase1) { fuera++; ejemplo ||= `${f.codigo ?? f.id} [sin unidad]`; }
          continue;
        }
        if (!u.some((c) => e.unidades.has(c))) { fuera++; ejemplo ||= `${f.codigo ?? f.numero ?? f.otCodigo ?? f.id} [${u.join(",")}]`; }
      }
      if (L.fase1) {
        if (fuera) { R.fase1.push(`${username} · ${L.n}: ${fuera} fila(s) de otros laboratorios (p. ej. ${ejemplo})`); R.medicion.filasFueraFase1 += fuera; }
        continue;
      }
      fila.fuera += fuera;
      comprobar(fuera === 0, `${username} · ${L.n}: ${fuera} fila(s) fuera del alcance de ${L.p} (p. ej. ${ejemplo})`, "filasFuera");
      if (fuera) R.medicion.filasFuera += fuera - 1; // el comprobar ya contó 1
    }

    /* 2 · detalle por id de otro laboratorio */
    const DETALLE = [
      ["ot", "ot.ver", (id) => `/ot/${id}`],
      ["muestra", "muestra.ver", (id) => `/muestras/${id}`],
      ["resultado", "resultado.ver", (id) => `/resultados/${id}`],
      ["certificado", "ot.ver", (id) => `/informes/${id}/circuito`],
      ["certificado", "ot.ver", (id) => `/certificados/${id}`, [410]],
      ["equipo", "equipo.ver", (id) => `/equipos/${id}`],
      ["cat_ensayo", "muestra.ver", (id) => `/cat/ensayos/${id}`],
      ["cat_metodo", "muestra.ver", (id) => `/cat/metodos/${id}`],
      ["bpch_prototipo", "bpch.prototipo.ver", (id) => `/bpch/prototipos/${id}`, null, "bpch"],
      ["bpch_clasificacion", "bpch.clasificacion.ver", (id) => `/bpch/clasificaciones/${id}`, null, "bpch"],
      ["met_calibracion", "metrologia.ver", (id) => `/metrologia/calibraciones/${id}`],
      ["evidencia", "evidencia.ver", (id) => `/evidencias/${id}`, null, "saec"],
      ["cotizacion", "cotizacion.ver", (id) => `/cotizaciones/${id}`, null, "fase1"],
    ];
    for (const [tipo, perm, ruta, codigos, regla] of DETALLE) {
      if (!tiene(perm)) continue;
      const e = esperado(username, perm);
      if (regla === "saec") {
        if (enD11(e)) continue;
      } else if (e.global || (regla === "bpch" && e.unidades.has("SCC"))) continue;
      const cand = (V.mapa || []).filter((r) => r.t === tipo && (regla === "saec" || ((r.u || []).length > 0 && !(r.u || []).some((c) => e.unidades.has(c)))));
      if (!cand.length) continue;
      const r = await llamar(username, "GET", ruta(cand[0].id));
      const esperados = codigos || [403, 404];
      if (regla === "fase1") {
        if (!esperados.includes(r.status)) R.fase1.push(`${username} · detalle ${tipo} ajeno [${(cand[0].u || []).join(",")}]: ${r.status}`);
        continue;
      }
      const okk = comprobar(esperados.includes(r.status), `${username} · detalle ${tipo} de ${(cand[0].u || []).join(",") || "D11"} → ${r.status} (se esperaba ${esperados.join("/")})`, "detallesAjenosAbiertos");
      if (!okk) fila.detalle++;
    }

    /* 4 · menú */
    const acc = { admin: s.roles.some((r) => r === "SUPERADMIN" || r === "ADMIN") };
    const puede = (perm) => !perm || (Array.isArray(perm) && !perm.length) || acc.admin || [].concat(perm).some((p) => s.permisos.has(p));
    const visibles = [];
    for (const sec of NAV) for (const i of sec.items) if (puede(i.perm) && enAmbito(i, alcApi)) visibles.push({ sec: sec.id, ...i });
    const esD11 = V.asignaciones.some((a) => a.username === username && a.unidad && d11.has(a.unidad));
    for (const i of visibles) {
      if (i.sec === "saec" && i.perm) {
        const e = esperado(username, [].concat(i.perm)[0]);
        const okk = comprobar(enD11(e), `${username} · menú muestra SAEC «${i.label}» sin pertenecer a la Delegación Nº 11`, "menuIndebido");
        if (!okk) fila.menu++;
      }
      if (i.sec === "bpch" && esD11 && !esperado(username, [].concat(i.perm)[0]).global) {
        const nacional = ["/bpch/codificacion", "/bpch/produccion-nacional"].includes(i.href);
        const okk = comprobar(!nacional && d11ConTrabajo, `${username} · menú muestra BPCH Certificación «${i.label}» a la Delegación Nº 11`, "menuIndebido");
        if (!okk) fila.menu++;
      }
      const L = LISTADOS.find((l) => l.href === i.href);
      if (L && estadoListado[L.r] !== undefined) {
        const okk = comprobar(estadoListado[L.r] !== 403, `${username} · menú muestra «${i.label}» pero ${L.r} responde 403`, "menuIndebido");
        if (!okk) fila.menu++;
      }
    }
    // A la inversa: quien está en la D11 (o es excepción) con evidencia.ver ve SAEC en el menú.
    if (tiene("evidencia.ver") && enD11(esperado(username, "evidencia.ver"))) {
      comprobar(visibles.some((i) => i.href === "/saec"), `${username} · debería ver «Evidencias» (SAEC) en el menú`, "menuIndebido");
    }
    porPerfil.push(fila);
  }

  /* 3 · escrituras ajenas y controles positivos */
  const D = V.datos || {};
  const ajeno = (lista, unidadesPropias) => (lista || []).find((x) => x.u && !unidadesPropias.has(x.u));
  const propio = (lista, unidadesPropias) => (lista || []).find((x) => x.u && unidadesPropias.has(x.u));
  const escrituras = [];
  const intentar = async (u, metodo, ruta, cuerpo, esperados, texto) => {
    if (!(await login(u))) return;
    const r = await llamar(u, metodo, ruta, cuerpo);
    const okk = comprobar(esperados.includes(r.status), `${u} · ${texto}: ${metodo} ${ruta} → ${r.status} (se esperaba ${esperados.join("/")}) ${msg(r.json)}`, "escriturasAjenasAceptadas");
    escrituras.push(`${okk ? "OK   " : "FALLO"} ${u} · ${texto} → ${r.status}`);
  };
  const NO_403 = [200, 201, 400, 409];
  // Equipo de otro laboratorio (equipo.gestionar acotado: jefes, metrólogos).
  for (const u of ["demo.lem.jefe", "demo.lmt.analista1", "demo.multi.lam_lem"]) {
    const e = esperado(u, "equipo.gestionar");
    const eq = ajeno(D.equipos, e.unidades);
    if (eq) await intentar(u, "PATCH", `/equipos/${eq.id}`, { descripcion: eq.descripcion ?? "—" }, [403], `editar equipo de ${eq.u}`);
  }
  {
    const u = "demo.lqc.jefe";
    const eq = propio(D.equipos, esperado(u, "equipo.gestionar").unidades);
    if (eq) await intentar(u, "PATCH", `/equipos/${eq.id}`, { descripcion: eq.descripcion ?? "—" }, NO_403, `control: editar equipo propio (${eq.u}, mismo valor)`);
  }
  // Precio de un ensayo de otro laboratorio (catalogo.gestionar acotado: jefaturas).
  for (const u of ["demo.lpn.jefe", "demo.dsa.jefe", "demo.sstgo.jefe"]) {
    const ens = ajeno(D.ensayos, esperado(u, "catalogo.gestionar").unidades);
    if (ens) await intentar(u, "PATCH", `/cat/ensayos/${ens.id}`, { precio: Number(ens.precio) || 0 }, [403], `cambiar precio de ensayo de ${ens.u}`);
  }
  {
    const u = "demo.lqc.jefe";
    const ens = propio(D.ensayos, esperado(u, "catalogo.gestionar").unidades);
    if (ens) await intentar(u, "PATCH", `/cat/ensayos/${ens.id}`, { precio: Number(ens.precio) || 0 }, NO_403, `control: precio de ensayo propio (${ens.u}, mismo valor)`);
    await intentar("demo.lqc.jefe", "POST", "/cat/gran-grupos", { codigo: "ZZ", nombre: "Prueba de alcance" }, [403], "alta en tabla común del catálogo");
  }
  // Anular una cotización de otro laboratorio (cotizacion.anular acotado: jefes de departamento técnico).
  for (const u of ["demo.dsa.jefe", "demo.bpch.jefe"]) {
    const e = esperado(u, "cotizacion.anular");
    if (e.global) continue;
    const cot = (V.mapa || []).find((r) => r.t === "cotizacion" && (r.u || []).length && !(r.u || []).some((c) => e.unidades.has(c)));
    if (cot) await intentar(u, "POST", `/cotizaciones/${cot.id}/anular`, { motivo: "Prueba de alcance: no debe aplicarse" }, [403], `anular cotización de ${(cot.u || []).join(",")}`);
  }
  // Prototipo de otra unidad (bpch.prototipo.gestionar acotado: inspectores de sucursal).
  for (const u of ["demo.santof.inspector", "demo.scalam.inspector", "demo.d11.inspector1"]) {
    const e = esperado(u, "bpch.prototipo.gestionar");
    if (e.global || e.unidades.has("SCC")) continue;
    const pr = (V.mapa || []).find((r) => r.t === "bpch_prototipo" && !(r.u || []).some((c) => e.unidades.has(c)));
    if (pr) await intentar(u, "PATCH", `/bpch/prototipos/${pr.id}`, {}, [403], `editar prototipo de ${(pr.u || []).join(",") || "SCC (sin unidad)"}`);
  }
  {
    const pr = (V.mapa || []).find((r) => r.t === "bpch_prototipo");
    if (pr) await intentar("demo.scc.inspector1", "GET", `/bpch/prototipos/${pr.id}`, undefined, [200], "control: la SCC abre cualquier prototipo");
  }
  // Alcance por asignación: aprobar resultados de una OT de un laboratorio donde solo es analista.
  {
    const u = "demo.multi.lam_lem";
    const ot = (D.otsConResultados || []).find((o) => o.u === "LEM");
    if (ot) await intentar(u, "POST", `/resultados/ot/${ot.id}/aprobar`, {}, [403], "aprobar resultados en LEM (allí solo es analista)");
    const ajena = (D.otsConResultados || []).find((o) => o.u && o.u !== "LPN");
    if (ajena) await intentar("demo.multi.lpn_comercial", "POST", `/resultados/ot/${ajena.id}/aprobar`, {}, [403], `aprobar resultados en ${ajena.u} (sin permiso de jefatura)`);
  }

  /* ------------------------------------------------------------ resumen --- */
  console.log("\nEscrituras ajenas y controles:");
  for (const e of escrituras) console.log(`  ${e}`);
  const conProblemas = porPerfil.filter((p) => p.fuera || p.detalle || p.menu);
  console.log("\nPerfiles con hallazgos:", conProblemas.length ? "" : "ninguno");
  for (const p of conProblemas) console.log(`  ${p.username.padEnd(28)} filas fuera ${p.fuera} · detalles ajenos abiertos ${p.detalle} · menú ${p.menu}`);
  if (R.fase1.length) {
    console.log(`\nInformativo · fase 1 (ver cotizaciones, CRM, clientes, facturación): ${R.fase1.length} observaciones; p. ej.:`);
    for (const f of R.fase1.slice(0, 5)) console.log(`  · ${f}`);
  }
  if (R.fallos.length) {
    console.log(`\nFallos (${R.fallos.length}):`);
    for (const f of R.fallos.slice(0, 60)) console.log(`  ✗ ${f}`);
    if (R.fallos.length > 60) console.log(`  … y ${R.fallos.length - 60} más`);
  }
  console.log(
    `\nResumen: ${R.perfiles} perfiles revisados · ${R.comprobaciones} comprobaciones · ${R.fallos.length} fallos` +
      ` · filas fuera de alcance ${R.medicion.filasFuera} · detalles ajenos abiertos ${R.medicion.detallesAjenosAbiertos}` +
      ` · escrituras ajenas aceptadas ${R.medicion.escriturasAjenasAceptadas} · entradas de menú indebidas ${R.medicion.menuIndebido}`,
  );
  if (MEDICION) fs.writeFileSync(MEDICION, JSON.stringify({ ...R.medicion, perfiles: R.perfiles, comprobaciones: R.comprobaciones, fallos: R.fallos, fase1: R.fase1 }, null, 1));
  return R.fallos.length === 0 || SOLO_MEDIR;
}

main()
  .then((ok) => { pararApi(); process.exit(ok ? 0 : 1); })
  .catch((e) => { console.error(e); pararApi(); process.exit(1); });
