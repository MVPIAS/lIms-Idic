#!/usr/bin/env node
/**
 * Frente r1c · Cotización de punta a punta y encuesta de satisfacción (EP-00 F2–F4 y F9).
 *
 *   Numeración real (AAAA-NNNNN, correlativo atómico) → Ventas pide fechas y costo
 *   a LQC (Formulario de costeo FORM05 con número) y fechas a LPN → LPN no realiza
 *   el servicio (bloquea la firma; Ventas retira la solicitud) → LQC responde con
 *   el programa (FORM06) y el costeo → V°B° del Jefe LQC → devolución y nueva
 *   respuesta → V°B° del Jefe LQC y del Jefe DQO → envío a firma → el Jefe DCO
 *   devuelve → reenvío → el Jefe DCO firma (matriz COTIZACION) → documento
 *   (HTML y PDF) → envío al cliente (correo sin servidor: no queda registrado;
 *   entrega en mano: sí) → aceptación → OT de LQC → muestra, captura, revisión,
 *   aprobación, informe, firmas, entrega y cierre → nace la encuesta pendiente →
 *   Ventas la registra a mano → reporte por laboratorio.
 *
 * Cada regla se prueba con un perfil que puede y otro que no (403/409/400), y las
 * tarjetas de Mi bandeja cambian lo esperado.
 *
 * Uso:
 *   node scripts/verificacion/r1-r1c.js [--arrancar] [--base http://localhost:4731/api]
 *   --arrancar  lanza `node apps/api/dist/main.js` (compilar antes) con DATABASE_URL.
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA
 * de apps/api/src/auth/auth.service.ts. No escribe contraseñas. Deja datos de
 * prueba (cliente, cotizaciones, OT, factura, encuesta): úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4731/api");
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
  return { status: r.status, json, tipo: r.headers.get("content-type") || "" };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!ok) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
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

/* ---------------------------------------------------------- Mi bandeja --- */
async function bandeja(username) {
  const items = await ok(username, "GET", "/me/bandeja");
  return Object.fromEntries(items.map((i) => [i.clave, i]));
}
async function exigirBandeja(username, base, esperados) {
  const b = await bandeja(username);
  const partes = [];
  for (const [clave, delta] of Object.entries(esperados)) {
    afirmar(b[clave], `${username}: Mi bandeja no tiene la tarjeta «${clave}» (tiene ${Object.keys(b).join(", ")})`);
    const antes = base[clave]?.cantidad ?? 0;
    const ahora = b[clave].cantidad;
    afirmar(ahora - antes === delta, `${username}: «${b[clave].titulo}» = ${ahora}, esperado ${antes + delta}`);
    partes.push(`${clave} ${antes}→${ahora}`);
  }
  return `${username.replace("demo.", "")}: ${partes.join(", ")}`;
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
  const puerto = new URL(BASE).port || "4731";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4732",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1c-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ RECORRIDO === */
const U = {
  ventas: "demo.ventas",
  planif: "demo.planificacion",
  dco: "demo.dco.jefe",
  lqcJefe: "demo.lqc.jefe",
  lpnJefe: "demo.lpn.jefe",
  dqo: "demo.dqo.jefe",
  a1: "demo.lqc.analista1",
  rev: "demo.lqc.revisor",
  recepcion: "demo.recepcion",
  admin: "demo.admin",
};
const POSIBLES_FIRMANTES = [
  "demo.lqc.jefe", "demo.lqc.revisor", "demo.lqc.analista1", "demo.lqc.analista2", "demo.dqo.jefe", "demo.director",
  "demo.calidad", "demo.squ.jefe", "demo.dco.jefe",
];
const hoy = () => new Date().toISOString().slice(0, 10);

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const circuito = (u = U.ventas) => ok(u, "GET", `/cotizaciones/${C.cot.id}/circuito`);
  const solDe = async (unidad, u = U.ventas) => (await circuito(u)).solicitudes.find((s) => s.unidadCodigo === unidad);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of [...Object.values(U), ...POSIBLES_FIRMANTES]) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });
  const B0 = {};
  for (const u of [U.ventas, U.planif, U.dco, U.lqcJefe, U.dqo]) B0[u] = await bandeja(u);

  await paso("Datos: LQC, LPN, ensayo de pH y un cliente nuevo", async () => {
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    C.lpn = labs.find((u) => u.codigo === "LPN");
    afirmar(C.lqc && C.lpn, "LQC o LPN no figuran en /ot/laboratorios");
    const m = lista(await ok(U.lqcJefe, "GET", "/cat/metodos?search=251&limit=50")).find((x) => x.codigo === "251");
    afirmar(m?.ensayoId, "método 251 (pH) no encontrado");
    C.mPh = m;
    const cuerpoRut = String(60000000 + (Number(sello.slice(-7)) % 9999999));
    let s = 0, k = 2;
    for (let i = cuerpoRut.length - 1; i >= 0; i--) { s += Number(cuerpoRut[i]) * k; k = k === 7 ? 2 : k + 1; }
    const dv = 11 - (s % 11);
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    afirmar(cfg.circuito?.niveles === "lab_depto" && cfg.circuito?.exigirFirma === true, `parámetros del circuito: ${JSON.stringify(cfg.circuito)}`);
    C.cliente = await ok(U.ventas, "POST", "/clientes", {
      rut: `${cuerpoRut}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`, razonSocial: `Cliente prueba r1c ${sello}`,
      tipo: (cfg.parametros.tipo_cliente.find((t) => t.codigo === "particular") ?? cfg.parametros.tipo_cliente[0]).codigo, email: "r1c@example.cl",
    });
    return `${C.cliente.razonSocial} · parámetros ${JSON.stringify(cfg.circuito)}`;
  });

  /* ---------------- Numeración */
  const nuevaCot = (ref, extra = {}) => ok(U.ventas, "POST", "/cotizaciones", {
    clienteId: C.cliente.id, formato: "NORMAL", referencia: ref, plazoEntregaDias: 10,
    lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 2 }], ...extra,
  });
  await paso("Numeración real: AAAA-NNNNN, correlativa y sin choques en altas simultáneas", async () => {
    C.cot = await nuevaCot(`r1c ${sello}`);
    C.cot2 = await nuevaCot(`r1c sin firma ${sello}`);
    const re = /^(\d{4})-(\d{5,})$/;
    const a = re.exec(C.cot.codigo), b = re.exec(C.cot2.codigo);
    afirmar(a && b, `formato ${C.cot.codigo} / ${C.cot2.codigo}`);
    afirmar(a[1] === String(new Date().getFullYear()), `año ${a[1]}`);
    afirmar(Number(b[2]) === Number(a[2]) + 1, `no correlativo: ${C.cot.codigo} → ${C.cot2.codigo}`);
    const lote = await Promise.all([1, 2, 3, 4, 5].map((i) => nuevaCot(`r1c paralela ${i} ${sello}`)));
    const cods = lote.map((x) => x.codigo);
    afirmar(new Set(cods).size === 5, `códigos repetidos: ${cods.join(", ")}`);
    for (const x of lote) await ok(U.ventas, "POST", `/cotizaciones/${x.id}/anular`, { motivo: "Prueba de numeración simultánea" });
    await exigir(403, U.a1, "POST", "/cotizaciones", { clienteId: C.cliente.id, formato: "NORMAL", lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 1 }] });
    return `${C.cot.codigo}, ${C.cot2.codigo} · simultáneas ${cods.join(", ")} · analista 403`;
  });

  await paso("Ruta inicial: 6 etapas, sin consulta → enviar a firma; le toca al ejecutivo", async () => {
    const c = await circuito();
    afirmar(c.ruta.etapas.map((e) => e.clave).join(",") === "elaboracion,costeo,vb,firma,envio,aceptacion", "etapas");
    afirmar(c.ruta.etapaActual === "firma", `etapa ${c.ruta.etapaActual}`);
    afirmar(c.ruta.siguiente.puedoActuar === true, "Ventas no tiene el botón");
    afirmar((await circuito(U.lqcJefe)).ruta.siguiente.puedoActuar === false, "el Jefe LQC no debería tener el botón");
    afirmar(c.firmantes.length >= 1, "la matriz COTIZACION no resuelve firmantes");
    return `«${c.ruta.siguiente.texto}» · firmantes ${c.firmantes.join(", ")}`;
  });

  /* ---------------- Solicitudes al laboratorio */
  await paso("Ventas pide costeo a LQC (FORM05 numerado) y fechas a LPN; duplicado 409; analista 403", async () => {
    await exigir(403, U.a1, "POST", `/cotizaciones/${C.cot.id}/solicitudes-laboratorio`, { unidadId: C.lqc.id, tipoServicio: "no_estandar" });
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/solicitudes-laboratorio`, { unidadId: C.lqc.id, tipoServicio: "no_estandar", comentario: "Favor costear y dar fecha" });
    afirmar(r.numero === `FORM-${C.cot.codigo}/001`, `número ${r.numero}`);
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot.id}/solicitudes-laboratorio`, { unidadId: C.lqc.id, tipoServicio: "estandar" });
    const r2 = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/solicitudes-laboratorio`, { unidadId: C.lpn.id, tipoServicio: "estandar" });
    afirmar(r2.numero === null, "una solicitud de fechas no lleva número de formulario");
    const dir = (await ok(U.ventas, "GET", "/ot/laboratorios")).find((u) => u.codigo === "DCO");
    if (dir) await exigir(400, U.ventas, "POST", `/cotizaciones/${C.cot.id}/solicitudes-laboratorio`, { unidadId: dir.id, tipoServicio: "estandar" });
    return `${r.numero} a LQC · fechas a LPN`;
  });

  await paso("Ruta: costeo, le toca al Jefe LQC (botón solo para él); no se envía a firma (409)", async () => {
    const c = await circuito();
    afirmar(c.ruta.etapaActual === "costeo", `etapa ${c.ruta.etapaActual}`);
    afirmar(c.ruta.siguiente.leToca.rol === "Jefe de Laboratorio", JSON.stringify(c.ruta.siguiente.leToca));
    afirmar((await circuito(U.lqcJefe)).ruta.siguiente.puedoActuar === true, "el Jefe LQC no tiene el botón");
    afirmar((await circuito(U.lpnJefe)).ruta.siguiente.puedoActuar === false, "el Jefe LPN no debería tener el botón (la solicitud pendiente es de LQC)");
    afirmar((await circuito(U.ventas)).ruta.siguiente.puedoActuar === false, "Ventas no debería tener el botón");
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    return `«${c.ruta.siguiente.texto}»`;
  });

  await paso("Mi bandeja y «Cotizaciones por responder»: cada jefe ve solo su laboratorio; el analista no entra (403)", async () => {
    const t = await exigirBandeja(U.lqcJefe, B0[U.lqcJefe], { cotizaciones_por_responder: 1 });
    const lqc = (await ok(U.lqcJefe, "GET", "/cotizaciones/solicitudes-laboratorio?estado=por_responder")).data;
    const lpn = (await ok(U.lpnJefe, "GET", "/cotizaciones/solicitudes-laboratorio?estado=por_responder")).data;
    afirmar(lqc.some((s) => s.cotizacionId === C.cot.id && s.unidadCodigo === "LQC"), "LQC no ve su solicitud");
    afirmar(lqc.every((s) => s.unidadCodigo === "LQC"), "LQC ve solicitudes de otros laboratorios");
    afirmar(lpn.some((s) => s.cotizacionId === C.cot.id) && lpn.every((s) => s.unidadCodigo === "LPN"), "LPN no ve solo lo suyo");
    await exigir(403, U.a1, "GET", "/cotizaciones/solicitudes-laboratorio"); // sin cotizacion.ver
    return t;
  });

  await paso("LPN responde que no realiza el servicio (comentario obligatorio): bloquea la firma; Ventas retira la solicitud", async () => {
    const s = await solDe("LPN");
    await exigir(400, U.lpnJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "rechazar" });
    await ok(U.lpnJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "rechazar", comentario: "No contamos con el equipo" });
    const c = await circuito();
    afirmar(c.ruta.avisos.some((a) => /no realiza el servicio/.test(a)), "sin aviso del rechazo");
    afirmar(c.faltantesFirma.some((f) => /no realiza el servicio/.test(f)), "el rechazo no bloquea la firma");
    await exigir(403, U.lpnJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/retirar`, { motivo: "No debe poder" });
    await ok(U.ventas, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/retirar`, { motivo: "LPN no realiza el servicio" });
    afirmar(!(await solDe("LPN")), "la solicitud retirada sigue en la cotización");
  });

  const programa = { plazoEntregaDias: 12, fechaInicio: hoy(), etapas: [{ actividad: "Recepción y preparación", recursos: "Analista LQC" }, { actividad: "Ensayo de pH" }] };
  const costeo = {
    horasHombre: [{ tipo: "civil", categoria: "Analista", horas: 4, valorHora: 18500 }],
    horasMaquina: [{ equipo: "pH-metro", horas: 2, valorHora: 12000 }],
    otros: [{ descripcion: "Reactivos", monto: 15000, moneda: "CLP" }],
    condiciones: "Muestra de 500 ml como mínimo",
  };
  await paso("LQC responde (FORM06 + FORM05): fuera de alcance 403, sin permiso 403, sin costeo 400; luego no responde dos veces (409)", async () => {
    const s = await solDe("LQC");
    await exigir(403, U.lpnJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "aceptar", programa, costeo });
    await exigir(403, U.a1, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "aceptar", programa, costeo });
    await exigir(400, U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "aceptar", programa });
    await exigir(400, U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "aceptar", programa: { ...programa, plazoEntregaDias: 0 }, costeo });
    const r = await ok(U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "aceptar", programa, costeo });
    afirmar(r.estado === "respondido", `estado ${r.estado}`);
    afirmar(r.resultado.cdt === 4 * 18500 + 2 * 12000 + 15000, `CDT ${r.resultado.cdt}`);
    afirmar(r.resultado.cfa === Math.round(r.resultado.cdt * 0.12) && r.resultado.precioParticular === Math.round(r.resultado.ct * 1.2), JSON.stringify(r.resultado));
    await exigir(409, U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, { respuesta: "aceptar", programa, costeo });
    return `CDT ${r.resultado.cdt} · CFA ${r.resultado.cfa} · CT ${r.resultado.ct} · particular ${r.resultado.precioParticular}`;
  });

  await paso("V°B°: le toca al Jefe LQC (no al de LPN ni al de DQO); devuelve con motivo y el laboratorio responde de nuevo", async () => {
    let s = await solDe("LQC");
    afirmar(s.vb?.nivel === "lab", `nivel ${JSON.stringify(s.vb)}`);
    const c = await circuito();
    afirmar(c.ruta.etapaActual === "vb", `etapa ${c.ruta.etapaActual}`);
    afirmar((await circuito(U.lqcJefe)).ruta.siguiente.puedoActuar === true, "el Jefe LQC no tiene el botón");
    afirmar((await circuito(U.dqo)).ruta.siguiente.puedoActuar === false, "el Jefe DQO no debería tener el botón aún");
    const b = await exigirBandeja(U.lqcJefe, B0[U.lqcJefe], { cotizaciones_por_responder: 0, cotizaciones_vb_lab: 1 });
    await exigir(403, U.lpnJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "dar" });
    await exigir(403, U.dqo, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "dar" });
    await exigir(403, U.ventas, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "dar" });
    await exigir(400, U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "devolver" });
    await ok(U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "devolver", comentario: "Falta la hora del Jefe de Laboratorio" });
    s = await solDe("LQC");
    afirmar(s.estado === "devuelto" && s.devueltaMotivo, `estado ${s.estado}`);
    await ok(U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/responder`, {
      respuesta: "aceptar_con_comentario", comentario: "Se agrega la revisión del jefe", programa,
      costeo: { ...costeo, horasHombre: [...costeo.horasHombre, { tipo: "civil", categoria: "Jefe de laboratorio", horas: 1, valorHora: 25000 }] },
    });
    return b;
  });

  await paso("V°B° del laboratorio y luego del departamento (Jefe DQO); ya no hay V°B° pendiente", async () => {
    let s = await solDe("LQC");
    await ok(U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "dar", comentario: "Conforme" });
    s = await solDe("LQC");
    afirmar(s.estado === "vb_lab" && s.vb?.nivel === "depto", `estado ${s.estado}`);
    afirmar(s.vb.personas.some((p) => p.id === sesiones[U.dqo].id), `el V°B° del departamento no es del Jefe DQO: ${s.vb.personas.map((p) => p.nombre)}`);
    const b = await exigirBandeja(U.dqo, B0[U.dqo], { cotizaciones_vb_depto: 1 });
    await exigir(403, U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "dar" });
    await ok(U.dqo, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "dar" });
    s = await solDe("LQC");
    afirmar(s.estado === "aprobado" && s.vbLabPorNombre && s.vbDeptoPorNombre, `estado ${s.estado}`);
    await exigir(409, U.dqo, "POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/vb`, { accion: "dar" });
    const c = await circuito();
    afirmar(c.ruta.etapaActual === "firma" && c.faltantesFirma.length === 0, `etapa ${c.ruta.etapaActual} · ${c.faltantesFirma}`);
    return `${b} · V°B° ${s.vbLabPorNombre} → ${s.vbDeptoPorNombre}`;
  });

  /* ---------------- Firma del Jefe DCO */
  await paso("Sin firma no se acepta (409) ni se envía al cliente (409); se edita mientras está en elaboración", async () => {
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, { tipo: "OC", numero: "OC-X", unidadPrincipalId: C.lqc.id });
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-cliente`, { medio: "mano", observacion: "No debe" });
    await exigir(409, U.ventas, "POST", `/mensajeria/cotizacion/${C.cot.id}`, { destinatarios: ["r1c@example.cl"] });
    await ok(U.ventas, "PATCH", `/cotizaciones/${C.cot.id}`, { referencia: `r1c ${sello} (corregida)` });
    const html = await llamar(U.ventas, "GET", `/cotizaciones/${C.cot.id}/html`);
    afirmar(html.status === 200 && /EN PROCESO DE FIRMA/.test(html.json) && html.json.includes(C.cot.codigo), "la vista previa no avisa que no está firmada");
    afirmar(!/Favor costear|Analista LQC/.test(html.json), "la vista previa muestra datos internos del costeo");
  });

  await paso("Ventas envía a firma (analista 403); ya no se edita (409); tarjeta del Jefe DCO", async () => {
    await exigir(403, U.a1, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await exigir(409, U.ventas, "PATCH", `/cotizaciones/${C.cot.id}`, { referencia: "No debe" });
    const c = await circuito(U.dco);
    afirmar(c.ruta.siguiente.leToca.rol === "Jefe del Departamento Comercial" && c.ruta.siguiente.puedoActuar, "al Jefe DCO no le toca firmar");
    afirmar((await circuito(U.dqo)).ruta.siguiente.puedoActuar === false, "el Jefe DQO no debería tener el botón");
    const tarjetas = await bandeja(U.dqo);
    afirmar(!tarjetas.cotizaciones_por_firmar, "el Jefe DQO ve «Cotizaciones por firmar»");
    return exigirBandeja(U.dco, B0[U.dco], { cotizaciones_por_firmar: 1 });
  });

  await paso("Firma según la matriz COTIZACION: Ventas 403, Jefe DQO 403; el Jefe DCO devuelve con motivo", async () => {
    await exigir(403, U.ventas, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    await exigir(403, U.dqo, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    await exigir(400, U.dco, "POST", `/cotizaciones/${C.cot.id}/devolver-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${C.cot.id}/devolver-firma`, { motivo: "Ajustar la referencia al oficio del cliente" });
    const c = await circuito();
    afirmar(c.cotizacion.firmaEstado === "devuelta" && c.ruta.siguiente.leToca.rol === "Ejecutivo de Ventas", `firma ${c.cotizacion.firmaEstado}`);
    await exigir(409, U.dco, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    return exigirBandeja(U.ventas, B0[U.ventas], { cotizaciones_devueltas_firma: 1 });
  });

  await paso("Ventas corrige y reenvía; el Jefe DCO firma: queda emitida, con validez desde hoy", async () => {
    await ok(U.ventas, "PATCH", `/cotizaciones/${C.cot.id}`, { referencia: `OF 123 · r1c ${sello}` });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    const r = await ok(U.dco, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    const d = await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}`);
    afirmar(d.firmaEstado === "firmada" && d.firmadaPorNombre, `firma ${d.firmaEstado}`);
    afirmar(String(d.fechaEmision).slice(0, 10) <= hoy() && String(d.validaHasta).slice(0, 10) > hoy(), `emisión ${d.fechaEmision} · válida ${d.validaHasta}`);
    await exigir(409, U.ventas, "PATCH", `/cotizaciones/${C.cot.id}`, { referencia: "No debe" });
    const b = await exigirBandeja(U.ventas, B0[U.ventas], { cotizaciones_devueltas_firma: 0, cotizaciones_firmadas_sin_enviar: 1 });
    await exigirBandeja(U.dco, B0[U.dco], { cotizaciones_por_firmar: 0 });
    return `${r.mensaje} · ${b}`;
  });

  await paso("Documento: vista previa con la firma y PDF", async () => {
    const html = await llamar(U.ventas, "GET", `/cotizaciones/${C.cot.id}/html`);
    afirmar(html.status === 200 && !/EN PROCESO DE FIRMA/.test(html.json) && /Firmado por/.test(html.json), "la vista previa no muestra la firma");
    const pdf = await llamar(U.ventas, "GET", `/cotizaciones/${C.cot.id}/pdf`);
    afirmar(pdf.status === 200 && pdf.tipo.includes("application/pdf") && String(pdf.json).startsWith("%PDF"), `PDF ${pdf.status} ${pdf.tipo}`);
    return `PDF ${String(pdf.json).length} bytes`;
  });

  /* ---------------- Envío al cliente */
  await paso("Envío: por correo sin servidor de correo no queda registrado; la entrega en mano sí; analista 403", async () => {
    await exigir(403, U.a1, "POST", `/cotizaciones/${C.cot.id}/enviar-cliente`, { medio: "mano", observacion: "x" });
    await exigir(400, U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-cliente`, { medio: "correo" });
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-cliente`, { medio: "correo", destinatarios: ["r1c@example.cl"] });
    let c = await circuito();
    if (r.ok === false) afirmar(!c.cotizacion.enviadaAt, "un correo fallido quedó como enviado");
    await exigir(400, U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-cliente`, { medio: "mano" });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-cliente`, { medio: "mano", observacion: "Entregada a J. P., encargado de compras" });
    c = await circuito();
    afirmar(c.cotizacion.enviadaAt && c.cotizacion.enviadaMedio === "mano", "el envío no quedó registrado");
    afirmar(c.ruta.etapaActual === "aceptacion", `etapa ${c.ruta.etapaActual}`);
    afirmar(c.eventos.some((e) => e.accion === "enviada_cliente"), "sin bitácora del envío");
    const l = await ok(U.ventas, "GET", `/cotizaciones?q=${encodeURIComponent(C.cot.codigo)}&estado=abierta&firma=firmada&enviada=1`);
    afirmar(l.data.some((x) => x.id === C.cot.id && x.enviadaAt), "la lista no muestra el envío");
    const b = await exigirBandeja(U.ventas, B0[U.ventas], { cotizaciones_firmadas_sin_enviar: 0 });
    return `correo: ${r.ok === false ? `no enviado (${(r.error || "").slice(0, 60)})` : "enviado"} · mano registrado · ${b}`;
  });

  await paso("Una cotización sin firmar no se acepta ni se envía (409); la de la prueba se anula", async () => {
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot2.id}/aceptar`, { tipo: "OC", numero: "OC-X", unidadPrincipalId: C.lqc.id });
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot2.id}/enviar-cliente`, { medio: "mano", observacion: "x" });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot2.id}/anular`, { motivo: "Cotización de prueba del circuito" });
  });

  /* ---------------- Aceptación → OT */
  await paso("Ventas registra la aceptación de la cotización firmada: nace la OT de LQC", async () => {
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-R1C-${sello}`, fecha: hoy(), conCobro: true, unidadPrincipalId: C.lqc.id,
    });
    C.ot = await ok(U.lqcJefe, "GET", `/ot/${r.ot.id}`);
    const c = await circuito();
    afirmar(c.ruta.etapaActual === null && c.ruta.siguiente === null, `etapa ${c.ruta.etapaActual}`);
    afirmar(c.ruta.etapas.find((e) => e.clave === "aceptacion").detalle === `OT ${C.ot.codigo}`, "la etapa no muestra la OT");
    return C.ot.codigo;
  });

  /* ---------------- Laboratorio hasta el cierre */
  await paso("La OT recorre el laboratorio: muestra, captura, revisión, aprobación e informe", async () => {
    await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: "Agua (r1c)", metodoIds: [C.mPh.id] }] });
    await ok(U.lqcJefe, "PUT", `/ot/${C.ot.id}/analistas`, { usuarioIds: [sesiones[U.a1].id] });
    for (const r of (await ok(U.lqcJefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados)
      await ok(U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "7,2" });
    await ok(U.rev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    await ok(U.lqcJefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    const pl = [...lista(await ok(U.lqcJefe, "GET", "/plantillas?limit=100&search=BolAn")), ...lista(await ok(U.lqcJefe, "GET", "/plantillas?limit=200"))];
    const plantilla = pl.find((p) => p.repid === "BolAn") ?? pl.find((p) => p.tipo === "BOLETIN" && p.activo !== false);
    afirmar(plantilla, "no hay plantilla de boletín");
    const r = await ok(U.lqcJefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: plantilla.id });
    C.docId = (r.certificado ?? r.documento ?? r).id ?? r.certificadoId;
    afirmar(C.docId, "la emisión no devolvió el documento");
    return `documento ${C.docId}`;
  });

  await paso("Firmas del informe según su matriz, entrega y cierre de la OT", async () => {
    const porId = Object.fromEntries(Object.entries(sesiones).map(([u, s]) => [s.id, u]));
    const circ = await ok(U.lqcJefe, "GET", `/informes/${C.docId}/circuito`);
    const firmantes = new Set();
    for (const orden of [...new Set((circ.pasos ?? []).map((p) => p.orden))].sort((a, b) => a - b)) {
      for (const p of circ.pasos.filter((x) => x.orden === orden && x.estado !== "omitido")) {
        const cand = (p.responsables ?? []).map((r) => porId[r.usuarioId]).filter(Boolean);
        const quien = cand.find((u) => !firmantes.has(u)) ?? cand[0];
        afirmar(quien, `paso ${orden} sin responsable entre los perfiles de prueba`);
        await ok(quien, "POST", `/informes/${C.docId}/firmar`, {});
        firmantes.add(quien);
      }
    }
    await ok(U.planif, "POST", `/informes/${C.docId}/entregar`, { medio: "correo", destinatario: "r1c@example.cl" });
    await ok(U.planif, "POST", `/ot/${C.ot.id}/cerrar`, {});
    const ot = await ok(U.lqcJefe, "GET", `/ot/${C.ot.id}`);
    afirmar(ot.estado === "cerrada", `OT ${ot.estado}`);
    return `firmó ${[...firmantes].map((u) => u.replace("demo.", "")).join(" → ")} · OT cerrada`;
  });

  /* ---------------- Encuesta de satisfacción */
  await paso("Al cerrar la OT nace su encuesta pendiente (una sola) y aparece en Mi bandeja de Comercial", async () => {
    const r = await ok(U.ventas, "GET", `/encuestas?estado=pendiente&q=${encodeURIComponent(C.ot.codigo)}`);
    const filas = r.data.filter((e) => e.otId === C.ot.id);
    afirmar(filas.length === 1, `encuestas de la OT: ${filas.length}`);
    C.enc = filas[0];
    afirmar(C.enc.unidadCodigo === "LQC" && C.enc.cotizacionCodigo === C.cot.codigo, JSON.stringify(C.enc).slice(0, 200));
    const b1 = await exigirBandeja(U.ventas, B0[U.ventas], { encuestas_pendientes: 1 });
    const b2 = await exigirBandeja(U.planif, B0[U.planif], { encuestas_pendientes: 1 });
    return `${C.enc.codigo} · ${b1} · ${b2}`;
  });

  await paso("Alcance de las encuestas: el Jefe LQC la ve, el de LPN no (lista y detalle 403); el analista no entra", async () => {
    const lqc = await ok(U.lqcJefe, "GET", `/encuestas?q=${encodeURIComponent(C.ot.codigo)}`);
    afirmar(lqc.data.some((e) => e.id === C.enc.id), "el Jefe LQC no ve la encuesta");
    const lpn = await ok(U.lpnJefe, "GET", "/encuestas?limit=200");
    afirmar(!lpn.data.some((e) => e.id === C.enc.id) && lpn.data.every((e) => e.unidadCodigo === "LPN"), "el Jefe LPN ve encuestas de otros laboratorios");
    await exigir(403, U.lpnJefe, "GET", `/encuestas/${C.enc.id}`);
    await exigir(403, U.a1, "GET", "/encuestas");
  });

  await paso("Registro manual: el Jefe LQC no puede (403); valor fuera de escala 400; falta una respuesta 400; Ventas la registra", async () => {
    const det = await ok(U.ventas, "GET", `/encuestas/${C.enc.id}`);
    afirmar(det.preguntas.map((p) => p.codigo).join(",") === "C01,C02,C03,C04" && det.preguntas.every((p) => p.escala.join(",") === "1,3,5,7"), "preguntas por defecto distintas al formulario del Sistema Comercial");
    const base = { comentario: "Buena atención", nombreRespondente: "J. P.", cargoRespondente: "Encargado de compras", medio: "telefono", fechaRespuesta: hoy() };
    const resp = [{ codigo: "C01", valor: 7 }, { codigo: "C02", valor: 5 }, { codigo: "C03", valor: 5 }, { codigo: "C04", valor: 7 }];
    await exigir(403, U.lqcJefe, "POST", `/encuestas/${C.enc.id}/registrar`, { ...base, respuestas: resp });
    await exigir(400, U.ventas, "POST", `/encuestas/${C.enc.id}/registrar`, { ...base, respuestas: [{ codigo: "C01", valor: 4 }, ...resp.slice(1)] });
    await exigir(400, U.ventas, "POST", `/encuestas/${C.enc.id}/registrar`, { ...base, respuestas: resp.slice(1) });
    const r = await ok(U.ventas, "POST", `/encuestas/${C.enc.id}/registrar`, { ...base, respuestas: resp });
    afirmar(r.promedio === 6, `promedio ${r.promedio}`);
    await exigir(409, U.ventas, "POST", `/encuestas/${C.enc.id}/registrar`, { ...base, respuestas: resp });
    await exigir(403, U.lqcJefe, "POST", `/encuestas/${C.enc.id}/sin-respuesta`, { motivo: "No debe poder" });
    await exigir(409, U.planif, "POST", `/encuestas/${C.enc.id}/sin-respuesta`, { motivo: "Ya está registrada" });
    const b = await exigirBandeja(U.ventas, B0[U.ventas], { encuestas_pendientes: 0 });
    return `promedio ${r.promedio} · ${b}`;
  });

  await paso("Reporte por laboratorio y preguntas editables solo por Administración", async () => {
    const rep = await ok(U.ventas, "GET", `/encuestas/reporte?desde=${hoy()}`);
    const lqc = rep.laboratorios.find((l) => l.unidad === "LQC");
    afirmar(lqc && lqc.registradas >= 1 && lqc.promedio !== null && lqc.porPregunta.length === 4, `reporte ${JSON.stringify(lqc)}`);
    const ps = await ok(U.ventas, "GET", "/encuestas/preguntas");
    const cuerpo = { preguntas: ps.map(({ codigo, texto, escala, orden, obligatoria, activo }) => ({ codigo, texto, escala, orden, obligatoria, activo })) };
    await exigir(403, U.ventas, "PUT", "/encuestas/preguntas", cuerpo);
    await exigir(400, U.admin, "PUT", "/encuestas/preguntas", { preguntas: [{ ...cuerpo.preguntas[0], escala: [5] }] });
    await ok(U.admin, "PUT", "/encuestas/preguntas", cuerpo);
    return `LQC: ${lqc.registradas} registrada(s), promedio ${lqc.promedio}, tasa ${lqc.tasaRespuesta} %`;
  });

  await paso("Bitácora de la cotización completa", async () => {
    const c = await circuito();
    const acciones = c.eventos.map((e) => e.accion);
    for (const a of ["solicitud", "laboratorio_rechaza", "solicitud_retirada", "respuesta_laboratorio", "vb_lab_devuelto", "vb_lab", "vb_depto", "enviada_a_firma", "firma_devuelta", "firmada", "enviada_cliente"])
      afirmar(acciones.includes(a), `falta «${a}» en la bitácora`);
    return `${c.eventos.length} eventos`;
  });
}

main()
  .then(() => {
    console.log(`\n${pasos.length} pasos en verde.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
