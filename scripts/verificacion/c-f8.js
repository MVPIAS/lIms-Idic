#!/usr/bin/env node
/**
 * Frente f8 · zona horaria (America/Santiago) y refresco de la ficha de la OT (27-10-2026).
 * Cada corrección se comprueba con un perfil demo.* que puede y otro que no:
 *
 *   Zona  · GET /health informa la zona del IDIC, el «hoy» que usa la API (el de Chile) y la
 *           zona de su sesión de base de datos (la fija la API con options=-c TimeZone=…).
 *   OI    · Orden interna con fecha de envío = hoy en Chile sobre una OT abierta hoy: se acepta;
 *           ayer, «anterior a la apertura de la OT». Antes la regla cortaba la apertura en la zona
 *           del proceso: con la API en UTC fallaba pasadas las 21:00 de Chile, y con una zona
 *           adelantada (p. ej. TZ=Pacific/Kiritimati, UTC+14) falla casi todo el día. Este guion
 *           NO depende de la hora real: arranque la API con una zona hostil (por defecto, con
 *           --arrancar, TZ=Pacific/Kiritimati) y el resultado debe ser el mismo.
 *   Plazo · «Vence hoy»: fecha de compromiso = hoy en Chile → semáforo «por_vencer» con 0 días.
 *   Bitácora · «desde» y «hasta» = hoy cubren el día de Chile (incluyen lo recién registrado).
 *   D01-25 · API: completar la recepción de la muestra deja la Ruta sin el aviso «recepción
 *           incompleta» (el refresco de la pantalla lo comprueban las capturas con Playwright).
 *
 * Uso:
 *   node scripts/verificacion/c-f8.js [--base http://localhost:5091/api]
 *   DATABASE_URL=… node scripts/verificacion/c-f8.js --arrancar [--tz Pacific/Kiritimati]
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja una OT, una muestra y una
 * orden interna de prueba: úsese en una base de pruebas. Se puede correr varias veces.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:5091/api");
const ARRANCAR = args.includes("--arrancar");
const TZ_HOSTIL = arg("--tz", "Pacific/Kiritimati");

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
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: CLAVE }),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
    sesiones[username] = { token: j.accessToken };
    return sesiones[username];
  }
  throw new Error(`login ${username}: demasiados intentos`);
}
async function llamar(username, metodo, ruta, cuerpo) {
  const headers = {};
  if (username) headers.authorization = `Bearer ${(await login(username)).token}`;
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) =>
  (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 600);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);
async function rechazo(codigo, patron, u, m, ruta, c) {
  const j = await exigir(codigo, u, m, ruta, c);
  afirmar(patron.test(msg(j)), `${m} ${ruta}: mensaje inesperado «${msg(j)}»`);
  return j;
}

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
  const puerto = new URL(BASE).port || "5091";
  const env = {
    // Zona del PROCESO deliberadamente hostil: la regla no debe depender de ella.
    ...process.env, TZ: TZ_HOSTIL, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:5092",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-f8-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  admin: "demo.admin", calidad: "demo.calidad", finanzas: "demo.finanzas", planif: "demo.planificacion", recepcion: "demo.recepcion",
};
const ZONA = "America/Santiago";
/** Hoy en Chile, calculado aquí sin depender de la zona de este equipo. */
const hoyChile = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const sumarDias = (dia, n) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const C = {};

async function main() {
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  console.log(`Frente f8 · zona horaria y refresco de la OT (${BASE})`);
  await recorrido();
}

