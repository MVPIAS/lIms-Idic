#!/usr/bin/env node
/**
 * Entrega R4 · frente r4a · Metrología: ficha de calibración y cálculo (tema T28,
 * EP-04), contra una API real. Cada regla con un perfil que puede y otro que no.
 *
 *  - BL-029/033: servicios de calibración con su código EN en el catálogo; la línea
 *    cotizada pasa su IT al ítem de la OT (si es del laboratorio de la OT).
 *  - BL-195: condiciones corregidas con el termohigrómetro y el barómetro del maestro.
 *  - BL-197: punto fuera del rango calibrado del patrón → bloqueo (o aviso, parámetro).
 *  - BL-196/202: fechas de control de la hoja y magnitud en la bandeja.
 *  - BL-198: balance uᵢ por punto (√Σuᵢ² = uc del motor).
 *  - BL-199: error normalizado frente a la calibración anterior del mismo instrumento.
 *  - BL-156: «Mi bandeja» de Metrología (enviar, revisar, emitir, entregar).
 *  - BL-170: aviso al emitir y «Enviar por correo» (sin SMTP: queda en la bitácora).
 *  - BL-075: equipo del laboratorio dueño actualizado al emitir (OT interlaboratorio).
 *  - BL-056: informe técnico del no calibrable (elaborar, devolver, emitir, entregar)
 *    y parámetro que lo exige para el cierre técnico.
 *  - BL-095: servicio externo (Jefe Lab. solicita, Jefe de Departamento aprueba, envío,
 *    certificado externo PDF, validación).
 *  - BL-201: el certificado del LNF de un transductor del maestro publica clase y t/u/v.
 *  - Formatos: ASTM de ITT01 y certificado bilingüe del LNF.
 * Reglas: docs/FLUJO_METROLOGIA.md §9.
 *
 * Uso:
 *   node scripts/verificacion/r4-r4a.js [--arrancar] [--base http://localhost:4831/api]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA.
 * Deja OT, calibraciones e informes de prueba; los parámetros y patrones que toca los
 * deja como estaban. Úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4831/api");
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
  const esForm = typeof FormData !== "undefined" && cuerpo instanceof FormData;
  if (cuerpo !== undefined && !esForm) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  if ((r.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; } }
  return { status: r.status, json, buf, tipo: r.headers.get("content-type") || "" };
}
const msg = (j) => (j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 400);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json ?? r;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);
async function rechazo(codigo, patron, u, m, ruta, c) {
  const j = await exigir(codigo, u, m, ruta, c);
  afirmar(patron.test(msg(j)), `${m} ${ruta}: mensaje inesperado «${msg(j)}»`);
  return msg(j);
}

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
  const puerto = new URL(BASE).port || "4831";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r4-r4a-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ RECORRIDO === */
const U = {
  ventas: "demo.ventas", planif: "demo.planificacion", calidad: "demo.calidad",
  jefe: "demo.lmt.jefe", metro: "demo.lmt.analista1", depto: "demo.dsa.jefe", fin: "demo.finanzas",
  lqcJefe: "demo.lqc.jefe", lqcA: "demo.lqc.analista1",
  lmteJefe: "demo.lmte.jefe", lmteA: "demo.lmte.analista1", lnfA: "demo.lnf.analista1", lnfJefe: "demo.lnf.jefe", admin: "demo.admin",
};
const sello = Date.now().toString(36).toUpperCase();
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const ahoraIso = () => new Date().toISOString();
const CONF = "/parametros/configurables";
const PDF_MIN = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = { restaurar: [] };
  try {
    await recorrido(C);
  } finally {
    // Parámetros y maestros tocados vuelven a su valor (orden inverso).
    for (const f of C.restaurar.reverse()) await f().catch((e) => console.log(`  (no se pudo restaurar: ${e.message})`));
  }
}

const recibir = (calibrable, extra = {}) => ({
  fechaHora: ahoraIso(), entregadoPor: "Cliente de prueba", estadoFisico: calibrable ? "bueno" : "danado", ubicacion: "Estante R4",
  calibrable, ...(calibrable ? {} : { estadoFisicoObs: "Golpe en la carcasa", motivoNoCalibrable: "Daño en el mecanismo: no repite la indicación" }), ...extra,
});

