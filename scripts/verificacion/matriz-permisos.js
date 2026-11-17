// Matriz de permisos: entra con cada perfil de prueba y anota qué responde cada módulo.
// Uso:
//   DATABASE_URL=postgresql://… node scripts/verificacion/matriz-permisos.js [--base http://localhost:3021/api] [--esperado fichero.json] [--salida salida.json]
//   (forma antigua, posicional: node matriz-permisos.js <base api> <esperado.json> [salida.json])
// «esperado» = {unidades:{COD:{n,id}}, porId:{id:COD}, ejemplo:{COD: otId}}. Sin fichero se calcula
// desde la BD (DATABASE_URL). Sin ninguno de los dos el guion no puede correr (antes fallaba con
// ERR_INVALID_ARG_TYPE al leer un fichero «undefined»). Contraseña: la publicada por
// /auth/accesos-demo, o CLAVE_DEMO, o CLAVE_DEMO_EMBEBIDA de apps/api/src/auth/auth.service.ts.
// Falla (exit 1) si un perfil sin alcance global abre una OT de otra unidad.
const fs = require("fs");
const path = require("path");
const RAIZ = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const opcion = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const posicionales = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const base = opcion("--base") || posicionales[0] || process.env.API_BASE || "http://localhost:3021/api";
const ficheroEsperado = opcion("--esperado") || posicionales[1];
const salida = opcion("--salida") || posicionales[2];

function claveLocal() {
  if (process.env.CLAVE_DEMO) return process.env.CLAVE_DEMO;
  try {
    const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/auth/auth.service.ts"), "utf8");
    return (src.match(/CLAVE_DEMO_EMBEBIDA\s*=\s*"([^"]+)"/) || [])[1] || null;
  } catch { return null; }
}

/** OT por unidad, índice id → código y una OT de ejemplo por unidad, leídos de la BD. */
async function esperadoDesdeBd() {
  if (!process.env.DATABASE_URL) {
    console.log("Falta DATABASE_URL (o --esperado <fichero.json>) para saber qué OT hay en cada unidad.");
    process.exit(2);
  }
  const { PrismaClient } = require(require.resolve("@prisma/client", { paths: [path.join(RAIZ, "apps/api")] }));
  const prisma = new PrismaClient();
  try {
    const filas = await prisma.$queryRawUnsafe(
      `SELECT u.id::text AS id, u.codigo, count(o.id)::int AS n, (array_agg(o.id::text ORDER BY o.created_at DESC))[1] AS ejemplo
         FROM unidad u LEFT JOIN orden_trabajo o ON o.unidad_principal = u.id
        GROUP BY u.id, u.codigo`);
    const r = { unidades: {}, porId: {}, ejemplo: {}, total: 0 };
    for (const f of filas) {
      r.unidades[f.codigo] = { n: f.n, id: f.id };
      r.porId[f.id] = f.codigo;
      if (f.ejemplo) r.ejemplo[f.codigo] = f.ejemplo;
      r.total += f.n;
    }
    return r;
  } finally {
    await prisma.$disconnect();
  }
}
const PERFILES = ["demo.admin","demo.director","demo.calidad","demo.auditor","demo.recepcion","demo.ventas","demo.planificacion","demo.muestreo","demo.finanzas","demo.abastecimiento",
  "demo.dco.jefe","demo.dqo.jefe","demo.sal.jefe","demo.lqc.jefe","demo.lqc.revisor","demo.lqc.analista1","demo.lqa.analista2","demo.lmt.analista1","demo.lem.jefe",
  "demo.bpch.jefe","demo.scc.jefe","demo.scc.inspector1","demo.santof.jefe","demo.santof.inspector","demo.d11.jefe","demo.d11.inspector1"];
const RUTAS = ["/ot","/muestras","/cotizaciones","/clientes","/oportunidades","/internaciones/ot","/usuarios","/roles","/permisos/matriz","/firmas-matriz","/auditoria","/parametros",
  "/equipos","/calibraciones","/metrologia/calibraciones","/consumibles","/documentos","/saec/casos","/saec/certificados","/armas","/evidencias","/ibis/importaciones",
  "/reportes/comercial","/reportes/productividad","/mensajeria","/spc/series","/flujos/tareas/bandeja","/me/bandeja"];
