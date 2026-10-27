#!/usr/bin/env node
/**
 * Frente r1f · ajustes tras cotejar los manuales con la entrega R1.
 *
 *   1. Parámetros de la operación (Administración › Parámetros del sistema):
 *      Calidad ve y cambia el VALOR de los parámetros R1 con validación por tipo,
 *      motivo e historial; el Jefe de LQC los ve en solo lectura (403 al cambiar)
 *      y Comercial no entra (403). El cambio surte efecto: con
 *      exigir_firma_para_aceptar = No una cotización se acepta sin firma; con Sí,
 *      409. El formato de numeración cambia el número de la cotización siguiente.
 *      Campos propios de la recepción y producto obligatorio: alta y cambio con
 *      motivo. La tabla genérica ya no deja cambiar el valor sin motivo (409).
 *   2. «Emitir orden interna»: la API exige orden_interna.emitir (Comercial, con
 *      ot.crear, recibe 403) y la pestaña Muestras mira ese mismo permiso.
 *   3. Una sola captura: la corrección de réplicas exige motivo si el ensayo ya
 *      tenía valor (400 sin él), queda en el historial y, tras una devolución,
 *      vale el motivo de la devolución; /captura redirige a /captura-ot.
 *
 * Al terminar deja los parámetros en sus valores por defecto (los otros
 * recorridos los dan por supuestos).
 *
 * Uso:
 *   node scripts/verificacion/r1-r1f.js [--arrancar] [--base http://localhost:4761/api]
 *   --arrancar  lanza `node apps/api/dist/main.js` (compilar antes) con DATABASE_URL.
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA
 * de apps/api/src/auth/auth.service.ts. No escribe contraseñas. Deja datos de
 * prueba (cotizaciones, una OT, cambios de parámetros en el historial): úsese en
 * una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4761/api");
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
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo, patron) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!ok) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  if (patron && !patron.test(msg(r.json))) throw new Error(`${username} ${metodo} ${ruta}: el mensaje «${msg(r.json)}» no dice ${patron}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

/* -------------------------------------------------------------- informe --- */
const pasos = [];
async function paso(nombre, fn) {
  const t0 = Date.now();
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
  const puerto = new URL(BASE).port || "4761";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4762",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1f-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ RECORRIDO === */
const U = {
  calidad: "demo.calidad", // catalogo.gestionar con alcance global: cambia
  admin: "demo.admin",
  lqcJefe: "demo.lqc.jefe", // catalogo.gestionar solo de LQC: lee, no cambia
  ventas: "demo.ventas", // sin catalogo.gestionar: no entra; tiene ot.crear pero no orden_interna.emitir
  a1: "demo.lqc.analista1",
  rev: "demo.lqc.revisor",
  recepcion: "demo.recepcion",
};
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const CONF = "/parametros/configurables";

/** Valores por defecto que dejan los SQL (y que los demás recorridos suponen). */
const POR_DEFECTO = [
  ["circuito_cotizacion", "exigir_firma_para_aceptar", true],
  ["numeracion_cotizacion", "formato", "{AAAA}-{N}"],
  ["encuesta", "excluir_origenes", ["INTERLABORATORIO", "OT_INTERNA"]],
  ["captura_equipo", "obligatorio", "metodo"],
];

async function leer(u = U.calidad) {
  return ok(u, "GET", CONF);
}
function param(datos, categoria, codigo) {
  const g = datos.grupos.find((x) => x.categoria === categoria);
  return g?.parametros.find((p) => p.codigo === codigo) ?? null;
}
/** Cambia un parámetro solo si su valor difiere (el servidor responde 409 si es igual). */
async function fijar(categoria, codigo, valor, motivo) {
  const p = param(await leer(), categoria, codigo);
  afirmar(p && !p.falta, `falta ${categoria}.${codigo}`);
  if (JSON.stringify(p.valor) === JSON.stringify(valor)) return false;
  await ok(U.calidad, "PUT", `${CONF}/${categoria}/${encodeURIComponent(codigo)}`, { valor, motivo });
  return true;
}
async function restaurar() {
  for (const [c, k, v] of POR_DEFECTO) await fijar(c, k, v, "Restituye el valor por defecto tras el recorrido r1f");
}

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    // Si una vuelta anterior se cortó a mitad, se parte de los valores por defecto.
    await restaurar();
    return `${Object.keys(sesiones).length} sesiones`;
  });

  /* ---------------------------------------------------- 1 · Parámetros --- */
  await paso("Leer: Calidad puede editar; el Jefe LQC solo lee; Comercial no entra (403)", async () => {
    const d = await leer(U.calidad);
    afirmar(d.puedeEditar === true, "Calidad debería poder editar");
    afirmar((await leer(U.lqcJefe)).puedeEditar === false, "el Jefe LQC (alcance de su laboratorio) no debería poder editar");
    await exigir(403, U.ventas, "GET", CONF);
    const cats = d.grupos.map((g) => g.categoria);
    for (const c of ["numeracion_cotizacion", "circuito_cotizacion", "encuesta", "metrologia", "recepcion_producto_obligatorio", "numeracion_muestra", "retencion_muestra", "recepcion_campo", "captura_equipo"])
      afirmar(cats.includes(c), `falta el grupo ${c}`);
    const firma = param(d, "circuito_cotizacion", "exigir_firma_para_aceptar");
    afirmar(firma.valor === true && firma.def.tipo === "sino" && firma.texto === "Sí", JSON.stringify(firma));
    const ex = param(d, "encuesta", "excluir_origenes");
    afirmar(Array.isArray(ex.valor) && ex.def.opciones.length >= 8, JSON.stringify(ex.valor));
    const ret = param(d, "retencion_muestra", "contramuestra");
    afirmar(ret.valor === 12 && ret.texto === "12 meses", JSON.stringify(ret));
    const lote = param(d, "recepcion_campo", "LME.lote");
    afirmar(lote && typeof lote.valor === "object" && lote.valor.tipo === "texto" && lote.laboratorio === "LME", JSON.stringify(lote));
    const lme = param(d, "recepcion_producto_obligatorio", "LME");
    afirmar(lme && lme.valor === true, JSON.stringify(lme));
    const n = d.grupos.reduce((t, g) => t + g.parametros.length, 0);
    return `${d.grupos.length} grupos, ${n} parámetros · ${d.laboratorios.length} laboratorios para el alta`;
  });

  await paso("Validación por tipo y motivo: 400; mismo valor 409; parámetro ajeno 404; Jefe LQC y Comercial 403", async () => {
    const put = (cat, cod, cuerpo, u = U.calidad) => llamar(u, "PUT", `${CONF}/${cat}/${encodeURIComponent(cod)}`, cuerpo);
    const casos = [
      ["numeracion_cotizacion", "digitos", { valor: 0, motivo: "Prueba de rango" }, /entre 1 y 10/],
      ["numeracion_cotizacion", "digitos", { valor: "5,5", motivo: "Prueba de decimales" }, /entero/],
      ["numeracion_cotizacion", "formato", { valor: "{AAAA}", motivo: "Prueba sin correlativo" }, /\{N\}/],
      ["numeracion_cotizacion", "formato", { valor: "<b>{N}", motivo: "Prueba de caracteres" }, /letras/],
      ["circuito_cotizacion", "cfa_pct", { valor: "101", motivo: "Prueba de porcentaje" }, /entre 0 y 100/],
      ["circuito_cotizacion", "vb_niveles", { valor: "todos", motivo: "Prueba de opción" }, /opciones/],
      ["encuesta", "excluir_origenes", { valor: ["OTRO"], motivo: "Prueba de lista" }, /desconocidas/],
      ["retencion_muestra", "testigo", { valor: 601, motivo: "Prueba de meses" }, /meses/],
      ["recepcion_campo", "LME.clase_custodia", { valor: { tipo: "lista", opciones: [{ valor: "bodega", etiqueta: "Bodega" }] }, motivo: "Prueba de destino" }, /clase_custodia/],
      ["circuito_cotizacion", "exigir_firma_para_aceptar", { valor: false, motivo: "ok" }, /motivo/],
    ];
    for (const [cat, cod, cuerpo, patron] of casos) {
      const r = await put(cat, cod, cuerpo);
      afirmar(r.status === 400 && patron.test(msg(r.json)), `${cat}.${cod} ${JSON.stringify(cuerpo.valor)} → ${r.status} ${msg(r.json)}`);
    }
    await exigir(409, U.calidad, "PUT", `${CONF}/circuito_cotizacion/exigir_firma_para_aceptar`, { valor: true, motivo: "Mismo valor que el vigente" }, /igual al vigente/);
    await exigir(404, U.calidad, "PUT", `${CONF}/tipo_cliente/particular`, { valor: "x", motivo: "No es configurable" });
    await exigir(403, U.lqcJefe, "PUT", `${CONF}/circuito_cotizacion/exigir_firma_para_aceptar`, { valor: false, motivo: "El jefe no puede" });
    await exigir(403, U.ventas, "PUT", `${CONF}/circuito_cotizacion/exigir_firma_para_aceptar`, { valor: false, motivo: "Comercial no puede" });
    return `${casos.length} valores rechazados con su motivo`;
  });

  await paso("Tabla genérica: el valor, «Activo» y el alta o baja de estos parámetros → 409; la etiqueta sí cambia", async () => {
    const fila = lista(await ok(U.calidad, "GET", "/parametros?categoria=circuito_cotizacion&limit=50")).find((p) => p.codigo === "exigir_firma_para_aceptar");
    afirmar(fila, "no está la fila exigir_firma_para_aceptar");
    await exigir(409, U.calidad, "PATCH", `/parametros/${fila.id}`, { valor: "no" }, /Parámetros de la operación/);
    await exigir(409, U.calidad, "PATCH", `/parametros/${fila.id}`, { activo: false });
    await exigir(409, U.calidad, "DELETE", `/parametros/${fila.id}`);
    await exigir(409, U.calidad, "POST", "/parametros", { categoria: "recepcion_campo", codigo: "LQC.sin_motivo", etiqueta: "Sin motivo", valor: '{"tipo":"texto"}' });
    await ok(U.calidad, "PATCH", `/parametros/${fila.id}`, { etiqueta: fila.etiqueta });
    await exigir(403, U.lqcJefe, "PATCH", `/parametros/${fila.id}`, { etiqueta: fila.etiqueta }); // tabla común: solo alcance global
    C.filaFirma = fila;
  });

  const nuevaCot = (ref) => ok(U.ventas, "POST", "/cotizaciones", {
    clienteId: C.cliente.id, formato: "NORMAL", referencia: ref, plazoEntregaDias: 10,
    lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 1 }],
  });
  await paso("Datos: LQC, ensayo de pH y un cliente", async () => {
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    afirmar(C.lqc, "LQC no figura en /ot/laboratorios");
    C.mPh = lista(await ok(U.lqcJefe, "GET", "/cat/metodos?search=251&limit=50")).find((x) => x.codigo === "251");
    afirmar(C.mPh?.ensayoId, "método 251 (pH) no encontrado");
    C.cliente = lista(await ok(U.ventas, "GET", "/clientes?limit=20")).find((c) => c.activo !== false);
    afirmar(C.cliente, "no hay clientes");
    return `${C.cliente.razonSocial ?? C.cliente.id}`;
  });

  await paso("Efecto: exigir_firma_para_aceptar = No → se acepta sin firma; = Sí → 409", async () => {
    await ok(U.calidad, "PUT", `${CONF}/circuito_cotizacion/exigir_firma_para_aceptar`, { valor: false, motivo: "Prueba r1f: aceptar sin firma" });
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    afirmar(cfg.circuito?.exigirFirma === false, `el circuito no tomó el cambio: ${JSON.stringify(cfg.circuito)}`);
    const sinFirma = await nuevaCot(`r1f sin firma ${sello}`);
    const r = await ok(U.ventas, "POST", `/cotizaciones/${sinFirma.id}/aceptar`, {
      tipo: "OC", numero: `OC-R1F-${sello}`, fecha: hoy(), conCobro: false, unidadPrincipalId: C.lqc.id,
    });
    C.ot = r.ot;
    afirmar(C.ot?.id, "la aceptación no creó la OT");
    await ok(U.calidad, "PUT", `${CONF}/circuito_cotizacion/exigir_firma_para_aceptar`, { valor: true, motivo: "Prueba r1f: vuelve a exigir la firma" });
    const otra = await nuevaCot(`r1f con firma ${sello}`);
    await exigir(409, U.ventas, "POST", `/cotizaciones/${otra.id}/aceptar`, { tipo: "OC", numero: `OC-R1F2-${sello}`, fecha: hoy(), unidadPrincipalId: C.lqc.id }, /firmada/);
    await ok(U.ventas, "POST", `/cotizaciones/${otra.id}/anular`, { motivo: "Cotización de prueba del recorrido r1f" });
    return `${sinFirma.codigo} aceptada sin firma → OT ${C.ot.codigo ?? C.ot.id} · ${otra.codigo} 409 con la firma exigida`;
  });

  await paso("Efecto: el formato de numeración cambia el número de la cotización siguiente", async () => {
    await ok(U.calidad, "PUT", `${CONF}/numeracion_cotizacion/formato`, { valor: "COT-{AAAA}-{N}", motivo: "Prueba r1f del formato" });
    const c = await nuevaCot(`r1f formato ${sello}`);
    afirmar(/^COT-\d{4}-\d{5,}$/.test(c.codigo), `código ${c.codigo}`);
    await ok(U.calidad, "PUT", `${CONF}/numeracion_cotizacion/formato`, { valor: "{AAAA}-{N}", motivo: "Prueba r1f: formato por defecto" });
    const d = await nuevaCot(`r1f formato 2 ${sello}`);
    afirmar(/^\d{4}-\d{5,}$/.test(d.codigo), `código ${d.codigo}`);
    for (const x of [c, d]) await ok(U.ventas, "POST", `/cotizaciones/${x.id}/anular`, { motivo: "Cotización de prueba del recorrido r1f" });
    return `${c.codigo} → ${d.codigo}`;
  });

  await paso("Efecto: equipo obligatorio «siempre» → capturar sin equipo 400; «metodo» → se captura", async () => {
    await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: `Agua r1f ${sello}`, metodoIds: [C.mPh.id] }] });
    await ok(U.lqcJefe, "PUT", `/ot/${C.ot.id}/analistas`, { usuarioIds: [sesiones[U.a1].id] });
    const res = (await ok(U.lqcJefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.resPh = res.find((r) => r.estado === "pendiente");
    afirmar(C.resPh, "sin ensayo pendiente");
    await ok(U.calidad, "PUT", `${CONF}/captura_equipo/obligatorio`, { valor: "siempre", motivo: "Prueba r1f: equipo siempre" });
    await exigir(400, U.a1, "POST", `/flujo/resultado/${C.resPh.id}/valor`, { valor: "7,1" }, /equipo/);
    await ok(U.calidad, "PUT", `${CONF}/captura_equipo/obligatorio`, { valor: "metodo", motivo: "Prueba r1f: equipo según el método" });
    await ok(U.a1, "POST", `/flujo/resultado/${C.resPh.id}/valor`, { valor: "7,1" });
  });

  await paso("Encuestas: casillas de orígenes excluidos (lista vacía admitida) y vuelta al defecto", async () => {
    await ok(U.calidad, "PUT", `${CONF}/encuesta/excluir_origenes`, { valor: [], motivo: "Prueba r1f: toda OT genera encuesta" });
    const p = param(await leer(), "encuesta", "excluir_origenes");
    afirmar(Array.isArray(p.valor) && p.valor.length === 0 && p.texto === "Ninguno", JSON.stringify(p));
    await ok(U.calidad, "PUT", `${CONF}/encuesta/excluir_origenes`, { valor: ["OT_INTERNA", "INTERLABORATORIO"], motivo: "Prueba r1f: orígenes por defecto" });
    const q = param(await leer(), "encuesta", "excluir_origenes");
    afirmar(JSON.stringify(q.valor) === JSON.stringify(["INTERLABORATORIO", "OT_INTERNA"]), JSON.stringify(q.valor));
  });

  await paso("Recepción: alta de un campo propio y de un laboratorio con producto obligatorio, con motivo; duplicado 409; Jefe 403", async () => {
    const alta = (cuerpo, u = U.calidad) => llamar(u, "POST", `${CONF}/recepcion_campo`, cuerpo);
    const def = { tipo: "lista", obligatorio: false, opciones: [{ valor: "a", etiqueta: "Opción A" }, { valor: "b", etiqueta: "Opción B" }], ayuda: "Campo de prueba r1f", activo: true };
    await exigir(403, U.lqcJefe, "POST", `${CONF}/recepcion_campo`, { laboratorio: "LQC", campo: "r1f_prueba", etiqueta: "Prueba r1f", valor: def, motivo: "El jefe no puede" });
    await exigir(400, U.calidad, "POST", `${CONF}/recepcion_campo`, { laboratorio: "XXX", campo: "Con Espacios", etiqueta: "", valor: def, motivo: "Datos inválidos" });
    let d = await leer();
    let campo = param(d, "recepcion_campo", "LQC.r1f_prueba");
    if (!campo) {
      const r = await alta({ laboratorio: "LQC", campo: "r1f_prueba", etiqueta: "Prueba r1f", valor: def, motivo: "Prueba r1f: alta de un campo" });
      afirmar(r.status === 201 || r.status === 200, `alta ${r.status} ${msg(r.json)}`);
      await exigir(409, U.calidad, "POST", `${CONF}/recepcion_campo`, { laboratorio: "LQC", campo: "r1f_prueba", etiqueta: "Prueba r1f", valor: def, motivo: "Duplicado" });
    } else {
      await ok(U.calidad, "PUT", `${CONF}/recepcion_campo/LQC.r1f_prueba`, { valor: def, motivo: "Prueba r1f: reactivar el campo" });
    }
    d = await leer();
    campo = param(d, "recepcion_campo", "LQC.r1f_prueba");
    afirmar(campo?.valor?.tipo === "lista" && campo.valor.opciones.length === 2 && campo.activo === true, JSON.stringify(campo));
    // Se deja inactivo: no debe pedirse en la recepción de LQC de los demás recorridos.
    await ok(U.calidad, "PUT", `${CONF}/recepcion_campo/LQC.r1f_prueba`, { valor: { ...def, activo: false }, motivo: "Prueba r1f: desactivar el campo" });
    afirmar(param(await leer(), "recepcion_campo", "LQC.r1f_prueba").activo === false, "el campo sigue activo");

    // Producto obligatorio por laboratorio: LES (no está sembrado).
    const les = param(d, "recepcion_producto_obligatorio", "LES");
    if (!les) await ok(U.calidad, "POST", `${CONF}/recepcion_producto_obligatorio`, { laboratorio: "LES", valor: true, motivo: "Prueba r1f: LES exige producto" });
    else await fijar("recepcion_producto_obligatorio", "LES", true, "Prueba r1f: LES exige producto");
    afirmar(param(await leer(), "recepcion_producto_obligatorio", "LES").valor === true, "LES no quedó obligatorio");
    await exigir(409, U.calidad, "POST", `${CONF}/recepcion_producto_obligatorio`, { laboratorio: "LES", valor: true, motivo: "Duplicado" });
    await ok(U.calidad, "PUT", `${CONF}/recepcion_producto_obligatorio/LES`, { valor: false, motivo: "Prueba r1f: LES vuelve a opcional" });
  });

  await paso("Historial: quién, cuándo, antes, después (legibles) y motivo; lo ve también el Jefe LQC", async () => {
    const h = (await leer(U.lqcJefe)).historial;
    const firma = h.find((x) => x.codigo === "exigir_firma_para_aceptar" && x.motivo === "Prueba r1f: aceptar sin firma");
    afirmar(firma && firma.antes === "Sí" && firma.despues === "No" && /Calidad|calidad|C\./.test(firma.usuarioNombre ?? "C."), JSON.stringify(firma));
    const campo = h.find((x) => x.codigo === "LQC.r1f_prueba" && x.motivo === "Prueba r1f: desactivar el campo");
    afirmar(campo && /inactivo/.test(campo.despues), JSON.stringify(campo));
    return `${h.length} cambios · «${firma.parametro}: ${firma.antes} → ${firma.despues}» por ${firma.usuarioNombre}`;
  });

  /* ------------------------------------------- 2 · Emitir orden interna --- */
  await paso("Emitir orden interna: la API exige orden_interna.emitir (Comercial con ot.crear 403) y la pestaña Muestras mira ese permiso", async () => {
    await exigir(403, U.ventas, "POST", "/ordenes-internas", { otId: C.ot.id, tipo: "interna" });
    // El analista sí tiene el permiso: pasa la guarda y lo frena la validación del cuerpo (400), no el permiso.
    await exigir(400, U.a1, "POST", "/ordenes-internas", { otId: C.ot.id, tipo: "interna" });
    const src = fs.readFileSync(path.join(RAIZ, "apps/web/app/(app)/ot/[id]/_components/RegistroMuestras.tsx"), "utf8");
    const i = src.indexOf("Emitir orden interna");
    const tramo = src.slice(Math.max(0, i - 400), i);
    afirmar(/puede\("orden_interna\.emitir"\)/.test(tramo) && !/puede\("ot\.crear"\)/.test(tramo), "el botón «Emitir orden interna» no mira orden_interna.emitir");
    const web = [];
    const recorrer = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) { if (f.name !== "node_modules" && f.name !== ".next") recorrer(p); }
        else if (/\.tsx?$/.test(f.name)) web.push(p);
      }
    };
    recorrer(path.join(RAIZ, "apps/web"));
    // Ningún botón de órdenes internas con el permiso antiguo: «ot.crear» a menos de 400 caracteres de «orden interna».
    const malos = web.filter((p) => {
      const s = fs.readFileSync(p, "utf8");
      for (const m of s.matchAll(/(?:puede|tiene)\(\s*["']ot\.crear["']\s*\)/g)) if (/[oó]rden(es)? interna/i.test(s.slice(Math.max(0, m.index - 400), m.index + 400))) return true;
      return false;
    });
    afirmar(malos.length === 0, `botones de órdenes internas con ot.crear: ${malos.join(", ")}`);
  });

  /* ------------------------------------------------ 3 · Una sola captura --- */
  await paso("Corrección de réplicas: con valor capturado exige motivo (400), queda en el historial; Comercial 403", async () => {
    const analito = lista(await ok(U.a1, "GET", "/analitos?limit=20"))[0];
    afirmar(analito, "no hay analitos del catálogo antiguo");
    const muestra = lista(await ok(U.lqcJefe, "GET", `/muestras?limit=50&search=${encodeURIComponent(`Agua r1f ${sello}`)}`))[0]
      ?? { id: C.resPh.muestraId };
    afirmar(muestra?.id, "sin muestra en la OT");
    const r = await ok(U.a1, "POST", "/resultados", { muestraId: muestra.id, analitoId: analito.id, replicasTexto: "10,2 10,4 10,3" });
    C.rep = r;
    afirmar(r.estado === "capturado" && Number(r.promedio) > 10, JSON.stringify({ estado: r.estado, promedio: r.promedio }));
    await exigir(400, U.a1, "POST", `/resultados/${r.id}/recapturar`, { replicasTexto: "10,2 10,5 10,3" }, /motivo/);
    await exigir(400, U.a1, "POST", `/resultados/${r.id}/recapturar`, { replicasTexto: "10,2 10,5 10,3", motivo: "ok" }, /motivo/);
    await exigir(403, U.ventas, "POST", `/resultados/${r.id}/recapturar`, { replicasTexto: "10,2 10,5 10,3", motivo: "Comercial no captura" });
    const c = await ok(U.a1, "POST", `/resultados/${r.id}/recapturar`, { replicasTexto: "10,2 10,5 10,3", motivo: "Error de digitación en RN2 (r1f)" });
    afirmar(c.estado === "capturado" && Math.abs(Number(c.promedio) - 10.3333) < 0.001, `promedio ${c.promedio}`);
    const pl = await ok(U.lqcJefe, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    const e = pl.ensayos.find((x) => x.resultadoId === r.id);
    afirmar(e && e.historial.some((h) => h.motivo === "Error de digitación en RN2 (r1f)"), `historial ${JSON.stringify(e?.historial?.slice(-3))}`);
    return `promedio ${Number(r.promedio).toFixed(4)} → ${Number(c.promedio).toFixed(4)} con motivo en la planilla`;
  });

  await paso("Tras una devolución, la corrección no pide otro motivo (vale el de la devolución)", async () => {
    await exigir(400, U.rev, "POST", `/resultados/${C.rep.id}/devolver`, { motivo: "x" });
    await ok(U.rev, "POST", `/resultados/${C.rep.id}/devolver`, { motivo: "Repetir RN3, fuera de tolerancia (r1f)" });
    const c = await ok(U.a1, "POST", `/resultados/${C.rep.id}/recapturar`, { replicasTexto: "10,2 10,5 10,4" });
    afirmar(c.estado === "capturado", `estado ${c.estado}`);
    const pl = await ok(U.lqcJefe, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    const e = pl.ensayos.find((x) => x.resultadoId === C.rep.id);
    afirmar(e.historial.some((h) => h.motivo === "Repetir RN3, fuera de tolerancia (r1f)"), "el motivo de la devolución no quedó en la corrección");
  });

  await paso("Una sola captura: /captura redirige a /captura-ot (?corregir abre la corrección) y no está en el menú", async () => {
    const pagina = fs.readFileSync(path.join(RAIZ, "apps/web/app/(app)/captura/page.tsx"), "utf8");
    afirmar(/redirect\(/.test(pagina) && /\/captura-ot\?corregir=/.test(pagina) && !/use client/.test(pagina), "/captura no redirige");
    const nav = fs.readFileSync(path.join(RAIZ, "apps/web/lib/navegacion.ts"), "utf8");
    afirmar(!/href: "\/captura"/.test(nav), "/captura sigue en el menú");
    const cot = fs.readFileSync(path.join(RAIZ, "apps/web/app/(app)/captura-ot/page.tsx"), "utf8");
    afirmar(!/href=\{`\/captura\?/.test(cot) && !/href="\/captura"/.test(cot) && /<EditorReplicas/.test(cot), "captura-ot sigue enlazando a /captura");
  });

  await paso("Parámetros por defecto restituidos", async () => {
    await restaurar();
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    afirmar(cfg.circuito?.exigirFirma === true && cfg.circuito?.niveles === "lab_depto", JSON.stringify(cfg.circuito));
  });
}

main()
  .then(() => {
    console.log(`\n${pasos.length} pasos en verde.`);
    pararApi();
    process.exit(0);
  })
  .catch(async (e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    try { await restaurar(); } catch { /* la API puede no responder */ }
    pararApi();
    process.exit(1);
  });
