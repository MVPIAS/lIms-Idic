#!/usr/bin/env node
/**
 * Frente f7 · diferencias del recorrido de los manuales v2.2 (26-10-2026).
 * Reproduce cada corrección con un perfil demo.* que puede y otro que no:
 *
 *   D04-31 · «Cerrar técnicamente → Comercial» exige lo mismo que el cierre final en lo
 *            técnico: documentos de Metrología oficiales y entregados, instrumentos
 *            devueltos y ningún servicio externo a medio camino. La API responde 409 con
 *            la lista de lo que falta (la misma que GET /ot/:id/metrologia y la Ruta).
 *            Caso del recorrido (OT-2026-0014): informe técnico sin entregar, ítems en
 *            custodia y servicio externo solo aprobado. Una OT bien completa cierra
 *            técnicamente y luego cierra con factura. Parámetro no_apto_exige_documento:
 *            lo aplican el cierre técnico y el final.
 *   D04-32 · «Documentos de Metrología» (Informe y cierre): el certificado de calibración
 *            trae el medio de su entrega (GET /ot/:id/cierre › calibraciones[].entregaMedio).
 *   D02-45 · «Emitir informe»: el buscador de OT encuentra la OT del LQA para la jefatura
 *            del LMB, que participa por orden interna (GET /ot?derivadas=1, el criterio de
 *            «Captura y revisión por OT»); un laboratorio que no participa, no.
 *   D01-24 · pantalla (tabla de muestras a 1440 px): se comprueba con Playwright en las
 *            capturas del frente; aquí, que la tabla tenga 8 columnas (antes 10).
 *
 * Uso:
 *   node scripts/verificacion/c-f7.js [--base http://localhost:5071/api]
 *   DATABASE_URL=… node scripts/verificacion/c-f7.js [--arrancar]
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja OT, calibraciones y una
 * factura pendiente de prueba: úsese en una base de pruebas. Se puede correr varias veces.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:5071/api");
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
  const esForm = typeof FormData !== "undefined" && cuerpo instanceof FormData;
  if (cuerpo !== undefined && !esForm) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo) });
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
  const puerto = new URL(BASE).port || "5071";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:5072",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-f7-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  admin: "demo.admin", calidad: "demo.calidad", ventas: "demo.ventas", dco: "demo.dco.jefe", fin: "demo.finanzas",
  planif: "demo.planificacion", jefe: "demo.lmt.jefe", metro: "demo.lmt.analista1", depto: "demo.dsa.jefe",
  lqaJefe: "demo.lqa.jefe", lmbJefe: "demo.lmb.jefe", lpnJefe: "demo.lpn.jefe", lqcJefe: "demo.lqc.jefe",
};
const sello = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase();
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const CONF = "/parametros/configurables";
const PDF_MIN = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%" + "EOF\n", "latin1");
const recibir = (calibrable, extra = {}) => ({
  fechaHora: new Date().toISOString(), entregadoPor: "Cliente de prueba f7", estadoFisico: calibrable ? "bueno" : "danado", ubicacion: "Estante F7",
  calibrable, ...(calibrable ? {} : { estadoFisicoObs: "Golpe en la carcasa", motivoNoCalibrable: "Daño en el mecanismo: no repite la indicación" }), ...extra,
});
const dev = (estadoFisico = "bueno") => ({ fechaHora: new Date().toISOString(), recibidoPor: "Encargado del cliente", estadoFisico, observacion: "Devolución de prueba f7" });
const C = { restaurar: [] };

async function main() {
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  console.log(`Frente f7 · diferencias del recorrido v2.2 (${BASE})`);
  try {
    await recorrido();
  } finally {
    for (const f of C.restaurar.reverse()) await f().catch((e) => console.log(`  (no se pudo restaurar: ${e.message})`));
  }
}

async function recorrido() {
  const met = async (otId, u = U.jefe) => ok(u, "GET", `/ot/${otId}/metrologia`);
  const avance = async (otId, u = U.planif) => { const a = await ok(u, "GET", `/ot/${otId}/avance`); return a?.data ?? a; };
  const etapaDe = (a, clave) => (a.etapas ?? []).find((e) => e.clave === clave);
  const param = async (cod) => (await ok(U.calidad, "GET", CONF)).grupos.find((x) => x.categoria === "metrologia_ficha").parametros.find((p) => p.codigo === cod);

  await paso("Preparación: LMT, LQA, LMB, cliente, servicio EN1074, patrones PM-01/PM-48 y caso ITM02", async () => {
    const labs = lista(await ok(U.planif, "GET", "/ot/laboratorios"));
    for (const k of ["LMT", "LQA", "LMB"]) C[k] = labs.find((u) => u.codigo === k);
    C.clienteId = lista(await ok(U.admin, "GET", "/clientes?limit=5"))[0]?.id;
    C.EN1074 = lista(await ok(U.ventas, "GET", "/cat/ensayos?search=EN1074&limit=5")).find((e) => e.codigo === "EN1074");
    const p = (await ok(U.jefe, "GET", `/metrologia/patrones?fecha=${hoy()}`)).data;
    C.pat = p.find((x) => x.codigo === "PM-01"); C.th = p.find((x) => x.codigo === "PM-48");
    C.datos = (await ok(U.metro, "GET", "/metrologia/motores/ITM02/ejemplo")).data.datos;
    afirmar(C.LMT && C.LQA && C.LMB && C.clienteId && C.EN1074 && C.pat && C.th, "faltan laboratorios, cliente, EN1074 o patrones");
    return `PM-01 con ${Object.keys(C.pat.valores_certificado ?? {}).length} piezas`;
  });

  /* ========================================================== D04-31 === */
  await paso("D04-31 · OT de calibración con cobro: certificado M- emitido y entregado (correo), informe técnico emitido SIN entregar, servicio externo solo APROBADO", async () => {
    const cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.clienteId, formato: "NORMAL", plazoEntregaDias: 15, referencia: `F7 cierre técnico ${sello}`, lineas: [{ catEnsayoId: C.EN1074.id, cantidad: 1 }],
    });
    await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/aceptar`, { tipo: "OC", numero: `OC-F7-${sello}`, fecha: hoy(), conCobro: true, unidadPrincipalId: C.LMT.id });
    C.ot = await ok(U.jefe, "GET", `/ot/${r?.ot?.id ?? r?.otId ?? r?.ot_id}`);
    afirmar(C.ot.conCobro, "la OT de la cotización no es con cobro");
    // Ítem 1 (calibrable) desde la cotización; ítems 2 (informe técnico) y 3 (servicio externo).
    await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/desde-cotizacion`);
    C.i1 = (await met(C.ot.id)).instrumentos[0].id;
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/instrumentos/${C.i1}`, { descripcion: "Balanza analítica (prueba f7)", serie: `BF7-${sello}`, procesoCodigo: "ITM02" });
    C.i2 = (await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos`, { descripcion: "Manómetro (prueba f7)", serie: `MF7-${sello}` })).data.id;
    C.i3 = (await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos`, { descripcion: "Torquímetro (prueba f7)", serie: `TF7-${sello}` })).data.id;
    const cand = await ok(U.jefe, "GET", `/ot/${C.ot.id}/instrumentos/${C.i1}/metrologos`);
    await ok(U.jefe, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1}/asignar`, { metrologoId: cand.data.find((x) => x.username === U.metro).id });
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1}/recepcion`, recibir(true));
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2}/recepcion`, recibir(false));
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i3}/recepcion`, recibir(false, { requiereExterno: true, motivoNoCalibrable: "Rango sobre el alcance del laboratorio" }));
    // Calibración del ítem 1: patrones del maestro, revisión, firmas y entrega por correo.
    const datos = JSON.parse(JSON.stringify(C.datos));
    datos.pat = {};
    const cal = (await ok(U.metro, "POST", "/metrologia/calibraciones", {
      otInstrumentoId: C.i1, procesoCodigo: "ITM02", fecha: hoy(), intervaloMeses: 12, patronIds: [C.pat.id],
      auxiliares: { termohigrometroId: C.th.id, lecturas: { temp: [20.4, 20.6], hum: [51, 52], pres: [] } }, motor: { datos, opciones: {} },
    })).data;
    C.cal = cal.id;
    await ok(U.metro, "POST", `/metrologia/calibraciones/${cal.id}/enviar`);
    await ok(U.jefe, "POST", `/metrologia/calibraciones/${cal.id}/firmar`);
    C.numCal = (await ok(U.depto, "POST", `/metrologia/calibraciones/${cal.id}/firmar`)).data.numero;
    await ok(U.ventas, "POST", `/ot/${C.ot.id}/calibraciones/${cal.id}/entregar`, { medio: "correo", destinatario: "Encargado de calidad del cliente" });
    // Ítem 2: informe técnico emitido, sin entregar.
    const b2 = `/ot/${C.ot.id}/instrumentos/${C.i2}`;
    await ok(U.metro, "POST", `${b2}/informe-tecnico`, { motivo: "No repite la indicación", hallazgos: "Aguja doblada y vidrio roto", recomendacion: "Reparar y volver a calibrar" });
    await ok(U.metro, "POST", `${b2}/informe-tecnico/enviar`);
    C.it = (await ok(U.jefe, "POST", `${b2}/informe-tecnico/emitir`)).data.numero;
    // Ítem 3: servicio externo solicitado y aprobado (sin envío).
    C.bExt = `/ot/${C.ot.id}/instrumentos/${C.i3}/servicio-externo`;
    const prov = lista(await ok(U.jefe, "GET", `/ot/${C.ot.id}/metrologia/proveedores`));
    afirmar(prov.length, "no hay proveedores");
    await ok(U.jefe, "POST", C.bExt, { proveedorId: prov[0].id, justificacion: "El rango supera la capacidad del patrón del LMT", costo: 1 });
    await ok(U.depto, "POST", `${C.bExt}/aprobar`);
    return `${cot.codigo} → ${C.ot.codigo} · ${C.numCal} entregado · ${C.it} sin entregar · externo aprobado`;
  });

  await paso("D04-31 · Caso OT-2026-0014: el Jefe LMT NO puede cerrar técnicamente (botón deshabilitado con la lista; 409 con la misma lista); el metrólogo 403", async () => {
    const m = await met(C.ot.id);
    const f = m.cierreTecnico.faltantes;
    afirmar(m.cierreTecnico.posible === false && m.cierreTecnico.aplica === true && m.puedo.cierreTecnico, `cierre técnico ${JSON.stringify(m.cierreTecnico).slice(0, 300)}`);
    afirmar(f.some((x) => x.includes(C.it) && /falta registrar su entrega/.test(x)), `falta la entrega del informe técnico: ${f.join(" | ")}`);
    afirmar(f.filter((x) => /sigue en custodia/.test(x)).length === 3, `faltan las 3 devoluciones: ${f.join(" | ")}`);
    afirmar(f.some((x) => /servicio externo del ítem 3 .*aprobado/.test(x)), `falta el servicio externo aprobado: ${f.join(" | ")}`);
    afirmar(!f.some((x) => x.includes(C.numCal)), "el certificado entregado no debería faltar");
    afirmar(JSON.stringify(m.faltantes) === JSON.stringify(f), "«Para cerrar la OT falta:» y el cierre técnico dicen cosas distintas");
    const r = await rechazo(409, /No se puede cerrar técnicamente/, U.jefe, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    afirmar(JSON.stringify(r.faltantes) === JSON.stringify(f), `la API no devuelve la misma lista: ${JSON.stringify(r.faltantes)}`);
    await exigir(403, U.metro, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    const mv = await met(C.ot.id, U.ventas);
    afirmar(mv.cierreTecnico.posible === false && !mv.puedo.cierreTecnico, "Comercial no cierra técnicamente");
    const ot = await ok(U.jefe, "GET", `/ot/${C.ot.id}`);
    afirmar(!["finalizada", "cerrada"].includes(ot.estado), `la OT quedó ${ot.estado}`);
    const a = await avance(C.ot.id);
    afirmar(a.etapaActual === "entrega" && a.siguiente?.texto === `Registrar la entrega del informe técnico ${C.it}`, `ruta: ${a.etapaActual} · ${a.siguiente?.texto}`);
    return `409 con ${f.length} faltantes · metrólogo 403 · OT ${ot.estado} · Ruta: ${a.siguiente.texto}`;
  });

  await paso("D04-31 · Informe técnico entregado e instrumentos 1–2 devueltos; externo ENVIADO: sigue 409 («falta validar») y la Ruta pide validar; el cierre final también lo pide", async () => {
    await ok(U.ventas, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i1}/devolucion`, dev());
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i2}/devolucion`, dev("danado"));
    await ok(U.jefe, "POST", `${C.bExt}/envio`, { ocNumero: `OC-EXT-F7-${sello}`, fechaEnvio: hoy() });
    const r = await rechazo(409, /servicio externo del ítem 3 .*enviado: falta validar/, U.jefe, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    const a = await avance(C.ot.id);
    afirmar(a.etapaActual === "entrega" && /^Completar el servicio externo: validar el certificado externo del ítem 3/.test(a.siguiente?.texto ?? ""), `ruta: ${a.siguiente?.texto}`);
    const c = await ok(U.planif, "GET", `/ot/${C.ot.id}/cierre`);
    afirmar(!c.puedeCerrar && c.faltantes.some((x) => /servicio externo .*enviado/.test(x)), `cierre final: ${c.faltantes.join(" | ")}`);
    await rechazo(409, /servicio externo/, U.planif, "POST", `/ot/${C.ot.id}/cerrar`, {});
    return `faltan: ${r.faltantes.join(" ")}`;
  });

  await paso("D04-31 · OT bien completa (externo validado y entregado, todo devuelto): «Cerrar técnicamente» habilitado → finalizada → cierre con factura", async () => {
    const f = new FormData();
    f.append("archivo", new Blob([PDF_MIN], { type: "application/pdf" }), "externo.pdf");
    f.append("numero", `EXT-F7-${sello}`);
    f.append("fechaRetorno", hoy());
    await ok(U.metro, "PUT", `${C.bExt}/certificado`, f);
    await ok(U.jefe, "POST", `${C.bExt}/validar`, { aptitud: "apto", comentario: "Cumple" });
    await ok(U.ventas, "POST", `${C.bExt}/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    let m = await met(C.ot.id);
    afirmar(!m.cierreTecnico.posible && m.cierreTecnico.faltantes.length === 1 && /ítem 3 .*sigue en custodia/.test(m.cierreTecnico.faltantes[0]), `antes de devolver el 3: ${m.cierreTecnico.faltantes.join(" | ")}`);
    await ok(U.metro, "POST", `/ot/${C.ot.id}/instrumentos/${C.i3}/devolucion`, dev());
    m = await met(C.ot.id);
    afirmar(m.cierreTecnico.posible && !m.cierreTecnico.faltantes.length && !m.faltantes.length, `cierre técnico: ${m.cierreTecnico.motivo}`);
    const a = await avance(C.ot.id);
    afirmar(etapaDe(a, "cierre")?.detalle === "Falta el cierre técnico" && /^Cerrar técnicamente/.test(a.siguiente?.texto ?? ""), `ruta: ${a.siguiente?.texto}`);
    await exigir(403, U.ventas, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    const ct = await ok(U.jefe, "POST", `/ot/${C.ot.id}/metrologia/cierre-tecnico`);
    afirmar(ct.data.estado === "finalizada", JSON.stringify(ct.data));
    const c = await ok(U.planif, "GET", `/ot/${C.ot.id}/cierre`);
    afirmar(c.puedeCerrar, `cierre final: ${c.faltantes.join(" | ")}`);
    await exigir(403, U.metro, "POST", `/ot/${C.ot.id}/cerrar`, {});
    const r = await ok(U.planif, "POST", `/ot/${C.ot.id}/cerrar`, {});
    afirmar(r.ot.estado === "cerrada" && r.facturaCreada?.id, `cierre: ${r.ot.estado} · factura ${JSON.stringify(r.facturaCreada)}`);
    return `${C.ot.codigo}: finalizada → cerrada · factura ${r.facturaCreada.numero} $${Number(r.facturaCreada.total).toLocaleString("es-CL")}`;
  });

  await paso("D04-31 · Parámetro no_apto_exige_documento: rótulo «técnico y final»; con «sí», el no calibrable sin documento bloquea el cierre técnico Y el final", async () => {
    const p = await param("no_apto_exige_documento");
    afirmar(/técnico y final/.test(p.nombre ?? p.etiqueta ?? ""), `rótulo: ${p.nombre ?? p.etiqueta}`);
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.clienteId, unidadPrincipalId: C.LMT.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: `F7 parámetro ${sello}` });
    const a = (await ok(U.jefe, "POST", `/ot/${ot.id}/instrumentos`, { descripcion: "Celda sin documento (prueba f7)", serie: `CA-${sello}` })).data.id;
    const b = (await ok(U.jefe, "POST", `/ot/${ot.id}/instrumentos`, { descripcion: "Celda con informe (prueba f7)", serie: `CB-${sello}` })).data.id;
    for (const i of [a, b]) await ok(U.metro, "POST", `/ot/${ot.id}/instrumentos/${i}/recepcion`, recibir(false));
    const bb = `/ot/${ot.id}/instrumentos/${b}`;
    await ok(U.metro, "POST", `${bb}/informe-tecnico`, { motivo: "Sin señal estable", hallazgos: "Cable cortado y conector oxidado", recomendacion: "Reparar" });
    await ok(U.metro, "POST", `${bb}/informe-tecnico/enviar`);
    await ok(U.jefe, "POST", `${bb}/informe-tecnico/emitir`);
    await ok(U.ventas, "POST", `${bb}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Encargado" });
    for (const i of [a, b]) await ok(U.metro, "POST", `/ot/${ot.id}/instrumentos/${i}/devolucion`, dev("danado"));
    const valorAntes = p.valor;
    const fijar = (valor, motivo) => ok(U.calidad, "PUT", `${CONF}/metrologia_ficha/no_apto_exige_documento`, { valor, motivo });
    if (valorAntes !== false && valorAntes !== "no") await fijar(false, "Prueba f7: por defecto");
    C.restaurar.push(async () => { if ((await param("no_apto_exige_documento")).valor !== valorAntes) await fijar(valorAntes, "Restaurado por el guion c-f7"); });
    let m = await met(ot.id);
    afirmar(m.cierreTecnico.posible, `con «no»: ${m.cierreTecnico.motivo}`);
    await exigir(403, U.metro, "PUT", `${CONF}/metrologia_ficha/no_apto_exige_documento`, { valor: true, motivo: "No le corresponde" });
    await fijar(true, "Prueba f7: el no calibrable exige su documento");
    m = await met(ot.id);
    afirmar(!m.cierreTecnico.posible && m.cierreTecnico.faltantes.some((x) => /no calibrable ítem 1/.test(x)), `con «sí»: ${m.cierreTecnico.faltantes.join(" | ")}`);
    await rechazo(409, /no calibrable ítem 1/, U.jefe, "POST", `/ot/${ot.id}/metrologia/cierre-tecnico`);
    const c = await ok(U.planif, "GET", `/ot/${ot.id}/cierre`);
    afirmar(c.faltantes.some((x) => /no calibrable ítem 1/.test(x)), `el cierre final no lo pide: ${c.faltantes.join(" | ")}`);
    const av = await avance(ot.id);
    afirmar(av.etapaActual === "entrega" && /^Emitir el informe técnico o validar el servicio externo de ítem 1/.test(av.siguiente?.texto ?? ""), `ruta: ${av.siguiente?.texto}`);
    await fijar(false, "Prueba f7: vuelta a «no»");
    m = await met(ot.id);
    afirmar(m.cierreTecnico.posible, `de vuelta a «no»: ${m.cierreTecnico.motivo}`);
    return `${ot.codigo}: «no» → se puede · «sí» → 409 y cierre final y Ruta lo piden · metrólogo no cambia el parámetro (403)`;
  });

  /* ========================================================== D04-32 === */
  await paso("D04-32 · «Documentos de Metrología» del cierre: el certificado de calibración trae la fecha Y el medio de su entrega", async () => {
    const c = await ok(U.planif, "GET", `/ot/${C.ot.id}/cierre`);
    const x = (c.calibraciones ?? []).find((k) => k.numero === C.numCal);
    afirmar(x && x.entregadoAt && x.entregaMedio === "correo", `calibración en el cierre: ${JSON.stringify(x)}`);
    const nc = (c.documentosNoCalibrables ?? []).filter((d) => d.entregaMedio);
    afirmar(nc.length === 2, `informe técnico y externo con medio: ${JSON.stringify(c.documentosNoCalibrables)}`);
    const web = fs.readFileSync(path.join(RAIZ, "apps/web/components/documentos/PanelCierreOt.tsx"), "utf8");
    afirmar(/fecha\(c\.entregadoAt\)\}\s*·\s*\{textoMedio\(c\.entregaMedio\)\}/.test(web), "el panel no pinta el medio del certificado de calibración");
    await exigir(403, U.lqcJefe, "GET", `/ot/${C.ot.id}/cierre`);
    return `${C.numCal}: ${String(x.entregadoAt).slice(0, 10)} · ${x.entregaMedio} (con textoMedio de medio_envio) · LQC → 403`;
  });

  /* ========================================================== D02-45 === */
  await paso("D02-45 · «Emitir informe»: la jefatura del LMB encuentra la OT del LQA en que participa por orden interna; el LPN no", async () => {
    const el = lista(await ok(U.lqaJefe, "GET", "/cat/elementos?search=Bromatolog&limit=20")).find((e) => e.codigo === "86")
      ?? lista(await ok(U.lqaJefe, "GET", "/cat/elementos?search=86&limit=50")).find((e) => e.codigo === "86");
    afirmar(el, "sin elemento 86 (LQA)");
    const panel = lista(await ok(U.lqaJefe, "GET", `/cascada/elementos/${el.id}/panel`));
    const ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.clienteId, unidadPrincipalId: C.LQA.id, conCobro: false, prioridad: "normal", fechaIngreso: new Date().toISOString(),
      muestras: [{ catElementoId: el.id, nombre: "Queso f7", metodoIds: [panel[0].metodoId] }],
    });
    const reg = await ok(U.lqaJefe, "GET", `/flujo/ot/${ot.id}/registro-muestras`);
    const lmb = (await ok(U.lqaJefe, "GET", `/ordenes-internas/destinos?otId=${ot.id}`)).find((d) => d.unidadCodigo === "LMB");
    const ens = await ok(U.lqaJefe, "GET", `/ordenes-internas/destinos/${lmb.id}/ensayos?otId=${ot.id}`);
    await ok(U.lqaJefe, "POST", "/ordenes-internas", {
      otId: ot.id, destinoLab: lmb.id, ensayos: [ens[0].id], detalle: "Recuento microbiológico (f7)", muestraId: reg.muestras[0].id, requisito: "RSA", fechaEnvio: hoy(),
    });
    const busca = async (u, extra) => lista(await ok(u, "GET", `/ot?q=${encodeURIComponent(ot.codigo)}&limit=20${extra}`)).some((x) => x.id === ot.id);
    afirmar(!(await busca(U.lmbJefe, "")), "sin ?derivadas=1 ya la encontraba (el fallo no se reproduce)");
    afirmar(await busca(U.lmbJefe, "&derivadas=1"), "con ?derivadas=1 la jefatura del LMB no encuentra la OT del LQA");
    afirmar(!(await busca(U.lpnJefe, "&derivadas=1")), "el LPN, que no participa, encuentra la OT (fuga de alcance)");
    afirmar(await busca(U.lqaJefe, "&derivadas=1"), "el LQA no encuentra su propia OT");
    await ok(U.lmbJefe, "GET", `/ot/${ot.id}`);
    await exigir(403, U.lpnJefe, "GET", `/ot/${ot.id}`);
    const web = fs.readFileSync(path.join(RAIZ, "apps/web/app/(app)/informes/page.tsx"), "utf8");
    afirmar(/const FILTRO_BUSCADOR_OT = \{ derivadas: 1 \}/.test(web) && /filtros=\{FILTRO_BUSCADOR_OT\}/.test(web), "«Emitir informe» no pasa ?derivadas=1 al buscador");
    return `${ot.codigo}: LMB sin derivadas ✗ · con derivadas ✓ · LPN ✗ (y 403 al abrirla) · LQA ✓`;
  });

  /* ========================================================== D01-24 === */
  await paso("D01-24 · Tabla de muestras de la OT: 8 columnas (Métodos·ensayos y Veredicto·estado juntas; acciones apiladas)", async () => {
    const web = fs.readFileSync(path.join(RAIZ, "apps/web/app/(app)/ot/[id]/_components/RegistroMuestras.tsx"), "utf8");
    const cab = web.slice(web.indexOf('aria-label="Muestras de la OT"'), web.indexOf("</thead>", web.indexOf('aria-label="Muestras de la OT"')));
    const th = (cab.match(/<th[\s>]/g) ?? []).length;
    afirmar(th === 8, `la cabecera tiene ${th} columnas`);
    afirmar(/flexDirection: "column"/.test(web.slice(web.indexOf("Distribuir…") - 600, web.indexOf("Distribuir…"))), "las acciones no van apiladas");
    return "8 columnas (con acciones) · ancho medido con Playwright a 1440×967 en las capturas del frente";
  });
}

main()
  .then(() => {
    const fallos = pasos.filter((p) => !p.ok).length;
    console.log(fallos ? `\nFrente f7: ${pasos.length - fallos} pasos OK, ${fallos} con fallo.` : `\nFrente f7: ${pasos.length}/${pasos.length} pasos OK.`);
    pararApi();
    process.exit(fallos ? 1 : 0);
  })
  .catch((e) => {
    console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    pararApi();
    process.exit(1);
  });
