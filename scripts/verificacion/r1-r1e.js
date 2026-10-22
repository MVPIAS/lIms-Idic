#!/usr/bin/env node
/**
 * Frente r1e · certificado de calibración según la respuesta del Laboratorio de
 * Metrología del 21-10-2026 (12 observaciones; docs/FLUJO_METROLOGIA.md §8):
 * logo y línea de acreditación por certificado (con motivo y bitácora), «reemplaza
 * al certificado N°» a mano, certificado de N hojas con «Página X de N», firmas por
 * hoja, leyenda legal en la hoja 1, OBSERVACIONES editables y «Fin» en la última,
 * condiciones propias de la IT, esquema (el del proceso, uno propio o ninguno), logo
 * configurable y ningún «cumple». Cada regla con el perfil que puede y uno que no.
 *
 * Uso:
 *   node scripts/verificacion/r1-r1e.js [--arrancar] [--base http://localhost:4751/api]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA.
 * Deja calibraciones de prueba y consume números de certificado: úsese en una base de pruebas.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4751/api");
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
  const esForm = cuerpo instanceof FormData;
  if (cuerpo !== undefined && !esForm) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  if ((r.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; } }
  return { status: r.status, json, buf, tipo: r.headers.get("content-type") || "" };
}
const msg = (j) => (j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json ?? r;
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
  const puerto = new URL(BASE).port || "4751";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1e-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* -------------------------------------------------------------- PNG ----- */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function trozo(tipo, datos) {
  const t = Buffer.from(tipo, "latin1"), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(datos.length); c.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([l, t, datos, c]);
}
/** PNG RGB de color sólido (sin dependencias), para probar las cargas de imagen. */
function png(ancho, alto, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  const fila = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: ancho }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: alto }, () => fila)))), trozo("IEND", Buffer.alloc(0))]);
}
function formulario(buf, nombre, campos = {}) {
  const f = new FormData();
  f.append("archivo", new Blob([buf], { type: "image/png" }), nombre);
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}
const paginasPdf = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
const hojasDe = (html) => html.split('<div class="salto-pagina"></div>');
/** «cumple con las exigencias de la norma NCh-ISO 17025» es la leyenda legal, no un veredicto. */
const VEREDICTO = /cumple(?! con las exigencias)/i;

/* ============================================================ RECORRIDO === */
const METRO = "demo.lmt.analista1";   // habilitado: par, masa, volumen
const METRO_L = "demo.lmt.analista2"; // otro metrólogo del LMT (no es el autor)
const JEFE = "demo.lmt.jefe";
const DEPTO = "demo.dsa.jefe";
const METRO_E = "demo.lmte.analista1"; // Área Eléctrica (isotermos ITT02)
const JEFE_E = "demo.lmte.jefe";
const PLANIF = "demo.planificacion";
const AJENO = "demo.lqc.jefe";        // jefe de otro laboratorio: fuera del alcance de Metrología