async function recorrido(C) {
  const met = async (otId, u = U.jefe) => ok(u, "GET", `/ot/${otId}/metrologia`);
  const param = async (cod) => {
    const g = (await ok(U.calidad, "GET", CONF)).grupos.find((x) => x.categoria === "metrologia_ficha");
    return g.parametros.find((p) => p.codigo === cod);
  };
  const fijar = async (cod, valor, motivo = "Prueba del guion r4-r4a") => {
    const antes = await param(cod);
    if (JSON.stringify(antes.valor) === JSON.stringify(valor)) return;
    await ok(U.calidad, "PUT", `${CONF}/metrologia_ficha/${cod}`, { valor, motivo });
    C.restaurar.push(() => ok(U.calidad, "PUT", `${CONF}/metrologia_ficha/${cod}`, { valor: antes.valor, motivo: "Restaurado por el guion r4-r4a" }));
  };

  await paso("Preparación: laboratorios, centros de costo, cliente, caso ITM02 (M-3889), patrones y auxiliares del maestro", async () => {
    const labs = lista(await ok(U.planif, "GET", "/ot/laboratorios"));
    for (const k of ["LMT", "LMTE", "LNF"]) C[k] = labs.find((u) => u.codigo === k);
    C.clienteId = lista(await ok(U.admin, "GET", "/clientes?limit=5"))[0]?.id;
    const cc = lista(await ok(U.admin, "GET", "/centros-costo?limit=500"));
    C.ccLqc = cc.find((x) => x.codigo === "LQC-001"); C.ccLmt = cc.find((x) => x.codigo === "LMT-001");
    afirmar(C.LMT && C.LMTE && C.LNF && C.clienteId && C.ccLqc && C.ccLmt, "faltan laboratorios, cliente o centros de costo");
    C.datosM2 = (await ok(U.metro, "GET", "/metrologia/motores/ITM02/ejemplo")).data.datos;
    const p = (await ok(U.jefe, "GET", `/metrologia/patrones?fecha=${hoy()}`)).data;
    C.pat = p.find((x) => x.codigo === "PM-01"); C.th = p.find((x) => x.codigo === "PM-48"); C.ba = p.find((x) => x.codigo === "PM-49");
    afirmar(C.pat?.estado === "vigente" && C.th && C.ba, "faltan PM-01 vigente, PM-48 o PM-49");
    return `M-3889 (${C.datosM2.pts.length} puntos) · ${C.pat.codigo} · ${C.th.codigo} y ${C.ba.codigo}`;
  });

  await paso("Parámetros de la ficha: Calidad los ve y cambia con motivo; el Jefe de LQC no los cambia", async () => {
    const g = (await ok(U.calidad, "GET", CONF)).grupos.find((x) => x.categoria === "metrologia_ficha");
    afirmar(g && g.parametros.length === 5 && g.porConfirmar, "falta el grupo metrologia_ficha");
    await exigir(403, U.lqcJefe, "PUT", `${CONF}/metrologia_ficha/criterio_en`, { valor: "<1", motivo: "No le corresponde" });
    await rechazo(400, /opciones/, U.calidad, "PUT", `${CONF}/metrologia_ficha/criterio_en`, { valor: "<2", motivo: "Valor inválido" });
    await fijar("no_apto_exige_documento", true, "Prueba r4a: el no calibrable exige su documento");
    await fijar("criterio_en", "<=1");
    await fijar("patron_fuera_rango", "bloquear");
    await fijar("actualizar_equipo", "emitir");
    await fijar("notificar_emision", true);
    return g.parametros.map((x) => `${x.codigo}=${x.texto ?? x.valor}`).join(" · ");
  });

  await paso("Maestros: rango calibrado del patrón y errores del certificado de los auxiliares (solo metrologia.config)", async () => {
    const r = { rango_min: 0, rango_max: 5, unidad_rango: "g" };
    await exigir(403, U.metro, "PUT", `/metrologia/patrones/${C.pat.id}`, r);
    await rechazo(400, /mínimo del rango/, U.jefe, "PUT", `/metrologia/patrones/${C.pat.id}`, { rango_min: 10, rango_max: 5, unidad_rango: "g" });
    await rechazo(400, /unidad del rango/, U.jefe, "PUT", `/metrologia/patrones/${C.pat.id}`, { rango_min: 0, rango_max: 5, unidad_rango: null });
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.pat.id}`, r);
    C.restaurar.push(() => ok(U.jefe, "PUT", `/metrologia/patrones/${C.pat.id}`, { rango_min: C.pat.rango_min ?? null, rango_max: C.pat.rango_max ?? null, unidad_rango: C.pat.unidad_rango ?? null }));
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.th.id}`, { correcciones: { temp: { error: -0.2, U: 0.6 }, hum: { error: 1.3, U: 2.5 } } });
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.ba.id}`, { correcciones: { pres: { error: -1.2, U: 0.2 } } });
    C.restaurar.push(() => ok(U.jefe, "PUT", `/metrologia/patrones/${C.th.id}`, { correcciones: C.th.correcciones ?? null }));
    C.restaurar.push(() => ok(U.jefe, "PUT", `/metrologia/patrones/${C.ba.id}`, { correcciones: C.ba.correcciones ?? null }));
    const p = (await ok(U.metro, "GET", "/metrologia/patrones")).data.find((x) => x.id === C.th.id);
    afirmar(p.correcciones?.temp?.error === -0.2, JSON.stringify(p.correcciones));
    return "metrólogo → 403 · mín > máx → 400 · PM-01 0 a 5 g · PM-48/PM-49 con errores del certificado";
  });

  /* --------------------------------------------- BL-029 / 033 · catálogo */
  await paso("BL-029/033 · Comercial cotiza los servicios EN1074 (ITM02) y EN1032 (LNF) del catálogo; la OT del LMT hereda solo la IT de su laboratorio", async () => {
    const buscar = async (cod) => lista(await ok(U.ventas, "GET", `/cat/ensayos?search=${cod}&limit=5`)).find((e) => e.codigo === cod);
    const b = await buscar("EN1074"), f = await buscar("EN1032");
    afirmar(b && f && b.instruccionTrabajo === "ITM02" && f.instruccionTrabajo === "LCPNF-IT01" && Number(b.precio) > 0, `servicios: ${JSON.stringify([b, f]).slice(0, 300)}`);
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.clienteId, formato: "NORMAL", plazoEntregaDias: 15, referencia: `R4a Metrología ${sello}`,
      lineas: [{ catEnsayoId: b.id, cantidad: 1 }, { catEnsayoId: f.id, cantidad: 1 }],
    });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok("demo.dco.jefe", "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, { tipo: "OC", numero: `OC-${sello}`, fecha: hoy(), conCobro: true, unidadPrincipalId: C.LMT.id });
    C.ot = await ok(U.jefe, "GET", `/ot/${r?.ot?.id ?? r?.otId ?? r?.ot_id}`);
    await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/desde-cotizacion`);
    const m = await met(C.ot.id);
    [C.i1, C.i2] = m.instrumentos;
    afirmar(C.i1.procesoCodigo === "ITM02" && C.i2.procesoCodigo == null, `IT heredadas: ${C.i1.procesoCodigo} / ${C.i2.procesoCodigo}`);
    return `${C.cot.codigo} (${b.codigo} $${Number(b.precio).toLocaleString("es-CL")}) → ${C.ot.codigo} · ítem 1 ITM02 · ítem 2 sin IT (LNF ≠ LMT)`;
  });

  await paso("Recepción: ítem 1 calibrable (serie y equipo) e ítem 2 no calibrable; asignación al metrólogo", async () => {
    C.serie = `B-${sello}`;
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/instrumentos/${C.i1.id}`, { descripcion: "Balanza analítica", marca: "Mettler", serie: C.serie, capacidad: "50 g", procesoCodigo: "ITM02" });
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/instrumentos/${C.i2.id}`, { descripcion: "Celda de carga 50 kN", serie: `CC-${sello}` });
    const c = await ok(U.jefe, "GET", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/metrologos`);
    await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/asignar`, { metrologoId: c.data.find((x) => x.username === U.metro).id });
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/recepcion`, recibir(true));
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2.id}/recepcion`, recibir(false));
    return "ítem 1 recibido · ítem 2 no apto";
  });

  /* ------------------------------------- BL-195 / BL-197 · hoja de control */
  await paso("BL-197 · Puntos fuera del rango calibrado del patrón (PM-01 0 a 5 g): no se acepta extrapolar (400)", async () => {
    C.cuerpo = {
      otInstrumentoId: C.i1.id, procesoCodigo: "ITM02", fecha: hoy(), patronIds: [C.pat.id], intervaloMeses: 12,
      instrumento: { lugar: "instalaciones" },
      auxiliares: { termohigrometroId: C.th.id, barometroId: C.ba.id, lecturas: { temp: [18.9, 19.1], hum: [59.4, 59.0], pres: [953.5, 953.3] } },
      motor: { datos: C.datosM2, opciones: {} },
    };
    const m = await rechazo(400, /No se acepta extrapolar/, U.metro, "POST", "/metrologia/calibraciones", C.cuerpo);
    afirmar(/50 g está fuera del rango calibrado de PM-01/.test(m), m);
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.pat.id}`, { rango_min: 0, rango_max: 220, unidad_rango: "g" });
    return "10, 20 y 50 g fuera de 0 a 5 g → 400 · rango ampliado a 0 a 220 g";
  });

  await paso("BL-195 · Condiciones corregidas con PM-48 y PM-49: promedio − error del certificado, con su U, en la hoja y en el certificado", async () => {
    await exigir(403, U.lqcA, "POST", "/metrologia/calibraciones", C.cuerpo);
    const r = await ok(U.metro, "POST", "/metrologia/calibraciones", C.cuerpo);
    C.cal1 = r.data;
    const d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal1.id}`);
    afirmar(d.ambiente.temp === "19,2" && d.ambiente.tempU === "0,6" && d.ambiente.hum === "57,9" && d.ambiente.pres === "954,6", JSON.stringify(d.ambiente));
    afirmar(d.auxiliares?.termohigrometro?.codigo === "PM-48" && d.auxiliares?.corregidas?.pres?.error === -1.2, "no se guardó la copia de los auxiliares");
    const h = (await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal1.id}/html`)).data.html;
    // Balanzas (ITM02): el libro no imprime la presión (solo masas patrón, volumen y presión).
    afirmar(h.includes("(19,2 ± 0,6) °C") && h.includes("(57,9 ± 2,5) %"), "el certificado no informa la condición corregida");
    return `${C.cal1.codigo}: T 19,0 − (−0,2) = 19,2 °C · HR 57,9 % · P 954,6 hPa · LQC → 403`;
  });

  await paso("BL-195/197 · Al corregir: auxiliar vencido → 400; con el parámetro «avisar», el punto fuera de rango solo avisa", async () => {
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.ba.id}`, { vence: "2020-01-01" });
    C.restaurar.push(() => ok(U.jefe, "PUT", `/metrologia/patrones/${C.ba.id}`, { vence: String(C.ba.vence).slice(0, 10) }));
    await rechazo(400, /venció/, U.metro, "PUT", `/metrologia/calibraciones/${C.cal1.id}`, C.cuerpo);
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.ba.id}`, { vence: String(C.ba.vence).slice(0, 10) });
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.pat.id}`, { rango_min: 0, rango_max: 5, unidad_rango: "g" });
    await rechazo(400, /No se acepta extrapolar/, U.metro, "PUT", `/metrologia/calibraciones/${C.cal1.id}`, C.cuerpo);
    await fijar("patron_fuera_rango", "avisar", "Prueba r4a: solo avisar");
    const r = await ok(U.metro, "PUT", `/metrologia/calibraciones/${C.cal1.id}`, C.cuerpo);
    afirmar(r.data.avisos.some((a) => /fuera del rango calibrado/.test(a)), JSON.stringify(r.data.avisos));
    await fijar("patron_fuera_rango", "bloquear", "Prueba r4a: vuelve a bloquear");
    await ok(U.jefe, "PUT", `/metrologia/patrones/${C.pat.id}`, { rango_min: 0, rango_max: 220, unidad_rango: "g" });
    await ok(U.metro, "PUT", `/metrologia/calibraciones/${C.cal1.id}`, C.cuerpo);
    return "barómetro vencido → 400 · «bloquear» → 400 · «avisar» → aviso";
  });

  await paso("BL-198/196/202 · Ficha: balance uᵢ por punto (√Σuᵢ² = uc), fechas de control y magnitud en la bandeja", async () => {
    const d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal1.id}`);
    afirmar(d.balance?.motor === "ITM02" && d.balance.puntos.length === C.datosM2.pts.length, "sin balance por punto");
    for (const p of d.balance.puntos) {
      const s = Math.sqrt(p.componentes.reduce((t, x) => t + x.ui ** 2, 0));
      afirmar(Math.abs(s - p.ucMotor) / p.ucMotor < 1e-9 && Math.abs(p.componentes.reduce((t, x) => t + x.aporte, 0) - 100) < 1e-6, `punto ${p.nominal}`);
    }
    afirmar(d.balance.puntos[0].componentes.map((x) => x.simbolo).join(",") === "u_p,u_rep,u_d,u_exc,u_0,u_der", "componentes de ITM02");
    afirmar(d.oc_numero === `OC-${sello}` && d.fecha_solicitud && d.termino_previsto && d.termino_real == null, `fechas: ${d.oc_numero} ${d.fecha_solicitud} ${d.termino_previsto}`);
    const l = (await ok(U.metro, "GET", "/metrologia/calibraciones?limit=50")).data.find((x) => x.id === C.cal1.id);
    afirmar(l.magnitud === "masa" && l.termino_previsto && l.ot_codigo === C.ot.codigo, "la bandeja no trae magnitud, término previsto u OT");
    return `${d.balance.puntos.length} puntos · O/C ${d.oc_numero} · término previsto ${d.termino_previsto}`;
  });

  /* ------------------------------------------------ BL-156 · Mi bandeja */
  const tarjeta = async (u, clave) => lista(await ok(u, "GET", "/metrologia/bandeja")).find((x) => x.clave === clave)?.cantidad ?? 0;
  await paso("BL-156 · Mi bandeja: borradores por enviar (metrólogo), por revisar (Jefe LMT), por emitir (Jefe de Departamento)", async () => {
    afirmar((await tarjeta(U.metro, "met_por_enviar")) >= 1, "el metrólogo no ve su borrador por enviar");
    const me = await ok(U.metro, "GET", "/me/bandeja");
    afirmar(lista(me).some((x) => x.clave === "met_por_enviar" && x.ruta === "/metrologia?pendiente=enviar"), "/me/bandeja no suma las tarjetas de Metrología");
    afirmar(!lista(await ok(U.lqcJefe, "GET", "/me/bandeja")).some((x) => x.clave.startsWith("met_")), "LQC ve tarjetas de Metrología");
    await exigir(403, U.lqcJefe, "GET", "/metrologia/bandeja");
    await ok(U.metro, "POST", `/metrologia/calibraciones/${C.cal1.id}/enviar`);
    afirmar((await tarjeta(U.jefe, "met_por_revisar")) >= 1, "el Jefe LMT no ve la calibración por revisar");
    afirmar((await tarjeta(U.depto, "met_por_revisar")) === 0, "el Jefe de Departamento ve por revisar algo que no le toca");
    await ok(U.jefe, "POST", `/metrologia/calibraciones/${C.cal1.id}/firmar`);
    afirmar((await tarjeta(U.depto, "met_por_emitir")) >= 1, "el Jefe de Departamento no ve el certificado por emitir");
    return "por enviar → por revisar (solo el Jefe LMT) → por emitir · LQC sin tarjetas";
  });

  /* ------------------------------------------- BL-170 · aviso y correo */
  await paso("BL-170 · Al emitir se avisa al cliente por correo (sin SMTP: queda en la bitácora y la emisión sigue)", async () => {
    const e = await ok(U.depto, "POST", `/metrologia/calibraciones/${C.cal1.id}/firmar`);
    C.num1 = e.data.numero;
    afirmar(/^M-\d+$/.test(C.num1) && e.data.aviso && e.data.aviso.ok === false, JSON.stringify(e.data).slice(0, 300));
    const d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal1.id}`);
    afirmar(d.estado === "emitida" && d.eventos.some((x) => x.accion === "NOTIFICADA"), "la bitácora no registra el aviso");
    afirmar((await tarjeta(U.metro, "met_por_entregar")) >= 1, "falta la tarjeta «por entregar»");
    return `${C.num1} emitido · aviso: ${e.data.aviso.motivo?.slice(0, 70)}`;
  });

  await paso("BL-170 · «Enviar por correo»: Finanzas y LQC no; sin SMTP responde ok:false y no registra la entrega", async () => {
    const cuerpo = { destinatarios: ["calidad@cliente.cl"], mensaje: "Adjuntamos su certificado." };
    await exigir(403, U.fin, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal1.id}/enviar-correo`, cuerpo);
    await exigir(403, U.lqcJefe, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal1.id}/enviar-correo`, cuerpo);
    await exigir(400, U.ventas, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal1.id}/enviar-correo`, { destinatarios: ["no-es-correo"] });
    const r = await ok(U.ventas, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal1.id}/enviar-correo`, cuerpo);
    afirmar(r.data.ok === false && r.data.entregado === false && /No se pudo enviar/.test(r.data.error), JSON.stringify(r.data));
    const d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal1.id}`);
    afirmar(!d.entregado_at && d.eventos.some((x) => x.accion === "CORREO"), "la bitácora no registra el intento de envío");
    await ok(U.ventas, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal1.id}/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    return "Finanzas/LQC → 403 · correo inválido → 400 · sin SMTP: ok:false, sin entrega · entrega en mano registrada";
  });

  /* ------------------------------------------ BL-056 · informe técnico */
  const base2 = () => `/ot/${C.ot.id}/instrumentos/${C.i2.id}`;
  await paso("BL-056 · Cierre técnico con el parámetro activo: falta el informe técnico del no calibrable", async () => {
    const m = await met(C.ot.id);
    afirmar(!m.cierreTecnico.posible && /informe técnico emitido o el servicio externo validado.*ítem 2/.test(m.cierreTecnico.motivo), m.cierreTecnico.motivo);
    await rechazo(409, /Falta el informe técnico/, U.jefe, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    return m.cierreTecnico.motivo;
  });

  await paso("BL-056 · Informe técnico: el metrólogo elabora y envía; la jefatura devuelve y emite IT-NNNN; Comercial lo entrega", async () => {
    const inf = { motivo: "El plato está deformado: no repite la indicación", hallazgos: "Deformación del plato y golpe en la carcasa", recomendacion: "Reparar y volver a calibrar" };
    await exigir(403, U.lqcA, "POST", `${base2()}/informe-tecnico`, inf);
    await rechazo(400, /hallazgos/, U.metro, "POST", `${base2()}/informe-tecnico`, { ...inf, hallazgos: "x" });
    await rechazo(400, /no calibrable/, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/informe-tecnico`, inf);
    await ok(U.metro, "POST", `${base2()}/informe-tecnico`, inf);
    await exigir(403, U.metro, "POST", `${base2()}/informe-tecnico/emitir`);
    await ok(U.metro, "POST", `${base2()}/informe-tecnico/enviar`);
    await exigir(400, U.jefe, "POST", `${base2()}/informe-tecnico/devolver`, { motivo: "x" });
    await ok(U.jefe, "POST", `${base2()}/informe-tecnico/devolver`, { motivo: "Agregue la recomendación al cliente" });
    await ok(U.metro, "POST", `${base2()}/informe-tecnico`, inf);
    await ok(U.metro, "POST", `${base2()}/informe-tecnico/enviar`);
    const e = await ok(U.jefe, "POST", `${base2()}/informe-tecnico/emitir`);
    afirmar(/^IT-\d{4,}$/.test(e.data.numero) && e.data.hash?.length === 64, JSON.stringify(e.data));
    const pdf = await llamar(U.ventas, "GET", `${base2()}/informe-tecnico/pdf`);
    afirmar(pdf.status === 200 && pdf.buf.subarray(0, 5).toString() === "%PDF-", `PDF ${pdf.status}`);
    await exigir(403, U.fin, "POST", `${base2()}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Cliente" });
    await ok(U.ventas, "POST", `${base2()}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    await rechazo(409, /ya está registrada/, U.ventas, "POST", `${base2()}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Cliente" });
    const doc = (await ok(U.jefe, "GET", `/ot/${C.ot.id}/metrologia/documentos`)).data.find((x) => x.instrumento.id === C.i2.id);
    afirmar(doc.informe.estado === "emitido" && doc.informe.numero === e.data.numero && doc.informe.entregado_at, "el informe no figura emitido y entregado");
    C.it = e.data.numero;
    return `${e.data.numero} · metrólogo no emite → 403 · devuelto y reenviado · Finanzas no entrega → 403`;
  });

  await paso("BL-056 · Con el informe emitido, el Jefe LMT cierra técnicamente la OT (Comercial no puede)", async () => {
    await exigir(403, U.ventas, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    const r = await ok(U.jefe, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    afirmar(r.data.estado === "finalizada", JSON.stringify(r.data));
    return "OT finalizada";
  });

  /* --------------------------- BL-199 / BL-075 · OT interlaboratorio */
  await paso("BL-075/199 · OT interlaboratorio (LQC → LMT) del mismo instrumento enlazado al equipo EQ-BAL-001 de LQC", async () => {
    C.ot2 = await ok(U.planif, "POST", "/ot", {
      clienteId: C.clienteId, unidadPrincipalId: C.LMT.id, origenTrabajo: "INTERLABORATORIO", conCobro: false,
      labSolicitanteCcId: C.ccLqc.id, centroCostoId: C.ccLmt.id, descripcionTrabajo: `R4a interlaboratorio ${sello}`,
    });
    const it = await ok(U.jefe, "POST", `/ot/${C.ot2.id}/instrumentos`, { descripcion: "Balanza analítica", serie: C.serie, procesoCodigo: "ITM02", equipoCodigo: "EQ-BAL-001", intervaloMeses: 12 });
    C.j1 = it.data.id;
    await ok(U.metro, "POST", `/ot/${C.ot2.id}/instrumentos/${C.j1}/recepcion`, recibir(true));
    const datos = JSON.parse(JSON.stringify(C.datosM2));
    datos.pts[3].s = datos.pts[3].s.map((x) => x + 0.0002); // otra lectura en 0,1 g
    const r = await ok(U.metro, "POST", "/metrologia/calibraciones", { ...C.cuerpo, otInstrumentoId: C.j1, intervaloMeses: 12, motor: { datos, opciones: {} } });
    C.cal2 = r.data;
    const eq = lista(await ok(U.lqcJefe, "GET", "/equipos?search=EQ-BAL-001")).find((x) => x.codigo === "EQ-BAL-001");
    C.eq = eq;
    return `${C.ot2.codigo} · ${C.cal2.codigo} · equipo ${eq.codigo} (próxima ${String(eq.proximaCalibracion ?? eq.proxima_calibracion).slice(0, 10)})`;
  });

  await paso("BL-199 · Error normalizado frente a la calibración anterior del mismo instrumento (informativo, criterio del parámetro)", async () => {
    const a = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal2.id}/anterior`);
    afirmar(a.data?.numero_certificado === C.num1 && a.criterio === "<=1", `anterior ${a.data?.numero_certificado} (esperado ${C.num1})`);
    afirmar(a.filas.length === C.datosM2.pts.length && a.filas.every((f) => f.en != null && ["compatible", "revisar"].includes(f.criterio)), JSON.stringify(a.filas.slice(0, 2)));
    const cambia = a.filas.find((f) => f.nominal === C.datosM2.pts[3].nom);
    afirmar(cambia.en > 0 && a.filas.filter((f) => f.en === 0).length === a.filas.length - 1, `Eₙ ${a.filas.map((f) => f.en).join(",")}`);
    await exigir(403, U.lqcJefe, "GET", `/metrologia/calibraciones/${C.cal2.id}/anterior`);
    return `anterior ${C.num1} · Eₙ en 0,1 g = ${cambia.en.toFixed(3)} (${cambia.criterio}) · demás 0`;
  });

  await paso("BL-075 · Al emitir, el equipo EQ-BAL-001 del laboratorio dueño toma la calibración (última, próxima = emisión + 12 meses)", async () => {
    await ok(U.metro, "POST", `/metrologia/calibraciones/${C.cal2.id}/enviar`);
    await ok(U.jefe, "POST", `/metrologia/calibraciones/${C.cal2.id}/firmar`);
    const e = await ok(U.depto, "POST", `/metrologia/calibraciones/${C.cal2.id}/firmar`);
    afirmar(/Equipo EQ-BAL-001 actualizado/.test(e.data.equipo ?? ""), `equipo: ${e.data.equipo}`);
    const eq = await ok(U.lqcJefe, "GET", `/equipos/${C.eq.id}`);
    const d = eq.data ?? eq;
    const anio = Number(hoy().slice(0, 4)) + 1;
    afirmar(String(d.fechaUltimaCalibracion ?? d.fecha_ultima_calibracion).slice(0, 10) === hoy() && String(d.proximaCalibracion ?? d.proxima_calibracion).startsWith(String(anio)),
      `equipo: ${JSON.stringify(d).slice(0, 300)}`);
    const h = lista(await ok(U.lqcJefe, "GET", `/equipos/${C.eq.id}/calibraciones`));
    afirmar(h.some((x) => (x.certificadoRef ?? x.certificado_ref) === e.data.numero), "el historial del equipo no tiene el certificado");
    const cal = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal2.id}`);
    afirmar(cal.eventos.some((x) => x.accion === "NOTIFICADA" && /laboratorio dueño/.test(x.comentario)), "sin aviso al laboratorio dueño en la bitácora");
    return `${e.data.numero} · equipo actualizado · aviso: sin jefe con correo en LQC`;
  });

  /* ------------------------------------------- BL-095 · servicio externo */
  await paso("BL-095 · Servicio externo: el Jefe LMT solicita; el metrólogo no; aprueba el Jefe del DSA (no el Jefe LMT)", async () => {
    const it = await ok(U.jefe, "POST", `/ot/${C.ot2.id}/instrumentos`, { descripcion: "Manómetro de alta presión", serie: `MP-${sello}` });
    C.j2 = it.data.id;
    await ok(U.metro, "POST", `/ot/${C.ot2.id}/instrumentos/${C.j2}/recepcion`, recibir(false, { requiereExterno: true, motivoNoCalibrable: "Rango sobre el alcance del laboratorio" }));
    const prov = lista(await ok(U.jefe, "GET", `/ot/${C.ot2.id}/metrologia/proveedores`));
    afirmar(prov.length > 0, "no hay proveedores en el maestro");
    const sol = { proveedorId: prov[0].id, justificacion: "El rango supera la capacidad del patrón del LMT", costo: 250000 };
    const b = `/ot/${C.ot2.id}/instrumentos/${C.j2}/servicio-externo`;
    await exigir(403, U.metro, "POST", b, sol);
    await rechazo(400, /justificación/, U.jefe, "POST", b, { ...sol, justificacion: "x" });
    await ok(U.jefe, "POST", b, sol);
    await rechazo(400, /ya tiene un servicio externo/, U.jefe, "POST", b, sol);
    await rechazo(403, /Jefe del/, U.jefe, "POST", `${b}/aprobar`);
    await ok(U.depto, "POST", `${b}/aprobar`);
    C.bExt = b;
    return `proveedor ${prov[0].razon_social} · metrólogo → 403 · Jefe LMT no aprueba → 403 · Jefe DSA aprueba`;
  });

  await paso("BL-095 · Envío con O/C, certificado externo en PDF (no otro archivo) y validación de aptitud", async () => {
    const b = C.bExt;
    const futuro = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await rechazo(400, /futura/, U.jefe, "POST", `${b}/envio`, { ocNumero: `OC-EXT-${sello}`, fechaEnvio: futuro });
    await ok(U.jefe, "POST", `${b}/envio`, { ocNumero: `OC-EXT-${sello}`, fechaEnvio: hoy() });
    await rechazo(409, /Adjunte primero/, U.jefe, "POST", `${b}/validar`, { aptitud: "apto" });
    const malo = new FormData();
    malo.append("archivo", new Blob([Buffer.from("no es un pdf")], { type: "application/pdf" }), "cert.pdf");
    malo.append("numero", "EXT-1");
    await rechazo(400, /no es un PDF/, U.jefe, "PUT", `${b}/certificado`, malo);
    const bueno = new FormData();
    bueno.append("archivo", new Blob([PDF_MIN], { type: "application/pdf" }), "certificado-externo.pdf");
    bueno.append("numero", `EXT-${sello}`);
    bueno.append("fechaRetorno", hoy());
    await ok(U.metro, "PUT", `${b}/certificado`, bueno);
    await exigir(403, U.metro, "POST", `${b}/validar`, { aptitud: "apto" });
    await exigir(400, U.jefe, "POST", `${b}/validar`, { aptitud: "quizá" });
    await ok(U.jefe, "POST", `${b}/validar`, { aptitud: "apto", comentario: "Cumple lo solicitado" });
    const pdf = await llamar(U.ventas, "GET", `${b}/certificado`);
    afirmar(pdf.status === 200 && pdf.buf.subarray(0, 5).toString() === "%PDF-", `PDF externo ${pdf.status}`);
    const m = await met(C.ot2.id);
    afirmar(m.cierreTecnico.posible, `cierre técnico: ${m.cierreTecnico.motivo}`);
    return "fecha futura → 400 · sin certificado → 409 · no PDF → 400 · validado: el ítem queda resuelto para el cierre técnico";
  });

  /* --------------------------------- BL-201 · LNF → maestro de patrones */
  await paso("BL-201 · El certificado LNF de un transductor del maestro publica clase, t/u/v, U y vencimiento (antes y después)", async () => {
    const serieT = `TR-${sello}`;
    const nuevo = await ok(U.jefe, "POST", "/metrologia/patrones", { codigo: `PF-R4-${sello}`.slice(0, 40), nombre: "Transductor de fuerza de prueba", magnitud: "fuerza", serie: serieT, clase: "Clase 1", laboratorio: "LMT" });
    await exigir(403, U.metro, "POST", "/metrologia/patrones", { codigo: `X-${sello}`, nombre: "No", magnitud: "fuerza" });
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.clienteId, unidadPrincipalId: C.LNF.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: `R4a LNF ${sello}` });
    const it = await ok(U.lnfJefe, "POST", `/ot/${ot.id}/instrumentos`, { descripcion: "Transductor de fuerza", marca: "HBM", modelo: "U15", serie: serieT, procesoCodigo: "LCPNF-IT01", sentido: "T", intervaloMeses: 24 });
    await ok(U.lnfA, "POST", `/ot/${ot.id}/instrumentos/${it.data.id}/recepcion`, {
      ...recibir(true), sentido: "T", acondicionamientoH: 24, tempAmbiente: 19.6,
      accesorios: [{ tipo: "Amplificador", marca: "HBM", modelo: "MGC plus", serie: "801143406/1" }, { tipo: "Cable", detalle: "3,1 m" }],
    });
    const ej = (await ok(U.lnfA, "GET", "/metrologia/motores/LCPNF-IT01/ejemplo")).data;
    const cal = await ok(U.lnfA, "POST", "/metrologia/calibraciones", { otInstrumentoId: it.data.id, procesoCodigo: "LCPNF-IT01", fecha: hoy(), intervaloMeses: 24, motor: { datos: ej.datos, opciones: {} } });
    const html = (await ok(U.lnfA, "GET", `/metrologia/calibraciones/${cal.data.id}/html`)).data.html;
    afirmar(/CALIBRATION CERTIFICATE/i.test(html) && html.includes("Página 6 de 6") && html.includes("MGC plus") && html.includes("Anexo"), "no es el certificado bilingüe del LNF");
    await ok(U.lnfA, "POST", `/metrologia/calibraciones/${cal.data.id}/enviar`);
    await ok(U.lnfJefe, "POST", `/metrologia/calibraciones/${cal.data.id}/firmar`);
    const e = await ok(U.depto, "POST", `/metrologia/calibraciones/${cal.data.id}/firmar`);
    afirmar(/Maestro de patrones/.test(e.data.patron ?? ""), `patrón: ${e.data.patron}`);
    const p = (await ok(U.jefe, "GET", "/metrologia/patrones")).data.find((x) => x.id === nuevo.data.id);
    afirmar(p.n_certificado === e.data.numero && p.coeficientes?.t > 582 && p.coeficientes?.t < 583 && /^Clase /.test(p.clase) && String(p.vence).slice(0, 4) === String(Number(hoy().slice(0, 4)) + 2),
      `patrón: ${JSON.stringify({ n: p.n_certificado, clase: p.clase, t: p.coeficientes?.t, vence: p.vence })}`);
    return `${e.data.numero} → ${p.codigo}: ${p.clase}, t = ${p.coeficientes.t.toFixed(4)}, vence ${String(p.vence).slice(0, 10)}`;
  });

  /* ------------------------------------------------ formato ASTM (ITT01) */
  await paso("Formato ASTM de ITT01 (T-2887): el autor lo elige en la presentación; no aplica a otros procesos", async () => {
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.clienteId, unidadPrincipalId: C.LMTE.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: `R4a ASTM ${sello}` });
    const it = await ok(U.lmteJefe, "POST", `/ot/${ot.id}/instrumentos`, { descripcion: "Termómetro líquido en vidrio", serie: `LT-${sello}`, procesoCodigo: "ITT01" });
    await ok(U.lmteA, "POST", `/ot/${ot.id}/instrumentos/${it.data.id}/recepcion`, recibir(true));
    const ej = (await ok(U.lmteA, "GET", "/metrologia/motores/ITT01/ejemplo")).data;
    const cal = await ok(U.lmteA, "POST", "/metrologia/calibraciones", { otInstrumentoId: it.data.id, procesoCodigo: "ITT01", fecha: hoy(), motor: { datos: ej.datos, opciones: {} } });
    const pr = await ok(U.lmteA, "GET", `/metrologia/calibraciones/${cal.data.id}/certificado`);
    afirmar(pr.data.formatos?.some((f) => f.valor === "astm"), "ITT01 no ofrece el formato ASTM");
    await exigir(403, U.lmteJefe, "PUT", `/metrologia/calibraciones/${cal.data.id}/certificado`, { formato: "astm" });
    await ok(U.lmteA, "PUT", `/metrologia/calibraciones/${cal.data.id}/certificado`, { formato: "astm" });
    const h = (await ok(U.lmteA, "GET", `/metrologia/calibraciones/${cal.data.id}/html`)).data.html;
    afirmar(!/columna emergente/.test(h) && /Indicación del calibrando/.test(h), "el certificado ASTM conserva la columna emergente");
    return `${cal.data.codigo}: formato ASTM sin columna emergente · otro autor → 403 (los demás procesos: prueba unitaria)`;
  });

  /* --------------------------------------------------------- alcance */
  await paso("Alcance: LQC no ve los documentos ni los PDF de la OT del LMT; Comercial ve los documentos sin acciones de laboratorio", async () => {
    await exigir(403, U.lqcJefe, "GET", `/ot/${C.ot.id}/metrologia/documentos`);
    await exigir(403, U.lqcJefe, "GET", `${base2()}/informe-tecnico/pdf`);
    // La OT interlaboratorio la pidió LQC, pero la ejecuta el LMT: el alcance es el del laboratorio ejecutor.
    await exigir(403, U.lqcJefe, "GET", `/ot/${C.ot2.id}/metrologia/proveedores`);
    const d = (await ok(U.ventas, "GET", `/ot/${C.ot.id}/metrologia/documentos`)).data;
    afirmar(d.length && d.every((x) => !x.accionesInforme.includes("EMITIR") && !x.accionesExterno.includes("APROBAR")), "Comercial puede emitir o aprobar");
    return "LQC → 403 · Comercial en solo lectura (entrega)";
  });
}

main()
  .then(() => {
    console.log(`\nR4 · r4a (Metrología: ficha de calibración y cálculo) verificado: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
