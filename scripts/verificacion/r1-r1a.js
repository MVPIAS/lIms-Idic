#!/usr/bin/env node
/**
 * Entrega R1 · frente r1a · Metrología ligada a la OT (EP-04), contra una API real.
 *
 * Recorre el proceso de punta a punta con los perfiles demo.*: cotización con dos
 * calibraciones → aceptación → OT del LMT con cobro → instrumentos desde la
 * cotización → programación (metrólogo habilitado) → recepción con custodia (uno
 * calibrable y otro no) → calibración DESDE el ítem (no hay calibración suelta) →
 * revisión, firma y emisión → entrega del certificado → cierre técnico →
 * devolución del instrumento con acta → cierre de la OT con factura pendiente.
 * Además: numeración por laboratorio (LCPNF-NNN.AA con una calibración real del
 * LNF), reemisión tras el cierre y alcance por laboratorio. Cada regla con un
 * perfil que puede y otro que no. Reglas: docs/FLUJO_METROLOGIA.md §7.
 *
 * Uso:
 *   node scripts/verificacion/r1-r1a.js [--arrancar] [--base http://localhost:4711/api]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA.
 * Deja OT, calibraciones y una factura pendiente de prueba: úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4711/api");
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
  sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id };
  return sesiones[username];
}
async function llamar(username, metodo, ruta, cuerpo) {
  const headers = {};
  if (username) headers.authorization = `Bearer ${(await login(username)).token}`;
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!ok) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);
/** Exige el código y que el mensaje diga lo esperado. */
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
  const puerto = new URL(BASE).port || "4711";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1a-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ RECORRIDO === */
