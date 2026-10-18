#!/usr/bin/env node
/**
 * Recorrido DESDE CERO de los tres procesos BPCH contra una API real:
 *
 *   A. Clasificación de sustancias: alta con pruebas ONU (IT21/IT22/IT23) →
 *      reglas de registro (pruebas incompletas, decisión contradictoria) →
 *      registro → aprobación por otra persona → documento sellado (HTML y PDF);
 *      devolución con motivo.
 *   B. Producción Nacional: alta del fabricante → RAF DGMN → O/C operativa anual
 *      con productos y cantidades → programa de inspecciones (alcance por
 *      sucursal) → OT de la inspección → flujo general (muestra, captura,
 *      revisión, aprobación, informe de inspección, firma, entrega, cierre) →
 *      seguimiento (ejecutadas, atrasadas, consumo) → correlación con la
 *      relación de ventas → informe técnico a DCO (lo lee Comercial).
 *   C. Prototipos: ingreso → pronunciamiento SAC → OT → flujo general →
 *      dictamen (aprobación exige clasificación aprobada) → certificado de tipo
 *      por la matriz de firmas → código único CNC-DGMN → entrega y cierre;
 *      segundo prototipo que no cumple → informe de rechazo.
 *
 * Cada regla se prueba con el perfil que puede y con uno que NO debe poder.
 *
 * Uso:
 *   node scripts/verificacion/bpch-produccion-prototipos-clasificacion.js [--arrancar] [--base http://localhost:4121/api]
 *
 *   --arrancar  lanza `node apps/api/dist/main.js` (compile antes) con DATABASE_URL,
 *               PORT/API_PORT = puerto de --base, NODE_ENV=production y ACCESOS_DEMO=true.
 *
 * Contraseña de los usuarios demo.*: variable CLAVE_DEMO o la constante
 * CLAVE_DEMO_EMBEBIDA de apps/api/src/auth/auth.service.ts (no se escribe en ningún sitio).
 * Deja datos de prueba en la base: úsese en una base de pruebas. Se puede repetir.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4121/api");
const ARRANCAR = args.includes("--arrancar");

function claveDemo() {
  if (process.env.CLAVE_DEMO) return process.env.CLAVE_DEMO;
  const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/auth/auth.service.ts"), "utf8");
  const m = src.match(/CLAVE_DEMO_EMBEBIDA\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("No se encontró CLAVE_DEMO_EMBEBIDA; defina CLAVE_DEMO.");
  return m[1];
}
const CLAVE = claveDemo();

/* ----------------------------------------------------------------- HTTP --- */
const sesiones = {};
async function login(username) {
  if (sesiones[username]) return sesiones[username];
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: CLAVE }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id };
  return sesiones[username];
}
async function llamar(username, metodo, ruta, cuerpo, crudo = false) {
  const s = await login(username);
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  if (crudo) return { status: r.status, tipo: r.headers.get("content-type") ?? "", buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) =>
  (typeof j === "string"
    ? j
    : j?.message
      ? `${Array.isArray(j.message) ? j.message.join("; ") : j.message}${Array.isArray(j.issues) ? ` ${j.issues.map((i) => i.message).join("; ")}` : ""}`
      : JSON.stringify(j)
  ).slice(0, 400);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!ok) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);
/** Exige un error y que su mensaje contenga un texto. */
async function rechazo(esperado, re, u, m, ruta, c) {
  const j = await exigir(esperado, u, m, ruta, c);
  if (re && !re.test(msg(j))) throw new Error(`${u} ${m} ${ruta}: el mensaje no explica el motivo (${msg(j)})`);
  return msg(j);
}

/* -------------------------------------------------------------- informe --- */
const pasos = [];
let actual = null;
async function paso(nombre, fn) {
  actual = nombre;
  const t0 = Date.now();
  try {
    const detalle = await fn();
    pasos.push({ nombre, ok: true });
    console.log(`  OK    ${nombre}${detalle ? ` · ${String(detalle).slice(0, 220)}` : ""} (${Date.now() - t0} ms)`);
  } catch (e) {
    pasos.push({ nombre, ok: false });
    console.log(`  FALLO ${nombre} · ${e.message}`);
    throw e;
  }
}
function afirmar(cond, texto) {
  if (!cond) throw new Error(texto);
}