async function prepararOt(C) {
  const labs = await ok(PLANIF, "GET", "/ot/laboratorios");
  const l = Array.isArray(labs) ? labs : labs.data ?? [];
  C.lmt = l.find((u) => u.codigo === "LMT");
  C.lmte = l.find((u) => u.codigo === "LMTE");
  const cl = await ok("demo.admin", "GET", "/clientes?limit=5");
  C.clienteId = (Array.isArray(cl) ? cl : cl.data ?? [])[0]?.id;
  afirmar(C.lmt && C.lmte && C.clienteId, "faltan el LMT, el LMTE o un cliente");
}
async function itemRecibido(C, lab, jefe, ins = {}) {
  const ot = await ok(PLANIF, "POST", "/ot", {
    clienteId: C.clienteId, unidadPrincipalId: lab.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: "Prueba certificado de N hojas (r1e)",
  });
  const it = await ok(jefe, "POST", `/ot/${ot.id}/instrumentos`, {
    descripcion: ins.item || "Instrumento de prueba", marca: ins.marca, modelo: ins.modelo, serie: ins.serie, capacidad: ins.cap, resolucion: ins.res, rango: ins.rango,
  });
  await ok(jefe, "POST", `/ot/${ot.id}/instrumentos/${it.data.id}/recepcion`, {
    fechaHora: new Date().toISOString(), entregadoPor: "Cliente de prueba", estadoFisico: "bueno", ubicacion: "Estante de recepción", calibrable: true,
  });
  return it.data.id;
}
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
async function calibrar(C, { proceso, autor = METRO, lab = C.lmt, jefe = JEFE, datos, ins }) {
  const r = await ok(autor, "POST", "/metrologia/calibraciones", {
    procesoCodigo: proceso, fecha: hoy(), instrumento: ins, intervaloMeses: 12, motor: { datos, opciones: {} },
    otInstrumentoId: await itemRecibido(C, lab, jefe, ins),
  });
  return r.data;
}
const cert = async (u, id) => (await ok(u, "GET", `/metrologia/calibraciones/${id}/certificado`)).data;
const html = async (u, id) => (await ok(u, "GET", `/metrologia/calibraciones/${id}/html`)).data.html;

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  await prepararOt(C);
  C.ej2 = (await ok(METRO, "GET", "/metrologia/motores/ITM02/ejemplo")).data;
  C.ej3 = (await ok(METRO, "GET", "/metrologia/motores/ITM03/ejemplo")).data;
  C.ejT = (await ok(METRO_E, "GET", "/metrologia/motores/ITT02/ejemplo")).data;
  const insBalanza = { item: "Balanza analítica", marca: "Adam", modelo: "NBL254i", serie: "AE9YX953", cap: "250 g", res: "0,0001 g", rango: "(0,02 a 50) g",
    cliente: "IDIC, Departamento Químico", solicitante: "Laboratorio Textil", lugar: "instalaciones", desviacion: "No" };

  await paso("Configuración: el logo de acreditación lo carga quien tiene metrologia.config; solo PNG o JPEG; el esquema de ITT02 viene sembrado", async () => {
    const logo = png(300, 80, [20, 60, 110]);
    await exigir(403, METRO, "PUT", "/metrologia/imagenes/logo_acreditacion", formulario(logo, "logo.png"));
    const e = await exigir(400, "demo.admin", "PUT", "/metrologia/imagenes/logo_acreditacion", formulario(Buffer.from("no soy una imagen"), "logo.png"));
    afirmar(/PNG o JPEG/.test(msg(e)), msg(e));
    await exigir(400, "demo.admin", "PUT", "/metrologia/imagenes/esquema:NOEXISTE", formulario(logo, "x.png"));
    await ok("demo.admin", "PUT", "/metrologia/imagenes/logo_acreditacion", formulario(logo, "logo-inn.png"));
    const l = (await ok(METRO, "GET", "/metrologia/imagenes")).data;
    afirmar(l.some((x) => x.clave === "logo_acreditacion"), "no figura el logo");
    const t = l.find((x) => x.clave === "esquema:ITT02");
    afirmar(t && /posición de los sensores/.test(t.titulo), "no está el esquema estándar de ITT02");
    const img = await llamar(METRO, "GET", "/metrologia/imagenes/esquema:ITT02");
    afirmar(img.status === 200 && img.tipo.includes("image/png") && img.buf.length > 10000, `esquema ITT02 ${img.status}`);
    return "metrólogo → 403 · texto → 400 · logo cargado · esquema ITT02 sembrado (14,5 KB)";
  });

  await paso("Obs. 1 y 2: por defecto el certificado sale según la acreditación del proceso, con logo y «Acreditado»", async () => {
    C.cal = await calibrar(C, { proceso: "ITM02", datos: C.ej2.datos, ins: insBalanza });
    const p = await cert(METRO, C.cal.id);
    afirmar(p.editable && p.acreditado && p.acreditacionProceso === "LC 001" && p.logoConfigurado, JSON.stringify(p).slice(0, 200));
    const h = await html(METRO, C.cal.id);
    afirmar(h.includes("Laboratorio de Calibración Acreditado en la magnitud") && h.includes("logo-acred"), "falta el logo o la línea de acreditado");
    afirmar(hojasDe(h).every((x) => x.includes("logo-acred")), "el logo no se repite en cada hoja");
    return `${p.hojas} hojas · LC 001 con logo`;
  });

  await paso("Obs. 1 y 2: quitar el logo exige motivo; solo el autor en borrador; queda en la bitácora y la línea cambia", async () => {
    const e = await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { acreditado: false });
    afirmar(/motivo/.test(msg(e)), msg(e));
    await exigir(403, METRO_L, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { acreditado: false, acreditadoMotivo: "Puntos fuera del alcance" });
    await exigir(403, JEFE, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { acreditado: false, acreditadoMotivo: "Puntos fuera del alcance" });
    await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { inventado: 1 });
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { acreditado: false, acreditadoMotivo: "Calibración a pedido fuera del alcance acreditado" });
    const h = await html(METRO, C.cal.id);
    afirmar(h.includes("Laboratorio de Calibración en la magnitud") && !h.includes("Acreditado en la magnitud"), "la línea no cambió");
    afirmar(!h.includes("logo-acred") && !h.includes("Acreditación LC 001"), "sigue el logo o el código");
    const d = await ok(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    const ev = d.eventos.find((x) => x.accion === "CERTIFICADO");
    afirmar(ev && /sin logo de acreditado \(motivo: Calibración a pedido/.test(ev.comentario), JSON.stringify(ev));
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { acreditado: null });
    afirmar((await html(METRO, C.cal.id)).includes("logo-acred"), "no vuelve el logo");
    return "sin motivo → 400 · otro metrólogo y el jefe → 403 · bitácora con motivo · vuelve a «según el proceso»";
  });

  await paso("Obs. 1: un proceso sin acreditación (ITM03) no puede llevar logo ni «Acreditado»", async () => {
    C.calM = await calibrar(C, { proceso: "ITM03", datos: C.ej3.datos, ins: { item: "Juego de pesas", cliente: "IDIC" } });
    const e = await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.calM.id}/certificado`, { acreditado: true, acreditadoMotivo: "Quiero el logo" });
    afirmar(/no tiene acreditación/.test(msg(e)), msg(e));
    const h = await html(METRO, C.calM.id);
    afirmar(h.includes("Laboratorio de Calibración en la magnitud") && !h.includes("logo-acred"), "ITM03 sale acreditado");
    return msg(e).slice(0, 80) + "…";
  });

  await paso("Obs. 3: «ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° …» a mano, con motivo, bajo la línea de acreditación", async () => {
    await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { reemplaza: "M-1234" });
    await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { reemplaza: "cualquier cosa", reemplazaMotivo: "Certificado anterior" });
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { reemplaza: "m-1234", reemplazaMotivo: "Certificado emitido en el sistema anterior" });
    const h = hojasDe(await html(METRO, C.cal.id));
    const i = h[0].indexOf("linea-acred"), j = h[0].indexOf("ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° M-1234.");
    afirmar(i > 0 && j > i, "el reemplazo no va bajo la línea de acreditación");
    return "sin motivo o número inválido → 400 · M-1234 normalizado";
  });

  await paso("Obs. 4 y 5: condiciones de la IT validadas y OBSERVACIONES editables (valor inicial: los textos automáticos)", async () => {
    const p0 = await cert(METRO, C.cal.id);
    afirmar(p0.automaticas[0] === "Intervalo de calibración: 12 meses." && p0.observaciones.join() === p0.automaticas.join(), "las observaciones no parten de las automáticas");
    afirmar(p0.frases.some((f) => /requeridos por el cliente/.test(f)), "faltan las frases del libro");
    const e = await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { campos: { medio: "Alcohol" } });
    afirmar(/no corresponde/.test(msg(e)), msg(e));
    const obs = [...p0.automaticas, "Los puntos de calibración fueron requeridos por el cliente.", "Masas utilizadas: 20 mg a 50 g E2 (juego 15884)."].join("\n");
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { observaciones: obs });
    const h = hojasDe(await html(METRO, C.cal.id));
    const ult = h[h.length - 1];
    afirmar(ult.includes("<p>Los puntos de calibración fueron requeridos por el cliente.</p>") && ult.includes("<p>\"--\" = No aplica.</p>"), "no salen las observaciones editadas");
    afirmar(ult.indexOf("<h2>Observaciones</h2>") < ult.indexOf("Fin del certificado de calibración"), "«Fin» no va después de las observaciones");
    h.slice(0, -1).forEach((x) => afirmar(!x.includes("Fin del certificado") && !x.includes("<h2>Observaciones</h2>"), "observaciones o «Fin» fuera de la última hoja"));
    afirmar(!h[0].includes("Intervalo de calibración"), "el intervalo sigue en la hoja 1");
    return `${h.length} hojas · observaciones y «Fin» solo en la última`;
  });

  await paso("Obs. 6, 8, 9 y 12: certificado de N hojas (ITM02 con 44 puntos) · «Página X de N», firmas por hoja, leyenda en la hoja 1 y PDF con N hojas", async () => {
    const pts = C.ej2.datos.pts;
    const datos = { ...C.ej2.datos, pts: Array.from({ length: 44 }, (_, i) => pts[i % pts.length]) };
    C.calN = await calibrar(C, { proceso: "ITM02", datos, ins: insBalanza });
    const p = await cert(METRO, C.calN.id);
    afirmar(p.hojas >= 3, `solo ${p.hojas} hojas`);
    const h = hojasDe(await html(METRO, C.calN.id));
    afirmar(h.length === p.hojas, `${h.length} hojas en el HTML y ${p.hojas} declaradas`);
    h.forEach((x, i) => {
      afirmar(x.includes(`Página ${i + 1} de ${p.hojas}`), `hoja ${i + 1} sin «Página ${i + 1} de ${p.hojas}»`);
      afirmar(x.includes("CERTIFICADO DE CALIBRACIÓN N°"), `hoja ${i + 1} sin cabecera`);
    });
    afirmar(h[0].includes("Jefe Departamento") && h[0].includes("Jefe Laboratorio de Metrología") && h[0].includes("no puede ser reproducido"), "hoja 1 sin sus firmas o sin la leyenda");
    h.slice(1).forEach((x, i) => afirmar(x.includes("Jefe Laboratorio de Metrología") && /Metrólogo/.test(x) && !x.includes("Jefe Departamento") && !x.includes("no puede ser reproducido"),
      `hoja ${i + 2}: firmas o leyenda indebidas`));
    const pdf = await llamar(METRO, "GET", `/metrologia/calibraciones/${C.calN.id}/pdf`);
    afirmar(pdf.status === 200 && paginasPdf(pdf.buf) === p.hojas, `PDF con ${paginasPdf(pdf.buf)} páginas; se esperaban ${p.hojas}`);
    return `${p.hojas} hojas en pantalla y en el PDF`;
  });

  await paso("Obs. 10: esquema propio (solo el autor, PNG/JPEG), el del proceso por defecto o ninguno", async () => {
    const img = png(240, 160, [230, 200, 40]);
    await exigir(403, METRO_L, "PUT", `/metrologia/calibraciones/${C.cal.id}/esquema`, formulario(img, "esquema.png"));
    await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/esquema`, formulario(Buffer.from("GIF89a"), "esquema.gif"));
    const sin = await exigir(400, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { esquemaModo: "propio" });
    afirmar(/Suba primero/.test(msg(sin)), msg(sin));
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/esquema`, formulario(img, "esquema.png", { pie: "Posición de las masas en el plato" }));
    let p = await cert(METRO, C.cal.id);
    afirmar(p.esquema.modo === "propio" && p.esquema.propio && p.esquema.imprime, JSON.stringify(p.esquema));
    let h = await html(METRO, C.cal.id);
    afirmar(h.includes('<div class="foto"><img src="data:image/png;base64,') && h.includes("Posición de las masas en el plato"), "no se imprime el esquema propio");
    const e = await llamar(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}/esquema`);
    afirmar(e.status === 200 && e.tipo.includes("image/png"), `GET esquema ${e.status}`);
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { esquemaModo: "ninguno" });
    afirmar(!(await html(METRO, C.cal.id)).includes('class="foto"'), "«sin esquema» sigue imprimiéndolo");
    await ok("demo.admin", "PUT", "/metrologia/imagenes/esquema:ITM02", formulario(png(200, 120, [90, 160, 90]), "itm02.png", { titulo: "Posiciones de carga en el plato (prueba)" }));
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { esquemaModo: "defecto" });
    h = await html(METRO, C.cal.id);
    afirmar(h.includes("Posiciones de carga en el plato (prueba)"), "no se imprime el esquema por defecto del proceso");
    await ok("demo.admin", "DELETE", "/metrologia/imagenes/esquema:ITM02");
    p = await cert(METRO, C.cal.id);
    afirmar(p.esquema.imprime === null, "sigue un esquema por defecto tras quitarlo");
    return "propio · ninguno · el del proceso · otro metrólogo → 403 · GIF → 400";
  });

  await paso("Obs. 10 (T-2890): una calibración de isotermos (ITT02) imprime por defecto el esquema de la posición de los sensores", async () => {
    C.calT = await calibrar(C, { proceso: "ITT02", autor: METRO_E, lab: C.lmte, jefe: JEFE_E, datos: C.ejT.datos, ins: { item: "Baño de agua", marca: "Feliza", modelo: "FE-376", cap: "10 a 100", res: "0,1 °C", rango: "30; 50; 80" } });
    const p = await cert(METRO_E, C.calT.id);
    afirmar(/posición de los sensores/.test(p.esquema.imprime ?? ""), JSON.stringify(p.esquema));
    afirmar(p.campos.some((c) => c.clave === "condicion"), "ITT02 sin «Condición de la calibración»");
    await ok(METRO_E, "PUT", `/metrologia/calibraciones/${C.calT.id}/certificado`, { campos: { condicion: "Sin carga" } });
    const h = await html(METRO_E, C.calT.id);
    for (const s of ["Representación esquemática de la posición de los sensores", "Condición de la calibración", "Sin carga", "Rango o puntos calibrados", "Rango total", "Indicación del calibrando / °C", "Indicación del patrón / °C"])
      afirmar(h.includes(s), `falta «${s}»`);
    const pdf = await llamar(METRO_E, "GET", `/metrologia/calibraciones/${C.calT.id}/pdf`);
    afirmar(paginasPdf(pdf.buf) === p.hojas, `PDF ${paginasPdf(pdf.buf)} / ${p.hojas}`);
    return `${p.hojas} hojas con el esquema del libro ITT02`;
  });

  await paso("Emisión: tras enviar ya no se cambia la presentación; el certificado sellado lleva logo, reemplazo, observaciones y N hojas", async () => {
    await ok(METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { esquemaModo: "ninguno" });
    await ok(METRO, "POST", `/metrologia/calibraciones/${C.cal.id}/enviar`);
    await exigir(403, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/certificado`, { observaciones: "Cambio tardío" });
    await exigir(403, METRO, "PUT", `/metrologia/calibraciones/${C.cal.id}/esquema`, formulario(png(10, 10, [0, 0, 0]), "x.png"));
    await ok(JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    const em = await ok(DEPTO, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    C.num = em.data.numero; C.ver = em.data.verificacion;
    const d = (await ok(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}/html`)).data;
    afirmar(d.sellado, "no está sellado");
    for (const s of ["logo-acred", "ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° M-1234.", "requeridos por el cliente", "Fin del certificado de calibración", `CERTIFICADO DE CALIBRACIÓN N° ${C.num}`])
      afirmar(d.html.includes(s), `el sellado no tiene «${s}»`);
    const p = await cert(METRO, C.cal.id);
    afirmar(!p.editable, "sigue editable tras emitir");
    const pdf = await llamar(METRO, "GET", `/metrologia/calibraciones/${C.cal.id}/pdf`);
    afirmar(paginasPdf(pdf.buf) === hojasDe(d.html).length, "PDF y HTML sellado con distinto número de hojas");
    const v = await ok(null, "GET", `/metrologia/verificar/${C.ver}`);
    afirmar(v.valido === true, JSON.stringify(v));
    return `${C.num} · ${hojasDe(d.html).length} hojas · verificación válida`;
  });

  await paso("Reemisión: copia la presentación sin el reemplazo a mano; la reemisión fija a cuál reemplaza y no admite otro", async () => {
    const r = await ok(JEFE, "POST", `/metrologia/calibraciones/${C.cal.id}/reemitir`, { motivo: "Corrección del nombre del solicitante" });
    const p = await cert(JEFE, r.data.id);
    afirmar(p.reemision === C.num && p.presentacion.reemplaza === null, JSON.stringify(p.presentacion));
    afirmar(p.observaciones.some((o) => /requeridos por el cliente/.test(o)), "no se copiaron las observaciones");
    const e = await exigir(400, JEFE, "PUT", `/metrologia/calibraciones/${r.data.id}/certificado`, { reemplaza: "M-1234", reemplazaMotivo: "Otro certificado" });
    afirmar(/reemisión/.test(msg(e)), msg(e));
    afirmar((await html(JEFE, r.data.id)).includes(`ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° ${C.num}.`), "la reemisión no dice a cuál reemplaza");
    return `reemplaza a ${C.num} · reemplazo a mano → 400`;
  });

  await paso("Obs. 11: ningún certificado ni vista de Metrología dice «cumple / no cumple»", async () => {
    for (const [u, id] of [[METRO, C.cal.id], [METRO, C.calM.id], [METRO, C.calN.id], [METRO_E, C.calT.id]]) {
      const h = await html(u, id);
      afirmar(!VEREDICTO.test(h), `la calibración ${id} dice «cumple»`);
      const det = JSON.stringify((await ok(u, "GET", `/metrologia/calibraciones/${id}/certificado`)).data);
      afirmar(!VEREDICTO.test(det), "la presentación dice «cumple»");
    }
    return "4 certificados revisados";
  });

  await paso("Alcance: fuera de Metrología no se ve la presentación ni el esquema; las imágenes de configuración tampoco se cambian", async () => {
    await exigir([403, 404], AJENO, "GET", `/metrologia/calibraciones/${C.calN.id}/certificado`);
    await exigir([403, 404], AJENO, "GET", `/metrologia/calibraciones/${C.calT.id}/esquema`);
    await exigir([403, 404], AJENO, "PUT", "/metrologia/imagenes/logo_acreditacion", formulario(png(10, 10, [0, 0, 0]), "x.png"));
    await exigir(403, METRO, "DELETE", "/metrologia/imagenes/logo_acreditacion");
    return `${AJENO} → 403/404 · metrólogo no borra el logo`;
  });
}

main()
  .then(() => {
    console.log(`\nFrente r1e (certificado de N hojas) verificado: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