const U = {
  ventas: "demo.ventas",            // Comercial: cotiza, acepta, entrega certificados y devuelve instrumentos
  planif: "demo.planificacion",     // cierra la OT
  jefe: "demo.lmt.jefe",            // Jefe LMT: registra y programa; revisa y firma
  metro: "demo.lmt.analista1",      // metrólogo habilitado en masa
  metroL: "demo.lmt.analista2",     // metrólogo habilitado solo en longitud
  depto: "demo.dsa.jefe",           // Jefe de Departamento: emite
  fin: "demo.finanzas",             // no cierra OT ni entrega
  lqcJefe: "demo.lqc.jefe",         // otro laboratorio: fuera de alcance
  lqcA: "demo.lqc.analista1",       // otro laboratorio: fuera de alcance
  lnfA: "demo.lnf.analista1", lnfJefe: "demo.lnf.jefe",
  admin: "demo.admin",
};
const sello = Date.now().toString(36).toUpperCase();
const ahoraIso = () => new Date().toISOString();

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const avance = async (u = U.jefe) => ok(u, "GET", `/ot/${C.ot.id}/avance`);
  const met = async (u = U.jefe) => ok(u, "GET", `/ot/${C.ot.id}/metrologia`);

  await paso("Preparación: laboratorios, cliente, caso ITM03 y patrones vigentes", async () => {
    const labs = lista(await ok(U.planif, "GET", "/ot/laboratorios"));
    C.lmt = labs.find((u) => u.codigo === "LMT"); C.lnf = labs.find((u) => u.codigo === "LNF");
    const cl = lista(await ok(U.admin, "GET", "/clientes?limit=5"));
    C.clienteId = cl[0]?.id;
    afirmar(C.lmt && C.lnf && C.clienteId, "faltan LMT, LNF o un cliente");
    C.datosM = (await ok(U.metro, "GET", "/metrologia/motores/ITM03/ejemplo")).data.datos;
    const p = (await ok(U.metro, "GET", `/metrologia/patrones?fecha=${ahoraIso().slice(0, 10)}`)).data;
    C.pat = p.filter((x) => x.magnitud === "masa" && x.estado === "vigente" && x.activo !== false).slice(0, 2).map((x) => x.id);
    afirmar(C.pat.length === 2, "no hay dos patrones de masa vigentes");
    return `LMT ${C.lmt.id.slice(0, 8)} · ${C.pat.length} patrones vigentes`;
  });

  /* ---------------------------------------------------- F0 · origen */
  await paso("F0 · Comercial cotiza dos calibraciones y la aceptación crea la OT del LMT con cobro", async () => {
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.clienteId, formato: "NORMAL", plazoEntregaDias: 15, referencia: `R1a Metrología ${sello}`,
      lineas: [
        { descripcion: "Calibración de juego de pesas (ITM03)", cantidad: 1, precioUnitario: 45000 },
        { descripcion: "Calibración de balanza", cantidad: 1, precioUnitario: 38000 },
      ],
    });
    // Circuito de la cotización (frente r1c): solo se acepta firmada por el Jefe DCO.
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok("demo.dco.jefe", "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-${sello}`, fecha: ahoraIso().slice(0, 10), conCobro: true, unidadPrincipalId: C.lmt.id,
    });
    const otId = r?.ot?.id ?? r?.otId ?? r?.ot_id;
    afirmar(otId, `la aceptación no devolvió la OT: ${JSON.stringify(r).slice(0, 160)}`);
    C.ot = await ok(U.jefe, "GET", `/ot/${otId}`);
    afirmar(C.ot.conCobro === true && C.ot.unidadPrincipal === C.lmt.id, "la OT no es del LMT con cobro");
    const a = await avance();
    afirmar(a.tipo === "metrologia" && a.etapaActual === "asignacion" && /Registrar los instrumentos/.test(a.siguiente?.texto), `ruta ${a.tipo}/${a.etapaActual}: ${a.siguiente?.texto}`);
    afirmar(a.siguiente.accion?.pestana === "instrumentos", "el siguiente paso no lleva a la pestaña Instrumentos");
    return `${C.cot.codigo} → ${C.ot.codigo} · Ruta: ${a.siguiente.texto}`;
  });

  await paso("F0 · Instrumentos desde la cotización (uno por línea y unidad); otro laboratorio no puede", async () => {
    await exigir(403, U.lqcJefe, "POST", `/ot/${C.ot.id}/instrumentos/desde-cotizacion`);
    const r = await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/desde-cotizacion`);
    afirmar(r.data.creados === 2, `creados ${r.data.creados}`);
    const r2 = await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/desde-cotizacion`);
    afirmar(r2.data.creados === 0, "volver a cargar duplicó los ítems");
    const m = await met();
    C.i1 = m.instrumentos[0]; C.i2 = m.instrumentos[1];
    afirmar(C.i1.numero === 1 && C.i2.numero === 2 && C.i1.estado === "por_recibir", JSON.stringify(m.instrumentos.map((x) => x.estado)));
    return "2 ítems «por recibir»; recargar no duplica; LQC → 403";
  });

  await paso("F0 · Completar el ítem (marca, serie, IT); la IT de otro laboratorio no; un tercer ítem se anula con motivo", async () => {
    const datos = { descripcion: "Juego de 4 pesos muertos", marca: "No tiene", serie: `M39-${sello}`, capacidad: "(100 a 475) g", rango: "(100 a 475) g", procesoCodigo: "ITM03" };
    await rechazo(400, /es del LMTE/, U.jefe, "PUT", `/ot/${C.ot.id}/instrumentos/${C.i1.id}`, { ...datos, procesoCodigo: "ITT01" });
    await exigir(403, U.lqcJefe, "PUT", `/ot/${C.ot.id}/instrumentos/${C.i1.id}`, datos);
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/instrumentos/${C.i1.id}`, datos);
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/instrumentos/${C.i2.id}`, { descripcion: "Balanza analítica", marca: "Sartorius", serie: `B-${sello}`, procesoCodigo: "ITM02" });
    const tercero = await ok(U.ventas, "POST", `/ot/${C.ot.id}/instrumentos`, { descripcion: "Manómetro (registrado por error)" });
    await exigir(400, U.ventas, "POST", `/ot/${C.ot.id}/instrumentos/${tercero.data.id}/anular`, { motivo: "x" });
    await ok(U.ventas, "POST", `/ot/${C.ot.id}/instrumentos/${tercero.data.id}/anular`, { motivo: "Registrado por error" });
    const m = await met();
    afirmar(m.instrumentos.find((x) => x.id === tercero.data.id)?.estado === "anulado", "el tercero no quedó anulado");
    return "ITT01 (LMTE) en OT del LMT → 400 · LQC → 403 · tercer ítem anulado";
  });

  /* ---------------------------------------------- F1 · programación */
  await paso("F1 · Programar: solo metrólogos habilitados para la magnitud; solo la jefatura asigna", async () => {
    const c = await ok(U.jefe, "GET", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/metrologos`);
    const a1 = c.data.find((x) => x.username === U.metro), a2 = c.data.find((x) => x.username === U.metroL);
    afirmar(c.magnitud === "masa" && a1?.habilitado && a2 && !a2.habilitado, JSON.stringify(c.data.map((x) => [x.username, x.habilitado])));
    await rechazo(400, /registro de firmas/, U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/asignar`, { metrologoId: a2.id });
    await exigir(403, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/asignar`, { metrologoId: a1.id });
    const prevista = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/asignar`, { metrologoId: a1.id, fechaPrevista: prevista });
    await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2.id}/asignar`, { metrologoId: a1.id });
    const a = await avance();
    afirmar(a.etapaActual === "recepcion" && /Registrar la recepción/.test(a.siguiente.texto), `${a.etapaActual}: ${a.siguiente?.texto}`);
    return `${a1.nombre} asignado (prevista ${prevista}) · analista2 (longitud) → 400 · metrólogo → 403`;
  });

  /* -------------------------------------------- F3 · sin recepción no */
  await paso("P3.1 · No hay calibración suelta ni antes de recibir el instrumento", async () => {
    const cuerpo = { procesoCodigo: "ITM03", fecha: ahoraIso().slice(0, 10), patronIds: C.pat, motor: { datos: C.datosM, opciones: {} } };
    await rechazo(400, /desde el instrumento recibido de una OT/, U.metro, "POST", "/metrologia/calibraciones", cuerpo);
    await rechazo(409, /Primero registre la recepción/, U.metro, "POST", "/metrologia/calibraciones", { ...cuerpo, otInstrumentoId: C.i1.id });
    return "sin ítem → 400 · ítem por recibir → 409";
  });

  /* ------------------------------------------------ F2 · recepción */
  await paso("F2 · Recepción con custodia: fechas, estado, ubicación; otro laboratorio no; la OT pasa a «en análisis»", async () => {
    const base = { fechaHora: ahoraIso(), entregadoPor: "Cliente de prueba", estadoFisico: "bueno", ubicacion: "Estante A-1", calibrable: true,
      accesorios: [{ tipo: "Estuche", detalle: "Estuche de madera" }] };
    await exigir(403, U.lqcA, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/recepcion`, base);
    await rechazo(400, /anterior a la fecha de la OT/, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/recepcion`, { ...base, fechaHora: "2020-01-01T10:00" });
    await rechazo(400, /Describa/, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/recepcion`, { ...base, estadoFisico: "con_observaciones" });
    const r = await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/recepcion`, base);
    afirmar(r.data.etiqueta === `${C.ot.codigo}-I01` && r.data.estado === "recibido", JSON.stringify(r.data));
    await rechazo(400, /ya fue recibido/, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/recepcion`, base);
    const ot = await ok(U.jefe, "GET", `/ot/${C.ot.id}`);
    afirmar(ot.estado === "en_analisis", `estado OT ${ot.estado}`);
    return `etiqueta ${r.data.etiqueta} · LQC → 403 · fecha previa a la OT → 400`;
  });

  await paso("P2.2 · «¿Se puede calibrar? No» exige motivo y deja el ítem no apto (no se calibra)", async () => {
    const base = { fechaHora: ahoraIso(), entregadoPor: "Cliente de prueba", estadoFisico: "danado", estadoFisicoObs: "Plato deformado", ubicacion: "Estante A-2", calibrable: false };
    await rechazo(400, /por qué no se puede calibrar/, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2.id}/recepcion`, base);
    const r = await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2.id}/recepcion`, { ...base, motivoNoCalibrable: "El plato está deformado: no repite la indicación" });
    afirmar(r.data.estado === "no_apto", r.data.estado);
    await rechazo(409, /no calibrable/, U.metro, "POST", "/metrologia/calibraciones",
      { procesoCodigo: "ITM02", otInstrumentoId: C.i2.id, motor: { datos: {}, opciones: {} } });
    return "sin motivo → 400 · no apto · calibrarlo → 409";
  });

  await paso("Bandeja de Metrología: el ítem recibido aparece «por calibrar» para el metrólogo; LQC no entra", async () => {
    const l = (await ok(U.metro, "GET", "/metrologia/instrumentos")).data;
    const x = l.find((i) => i.id === C.i1.id);
    afirmar(x && x.mio && x.ot_codigo === C.ot.codigo, "el ítem no figura como propio en «por calibrar»");
    await exigir(403, U.lqcJefe, "GET", "/metrologia/instrumentos");
    return `${l.length} instrumento(s) por calibrar`;
  });

  /* ---------------------------------------------- F3–F5 · calibración */
  await paso("F3 · Calibrar desde el ítem: hereda OT, cliente, fechas e IT; la IT no se cambia; una sola por ítem", async () => {
    const cuerpo = {
      otInstrumentoId: C.i1.id, procesoCodigo: "ITM03", fecha: ahoraIso().slice(0, 10), patronIds: C.pat, intervaloMeses: 24,
      instrumento: { item: "texto escrito a mano", ot: "OT-FALSA", cliente: "Otro cliente", clase: "No tiene", lugar: "instalaciones" },
      motor: { datos: C.datosM, opciones: {} },
    };
    await rechazo(400, /viene del ítem de la OT/, U.metro, "POST", "/metrologia/calibraciones", { ...cuerpo, procesoCodigo: "ITM01" });
    await exigir(403, U.lqcJefe, "POST", "/metrologia/calibraciones", cuerpo);
    const r = await ok(U.metro, "POST", "/metrologia/calibraciones", cuerpo);
    C.cal = r.data;
    await rechazo(409, /ya tiene la calibración/, U.metro, "POST", "/metrologia/calibraciones", cuerpo);
    const d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(d.ot_id === C.ot.id && d.ot_codigo === C.ot.codigo && d.ot_instrumento_id === C.i1.id, "la calibración no quedó ligada a la OT");
    afirmar(d.instrumento.ot === C.ot.codigo && d.instrumento.item === "Juego de 4 pesos muertos" && d.instrumento.cliente !== "Otro cliente",
      `el instrumento no viene de la OT: ${JSON.stringify(d.instrumento).slice(0, 200)}`);
    afirmar(d.barra.find((p) => p.estado === "actual")?.paso === "Revisión Jefe Lab.", JSON.stringify(d.barra));
    const h = (await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal.id}/html`)).data.html;
    afirmar(h.includes(C.ot.codigo) && !h.includes("OT-FALSA"), "el certificado no imprime el número de la OT");
    return `${C.cal.codigo} ligada a ${C.ot.codigo} · ítem 1 · ITM01 → 400 · segunda → 409`;
  });

  await paso("F6–F7 · Circuito: el metrólogo envía, el Jefe LMT revisa, el Jefe de Departamento emite", async () => {
    await ok(U.metro, "POST", `/metrologia/calibraciones/${C.cal.id}/enviar`);
    let a = await avance();
    afirmar(a.etapaActual === "revision_tecnica" && a.siguiente.accion?.ruta === `/metrologia/${C.cal.id}`, `${a.etapaActual} ${JSON.stringify(a.siguiente?.accion)}`);
    await exigir(403, U.depto, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    await ok(U.jefe, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    const e = await ok(U.depto, "POST", `/metrologia/calibraciones/${C.cal.id}/firmar`);
    C.numero = e.data.numero;
    afirmar(/^M-\d{4,}$/.test(C.numero), `número ${C.numero}`);
    a = await avance();
    const ent = a.etapas.find((x) => x.clave === "entrega");
    afirmar(a.etapaActual === "entrega" && ent.estado === "en_curso", `entrega ${ent.estado}`);
    afirmar(a.siguiente.texto === `Registrar la entrega del certificado ${C.numero}`, a.siguiente.texto);
    return `${C.numero} emitido · Ruta: «Entrega» en curso (ya no bloqueada)`;
  });

  /* ------------------------------------------------------ F8 · entrega */
  await paso("P8.1 · Registrar la entrega del certificado: una vez, con fecha no anterior a la emisión; Finanzas y otro laboratorio no", async () => {
    const cuerpo = { medio: "correo", destinatario: "Encargado de calidad del cliente" };
    await exigir(403, U.fin, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal.id}/entregar`, cuerpo);
    await exigir(403, U.lqcJefe, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal.id}/entregar`, cuerpo);
    await rechazo(409, /anterior a la emisión/, U.ventas, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal.id}/entregar`, { ...cuerpo, fecha: "2020-01-01" });
    await ok(U.ventas, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal.id}/entregar`, cuerpo);
    await rechazo(409, /ya está registrada/, U.metro, "POST", `/ot/${C.ot.id}/calibraciones/${C.cal.id}/entregar`, cuerpo);
    const d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(d.entregado_at && d.barra.every((p) => p.estado === "hecho"), "la barra no quedó completa");
    afirmar(d.eventos.some((e) => e.accion === "ENTREGADA"), "la bitácora no registra la entrega");
    return "Comercial entrega · Finanzas y LQC → 403 · repetir → 409 · barra de 6 pasos completa";
  });

  await paso("P9.2 · Cerrar antes de devolver el instrumento: 409 con qué falta (el certificado sí cuenta como documento)", async () => {
    const c = await ok(U.planif, "GET", `/ot/${C.ot.id}/cierre`);
    afirmar(!c.faltantes.some((f) => /no tiene informes ni certificados/.test(f)), "el cierre no cuenta el certificado de calibración");
    afirmar(c.faltantes.some((f) => /sigue en custodia/.test(f)), JSON.stringify(c.faltantes));
    afirmar(c.calibraciones?.some((x) => x.numero === C.numero), "el cierre no lista las calibraciones de la OT");
    await rechazo(409, /sigue en custodia/, U.planif, "POST", `/ot/${C.ot.id}/cerrar`);
    return c.faltantes.join(" ").slice(0, 110) + "…";
  });

  await paso("P9.1 · Cierre técnico (Jefe de Laboratorio): la OT ve sus calibraciones y pasa a finalizada", async () => {
    await exigir(403, U.metro, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    const m = await met(U.ventas);
    afirmar(m.cierreTecnico.posible === false, "Comercial no debería poder cerrar técnicamente");
    afirmar(m.instrumentos[0].calibracion?.numeroCertificado === C.numero, "la OT no ve su calibración");
    const r = await ok(U.jefe, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    afirmar(r.data.estado === "finalizada", JSON.stringify(r.data));
    await rechazo(409, /ya está finalizada/, U.jefe, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    return `recorrido ${r.data.recorrido.join(" → ")}`;
  });

  await paso("P8.2 · Devolución del instrumento con acta (metrólogo o Comercial); no dos veces; otro laboratorio no", async () => {
    const acta = { fechaHora: ahoraIso(), recibidoPor: "Cliente de prueba", estadoFisico: "bueno", guia: "Retiro en mano" };
    await exigir(403, U.lqcJefe, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/devolucion`, acta);
    await rechazo(400, /quién recibe/, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/devolucion`, { ...acta, recibidoPor: " " });
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/devolucion`, acta);
    await rechazo(400, /ya fue devuelto/, U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/devolucion`, acta);
    await ok(U.ventas, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2.id}/devolucion`, { ...acta, estadoFisico: "danado", observacion: "Se devuelve sin calibrar (no apto)" });
    const a = await avance();
    afirmar(a.etapaActual === "cierre" && /Cerrar la OT/.test(a.siguiente.texto), `${a.etapaActual}: ${a.siguiente?.texto}`);
    return "ítem 1 (metrólogo) e ítem 2 no apto (Comercial) devueltos · Ruta: Cierre de la OT";
  });

  await paso("P9.2–P9.3 · Cerrar la OT por el camino normal: Finanzas no; Planificación sí y nace la factura pendiente", async () => {
    await exigir(403, U.fin, "POST", `/ot/${C.ot.id}/cerrar`);
    const r = await ok(U.planif, "POST", `/ot/${C.ot.id}/cerrar`);
    afirmar(r.ot.estado === "cerrada", r.ot.estado);
    afirmar(r.facturaCreada && r.facturaCreada.estado === "pendiente", `factura ${JSON.stringify(r.facturaCreada)}`);
    const a = await avance();
    afirmar(a.etapaActual === "factura" && a.etapas.find((x) => x.clave === "entrega").estado === "hecho", `${a.etapaActual}`);
    return `OT cerrada · factura ${r.facturaCreada.numero} pendiente`;
  });

  await paso("P7.4 · Reemisión tras el cierre: el borrador sigue ligado a la OT y al ítem (la OT no se reabre)", async () => {
    const r = await ok(U.jefe, "POST", `/metrologia/calibraciones/${C.cal.id}/reemitir`, { motivo: "Corrección de la dirección del cliente" });
    const d = await ok(U.jefe, "GET", `/metrologia/calibraciones/${r.data.id}`);
    afirmar(d.ot_id === C.ot.id && d.ot_instrumento_id === C.i1.id, "la reemisión perdió el vínculo con la OT");
    const ot = await ok(U.jefe, "GET", `/ot/${C.ot.id}`);
    afirmar(ot.estado === "cerrada", `la OT cambió a ${ot.estado}`);
    return `${r.data.codigo} reemplazará a ${C.numero}`;
  });

  /* ------------------------------------------- numeración por laboratorio */
  await paso("Numeración por laboratorio: HT-, ME-, TF- y LCPNF-NNN.AA configurables; solo metrologia.config", async () => {
    const n = (await ok(U.metro, "GET", "/metrologia/numeracion")).data;
    const pre = Object.fromEntries(n.map((x) => [x.prefijo, x]));
    afirmar(pre.HT && pre.ME && pre.TF && pre.LCPNF, `prefijos ${Object.keys(pre)}`);
    afirmar(pre.ME.procesos.includes("ITME01") && pre.TF.procesos.includes("ITE03") && pre.LCPNF.procesos.includes("LCPNF-IT01"), "procesos sin su prefijo");
    afirmar(/^LCPNF-\d{3}\.\d{2}$/.test(pre.LCPNF.proximo) && pre.LCPNF.anual, `próximo LCPNF ${pre.LCPNF.proximo}`);
    await exigir(403, U.metro, "PUT", "/metrologia/numeracion/HT", { ultimo: 5 });
    await rechazo(400, /Formato no válido/, U.admin, "PUT", "/metrologia/numeracion/HT", { ultimo: 0, formato: "{P}-{X}" });
    await ok(U.admin, "PUT", "/metrologia/numeracion/HT", { ultimo: pre.HT.ultimo, formato: "{P}-{N}", relleno: 4 });
    await rechazo(409, /ya existe/, U.admin, "POST", "/metrologia/numeracion", { prefijo: "HT", ultimo: 0 });
    await rechazo(400, /no está configurado/, U.admin, "PUT", "/metrologia/procesos/ITT01/prefijo", { prefijo: "ZZ" });
    await exigir(403, U.metro, "PUT", "/metrologia/procesos/ITT01/prefijo", { prefijo: "HT" });
    return `próximo LCPNF ${pre.LCPNF.proximo} · ME-, TF- en ITME01/ITE03 · HT con 4 cifras`;
  });

  await paso("LNF: una calibración ISO 376 real ligada a su OT recibe el número anual LCPNF-NNN.AA", async () => {
    const ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.clienteId, unidadPrincipalId: C.lnf.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: `R1a LNF ${sello}`,
    });
    const it = await ok(U.lnfJefe, "POST", `/ot/${ot.id}/instrumentos`, { descripcion: "Transductor de fuerza", serie: `TF-${sello}`, procesoCodigo: "LCPNF-IT01", sentido: "C" });
    const rec = { fechaHora: ahoraIso(), entregadoPor: "Laboratorio de prueba", estadoFisico: "bueno", ubicacion: "Sala LNF", calibrable: true };
    await rechazo(400, /LNF: indique el sentido|acondicionamiento/, U.lnfA, "POST", `/ot/${ot.id}/instrumentos/${it.data.id}/recepcion`, rec);
    await ok(U.lnfA, "POST", `/ot/${ot.id}/instrumentos/${it.data.id}/recepcion`, { ...rec, sentido: "C", acondicionamientoH: 24, tempAmbiente: 20.2 });
    const ej = (await ok(U.lnfA, "GET", "/metrologia/motores/LCPNF-IT01/ejemplo")).data;
    const cal = await ok(U.lnfA, "POST", "/metrologia/calibraciones", {
      otInstrumentoId: it.data.id, procesoCodigo: "LCPNF-IT01", fecha: ahoraIso().slice(0, 10), motor: { datos: ej.datos, opciones: {} },
    });
    await ok(U.lnfA, "POST", `/metrologia/calibraciones/${cal.data.id}/enviar`);
    await ok(U.lnfJefe, "POST", `/metrologia/calibraciones/${cal.data.id}/firmar`);
    const e = await ok(U.depto, "POST", `/metrologia/calibraciones/${cal.data.id}/firmar`);
    const aa = String(new Date().getFullYear() % 100).padStart(2, "0");
    afirmar(new RegExp(`^LCPNF-\\d{3}\\.${aa}$`).test(e.data.numero), `número ${e.data.numero}`);
    return `${e.data.numero}`;
  });

  /* ------------------------------------------------------------ alcance */
  await paso("Alcance por laboratorio: la OT del LMT y su pestaña de instrumentos no se ven desde LQC", async () => {
    await exigir(403, U.lqcJefe, "GET", `/ot/${C.ot.id}/metrologia`);
    await exigir(403, U.lqcJefe, "GET", `/ot/${C.ot.id}/instrumentos/${C.i1.id}/metrologos`);
    const m = await met(U.ventas);
    afirmar(m.instrumentos.length === 3 && m.puedo.registrar === false, "Comercial ve la OT cerrada como editable");
    return "LQC → 403 · Comercial ve la OT cerrada en solo lectura";
  });
}

main()
  .then(() => {
    console.log(`\nR1 · r1a (Metrología ligada a la OT) verificado: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
