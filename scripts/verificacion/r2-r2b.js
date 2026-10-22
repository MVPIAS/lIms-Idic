#!/usr/bin/env node
/**
 * Verificación del frente r2b (entrega R2): especificaciones técnicas del
 * cliente (T11) y muestreo NCh 43/44 (T13), de punta a punta contra una API
 * real, con los perfiles demo.*. Cada regla con un perfil que puede y otro que no:
 *   1. Biblioteca de E.T. versionada (LEM): alta, puntos (con segunda
 *      condición y clase de defecto), publicar, versión nueva, PDF; alcance.
 *   2. OT del LEM con su E.T.: la versión vigente se elige; los ensayos nacen
 *      con el requisito del punto («E.T. … · punto …»).
 *   3. Captura con dos condiciones («X kgf con Y mm»): cumple solo si cumplen las dos.
 *   4. Clase de la no conformidad: la cambia la jefatura, con motivo.
 *   5. Muestreo NCh 43/44 del lote (planilla NCh 44): plan propuesto, n con
 *      motivo, selección sistemática, reemplazo, fotos, «Registrar muestreo →
 *      entregar al laboratorio», «recibido conforme» y Ruta de la OT.
 *   6. Conclusión del lote: no conformidades por clase frente a Ac/Re; la
 *      concluye la jefatura.
 *   7. Formulario de extracción del LCC y desglose del producto en componentes
 *      e inspecciones desde la E.T. (submuestras trazables).
 *   8. Plan de 2/3 clases (n, c, m, M) del RSA en el LMB.
 *   9. «Aplicar requisitos de la E.T. → veredicto» a una OT ya registrada:
 *      lo que vino del catálogo lo cambia la jefatura.
 *  10. Parámetros de la operación del muestreo y del lote.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r2-r2b.js [--arrancar] [--base http://localhost:4821/api]
 * Contraseña: CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA. Deja datos de
 * prueba (E.T. ET-R2B-*, OT del LEM, LCC y LMB con sus muestreos). Úsese en
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4821/api");
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
const msg = (j) =>
  (typeof j === "string"
    ? j
    : j?.message
      ? `${Array.isArray(j.message) ? j.message.join("; ") : j.message}${Array.isArray(j.issues) ? ` · ${j.issues.map((i) => i.message).join("; ")}` : ""}`
      : JSON.stringify(j)
  ).slice(0, 400);
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
  const puerto = new URL(BASE).port || "4821";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r2-r2b-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function formFoto(campos = {}) {
  const f = new FormData();
  f.append("archivo", new Blob([PNG_1x1], { type: "image/png" }), "foto.png");
  for (const [k, v] of Object.entries(campos)) f.append(k, String(v));
  return f;
}
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const masDias = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PDF_MIN = Buffer.from("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n", "latin1");
function formArchivo(buf, nombre, tipo, campos = {}) {
  const f = new FormData();
  f.append("archivo", new Blob([buf], { type: tipo }), nombre);
  for (const [k, v] of Object.entries(campos)) f.append(k, String(v));
  return f;
}

/* ============================================================ RECORRIDO === */
const U = {
  lemJefe: "demo.lem.jefe",
  lemA1: "demo.lem.analista1",
  lemRev: "demo.lem.revisor",
  lccJefe: "demo.lcc.jefe",
  lccA1: "demo.lcc.analista1",
  lmbJefe: "demo.lmb.jefe",
  lmbA1: "demo.lmb.analista1",
  muestreo: "demo.muestreo",
  ventas: "demo.ventas",
  planif: "demo.planificacion",
  calidad: "demo.calidad",
  otroJefe: "demo.lqc.jefe",
  otroAnalista: "demo.lqc.analista1",
};

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  await paso("Laboratorios, cliente y métodos del catálogo (LEM, LCC, LMB)", async () => {
    const labs = await ok(U.planif, "GET", "/ot/laboratorios");
    for (const c of ["LEM", "LCC", "LMB", "LQC"]) {
      C[c] = labs.find((u) => u.codigo === c);
      afirmar(C[c], `${c} no figura entre los laboratorios`);
    }
    const cl = lista(await ok(U.planif, "GET", "/clientes?limit=5"));
    afirmar(cl.length >= 2, "faltan clientes");
    C.cliente = cl[0];
    C.otroCliente = cl[1];
    const conUnAnalito = async (lab) => {
      const r = await ok(U.lemJefe, "GET", `/especificaciones-tecnicas/catalogo/metodos?laboratorio=${C[lab].id}`);
      return r.metodos.filter((m) => m.analitos.length === 1);
    };
    const lem = await conUnAnalito("LEM");
    const lcc = await conUnAnalito("LCC");
    const lmb = await conUnAnalito("LMB");
    afirmar(lem.length >= 2 && lcc.length >= 4 && lmb.length >= 1, `métodos con un analito: LEM ${lem.length}, LCC ${lcc.length}, LMB ${lmb.length}`);
    [C.mTraccion, C.mDureza] = lem.filter((m) => !m.analitos[0].catalogoMin && !m.analitos[0].catalogoMax);
    // Un método con requisito en el catálogo: cambiarlo es de la jefatura (paso 9).
    C.mConCatalogo = lem.find((m) => /^[0-9.,]+$/.test(m.analitos[0].catalogoMax ?? ""));
    afirmar(C.mTraccion && C.mDureza && C.mConCatalogo, "faltan métodos del LEM con y sin requisito en el catálogo");
    [C.mPlanta, C.mCapellada, C.mHilo, C.mEtiquetado] = lcc;
    C.mRecuento = lmb[0];
    return `LEM ${C.mTraccion.codigo}, ${C.mDureza.codigo} · LCC ${lcc.length} · LMB ${C.mRecuento.codigo}`;
  });

  /* ------------------------------------------------- 1. Biblioteca de E.T. */
  const codigoEt = `ET-R2B-${sello}`;
  const puntosLem = () => [
    {
      punto: "7.1", caracteristica: "Carga de tracción", tipo: "numerico", catMetodoId: C.mTraccion.id, catAnalitoId: C.mTraccion.analitos[0].id,
      limiteInf: "550", unidad: "kgf", cond2Etiqueta: "Alargamiento", cond2Inf: 12, cond2Unidad: "mm", claseDefecto: "mayor",
    },
    { punto: "7.2", caracteristica: "Dureza", tipo: "numerico", catMetodoId: C.mDureza.id, limiteInf: "48", limiteSup: "55", unidad: "HRC", claseDefecto: "menor" },
  ];

  await paso("1 · Ventas (sin et.gestionar) no crea E.T. (403); el jefe del LQC no la crea para el LEM (403)", async () => {
    const cab = { codigo: codigoEt, nombre: "E.T. de prueba · chapa de acero", laboratorios: [C.LEM.id], clienteId: C.cliente.id, licitacion: "LIC-1867" };
    await exigir(403, U.ventas, "POST", "/especificaciones-tecnicas", cab);
    await rechazo(403, /laboratorios de su alcance/, U.otroJefe, "POST", "/especificaciones-tecnicas", cab);
    await rechazo(403, /sin laboratorio solo la gestiona/, U.lemJefe, "POST", "/especificaciones-tecnicas", { ...cab, laboratorios: [] });
  });

  await paso("1 · El jefe del LEM crea la E.T. (borrador v1) y carga sus puntos; reglas de los puntos → 400", async () => {
    const et = await ok(U.lemJefe, "POST", "/especificaciones-tecnicas", {
      codigo: codigoEt, nombre: "E.T. de prueba · chapa de acero", origen: "cliente", laboratorios: [C.LEM.id], clienteId: C.cliente.id,
      licitacion: "LIC-1867", producto: "Chapa de acero", reutilizable: false,
    });
    afirmar(et.estado === "borrador" && et.version === 1, `${et.estado} v${et.version}`);
    C.et1 = et;
    await rechazo(409, /Nueva versión/, U.lemJefe, "POST", "/especificaciones-tecnicas", { codigo: codigoEt, nombre: "Otra", laboratorios: [C.LEM.id] });
    await rechazo(400, /Mín no puede superar/, U.lemJefe, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, {
      puntos: [{ punto: "1", caracteristica: "X", tipo: "numerico", limiteInf: "10", limiteSup: "5" }],
    });
    await rechazo(400, /analito no es del método/, U.lemJefe, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, {
      puntos: [{ ...puntosLem()[0], catAnalitoId: C.mPlanta.analitos[0].id }],
    });
    await exigir(403, U.lemA1, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, { puntos: puntosLem() });
    const d = await ok(U.lemJefe, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, { puntos: puntosLem() });
    afirmar(d.puntos.length === 2 && d.erroresPublicar.length === 0, `${d.puntos.length} puntos · ${d.erroresPublicar.join(" ")}`);
    afirmar(d.puntos[0].cond2Etiqueta === "Alargamiento" && d.puntos[0].claseDefecto === "mayor", "segunda condición o clase");
    return `${codigoEt} v1 · ${d.puntos.length} puntos`;
  });

  await paso("1 · PDF de la E.T.: un archivo que no es PDF → 400; el PDF queda y lo ve Ventas", async () => {
    await rechazo(400, /no es un PDF/, U.lemJefe, "POST", `/especificaciones-tecnicas/${C.et1.id}/pdf`, formArchivo(PNG_1x1, "et.png", "image/png"));
    const d = await ok(U.lemJefe, "POST", `/especificaciones-tecnicas/${C.et1.id}/pdf`, formArchivo(PDF_MIN, "ET chapa.pdf", "application/pdf"));
    afirmar(d.pdf?.nombre === "ET chapa.pdf", "no quedó el PDF");
    const r = await fetch(`${BASE}/especificaciones-tecnicas/${C.et1.id}/pdf`, { headers: { authorization: `Bearer ${(await login(U.ventas)).token}` } });
    afirmar(r.status === 200 && r.headers.get("content-type") === "application/pdf", `PDF ${r.status}`);
    await exigir(403, U.otroAnalista, "GET", `/especificaciones-tecnicas/${C.et1.id}`);
    return `${d.pdf.bytes} bytes`;
  });

  await paso("1 · Publicar → vigente (congelada); nueva versión con motivo; al publicar la v2 la v1 queda reemplazada", async () => {
    const v1 = await ok(U.lemJefe, "POST", `/especificaciones-tecnicas/${C.et1.id}/publicar`);
    afirmar(v1.estado === "vigente" && v1.vigenteDesde, `estado ${v1.estado}`);
    await rechazo(409, /cree una nueva versión/, U.lemJefe, "PUT", `/especificaciones-tecnicas/${C.et1.id}/puntos`, { puntos: puntosLem() });
    await rechazo(400, /motivo/, U.lemJefe, "POST", `/especificaciones-tecnicas/${C.et1.id}/nueva-version`, {});
    const v2 = await ok(U.lemJefe, "POST", `/especificaciones-tecnicas/${C.et1.id}/nueva-version`, { motivo: "Revisión 2 de la E.T. del contrato" });
    afirmar(v2.version === 2 && v2.estado === "borrador" && v2.puntos.length === 2, `v${v2.version} ${v2.estado}`);
    await rechazo(409, /Ya hay un borrador/, U.lemJefe, "POST", `/especificaciones-tecnicas/${C.et1.id}/nueva-version`, { motivo: "Otra versión más" });
    const p = puntosLem();
    p[0].limiteInf = "560";
    await ok(U.lemJefe, "PUT", `/especificaciones-tecnicas/${v2.id}/puntos`, { puntos: p });
    const pub = await ok(U.lemJefe, "POST", `/especificaciones-tecnicas/${v2.id}/publicar`);
    afirmar(pub.versiones.find((x) => x.version === 1)?.estado === "reemplazada", "la v1 no quedó reemplazada");
    C.et2 = pub;
    const l = await ok(U.ventas, "GET", `/especificaciones-tecnicas?q=${codigoEt}&estado=todas`);
    afirmar(l.data.length === 2 && !l.puedeCrear, `listado ${l.data.length} · puedeCrear ${l.puedeCrear}`);
    return "v1 reemplazada · v2 vigente (Mín 560 kgf)";
  });

  /* ------------------------------------------------------ 2. OT del LEM */
  await paso("2 · OT del LEM: la v1 reemplazada no se elige (400); Ventas elige la v2; el LQC no (403)", async () => {
    C.ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.LEM.id, conCobro: false, descripcionTrabajo: `Verificación r2b ${sello}: chapa de acero, lote de 70`,
    });
    await rechazo(400, /solo se elige una versión vigente/, U.ventas, "PUT", `/especificaciones-tecnicas/ot/${C.ot.id}`, { etId: C.et1.id });
    await exigir(403, U.otroJefe, "PUT", `/especificaciones-tecnicas/ot/${C.ot.id}`, { etId: C.et2.id });
    await exigir(403, U.otroJefe, "GET", `/especificaciones-tecnicas/ot/${C.ot.id}`);
    const d = await ok(U.ventas, "PUT", `/especificaciones-tecnicas/ot/${C.ot.id}`, { etId: C.et2.id });
    afirmar(d.et?.id === C.et2.id && d.et.version === 2, "la OT no quedó con la v2");
    // No reutilizable: una OT de otro cliente no la puede elegir.
    const otra = await ok(U.planif, "POST", "/ot", { clienteId: C.otroCliente.id, unidadPrincipalId: C.LEM.id, conCobro: false, descripcionTrabajo: "Otro cliente" });
    await rechazo(400, /otro cliente y no es reutilizable/, U.ventas, "PUT", `/especificaciones-tecnicas/ot/${otra.id}`, { etId: C.et2.id });
    return `${C.ot.codigo} → ${codigoEt} v2`;
  });

  await paso("2 · Los ensayos nacen con el requisito de su punto («E.T. … · punto …»)", async () => {
    const r = await ok(U.lemA1, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [1, 2, 3].map((i) => ({ nombre: `Chapa ${i}`, metodoIds: [C.mTraccion.id, C.mDureza.id] })),
    });
    C.muestras = r.muestras;
    const res = await ok(U.lemA1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    C.res = res.resultados;
    const tr = C.res.filter((x) => x.catMetodoId === C.mTraccion.id);
    afirmar(tr.length === 3 && tr.every((x) => x.especOrigen === "et" && x.limiteInf === "560" && x.condicion2?.etiqueta === "Alargamiento"), JSON.stringify(tr[0]).slice(0, 300));
    afirmar(tr[0].especFuente === `E.T. ${codigoEt} v2 · punto 7.1` && tr[0].claseDefecto === "mayor", `${tr[0].especFuente} · ${tr[0].claseDefecto}`);
    return tr[0].especFuente;
  });

  /* ------------------------------------------------ 3. Dos condiciones */
  await paso("3 · «X kgf con Y mm»: sin el alargamiento queda pendiente; con 10 mm no cumple; corregido a 15 cumple", async () => {
    const [t1, t2, t3] = C.muestras.map((m) => C.res.find((x) => x.muestraId === m.id && x.catMetodoId === C.mTraccion.id));
    const a = await ok(U.lemA1, "POST", `/flujo/resultado/${t1.id}/valor`, { valor: "600" });
    afirmar(a.veredicto === "pendiente" && /Falta el valor de Alargamiento/.test(a.explicacion ?? ""), `${a.veredicto} · ${a.explicacion}`);
    const b = await ok(U.lemA1, "POST", `/flujo/resultado/${t1.id}/valor`, { valor: "600", valorCondicion2: "10", motivo: "Se agrega el alargamiento medido" });
    afirmar(b.veredicto === "no_cumple", b.veredicto);
    const c = await ok(U.lemA1, "POST", `/flujo/resultado/${t1.id}/valor`, { valor: "600", valorCondicion2: "15", motivo: "Corrección de lectura del extensómetro" });
    afirmar(c.veredicto === "cumple" && Number(c.valorCondicion2) === 15, c.veredicto);
    const d = await ok(U.lemA1, "POST", `/flujo/resultado/${t2.id}/valor`, { valor: "406,5", valorCondicion2: "14" });
    afirmar(d.veredicto === "no_cumple", `406,5 kgf: ${d.veredicto}`);
    await ok(U.lemA1, "POST", `/flujo/resultado/${t3.id}/valor`, { valor: "580", valorCondicion2: "13" });
    for (const m of C.muestras) {
      const h = C.res.find((x) => x.muestraId === m.id && x.catMetodoId === C.mDureza.id);
      await ok(U.lemA1, "POST", `/flujo/resultado/${h.id}/valor`, { valor: m === C.muestras[2] ? "47" : "51,8" });
    }
    C.tNc = t2;
    return "pendiente → no cumple → cumple; 406,5 kgf no cumple";
  });

  /* ------------------------------------------------ 4. Clase de la NC */
  await paso("4 · Clase de la no conformidad: el analista no la cambia (403); la jefatura sí, con motivo", async () => {
    await exigir(403, U.lemA1, "PUT", `/especificaciones-tecnicas/resultado/${C.tNc.id}/clase`, { clase: "critico", motivo: "Rotura frágil" });
    await rechazo(400, /motivo/, U.lemJefe, "PUT", `/especificaciones-tecnicas/resultado/${C.tNc.id}/clase`, { clase: "critico", motivo: "" });
    await exigir(403, U.otroJefe, "PUT", `/especificaciones-tecnicas/resultado/${C.tNc.id}/clase`, { clase: "critico", motivo: "Rotura frágil" });
    const r = await ok(U.lemJefe, "PUT", `/especificaciones-tecnicas/resultado/${C.tNc.id}/clase`, { clase: "mayor", motivo: "Confirmada como mayor" });
    afirmar(r.claseDefecto === "mayor", r.claseDefecto);
    return "mayor (confirmada por la jefatura)";
  });

  /* ------------------------------------------------ 5. Muestreo NCh 44 */
  await paso("5 · Plan NCh 44 propuesto: lote 70, nivel II → E, n = 13; AQL 4,0 → 1/2; AQL 2,5 → flecha a F (n = 20)", async () => {
    const p = await ok(U.muestreo, "GET", "/muestreo/plan?tamanoLote=70&nivel=II&aql_mayor=4&aql_menor=6.5");
    afirmar(p.letra === "E" && p.n === 13 && p.clases.mayor.ac === 1 && p.clases.mayor.re === 2 && p.clases.menor.ac === 2 && p.periodo === 5, JSON.stringify(p).slice(0, 300));
    const f = await ok(U.muestreo, "GET", "/muestreo/plan?tamanoLote=70&nivel=II&aql_mayor=2.5");
    afirmar(f.clases.mayor.letra === "F" && f.nExtraer === 20, `flecha: ${JSON.stringify(f.clases.mayor)}`);
    await rechazo(400, /no es una columna/, U.muestreo, "GET", "/muestreo/plan?tamanoLote=70&nivel=II&aql_mayor=3");
    return "E · n 13 · Ac 1 / Re 2";
  });

  const numF = `NCH44-${sello}`;
  await paso("5 · Muestreo del lote: Ventas y el LQC no lo registran (403); Sección Muestreo sí; Nº de formulario único", async () => {
    const datos = { tipoFormulario: "planilla_nch44", numeroFormulario: numF, identificacionLote: "L-0001", tamanoLote: 70, lugar: "Bodega del proveedor" };
    await exigir(403, U.ventas, "POST", `/muestreo/ot/${C.ot.id}`, datos);
    await exigir(403, U.otroAnalista, "POST", `/muestreo/ot/${C.ot.id}`, datos);
    const r = await ok(U.muestreo, "POST", `/muestreo/ot/${C.ot.id}`, datos);
    C.mu = r.muestreos.find((x) => x.numeroFormulario === numF);
    afirmar(C.mu?.estado === "borrador", "no quedó en borrador");
    await rechazo(409, /ya está registrado en la OT/, U.muestreo, "POST", `/muestreo/ot/${C.ot.id}`, datos);
    return numF;
  });

  await paso("5 · Plan del lote: cambiar n sin motivo → 400; con AQL por clase se guarda letra, n y Ac/Re", async () => {
    await rechazo(400, /indique el motivo/, U.muestreo, "PUT", `/muestreo/${C.mu.id}`, { plan: { nivel: "II", aql: { mayor: "4", menor: "6.5" }, n: 10 } });
    const r = await ok(U.muestreo, "PUT", `/muestreo/${C.mu.id}`, { plan: { nivel: "II", aql: { mayor: "4", menor: "6.5" } } });
    const mu = r.muestreos.find((x) => x.id === C.mu.id);
    afirmar(mu.plan.letra === "E" && mu.plan.n === 13 && mu.tamanoMuestra === 13 && mu.plan.clases.mayor.re === 2, JSON.stringify(mu.plan).slice(0, 200));
    return `E · n ${mu.plan.n} · mayor ${mu.plan.clases.mayor.ac}/${mu.plan.clases.mayor.re} · menor ${mu.plan.clases.menor.ac}/${mu.plan.clases.menor.re}`;
  });

  await paso("5 · Selección sistemática NCh 43 (paso 5 desde la Nº 2) y reemplazo de una unidad con motivo", async () => {
    await rechazo(400, /entre 1 y 5/, U.muestreo, "POST", `/muestreo/${C.mu.id}/seleccion`, { inicio: 9 });
    const r = await ok(U.muestreo, "POST", `/muestreo/${C.mu.id}/seleccion`, { inicio: 2 });
    const u = r.muestreos.find((x) => x.id === C.mu.id).unidades;
    afirmar(u.map((x) => x.posicion).join(",") === "2,7,12,17,22,27,32,37,42,47,52,57,62", u.map((x) => x.posicion).join(","));
    await rechazo(400, /motivo del reemplazo/, U.muestreo, "POST", `/muestreo/${C.mu.id}/unidades/${u[1].id}/reemplazo`, { identificacion: "Nº 8", motivo: "" });
    const r2 = await ok(U.muestreo, "POST", `/muestreo/${C.mu.id}/unidades/${u[1].id}/reemplazo`, { identificacion: "Nº 8", posicion: 8, motivo: "La unidad 7 venía dañada de origen" });
    const u2 = r2.muestreos.find((x) => x.id === C.mu.id).unidades;
    afirmar(u2.length === 14 && u2.find((x) => x.id === u[1].id).reemplazada, "el reemplazo no quedó");
    await rechazo(409, /ya fue reemplazada/, U.muestreo, "POST", `/muestreo/${C.mu.id}/unidades/${u[1].id}/reemplazo`, { identificacion: "Nº 9", motivo: "Otra vez la misma" });
    return "13 unidades + 1 reemplazo";
  });

  await paso("5 · «Registrar muestreo → entregar al laboratorio»: lista lo que falta; con fecha, sellos y foto queda registrado", async () => {
    await rechazo(400, /fecha y hora de la toma/, U.muestreo, "POST", `/muestreo/${C.mu.id}/registrar`);
    await ok(U.muestreo, "POST", `/muestreo/${C.mu.id}/fotos`, formArchivo(PNG_1x1, "lote.png", "image/png", { pie: "Lote sellado" }));
    await ok(U.muestreo, "PUT", `/muestreo/${C.mu.id}`, { fechaToma: new Date(Date.now() - 3600_000).toISOString(), sellos: "S-001, S-002; S-001" });
    const r = await ok(U.muestreo, "POST", `/muestreo/${C.mu.id}/registrar`);
    const mu = r.muestreos.find((x) => x.id === C.mu.id);
    afirmar(mu.estado === "registrado" && mu.sellos.join(",") === "S-001,S-002" && mu.fotos.length === 1, `${mu.estado} · ${mu.sellos}`);
    await rechazo(409, /anulándolo/, U.muestreo, "PUT", `/muestreo/${C.mu.id}`, { lugar: "Otro" });
    return "registrado (sellos S-001, S-002 · 1 foto)";
  });

  await paso("5 · El laboratorio lo recibe: el LQC no (403); no conforme exige motivo (409); recibido conforme", async () => {
    await exigir(403, U.otroAnalista, "POST", `/muestreo/${C.mu.id}/recibir`, { conforme: true });
    await exigir(403, U.ventas, "POST", `/muestreo/${C.mu.id}/recibir`, { conforme: true });
    await rechazo(409, /qué no está conforme/, U.lemA1, "POST", `/muestreo/${C.mu.id}/recibir`, { conforme: false });
    const r = await ok(U.lemA1, "POST", `/muestreo/${C.mu.id}/recibir`, { conforme: true });
    const mu = r.muestreos.find((x) => x.id === C.mu.id);
    afirmar(mu.estado === "recibido" && mu.recibidoConforme === true && mu.recibidoPorNombre, "no quedó recibido conforme");
    await ok(U.lemA1, "PUT", `/muestreo/${C.mu.id}/muestras`, { muestraIds: C.muestras.map((m) => m.id) });
    await exigir(403, U.otroJefe, "GET", `/muestreo/ot/${C.ot.id}`);
    return `recibido por ${mu.recibidoPorNombre}`;
  });

  /* ------------------------------------------------ 6. Conclusión del lote */
  await paso("6 · Conclusión del lote: 1 unidad mayor y 1 menor frente a Ac/Re (1/2 y 2/3) → acepta; el analista no concluye (403)", async () => {
    const c = await ok(U.lemA1, "GET", `/muestreo/${C.mu.id}/conclusion`);
    const det = Object.fromEntries(c.propuesta.detalle.map((d) => [d.clase, d]));
    afirmar(det.mayor.defectuosas === 1 && det.menor.defectuosas === 1 && c.propuesta.veredicto === "acepta", JSON.stringify(c.propuesta).slice(0, 300));
    await exigir(403, U.lemA1, "POST", `/muestreo/${C.mu.id}/concluir`, { conclusion: "Lote aceptado" });
    await rechazo(400, /indique el motivo/, U.lemJefe, "POST", `/muestreo/${C.mu.id}/concluir`, { conclusion: "Lote rechazado", defectuosas: { mayor: 2 } });
    const r = await ok(U.lemJefe, "POST", `/muestreo/${C.mu.id}/concluir`, { conclusion: "Lote rechazado por dos unidades con defecto mayor", defectuosas: { mayor: 2 }, motivo: "Una unidad adicional verificada en terreno" });
    afirmar(r.muestreo.veredictoLote === "rechaza", r.muestreo.veredictoLote);
    return `propuesta ${c.propuesta.veredicto} · concluido ${r.muestreo.veredictoLote} (2 mayores ≥ Re 2)`;
  });

  /* ------------------------------------------- 7. LCC: extracción y desglose */
  const codigoLcc = `ET-R2B-LCC-${sello}`;
  await paso("7 · E.T. del LCC con componentes (planta, capellada) e inspecciones del producto", async () => {
    const et = await ok(U.lccJefe, "POST", "/especificaciones-tecnicas", { codigo: codigoLcc, nombre: "Bota de servicio", laboratorios: [C.LCC.id], origen: "cliente" });
    await ok(U.lccJefe, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, {
      puntos: [
        { punto: "4.1", componente: "Planta", caracteristica: "Ensayo de planta", tipo: "numerico", catMetodoId: C.mPlanta.id, limiteInf: "1" },
        { punto: "4.2", componente: "Capellada", caracteristica: "Ensayo de capellada", tipo: "numerico", catMetodoId: C.mCapellada.id, limiteSup: "100" },
        { punto: "5.1", caracteristica: "Ensayo del producto", tipo: "numerico", catMetodoId: C.mHilo.id, limiteInf: "0" },
        { punto: "6.1", caracteristica: "Etiquetado", tipo: "inspeccion", catMetodoId: C.mEtiquetado.id, requisito: "Etiqueta legible y cosida" },
        { punto: "6.2", caracteristica: "Empaque", tipo: "inspeccion", requisito: "Par en caja individual" },
      ],
    });
    C.etLcc = await ok(U.lccJefe, "POST", `/especificaciones-tecnicas/${et.id}/publicar`);
    return `${codigoLcc} vigente`;
  });

  await paso("7 · Formulario de extracción (EP-03 0.4): sellos y registro fotográfico obligatorios", async () => {
    C.otLcc = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LCC.id, conCobro: false, descripcionTrabajo: `r2b ${sello}: botas, lote OPI` });
    await ok(U.ventas, "PUT", `/especificaciones-tecnicas/ot/${C.otLcc.id}`, { etId: C.etLcc.id });
    const r = await ok(U.muestreo, "POST", `/muestreo/ot/${C.otLcc.id}`, {
      tipoFormulario: "extraccion", numeroFormulario: `EXT-${sello}`, lugar: "Bodega del proveedor", fechaToma: new Date(Date.now() - 7200_000).toISOString(),
      producto: "Bota de servicio", proveedor: "Proveedor de prueba", tamanoLote: 500, tamanoMuestra: 6,
    });
    const mu = r.muestreos[0];
    // Ruta de la OT: el muestreo en curso va antes que la recepción.
    const a1 = await ok(U.lccJefe, "GET", `/ot/${C.otLcc.id}/avance`);
    afirmar(/Completar el muestreo Nº EXT-/.test(a1.siguiente?.texto ?? "") && a1.siguiente.accion.pestana === "muestreo", `siguiente: ${a1.siguiente?.texto}`);
    await rechazo(400, /Nº de los sellos, registro fotográfico/, U.muestreo, "POST", `/muestreo/${mu.id}/registrar`);
    await ok(U.muestreo, "PUT", `/muestreo/${mu.id}`, { sellos: ["S-L1", "S-L2"], registroFotoNumero: "RF-12" });
    await ok(U.muestreo, "POST", `/muestreo/${mu.id}/registrar`);
    const a2 = await ok(U.lccJefe, "GET", `/ot/${C.otLcc.id}/avance`);
    afirmar(/Recibir el muestreo Nº EXT-/.test(a2.siguiente?.texto ?? ""), `siguiente: ${a2.siguiente?.texto}`);
    await ok(U.lccA1, "POST", `/muestreo/${mu.id}/recibir`, { conforme: true });
    C.muLcc = mu;
    return `EXT-${sello} recibido conforme · Ruta: «${a1.siguiente.texto}» → «${a2.siguiente.texto}»`;
  });

  await paso("7 · Desglose del producto: plan de la E.T.; Ventas no lo confirma (403); el LCC crea las submuestras", async () => {
    const reg = await ok(U.lccA1, "POST", `/flujo/ot/${C.otLcc.id}/muestras`, { muestras: [{ nombre: "Par de botas talla 42", metodoIds: [C.mHilo.id], muestreoId: C.muLcc.id }] });
    C.mBota = reg.muestras[0];
    const plan = await ok(U.lccA1, "GET", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`);
    afirmar(plan.plan.componentes.length === 2 && plan.plan.inspecciones.metodoIds.length === 1 && plan.plan.sinEnsayo.length === 1, JSON.stringify(plan.plan).slice(0, 300));
    await exigir(403, U.ventas, "POST", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`, {});
    await exigir(403, U.otroAnalista, "POST", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`, {});
    const d = await ok(U.lccA1, "POST", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`, {});
    afirmar(d.creadas.submuestras.length === 2 && d.submuestras.length === 2, `submuestras ${d.creadas.submuestras.length}`);
    afirmar(d.submuestras.every((s) => s.codigo.startsWith(`${C.mBota.codigo}-C`) && s.ensayos >= 1), d.submuestras.map((s) => s.codigo).join(","));
    const otra = await ok(U.lccA1, "POST", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`, {});
    afirmar(otra.creadas.submuestras.length === 0, "el desglose se repitió");
    const res = await ok(U.lccA1, "GET", `/flujo/ot/${C.otLcc.id}/resultados`);
    const planta = res.resultados.find((r) => r.catMetodoId === C.mPlanta.id);
    afirmar(planta?.especFuente === `E.T. ${codigoLcc} v1 · punto 4.1`, `planta: ${planta?.especFuente}`);
    const etiq = res.resultados.find((r) => r.catMetodoId === C.mEtiquetado.id && r.muestraId === C.mBota.id);
    afirmar(etiq?.tipoDato === "atributo" && etiq.requisito === "Etiqueta legible y cosida", `inspección ${etiq?.tipoDato}`);
    return `${d.submuestras.map((s) => `${s.codigo} (${s.componente})`).join(" · ")} · inspección en ${C.mBota.codigo}`;
  });

  /* ------------------------------------------------ 8. LMB: plan de clases */
  await paso("8 · Plan de 3 clases del RSA (n 5, c 2, m 100, M 1000): las réplicas son las unidades", async () => {
    const et = await ok(U.calidad, "POST", "/especificaciones-tecnicas", { codigo: `RSA-R2B-${sello}`, nombre: "RSA · recuento de prueba", origen: "reglamento", laboratorios: [] });
    await ok(U.calidad, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, {
      puntos: [{ punto: "Art. 173", caracteristica: "Recuento", tipo: "clases", catMetodoId: C.mRecuento.id, planN: 5, planC: 2, planM: 100, planMM: 1000, unidad: "ufc/g" }],
    });
    await ok(U.calidad, "POST", `/especificaciones-tecnicas/${et.id}/publicar`);
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LMB.id, conCobro: false, descripcionTrabajo: `r2b ${sello}: plan de clases` });
    const reg = await ok(U.lmbA1, "POST", `/flujo/ot/${ot.id}/muestras`, { muestras: [{ nombre: "Leche en polvo", metodoIds: [C.mRecuento.id], etId: et.id }] });
    const res = await ok(U.lmbA1, "GET", `/flujo/ot/${ot.id}/resultados`);
    const r = res.resultados.find((x) => x.muestraId === reg.muestras[0].id);
    afirmar(r.planClases?.n === 5 && r.especOrigen === "et", JSON.stringify(r.planClases));
    await rechazo(400, /plan de 5 unidades/, U.lmbA1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "50" });
    const c1 = await ok(U.lmbA1, "POST", `/flujo/resultado/${r.id}/valor`, { replicasTexto: "10 150 900 20 30" });
    afirmar(c1.veredicto === "cumple", `${c1.veredicto} · ${c1.explicacion}`);
    const c2 = await ok(U.lmbA1, "POST", `/flujo/resultado/${r.id}/valor`, { replicasTexto: "10 150 900 1500 30", motivo: "Se corrige la unidad 4" });
    afirmar(c2.veredicto === "no_cumple", `${c2.veredicto} · ${c2.explicacion}`);
    return `${c1.explicacion} → ${c2.explicacion}`;
  });

  /* --------------------------------- 9. Aplicar la E.T. a una OT ya registrada */
  await paso("9 · «Aplicar requisitos de la E.T. → veredicto»: el analista omite lo del catálogo; la jefatura lo aplica", async () => {
    // E.T. v3 con un punto sobre el método que trae requisito en el catálogo.
    const v3 = await ok(U.lemJefe, "POST", `/especificaciones-tecnicas/${C.et2.id}/nueva-version`, { motivo: "Se agrega el ensayo del catálogo" });
    await ok(U.lemJefe, "PUT", `/especificaciones-tecnicas/${v3.id}/puntos`, {
      puntos: [...puntosLem(), { punto: "7.3", caracteristica: "Ensayo con requisito del catálogo", tipo: "numerico", catMetodoId: C.mConCatalogo.id, limiteSup: "9000" }],
    });
    C.et3 = await ok(U.lemJefe, "POST", `/especificaciones-tecnicas/${v3.id}/publicar`);
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LEM.id, conCobro: false, descripcionTrabajo: `r2b ${sello}: aplicar E.T.` });
    await ok(U.lemA1, "POST", `/flujo/ot/${ot.id}/muestras`, { muestras: [{ nombre: "Chapa sin E.T.", metodoIds: [C.mTraccion.id, C.mDureza.id, C.mConCatalogo.id] }] });
    await rechazo(409, /tienen una E\.T\. elegida/, U.lemA1, "POST", `/especificaciones-tecnicas/ot/${ot.id}/aplicar`);
    // La dureza ya tiene valor con el requisito del catálogo; la E.T. lo cambia y se recalcula el veredicto.
    const antes = await ok(U.lemA1, "GET", `/flujo/ot/${ot.id}/resultados`);
    const dureza = antes.resultados.find((x) => x.catMetodoId === C.mDureza.id);
    await ok(U.lemA1, "POST", `/flujo/resultado/${dureza.id}/valor`, { valor: "47" });
    await ok(U.ventas, "PUT", `/especificaciones-tecnicas/ot/${ot.id}`, { etId: C.et3.id });
    await exigir(403, U.ventas, "POST", `/especificaciones-tecnicas/ot/${ot.id}/aplicar`);
    const a = await ok(U.lemA1, "POST", `/especificaciones-tecnicas/ot/${ot.id}/aplicar`);
    afirmar(a.aplicados === 2 && a.omitidos.length === 1 && /jefatura/.test(a.omitidos[0].motivo), `analista ${a.aplicados} · ${JSON.stringify(a.omitidos)}`);
    const j = await ok(U.lemJefe, "POST", `/especificaciones-tecnicas/ot/${ot.id}/aplicar`);
    afirmar(j.aplicados === 1 && j.omitidos.length === 0, `jefatura ${j.aplicados}`);
    const despues = await ok(U.lemA1, "GET", `/flujo/ot/${ot.id}/resultados`);
    const d2 = despues.resultados.find((x) => x.id === dureza.id);
    afirmar(d2.especOrigen === "et" && d2.limiteInf === "48" && d2.veredicto === "no_cumple", `dureza ${d2.especOrigen} ${d2.limiteInf} ${d2.veredicto}`);
    const cat = despues.resultados.find((x) => x.catMetodoId === C.mConCatalogo.id);
    afirmar(cat.limiteSup === "9000" && cat.especCatalogo?.limiteSup === C.mConCatalogo.analitos[0].catalogoMax, `catálogo ${cat.limiteSup} / ${cat.especCatalogo?.limiteSup}`);
    return `analista: 2 aplicados, 1 omitido (jefatura) · jefatura: 1 aplicado · 47 HRC frente a 48–55 → no cumple`;
  });

  /* ------------------------------------------------ 10. Parámetros */
  await paso("10 · Parámetros de la operación: plan del muestreo y regla del lote, editables con motivo (Calidad); el jefe del LEM no (403)", async () => {
    const p = await ok(U.calidad, "GET", "/parametros/configurables");
    const cats = p.grupos.map((g) => g.categoria);
    afirmar(cats.includes("muestreo_plan") && cats.includes("veredicto_lote"), cats.join(","));
    await exigir(403, U.lemJefe, "PUT", "/parametros/configurables/veredicto_lote/regla_sin_plan", { valor: "critica_o_mayor", motivo: "Prueba de alcance" });
    await ok(U.calidad, "PUT", "/parametros/configurables/muestreo_plan/nivel", { valor: "III", motivo: "Prueba del recorrido r2b" });
    const d = await ok(U.muestreo, "GET", `/muestreo/ot/${C.ot.id}`);
    afirmar(d.porDefecto.nivel === "III", `nivel ${d.porDefecto.nivel}`);
    await ok(U.calidad, "PUT", "/parametros/configurables/muestreo_plan/nivel", { valor: "II", motivo: "Vuelve al valor por defecto" });
    return "nivel II → III → II";
  });

  console.log(`\n${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
}

main()
  .then(() => { pararApi(); process.exit(0); })
  .catch((e) => {
    console.error(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
