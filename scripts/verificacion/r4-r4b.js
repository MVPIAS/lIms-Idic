#!/usr/bin/env node
/**
 * Frente r4b · Delegación Nº 11 (EP-11) y documentos BPCH (EP-08/09/10).
 * Recorre de punta a punta, con perfiles demo.* que pueden y que no:
 *
 *   11.1  Comercial registra la internación con el LISTADO DE ARMAS de la
 *         resolución (carga masiva desde planilla .csv/.xlsx); solo con la D11.
 *   11.3  La SCC completa el análisis técnico → OT de la D11.
 *   11.41 Compartimento D11: Lector/Auditor en solo lectura; Comercial y otro
 *         laboratorio, 403.
 *   11.4–11.6  Programación (Jefe D11), aviso de llegada y acta con conteo
 *         contra la resolución (armero).
 *   11.8  Catálogos (marca con país, modelo, calibre) y registro de cada arma
 *         como MUESTRA de la OT; serie normalizada única por OT; tope del acta.
 *   11.7  Etiquetas con código de barras y primer movimiento de custodia.
 *   11.9  Verificación contra la resolución (concuerda).
 *   11.11/11.12  Clasificación IT05 y camino: CIP / prueba completa / prohibida.
 *   BL-038 Captura sin valores por defecto (grupo incompleto → 400).
 *   11.21 Revisión y aprobación del flujo general (revisor ≠ aprobador).
 *   11.22 Acuñación IT08 (solo prueba completa que cumple).
 *   11.23 Certificados por arma en bloque (rango), firma del rango según la
 *         matriz (11.42), vigencia de 4 años y verificación pública con QR.
 *   11.27 Entrega por código de barras con guía; cierre de la OT.
 *   9.16  Listado oficial de Codificación Única en PDF/Excel por fabricante.
 *   10.15 Notificación a DGMN (estado de la OT).
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r4-r4b.js [--arrancar] [--base http://localhost:4841/api]
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja datos de prueba
 * ficticios (Importador Prueba, Marca Prueba, serie PRUEBA…): úsese en una base
 * de pruebas. Se puede correr varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4841/api");
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
    // R4B_HASTA="11.11" deja la OT a medio camino (para recorrerla en el navegador).
    if (process.env.R4B_HASTA && nombre.startsWith(process.env.R4B_HASTA)) {
      console.log(`
Detenido tras «${nombre}» (R4B_HASTA).`);
      pararApi();
      process.exit(0);
    }
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
  const puerto = new URL(BASE).port || "4841";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4842",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r4-r4b-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  ventas: "demo.ventas",
  scc: "demo.scc.jefe",
  d11Jefe: "demo.d11.jefe",
  armero: "demo.d11.inspector1",
  armero2: "demo.d11.inspector2",
  bpch: "demo.bpch.jefe",
  auditor: "demo.auditor",
  admin: "demo.admin",
  otroLab: "demo.lqc.analista1",
  planif: "demo.planificacion",
  director: "demo.director",
  lrb: "demo.lrb.analista1",
  lam: "demo.lam.analista1",
};
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
function planilla(nombre, texto) {
  const f = new FormData();
  f.append("archivo", new Blob([texto], { type: "text/csv" }), nombre);
  return f;
}
async function catalogo(C) {
  C.cat = await ok(U.armero, "GET", "/d11/catalogos");
  return C.cat;
}

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(4, 14);
  const S = (n) => `PRUEBA${sello.slice(-6)}${n}`;

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  /* --------------------------------------------- 11.1 · internación con listado */
  await paso("11.1 · Comercial registra la internación con el listado de armas (solo si inspecciona la D11)", async () => {
    C.cfg = await ok(U.ventas, "GET", "/bpch/config");
    C.d11 = C.cfg.unidades.find((u) => u.codigo === "D11");
    C.sstgo = C.cfg.unidades.find((u) => u.codigo === "SSTGO");
    afirmar(C.d11, "la D11 no figura entre las unidades que inspeccionan");
    const base = 77000000 + (Number(sello.slice(-6)) % 999999);
    C.importador = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Importador Prueba ${sello}`, tipo: "particulares" });
    // Carga masiva del listado: la planilla se lee y se revisa antes de guardar.
    const leida = await ok(U.ventas, "POST", "/bpch/resolucion-armas/leer", planilla("listado.csv",
      `Tipo;Marca;Modelo;Calibre;Nº de serie;Accesorios\nPistola;Marca Prueba;Pistola Prueba;9 × 19 mm;${S(1)};2 cargadores\n` +
      `Pistola;Marca Prueba;Pistola Prueba;9 × 19 mm;${S(2)};2 cargadores\nRevólver;Marca Prueba;Revólver Prueba;.38 Special;${S(3)};\nCañón;X;;;;\n`));
    afirmar(leida.filas.length === 3 && leida.errores.length === 1 && /Fila 5/.test(leida.errores[0]), `planilla: ${JSON.stringify(leida.errores)}`);
    await exigir(403, U.otroLab, "POST", "/bpch/resolucion-armas/leer", planilla("x.csv", "tipo;marca\nPistola;M\n"));
    const armas = leida.filas.map((f) => ({ tipo: f.tipo, marca: f.marca, modelo: f.modelo, calibre: f.calibre, serie: f.serie, accesorios: f.accesorios || null, cantidad: 1 }));
    const cuerpo = {
      resolucionNumero: `02/030/2026/${sello.slice(-4)}`, resolucionFecha: hoyCl(), clienteId: C.importador.id, esquema: "LOTES",
      unidadInspeccionId: C.d11.id, sujetaTasa: false, items: [], armas,
    };
    // El listado de armas solo corresponde cuando inspecciona la D11.
    await exigir(400, U.ventas, "POST", "/bpch/internaciones", { ...cuerpo, unidadInspeccionId: C.sstgo.id }, /Delegación Nº 11/);
    // Serie repetida en el listado → 400.
    await exigir(400, U.ventas, "POST", "/bpch/internaciones", { ...cuerpo, armas: [...armas, armas[0]] }, /se repite/);
    C.int = await ok(U.ventas, "POST", "/bpch/internaciones", cuerpo);
    afirmar(C.int.armas.length === 3, `listado guardado: ${C.int.armas.length}`);
    return `${C.int.numero} · ${C.int.armas.length} armas según resolución`;
  });

  await paso("11.3 · La SCC completa el análisis técnico → OT de la Delegación Nº 11", async () => {
    C.int = await ok(U.scc, "POST", `/bpch/internaciones/${C.int.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoyCl() });
    afirmar(C.int.otId, "no se generó la OT");
    C.otId = C.int.otId;
    return `OT ${C.int.estadoOt?.ot?.codigo ?? C.otId}`;
  });

  /* --------------------------------------------- 11.41 · compartimento D11 */
  await paso("11.41 · Compartimento D11: auditor en solo lectura; Comercial, Administración y otro laboratorio no entran", async () => {
    const l = lista(await ok(U.armero, "GET", "/d11/ot"));
    afirmar(l.some((o) => o.id === C.otId), "la OT no aparece en la lista de la D11");
    const e = await ok(U.auditor, "GET", `/d11/ot/${C.otId}`);
    afirmar(e.puedo.registrar === false && e.puedo.emitir === false, "el auditor no debería poder actuar");
    await exigir(403, U.auditor, "PUT", `/d11/ot/${C.otId}/llegada`, { fecha: hoyCl(), transportista: "x", bultos: 1, avisoPrevio: true });
    await exigir(403, U.ventas, "GET", `/d11/ot/${C.otId}`);
    await exigir(403, U.admin, "GET", "/d11/ot");
    await exigir(403, U.otroLab, "GET", `/d11/ot/${C.otId}`);
    return `paso actual: ${e.avance.pasos[e.avance.actual - 1].titulo}`;
  });

  /* --------------------------------------------- 11.4 · 11.5 · 11.6 */
  await paso("11.4 · Programar la recepción (Jefe D11; el armero no)", async () => {
    const e0 = await ok(U.d11Jefe, "GET", `/d11/ot/${C.otId}`);
    C.armeroId = (await login(U.armero)).id;
    afirmar(e0.personal.some((p) => p.id === C.armeroId), "el armero no figura como personal de la D11");
    await exigir(409, U.armero, "PUT", `/d11/ot/${C.otId}/llegada`, { fecha: hoyCl(), transportista: "Transportes Prueba", bultos: 2, avisoPrevio: true }, /Primero programe/);
    await exigir(403, U.armero, "PUT", `/d11/ot/${C.otId}/programacion`, { fecha: hoyCl(), lugar: "Arsenal de prueba", responsableId: C.armeroId });
    await exigir(400, U.d11Jefe, "PUT", `/d11/ot/${C.otId}/programacion`, { fecha: "2020-01-01", lugar: "Arsenal de prueba", responsableId: C.armeroId }, /anterior a hoy/);
    await exigir(400, U.d11Jefe, "PUT", `/d11/ot/${C.otId}/programacion`, { fecha: hoyCl(), lugar: "Arsenal de prueba", responsableId: (await login(U.ventas)).id }, /personal de la Delegación/);
    const e = await ok(U.d11Jefe, "PUT", `/d11/ot/${C.otId}/programacion`, { fecha: hoyCl(), lugar: "Arsenal de prueba", responsableId: C.armeroId });
    afirmar(e.avance.pasos[0].estado === "hecho" && e.avance.actual === 2, "la programación no avanzó el expediente");
    return `${e.expediente.programacion.lugar} · le toca: ${e.avance.pasos[1].leToca}`;
  });

  await paso("11.5 / 11.6 · Aviso de llegada y acta de recepción con conteo contra la resolución", async () => {
    await exigir(409, U.armero, "POST", `/d11/ot/${C.otId}/acta`, { bultos: 1, cantidad: 3, ubicacion: "Bodega D11 · estante 1", responsableId: C.armeroId }, /llegada/);
    await ok(U.armero, "PUT", `/d11/ot/${C.otId}/llegada`, { fecha: hoyCl(), transportista: "Transportes Prueba", bultos: 1, avisoPrevio: true });
    const e = await ok(U.armero, "POST", `/d11/ot/${C.otId}/acta`, { bultos: 1, cantidad: 3, ubicacion: "Bodega D11 · estante 1", responsableId: C.armeroId });
    afirmar(e.expediente.acta.resultado === "concuerda" && e.expediente.acta.segunResolucion === 3, `acta ${JSON.stringify(e.expediente.acta)}`);
    await exigir(409, U.armero, "POST", `/d11/ot/${C.otId}/acta`, { bultos: 1, cantidad: 2, ubicacion: "Bodega D11", responsableId: C.armeroId }, /ya está firmada/);
    return `acta: ${e.expediente.acta.cantidad} recibidas · ${e.expediente.acta.resultado}`;
  });

  /* --------------------------------------------- 11.8 · catálogo y registro */
  await paso("11.8 · Catálogo del arma: el armero añade marca, modelo y calibre; solo la jefatura los corrige", async () => {
    let cat = await catalogo(C);
    afirmar(cat.marcas.length > 100, `marcas sembradas: ${cat.marcas.length}`);
    afirmar(cat.calibres.some((c) => c.nombre === "9 × 19 mm"), "falta el calibre 9 × 19 mm");
    let marca = cat.marcas.find((m) => m.nombre === "Marca Prueba" && m.pais === "País Prueba");
    if (!marca) marca = await ok(U.armero, "POST", "/d11/catalogos/marcas", { nombre: "Marca Prueba", pais: "País Prueba" });
    await exigir(409, U.armero, "POST", "/d11/catalogos/marcas", { nombre: "MARCA PRUEBA", pais: "país prueba" }, /ya existe/);
    cat = await catalogo(C);
    const modelo = async (nombre) =>
      cat.modelos.find((m) => m.marcaId === marca.id && m.nombre === nombre) ?? (await ok(U.armero, "POST", "/d11/catalogos/modelos", { marcaId: marca.id, nombre }));
    C.marca = marca;
    C.modeloP = await modelo("Pistola Prueba");
    C.modeloR = await modelo("Revólver Prueba");
    C.cal9 = cat.calibres.find((c) => c.nombre === "9 × 19 mm");
    C.cal38 = cat.calibres.find((c) => c.nombre === ".38 Special");
    await exigir(403, U.armero, "PATCH", `/d11/catalogos/marcas/${marca.id}`, { activo: true, pais: "País Prueba" });
    await ok(U.d11Jefe, "PATCH", `/d11/catalogos/marcas/${marca.id}`, { activo: true, pais: "País Prueba" });
    await exigir(403, U.auditor, "POST", "/d11/catalogos/calibres", { nombre: "Calibre prueba" });
    return `${cat.marcas.length} marcas · ${cat.calibres.length} calibres`;
  });

  await paso("11.8 · Carga masiva: la planilla del importador propone el catálogo de cada fila", async () => {
    const r = await ok(U.armero, "POST", "/d11/planilla", planilla("importador.csv",
      `Tipo de arma,Marca,Modelo,Calibre,Serie,País de origen\nPistola,Marca Prueba,Pistola Prueba,9 × 19 mm,${S(1)},País Prueba\n`));
    afirmar(r.filas[0].marcaId === C.marca.id && r.filas[0].modeloId === C.modeloP.id && r.filas[0].calibreId === C.cal9.id, `propuesta ${JSON.stringify(r.filas[0])}`);
    await exigir(400, U.armero, "POST", "/d11/planilla", planilla("x.xls", "nada"), /97-2003/);
    await exigir(403, U.auditor, "POST", "/d11/planilla", planilla("x.csv", "tipo;marca\n"));
    return `${r.filas.length} fila · columnas ${r.columnas.join(", ")}`;
  });

  await paso("11.8 · Registrar cada arma como muestra de la OT (serie única, tope del acta, IT05 cargado)", async () => {
    const e0 = await ok(U.armero, "GET", `/d11/ot/${C.otId}`);
    const arma = (serie, i, p = {}) => ({
      resolucionArmaId: e0.listado[i].id, tipo: i === 2 ? "revolver" : "pistola", marcaId: C.marca.id,
      modeloId: i === 2 ? C.modeloR.id : C.modeloP.id, calibreId: i === 2 ? C.cal38.id : C.cal9.id,
      paisOrigen: "País Prueba", serie, accesorios: i < 2 ? "2 cargadores" : null, ...p,
    });
    const tres = [arma(S(1), 0), arma(`${S(2).slice(0, 6)}-${S(2).slice(6)}`, 1), arma(S(3), 2)];
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/armas`, { armas: [...tres, arma(S(4), 2)] }, /acta registra 3/);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/armas`, { armas: [tres[0], { ...tres[1], serie: S(1).toLowerCase() }] }, /se repite/);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/armas`, { armas: [{ ...tres[0], serie: null }] }, /sin número de serie/);
    await exigir(403, U.auditor, "POST", `/d11/ot/${C.otId}/armas`, { armas: tres });
    const e = await ok(U.armero, "POST", `/d11/ot/${C.otId}/armas`, { armas: tres });
    afirmar(e.armas.length === 3, `armas registradas ${e.armas.length}`);
    afirmar(e.armas.every((a) => a.ensayos >= 1 && a.codigoBarras === a.muestra), "cada arma debe ser muestra con su código y el IT05");
    afirmar(e.verificacion.concuerda, `verificación: ${JSON.stringify(e.verificacion.diferencias)}`);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/armas`, { armas: [arma(S(1), 0)] }, /ya está registrada|acta registra/);
    C.armas = e.armas;
    return `${e.armas.map((a) => a.muestra).join(", ")} · verificación: concuerda`;
  });

  await paso("11.7 · Etiquetas con código de barras y primer movimiento de custodia", async () => {
    const r = await llamar(U.armero, "GET", `/d11/ot/${C.otId}/etiquetas`);
    afirmar(r.status === 200 && /text\/html/.test(r.tipo) && String(r.json).includes("<svg") && String(r.json).includes(C.armas[0].muestra), "etiquetas sin código de barras");
    const f = await ok(U.armero, "GET", `/d11/armas/${C.armas[0].id}`);
    afirmar(f.movimientos.length === 1 && f.movimientos[0].evento === "entrada", "falta la entrada en custodia");
    const m = await ok(U.armero, "POST", `/d11/armas/${C.armas[0].id}/movimientos`, { evento: "cambio_ubicacion", ubicacion: "Bodega D11 · estante 2", motivo: "Reordenamiento de bodega" });
    afirmar(m.movimientos.length === 2, "no quedó el cambio de ubicación");
    await exigir(400, U.armero, "POST", `/d11/armas/${C.armas[0].id}/movimientos`, { evento: "cambio_ubicacion", ubicacion: "x2", motivo: "no" });
    return `${f.movimientos[0].ubicacion} → ${m.movimientos[1].ubicacion}`;
  });

  /* --------------------------------------------- 11.11 · 11.12 */
  await paso("11.11 / 11.12 · Clasificación IT05 y camino: completa, CIP y prohibida", async () => {
    const [a1, a2, a3] = C.armas;
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/clasificacion`, { items: [{ armaOtId: a1.id, clase: "arma", permisibilidad: "permitida" }] }, /Elija el camino/);
    await exigir(403, U.auditor, "POST", `/d11/ot/${C.otId}/clasificacion`, { items: [{ armaOtId: a1.id, clase: "arma", permisibilidad: "permitida", camino: "completa" }] });
    const e = await ok(U.armero, "POST", `/d11/ot/${C.otId}/clasificacion`, {
      items: [
        { armaOtId: a1.id, clase: "arma", permisibilidad: "permitida", camino: "completa" },
        { armaOtId: a2.id, clase: "arma", permisibilidad: "permitida", camino: "cip" },
        { armaOtId: a3.id, clase: "arma", permisibilidad: "prohibida" },
      ],
    });
    const [b1, b2, b3] = e.armas;
    afirmar(b1.camino === "completa" && b1.ensayos > b2.ensayos && b2.camino === "cip", `caminos ${b1.camino}/${b2.camino} · ensayos ${b1.ensayos}/${b2.ensayos}`);
    afirmar(b3.permisibilidad === "prohibida" && b3.etapa === "prohibida", `arma 3: ${b3.etapa}`);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/clasificacion`, { items: [{ armaOtId: a2.id, clase: "arma", permisibilidad: "permitida", camino: "completa" }] }, /indique el motivo/);
    C.armas = e.armas;
    return `${b1.muestra}: ${b1.caminoNombre} (${b1.ensayos} ensayos) · ${b2.muestra}: ${b2.caminoNombre} (${b2.ensayos}) · ${b3.muestra}: prohibida`;
  });

  /* --------------------------------------------- BL-038 · captura */
  await paso("BL-038 · Captura sin valores por defecto: cada fila explícita (grupo incompleto → 400)", async () => {
    const [a1, a2] = C.armas;
    const f1 = await ok(U.armero, "GET", `/d11/armas/${a1.id}`);
    const pend = f1.ensayos.filter((x) => x.estado === "pendiente");
    const ad = pend.filter((x) => x.grupo.endsWith(":AD"));
    afirmar(ad.length >= 2, `inspección antes del disparo: ${ad.length} filas`);
    await exigir(400, U.armero, "POST", `/d11/armas/${a1.id}/ensayos`, { valores: [{ resultadoId: ad[0].resultadoId, valor: 0 }] }, /Falta marcar/);
    await exigir(400, U.armero, "POST", `/d11/armas/${a1.id}/ensayos`, { valores: ad.map((x) => ({ resultadoId: x.resultadoId, valor: 2 })) }, /0 \(sin defecto\) o 1/);
    await exigir(403, U.auditor, "POST", `/d11/armas/${a1.id}/ensayos`, { valores: ad.map((x) => ({ resultadoId: x.resultadoId, valor: 0 })) });
    // La tensión del disparador es un valor medido: la jefatura fija su rango en la orden (por confirmar, EP-11 P3).
    const tension = pend.find((x) => x.entrada === "valor");
    afirmar(tension, "no hay ensayo de tensión del disparador");
    await ok(U.d11Jefe, "PATCH", `/flujo/resultado/${tension.resultadoId}/especificacion`, { limiteInf: "1,5", limiteSup: "4", unidad: "kg", motivo: "Rango de prueba de la tensión del disparador (por confirmar con la D11)." });
    const valores = (lista) => lista.map((x) => ({
      resultadoId: x.resultadoId,
      valor: x.entrada === "defecto" ? 0 : x.entrada === "valor" ? "2,3" : x.entrada === "texto" ? `EXH-PRUEBA-${sello.slice(-4)}` : undefined,
      atributo: x.entrada === "atributo" ? "cumple" : undefined,
    }));
    // 11.17 · la prueba de fuego (IT04) gasta munición de prueba: sin lote ni cartuchos no se registra.
    C.lote = await ok(U.armero, "POST", "/d11/municion/lotes", { lote: `L-${S("M")}`, calibre: "9x19 mm", norma: "NIJ 0101.06", nivel: "IIIA", masaBalaG: 8, velocidadMs: 398, cantidad: 200 });
    await exigir(400, U.armero, "POST", `/d11/armas/${a1.id}/ensayos`, { valores: valores(pend) }, /munición de prueba/);
    await exigir(400, U.armero, "POST", `/d11/armas/${a1.id}/ensayos`, { valores: valores(pend), municion: { loteId: C.lote.id, cartuchos: 999 } }, /no alcanza/);
    const r1 = await ok(U.armero, "POST", `/d11/armas/${a1.id}/ensayos`, { valores: valores(pend), municion: { loteId: C.lote.id, cartuchos: 6 } });
    afirmar(r1.ficha.fuego.usos.length === 1 && r1.ficha.fuego.usos[0].cantidad === 6, "la prueba de fuego no descontó la munición");
    afirmar(r1.ficha.ensayos.every((x) => x.estado !== "pendiente"), "quedaron ensayos pendientes en el arma 1");
    const f2 = await ok(U.armero, "GET", `/d11/armas/${a2.id}`);
    const r2 = await ok(U.armero2, "POST", `/d11/armas/${a2.id}/ensayos`, { valores: valores(f2.ensayos.filter((x) => x.estado === "pendiente")) });
    return `${r1.capturados} + ${r2.capturados} valores capturados explícitamente`;
  });

  await paso("11.21 · Revisión y aprobación por OT (flujo general; quien revisa no aprueba)", async () => {
    // El identificador IBIS es informativo: lo decide el revisor (no quien capturó).
    let informativos = 0;
    for (const a of C.armas.slice(0, 2)) {
      const f = await ok(U.d11Jefe, "GET", `/d11/armas/${a.id}`);
      for (const x of f.ensayos.filter((y) => y.estado === "capturado" && y.veredicto === "pendiente")) {
        await exigir(409, U.armero, "POST", `/resultados/${x.resultadoId}/veredicto`, { veredicto: "informativo" }).catch(() =>
          exigir(403, U.armero, "POST", `/resultados/${x.resultadoId}/veredicto`, { veredicto: "informativo" }));
        await ok(U.d11Jefe, "POST", `/resultados/${x.resultadoId}/veredicto`, { veredicto: "informativo" });
        informativos++;
      }
    }
    afirmar(informativos === 2, `identificadores IBIS por decidir: ${informativos}`);
    await ok(U.d11Jefe, "POST", `/resultados/ot/${C.otId}/revisar`, {});
    await ok(U.bpch, "POST", `/resultados/ot/${C.otId}/aprobar`, {});
    const e = await ok(U.armero, "GET", `/d11/ot/${C.otId}`);
    const [b1, b2, b3] = e.armas;
    afirmar(b1.aprobados === b1.ensayos && b2.aprobados === b2.ensayos, `aprobados ${b1.aprobados}/${b1.ensayos} · ${b2.aprobados}/${b2.ensayos}`);
    afirmar(b1.veredicto === "cumple" && b2.veredicto === "cumple" && b3.veredicto === "no_cumple", `veredictos ${b1.veredicto}/${b2.veredicto}/${b3.veredicto}`);
    afirmar(b1.etapa === "por_acunar" && b2.etapa === "por_certificar", `etapas ${b1.etapa}/${b2.etapa}`);
    C.armas = e.armas;
    return `${b1.muestra} ${b1.etapaNombre} · ${b2.muestra} ${b2.etapaNombre} · ${b3.muestra} ${b3.etapaNombre}`;
  });

  /* --------------------------------------------- 11.22 · 11.23 */
  await paso("11.22 / 11.23 · Sin acuñar no se certifica; acuñación IT08 solo del camino completo", async () => {
    const [a1, a2, a3] = C.armas;
    await exigir(400, U.d11Jefe, "POST", `/d11/ot/${C.otId}/certificados`, { armaOtIds: [a1.id] }, /acuñación/);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/acunacion`, { items: [{ armaOtId: a2.id, numero: "1", anio: 2026 }] }, /no lleva acuñación/);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/acunacion`, { items: [{ armaOtId: a3.id, numero: "1", anio: 2026 }] }, /prohibida/);
    await exigir(403, U.auditor, "POST", `/d11/ot/${C.otId}/acunacion`, { items: [{ armaOtId: a1.id, numero: "1", anio: 2026 }] });
    const e = await ok(U.armero, "POST", `/d11/ot/${C.otId}/acunacion`, { items: [{ armaOtId: a1.id, numero: `C${sello.slice(-4)}`, anio: 2026 }] });
    afirmar(e.armas[0].acunacion && e.armas[0].etapa === "por_certificar", "no quedó acuñada");
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/acunacion`, { items: [{ armaOtId: a1.id, numero: "9", anio: 2026 }] }, /ya está acuñada/);
    return `cuño Nº ${e.armas[0].acunacion.numero}/${e.armas[0].acunacion.anio}`;
  });

  await paso("11.23 · Emitir certificados por arma en bloque (rango) → en firma según la matriz D11", async () => {
    const [a1, a2, a3] = C.armas;
    await exigir(403, U.armero, "POST", `/d11/ot/${C.otId}/certificados`, { armaOtIds: [a1.id, a2.id] });
    await exigir(400, U.d11Jefe, "POST", `/d11/ot/${C.otId}/certificados`, { armaOtIds: [a3.id] }, /prohibida/);
    const r = await ok(U.d11Jefe, "POST", `/d11/ot/${C.otId}/certificados`, { armaOtIds: [a1.id, a2.id] });
    afirmar(r.emitidos === 2 && r.emision.cantidad === 2, `emitidos ${r.emitidos}`);
    afirmar(/^\d{6}$/.test(r.emision.desde) && /^\d{6}$/.test(r.emision.hasta), `rango ${r.emision.desde}–${r.emision.hasta}`);
    const b1 = r.expediente.armas[0];
    afirmar(b1.certificado.estado === "en_firma" && b1.etapa === "certificado_en_firma", `cert ${JSON.stringify(b1.certificado)}`);
    await exigir(400, U.d11Jefe, "POST", `/d11/ot/${C.otId}/certificados`, { armaOtIds: [a1.id] }, /ya tiene certificado/);
    C.emision = r.emision;
    C.cert1 = b1.certificado;
    // El documento lleva el arma, la vigencia de 4 años y el QR.
    const html = await exigir(200, U.d11Jefe, "GET", `/informes/${b1.certificado.id}/html`);
    afirmar(String(html).includes("CERTIFICADO DE ARMA") && String(html).includes(S(1)) && String(html).includes("data:image/png;base64"), "el certificado no trae el arma o el QR");
    const vence = b1.certificado.vigenteHasta?.slice(0, 10);
    afirmar(vence && Number(vence.slice(0, 4)) === Number(hoyCl().slice(0, 4)) + 4, `vigencia ${vence}`);
    return `rango ${r.emision.desde}–${r.emision.hasta} (${r.emision.cantidad}) · vigente hasta ${vence}`;
  });

  await paso("11.42 · Firma del rango: solo el responsable de la matriz (Jefe D11)", async () => {
    await exigir(403, U.armero, "POST", `/d11/emisiones/${C.emision.id}/firmar`, {});
    const r = await ok(U.d11Jefe, "POST", `/d11/emisiones/${C.emision.id}/firmar`, {});
    afirmar(r.firmados === 2, `firmados ${r.firmados}`);
    afirmar(r.expediente.armas[0].certificado.estado === "oficial" && r.expediente.armas[0].etapa === "certificada", "no quedó oficial");
    await exigir(409, U.d11Jefe, "POST", `/d11/emisiones/${C.emision.id}/firmar`, {}, /No hay certificados en firma/);
    return `${r.firmados} certificados oficiales`;
  });

  await paso("11.23 · Verificación pública con el código del QR: sin sesión y sin datos personales", async () => {
    const circ = await ok(U.d11Jefe, "GET", `/informes/${C.cert1.id}/circuito`);
    const codigo = circ.documento?.codigoVerificacion ?? circ.codigoVerificacion;
    afirmar(codigo, `sin código de verificación: ${JSON.stringify(circ).slice(0, 200)}`);
    const v = await exigir(200, null, "GET", `/informes/verificar/${codigo}`);
    afirmar(v.valido === true && v.tipoDocumento === "CERTIFICADO_ARMA" && v.vigente === true, `verificación ${JSON.stringify(v)}`);
    afirmar(v.arma && !String(v.arma.serie).includes(S(1)) && v.arma.serie.endsWith("··"), `serie expuesta: ${v.arma?.serie}`);
    afirmar(!JSON.stringify(v).includes("Importador Prueba"), "la verificación expone al importador");
    return `${v.numero} · ${v.arma.marca} ${v.arma.modelo} serie ${v.arma.serie} · vigente hasta ${v.vigenteHasta}`;
  });

  /* --------------------------------------------- 11.27 · entrega y cierre */
  await paso("11.27 · Entrega por código de barras con guía; la prohibida no se entrega; el cierre lo exige", async () => {
    const [a1, a2, a3] = C.armas;
    const cierre0 = await ok(U.d11Jefe, "GET", `/ot/${C.otId}/cierre`);
    afirmar(cierre0.faltantes.some((f) => /por entregar/.test(f)), `faltantes: ${cierre0.faltantes.join(" | ")}`);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/entrega`, { receptorNombre: "Receptor Prueba", fecha: hoyCl(), codigos: [a3.codigoBarras] }, /prohibida/);
    await exigir(400, U.armero, "POST", `/d11/ot/${C.otId}/entrega`, { receptorNombre: "Receptor Prueba", fecha: hoyCl(), codigos: ["NO-EXISTE"] }, /no es un arma/);
    await exigir(403, U.armero, "POST", `/d11/ot/${C.otId}/entrega`, { receptorNombre: "Receptor Prueba", fecha: hoyCl(), codigos: [a1.codigoBarras], entregarCertificados: true });
    const r = await ok(U.d11Jefe, "POST", `/d11/ot/${C.otId}/entrega`, {
      receptorNombre: "Receptor Prueba", receptorDocumento: "Doc. prueba", fecha: hoyCl(), codigos: [a1.codigoBarras.toLowerCase(), a2.codigoBarras], entregarCertificados: true,
    });
    afirmar(r.certificadosEntregados.length === 2 && /^GE-\d{4}-\d{4}$/.test(r.entrega.numero), `entrega ${JSON.stringify(r.entrega)} · ${r.certificadosEntregados}`);
    await exigir(400, U.d11Jefe, "POST", `/d11/ot/${C.otId}/entrega`, { receptorNombre: "Receptor Prueba", fecha: hoyCl(), codigos: [a1.codigoBarras] }, /ya se entregó/);
    const g = await llamar(U.armero, "GET", `/d11/entregas/${r.entrega.id}/guia`);
    afirmar(g.status === 200 && String(g.json).includes(r.entrega.numero) && String(g.json).includes(S(1)), "guía de entrega incompleta");
    const f = await ok(U.armero, "GET", `/d11/armas/${a1.id}`);
    afirmar(f.movimientos.some((m) => m.evento === "salida" && m.entrega === r.entrega.numero), "falta la salida en custodia");
    C.entrega = r.entrega;
    return `${r.entrega.numero} · 2 armas y 2 certificados entregados`;
  });

  await paso("Cierre de la OT de armas: la prohibida queda con «no emitido» (informe a DGMN, 11.24)", async () => {
    const a3 = C.armas[2];
    const plant = lista(await ok(U.d11Jefe, "GET", "/plantillas?limit=200")).find((p) => p.repid === "CERTARMA");
    afirmar(plant, "no se encontró la plantilla CERTARMA");
    await ok(U.d11Jefe, "POST", "/informes/no-emitido", {
      otId: C.otId, plantillaId: plant.id, tipoDocumento: "CERTIFICADO_ARMA",
      cobertura: { cobertura: "muestra", muestraIds: [a3.muestraId] }, motivo: "Arma prohibida: corresponde informe de incumplimiento a DGMN (EP-11 11.24).",
    });
    const cierre = await ok(U.d11Jefe, "GET", `/ot/${C.otId}/cierre`);
    afirmar(cierre.faltantes.length === 0, `faltantes: ${cierre.faltantes.join(" | ")}`);
    const r = await ok(U.d11Jefe, "POST", `/ot/${C.otId}/cerrar`, {});
    afirmar(r.ot.estado === "cerrada", `estado ${r.ot.estado}`);
    const e = await ok(U.auditor, "GET", `/d11/ot/${C.otId}`);
    afirmar(e.avance.completo === false || e.avance.pasos.slice(0, 9).every((p) => p.estado === "hecho"), "avance inconsistente");
    return `OT ${r.ot.codigo} cerrada`;
  });

  /* --------------------------------------------- 10.15 · DGMN (estado) */
  await paso("10.15 · Notificación a DGMN: una OT sin incumplimiento no la exige; Comercial no la registra", async () => {
    const e = await ok(U.bpch, "GET", `/bpch/notificacion-dgmn/ot/${C.otId}`);
    afirmar(e.aplica === false && e.destinatarios.length === 3, `estado ${JSON.stringify(e).slice(0, 200)}`);
    await exigir(403, U.ventas, "POST", `/bpch/notificacion-dgmn/ot/${C.otId}`, { certificadoId: C.cert1.id, medio: "correo", fechaEnvio: hoyCl(), copiaInternador: true });
    await exigir(400, U.bpch, "POST", `/bpch/notificacion-dgmn/ot/${C.otId}`, { certificadoId: C.cert1.id, medio: "correo", fechaEnvio: hoyCl(), copiaInternador: true }, /no es un Informe de Incumplimiento/);
    return "sin incumplimiento · 3 destinatarios fijos";
  });

  /* --------------------------------------------- 11.40 · munición de prueba */
  await paso("11.40 · Munición de prueba: el LRB pide, la D11 entrega del lote y cierra el acta cuadrada", async () => {
    const [lrb] = await ok(U.lrb, "GET", "/municion/unidades");
    afirmar(lrb?.codigo === "LRB", "el analista del LRB debe poder pedir para el LRB");
    const pedido = { unidadId: lrb.id, norma: "NIJ 0101.06", nivel: "IIIA", calibre: "9X19MM", masaBalaG: 8, velocidadMs: 448, velocidadTolMs: 9.1, cantidadPedida: 40, itemHcp: "HCP-PRUEBA" };
    await exigir(403, U.lam, "POST", "/municion/solicitudes", pedido, /alcance/);
    const sol = await ok(U.lrb, "POST", "/municion/solicitudes", pedido);
    await exigir(403, U.lrb, "POST", `/d11/municion/solicitudes/${sol.id}/entregar`, { loteId: C.lote.id, cantidad: 40 });
    await exigir(403, U.auditor, "POST", `/d11/municion/solicitudes/${sol.id}/entregar`, { loteId: C.lote.id, cantidad: 40 });
    await ok(U.armero, "POST", `/d11/municion/solicitudes/${sol.id}/entregar`, { loteId: C.lote.id, cantidad: 40 });
    await exigir(400, U.armero, "POST", `/d11/municion/solicitudes/${sol.id}/cerrar`, { usados: 30, devueltos: 5 }, /No cuadra/);
    const cerrada = await ok(U.armero, "POST", `/d11/municion/solicitudes/${sol.id}/cerrar`, { usados: 32, devueltos: 8 });
    afirmar(cerrada.estado === "cerrada", `estado ${cerrada.estado}`);
    const lote = (await ok(U.armero, "GET", "/d11/municion/lotes")).find((l) => l.id === C.lote.id);
    afirmar(lote.saldo === 200 - 6 - 40 + 8, `saldo del lote ${lote.saldo}`);
    const movs = await ok(U.armero, "GET", `/d11/municion/lotes/${C.lote.id}/movimientos`);
    afirmar(movs.some((m) => m.tipo === "uso" && m.arma), "el uso en la prueba de fuego no aparece en el lote");
    const acta = await llamar(U.lrb, "GET", `/municion/solicitudes/${sol.id}/acta`);
    afirmar(acta.status === 200 && /Usados<\/th><td>32/.test(acta.json), "acta del laboratorio");
    await exigir(403, U.lam, "GET", `/municion/solicitudes/${sol.id}/acta`);
    afirmar((await ok(U.lam, "GET", "/municion/solicitudes")).every((x) => x.id !== sol.id), "el LAM no debe ver órdenes del LRB");
    return `${sol.codigo}: 40 entregados = 32 usados + 8 devueltos · saldo ${lote.saldo}`;
  });

  /* --------------------------------------------- 11.31-11.35 · SAEC */
  await paso("11.35 · Caso SAEC: nace abierto y su estado solo cambia por transiciones válidas", async () => {
    C.caso = await ok(U.d11Jefe, "POST", "/saec/casos", { descripcion: "Caso ficticio de verificación r4b", agenciaOrigenNombre: "Fiscalía de prueba" });
    afirmar(C.caso.estado === "abierto", `estado ${C.caso.estado}`);
    await exigir(400, U.d11Jefe, "PATCH", `/saec/casos/${C.caso.id}`, { estado: "cerrado" }, /Cambiar estado/);
    await exigir(400, U.d11Jefe, "POST", `/saec/casos/${C.caso.id}/estado`, { estado: "archivado" }, /no puede pasar a archivado/);
    await exigir(403, U.auditor, "POST", `/saec/casos/${C.caso.id}/estado`, { estado: "en_proceso" });
    await ok(U.d11Jefe, "POST", `/saec/casos/${C.caso.id}/estado`, { estado: "en_proceso" });
    return `${C.caso.numero_caso}: abierto → en proceso`;
  });

  await paso("11.31 · Evidencia por oficio: Nº de oficio, unidad solicitante y NUE obligatorios; NUE único; RUC con forma", async () => {
    const base = { tipo: "vainilla", casoId: C.caso.id, descripcion: "Vainilla ficticia", ubicacion: "Bodega de prueba" };
    await exigir(400, U.d11Jefe, "POST", "/evidencias", base, /Nº del oficio/);
    const datos = { ...base, nue: `NUE-${S("E")}`, oficioNumero: `OF-${S("O")}`, oficioFecha: hoyCl(), oficioUnidad: "Fiscalía de prueba", rucCausa: "2600123456-K" };
    await exigir(400, U.d11Jefe, "POST", "/evidencias", { ...datos, rucCausa: "26-1" }, /RUC/);
    C.ev = await ok(U.d11Jefe, "POST", "/evidencias", datos);
    afirmar(C.ev.codigo_barras === datos.nue && C.ev.oficio_numero === datos.oficioNumero, "el código de barras por defecto es el NUE");
    await exigir(409, U.d11Jefe, "POST", "/evidencias", { ...datos, nue: datos.nue.toLowerCase() }, /ya está registrado/);
    await exigir(403, U.auditor, "POST", "/evidencias", { ...datos, nue: `NUE-${S("X")}` });
    return `${C.ev.codigo} · NUE ${C.ev.nue}`;
  });

  await paso("11.34 · Peritaje con tipo y adjunto (se valida el contenido: solo PDF, PNG o JPEG)", async () => {
    await exigir(400, U.armero, "POST", `/evidencias/${C.ev.id}/peritaje`, { resultado: "concluyente", conclusiones: "x" }, /tipo de peritaje/);
    const p = await ok(U.armero, "POST", `/evidencias/${C.ev.id}/peritaje`, { tipo: "balistico_comparativo", resultado: "concluyente", conclusiones: "Conclusión ficticia de verificación." });
    const malo = new FormData();
    malo.append("archivo", new Blob(["<script>alert(1)</script>"], { type: "application/pdf" }), "informe.pdf");
    await exigir(400, U.armero, "POST", `/evidencias/${C.ev.id}/peritajes/${p.id}/adjuntos`, malo, /PDF, PNG o JPEG/);
    const bueno = new FormData();
    bueno.append("archivo", new Blob(["%PDF-1.4\n% informe ficticio\n"], { type: "application/pdf" }), "informe pericial.pdf");
    const a = await ok(U.armero, "POST", `/evidencias/${C.ev.id}/peritajes/${p.id}/adjuntos`, bueno);
    const d = await llamar(U.d11Jefe, "GET", `/evidencias/${C.ev.id}/adjuntos/${a.id}`);
    afirmar(d.status === 200 && d.tipo.startsWith("application/pdf"), `descarga ${d.status} ${d.tipo}`);
    await exigir(403, U.otroLab, "GET", `/evidencias/${C.ev.id}/adjuntos/${a.id}`);
    const ev = await ok(U.d11Jefe, "GET", `/evidencias/${C.ev.id}`);
    afirmar(ev.estado === "analizada" && ev.peritajes[0].adjuntos.length === 1 && ev.peritajes[0].datos.tipo === "balistico_comparativo", "peritaje sin adjunto o evidencia no analizada");
    return `peritaje balístico comparativo + ${a.nombre}`;
  });

  await paso("11.33 · Préstamo: plazo obligatorio; aprobar, entregar con acta de salida, devolver con estado; el caso no se cierra con la evidencia fuera", async () => {
    const sol = { tipo: "entrega", organismoSolicitante: "Fiscalía de prueba", solicitanteNombre: "Fiscal adjunto (ficticio)", solicitanteDocumento: "OF-PRUEBA", motivo: "Exhibición en audiencia (ficticio)" };
    await exigir(400, U.d11Jefe, "POST", `/evidencias/${C.ev.id}/prestamos`, sol, /plazo de devolución/);
    const pr = await ok(U.d11Jefe, "POST", `/evidencias/${C.ev.id}/prestamos`, { ...sol, fechaDevolucionPrevista: hoyCl() });
    await ok(U.d11Jefe, "POST", `/prestamos-evidencia/${pr.id}/aprobar`, {});
    await exigir(400, U.d11Jefe, "POST", `/prestamos-evidencia/${pr.id}/entregar`, {}, /quién recibe/);
    await ok(U.d11Jefe, "POST", `/prestamos-evidencia/${pr.id}/entregar`, { receptorNombre: "Receptor ficticio" });
    await exigir(400, U.d11Jefe, "POST", `/saec/casos/${C.caso.id}/estado`, { estado: "cerrado" }, /prestada/);
    const acta = await llamar(U.d11Jefe, "GET", `/prestamos-evidencia/${pr.id}/acta`);
    afirmar(acta.status === 200 && /ACTA DE SALIDA/.test(acta.json) && /Receptor ficticio/.test(acta.json), "acta de salida");
    await exigir(400, U.d11Jefe, "POST", `/prestamos-evidencia/${pr.id}/devolver`, { ubicacionRetorno: "Bodega A" }, /estado en que vuelve/);
    await ok(U.d11Jefe, "POST", `/prestamos-evidencia/${pr.id}/devolver`, { ubicacionRetorno: "Bodega A", estadoReingreso: "Sellos íntegros" });
    await ok(U.d11Jefe, "POST", `/saec/casos/${C.caso.id}/estado`, { estado: "cerrado" });
    await exigir(400, U.d11Jefe, "POST", `/saec/casos/${C.caso.id}/estado`, { estado: "en_proceso" }, /motivo/);
    await exigir(400, U.d11Jefe, "POST", "/evidencias", { tipo: "otro", casoId: C.caso.id, nue: `NUE-${S("C")}`, oficioNumero: "OF-1", oficioUnidad: "Fiscalía de prueba", ubicacion: "Bodega" }, /reábralo/);
    return `${pr.codigo}: solicitado → aprobado → entregado → devuelto · caso cerrado`;
  });

  /* --------------------------------------------- EP-09 9.16 · listado oficial */
  await paso("9.16 · Listado oficial de Codificación Única: PDF para firma (Certificación BPCH) y Excel; Comercial no genera el PDF", async () => {
    const cuerpo = { listado: "EXPLOSIVOS", fabricante: null, fechaEdicion: hoyCl() };
    const fabs = await ok(U.bpch, "GET", "/bpch/codificacion/listado-oficial/fabricantes?listado=EXPLOSIVOS");
    if (!fabs.length) return "sin productos vigentes en la Codificación Única de esta BD (se omite)";
    const pdf = await llamar(U.bpch, "POST", "/bpch/codificacion/listado-oficial/pdf", cuerpo);
    afirmar(pdf.status === 201 && pdf.tipo.startsWith("application/pdf"), `PDF ${pdf.status}`);
    const csv = await llamar(U.bpch, "POST", "/bpch/codificacion/listado-oficial/excel", { ...cuerpo, fabricante: fabs[0].fabricante });
    afirmar(csv.status === 201 && /Fabricante;RUT;Grupo/.test(String(csv.json)), "Excel");
    await exigir([403], U.ventas, "POST", "/bpch/codificacion/listado-oficial/pdf", cuerpo);
    await exigir(400, U.bpch, "POST", "/bpch/codificacion/listado-oficial/pdf", { ...cuerpo, fechaEdicion: "2999-01-01" }, /futura/);
    const em = await ok(U.bpch, "GET", "/bpch/codificacion/listado-oficial/emisiones");
    afirmar(em.length >= 2, "las emisiones quedan registradas");
    return `${fabs.length} fabricante(s) · PDF y Excel registrados`;
  });
}

main()
  .then(() => {
    console.log(`\nFrente r4b: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