/* ------------------------------------------------------------ arranque --- */
let hijo = null;
async function esperarApi(ms = 90000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (hijo && hijo.exitCode !== null) throw new Error("La API se detuvo al arrancar");
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status < 500) return;
    } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`La API no respondió en ${BASE}`);
}
function arrancarApi() {
  if (!process.env.DATABASE_URL) throw new Error("--arrancar necesita DATABASE_URL");
  const puerto = new URL(BASE).port || "4121";
  const env = {
    ...process.env,
    PORT: puerto,
    API_PORT: puerto,
    NODE_ENV: "production",
    ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-bpch-g2-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
function pararApi() {
  if (hijo && !hijo.killed) hijo.kill();
}

/* ============================================================ RECORRIDO === */
const U = {
  bpch: "demo.bpch.jefe", // Jefe del Departamento BPCH (Subdirección)
  scc: "demo.scc.jefe", // Jefe de la Sección Certificación de la Conformidad
  sccInsp: "demo.scc.inspector1",
  sccInsp2: "demo.scc.inspector2",
  stgo: "demo.sstgo.jefe", // Jefe de la Sucursal Santiago
  stgoInsp: "demo.sstgo.inspector",
  antof: "demo.santof.jefe",
  ventas: "demo.ventas", // Comercial (DCO): lee Producción Nacional
  ajeno: "demo.lqc.analista1", // fuera del ámbito BPCH
};
const POSIBLES_FIRMANTES = ["demo.sstgo.jefe", "demo.scc.jefe", "demo.bpch.jefe", "demo.director", "demo.sstgo.inspector", "demo.scc.inspector1", "demo.scc.inspector2"];

function rutValido(semilla) {
  const cuerpo = String(60000000 + (semilla % 9999999));
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}

/** Recorre el flujo general de una OT de BPCH: muestra, captura, revisión, aprobación. */
async function flujoGeneral(C, otId, valores, capturador, revisor, aprobador) {
  await ok(capturador, "POST", `/flujo/ot/${otId}/muestras`, { muestras: [{ nombre: "Lote inspeccionado", metodoIds: [C.metodo.id] }] });
  const rs = (await ok(revisor, "GET", `/flujo/ot/${otId}/resultados`)).resultados;
  afirmar(rs.length >= 2, `se esperaban 2 ensayos (defecto crítico y menor), hay ${rs.length}`);
  for (const r of rs) {
    const critico = /cr[ií]tico/i.test(r.analitoNombre ?? r.catAnalitoNombre ?? r.nombre ?? r.analito ?? JSON.stringify(r));
    const v = critico ? valores.critico : valores.menor;
    await ok(capturador, "POST", `/flujo/resultado/${r.id}/valor`, { valor: String(v) });
  }
  await ok(revisor, "POST", `/resultados/ot/${otId}/revisar`, {});
  await ok(aprobador, "POST", `/resultados/ot/${otId}/aprobar`, {});
  const fin = (await ok(aprobador, "GET", `/flujo/ot/${otId}/resultados`)).resultados;
  afirmar(fin.every((x) => x.estado === "aprobado"), `estados: ${fin.map((x) => x.estado).join(",")}`);
  return fin;
}

/** Firma un documento siguiendo sus pasos con los usuarios de prueba. */
async function firmarTodo(docId, usuarioConsulta) {
  const porId = Object.fromEntries(Object.entries(sesiones).map(([u, s]) => [s.id, u]));
  const circ = await ok(usuarioConsulta, "GET", `/informes/${docId}/circuito`);
  const pasosF = circ.pasos ?? [];
  const firmantes = new Set();
  const hechos = [];
  for (const orden of [...new Set(pasosF.map((p) => p.orden))].sort((a, b) => a - b)) {
    for (const p of pasosF.filter((x) => x.orden === orden && x.estado !== "omitido")) {
      if (!p.obligatorio && !(p.responsables ?? []).some((r) => porId[r.usuarioId])) continue;
      const cand = (p.responsables ?? []).map((r) => porId[r.usuarioId]).filter(Boolean);
      const quien = cand.find((u) => !firmantes.has(u)) ?? cand[0];
      afirmar(quien, `paso ${orden}: ningún responsable entre los usuarios de prueba (${(p.responsables ?? []).map((r) => r.nombre).join(", ")})`);
      await ok(quien, "POST", `/informes/${docId}/firmar`, {});
      firmantes.add(quien);
      hechos.push(`${orden}:${quien.replace("demo.", "")}`);
    }
  }
  const fin = await ok(usuarioConsulta, "GET", `/informes/${docId}/circuito`);
  return { estado: fin.documento?.estado ?? fin.estado, hechos };
}

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const anio = new Date().getFullYear();
  const mes = new Date().getMonth() + 1;

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of [...Object.values(U), ...POSIBLES_FIRMANTES]) await login(u).catch((e) => { if (Object.values(U).includes(u)) throw e; });
    return `${Object.keys(sesiones).length} sesiones`;
  });

  await paso("Fuera del ámbito BPCH no se entra (analista de LQC → 403)", async () => {
    await exigir(403, U.ajeno, "GET", "/bpch/pn/oc");
    await exigir(403, U.ajeno, "GET", "/bpch/prototipos");
    await exigir(403, U.ajeno, "GET", "/bpch/clasificaciones");
  });

  await paso("Unidades de BPCH y método de inspección visual (SAC-PG01-IT12) del catálogo", async () => {
    const cfg = await ok(U.scc, "GET", "/bpch/pn/config");
    C.unidades = Object.fromEntries(cfg.unidades.map((u) => [u.codigo, u]));
    for (const c of ["SSTGO", "SANTOF", "SCC"]) afirmar(C.unidades[c], `falta la unidad ${c}`);
    afirmar(!cfg.unidades.some((u) => u.codigo === "LQC"), "la lista de unidades incluye laboratorios ajenos a BPCH");
    C.tipoCliente = (cfg.tiposCliente.find((t) => t.codigo === "ley_17798") ?? cfg.tiposCliente[0]).codigo;
    const ms = lista(await ok(U.stgo, "GET", "/cat/metodos?search=10019&limit=20"));
    C.metodo = ms.find((m) => m.codigo === "10019");
    afirmar(C.metodo, "método 10019 (Inspección visual del producto) no está en el catálogo");
    return `${cfg.unidades.length} unidades · método ${C.metodo.codigo} ${C.metodo.nombre}`;
  });

  /* ================================================== A. Clasificación */
  const it23Positivo = { aplica: true, ensayos: [{ presionMaxKpa: 1900, tiempoMs: null }, { presionMaxKpa: 2350, tiempoMs: 18 }, { presionMaxKpa: 2100, tiempoMs: 25 }] };
  await paso("A1 · Inspector registra la sustancia con una prueba IT21 incompleta: no se puede registrar (400)", async () => {
    C.clas = await ok(U.sccInsp, "POST", "/bpch/clasificaciones", {
      sustancia: `Sustancia de prueba ${sello}`,
      descripcion: "Producto exotérmico con polvo metálico (prueba desde cero).",
      pruebas: { it21: { aplica: true, serie1: { ensayos: [{ tuboFragmentado: false, placaPerforada: false }] } } },
    });
    afirmar(C.clas.estado === "borrador" && /^CLS-\d{4}-\d{4}$/.test(C.clas.codigo), `alta ${C.clas.codigo} ${C.clas.estado}`);
    afirmar(C.clas.evaluacion.it21.resultado === "incompleto", `IT21 ${C.clas.evaluacion.it21.resultado}`);
    return await rechazo(400, /sin concluir|segundo|explosiva/i, U.sccInsp, "POST", `/bpch/clasificaciones/${C.clas.id}/registrar`);
  });
  await paso("A2 · Completa IT21 (2 ensayos negativos) e IT23 (TPT ≥ 2.070 kPa → positivo); «no explosiva» sin justificar → 400", async () => {
    const neg = { tuboFragmentado: false, placaPerforada: false };
    const c = await ok(U.sccInsp, "PATCH", `/bpch/clasificaciones/${C.clas.id}`, {
      pruebas: { it21: { aplica: true, serie1: { ensayos: [neg, neg] } }, it22: { aplica: false, serie: 1, ensayos: [] }, it23: it23Positivo },
      explosiva: false,
    });
    afirmar(c.evaluacion.it21.resultado === "negativo" && c.evaluacion.it23.resultado === "positivo", `IT21 ${c.evaluacion.it21.resultado} IT23 ${c.evaluacion.it23.resultado}`);
    afirmar(c.evaluacion.it23.tiempoMinMs === 18, `menor tiempo ${c.evaluacion.it23.tiempoMinMs}`);
    afirmar(c.evaluacion.indicaExplosiva === true, "el indicador no marca comportamiento explosivo");
    return await rechazo(400, /justifique/i, U.sccInsp, "POST", `/bpch/clasificaciones/${C.clas.id}/registrar`);
  });
  await paso("A3 · Decide Clase 1 · 1.1 sin grupo válido → 400; con 1.1D y UN 0081 se registra", async () => {
    await ok(U.sccInsp, "PATCH", `/bpch/clasificaciones/${C.clas.id}`, { explosiva: true, claseDivision: "5.1" });
    await rechazo(400, /no es de Clase 1/i, U.sccInsp, "POST", `/bpch/clasificaciones/${C.clas.id}/registrar`);
    await rechazo(400, /cuatro dígitos/i, U.sccInsp, "PATCH", `/bpch/clasificaciones/${C.clas.id}`, { numeroOnu: "81" });
    await ok(U.sccInsp, "PATCH", `/bpch/clasificaciones/${C.clas.id}`, {
      claseDivision: "1.1", grupoCompatibilidad: "D", numeroOnu: "UN 0081", nombreEnvio: "Explosivo para voladuras, tipo A",
    });
    const r = await ok(U.sccInsp, "POST", `/bpch/clasificaciones/${C.clas.id}/registrar`);
    afirmar(r.estado === "registrada" && r.clasificadoPor?.id === sesiones[U.sccInsp].id, `estado ${r.estado}`);
    afirmar(r.numeroOnu === "0081" && r.resumen === "1.1D · UN 0081", `resumen ${r.resumen}`);
    await exigir(409, U.sccInsp, "PATCH", `/bpch/clasificaciones/${C.clas.id}`, { descripcion: "x" });
    return r.resumen;
  });
  await paso("A4 · El inspector no aprueba (403); la jefatura SCC aprueba y se sella el documento", async () => {
    await exigir(403, U.sccInsp, "POST", `/bpch/clasificaciones/${C.clas.id}/aprobar`);
    const r = await ok(U.scc, "POST", `/bpch/clasificaciones/${C.clas.id}/aprobar`);
    afirmar(r.estado === "aprobada" && r.documento?.numero === C.clas.codigo && /^[0-9a-f]{64}$/.test(r.documento.hash), `aprobación ${r.estado}`);
    const html = await llamar(U.sccInsp2, "GET", `/bpch/clasificaciones/${C.clas.id}/documento`, undefined, true);
    afirmar(html.status === 200 && /CLASIFICACIÓN DE SUSTANCIA/.test(html.buffer.toString("utf8")), `documento HTML ${html.status}`);
    afirmar(html.buffer.toString("utf8").includes(r.documento.hash), "el documento no muestra su sello");
    const pdf = await llamar(U.sccInsp2, "GET", `/bpch/clasificaciones/${C.clas.id}/pdf`, undefined, true);
    afirmar(pdf.status === 200 && pdf.tipo.includes("pdf") && pdf.buffer.slice(0, 4).toString() === "%PDF", `PDF ${pdf.status} ${pdf.tipo}`);
    return `${r.documento.numero} · aprobado por ${r.aprobadoPor?.nombre}`;
  });
  await paso("A5 · Quien clasifica no aprueba su propia clasificación (403); se devuelve con motivo", async () => {
    const c = await ok(U.scc, "POST", "/bpch/clasificaciones", {
      sustancia: `Nitrato de amonio prueba ${sello}`,
      pruebas: { it23: { aplica: true, ensayos: [{ presionMaxKpa: 300 }, { presionMaxKpa: 280 }, { presionMaxKpa: 310 }] } },
      explosiva: false,
      claseDivision: "5.1",
      numeroOnu: "1942",
    });
    await ok(U.scc, "POST", `/bpch/clasificaciones/${c.id}/registrar`);
    await rechazo(403, /propia/i, U.scc, "POST", `/bpch/clasificaciones/${c.id}/aprobar`);
    await exigir(400, U.bpch, "POST", `/bpch/clasificaciones/${c.id}/devolver`, { motivo: "x" });
    const d = await ok(U.bpch, "POST", `/bpch/clasificaciones/${c.id}/devolver`, { motivo: "Falta la hoja de datos de seguridad" });
    afirmar(d.estado === "borrador" && d.devuelto?.motivo, `estado ${d.estado}`);
    C.clasBorrador = d;
    return `${c.codigo}: devuelta`;
  });

  /* ============================================ B. Producción Nacional */
  await paso("B1 · Alta del fabricante (Comercial no puede: 403; RUT repetido: 409)", async () => {
    const rut = rutValido(Number(sello.slice(-7)));
    const cuerpo = { rut, razonSocial: `Fabricante prueba ${sello}`, tipo: C.tipoCliente, ciudad: "Santiago" };
    await exigir(403, U.ventas, "POST", "/bpch/pn/fabricantes", cuerpo);
    await exigir(400, U.scc, "POST", "/bpch/pn/fabricantes", { ...cuerpo, rut: "11.111.111-2" });
    C.fab = await ok(U.scc, "POST", "/bpch/pn/fabricantes", cuerpo);
    await rechazo(409, /ya está registrado/i, U.scc, "POST", "/bpch/pn/fabricantes", cuerpo);
    const busq = lista(await ok(U.ventas, "GET", `/bpch/pn/fabricantes?q=${encodeURIComponent(rut)}`));
    afirmar(busq.some((f) => f.id === C.fab.id), "la búsqueda no encuentra al fabricante");
    return `${C.fab.razonSocial} (${C.fab.rut})`;
  });
  await paso("B2 · RAF DGMN de línea fija (sin tipo de línea → 400; el inspector no registra → 403)", async () => {
    const cuerpo = {
      clienteId: C.fab.id, numero: `RAF-${sello}`, fecha: `${anio}-01-10`, tipoLinea: "FIJA", planta: "Planta de prueba (fija)",
      vigenciaHasta: `${anio + 1}-12-31`, listadoProductos: "ANFO a granel; Emulsión encartuchada",
      resAlmacenamiento: `Res. almacenamiento ${sello}`,
    };
    await exigir(400, U.scc, "POST", "/bpch/pn/rafs", { ...cuerpo, tipoLinea: undefined });
    await exigir(403, U.sccInsp, "POST", "/bpch/pn/rafs", cuerpo);
    C.raf = await ok(U.scc, "POST", "/bpch/pn/rafs", cuerpo);
    await exigir(409, U.scc, "POST", "/bpch/pn/rafs", cuerpo);
    afirmar(C.raf.estado === "vigente" && !C.raf.vencida, `RAF ${C.raf.estado}`);
    return C.raf.numero;
  });
  await paso("B3 · O/C operativa anual con productos y cantidades (Subdirección); cobro obligatorio", async () => {
    const cuerpo = {
      rafId: C.raf.id, numero: `OC-OP-${sello}`, anio, vigenciaDesde: `${anio}-01-01`, vigenciaHasta: `${anio}-12-31`, conCobro: false,
      productos: [
        { producto: "ANFO a granel", unidadMedida: "t", cantidadAutorizada: 100 },
        { producto: "Emulsión encartuchada", unidadMedida: "u", cantidadAutorizada: 5000 },
      ],
    };
    await rechazo(400, /cobro/i, U.bpch, "POST", "/bpch/pn/oc", { ...cuerpo, conCobro: undefined });
    await exigir(400, U.bpch, "POST", "/bpch/pn/oc", { ...cuerpo, productos: [] });
    await exigir(403, U.stgo, "POST", "/bpch/pn/oc", cuerpo);
    C.oc = await ok(U.bpch, "POST", "/bpch/pn/oc", cuerpo);
    C.pAnfo = C.oc.productos.find((p) => p.producto.startsWith("ANFO"));
    C.pEmul = C.oc.productos.find((p) => p.producto.startsWith("Emulsión"));
    afirmar(C.oc.productos.length === 2 && C.oc.resumen.total === 0, "la O/C no quedó con sus 2 productos");
    return `${C.oc.numero} · ${C.oc.productos.map((p) => `${p.producto} ${p.cantidadAutorizada} ${p.unidadMedida}`).join(" / ")}`;
  });
  await paso("B4 · El producto usa una clasificación APROBADA (una en borrador → 400)", async () => {
    await rechazo(400, /aprobada/i, U.scc, "PATCH", `/bpch/pn/oc/${C.oc.id}/productos/${C.pAnfo.id}`, { clasificacionId: C.clasBorrador.id });
    const o = await ok(U.scc, "PATCH", `/bpch/pn/oc/${C.oc.id}/productos/${C.pAnfo.id}`, { clasificacionId: C.clas.id });
    const p = o.productos.find((x) => x.id === C.pAnfo.id);
    afirmar(p.clasificacion?.id === C.clas.id, "el producto no quedó con la clasificación");
    const det = await ok(U.scc, "GET", `/bpch/clasificaciones/${C.clas.id}`);
    afirmar(det.usos.productosPn.some((x) => x.id === C.pAnfo.id), "la clasificación no muestra su uso en Producción Nacional");
    return `${p.producto} → ${p.clasificacion.codigo}`;
  });
  await paso("B5 · Programa: la Sucursal Santiago programa lo suyo; Antofagasta no programa Santiago (403); la SCC programa cualquier sucursal", async () => {
    await exigir(403, U.antof, "POST", `/bpch/pn/oc/${C.oc.id}/programa`, { lineas: [{ ocProductoId: C.pAnfo.id, unidadId: C.unidades.SSTGO.id, mes }] });
    await rechazo(400, /no es del mes/i, U.stgo, "POST", `/bpch/pn/oc/${C.oc.id}/programa`, {
      lineas: [{ ocProductoId: C.pAnfo.id, unidadId: C.unidades.SSTGO.id, mes, fechaProgramada: `${anio}-${String(mes === 12 ? 1 : mes + 1).padStart(2, "0")}-05` }],
    });
    let o = await ok(U.stgo, "POST", `/bpch/pn/oc/${C.oc.id}/programa`, {
      lineas: [{ ocProductoId: C.pAnfo.id, unidadId: C.unidades.SSTGO.id, mes, lote: `L-${sello}`, cantidad: 40 }],
    });
    o = await ok(U.scc, "POST", `/bpch/pn/oc/${C.oc.id}/programa`, {
      lineas: [
        { ocProductoId: C.pEmul.id, unidadId: C.unidades.SANTOF.id, mes: mes > 1 ? mes - 1 : mes, cantidad: 1000 },
        { ocProductoId: C.pEmul.id, unidadId: C.unidades.SANTOF.id, mes: 12, cantidad: 500 },
      ],
    });
    C.lineaStgo = o.programa.find((l) => l.unidad.codigo === "SSTGO");
    afirmar(o.resumen.total === 3 && o.resumen.planificadas === 3, `resumen ${JSON.stringify(o.resumen)}`);
    if (mes > 1) afirmar(o.resumen.atrasadas === 1, `atrasadas ${o.resumen.atrasadas}`);
    return `programa ${o.resumen.total} inspecciones · atrasadas ${o.resumen.atrasadas}`;
  });
  await paso("B6 · Se genera la OT de la inspección (origen Producción Nacional, Sucursal Santiago); no dos veces", async () => {
    await exigir(403, U.antof, "POST", `/bpch/pn/programa/${C.lineaStgo.id}/generar-ot`);
    await exigir(403, U.ajeno, "POST", `/bpch/pn/programa/${C.lineaStgo.id}/generar-ot`);
    const r = await ok(U.stgo, "POST", `/bpch/pn/programa/${C.lineaStgo.id}/generar-ot`);
    C.otPn = r.ot;
    await rechazo(409, /ya tiene una OT/i, U.stgo, "POST", `/bpch/pn/programa/${C.lineaStgo.id}/generar-ot`);
    const ot = await ok(U.stgoInsp, "GET", `/ot/${C.otPn.id}`);
    afirmar(ot.origenTrabajo === "PRODUCCION_NACIONAL" && ot.unidad?.codigo === "SSTGO", `origen ${ot.origenTrabajo} unidad ${ot.unidad?.codigo}`);
    afirmar(ot.numeroLey === C.raf.numero && ot.conCobro === false && ot.clienteId === C.fab.id, "la OT no hereda RAF, cobro o fabricante");
    afirmar(/O\/C operativa/.test(ot.descripcionTrabajo ?? ""), "la OT no describe su origen");
    const hist = await ok(U.stgo, "GET", `/ot/${C.otPn.id}/historial`);
    afirmar(hist.some((h) => h.tipo === "origen_bpch"), "el origen no quedó en el historial de la OT");
    const origen = await ok(U.stgoInsp, "GET", `/bpch/origen-ot/${C.otPn.id}`);
    afirmar(origen?.proceso === "PRODUCCION_NACIONAL" && origen.enlace.includes(C.oc.id), "el expediente no enlaza la O/C");
    await exigir([403, 404], U.ajeno, "GET", `/bpch/origen-ot/${C.otPn.id}`);
    const o = await ok(U.stgo, "GET", `/bpch/pn/oc/${C.oc.id}`);
    const c = o.consumo.find((x) => x.ocProductoId === C.pAnfo.id);
    afirmar(o.resumen.enCurso === 1 && c.comprometido === 40 && c.saldo === 60, `consumo ${JSON.stringify(c)}`);
    return `${C.otPn.codigo} · ANFO comprometido ${c.comprometido} t, saldo ${c.saldo} t`;
  });
  await paso("B7 · Flujo general en la OT: el inspector registra la muestra y captura; la jefatura revisa y BPCH aprueba", async () => {
    const rs = await flujoGeneral(C, C.otPn.id, { critico: 0, menor: 2 }, U.stgoInsp, U.stgo, U.bpch);
    afirmar(rs.every((r) => r.veredicto === "cumple"), `veredictos ${rs.map((r) => r.veredicto).join(",")}`);
    return `${rs.length} ensayos aprobados · cumple`;
  });
  await paso("B8 · Informe de inspección → firma del Jefe de Sucursal → entrega → cierre de la OT", async () => {
    const pl = lista(await ok(U.stgo, "GET", "/plantillas?limit=500"));
    C.plInspeccion = pl.find((p) => p.repid === "SCCII") ?? pl.find((p) => /inspecci/i.test(p.nombre));
    afirmar(C.plInspeccion, "no hay plantilla de informe de inspección");
    // La plantilla del dictamen de prototipos no se puede usar en otra OT.
    const proto = pl.find((p) => p.repid === "PROTO-APR");
    afirmar(proto, "falta la plantilla PROTO-APR");
    await rechazo(409, /Prototipos/i, U.stgo, "POST", "/informes/emitir", { otId: C.otPn.id, plantillaId: proto.id });
    const r = await ok(U.stgo, "POST", "/informes/emitir", { otId: C.otPn.id, plantillaId: C.plInspeccion.id, tipoDocumento: "INFORME_INSPECCION" });
    const docId = r.certificado?.id;
    const f = await firmarTodo(docId, U.stgo);
    afirmar(f.estado === "oficial", `documento ${f.estado}`);
    await ok(U.stgo, "POST", `/informes/${docId}/entregar`, { medio: "mano", destinatario: "Fabricante" });
    await exigir(403, U.stgoInsp, "POST", `/ot/${C.otPn.id}/cerrar`, {});
    const c = await ok(U.stgo, "POST", `/ot/${C.otPn.id}/cerrar`, {});
    afirmar(!c.facturaCreada, "una OT sin cobro generó factura");
    return `${r.numero} firmado (${f.hechos.join(" → ")}) · OT cerrada`;
  });
  await paso("B9 · Seguimiento: inspección ejecutada, consumo de la O/C y lote/cantidad ya no editables", async () => {
    const o = await ok(U.ventas, "GET", `/bpch/pn/oc/${C.oc.id}`);
    const l = o.programa.find((x) => x.id === C.lineaStgo.id);
    const c = o.consumo.find((x) => x.ocProductoId === C.pAnfo.id);
    afirmar(l.estado === "ejecutada" && o.resumen.ejecutadas === 1, `línea ${l.estado}`);
    afirmar(c.ejecutado === 40 && c.comprometido === 0 && c.porcentajeEjecutado === 40, `consumo ${JSON.stringify(c)}`);
    await exigir(409, U.stgo, "PATCH", `/bpch/pn/programa/${C.lineaStgo.id}`, { cantidad: 41 });
    const listaOc = lista(await ok(U.ventas, "GET", `/bpch/pn/oc?anio=${anio}&q=${encodeURIComponent(C.oc.numero)}`));
    afirmar(listaOc[0]?.programa?.ejecutadas === 1, "el listado de O/C no resume el programa");
    return `ejecutadas ${o.resumen.ejecutadas}/${o.resumen.total} · ANFO ${c.ejecutado}/${c.autorizado} t`;
  });
  await paso("B10 · Correlación con la relación de ventas: no conforme sigue el diagrama (Sucursal → DGMN → propuesta)", async () => {
    await exigir(403, U.ventas, "POST", `/bpch/pn/oc/${C.oc.id}/correlaciones`, { periodoDesde: `${anio}-01-01`, periodoHasta: `${anio}-12-31` });
    let c = await ok(U.scc, "POST", `/bpch/pn/oc/${C.oc.id}/correlaciones`, {
      periodoDesde: `${anio}-01-01`, periodoHasta: `${anio}-12-31`, relacionVentasRef: `Relación de ventas ${sello}`,
      ventas: [{ ocProductoId: C.pAnfo.id, cantidad: 50 }],
    });
    const f = c.filas.find((x) => x.ocProductoId === C.pAnfo.id);
    afirmar(f.ventas === 50 && f.inspeccionado === 40 && f.desviacion === 10 && c.sugerenciaConforme === false, `fila ${JSON.stringify(f)}`);
    await rechazo(409, /conforme/i, U.scc, "POST", `/bpch/pn/correlaciones/${c.id}/emitir-informe`);
    c = await ok(U.scc, "PATCH", `/bpch/pn/correlaciones/${c.id}`, {
      conforme: false, observaciones: "10 t vendidas sin inspección registrada.",
      requerimientoSucursal: "Remitir planillas de actividades del período.", requerimientoSucursalAt: `${anio}-${String(mes).padStart(2, "0")}-01`,
      respuestaSucursal: "Sin registro de la inspección faltante.", respondeRequerimiento: false, propuestaTecnica: "Fiscalizar el lote no inspeccionado.",
    });
    await rechazo(409, /DGMN/i, U.scc, "POST", `/bpch/pn/correlaciones/${c.id}/emitir-informe`);
    await ok(U.scc, "PATCH", `/bpch/pn/correlaciones/${c.id}`, { solicitudDgmn: "Oficio de solicitud de información técnica.", respuestaDgmn: "DGMN informa venta autorizada." });
    c = await ok(U.scc, "POST", `/bpch/pn/correlaciones/${c.id}/emitir-informe`);
    afirmar(c.estado === "emitido" && /^ITPN-\d{4}-\d{4}$/.test(c.informe?.numero ?? ""), `informe ${JSON.stringify(c.informe)}`);
    await exigir(409, U.scc, "PATCH", `/bpch/pn/correlaciones/${c.id}`, { observaciones: "cambio" });
    c = await ok(U.bpch, "POST", `/bpch/pn/correlaciones/${c.id}/remitir-dco`);
    afirmar(c.estado === "remitido", `estado ${c.estado}`);
    const html = await llamar(U.ventas, "GET", `/bpch/pn/correlaciones/${c.id}/informe`, undefined, true);
    afirmar(html.status === 200 && /INFORME TÉCNICO/.test(html.buffer.toString("utf8")) && html.buffer.toString("utf8").includes("NO CONFORME"), `informe HTML ${html.status}`);
    const pdf = await llamar(U.ventas, "GET", `/bpch/pn/correlaciones/${c.id}/informe.pdf`, undefined, true);
    afirmar(pdf.status === 200 && pdf.buffer.slice(0, 4).toString() === "%PDF", `PDF ${pdf.status}`);
    return `${c.informe.numero} remitido a DCO; Comercial lo lee`;
  });

  /* ======================================================== C. Prototipos */
  await paso("C1 · Ingreso del prototipo: sin solicitud DGMN → 400; Comercial no ve el módulo (403)", async () => {
    const cuerpo = {
      clienteId: C.fab.id, elemento: `Detonador electrónico de prueba ${sello}`, descripcionTecnica: "Retardo programable; carga base PETN.",
      fichaTecnica: "FT-001", hojaSeguridad: "HDS-001", solicitudDgmn: `SOL-PROTO-${sello}`, fechaSolicitud: `${anio}-${String(mes).padStart(2, "0")}-01`,
      grupoPropuesto: "Detonadores · electrónicos",
    };
    await exigir(400, U.sccInsp, "POST", "/bpch/prototipos", { ...cuerpo, solicitudDgmn: " " });
    await exigir(403, U.ventas, "GET", "/bpch/prototipos");
    C.proto = await ok(U.sccInsp, "POST", "/bpch/prototipos", cuerpo);
    afirmar(/^PROTO-\d{4}-\d{4}$/.test(C.proto.codigo) && C.proto.esquema === "TIPO", `alta ${C.proto.codigo}`);
    afirmar(C.proto.faltantes.generarOt.some((x) => /SAC/.test(x)), "no avisa que falta el pronunciamiento SAC");
    return `${C.proto.codigo} · ${C.proto.etapa}`;
  });
  await paso("C2 · Sin pronunciamiento SAC no hay OT (409); con él, la SCC genera la OT asignada a Santiago", async () => {
    await rechazo(409, /SAC/i, U.sccInsp, "POST", `/bpch/prototipos/${C.proto.id}/generar-ot`, { unidadId: C.unidades.SSTGO.id, conCobro: false });
    await ok(U.sccInsp, "POST", `/bpch/prototipos/${C.proto.id}/pronunciamiento-sac`, { consultaAt: `${anio}-01-02`, referencia: "Correo SAC", tamanoMuestra: 3, respuestaAt: `${anio}-01-03` });
    await exigir(400, U.sccInsp, "POST", `/bpch/prototipos/${C.proto.id}/generar-ot`, { unidadId: C.unidades.SSTGO.id });
    await exigir(403, U.antof, "POST", `/bpch/prototipos/${C.proto.id}/generar-ot`, { unidadId: C.unidades.SSTGO.id, conCobro: false });
    const r = await ok(U.sccInsp, "POST", `/bpch/prototipos/${C.proto.id}/generar-ot`, { unidadId: C.unidades.SSTGO.id, conCobro: false });
    C.otProto = r.ot;
    const ot = await ok(U.stgo, "GET", `/ot/${C.otProto.id}`);
    afirmar(ot.origenTrabajo === "PROTOTIPO" && ot.unidad?.codigo === "SSTGO" && ot.numeroLey === `SOL-PROTO-${sello}`, `OT ${ot.origenTrabajo}`);
    afirmar(r.prototipo.estado === "en_evaluacion", `estado ${r.prototipo.estado}`);
    await exigir(409, U.sccInsp, "POST", `/bpch/prototipos/${C.proto.id}/pronunciamiento-sac`, { tamanoMuestra: 4 });
    return `${C.otProto.codigo} · ${r.prototipo.etapa}`;
  });
  await paso("C3 · Flujo general en la OT del prototipo (cumple)", async () => {
    const rs = await flujoGeneral(C, C.otProto.id, { critico: 0, menor: 1 }, U.stgoInsp, U.stgo, U.bpch);
    return `${rs.length} ensayos aprobados`;
  });
  await paso("C4 · Dictamen: el inspector no dictamina (403); aprobar sin clasificación aprobada → 409", async () => {
    await exigir(403, U.sccInsp, "POST", `/bpch/prototipos/${C.proto.id}/dictamen`, { dictamen: "aprobado" });
    return await rechazo(409, /clasificación/i, U.scc, "POST", `/bpch/prototipos/${C.proto.id}/dictamen`, { dictamen: "aprobado" });
  });
  await paso("C5 · Con la clasificación aprobada, la SCC aprueba el tipo: certificado de aprobación en firma (matriz CERTIFICADO_CONFORMIDAD)", async () => {
    const p = await ok(U.sccInsp, "PATCH", `/bpch/prototipos/${C.proto.id}`, { clasificacionId: C.clas.id });
    afirmar(p.clasificacion?.id === C.clas.id && p.faltantes.aprobar.length === 0, `faltan: ${p.faltantes.aprobar.join(" | ")}`);
    const r = await ok(U.scc, "POST", `/bpch/prototipos/${C.proto.id}/dictamen`, { dictamen: "aprobado", motivo: "Cumple todas las pruebas del panel." });
    C.docProto = r.documento;
    afirmar(r.documento.estado === "en_firma" && r.documento.tipoDocumento === "CERTIFICADO_CONFORMIDAD", `documento ${JSON.stringify(r.documento)}`);
    afirmar(r.prototipo.etapa === "Aprobado · documento en firma", `etapa ${r.prototipo.etapa}`);
    await rechazo(409, /documento vigente/i, U.scc, "POST", `/bpch/prototipos/${C.proto.id}/dictamen`, { dictamen: "rechazado", motivo: "Cambio de opinión" });
    await rechazo(409, /oficial/i, U.scc, "POST", `/bpch/prototipos/${C.proto.id}/codigo-cnc`, { codigo: "E-I/21/1/2/3/4" });
    const html = await llamar(U.scc, "GET", `/informes/${C.docProto.id}/html`, undefined, true);
    const t = html.buffer.toString("utf8");
    afirmar(html.status === 200 && t.includes("APROBACIÓN DE TIPO") && t.includes(`SOL-PROTO-${sello}`) && t.includes("1.1D") && t.includes("Defecto"),
      `el certificado no trae los datos del prototipo (HTTP ${html.status})`);
    return `${r.documento.numero} · ${r.documento.pasos.length} paso(s) de firma`;
  });
  await paso("C6 · Firma, código único CNC-DGMN (formato de 6 partes), entrega y cierre de la OT", async () => {
    const f = await firmarTodo(C.docProto.id, U.scc);
    afirmar(f.estado === "oficial", `documento ${f.estado}`);
    await exigir(400, U.scc, "POST", `/bpch/prototipos/${C.proto.id}/codigo-cnc`, { codigo: "E-I/21/1433" });
    await exigir(403, U.sccInsp, "POST", `/bpch/prototipos/${C.proto.id}/codigo-cnc`, { codigo: `E-I/88/${sello.slice(-4)}/1/2/3` });
    const p = await ok(U.scc, "POST", `/bpch/prototipos/${C.proto.id}/codigo-cnc`, { codigo: `E-I/88/${sello.slice(-4)}/1/2/3` });
    afirmar(p.codigoCnc === `E-I/88/${sello.slice(-4)}/1/2/3` && p.etapa === "Aprobado · documento oficial", `etapa ${p.etapa}`);
    await ok(U.bpch, "POST", `/informes/${C.docProto.id}/entregar`, { medio: "correo", destinatario: "Fabricante" });
    await ok(U.bpch, "POST", `/ot/${C.otProto.id}/cerrar`, {});
    return `firmas ${f.hechos.join(" → ")} · código ${p.codigoCnc} · OT cerrada`;
  });
  await paso("C7 · Segundo prototipo que NO cumple: no se aprueba (409); rechazo con motivo → informe de rechazo (INFORME_INCUMPLIMIENTO)", async () => {
    let p = await ok(U.scc, "POST", "/bpch/prototipos", { clienteId: C.fab.id, elemento: `Cordón de prueba ${sello}`, solicitudDgmn: `SOL-PROTO-B-${sello}` });
    await ok(U.scc, "POST", `/bpch/prototipos/${p.id}/pronunciamiento-sac`, { tamanoMuestra: 2 });
    const r = await ok(U.scc, "POST", `/bpch/prototipos/${p.id}/generar-ot`, { unidadId: C.unidades.SSTGO.id, conCobro: false });
    await flujoGeneral(C, r.ot.id, { critico: 1, menor: 0 }, U.stgoInsp, U.stgo, U.bpch);
    await ok(U.scc, "PATCH", `/bpch/prototipos/${p.id}`, { clasificacionId: C.clas.id });
    await rechazo(409, /no cumplen/i, U.scc, "POST", `/bpch/prototipos/${p.id}/dictamen`, { dictamen: "aprobado" });
    await rechazo(409, /motivo/i, U.scc, "POST", `/bpch/prototipos/${p.id}/dictamen`, { dictamen: "rechazado" });
    // Revisión r3 (hallazgo 11): dos dictámenes simultáneos (doble clic) no emiten dos documentos.
    const dobles = await Promise.all([U.scc, U.scc].map((u) =>
      llamar(u, "POST", `/bpch/prototipos/${p.id}/dictamen`, { dictamen: "rechazado", motivo: "Defecto crítico en la inspección visual." })));
    const estados = dobles.map((r) => r.status).sort();
    afirmar(estados[0] >= 200 && estados[0] < 300 && estados[1] === 409, `dictámenes simultáneos → ${estados.join(", ")}`);
    const d = dobles.find((r) => r.status < 300).json;
    afirmar(d.documento.tipoDocumento === "INFORME_INCUMPLIMIENTO" && d.prototipo.dictamen === "rechazado", `documento ${JSON.stringify(d.documento)}`);
    const tras = await ok(U.scc, "GET", `/bpch/prototipos/${p.id}`);
    afirmar(tras.documento?.id === d.documento.id, "el prototipo no quedó con el documento del dictamen que se aceptó");
    await rechazo(409, /aprobado/i, U.scc, "POST", `/bpch/prototipos/${p.id}/codigo-cnc`, { codigo: "E-I/1/2/3/4/5" });
    p = await ok(U.sccInsp2, "GET", `/bpch/prototipos/${p.id}`);
    return `${p.codigo} · ${p.etapa} · ${d.documento.numero}`;
  });
  await paso("C8 · Listados: prototipos y clasificaciones vigentes", async () => {
    const ps = lista(await ok(U.sccInsp2, "GET", `/bpch/prototipos?q=${encodeURIComponent(sello)}`));
    afirmar(ps.length === 2, `prototipos encontrados ${ps.length}`);
    const vig = lista(await ok(U.sccInsp2, "GET", `/bpch/clasificaciones?vigentes=1&q=${encodeURIComponent(sello)}`));
    afirmar(vig.length === 1 && vig[0].id === C.clas.id, `vigentes ${vig.length}`);
    const det = await ok(U.sccInsp2, "GET", `/bpch/clasificaciones/${C.clas.id}`);
    afirmar(det.usos.prototipos.length === 2, `usos en prototipos ${det.usos.prototipos.length}`);
    return `${ps.length} prototipos · ${vig.length} clasificación vigente usada en ${det.usos.prototipos.length} prototipos y ${det.usos.productosPn.length} producto(s)`;
  });
}

main()
  .then(() => {
    console.log(`\nRecorrido BPCH (Producción Nacional, Prototipos, Clasificación): ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
