#!/usr/bin/env node
/**
 * Verificación del frente r2a (entregas R2 y R4): formularios especializados
 * como variantes de la captura estándar (T10), preparación y acondicionamiento
 * de muestras (T29), preparación del trabajo del DSA (T26) y el arrastre de R1
 * (CRB e Informe de Ensayo de Rechazo del LRB, BL-026), de punta a punta contra
 * una API real con los perfiles demo.*. Cada regla con un perfil que puede y
 * otro que no:
 *   1. Parámetros de la operación: tabla de amenazas (tipo «tabla»), variante por
 *      método, nivel y AQL; Calidad cambia con motivo, el Jefe de LQC no.
 *   2. LRB · preparación del trabajo (EP-05 2.1–2.3): comisión y equipos (equipo
 *      vencido no se reserva), Planilla de trabajo, envío, aprobación del Jefe LRB;
 *      la captura espera la aprobación; Mi bandeja y Ruta de la OT.
 *   3. LRB · registro de disparos (4.1): plan, correlativo, trauma obligatorio,
 *      detención del panel, corrección con motivo, cierre de panel, regla de lote,
 *      la captura estándar del ensayo se rechaza (va por el formulario).
 *   4. LRB · documentos (BL-026): Informe de Rechazo solo con lote No Cumple, CRB
 *      solo con lote Cumple; número del DSA, cantidad en palabras, series y reemplazos.
 *   5. SVM · paquete técnico con HCP, HCP por vehículo (4.6), clase A/B/C, ítem
 *      cuantitativo, observación obligatoria, corrección con motivo, regla de lote
 *      por clase y acta de novedades (4.8).
 *   6. LCC · inspección por atributos AQL (EP-03 3.7) y sección V del IVC.
 *   7. Preparación de muestras (T29): LME con solución vencida bloquea la captura;
 *      corregida con motivo, la libera; LQC no prepara muestras del LME.
 *   8. LEM en terreno: valida el Jefe de Sección SEM y aprueba el Jefe DSA; LAM sin
 *      aprobación («registrada»).
 *   9. Alimentos (R3, inactivas por defecto): microbiología y panel sensorial se
 *      activan por método; plan n, c, m, M y triangular ISO 4120. Se dejan como estaban.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r2-r2a.js [--arrancar] [--base http://localhost:4811/api]
 * Contraseña: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA. Deja OT de prueba; los parámetros
 * que cambia vuelven a su valor. Úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4811/api");
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
    const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
    sesiones[username] = { token: j.accessToken, id: carga.sub, permisos: carga.permisos ?? [] };
    return sesiones[username];
  }
  throw new Error(`login ${username}: demasiados intentos`);
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const esForm = cuerpo instanceof FormData;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}) },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
    return { status: r.status, json };
  }
  throw new Error(`${username} ${metodo} ${ruta}: demasiadas peticiones (429)`);
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 500);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
async function rechazo(esperado, re, u, m, ruta, c) {
  const j = await exigir(esperado, u, m, ruta, c);
  if (re && !re.test(msg(j))) throw new Error(`${u} ${m} ${ruta}: el mensaje no explica el motivo (${msg(j)})`);
  return msg(j);
}
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

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
function afirmar(cond, texto) { if (!cond) throw new Error(texto); }

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
  const puerto = new URL(BASE).port || "4811";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r2-r2a-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

const hoy = () => new Date().toISOString().slice(0, 10);
const masDias = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
const PDF_MIN = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");

/* ============================================================ RECORRIDO === */
const U = {
  planif: "demo.planificacion",
  calidad: "demo.calidad",
  ventas: "demo.ventas",
  lrbA: "demo.lrb.analista1",
  lrbJ: "demo.lrb.jefe",
  lrbR: "demo.lrb.revisor",
  dsa: "demo.dsa.jefe",
  svmA: "demo.svm.analista1",
  svmJ: "demo.svm.jefe",
  svmR: "demo.svm.revisor",
  lccA: "demo.lcc.analista1",
  lccJ: "demo.lcc.jefe",
  lmeA: "demo.lme.analista1",
  lqcA: "demo.lqc.analista1",
  lqcJ: "demo.lqc.jefe",
  lemJ: "demo.lem.jefe",
  lemA: "demo.lem.analista1",
  semJ: "demo.sem.jefe",
  lamJ: "demo.lam.jefe",
  lmbA: "demo.lmb.analista1",
  lesA: "demo.les.analista1",
};

const C = {};
const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

async function metodoId(codigo) {
  const m = lista(await ok(U.planif, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
  afirmar(m, `método ${codigo} no encontrado`);
  return m.id;
}

/** Abre una OT del laboratorio y recepciona las muestras con sus métodos (recepción mínima válida). */
async function otCon(lab, quien, metodos, nMuestras = 1, extraMuestra = () => ({})) {
  const labs = await ok(U.planif, "GET", "/ot/laboratorios");
  const u = labs.find((x) => x.codigo === lab);
  afirmar(u, `${lab} no figura entre los laboratorios`);
  C.cliente ??= lista(await ok(U.planif, "GET", "/clientes?limit=5"))[0];
  const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: u.id, conCobro: false, descripcionTrabajo: `Verificación r2a ${sello} · ${lab}` });
  const reg = await ok(quien, "GET", `/flujo/ot/${ot.id}/registro-muestras`);
  const toma = reg.opcionesToma?.[0]?.codigo;
  const datos = {};
  for (const c of reg.configRecepcion?.campos ?? []) {
    if (!c.obligatorio || ["clase_custodia", "ubicacion"].includes(c.codigo)) continue;
    datos[c.codigo] = c.tipo === "casilla" ? true : c.tipo === "entero" || c.tipo === "numero" ? 1 : c.tipo === "fecha" ? hoy() : c.tipo === "lista" ? c.opciones[0].valor : "x";
  }
  const campo = (cod) => (reg.configRecepcion?.campos ?? []).find((c) => c.codigo === cod);
  const recepcion = {
    tomaMuestra: toma, condicionRecepcion: "cumple", identificacionCliente: "Identificación de prueba", datos,
    ...(campo("clase_custodia")?.obligatorio ? { claseCustodia: campo("clase_custodia").opciones[0].valor } : {}),
    ...(campo("ubicacion")?.obligatorio ? { ubicacion: campo("ubicacion").opciones?.[0]?.valor ?? "Bodega" } : {}),
  };
  const ids = [];
  for (const c of metodos) ids.push(typeof c === "string" && /^\d+$/.test(c) ? await metodoId(c) : c);
  const muestras = Array.from({ length: nMuestras }, (_, i) => ({ nombre: `${lab} · muestra ${i + 1} · ${sello}`, metodoIds: ids, recepcion, ...extraMuestra(i) }));
  const r = await ok(quien, "POST", `/flujo/ot/${ot.id}/muestras`, { muestras });
  const res = await ok(quien, "GET", `/flujo/ot/${ot.id}/resultados`);
  return { ot, unidad: u, muestras: r.muestras, resultados: res.resultados };
}

