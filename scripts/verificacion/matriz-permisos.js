// Matriz de permisos: entra con cada perfil de prueba y anota qué responde cada módulo.
// Uso: node matriz.js <base api> <fichero esperado OT por unidad (json)> [salida.json]
const fs = require("fs");
const base = process.argv[2] || "http://localhost:3021/api";
const esperado = JSON.parse(fs.readFileSync(process.argv[3], "utf8")); // {unidades:{COD:{n, id}}, total, ejemplo:{COD: otId}}
const salida = process.argv[4];
const PERFILES = ["demo.admin","demo.director","demo.calidad","demo.auditor","demo.recepcion","demo.ventas","demo.planificacion","demo.muestreo","demo.finanzas","demo.abastecimiento",
  "demo.dco.jefe","demo.dqo.jefe","demo.sal.jefe","demo.lqc.jefe","demo.lqc.revisor","demo.lqc.analista1","demo.lqa.analista2","demo.lmt.analista1","demo.lem.jefe",
  "demo.bpch.jefe","demo.scc.jefe","demo.scc.inspector1","demo.santof.jefe","demo.santof.inspector","demo.d11.jefe","demo.d11.inspector1"];
const RUTAS = ["/ot","/muestras","/cotizaciones","/clientes","/oportunidades","/internaciones/ot","/usuarios","/roles","/permisos/matriz","/firmas-matriz","/auditoria","/parametros",
  "/equipos","/calibraciones","/metrologia/calibraciones","/consumibles","/documentos","/saec/casos","/saec/certificados","/armas","/evidencias","/ibis/importaciones",
  "/reportes/comercial","/reportes/productividad","/mensajeria","/spc/series","/flujos/tareas/bandeja","/me/bandeja"];
const filas = (j) => Array.isArray(j) ? j.length : (j && Array.isArray(j.data) ? (j.meta?.total ?? j.data.length) : (j && Array.isArray(j.items) ? j.items.length : null));
(async () => {
  const cfg = await (await fetch(base + "/auth/accesos-demo")).json();
  if (!cfg.habilitado || !cfg.clave) { console.log("accesos demo no habilitados o clave no publicada"); process.exit(2); }
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
    fila.global = alc.esGlobal ?? alc.global ?? null; fila.perfil = alc.perfil ?? null; fila.nUnidades = (alc.unidades ?? alc.unidadIds ?? []).length;
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
    const ajena = Object.entries(esperado.ejemplo).find(([c]) => c !== (u.unidad || "") && c === (u.unidad === "LQC" ? "SANTOF" : "LQC"));
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
})();