const filas = (j) => Array.isArray(j) ? j.length : (j && Array.isArray(j.data) ? (j.meta?.total ?? j.data.length) : (j && Array.isArray(j.items) ? j.items.length : null));
(async () => {
  const esperado = ficheroEsperado ? JSON.parse(fs.readFileSync(ficheroEsperado, "utf8")) : await esperadoDesdeBd();
  const cfg = await (await fetch(base + "/auth/accesos-demo")).json();
  cfg.clave = cfg.clave || claveLocal();
  if (!cfg.habilitado || !cfg.clave) { console.log("accesos demo no habilitados o sin contraseña (defina CLAVE_DEMO)"); process.exit(2); }
  const porUser = Object.fromEntries(cfg.usuarios.map(u => [u.username, u]));
  const res = [];
  for (const username of PERFILES) {
    const u = porUser[username]; if (!u) { console.log("no existe", username); continue; }
    const lr = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: cfg.clave }) });
    const lj = await lr.json().catch(() => ({}));
    if (!lj.accessToken) { res.push({ username, rol: u.rol, unidad: u.unidad, login: lr.status }); continue; }
    const h = { authorization: "Bearer " + lj.accessToken };
    const fila = { username, rol: u.rol, unidad: u.unidad, login: lr.status, rutas: {} };
    const alc = await (await fetch(base + "/me/alcance", { headers: h })).json().catch(() => ({}));
    fila.global = alc.esGlobal ?? alc.global ?? null; fila.perfil = alc.perfil ?? null; const visibles = new Set((alc.unidadesVisibles ?? alc.unidades ?? []).map((x) => (typeof x === "string" ? x : x.codigo)));
    fila.nUnidades = visibles.size;
    for (const r of RUTAS) {
      const x = await fetch(base + r + (r === "/ot" || r === "/muestras" ? "?limit=500" : ""), { headers: h });
      let n = null, j = null; try { j = await x.json(); n = filas(j); } catch {}
      fila.rutas[r] = { s: x.status, n };
      if (r === "/ot" && x.status === 200) {
        const lista = Array.isArray(j) ? j : (j.data ?? []);
        const ids = new Set(Object.entries(esperado.unidades).map(([c, v]) => [v.id, c]).map(([id]) => id));
        const porUnidad = {};
        for (const o of lista) { const cod = esperado.porId[o.unidadPrincipal ?? o.unidad_principal ?? o.unidadPrincipalId] ?? "?"; porUnidad[cod] = (porUnidad[cod] || 0) + 1; }
        fila.otPorUnidad = porUnidad;
      }
    }
    // Acceso directo a una OT de OTRA unidad (debe dar 403 a quien no la tiene en su alcance).
    // Una OT de una unidad que NO está entre sus unidades visibles (LQC o SANTOF si se puede; si no, otra).
    const candidatas = Object.entries(esperado.ejemplo).filter(([c]) => !visibles.has(c));
    const ajena = candidatas.find(([c]) => c === "LQC") ?? candidatas.find(([c]) => c === "SANTOF") ?? candidatas[0];
    if (ajena) { const x = await fetch(base + "/ot/" + ajena[1], { headers: h }); fila.otAjena = { unidad: ajena[0], s: x.status }; }
    res.push(fila);
  }
  if (salida) fs.writeFileSync(salida, JSON.stringify(res, null, 1));
  const corto = (r) => r.replace("/metrologia/calibraciones","/metro/calib").replace("/flujos/tareas/bandeja","/tareas").replace("/reportes/","/rep/").replace("/ibis/importaciones","/ibis").replace("/saec/certificados","/saec/cert").replace("/internaciones/ot","/internac").replace("/permisos/matriz","/permisos").replace("/firmas-matriz","/firmas");
  console.log("PERFIL".padEnd(24) + "ALC  " + "OT visibles (por unidad)".padEnd(44) + "OT ajena");
  for (const f of res) {
    if (!f.rutas) { console.log(f.username.padEnd(24) + "LOGIN " + f.login); continue; }
    const ot = f.rutas["/ot"];
    const det = ot.s === 200 ? (ot.n + " → " + Object.entries(f.otPorUnidad || {}).sort().map(([c, n]) => c + ":" + n).join(" ").slice(0, 34)) : String(ot.s);
    console.log(f.username.padEnd(24) + (f.global ? "GLOB " : ("u=" + f.nUnidades).padEnd(5)) + det.padEnd(44) + (f.otAjena ? f.otAjena.unidad + "→" + f.otAjena.s : ""));
  }
  console.log("\nMÓDULOS (código HTTP; 200 con nº de filas)");
  console.log("".padEnd(24) + RUTAS.slice(1).map(r => corto(r).slice(1, 9).padEnd(9)).join(""));
  for (const f of res) if (f.rutas) console.log(f.username.replace("demo.", "").padEnd(24) + RUTAS.slice(1).map(r => { const c = f.rutas[r]; return (c.s === 200 ? (c.n === null ? "ok" : String(c.n)) : String(c.s)).padEnd(9); }).join(""));
  const sinLogin = res.filter((f) => !f.rutas);
  const ajenas = res.filter((f) => f.rutas && !f.global && f.otAjena && f.otAjena.s === 200);
  for (const f of sinLogin) console.log(`  FALLO ${f.username}: inicio de sesión ${f.login}`);
  for (const f of ajenas) console.log(`  FALLO ${f.username}: abre la OT de ${f.otAjena.unidad} sin tenerla en su alcance`);
  console.log(`
Matriz de permisos: ${res.length} perfiles · ${sinLogin.length + ajenas.length} fallos.`);
  process.exit(sinLogin.length + ajenas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