async function recorrido() {
  const HOY = hoyChile();
  const avance = async (otId, u = U.planif) => { const a = await ok(u, "GET", `/ot/${otId}/avance`); return a?.data ?? a; };
  const textoAvance = (a) => JSON.stringify(a);

  await paso("Zona · /health: zona America/Santiago, «hoy» de Chile y sesión de base de datos en la misma zona", async () => {
    const h = await exigir(200, null, "GET", "/health");
    const z = h.zonaHoraria ?? {};
    afirmar(z.zona === ZONA, `zona ${z.zona}`);
    // Si el guion corre justo en el cambio de día, se tolera el día anterior o el siguiente de la comprobación.
    afirmar([HOY, hoyChile()].includes(z.hoy), `la API dice que hoy es ${z.hoy}; en Chile es ${HOY}`);
    afirmar(z.sesionBd === ZONA, `la sesión de base de datos de la API está en ${z.sesionBd}`);
    return `hoy ${z.hoy} · sesión BD ${z.sesionBd}`;
  });

  await paso("Preparación: LPN, cliente y una OT abierta HOY (demo.planificacion); demo.finanzas no crea OT", async () => {
    const labs = lista(await ok(U.planif, "GET", "/ot/laboratorios"));
    C.LPN = labs.find((u) => u.codigo === "LPN");
    C.cliente = lista(await ok(U.admin, "GET", "/clientes?limit=5"))[0];
    afirmar(C.LPN && C.cliente, "faltan LPN o cliente");
    const cuerpo = { clienteId: C.cliente.id, unidadPrincipalId: C.LPN.id, notas: "OT de prueba del frente f8 (zona horaria)" };
    await exigir(403, U.finanzas, "POST", "/ot", cuerpo);
    C.ot = await ok(U.planif, "POST", "/ot", cuerpo);
    return `${C.ot.codigo} · abierta ${C.ot.createdAt}`;
  });

  await paso("D01-25 · muestra sin recepción: la Ruta avisa «recepción incompleta»", async () => {
    const met = lista(await ok(U.planif, "GET", "/cat/metodos?search=pH&limit=20"));
    afirmar(met.length, "no hay métodos «pH» en el catálogo");
    const r = await ok(U.planif, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: "Muestra de prueba f8", metodoIds: [met[0].id] }] });
    C.muestra = (r.muestras ?? [])[0];
    afirmar(C.muestra?.id, `sin muestra: ${JSON.stringify(r).slice(0, 200)}`);
    const a = await avance(C.ot.id);
    afirmar(/recepci[oó]n incompleta/.test(textoAvance(a)), "la Ruta no avisa la recepción incompleta");
    return `${C.muestra.codigo ?? C.muestra.id}`;
  });

  await paso("D01-25 · «Guardar recepción»: demo.finanzas 403; demo.recepcion la completa y la Ruta deja de avisar", async () => {
    const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const toma = (reg.opcionesToma ?? [])[0]?.codigo;
    afirmar(toma, "sin opciones de toma de muestra");
    const cuerpo = { tomaMuestra: toma, condicionRecepcion: "cumple", identificacionCliente: "Envase 1 (f8)" };
    const prod = lista(await ok(U.recepcion, "GET", `/recepcion/ot/${C.ot.id}/productos`).then((x) => x?.productos ?? x));
    if (reg.configRecepcion?.productoObligatorio && prod.length) cuerpo.catElementoId = prod[0].id;
    await exigir(403, U.finanzas, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    await ok(U.recepcion, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    const a = await avance(C.ot.id);
    afirmar(!/recepci[oó]n incompleta/.test(textoAvance(a)), `la Ruta sigue avisando: ${textoAvance(a).match(/[^"]*recepci[oó]n incompleta[^"]*/)?.[0]}`);
    return "Ruta sin aviso";
  });

  await paso("OI · fecha de envío = hoy en Chile sobre la OT abierta hoy: se acepta; ayer: «anterior a la apertura»; demo.calidad 403", async () => {
    const d = lista(await ok(U.planif, "GET", `/ordenes-internas/destinos?otId=${C.ot.id}`));
    let destino = null, ensayos = [];
    for (const x of d) {
      const e = lista(await ok(U.planif, "GET", `/ordenes-internas/destinos/${x.id}/ensayos?otId=${C.ot.id}`));
      if (e.length) { destino = x; ensayos = [e[0].id]; break; }
    }
    afirmar(destino, "ningún destino con ensayos");
    const cuerpo = { otId: C.ot.id, destinoLab: destino.id, ensayos, detalle: "Prueba de zona horaria (f8)", muestraId: C.muestra.id, requisito: "Requisito de prueba f8 (punto 1)", fechaEnvio: HOY };
    await exigir(403, U.calidad, "POST", "/ordenes-internas", cuerpo);
    await rechazo(400, /anterior a la apertura/, U.planif, "POST", "/ordenes-internas", { ...cuerpo, fechaEnvio: sumarDias(HOY, -1) });
    C.oi = await ok(U.planif, "POST", "/ordenes-internas", cuerpo);
    afirmar(String(C.oi.fechaEnvio ?? "").slice(0, 10) === HOY, `fecha de envío guardada ${C.oi.fechaEnvio}`);
    return `${C.oi.numero} · envío ${HOY} → ${destino.unidadCodigo}`;
  });

  await paso("Plazo · «vence hoy»: compromiso = hoy en Chile → por_vencer con 0 días; antes de la recepción 400; demo.finanzas 403", async () => {
    await exigir(403, U.finanzas, "PUT", `/ot/${C.ot.id}/fecha-compromiso`, { fecha: HOY });
    await rechazo(400, /anterior a la recepci/, U.planif, "PUT", `/ot/${C.ot.id}/fecha-compromiso`, { fecha: sumarDias(HOY, -1) });
    await ok(U.planif, "PUT", `/ot/${C.ot.id}/fecha-compromiso`, { fecha: HOY, motivo: "Prueba de «vence hoy» (f8)" });
    const c = await ok(U.planif, "GET", `/ot/${C.ot.id}/cierre`);
    const p = (c?.data ?? c).plazo;
    afirmar(p.fechaCompromiso === HOY && p.semaforo === "por_vencer" && p.diasRestantes === 0, `plazo ${JSON.stringify(p)}`);
    return `${p.fechaCompromiso} · ${p.semaforo} · ${p.diasRestantes} días`;
  });

  await paso("Bitácora · desde = hasta = hoy cubre el día de Chile (incluye la OT recién creada); mañana no; demo.finanzas 403", async () => {
    await exigir(403, U.finanzas, "GET", `/auditoria?desde=${HOY}&hasta=${HOY}&limit=5`);
    const q = (d1, d2) => ok(U.admin, "GET", `/auditoria?desde=${d1}&hasta=${d2}&entidadCodigo=${encodeURIComponent(C.ot.codigo)}&limit=50`);
    const hoy = lista(await q(HOY, HOY));
    afirmar(hoy.length > 0, `la bitácora de hoy no trae movimientos de ${C.ot.codigo}`);
    const manana = lista(await q(sumarDias(HOY, 1), sumarDias(HOY, 1)));
    afirmar(manana.length === 0, `la bitácora de mañana trae ${manana.length} movimientos de ${C.ot.codigo}`);
    return `${hoy.length} movimiento(s) hoy · 0 mañana`;
  });

  const fallos = pasos.filter((p) => !p.ok).length;
  console.log(`\nResultado: ${pasos.length - fallos}/${pasos.length} pasos correctos${fallos ? ` · ${fallos} FALLO(S)` : " · todo en verde"}`);
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e) => { console.error(`ERROR: ${e.message}`); process.exitCode = 1; })
  .finally(pararApi);
