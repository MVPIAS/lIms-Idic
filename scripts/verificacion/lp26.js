#!/usr/bin/env node
/**
 * Frente lp26 · Lista de precios oficial 2026 del IDIC y fórmula del precio.
 * Comprueba por API, con perfiles demo.* que pueden y que no:
 *
 *   · La «Lista de precios 2026» (LP-2026) vigente con 618 servicios y su
 *     estructura de costos: EN1214 → neto 514.519 y particular 612.278;
 *     EN412 → 59.518 / 70.827; centros de costo que no existen en el LIMS.
 *   · Parámetros de la fórmula oficial: CI 20 %, recargo 30 %, IVA 19 %.
 *   · Cotización a un cliente particular: el precio unitario sale del neto de
 *     la lista vigente (no de la ficha); un precio distinto se rechaza.
 *   · Cliente Ejército: por defecto la ficha; con «precio_ejercito = costo_total»
 *     el costo total de la lista (y se restituye).
 *   · FORM05 y simulador de costeo reproducen las cifras de la lista.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/lp26.js [--arrancar] [--base http://localhost:4881/api]
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja datos de prueba
 * ficticios: úsese en una base de pruebas. Se puede correr varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4881/api");
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
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: CLAVE }),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
    sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id ?? carga.sub };
    return sesiones[username];
  }
  throw new Error(`login ${username}: demasiados intentos`);
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = username ? await login(username) : null;
  const esForm = typeof FormData !== "undefined" && cuerpo instanceof FormData;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
      ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}),
    },
    body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json, tipo: r.headers.get("content-type") ?? "" };
}
const msg = (j) =>
  (typeof j === "string"
    ? j
    : j?.message
      ? `${Array.isArray(j.message) ? j.message.join("; ") : j.message}${Array.isArray(j.issues) ? ` · ${j.issues.map((i) => i.message).join("; ")}` : ""}`
      : JSON.stringify(j)
  ).slice(0, 400);
async function exigir(esperado, username, metodo, ruta, cuerpo, patron) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  if (patron && !patron.test(msg(r.json))) throw new Error(`${username} ${metodo} ${ruta}: el mensaje «${msg(r.json)}» no dice ${patron}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

/* -------------------------------------------------------------- informe --- */
const pasos = [];
let actual = null;
async function paso(nombre, fn) {
  const t0 = Date.now();
  actual = nombre;
  try {
    const detalle = await fn();
    pasos.push({ nombre, ok: true });
    console.log(`  OK    ${nombre}${detalle ? ` · ${detalle}` : ""} (${Date.now() - t0} ms)`);
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
    try { const r = await fetch(`${BASE}/health`); if (r.status < 500) return; } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`La API no respondió en ${BASE}`);
}
function arrancarApi() {
  if (!process.env.DATABASE_URL) throw new Error("--arrancar necesita DATABASE_URL");
  const puerto = new URL(BASE).port || "4881";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4882",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-lp26-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  ventas: "demo.ventas", // cotizacion.crear / .ver
  lqcJefe: "demo.lqc.jefe", // cotizacion.costear (FORM05 de LQC)
  calidad: "demo.calidad", // parámetros con alcance global; sin cotizacion.ver
  a1: "demo.lqc.analista1", // sin cotizacion.ver
};
const CONF = "/parametros/configurables";
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
const PRECIOS = {
  EN1214: { costoDirecto: 329820, costoIndirecto: 65964, costoTotal: 395784, recargo: 118735, neto: 514519, iva: 97759, precioIvaIncluido: 612278 },
  EN412: { costoDirecto: 38153, costoIndirecto: 7631, costoTotal: 45783, recargo: 13735, neto: 59518, iva: 11309, precioIvaIncluido: 70827 },
  EN1032: { neto: 618324, costoTotal: 475634, precioIvaIncluido: 735806 },
  EN803: { neto: 957, precioIvaIncluido: 1139 },
};

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(4, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  await paso("Comercial › Listas de precio: «Lista de precios 2026» (LP-2026) vigente con 618 servicios", async () => {
    const listas = lista(await ok(U.ventas, "GET", "/listas-precio?limit=100"));
    C.lista = listas.find((l) => l.codigo === "LP-2026");
    afirmar(C.lista, "no está la lista LP-2026");
    afirmar(
      C.lista.nombre === "Lista de precios 2026" && String(C.lista.vigenteDesde).startsWith("2026-01-01") && String(C.lista.vigenteHasta).startsWith("2026-12-31"),
      JSON.stringify({ ...C.lista, items: undefined }),
    );
    await exigir(403, U.a1, "GET", `/listas-precio/${C.lista.id}/detalle`);
    await exigir(403, U.calidad, "GET", `/listas-precio/${C.lista.id}/detalle`);
    const d = await ok(U.ventas, "GET", `/listas-precio/${C.lista.id}/detalle?limit=1`);
    afirmar(d.resumen.items === 618 && d.meta.total === 618, `ítems ${d.resumen.items}`);
    afirmar(d.resumen.enlazados >= 120 && d.resumen.sinEnlace === 618 - d.resumen.enlazados, `enlazados ${d.resumen.enlazados}`);
    for (const c of ["CDOSECALI", "CDOSECAYM", "DCO", "SMU", "#N/D"])
      afirmar(d.resumen.centrosSinCentroCosto.includes(c), `falta ${c} entre los centros sin centro de costo: ${d.resumen.centrosSinCentroCosto}`);
    afirmar(!d.resumen.centrosSinCentroCosto.includes("LPN"), "LPN figura sin centro de costo");
    await exigir(400, U.ventas, "GET", `/listas-precio/${C.lista.id}/detalle?enlace=x`);
    await exigir(404, U.ventas, "GET", `/listas-precio/00000000-0000-4000-8000-000000000000/detalle`);
    return `${d.resumen.items} servicios · ${d.resumen.enlazados} enlazados · sin centro de costo: ${d.resumen.centrosSinCentroCosto.join(", ")}`;
  });

  await paso("Precios concretos por API: EN1214, EN412, EN1032 y EN803 con toda su estructura", async () => {
    const out = [];
    for (const [codigo, esperado] of Object.entries(PRECIOS)) {
      const d = await ok(U.ventas, "GET", `/listas-precio/${C.lista.id}/detalle?q=${encodeURIComponent(codigo)}&limit=50`);
      const it = d.data.find((x) => x.codigo === codigo);
      afirmar(it, `${codigo} no está en la lista`);
      for (const [k, v] of Object.entries(esperado)) afirmar(it[k] === v, `${codigo}.${k} = ${it[k]} (esperado ${v})`);
      afirmar(it.precio === it.neto, `${codigo}: precio ${it.precio} ≠ neto ${it.neto}`);
      C[codigo] = it;
      out.push(`${codigo} ${it.neto}/${it.precioIvaIncluido}`);
    }
    afirmar(C.EN412.catEnsayoCodigo === "957" && C.EN412.enlace === "nombre_base" && C.EN412.centroCostoCodigo === "LEM-001", `EN412 ${JSON.stringify(C.EN412)}`);
    afirmar(C.EN1032.enlace === "codigo" && C.EN1032.catEnsayoCodigo === "EN1032" && C.EN1032.centroCostoCodigo === "LNF-001", `EN1032 ${JSON.stringify(C.EN1032)}`);
    afirmar(!C.EN1214.catEnsayoId && C.EN1214.centroCostoCodigo === "LRB-001", `EN1214 ${JSON.stringify(C.EN1214)}`);
    afirmar(C.EN803.centroOrigen === "LVM" && C.EN803.centroCostoCodigo === "SVM-001", `EN803 ${JSON.stringify(C.EN803)}`);
    const sinEnlace = await ok(U.ventas, "GET", `/listas-precio/${C.lista.id}/detalle?enlace=no&centro=LRB&limit=50`);
    afirmar(sinEnlace.meta.total === 12 && sinEnlace.data.every((x) => !x.catEnsayoId), `LRB sin enlace ${sinEnlace.meta.total}`);
    return out.join(" · ");
  });

  await paso("Parámetros de la fórmula oficial: CI 20 %, recargo 30 %, IVA 19 %, Ejército «ficha»", async () => {
    const d = await ok(U.calidad, "GET", CONF);
    const g = d.grupos.find((x) => x.categoria === "circuito_cotizacion");
    const v = Object.fromEntries(g.parametros.map((p) => [p.codigo, p.valor]));
    afirmar(String(v.cfa_pct) === "20" && String(v.margen_particular_pct) === "30" && String(v.iva_pct) === "19" && v.precio_ejercito === "ficha", JSON.stringify(v));
    return `cfa_pct ${v.cfa_pct} · margen_particular_pct ${v.margen_particular_pct} · iva_pct ${v.iva_pct} · precio_ejercito ${v.precio_ejercito}`;
  });

  await paso("Preparación · clientes particular y Ejército, ensayos EN412 (957) y EN1032 del catálogo", async () => {
    const base = 77000000 + (Number(sello.slice(-6)) % 999999);
    C.part = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Cliente Particular lp26 ${sello}`, tipo: "particulares", giro: "Pruebas", direccion: "Calle 1" });
    C.ejer = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base + 1), razonSocial: `Unidad Ejército lp26 ${sello}`, tipo: "ejercito", giro: "Ejército", direccion: "Calle 2" });
    C.e957 = { id: C.EN412.catEnsayoId };
    C.e1032 = { id: C.EN1032.catEnsayoId };
    const cat = lista(await ok(U.ventas, "GET", "/cat/ensayos?search=EN1032&limit=10")).find((e) => e.codigo === "EN1032");
    afirmar(cat && Number(cat.precio) === 735806, `ficha EN1032 ${cat?.precio}`);
    const ccs = (await ok(U.ventas, "GET", "/cotizaciones/config")).centrosCosto;
    C.ccLem = ccs.find((c) => c.codigo === "LEM-001");
    return `clientes ${C.part.id.slice(0, 8)} / ${C.ejer.id.slice(0, 8)} · ficha EN1032 ${cat.precio}`;
  });

  await paso("Vista previa del precio: particular → neto de la lista; Ejército → ficha; sin cotizacion.ver 403", async () => {
    const ids = `${C.e957.id},${C.e1032.id}`;
    await exigir(403, U.a1, "GET", `/cotizaciones/precios-ensayo?clienteId=${C.part.id}&ids=${ids}`);
    await exigir(400, U.ventas, "GET", `/cotizaciones/precios-ensayo?clienteId=x&ids=${ids}`);
    const p = await ok(U.ventas, "GET", `/cotizaciones/precios-ensayo?clienteId=${C.part.id}&ids=${ids}`);
    afirmar(p.regla === "PARTICULAR", `regla ${p.regla}`);
    afirmar(p.precios[C.e957.id].precio === 59518 && p.precios[C.e957.id].origen === "lista" && p.precios[C.e957.id].lista.itemCodigo === "EN412", JSON.stringify(p.precios[C.e957.id]));
    afirmar(p.precios[C.e1032.id].precio === 618324 && p.precios[C.e1032.id].origen === "lista", JSON.stringify(p.precios[C.e1032.id]));
    const e = await ok(U.ventas, "GET", `/cotizaciones/precios-ensayo?clienteId=${C.ejer.id}&ids=${ids}`);
    afirmar(e.regla === "EJERCITO" && e.precios[C.e1032.id].precio === 735806 && e.precios[C.e1032.id].origen === "ficha", JSON.stringify(e));
    return `particular EN412 ${p.precios[C.e957.id].precio} · EN1032 ${p.precios[C.e1032.id].precio} · Ejército EN1032 ${e.precios[C.e1032.id].precio} (ficha)`;
  });

  await paso("Cotización particular: el precio unitario sale de la lista 2026; la ficha o un precio a mano se rechazan", async () => {
    const cab = { clienteId: C.part.id, formato: "NORMAL", centroCostoId: C.ccLem?.id ?? null, plazoEntregaDias: 10 };
    await exigir(400, U.ventas, "POST", "/cotizaciones", { ...cab, lineas: [{ catEnsayoId: C.e1032.id, cantidad: 1, precioUnitario: 735806 }] }, /lista de precios vigente/);
    await exigir(403, U.a1, "POST", "/cotizaciones", { ...cab, lineas: [{ catEnsayoId: C.e957.id, cantidad: 1 }] });
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", { ...cab, lineas: [{ catEnsayoId: C.e957.id, cantidad: 2, precioUnitario: 59518 }, { catEnsayoId: C.e1032.id, cantidad: 1 }] });
    const l957 = C.cot.lineas.find((l) => l.catEnsayoId === C.e957.id);
    const l1032 = C.cot.lineas.find((l) => l.catEnsayoId === C.e1032.id);
    afirmar(Number(l957.precioUnitario) === 59518 && Number(l957.subtotal) === 119036, `EN412 ${l957.precioUnitario} × 2 = ${l957.subtotal}`);
    afirmar(Number(l1032.precioUnitario) === 618324, `EN1032 ${l1032.precioUnitario}`);
    afirmar(Number(C.cot.subtotal) === 119036 + 618324, `subtotal ${C.cot.subtotal}`);
    // Al editar, la línea ya cotizada conserva su precio.
    const ed = await ok(U.ventas, "PATCH", `/cotizaciones/${C.cot.id}`, { lineas: [{ catEnsayoId: C.e957.id, cantidad: 3, precioUnitario: 59518 }] });
    afirmar(Number(ed.lineas[0].precioUnitario) === 59518 && Number(ed.lineas[0].subtotal) === 178554, `edición ${JSON.stringify(ed.lineas[0])}`);
    return `${C.cot.codigo}: EN412 59.518 × 3 · EN1032 618.324 (neto de la lista; la ficha dice 735.806)`;
  });

  await paso("Cotización Ejército: ficha por defecto; con precio_ejercito = costo_total toma el CT de la lista (y se restituye)", async () => {
    const cab = { clienteId: C.ejer.id, formato: "NORMAL", plazoEntregaDias: 10 };
    const a = await ok(U.ventas, "POST", "/cotizaciones", { ...cab, lineas: [{ catEnsayoId: C.e1032.id, cantidad: 1 }] });
    afirmar(Number(a.lineas[0].precioUnitario) === 735806, `Ejército con ficha ${a.lineas[0].precioUnitario}`);
    await exigir(403, U.ventas, "PUT", `${CONF}/circuito_cotizacion/precio_ejercito`, { valor: "costo_total", motivo: "Comercial no puede" });
    await exigir(400, U.calidad, "PUT", `${CONF}/circuito_cotizacion/precio_ejercito`, { valor: "otro", motivo: "Opción que no existe" });
    await ok(U.calidad, "PUT", `${CONF}/circuito_cotizacion/precio_ejercito`, { valor: "costo_total", motivo: "Prueba lp26: precio Ejército = costo total" });
    try {
      const b = await ok(U.ventas, "POST", "/cotizaciones", { ...cab, lineas: [{ catEnsayoId: C.e1032.id, cantidad: 1 }] });
      afirmar(Number(b.lineas[0].precioUnitario) === 475634, `Ejército con costo total ${b.lineas[0].precioUnitario}`);
    } finally {
      await ok(U.calidad, "PUT", `${CONF}/circuito_cotizacion/precio_ejercito`, { valor: "ficha", motivo: "Restituye el valor por defecto tras el recorrido lp26" });
    }
    return "ficha 735.806 · costo total 475.634 · restituido «ficha»";
  });

  await paso("FORM05 (LQC) con la fórmula oficial: servicio EN1214 (CD 329.820) → neto 514.519 y particular 612.278", async () => {
    const lqc = (await ok(U.ventas, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQC");
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/solicitudes-laboratorio`, { unidadId: lqc.id, tipoServicio: "no_estandar", comentario: "Costeo lp26" });
    const sid = (await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}/circuito`)).solicitudes.find((s) => s.unidadCodigo === "LQC").id;
    const costeo = { servicios: [{ codigo: "EN1214", descripcion: "Resistencia balística a probeta", cantidad: 1, valorUnitario: 329820 }] };
    const programa = { plazoEntregaDias: 10, etapas: [{ actividad: "Ensayo" }] };
    await exigir(403, U.a1, "POST", `/cotizaciones/solicitudes-laboratorio/${sid}/responder`, { respuesta: "aceptar", programa, costeo });
    const x = await ok(U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${sid}/responder`, { respuesta: "aceptar", programa, costeo });
    const e = x.resultado;
    const obtenido = [e.cdt, e.cfa, e.ct, e.recargo, e.precioParticular, e.iva, e.precioParticularIvaIncluido];
    const esperado = Object.values(PRECIOS.EN1214);
    afirmar(JSON.stringify(obtenido) === JSON.stringify(esperado), `FORM05 ${obtenido} ≠ ${esperado}`);
    afirmar(e.cfaPct === 20 && e.margenParticularPct === 30 && e.ivaPct === 19 && e.precioEjercito === 395784, JSON.stringify(e));
    return `CDT ${e.cdt} · CI ${e.cfa} · CT ${e.ct} · recargo ${e.recargo} · neto ${e.precioParticular} · IVA ${e.iva} · ${e.precioParticularIvaIncluido}`;
  });

  await paso("Simulador de costeo con los parámetros vigentes: EN1150 (CD 264.275) → CT 317.130 y neto 412.269", async () => {
    await exigir(403, U.a1, "POST", "/cotizaciones/costeo", { lineas: [{ tipo: "otros", cantidad: 1, valorUnitario: 264275 }] });
    const s = await ok(U.ventas, "POST", "/cotizaciones/costeo", { lineas: [{ tipo: "otros", cantidad: 1, valorUnitario: 264275 }] });
    afirmar(s.cfa === 52855 && s.ct === 317130 && s.precios.ejercito === 317130 && s.precios.particular === 412269, JSON.stringify(s));
    return `CI ${s.cfa} · CT ${s.ct} · particular ${s.precios.particular}`;
  });
}

main()
  .then(() => {
    console.log(`\nFrente lp26: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
