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

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};

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
    const base = { procesoCodigo: "ITM03", fecha: "2030-01-15", instrumento: { item: "Prueba" }, motor: { datos: C.datosM, opciones: {} } };
    const r = await exigir(400, METRO, "POST", "/metrologia/calibraciones", { ...base, patronIds: [C.pF1.id] });
    afirmar(/venció/.test(msg(r)), msg(r));
    const r2 = await ok(METRO, "POST", "/metrologia/calibraciones", { ...base, fecha: "2026-11-10", patronIds: [C.pMic.id] });
    afirmar(r2.data.avisos.some((a) => /vence el 24-11-2026/.test(a)), JSON.stringify(r2.data.avisos));
    await exigir(400, METRO, "POST", "/metrologia/calibraciones", { ...base, fecha: "2026-07-24", patronIds: [C.pF1.id, C.pF1.id, C.p500.id, C.pMic.id] });
    return "vencido → 400 · por vencer → aviso · más de 3 → 400";
  });

  await paso("C11: aviso si la fecha de la OT es posterior a la de recepción (caso V-5920)", async () => {
    const ins = { item: "Micropipeta", marca: "Brand", modelo: "Transferpette", serie: "No tiene", idEspecial: "MP_09", cap: "200 µL", res: "0,1 µL", rango: "(20 a 200) µL",
      cliente: "Cliente de prueba", ot: C.controlV.ot, fechaOt: C.controlV.fechaOt, fechaRecepcion: C.controlV.fechaRecepcion, lugar: "instalaciones" };
    const r = await ok(METRO, "POST", "/metrologia/calibraciones", { procesoCodigo: "ITV05", fecha: "2026-09-03", instrumento: ins, intervaloMeses: 12, motor: { datos: C.datosV, opciones: {} } });
    afirmar(r.data.avisos.length === 1 && /posterior a la de recepción/.test(r.data.avisos[0]), JSON.stringify(r.data.avisos));
    C.calV = r.data;
    return r.data.avisos[0].slice(0, 80) + "…";
  });

  await paso("C4: un metrólogo no habilitado para la magnitud no envía (registro de firmas)", async () => {
    const r = await ok(METRO_L, "POST", "/metrologia/calibraciones", {
      procesoCodigo: "ITM03", fecha: "2026-07-24", instrumento: { item: "Juego de pesos (longitud no habilitado)" }, motor: { datos: C.datosM, opciones: {} },
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
    const r = await ok(JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/reemitir`, { motivo: "Corrección de la dirección del cliente" });
    await exigir(409, JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/reemitir`, { motivo: "Segunda reemisión simultánea" });
    const nid = r.data.id;
    await ok(JEFE, "POST", `/metrologia/calibraciones/${nid}/enviar`);
    await ok(JEFE, "POST", `/metrologia/calibraciones/${nid}/firmar`); // el jefe titular firma su propia calibración (decisión 14-10)
    const e = await ok(DEPTO, "POST", `/metrologia/calibraciones/${nid}/firmar`);
    const h = (await ok(JEFE, "GET", `/metrologia/calibraciones/${nid}/html`)).data.html;
    afirmar(h.includes(`reemplaza al certificado N° ${C.num}`), "el nuevo certificado no dice a cuál reemplaza");
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