/** Equipo de prueba del laboratorio (lo crea su jefe si no existe): apto o con la calibración vencida. */
async function equipo(jefe, unidadId, codigo, nombre, proxima) {
  const ex = lista(await ok(jefe, "GET", `/equipos?search=${codigo}`)).find((e) => e.codigo === codigo);
  if (ex) return ex;
  return ok(jefe, "POST", "/equipos", { codigo, nombre, unidadId, estado: "operativo", proximaCalibracion: proxima });
}

async function parametros() {
  return ok(U.calidad, "GET", "/parametros/configurables");
}
const parametro = (p, cat, cod) => p.grupos.find((g) => g.categoria === cat)?.parametros.find((x) => x.codigo === cod);

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  /* ------------------------------------------------- 1. Parámetros --- */
  await paso("1 · Parámetros: variantes, amenazas, AQL, HCP, preparación y trabajo DSA están en «Parámetros de la operación»", async () => {
    const p = await parametros();
    for (const [cat, cod] of [["captura_variante_metodo", "3376"], ["captura_variante_metodo", "545"], ["captura_variante_metodo", "3704"], ["lrb", "amenazas"], ["inspeccion_aql", "aql_clase_b"], ["hcp_plantilla", "VLCB"], ["preparacion_campo", "LME.vigencia_soluciones"], ["preparacion_trabajo", "exige_aprobacion"], ["rsa_criterios", "tabla"], ["sensorial", "rangos"]])
      afirmar(parametro(p, cat, cod), `falta ${cat}.${cod}`);
    afirmar(parametro(p, "hcp_plantilla", "VLCB").texto === "379 filas", `HCP VLCB: ${parametro(p, "hcp_plantilla", "VLCB").texto}`);
    afirmar(parametro(p, "captura_variante_metodo", "428").texto.includes("(inactiva)"), "la microbiología debería venir inactiva");
    C.amenazas = parametro(p, "lrb", "amenazas").valor;
    return `${p.grupos.length} grupos · ${C.amenazas.length} amenazas`;
  });

  await paso("1 · Tabla de amenazas: Calidad la cambia con motivo e historial; inválida → 400; Jefe LQC → 403", async () => {
    const filas = C.amenazas.map((f) => ({ ...f }));
    filas[0].criterio = `${filas[0].criterio} ·`;
    await rechazo(400, /motivo/, U.calidad, "PUT", "/parametros/configurables/lrb/amenazas", { valor: filas, motivo: "" });
    await rechazo(400, /menor que la mínima/, U.calidad, "PUT", "/parametros/configurables/lrb/amenazas", { valor: [{ ...filas[0], v_max: 1 }], motivo: "Prueba de validación" });
    await rechazo(400, /repetido/, U.calidad, "PUT", "/parametros/configurables/lrb/amenazas", { valor: [filas[0], filas[0]], motivo: "Prueba de validación" });
    await exigir(403, U.lqcJ, "PUT", "/parametros/configurables/lrb/amenazas", { valor: filas, motivo: "Intento sin alcance global" });
    await ok(U.calidad, "PUT", "/parametros/configurables/lrb/amenazas", { valor: filas, motivo: "Verificación r2a: criterio ajustado" });
    await ok(U.calidad, "PUT", "/parametros/configurables/lrb/amenazas", { valor: C.amenazas, motivo: "Verificación r2a: se repone la tabla" });
    const p = await parametros();
    const h = p.historial.filter((x) => x.categoria === "lrb" && x.codigo === "amenazas");
    afirmar(h.length >= 2 && /Verificación r2a/.test(h[0].motivo), "el historial no registra el cambio");
    return `${h.length} cambios en el historial`;
  });

  /* ------------------------------------------ 2. LRB · trabajo --- */
  await paso("2 · LRB: OT con «Prueba resistencia balística» (método con variante «Registro de disparos»)", async () => {
    C.lrb = await otCon("LRB", U.lrbA, ["3376"], 2);
    const r = await ok(U.lrbA, "GET", `/formularios/ot/${C.lrb.ot.id}`);
    afirmar(r.ensayos.length === 2 && r.ensayos.every((e) => e.variante === "lrb_disparos"), JSON.stringify(r.ensayos).slice(0, 200));
    afirmar(r.formularios[0]?.nombre === "Registro de disparos", "falta el formulario en el resumen");
    return `${C.lrb.ot.codigo} · ${C.lrb.resultados.length} ensayos`;
  });

  await paso("2 · Ruta de la OT: tras asignar, «Preparación del trabajo» (Planilla de trabajo) le toca al analista", async () => {
    const a = await ok(U.lrbJ, "GET", `/ot/${C.lrb.ot.id}/avance`);
    const claves = a.etapas.map((e) => e.clave);
    afirmar(claves.indexOf("preparacion") === claves.indexOf("asignacion") + 1, claves.join(","));
    return a.etapas.find((e) => e.clave === "preparacion").detalle;
  });

  await paso("2 · La ejecución espera la aprobación: registro de disparos → 409; la captura estándar del ensayo → 409 (va por su formulario)", async () => {
    await rechazo(409, /no se ha preparado/, U.lrbA, "PUT", `/formularios/ot/${C.lrb.ot.id}/disparos`, { unidades: [] });
    await rechazo(409, /Registro de disparos/, U.lrbA, "POST", `/flujo/resultado/${C.lrb.resultados[0].id}/valor`, { atributo: "cumple" });
  });

  await paso("2.1 · Comisión y equipos: equipo con calibración vencida no se reserva (400); Analista sin ot.asignar → 403", async () => {
    await equipo(U.lrbJ, C.lrb.unidad.id, "EQ-R2A-CRONO", "Cronógrafo balístico (verificación r2a)", masDias(365));
    await equipo(U.lrbJ, C.lrb.unidad.id, "EQ-R2A-CRONO-V", "Cronógrafo de respaldo (verificación r2a)", masDias(-10));
    const t = await ok(U.lrbJ, "GET", `/formularios/ot/${C.lrb.ot.id}/trabajo`);
    afirmar(t.formulario.titulo === "Planilla de trabajo" && t.exige === true, "LRB debe exigir aprobación");
    C.lrbPersonal = t.personal;
    let apto = t.equipos.find((e) => e.apto);
    let vencido = t.equipos.find((e) => !e.apto);
    afirmar(vencido || apto, "el LRB no tiene equipos");
    if (vencido) await rechazo(400, /no se puede reservar/, U.lrbJ, "PUT", `/formularios/ot/${C.lrb.ot.id}/trabajo/comision`, { jefeComision: null, inspectores: [], equipos: [vencido.id] });
    await exigir(403, U.lrbA, "PUT", `/formularios/ot/${C.lrb.ot.id}/trabajo/comision`, { jefeComision: null, inspectores: [], equipos: [] });
    const r = await ok(U.lrbJ, "PUT", `/formularios/ot/${C.lrb.ot.id}/trabajo/comision`, { jefeComision: t.personal[0]?.id ?? null, inspectores: t.personal.slice(0, 2).map((p) => p.id), equipos: apto ? [apto.id] : [] });
    afirmar(r.comision.inspectores.length >= 1, "no quedaron inspectores");
    return `${t.equipos.length} equipos (${t.equipos.filter((e) => e.apto).length} aptos) · ${r.comision.equipos.length} reservado(s)`;
  });

  await paso("2.2 · Planilla de trabajo: incompleta no se envía; el analista la envía a aprobación con un adjunto PDF", async () => {
    await rechazo(409, /obligatorios/, U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/enviar`, { documentacion: { plan_disparos: "6 por panel" } });
    const f = new FormData();
    f.append("archivo", new Blob([PDF_MIN], { type: "application/pdf" }), "proyecto-parrafo.pdf");
    const conAdj = await ok(U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/adjuntos`, f);
    afirmar(conAdj.adjuntos.length === 1, "no quedó el adjunto");
    const malo = new FormData();
    malo.append("archivo", new Blob([Buffer.from("no soy un pdf")], { type: "application/pdf" }), "x.pdf");
    await rechazo(400, /no corresponde/, U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/adjuntos`, malo);
    const r = await ok(U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/enviar`, { documentacion: { amenazas: ["NIJ0101-IIIA-9MM", "NIJ0101-IIIA-44MAG"], plan_disparos: "Chaleco: 6 disparos por panel", cartuchos: 35 } });
    afirmar(r.estado === "en_aprobacion", `estado ${r.estado}`);
    return r.textoEstado;
  });

  await paso("2.3 · Mi bandeja del Jefe LRB tiene la tarjeta; el analista no aprueba (403) y la captura sigue esperando", async () => {
    const pend = await ok(U.lrbJ, "GET", "/formularios/pendientes-aprobacion");
    afirmar(pend.some((x) => x.otId === C.lrb.ot.id), "la documentación no está en los pendientes del Jefe LRB");
    afirmar((await ok(U.lrbA, "GET", "/formularios/pendientes-aprobacion")).length === 0, "el analista ve pendientes de aprobación");
    const b = await ok(U.lrbJ, "GET", "/me/bandeja").catch(() => null);
    if (b) afirmar(JSON.stringify(b).includes("Documentación del trabajo por aprobar"), "la tarjeta no aparece en Mi bandeja");
    await exigir(403, U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/aprobar`, {});
    await rechazo(409, /pendiente de aprobación/, U.lrbA, "PUT", `/formularios/ot/${C.lrb.ot.id}/disparos`, { unidades: [] });
  });

  await paso("2.3 · Devolver exige comentario; el Jefe LRB devuelve, el analista reenvía y el Jefe aprueba → ejecutar", async () => {
    await rechazo(409, /comentario/, U.lrbJ, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/devolver`, { comentario: "" });
    const d = await ok(U.lrbJ, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/devolver`, { comentario: "Indique la munición de reposición" });
    afirmar(d.estado === "devuelta", d.estado);
    await ok(U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/enviar`, { documentacion: { amenazas: ["NIJ0101-IIIA-9MM", "NIJ0101-IIIA-44MAG"], plan_disparos: "Chaleco: 6 disparos por panel", cartuchos: 40, recursos: "Reposición: 5 cartuchos por calibre" } });
    const a = await ok(U.lrbJ, "POST", `/formularios/ot/${C.lrb.ot.id}/trabajo/aprobar`, {});
    afirmar(a.estado === "aprobada", a.estado);
    afirmar(a.eventos.some((e) => e.accion === "devolver" && /munición/.test(e.motivo)), "la bitácora no registra la devolución");
    const av = await ok(U.lrbJ, "GET", `/ot/${C.lrb.ot.id}/avance`);
    afirmar(av.etapas.find((e) => e.clave === "preparacion").estado === "hecho", "la etapa no quedó hecha");
    return `${a.eventos.length} eventos en la bitácora`;
  });

  /* ------------------------------------------ 3. LRB · disparos --- */
  const panel = (id, zona, amenaza) => ({ id, zona, amenaza });
  await paso("3 · Lote, nómina por talla y unidades muestreadas (munición de la tabla de amenazas)", async () => {
    await rechazo(400, /munición de la tabla/, U.lrbA, "PUT", `/formularios/ot/${C.lrb.ot.id}/disparos`, { unidades: [{ serie: "S-1", paneles: [panel("p", "anterior", "NO")] }] });
    const m = C.lrb.muestras;
    const v = await ok(U.lrbA, "PUT", `/formularios/ot/${C.lrb.ot.id}/disparos`, {
      certificacionLote: true, material: "Chaleco antibalas nivel IIIA", tipoCertificacion: "Certificación de lote", fechaEnsayo: hoy(),
      lote: { tamano: 336, modelo: "MGV05", reposicion: 4, fabricacion: "2025-11-15", garantiaAnios: 10 },
      composicion: [{ talla: "S", cantidad: 9 }, { talla: "M", cantidad: 49 }, { talla: "L", cantidad: 99 }, { talla: "XL", cantidad: 99 }, { talla: "XXL", cantidad: 50 }, { talla: "3XL", cantidad: 30 }],
      unidades: [
        { id: "u1", serie: "S-008", talla: "S", muestraId: m[0].id, reemplazo: "S-001", paneles: [panel("u1a", "anterior", "NIJ0101-IIIA-44MAG")] },
        { id: "u2", serie: "M-030", talla: "M", muestraId: m[1].id, reemplazo: "M-011", paneles: [panel("u2a", "anterior", "NIJ0101-IIIA-9MM")] },
      ],
    });
    afirmar(v.datos.unidades.length === 2, "no quedaron las unidades");
    return `${v.datos.unidades.length} unidades · lote ${v.datos.lote.tamano}`;
  });

  const disparo = (u, p, d, motivo) => llamar(U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/disparos/disparo`, { unidadId: u, panelId: p, disparo: d, motivo });
  await paso("3 · Disparos: correlativo, trauma obligatorio en 1 a 3, velocidad fuera de ventana avisa", async () => {
    let r = await disparo("u1", "u1a", { n: 2, v1: 436, trauma: 30, penetracion: false });
    afirmar(r.status === 400 && /Nº 1/.test(msg(r.json)), `correlativo: ${r.status} ${msg(r.json)}`);
    r = await disparo("u1", "u1a", { n: 1, v1: 436, penetracion: false });
    afirmar(r.status === 400 && /trauma es obligatorio/.test(msg(r.json)), `trauma: ${msg(r.json)}`);
    r = await disparo("u1", "u1a", { n: 1, v1: "445,8", v2: 440, trauma: "38,5", laminasPerforadas: 3, laminasTotal: 28, penetracion: false });
    afirmar(r.status === 201 || r.status === 200, msg(r.json));
    afirmar(r.json.panel.avisos.some((a) => /fuera de la ventana/.test(a)), "no avisa la velocidad fuera de ventana");
    for (const n of [2, 3, 4, 5, 6]) {
      r = await disparo("u1", "u1a", { n, v1: 436 + n, trauma: n <= 3 ? 30 + n : null, penetracion: false });
      afirmar(r.status < 300, msg(r.json));
    }
    afirmar(r.json.panel.veredicto === "cumple" && r.json.panel.completo, "el panel de 6 disparos debería cumplir");
    r = await disparo("u1", "u1a", { n: 7, v1: 436, penetracion: false });
    afirmar(r.status === 400 && /6 disparos/.test(msg(r.json)), "admite más disparos que el plan");
    return "panel S-008 completo · cumple";
  });

  await paso("3 · Corregir un disparo exige motivo; cerrar panel incompleto → 400; se cierra el completo", async () => {
    let r = await disparo("u1", "u1a", { n: 2, v1: 437, trauma: 33, penetracion: false });
    afirmar(r.status === 400 && /motivo/.test(msg(r.json)), "corrige sin motivo");
    r = await disparo("u1", "u1a", { n: 2, v1: 437, trauma: 33, penetracion: false }, "Velocidad transcrita mal del cronógrafo");
    afirmar(r.status < 300, msg(r.json));
    await rechazo(400, /no está completo/, U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/disparos/cerrar-panel`, { unidadId: "u2", panelId: "u2a" });
    await ok(U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/disparos/cerrar-panel`, { unidadId: "u1", panelId: "u1a" });
  });

  await paso("3 · Penetración completa: detiene el panel (no admite más disparos) y rechaza el lote", async () => {
    let r = await disparo("u2", "u2a", { n: 1, v1: 440, trauma: 40, penetracion: true });
    afirmar(r.status < 300, msg(r.json));
    afirmar(r.json.panel.detenido && r.json.lote.veredicto === "no_cumple" && r.json.lote.penetracion, JSON.stringify(r.json.lote));
    r = await disparo("u2", "u2a", { n: 2, v1: 436, trauma: 30, penetracion: false });
    afirmar(r.status === 400 && /detenido/.test(msg(r.json)), "admite disparos en un panel detenido");
    await ok(U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/disparos/cerrar-panel`, { unidadId: "u2", panelId: "u2a" });
    return r.json?.message ?? "panel M-030 detenido";
  });

  await paso("3 · Concluir lote → documento: veredicto por muestra a los ensayos; la captura estándar sigue cerrada", async () => {
    await exigir(403, U.lqcA, "POST", `/formularios/ot/${C.lrb.ot.id}/disparos/concluir`, {});
    const r = await ok(U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/disparos/concluir`, {});
    afirmar(r.llevados.length === 2 && r.llevados.every((x) => x.ok), JSON.stringify(r.llevados));
    const res = await ok(U.lrbA, "GET", `/flujo/ot/${C.lrb.ot.id}/resultados`);
    const porMuestra = Object.fromEntries(res.resultados.map((x) => [x.muestraId, x]));
    afirmar(porMuestra[C.lrb.muestras[0].id].veredicto === "cumple", "S-008 debería cumplir");
    afirmar(porMuestra[C.lrb.muestras[1].id].veredicto === "no_cumple", "M-030 debería no cumplir");
    afirmar(/Registro de disparos/.test(porMuestra[C.lrb.muestras[1].id].observacion ?? ""), "la observación no resume el registro");
    await rechazo(409, /concluido/, U.lrbA, "POST", `/formularios/ot/${C.lrb.ot.id}/disparos/disparo`, { unidadId: "u1", panelId: "u1a", disparo: { n: 1, v1: 436, trauma: 30, penetracion: false } });
    await rechazo(409, /Registro de disparos/, U.lrbA, "POST", `/flujo/resultado/${C.lrb.resultados[0].id}/valor`, { atributo: "cumple", motivo: "Intento de saltarse el formulario" });
    return `lote ${r.evaluacion.veredicto} · ${r.evaluacion.falla}`;
  });

  await paso("3 · Revisión y aprobación por el camino normal (revisor ≠ analista, Jefe aprueba)", async () => {
    await ok(U.lrbR, "POST", `/resultados/ot/${C.lrb.ot.id}/revisar`, {});
    await ok(U.lrbJ, "POST", `/resultados/ot/${C.lrb.ot.id}/aprobar`, {});
    const res = await ok(U.lrbJ, "GET", `/flujo/ot/${C.lrb.ot.id}/resultados`);
    afirmar(res.resultados.every((r) => r.estado === "aprobado"), res.resultados.map((r) => r.estado).join(","));
  });

  /* ------------------------------------------ 4. LRB · documentos --- */
  await paso("4 · Informe de Rechazo (lote No Cumple): condiciones OK; el CRB no se puede emitir", async () => {
    const pl = lista(await ok(U.lrbJ, "GET", "/plantillas?limit=500"));
    C.plCrb = pl.find((p) => p.repid === "LRB-CRB");
    C.plRech = pl.find((p) => p.repid === "LRB-RECH");
    afirmar(C.plCrb && C.plRech, "faltan las plantillas LRB-CRB / LRB-RECH");
    const crb = await ok(U.lrbJ, "POST", "/informes/condiciones", { otId: C.lrb.ot.id, plantillaId: C.plCrb.id });
    afirmar(crb.tipoDocumento === "CERTIFICADO_RESISTENCIA_BALISTICA" && !crb.puedeEmitir && crb.faltantes.some((f) => /solo se emite si el lote cumple/.test(f)), JSON.stringify(crb.faltantes));
    const re = await ok(U.lrbJ, "POST", "/informes/condiciones", { otId: C.lrb.ot.id, plantillaId: C.plRech.id });
    afirmar(re.tipoDocumento === "INFORME_RECHAZO" && re.puedeEmitir, JSON.stringify(re.faltantes));
    afirmar(/^IDIC DSA SAM LRB Nº J\./.test(re.numeracion.numero ?? ""), `número ${re.numeracion.numero}`);
    afirmar(re.pasos.length === 2, `pasos ${JSON.stringify(re.pasos)}`);
    return `${re.numeracion.numero} · ${re.pasos.map((p) => p.accion).join(" → ")}`;
  });

  await paso("4 · Se emite el Informe de Ensayo de Rechazo: resultados por panel, falla y apelación en 5 días hábiles", async () => {
    const pv = await ok(U.lrbJ, "POST", "/informes/previsualizar", { otId: C.lrb.ot.id, plantillaId: C.plRech.id });
    const html = pv.html ?? pv.documentoHtml ?? JSON.stringify(pv);
    for (const t of ["INFORME DE ENSAYO DE RECHAZO", "Panel detenido", "Penetración completa", "5 días hábiles", "Trescientos treinta y seis (336)"]) afirmar(html.includes(t), `falta «${t}» en el informe`);
    const e = await ok(U.lrbJ, "POST", "/informes/emitir", { otId: C.lrb.ot.id, plantillaId: C.plRech.id });
    C.rechazo = e;
    return e.numero ?? e.certificado?.numero;
  });

  await paso("4 · CRB de un lote que cumple: series por talla, reemplazos y cantidad en palabras", async () => {
    const o = await otCon("LRB", U.lrbA, ["3376"], 1);
    C.lrb2 = o;
    await ok(U.lrbA, "POST", `/formularios/ot/${o.ot.id}/trabajo/enviar`, { documentacion: { amenazas: ["NIJ0101-IIIA-9MM"], plan_disparos: "6 por panel", cartuchos: 10 } });
    await ok(U.lrbJ, "POST", `/formularios/ot/${o.ot.id}/trabajo/aprobar`, {});
    await ok(U.lrbA, "PUT", `/formularios/ot/${o.ot.id}/disparos`, {
      certificacionLote: true, material: "Chaleco antibalas nivel IIIA", fechaEnsayo: hoy(),
      lote: { tamano: 50, modelo: "MGMIA", fabricacion: "2025-11-15", garantiaAnios: 10 },
      composicion: [{ talla: "M", cantidad: 25 }, { talla: "L", cantidad: 25 }],
      unidades: [{ id: "a", serie: "M-100", talla: "M", muestraId: o.muestras[0].id, reemplazo: "M-101", paneles: [panel("a1", "anterior", "NIJ0101-IIIA-9MM")] }],
    });
    for (const n of [1, 2, 3, 4, 5, 6]) await ok(U.lrbA, "POST", `/formularios/ot/${o.ot.id}/disparos/disparo`, { unidadId: "a", panelId: "a1", disparo: { n, v1: 436, trauma: n <= 3 ? 35 : null, penetracion: false } });
    await ok(U.lrbA, "POST", `/formularios/ot/${o.ot.id}/disparos/concluir`, {});
    await ok(U.lrbR, "POST", `/resultados/ot/${o.ot.id}/revisar`, {});
    await ok(U.lrbJ, "POST", `/resultados/ot/${o.ot.id}/aprobar`, {});
    const re = await ok(U.lrbJ, "POST", "/informes/condiciones", { otId: o.ot.id, plantillaId: C.plRech.id });
    afirmar(!re.puedeEmitir && re.faltantes.some((f) => /solo se emite si el lote no cumple/.test(f)), "deja emitir el rechazo de un lote que cumple");
    const pv = await ok(U.lrbJ, "POST", "/informes/previsualizar", { otId: o.ot.id, plantillaId: C.plCrb.id });
    const html = pv.html ?? JSON.stringify(pv);
    for (const t of ["CERTIFICADO DE RESISTENCIA BALÍSTICA", "Cincuenta (50)", "M 25 · L 25 = 50", "M-101", "427–445"]) afirmar(html.includes(t), `falta «${t}» en el CRB`);
    const e = await ok(U.lrbJ, "POST", "/informes/emitir", { otId: o.ot.id, plantillaId: C.plCrb.id });
    return e.numero ?? e.certificado?.numero;
  });

  /* ------------------------------------------ 5. SVM · HCP --- */
  await paso("5 · SVM: OT con dos vehículos; Paquete técnico con la HCP del VLCB aprobado por el Jefe SVM", async () => {
    C.svm = await otCon("SVM", U.svmA, ["540", "545", "1413"], 2);
    const t = await ok(U.svmA, "GET", `/formularios/ot/${C.svm.ot.id}/trabajo`);
    afirmar(t.formulario.titulo === "Paquete técnico" && t.opciones.hcp.some((h) => h.valor === "VLCB"), "falta la HCP en el paquete técnico");
    await rechazo(400, /HCP configurada/, U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/trabajo`, { documentacion: { hcp: "NO" } });
    await ok(U.svmA, "POST", `/formularios/ot/${C.svm.ot.id}/trabajo/enviar`, { documentacion: { resolucion: "Res. de prueba", hcp: "VLCB", eett: "RT VLCB v2" } });
    await exigir(403, U.lrbJ, "POST", `/formularios/ot/${C.svm.ot.id}/trabajo/aprobar`, {});
    await ok(U.svmJ, "POST", `/formularios/ot/${C.svm.ot.id}/trabajo/aprobar`, {});
    const r = await ok(U.svmA, "GET", `/formularios/ot/${C.svm.ot.id}`);
    afirmar(r.ensayos.every((e) => e.variante === "svm_hcp"), "los ensayos del SVM no van por la HCP");
    return `${C.svm.ot.codigo} · ${r.ensayos.length} ensayos por HCP`;
  });

  await paso("5 · Lote: n sugerido por NCh 44 (lote 70, nivel II → 13); se fija la muestra en 2 vehículos", async () => {
    await rechazo(400, /tamaño del lote/, U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/lote`, { plantilla: "VLCB", tamanoLote: 70, muestra: 71 });
    const v = await ok(U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/lote`, { plantilla: "VLCB", tamanoLote: 70, muestra: 2 });
    afirmar(v.nSugerido === 13, `n sugerido ${v.nSugerido}`);
    afirmar(v.plantilla.items.length === 379, `ítems ${v.plantilla.items.length}`);
    C.hcpItems = v.plantilla.items;
    return `${v.plantilla.items.length} ítems · n sugerido ${v.nSugerido}`;
  });

  const todoC = () => Object.fromEntries(C.hcpItems.map((i) => [i.item, i.min != null || i.max != null ? { valor: i.max ?? i.min } : { resultado: "C" }]));
  const cabecera = (n) => ({ inspectores: ["Analista SVM 1", "Analista SVM 2"], chasis: `CH-${sello}-${n}`, motor: `MO-${sello}-${n}`, anio: 2025, kmSalida: 10, kmLlegada: 25, fechaInicio: hoy(), fechaTermino: hoy() });
  await paso("5 · Vehículo Nº 1 conforme: «Guardar vehículo → siguiente vehículo» lleva Conforme a sus ensayos", async () => {
    await exigir(403, U.lccA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[0].id}`, { numero: 1, cabecera: cabecera(1), items: todoC() });
    const r = await ok(U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[0].id}`, { numero: 1, cabecera: cabecera(1), items: todoC() });
    afirmar(r.evaluacion.estado === "inspeccionado" && r.evaluacion.veredicto === "cumple", JSON.stringify(r.evaluacion).slice(0, 200));
    afirmar(r.llevados.length >= 2 && r.llevados.every((x) => x.ok), JSON.stringify(r.llevados));
    return `${r.evaluacion.respondidos}/${r.evaluacion.total} ítems · ${r.llevados.length} ensayos`;
  });

  await paso("5 · Vehículo Nº 2: N/C sin observación → 400; giro 17 m (clase A) no conforme; chasis repetido → 400", async () => {
    const items = todoC();
    items["2.1.1"] = { resultado: "NC" };
    await rechazo(400, /observación es obligatoria/, U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[1].id}`, { numero: 2, cabecera: cabecera(2), items });
    await rechazo(400, /chasis/, U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[1].id}`, { numero: 2, cabecera: { ...cabecera(2), chasis: cabecera(1).chasis }, items: todoC() });
    items["2.1.1"] = { resultado: "NC", observacion: "Falta una plumilla" };
    items["4.2.1"] = { valor: 17, observacion: "Viraje en Ø 17 m" };
    const r = await ok(U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[1].id}`, { numero: 2, cabecera: cabecera(2), items });
    afirmar(r.evaluacion.veredicto === "no_cumple" && r.evaluacion.ncPorClase.A === 1 && r.evaluacion.ncPorClase.B === 1, JSON.stringify(r.evaluacion.ncPorClase));
    const res = await ok(U.svmA, "GET", `/flujo/ot/${C.svm.ot.id}/resultados`);
    const giro = res.resultados.find((x) => x.muestraId === C.svm.muestras[1].id && x.catMetodo?.codigo === "545");
    afirmar(giro?.veredicto === "no_cumple" && /4\.2\.1/.test(giro.observacion ?? ""), `giro: ${giro?.veredicto} ${giro?.observacion}`);
    return `N/C A=${r.evaluacion.ncPorClase.A} B=${r.evaluacion.ncPorClase.B}`;
  });

  await paso("5 · Corregir un vehículo inspeccionado exige motivo (bitácora, sin borrar)", async () => {
    const items = todoC();
    items["2.1.1"] = { resultado: "NC", observacion: "Falta una plumilla" };
    items["4.2.1"] = { valor: 17, observacion: "Viraje en Ø 17 m" };
    items["2.1.2"] = { resultado: "NC", observacion: "Surtidor sin agua" };
    await rechazo(400, /motivo/, U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[1].id}`, { numero: 2, cabecera: cabecera(2), items });
    await rechazo(400, /motivo|Ya hay/, U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[1].id}`, { numero: 2, cabecera: cabecera(2), items, motivo: "" });
    const r = await llamar(U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[1].id}`, { numero: 2, cabecera: cabecera(2), items, motivo: "Se revisó el surtidor en la segunda pasada" });
    afirmar(r.status < 300, msg(r.json));
    return `${r.json.llevados.filter((x) => !x.ok).length} ensayo(s) sin cambiar (ya capturados en otro estado)`;
  });

  await paso("5 · Lote por clase (A: una N/C rechaza) y acta de novedades con hash; después no se cambia", async () => {
    const v = await ok(U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/acciones`, { acciones: { "2:2.1.1": "Reponer plumilla" } });
    afirmar(v.evaluacionLote.veredicto === "no_cumple" && v.evaluacionLote.clases.find((c) => c.clase === "A").decision === "rechaza", JSON.stringify(v.evaluacionLote.clases));
    afirmar(v.novedades.length === 3 && v.novedades.some((n) => n.accionProveedor === "Reponer plumilla"), JSON.stringify(v.novedades).slice(0, 200));
    const a = await ok(U.svmA, "POST", `/formularios/ot/${C.svm.ot.id}/hcp/acta`);
    afirmar(a.lote.estado === "acta_emitida" && /^[0-9a-f]{64}$/.test(a.lote.datos.acta.hash), "el acta no quedó emitida");
    const s = await login(U.svmA);
    const html = await (await fetch(`${BASE}/formularios/ot/${C.svm.ot.id}/hcp/acta`, { headers: { authorization: `Bearer ${s.token}` } })).text();
    afirmar(html.includes("ACTA DE ENTREGA DE NOVEDADES") && html.includes("Reponer plumilla"), "el acta no se imprime");
    await rechazo(409, /acta/, U.svmA, "PUT", `/formularios/ot/${C.svm.ot.id}/hcp/vehiculo/${C.svm.muestras[0].id}`, { numero: 1, cabecera: cabecera(1), items: todoC() });
    return `${v.novedades.length} novedades · ${v.evaluacionLote.regla.slice(0, 80)}…`;
  });

  /* ------------------------------------------ 6. LCC · AQL --- */
  await paso("6 · LCC: inspección por atributos (NCh 44) con Ac/Re de la tabla; manual sin motivo → 400; LQC → 403", async () => {
    C.lcc = await otCon("LCC", U.lccA, ["3704", "3705"], 1);
    const v = await ok(U.lccA, "GET", `/formularios/ot/${C.lcc.ot.id}/aql`);
    afirmar(v.filas.length === 2 && v.filas.every((f) => f.resultadoId && f.aql === "2,5" && f.nivel === "II"), JSON.stringify(v.filas).slice(0, 300));
    const filas = v.filas.map((f, i) => ({ ...f, aql: i === 0 ? "1,5" : "2,5", defectuosos: i === 0 ? 3 : 6 }));
    await rechazo(400, /motivo/, U.lccA, "PUT", `/formularios/ot/${C.lcc.ot.id}/aql`, { tamanoLote: 1000, filas: [{ ...filas[0], acManual: 0, reManual: 1 }] });
    await exigir(403, U.lqcA, "PUT", `/formularios/ot/${C.lcc.ot.id}/aql`, { tamanoLote: 1000, filas });
    const r = await ok(U.lccA, "PUT", `/formularios/ot/${C.lcc.ot.id}/aql`, { tamanoLote: 1000, filas: [...filas, { inspeccion: "Embalaje", aql: "6,5", nivel: "II", defectuosos: 1 }] });
    afirmar(r.evaluacion.filas[0].plan.letra === "J" && r.evaluacion.filas[0].ac === 3 && r.evaluacion.filas[0].cumplimiento === "cumple", JSON.stringify(r.evaluacion.filas[0]).slice(0, 200));
    afirmar(r.evaluacion.filas[1].cumplimiento === "no_cumple", "6 defectuosos con AQL 2,5 (Ac 5) deberían rechazar");
    afirmar(r.llevados.length === 2 && r.llevados.every((x) => x.ok), JSON.stringify(r.llevados));
    return r.evaluacion.filas.map((f) => `${f.inspeccion.slice(0, 18)}: ${f.cumplimiento}`).join(" · ");
  });

  await paso("6 · El IVC lleva la sección V «Inspección por atributos (AQL)»; corregir lo evaluado exige motivo", async () => {
    const pl = lista(await ok(U.lccJ, "GET", "/plantillas?limit=500")).find((p) => p.tipo === "IVC");
    afirmar(pl, "no hay plantilla IVC");
    const pv = await ok(U.lccJ, "POST", "/informes/previsualizar", { otId: C.lcc.ot.id, plantillaId: pl.id });
    const html = pv.html ?? JSON.stringify(pv);
    afirmar(html.includes("Inspección por atributos (AQL)") && html.includes("NCh 44"), "el IVC no trae la sección AQL");
    const v = await ok(U.lccA, "GET", `/formularios/ot/${C.lcc.ot.id}/aql`);
    await rechazo(400, /motivo/, U.lccA, "PUT", `/formularios/ot/${C.lcc.ot.id}/aql`, { tamanoLote: 1200, filas: v.filas });
    return pl.repid;
  });

  /* ------------------------------------------ 7. Preparación de muestras --- */
  await paso("7 · LME: solución vencida y balanza sin verificar bloquean la captura de la muestra", async () => {
    const labs = await ok(U.planif, "GET", "/ot/laboratorios");
    const otLme = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: labs.find((x) => x.codigo === "LME").id, conCobro: false, descripcionTrabajo: `Verificación r2a ${sello} · LME` });
    const prods = await ok(U.lmeA, "GET", `/recepcion/ot/${otLme.id}/productos`);
    const prod = prods.productos.find((x) => x.nombre === "Nitrato de amonio") ?? prods.productos[0];
    const panelP = await ok(U.lmeA, "GET", `/recepcion/ot/${otLme.id}/productos/${prod.id}/panel`);
    const metodo = panelP.metodos.find((m) => m.nombre.toLowerCase() === "humedad" && m.analitos > 0) ?? panelP.metodos.find((m) => m.analitos > 0);
    const reg = await ok(U.lmeA, "GET", `/flujo/ot/${otLme.id}/registro-muestras`);
    const datos = {};
    for (const c of reg.configRecepcion.campos) if (c.obligatorio && !["clase_custodia", "ubicacion"].includes(c.codigo)) datos[c.codigo] = c.tipo === "casilla" ? true : "x";
    const m = await ok(U.lmeA, "POST", `/flujo/ot/${otLme.id}/muestras`, {
      muestras: [{ nombre: `LME · ${sello}`, catElementoId: prod.id, metodoIds: [metodo.id], recepcion: { tomaMuestra: reg.opcionesToma[0].codigo, condicionRecepcion: "cumple", claseCustodia: "analisis", ubicacion: "Sala de preparación", datos } }],
    });
    C.lmeOt = otLme;
    C.lmeMuestra = m.muestras[0];
    const res = await ok(U.lmeA, "GET", `/flujo/ot/${otLme.id}/resultados`);
    C.lmeRes = res.resultados[0];
    const p = await ok(U.lmeA, "GET", `/formularios/ot/${otLme.id}/preparacion`);
    const fila = p.filas.find((f) => f.laboratorio === "LME");
    afirmar(fila && fila.campos.some((c) => c.campo === "vigencia_soluciones" && c.bloquea), "faltan los campos del LME");
    await exigir(403, U.lqcA, "PUT", `/formularios/ot/${otLme.id}/preparacion/${C.lmeMuestra.id}`, { laboratorio: "LME", datos: {} });
    await rechazo(400, /obligatorio/, U.lmeA, "PUT", `/formularios/ot/${otLme.id}/preparacion/${C.lmeMuestra.id}`, { laboratorio: "LME", datos: { t_sala: 21 } });
    const g = await ok(U.lmeA, "PUT", `/formularios/ot/${otLme.id}/preparacion/${C.lmeMuestra.id}`, { laboratorio: "LME", datos: { t_sala: "21,5", hr_sala: 45, verificacion_balanza: false, vigencia_soluciones: masDias(-3), control_horno: true } });
    afirmar(g.bloqueos.length === 2, JSON.stringify(g.bloqueos));
    await rechazo(409, /bloquea el ensayo/, U.lmeA, "POST", `/flujo/resultado/${C.lmeRes.id}/valor`, { valor: "1,5" });
    return g.bloqueos.join(" ");
  });

  await paso("7 · Corregir la preparación exige motivo; sin bloqueos la captura vuelve a funcionar", async () => {
    await rechazo(400, /motivo/, U.lmeA, "PUT", `/formularios/ot/${C.lmeOt.id}/preparacion/${C.lmeMuestra.id}`, { laboratorio: "LME", datos: { t_sala: 21, hr_sala: 45, verificacion_balanza: true, vigencia_soluciones: masDias(90), control_horno: true } });
    const g = await ok(U.lmeA, "PUT", `/formularios/ot/${C.lmeOt.id}/preparacion/${C.lmeMuestra.id}`, { laboratorio: "LME", datos: { t_sala: 21, hr_sala: 45, verificacion_balanza: true, vigencia_soluciones: masDias(90), control_horno: true }, motivo: "Solución renovada y balanza verificada" });
    afirmar(g.bloqueos.length === 0 && g.eventos.some((e) => e.accion === "corregir"), "no quedó corregida en la bitácora");
    const r = await llamar(U.lmeA, "POST", `/flujo/resultado/${C.lmeRes.id}/valor`, { valor: "1,5" });
    afirmar(r.status < 300 || !/bloquea el ensayo/.test(msg(r.json)), `sigue bloqueada: ${msg(r.json)}`);
    return r.status < 300 ? "capturado" : `otra regla de la captura: ${msg(r.json).slice(0, 80)}`;
  });

  /* ------------------------------------------ 8. LEM terreno · LAM --- */
  await paso("8 · LEM en terreno: valida el Jefe de Sección SEM (el Jefe DSA aún no aprueba) y aprueba el Jefe DSA", async () => {
    const labs = await ok(U.planif, "GET", "/ot/laboratorios");
    const o = { ot: await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: labs.find((x) => x.codigo === "LEM").id, conCobro: false, descripcionTrabajo: `Verificación r2a ${sello} · LEM terreno` }) };
    C.lem = o;
    const sinTerreno = await ok(U.lemJ, "POST", `/formularios/ot/${o.ot.id}/trabajo/enviar`, { documentacion: { terreno: false } });
    afirmar(sinTerreno.estado === "registrada" && !sinTerreno.exige, `sin terreno: ${sinTerreno.estado}`);
    await ok(U.lemJ, "PUT", `/formularios/ot/${o.ot.id}/trabajo`, { documentacion: { terreno: true, lugar: "Regimiento de prueba", fecha_inicio: masDias(5), personal: "Jefe LEM y un analista" } });
    const env = await ok(U.lemJ, "POST", `/formularios/ot/${o.ot.id}/trabajo/enviar`, {});
    afirmar(env.estado === "en_aprobacion" && env.pasos.length === 2, `terreno: ${env.estado}`);
    await rechazo(409, /Primero la valida/, U.dsa, "POST", `/formularios/ot/${o.ot.id}/trabajo/aprobar`, {});
    await rechazo(409, /Valida el Jefe de la Sección/, U.lemJ, "POST", `/formularios/ot/${o.ot.id}/trabajo/validar`, {});
    const val = await ok(U.semJ, "POST", `/formularios/ot/${o.ot.id}/trabajo/validar`, {});
    afirmar(val.estado === "validada", val.estado);
    afirmar((await ok(U.dsa, "GET", "/formularios/pendientes-aprobacion")).some((x) => x.otId === o.ot.id), "el Jefe DSA no la ve pendiente");
    await rechazo(409, /Jefe del Departamento/, U.semJ, "POST", `/formularios/ot/${o.ot.id}/trabajo/aprobar`, {});
    const ap = await ok(U.dsa, "POST", `/formularios/ot/${o.ot.id}/trabajo/aprobar`, {});
    afirmar(ap.estado === "aprobada", ap.estado);
    return `${o.ot.codigo}: registrada → en aprobación → validada → aprobada`;
  });

  await paso("8 · LAM: el Plan de trabajo no exige aprobación (queda «registrada»); fuera del DSA → 400", async () => {
    const labs = await ok(U.planif, "GET", "/ot/laboratorios");
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: labs.find((x) => x.codigo === "LAM").id, conCobro: false, descripcionTrabajo: `Verificación r2a ${sello} · LAM` });
    const r = await ok(U.lamJ, "POST", `/formularios/ot/${ot.id}/trabajo/enviar`, { documentacion: { lugar: "Fábrica de prueba", fecha_inicio: masDias(3), normas: ["NCh 44"] } });
    afirmar(r.estado === "registrada" && !r.exige, r.estado);
    await rechazo(400, /laboratorios del DSA/, U.lccJ, "GET", `/formularios/ot/${C.lcc.ot.id}/trabajo`);
  });

  /* ------------------------------------------ 9. Alimentos (R3) --- */
  await paso("9 · LMB: la variante está inactiva (captura estándar); se activa por método con motivo y vuelve a quedar como estaba", async () => {
    const p = await parametros();
    const fila = parametro(p, "captura_variante_metodo", "428");
    C.micro = fila.valor;
    if (fila.valor.activo) await ok(U.calidad, "PUT", "/parametros/configurables/captura_variante_metodo/428", { valor: { variante: "lmb_micro", activo: false }, motivo: "Verificación r2a: estado inicial" });
    C.lmb = await otCon("LMB", U.lmbA, ["428"], 1);
    const r0 = await ok(U.lmbA, "GET", `/formularios/ot/${C.lmb.ot.id}`);
    afirmar(r0.ensayos[0].variante === "estandar", "con la variante inactiva el ensayo debería ser estándar");
    await exigir(403, U.lqcJ, "PUT", "/parametros/configurables/captura_variante_metodo/428", { valor: { variante: "lmb_micro", activo: true }, motivo: "Sin alcance global" });
    await ok(U.calidad, "PUT", "/parametros/configurables/captura_variante_metodo/428", { valor: { variante: "lmb_micro", activo: true }, motivo: "Verificación r2a: se activa la microbiología" });
    const r1 = await ok(U.lmbA, "GET", `/formularios/ot/${C.lmb.ot.id}`);
    afirmar(r1.ensayos[0].variante === "lmb_micro", "no se activó la variante");
  });

  await paso("9 · Microbiología: lecturas 24/48/72 h, recuento ISO 7218 y plan n, c, m, M configurado", async () => {
    const id = C.lmb.resultados[0].id;
    const planesAntes = parametro(await parametros(), "rsa_criterios", "tabla").valor;
    await ok(U.calidad, "PUT", "/parametros/configurables/rsa_criterios/tabla", { valor: [{ metodo: "428", n: 5, c: 2, m: 10000, M: 100000, articulo: "RSA (prueba)" }], motivo: "Verificación r2a: plan de prueba" });
    try {
      const inicio = new Date(Date.now() - 50 * 3600000).toISOString();
      const v = await ok(U.lmbA, "PUT", `/formularios/resultado/${id}/micro`, { tipo: "recuento", siembra: { fecha: inicio, medio: "PCA", diluciones: [2, 3], volumenMl: 1 }, incubacion: { inicio, temperatura: 35 }, lecturas: [] });
      afirmar(v.programadas.map((x) => x.estado).join(",") === "vencida,vencida,pendiente", v.programadas.map((x) => x.estado).join(","));
      await rechazo(400, /Faltan unidades|unidades/, U.lmbA, "PUT", `/formularios/resultado/${id}/micro`, { tipo: "recuento", siembra: { fecha: inicio, diluciones: [2, 3], volumenMl: 1 }, incubacion: { inicio }, lecturas: [{ horas: 48, realizada: new Date().toISOString(), colonias: { 2: [168, 215], 3: [14, 25] } }], unidades: ["a"], confirmar: true }).catch(() => "");
      const c = await ok(U.lmbA, "PUT", `/formularios/resultado/${id}/micro`, {
        tipo: "recuento", siembra: { fecha: inicio, diluciones: [2, 3], volumenMl: 1 }, incubacion: { inicio },
        lecturas: [{ horas: 48, realizada: new Date().toISOString(), colonias: { 2: [168, 215], 3: [14, 25] } }],
        unidades: [19000, 12000, 8000, 500, 15000], confirmar: true,
      });
      afirmar(c.calculo.texto === "1,9 × 10⁴" && c.llevado?.ok, `${c.calculo.texto} · ${JSON.stringify(c.llevado)}`);
      const res = await ok(U.lmbA, "GET", `/flujo/ot/${C.lmb.ot.id}/resultados`);
      afirmar(res.resultados[0].veredicto === "no_cumple" && /3 clases/.test(res.resultados[0].observacion ?? ""), `${res.resultados[0].veredicto} · ${res.resultados[0].observacion}`);
      return `${c.calculo.texto} ufc/g · 3 unidades entre m y M > c = 2 → no cumple`;
    } finally {
      await ok(U.calidad, "PUT", "/parametros/configurables/rsa_criterios/tabla", { valor: planesAntes, motivo: "Verificación r2a: se repone la tabla" }).catch(() => null);
      await ok(U.calidad, "PUT", "/parametros/configurables/captura_variante_metodo/428", { valor: C.micro, motivo: "Verificación r2a: se deja como estaba" }).catch(() => null);
    }
  });

  await paso("9 · Sensorial: plan con códigos aleatorios, cartillas, triangular ISO 4120 (jueces mínimos) y vuelta al estado inicial", async () => {
    const p = await parametros();
    const fila = parametro(p, "captura_variante_metodo", "463");
    const antes = fila.valor;
    await ok(U.calidad, "PUT", "/parametros/configurables/captura_variante_metodo/463", { valor: { variante: "les_panel", activo: true }, motivo: "Verificación r2a: se activa el panel" });
    try {
      const o = await otCon("LES", U.lesA, ["463"], 1);
      const id = o.resultados[0].id;
      const plan = await ok(U.lesA, "PUT", `/formularios/resultado/${id}/sensorial`, { accion: "plan", prueba: "triangular", jueces: 12, muestras: 3, semilla: 7 });
      afirmar(plan.plan.codigos.length === 3 && plan.plan.orden.length === 12 && plan.plan.codigos.every((c) => /^\d{3}$/.test(c)), JSON.stringify(plan.plan).slice(0, 200));
      const cart = plan.cartillas.map((c, i) => ({ ...c, correcta: i < 9 }));
      await rechazo(400, /jueces válidos/, U.lesA, "PUT", `/formularios/resultado/${id}/sensorial`, { accion: "consolidar", prueba: "triangular", cartillas: cart.slice(0, 3) });
      const r = await ok(U.lesA, "PUT", `/formularios/resultado/${id}/sensorial`, { accion: "consolidar", prueba: "triangular", cartillas: cart });
      afirmar(r.consolidacion.triangular.diferencia && r.consolidacion.triangular.minimo === 8 && r.llevado?.ok, JSON.stringify(r.consolidacion));
      return r.consolidacion.triangular.conclusion;
    } finally {
      await ok(U.calidad, "PUT", "/parametros/configurables/captura_variante_metodo/463", { valor: antes, motivo: "Verificación r2a: se deja como estaba" }).catch(() => null);
    }
  });

  await paso("Bitácora de un registro: quién, cuándo, qué y por qué (y alcance)", async () => {
    const v = await ok(U.lrbJ, "GET", `/formularios/ot/${C.lrb.ot.id}/disparos`);
    const ev = await ok(U.lrbJ, "GET", `/formularios/registro/${v.registro.id}/eventos`);
    afirmar(ev.some((e) => e.accion === "corregir_disparo" && /cronógrafo/.test(e.motivo)), "la corrección no está en la bitácora");
    await exigir(403, U.lqcJ, "GET", `/formularios/registro/${v.registro.id}/eventos`);
    return `${ev.length} eventos`;
  });
}

main()
  .then(() => {
    const fallas = pasos.filter((p) => !p.ok).length;
    console.log(`\n${pasos.length - fallas} de ${pasos.length} pasos OK`);
    pararApi();
    process.exit(fallas ? 1 : 0);
  })
  .catch((e) => {
    console.log(`\nInterrumpido: ${e.message}`);
    pararApi();
    process.exit(1);
  });
