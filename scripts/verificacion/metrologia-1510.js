#!/usr/bin/env node
/**
 * Verificación contra una API real de Metrología según la información del LMT del
 * 15-10-2026 (docs/FLUJO_METROLOGIA.md): motores ITM03 e ITV05, correcciones según la
 * respuesta del laboratorio, maestro de patrones (bloqueo si vencido), CMC del maestro,
 * avisos de fechas, circuito metrólogo → jefe LMT (o subrogante) → jefe de departamento
 * con habilitación por magnitud, numeración por magnitud, certificado de 2 páginas sin
 * «cumple», verificación pública del código y reemisión con reemplazo. Cada regla con el
 * perfil que debe poder y con uno que no.
 *
 * Uso:
 *   node scripts/verificacion/metrologia-1510.js [--arrancar] [--base http://localhost:4221/api]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA.
 * Deja calibraciones de prueba en la base y consume números de certificado: úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4221/api");
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
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: CLAVE }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  sesiones[username] = { token: j.accessToken };
  return sesiones[username];
}
async function llamar(username, metodo, ruta, cuerpo) {
  const headers = {};
  if (username) headers.authorization = `Bearer ${(await login(username)).token}`;
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  if ((r.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; } }
  return { status: r.status, json, buf, tipo: r.headers.get("content-type") || "" };
}
const msg = (j) => (j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!ok) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);

const pasos = [];
let actual = null;
async function paso(nombre, fn) {
  actual = nombre;
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
function afirmar(cond, texto) { if (!cond) throw new Error(texto); }

/* ------------------------------------------------------------ arranque --- */
let hijo = null;
async function esperarApi(ms = 60000) {
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
  const puerto = new URL(BASE).port || "4221";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-metrologia-1510-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ RECORRIDO === */
const METRO = "demo.lmt.analista1";   // habilitado: par, masa, volumen
const METRO_L = "demo.lmt.analista2"; // habilitado: longitud
const JEFE = "demo.lmt.jefe";         // titular del LMT
const SUBR = "demo.sem.jefe";         // subrogante del LMT (como en el registro real)
const DEPTO = "demo.dsa.jefe";        // jefe del departamento
const SAM = "demo.sam.jefe";          // jefe de sección: no figura en la matriz del certificado
const PLANIF = "demo.planificacion";  // registra las OT

/*
 * EP-04 (entrega R1): toda calibración nace del instrumento RECIBIDO de una OT
 * (no hay calibración suelta). Cada calibración de este recorrido usa su propia
 * OT del LMT con un ítem recibido en las fechas de la planilla.
 */
async function prepararOt(C) {
  const labs = await ok(PLANIF, "GET", "/ot/laboratorios");
  C.lmt = (Array.isArray(labs) ? labs : labs.data ?? []).find((u) => u.codigo === "LMT");
  const cl = await ok("demo.admin", "GET", "/clientes?limit=5");
  C.clienteId = (Array.isArray(cl) ? cl : cl.data ?? [])[0]?.id;
  afirmar(C.lmt && C.clienteId, "faltan el LMT o un cliente");
}
async function itemRecibido(C, ins = {}, fechas = {}) {
  const ot = await ok(PLANIF, "POST", "/ot", {
    clienteId: C.clienteId, unidadPrincipalId: C.lmt.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: "Prueba Metrología 15-10",
    ...(fechas.fechaOt ? { fechaIngreso: `${fechas.fechaOt}T09:00:00-04:00` } : {}),
  });
  const it = await ok(JEFE, "POST", `/ot/${ot.id}/instrumentos`, {
    descripcion: ins.item || "Instrumento de prueba", marca: ins.marca, modelo: ins.modelo, serie: ins.serie, idEspecial: ins.idEspecial,
    capacidad: ins.cap, resolucion: ins.res, rango: ins.rango,
  });
  const recepcion = { fechaHora: fechas.fechaRecepcion ? `${fechas.fechaRecepcion}T10:00` : new Date().toISOString(), entregadoPor: "Cliente de prueba",
    estadoFisico: "bueno", ubicacion: "Estante de recepción", calibrable: true };
  if (fechas.recepcionPrevia) {
    // R15 L2: la recepción no puede ser anterior a la fecha de la OT (antes solo era un aviso).
    const e = await exigir(400, JEFE, "POST", `/ot/${ot.id}/instrumentos/${it.data.id}/recepcion`, { ...recepcion, fechaHora: `${fechas.recepcionPrevia}T10:00` });
    afirmar(/anterior a la fecha de la OT/.test(msg(e)), msg(e));
  }
  await ok(JEFE, "POST", `/ot/${ot.id}/instrumentos/${it.data.id}/recepcion`, recepcion);
  return it.data.id;
}

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  await prepararOt(C);

  await paso("Paridad: 1531 + 239 + 483 valores idénticos a las planillas (M-3947 y V-5920 incluidos)", async () => {
    const p = await ok(METRO, "GET", "/metrologia/motores/paridad");
    const m = p.casos.find((c) => c.caso === "M-3947"), v = p.casos.find((c) => c.caso === "V-5920");
    afirmar(m && m.identicos === 167 && m.comparados === 167, `M-3947 ${JSON.stringify(m)}`);
    afirmar(v && v.identicos === 72 && v.comparados === 72, `V-5920 ${JSON.stringify(v)}`);
    afirmar(p.identicos === p.comparados && p.comparados === 1531 + 239 + 483, `${p.identicos}/${p.comparados}`);
    return `${p.identicos}/${p.comparados}`;
  });

  await paso("C6: correcciones según la respuesta del laboratorio (por defecto las pedidas; rechazada → 400)", async () => {
    const m = (await ok(METRO, "GET", "/metrologia/motores")).data;
    const itm02 = m.find((x) => x.it === "ITM02"), itl07 = m.find((x) => x.it === "ITL07");
    afirmar(itm02.opcionesPorDefecto.fix === true, "ITM02: M1 no viene activada");
    afirmar(itl07.opciones.find((o) => o.clave === "sqrt").decision === "rechazada", "L17 no figura rechazada");
    const ej = (await ok(METRO_L, "GET", "/metrologia/motores/ITL07/ejemplo")).data;
    await exigir(400, METRO_L, "POST", "/metrologia/motores/ITL07/calcular", { datos: ej.datos, opciones: { sqrt: true } });
    await ok(METRO_L, "POST", "/metrologia/motores/ITL07/calcular", { datos: ej.datos, opciones: { full: true } });
    return "M1 activada por defecto · L17 rechazada (400) · L18 aceptada";
  });

  await paso("ITM03 e ITV05: el formulario abre vacío y el caso real reproduce la planilla", async () => {
    const pl = (await ok(METRO, "GET", "/metrologia/motores/ITM03/plantilla")).data;
    afirmar(pl.datos.items[0].nom === null, "la plantilla ITM03 trae valores");
    const e3 = (await ok(METRO, "GET", "/metrologia/motores/ITM03/ejemplo")).data;
    C.datosM = e3.datos; C.controlM = e3.control;
    const r3 = (await ok(METRO, "POST", "/metrologia/motores/ITM03/calcular", { datos: e3.datos, opciones: {} })).data;
    afirmar(JSON.stringify(r3.resultado.rows.map((x) => x.certU)) === JSON.stringify(["5 mg", "10 mg", "25 mg", "25 mg"]), "U asignadas distintas");
    const e5 = (await ok(METRO, "GET", "/metrologia/motores/ITV05/ejemplo")).data;
    afirmar(!("cmcTabla" in e5.datos), "la CMC de ITV05 no sale del maestro");
    C.datosV = e5.datos; C.controlV = e5.control;
    const r5 = (await ok(METRO, "POST", "/metrologia/motores/ITV05/calcular?fecha=2026-09-03", { datos: e5.datos, opciones: {} })).data;
    afirmar(JSON.stringify(r5.resultado.rows.map((x) => x.cF)) === "[0.13,0.24,0.49]", `U µL ${r5.resultado.rows.map((x) => x.cF)}`);
    afirmar(r5.resumen.puntos.every((p) => p.conforme === null), "el resumen trae veredicto");
    return "M-3947: 5/10/25/25 mg · V-5920: 0,13/0,24/0,49 µL";
  });

  await paso("C5: la CMC de balanzas sale del maestro LC 001 Mod. 2 (no de constantes en código)", async () => {
    const cmc = (await ok(METRO, "GET", "/metrologia/cmc?proceso=ITM02")).data;
    const f = cmc.find((x) => x.rango_min === 100 && x.rango_max === 200);
    afirmar(f && f.a === 0.12 && /LC 001 Mod\. 2/.test(f.version), "fila 100–200 g no es 0,12 mg");
    const ej = (await ok(METRO, "GET", "/metrologia/motores/ITM02/ejemplo")).data;
    afirmar(!("mcm" in ej.datos), "el ejemplo ITM02 aún trae la CMC escrita");
    const r = (await ok(METRO, "POST", "/metrologia/motores/ITM02/calcular", { datos: ej.datos, opciones: {} })).data;
    afirmar((r.resumen.cmc ?? []).some((v) => /LC 001/.test(v)), "el resumen no declara la versión de la CMC");
    return `${cmc.length} filas ITM02 · versión ${r.resumen.cmc.join(", ")}`;
  });

  await paso("Maestro de patrones (Anexo02): bloqueo si está vencido a la fecha de calibración, aviso si vence pronto", async () => {
    const p = (await ok(METRO, "GET", "/metrologia/patrones?fecha=2026-07-24")).data;
    C.pF1 = p.find((x) => x.serie === "158901"); // juego 1 mg a 200 g F1 (M-3931)
    C.p500 = p.find((x) => x.serie === "15868"); // 500 g F1
    C.pMic = p.find((x) => x.serie === "0138696"); // micrómetro (vence 24-11-2026)
    afirmar(C.pF1 && C.p500 && C.pMic, "faltan patrones del Anexo02");
    afirmar(p.filter((x) => x.fuente && /Anexo02/.test(x.fuente)).length === 87, "no están los 87 equipos de los Anexo02");
    const base = { procesoCodigo: "ITM03", fecha: "2030-01-15", instrumento: { item: "Prueba" }, motor: { datos: C.datosM, opciones: {} },
      otInstrumentoId: await itemRecibido(C, { item: "Prueba" }) };
    const r = await exigir(400, METRO, "POST", "/metrologia/calibraciones", { ...base, patronIds: [C.pF1.id] });
    afirmar(/venció/.test(msg(r)), msg(r));
    // La OT de prueba es de hoy: la calibración del 10-11 queda posterior a la recepción.
    const r2 = await ok(METRO, "POST", "/metrologia/calibraciones", { ...base, fecha: "2026-11-10", patronIds: [C.pMic.id] });
    afirmar(r2.data.avisos.some((a) => /vence el 24-11-2026/.test(a)), JSON.stringify(r2.data.avisos));
    await exigir(400, METRO, "POST", "/metrologia/calibraciones", { ...base, fecha: "2026-07-24", patronIds: [C.pF1.id, C.pF1.id, C.p500.id, C.pMic.id] });
    return "vencido → 400 · por vencer → aviso · más de 3 → 400";
  });

  await paso("C11 (R15 L2): la recepción del instrumento no puede ser anterior a la OT (caso V-5920: ahora se bloquea al recibir)", async () => {
    const ins = { item: "Micropipeta", marca: "Brand", modelo: "Transferpette", serie: "No tiene", idEspecial: "MP_09", cap: "200 µL", res: "0,1 µL", rango: "(20 a 200) µL",
      cliente: "Cliente de prueba", ot: C.controlV.ot, fechaOt: C.controlV.fechaOt, fechaRecepcion: C.controlV.fechaRecepcion, lugar: "instalaciones" };
    const otInstrumentoId = await itemRecibido(C, ins, { fechaOt: C.controlV.fechaOt, fechaRecepcion: C.controlV.fechaOt, recepcionPrevia: C.controlV.fechaRecepcion });
    const r = await ok(METRO, "POST", "/metrologia/calibraciones", { procesoCodigo: "ITV05", fecha: "2026-09-03", instrumento: ins, intervaloMeses: 12, motor: { datos: C.datosV, opciones: {} }, otInstrumentoId });
    afirmar(r.data.avisos.length === 0, JSON.stringify(r.data.avisos));
    C.calV = r.data;
    return "recepción del 02-09 en una OT del 03-09 → 400; recibida el 03-09 → sin avisos";
  });

  await paso("C4: un metrólogo no habilitado para la magnitud no envía (registro de firmas)", async () => {
    const r = await ok(METRO_L, "POST", "/metrologia/calibraciones", {
      procesoCodigo: "ITM03", fecha: "2026-07-24", instrumento: { item: "Juego de pesos (longitud no habilitado)" }, motor: { datos: C.datosM, opciones: {} },
      otInstrumentoId: await itemRecibido(C, { item: "Juego de pesos (longitud no habilitado)" }, { fechaOt: C.controlM.fechaOt, fechaRecepcion: C.controlM.fechaRecepcion }),
    });
    const e = await exigir(403, METRO_L, "POST", `/metrologia/calibraciones/${r.data.id}/enviar`);
    afirmar(/registro de firmas/.test(msg(e)), msg(e));
    return "demo.lmt.analista2 (longitud) en masa → 403";
  });

  await paso("Crear ITM03 completo (OT, cliente, patrones del maestro) y enviarlo: firma el metrólogo", async () => {
    const ins = { item: "Juego de 4 pesos muertos", marca: "No tiene", modelo: "No tiene", serie: "M39", idEspecial: "Según identificación del ítem",
      cap: "(100 a 475) g", res: "--", rango: "(100 a 475) g", clase: "No tiene", cliente: "IDIC, Departamento Químico", solicitante: "Laboratorio Textil",
      direccion: "Avenida Pedro Montt Nº 2136, Santiago", ot: C.controlM.ot, fechaOt: C.controlM.fechaOt, fechaRecepcion: C.controlM.fechaRecepcion, lugar: "instalaciones", desviacion: "No" };
    const r = await ok(METRO, "POST", "/metrologia/calibraciones", {
      procesoCodigo: "ITM03", fecha: "2026-07-24", instrumento: ins, intervaloMeses: 24, patronIds: [C.pF1.id, C.p500.id], motor: { datos: C.datosM, opciones: {} },
      otInstrumentoId: await itemRecibido(C, ins, { fechaOt: C.controlM.fechaOt, fechaRecepcion: C.controlM.fechaRecepcion }),
    });
    afirmar(r.data.avisos.length === 0, JSON.stringify(r.data.avisos));
    C.cal = r.data;
    await exigir(403, JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/enviar`);
    await ok(METRO, "POST", `/metrologia/calibraciones/${C.cal.id}/enviar`);
    const d = await ok(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(d.estado === "en_revision" && d.firmas.length === 1 && d.firmas[0].accion === "ELABORA", JSON.stringify(d.firmas));
    afirmar(d.paso_pendiente && !d.paso_pendiente.emite, "el paso pendiente no es el del jefe del laboratorio");
    return `${C.cal.codigo} en revisión · pendiente: ${d.paso_pendiente.descripcion}`;
  });

  await paso("C4: solo el jefe del LMT o su subrogante firman el segundo paso; nadie se adelanta", async () => {
    for (const u of [DEPTO, SAM, METRO_L]) await exigir(403, u, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    await exigir(403, DEPTO, "POST", `/metrologia/calibraciones/${C.cal.id}/emitir`);
    const r = await ok(SUBR, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    afirmar(r.data.estado === "en_firma", JSON.stringify(r));
    const d = await ok(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(d.firmas.find((f) => f.accion !== "ELABORA")?.via === "subrogante", "no quedó la firma como subrogante");
    return "jefe de departamento, jefe de sección y otro metrólogo → 403 · subrogante firma";
  });

  await paso("C3/C7: el jefe de departamento emite: número por magnitud sin año y código de verificación", async () => {
    await exigir(403, JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    const r = await ok(DEPTO, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    afirmar(/^M-\d{4,}$/.test(r.data.numero), `número ${r.data.numero}`);
    C.num = r.data.numero; C.ver = r.data.verificacion;
    const d = await ok(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(d.estado === "emitida" && d.numero_certificado === C.num && d.firmas.length === 3, `estado ${d.estado}`);
    return `${C.num} · verificación ${C.ver}`;
  });

  await paso("Emisión por el metrólogo habilitado (decisión 18-10, a confirmar con el IDIC): tras la revisión del Jefe LMT; uno no habilitado no", async () => {
    const ins = { item: "Juego de 4 pesos muertos (emisión por metrólogo)", marca: "No tiene", modelo: "No tiene", serie: "M39-E", idEspecial: "Según identificación del ítem",
      cap: "(100 a 475) g", res: "--", rango: "(100 a 475) g", clase: "No tiene", cliente: "IDIC, Departamento Químico", solicitante: "Laboratorio Textil",
      direccion: "Avenida Pedro Montt Nº 2136, Santiago", ot: C.controlM.ot, fechaOt: C.controlM.fechaOt, fechaRecepcion: C.controlM.fechaRecepcion, lugar: "instalaciones", desviacion: "No" };
    const r = await ok(METRO, "POST", "/metrologia/calibraciones", {
      procesoCodigo: "ITM03", fecha: "2026-07-24", instrumento: ins, intervaloMeses: 24, patronIds: [C.pF1.id, C.p500.id], motor: { datos: C.datosM, opciones: {} },
      otInstrumentoId: await itemRecibido(C, ins, { fechaOt: C.controlM.fechaOt, fechaRecepcion: C.controlM.fechaRecepcion }),
    });
    const id = r.data.id;
    await ok(METRO, "POST", `/metrologia/calibraciones/${id}/enviar`);
    // Nadie emite sin la revisión previa del Jefe LMT: ni el metrólogo habilitado se adelanta.
    await exigir(403, METRO, "POST", `/metrologia/calibraciones/${id}/firmar`);
    await exigir(403, METRO, "POST", `/metrologia/calibraciones/${id}/emitir`);
    await ok(JEFE, "POST", `/metrologia/calibraciones/${id}/firmar`);
    let d = await ok(METRO, "GET", `/metrologia/calibraciones/${id}`);
    afirmar(d.estado === "en_firma" && d.paso_pendiente?.emite && d.paso_pendiente.responsables.length >= 2, `pendiente ${JSON.stringify(d.paso_pendiente)}`);
    // Metrólogo del laboratorio pero no habilitado para la magnitud (masa): 403 con el motivo.
    const e = await exigir(403, METRO_L, "POST", `/metrologia/calibraciones/${id}/firmar`);
    afirmar(/registro de firmas autorizadas para la magnitud/.test(msg(e)), msg(e));
    await exigir(403, SAM, "POST", `/metrologia/calibraciones/${id}/firmar`);
    const em = await ok(METRO, "POST", `/metrologia/calibraciones/${id}/firmar`);
    afirmar(/^M-\d{4,}$/.test(em.data.numero), `número ${em.data.numero}`);
    d = await ok(METRO, "GET", `/metrologia/calibraciones/${id}`);
    const f3 = d.firmas.find((f) => f.accion !== "ELABORA" && f.via === "alternativo");
    afirmar(d.estado === "emitida" && d.firmas.length === 3 && f3 && f3.rol_codigo === "METROLOGO", `firmas ${JSON.stringify(d.firmas)}`);
    const h = (await ok(METRO, "GET", `/metrologia/calibraciones/${id}/html`)).data.html;
    afirmar(/habilitado para la magnitud \(emite\)/.test(h), "el certificado no dice que emitió el metrólogo habilitado");
    return `${em.data.numero} emitido por demo.lmt.analista1 · analista2 (longitud) → 403`;
  });

  await paso("Certificado oficial de 2 páginas: un solo número, sin «cumple», textos legales, firmas y departamento", async () => {
    const h = (await ok(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}/html`)).data;
    afirmar(h.sellado, "el HTML no es el sellado");
    const t = h.html;
    for (const s of [`CERTIFICADO DE CALIBRACIÓN N° ${C.num}`, "Laboratorio de Calibración en la magnitud Masa", "Fin del certificado", "\"--\" = No aplica",
      "factor de cobertura k = 2", "probabilidad del 95 %", "no puede ser reproducido", "Valor de masa convencional / g", "99,845", "Incertidumbre expandida / mg",
      "Rev. 00", "OIML R 111-1: 2004", "M-3931", "Jefe Departamento Armamento y Munición", "salto-pagina", "Firmado electrónicamente"])
      afirmar(t.includes(s), `falta «${s}»`);
    afirmar(!/Cumple|No cumple/.test(t), "el certificado trae «cumple»");
    afirmar(!t.includes(C.cal.codigo), "el certificado muestra también el código interno");
    afirmar(!/Acreditación LC 001/.test(t), "ITM03 no está acreditado y sale con LC 001");
    const pdf = await llamar(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}/pdf`);
    afirmar(pdf.status === 200 && pdf.tipo.includes("pdf"), `PDF ${pdf.status}`);
    const paginas = (pdf.buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    afirmar(paginas === 2, `el PDF tiene ${paginas} páginas`);
    return `2 páginas · ${(pdf.buf.length / 1024).toFixed(0)} KB`;
  });

  await paso("C7: la verificación pública (sin sesión) reconoce el código; un código inventado no", async () => {
    const v = await ok(null, "GET", `/metrologia/verificar/${C.ver}`);
    afirmar(v.valido === true && v.numero === C.num && !("cliente" in v), JSON.stringify(v));
    const x = await ok(null, "GET", "/metrologia/verificar/00000-00000");
    afirmar(x.valido === false, JSON.stringify(x));
    const y = await ok(null, "GET", `/metrologia/verificar/${encodeURIComponent("1' OR '1'='1")}`);
    afirmar(y.valido === false && /formato/.test(y.motivo), JSON.stringify(y));
    return `${C.num} válido · inventado y malformado → no válido`;
  });

  await paso("Reemisión: el metrólogo no puede; el jefe reemite y el nuevo certificado reemplaza al anterior", async () => {
    await exigir(403, METRO, "POST", `/metrologia/calibraciones/${C.cal.id}/reemitir`, { motivo: "Corrección de la dirección del cliente" });
    // Revisión r3 (hallazgo 6): dos reemisiones simultáneas (doble clic) → una sola; la otra, 409.
    const dobles = await Promise.all(["Corrección de la dirección del cliente", "Segunda reemisión simultánea"].map((motivo) =>
      llamar(JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/reemitir`, { motivo })));
    const est = dobles.map((x) => x.status).sort();
    afirmar(est[0] >= 200 && est[0] < 300 && est[1] === 409, `reemisiones simultáneas → ${est.join(", ")}`);
    const r = dobles.find((x) => x.status < 300).json;
    await exigir(409, JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/reemitir`, { motivo: "Tercera reemisión, ya hay una en curso" });
    const nid = r.data.id;
    await ok(JEFE, "POST", `/metrologia/calibraciones/${nid}/enviar`);
    await ok(JEFE, "POST", `/metrologia/calibraciones/${nid}/firmar`); // el jefe titular firma su propia calibración (decisión 14-10)
    const e = await ok(DEPTO, "POST", `/metrologia/calibraciones/${nid}/firmar`);
    const h = (await ok(JEFE, "GET", `/metrologia/calibraciones/${nid}/html`)).data.html;
    afirmar(h.includes(`ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° ${C.num}.`), "el nuevo certificado no dice a cuál reemplaza");
    const viejo = await ok(JEFE, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(viejo.estado === "reemplazada", `estado ${viejo.estado}`);
    const v = await ok(null, "GET", `/metrologia/verificar/${C.ver}`);
    afirmar(v.valido === false && v.motivo.includes(e.data.numero), JSON.stringify(v));
    return `${C.num} → reemplazado por ${e.data.numero}`;
  });

  await paso("ITV05: devolución con motivo y certificado en µL con 2 decimales", async () => {
    await ok(METRO, "POST", `/metrologia/calibraciones/${C.calV.id}/enviar`);
    await exigir(400, JEFE, "POST", `/metrologia/calibraciones/${C.calV.id}/devolver`, { motivo: "x" });
    await exigir(403, DEPTO, "POST", `/metrologia/calibraciones/${C.calV.id}/devolver`, { motivo: "Revise la fecha de la OT" });
    await ok(JEFE, "POST", `/metrologia/calibraciones/${C.calV.id}/devolver`, { motivo: "Revise la fecha de la OT" });
    const d = await ok(METRO, "GET", `/metrologia/calibraciones/${C.calV.id}`);
    afirmar(d.estado === "borrador" && d.firmas.length === 0 && d.devuelto_motivo === "Revise la fecha de la OT", d.estado);
    const h = (await ok(METRO, "GET", `/metrologia/calibraciones/${C.calV.id}/html`)).data.html;
    for (const s of ["Volumen entregado / µL", "19,84", "0,13", "0,49", "Acreditación LC 023", "BORRADOR", "Pendiente de firma"]) afirmar(h.includes(s), `falta «${s}»`);
    return "devuelta por el jefe; el jefe de departamento no puede devolver un paso que no es suyo";
  });

  await paso("Departamento del certificado: parámetro editable (por defecto, el nombre del organigrama)", async () => {
    const p = (await ok(METRO, "GET", "/metrologia/parametros")).data;
    afirmar(p.nombreDepartamento === "Departamento Armamento y Munición" && p.origen === "parametro", JSON.stringify(p));
    const par = (await ok("demo.admin", "GET", "/parametros?categoria=certificado_calibracion")).data ?? [];
    const fila = (Array.isArray(par) ? par : []).find((x) => x.codigo === "nombre_departamento");
    afirmar(fila, "el parámetro no figura en Administración › Parámetros");
    await exigir(403, METRO, "PATCH", `/parametros/${fila.id}`, { etiqueta: "Departamento Sistemas de Armas" });
    await ok("demo.admin", "PATCH", `/parametros/${fila.id}`, { etiqueta: "Departamento Sistemas de Armas" });
    const h = (await ok(METRO, "GET", `/metrologia/calibraciones/${C.calV.id}/html`)).data.html;
    await ok("demo.admin", "PATCH", `/parametros/${fila.id}`, { etiqueta: p.nombreDepartamento });
    afirmar(h.includes("Jefe Departamento Sistemas de Armas"), "el certificado no toma el parámetro");
    return "cambia a «Departamento Sistemas de Armas» y se restaura";
  });

  await paso("Maestros: vincular el registro de firmas y fijar la numeración exigen metrologia.config", async () => {
    const f = (await ok(METRO, "GET", "/metrologia/firmantes")).data.find((x) => x.iniciales === "LSP");
    afirmar(f && f.funcion === "METROLOGO", "registro sin LSP");
    await exigir(403, METRO, "PUT", `/metrologia/firmantes/${f.id}`, { activo: true });
    await ok("demo.admin", "PUT", `/metrologia/firmantes/${f.id}`, { magnitudes: ["longitud"] });
    await exigir(400, "demo.admin", "PUT", `/metrologia/firmantes/${f.id}`, { magnitudes: ["inventada"] });
    const n = Number(C.num.split("-")[1]);
    await exigir(409, "demo.admin", "PUT", "/metrologia/numeracion/M", { ultimo: n - 1 });
    await exigir(403, METRO, "PUT", "/metrologia/numeracion/M", { ultimo: n + 5 });
    return "registro y numeración protegidos";
  });

  await revisionR3(C);
}

/**
 * Revisión r3 (hallazgos 4 y 5): reglas de la matriz para la unidad de la
 * calibración, que se crean para la prueba y se borran al terminar.
 */
const MARCA_PRUEBA = "Prueba revisión r3";
async function limpiarReglasPrueba() {
  const reglas = (await ok("demo.admin", "GET", "/firmas-matriz?tipoDocumento=CERTIFICADO_CALIBRACION")).data ?? [];
  for (const r of reglas.filter((x) => (x.descripcion ?? "").startsWith(MARCA_PRUEBA))) await ok("demo.admin", "DELETE", `/firmas-matriz/${r.id}`);
}

async function revisionR3(C) {
  await paso("Revisión r3 · matriz sin ELABORA cuyo primer paso es el jefe del LMT: la firma del metrólogo no lo salta", async () => {
    await limpiarReglasPrueba();
    const reglas = (await ok("demo.admin", "GET", "/firmas-matriz?tipoDocumento=CERTIFICADO_CALIBRACION")).data ?? [];
    const de = (rol) => reglas.find((x) => x.rol?.codigo === rol && !(x.descripcion ?? "").startsWith(MARCA_PRUEBA));
    const jl = de("JEFE_LAB"), jd = de("JEFE_DEPTO");
    afirmar(jl && jd, "la matriz no tiene los pasos del jefe del laboratorio y del departamento");
    const d0 = await ok(METRO, "GET", `/metrologia/calibraciones/${C.calV.id}`);
    const unidadId = d0.unidad_id;
    afirmar(unidadId, "la calibración no tiene unidad");
    const regla = (base, orden, extra = {}) => ({
      tipoDocumento: "CERTIFICADO_CALIBRACION", unidadId, orden, accion: base.accion, rolId: base.rolId, nivelUnidad: base.nivelUnidad,
      unidadDestinoId: base.unidadDestinoId ?? null, obligatorio: true, activo: true, descripcion: `${MARCA_PRUEBA}: ${base.rol.nombre}`, ...extra,
    });
    C.reglasR3 = [];
    try {
      C.reglasR3.push(await ok("demo.admin", "POST", "/firmas-matriz", regla(jl, 1)));
      C.reglasR3.push(await ok("demo.admin", "POST", "/firmas-matriz", regla(jd, 2)));
      const r = await ok(METRO, "POST", "/metrologia/calibraciones", {
        procesoCodigo: "ITM03", fecha: "2026-07-24", instrumento: { item: "Pesas (prueba matriz sin ELABORA)" }, patronIds: [C.pF1.id, C.p500.id], motor: { datos: C.datosM, opciones: {} },
        otInstrumentoId: await itemRecibido(C, { item: "Pesas (prueba matriz sin ELABORA)" }, { fechaOt: C.controlM.fechaOt, fechaRecepcion: C.controlM.fechaRecepcion }),
      });
      await ok(METRO, "POST", `/metrologia/calibraciones/${r.data.id}/enviar`);
      const d = await ok(METRO, "GET", `/metrologia/calibraciones/${r.data.id}`);
      afirmar(d.firmas.length === 1 && d.firmas[0].accion === "ELABORA", JSON.stringify(d.firmas));
      afirmar(d.paso_pendiente?.orden === 1 && !d.paso_pendiente.emite, `paso pendiente ${JSON.stringify(d.paso_pendiente)}`);
      await exigir(403, DEPTO, "POST", `/metrologia/calibraciones/${r.data.id}/firmar`);
      await exigir(403, DEPTO, "POST", `/metrologia/calibraciones/${r.data.id}/emitir`);
      const f = await ok(JEFE, "POST", `/metrologia/calibraciones/${r.data.id}/firmar`);
      afirmar(f.data.estado === "en_firma", JSON.stringify(f));
      const d2 = await ok(METRO, "GET", `/metrologia/calibraciones/${r.data.id}`);
      afirmar(d2.paso_pendiente?.orden === 2 && d2.paso_pendiente.emite, `tras el jefe del LMT: ${JSON.stringify(d2.paso_pendiente)}`);
      const circ = (await ok(METRO, "GET", `/metrologia/calibraciones/${r.data.id}/circuito`)).data;
      afirmar(circ.pasos.find((x) => x.orden === 1)?.firma?.accion === "FIRMA", "el paso 1 muestra la firma del metrólogo como la del jefe");
      return "ELABORA aparte · firma el jefe del LMT (paso 1) · pendiente el departamento (paso 2)";
    } finally {
      for (const x of C.reglasR3) await llamar("demo.admin", "DELETE", `/firmas-matriz/${x.id}`);
    }
  });

  await paso("Revisión r3 · matriz sin pasos de firma después del metrólogo: no se envía (409) y no queda atascada", async () => {
    const reglas = (await ok("demo.admin", "GET", "/firmas-matriz?tipoDocumento=CERTIFICADO_CALIBRACION")).data ?? [];
    const metro = reglas.find((x) => x.accion === "ELABORA");
    afirmar(metro, "la matriz no tiene el paso ELABORA");
    const d0 = await ok(METRO, "GET", `/metrologia/calibraciones/${C.calV.id}`);
    let creada = null;
    try {
      creada = await ok("demo.admin", "POST", "/firmas-matriz", {
        tipoDocumento: "CERTIFICADO_CALIBRACION", unidadId: d0.unidad_id, orden: 1, accion: "ELABORA", rolId: metro.rolId, nivelUnidad: metro.nivelUnidad,
        obligatorio: true, activo: true, descripcion: `${MARCA_PRUEBA}: solo el metrólogo`,
      });
      const r = await ok(METRO, "POST", "/metrologia/calibraciones", {
        procesoCodigo: "ITM03", fecha: "2026-07-24", instrumento: { item: "Pesas (prueba matriz sin firmantes)" }, patronIds: [C.pF1.id, C.p500.id], motor: { datos: C.datosM, opciones: {} },
        otInstrumentoId: await itemRecibido(C, { item: "Pesas (prueba matriz sin firmantes)" }, { fechaOt: C.controlM.fechaOt, fechaRecepcion: C.controlM.fechaRecepcion }),
      });
      const e = await exigir(409, METRO, "POST", `/metrologia/calibraciones/${r.data.id}/enviar`);
      afirmar(/ningún paso de firma/.test(msg(e)), msg(e));
      const d = await ok(METRO, "GET", `/metrologia/calibraciones/${r.data.id}`);
      afirmar(d.estado === "borrador" && d.firmas.length === 0, `estado ${d.estado}`);
      return msg(e).slice(0, 90) + "…";
    } finally {
      if (creada) await llamar("demo.admin", "DELETE", `/firmas-matriz/${creada.id}`);
    }
  });
}

main()
  .then(() => {
    console.log(`\nMetrología 15-10 verificada: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
