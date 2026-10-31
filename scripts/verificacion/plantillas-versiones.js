#!/usr/bin/env node
/**
 * Verificación contra una API real del frente plantillas + QC microbiológico
 * (packages/db/align_plantilla_versiones.sql y align_qc_microbiologico.sql):
 *   · A: repositorio de plantillas con versiones: borrador que no pisa la
 *     vigente, variables del motor, vista previa HTML/PDF con una OT real,
 *     aprobación por otra persona (plantilla.aprobar), historial, comparar,
 *     volver a una versión anterior, duplicar y versión guardada en el documento;
 *   · B: QC microbiológico (EP-02 ALI-D6): positivo (+), negativo y blanco (−),
 *     lote del medio, cepa ATCC de catálogo, bloqueo de la emisión.
 *
 * Uso:
 *   node scripts/verificacion/plantillas-versiones.js [--arrancar] [--base http://localhost:3921/api]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA).
 * Deja una OT de LMB, un documento, versiones nuevas de PG09A2-ALI (la última
 * vuelve al contenido original) y una plantilla duplicada: úsese en una base de pruebas.
 */
"use strict";
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4321/api");
const ARRANCAR = args.includes("--arrancar");
const SALIDA = arg("--salida", null);

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
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id };
  return sesiones[username];
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const tipo = r.headers.get("content-type") ?? "";
  if (tipo.includes("application/pdf")) return { status: r.status, json: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
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
function afirmar(cond, texto) {
  if (!cond) throw new Error(texto);
}
function guardar(nombre, contenido) {
  if (!SALIDA) return null;
  fs.mkdirSync(SALIDA, { recursive: true });
  const f = path.join(SALIDA, nombre);
  fs.writeFileSync(f, contenido);
  return f;
}

/* ------------------------------------------------------------ arranque --- */
let hijo = null;
function arrancarApi() {
  if (!process.env.DATABASE_URL) throw new Error("--arrancar necesita DATABASE_URL");
  const puerto = new URL(BASE).port || "3921";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(os.tmpdir(), "lims-plantillas-versiones-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };
async function esperarApi(ms = 120000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (hijo && hijo.exitCode !== null) throw new Error("La API se detuvo al arrancar");
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status < 500) return;
    } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`La API no respondió en ${BASE}`);
}

const U = {
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  jefe: "demo.lmb.jefe",
  a1: "demo.lmb.analista1",
  rev: "demo.lmb.revisor",
  otroLab: "demo.lqa.analista1",
  admin: "demo.admin",
  calidad: "demo.calidad",
  director: "demo.director",
};

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const MARCA = `NOTA-VERSION-PRUEBA-${sello}`;

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    const cal = await login(U.calidad);
    return `${Object.keys(sesiones).length} perfiles`;
  });

  await paso("Catálogo: LMB, método 1139, plantilla PG09A2-ALI con su v1 VIGENTE migrada", async () => {
    C.lmb = (await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LMB");
    afirmar(C.lmb, "LMB no figura");
    C.m = lista(await ok(U.jefe, "GET", "/cat/metodos?search=1139&limit=50")).find((x) => x.codigo === "1139");
    afirmar(C.m, "método 1139 no encontrado");
    C.ie = lista(await ok(U.jefe, "GET", "/plantillas?search=PG09A2-ALI&limit=50")).find((p) => p.repid === "PG09A2-ALI");
    afirmar(C.ie, "falta PG09A2-ALI");
    const h = await ok(U.calidad, "GET", `/informes/plantillas/${C.ie.id}/versiones`);
    afirmar(h.vigente && h.vigente.estado === "VIGENTE", "sin vigente");
    afirmar(!h.borrador, "ya hay un borrador (base no limpia)");
    C.v0 = h.vigente;
    const cl = lista(await ok(U.admin, "GET", "/clientes?limit=5"));
    C.clienteId = cl[0].id;
    return `vigente v${C.v0.numero} (${C.v0.origen})`;
  });

  await paso("OT de LMB con una muestra y el ensayo 1139 capturado, revisado y aprobado", async () => {
    C.ot = await ok(U.planif, "POST", "/ot", { clienteId: C.clienteId, unidadPrincipalId: C.lmb.id, conCobro: false, descripcionTrabajo: `OT-PRUEBA plantillas ${sello}` });
    const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const toma = (reg.opcionesToma ?? []).find((o) => o.codigo === "seccion_muestreo") ?? reg.opcionesToma?.[0];
    await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [{ nombre: `Muestra prueba ${sello}`, metodoIds: [C.m.id], recepcion: { tomaMuestra: toma.codigo, condicionRecepcion: "cumple", identificacionCliente: "Prueba", temperaturaRecepcion: 4 } }],
    });
    const r = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados.find((x) => x.catMetodoId === C.m.id);
    await ok(U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "40" });
    await ok(U.rev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    await ok(U.jefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    return C.ot.codigo;
  });

  /* ------------------------------------------------ FRENTE B · QC microbiológico */
  await paso("B · Cepas ATCC: 7 sembradas; el analista no administra (403); Calidad agrega y desactiva", async () => {
    const cs = await ok(U.a1, "GET", "/qc/cepas");
    afirmar(cs.length >= 7 && cs.some((c) => c.codigo === "ATCC 25922"), `cepas ${cs.length}`);
    C.cepa = cs.find((c) => c.codigo === "ATCC 25922");
    await exigir(403, U.a1, "POST", "/qc/cepas", { codigo: `ATCC P${sello.slice(-5)}`, organismo: "Prueba" });
    const n = await ok(U.calidad, "POST", "/qc/cepas", { codigo: `ATCC P${sello.slice(-5)}`, organismo: "Organismo de prueba", numero: 99 });
    const d = await ok(U.calidad, "PUT", `/qc/cepas/${n.id}`, { codigo: n.codigo, organismo: n.organismo, numero: 99, activo: false });
    afirmar(d.activo === false, "no se desactivó");
    afirmar(!(await ok(U.a1, "GET", "/qc/cepas")).some((c) => c.id === n.id), "la inactiva se sigue ofreciendo");
    return `${cs.length} cepas activas`;
  });

  await paso("B · El método 1139 exige positivo, negativo y blanco: la emisión queda bloqueada", async () => {
    C.qcOrig = await ok(U.calidad, "GET", `/qc/metodos/${C.m.id}`);
    await ok(U.calidad, "PUT", `/qc/metodos/${C.m.id}`, { qcRequerido: true, qcTipos: ["positivo", "negativo", "blanco"], qcCriterios: { positivo: "+", negativo: "-" } });
    const c = await ok(U.jefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: C.ie.id });
    const txt = JSON.stringify(c);
    afirmar(/control de calidad pendiente/.test(txt) && /positivo/.test(txt), `condiciones sin bloqueo de QC: ${txt.slice(0, 300)}`);
    await exigir(409, U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.ie.id });
  });

  await paso("B · Registro: positivo sin cepa ni lote → 400; positivo (−) → rechazado", async () => {
    const e = await exigir(400, U.a1, "POST", `/qc/ot/${C.ot.id}/control`, { catMetodoId: C.m.id, tipo: "positivo", resultadoCualitativo: "+" });
    afirmar(/lote del medio/.test(msg(e)) && /cepa/.test(msg(e)), msg(e));
    const r = await ok(U.a1, "POST", `/qc/ot/${C.ot.id}/control`, { catMetodoId: C.m.id, tipo: "positivo", resultadoCualitativo: "-", loteMedio: `L-${sello}`, cepaId: C.cepa.id });
    afirmar(r.resultado === "rechazado", `positivo (−) quedó ${r.resultado}`);
    await ok(U.a1, "DELETE", `/qc/control/${r.id}`);
  });

  await paso("B · Positivo (+) con cepa, negativo (−) y blanco (−): quien registra no aprueba; el revisor sí", async () => {
    const ids = [];
    for (const [tipo, cual] of [["positivo", "+"], ["negativo", "-"], ["blanco", "-"]]) {
      const r = await ok(U.a1, "POST", `/qc/ot/${C.ot.id}/control`, { catMetodoId: C.m.id, tipo, resultadoCualitativo: cual, loteMedio: `L-${sello}`, ...(tipo === "positivo" ? { cepaId: C.cepa.id } : {}) });
      afirmar(r.resultado === "pendiente" && r.evaluacion === "aprobado", `${tipo}: ${r.resultado}/${r.evaluacion}`);
      ids.push(r.id);
    }
    await exigir([403, 409], U.a1, "PATCH", `/qc/control/${ids[0]}`, { resultado: "aprobado" });
    for (const id of ids) await ok(U.rev, "PATCH", `/qc/control/${id}`, { resultado: "aprobado" });
    const est = await ok(U.jefe, "GET", `/qc/ot/${C.ot.id}`);
    afirmar(est.estado.aprobado, `QC no aprobado: ${JSON.stringify(est.estado)}`);
    const pos = est.controles.find((c) => c.tipo === "positivo");
    afirmar(pos.cepaCodigo === "ATCC 25922" && pos.loteMedio === `L-${sello}` && pos.resultadoCualitativo === "+", JSON.stringify(pos).slice(0, 200));
    const c = await ok(U.jefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: C.ie.id });
    afirmar(!/control de calidad pendiente/.test(JSON.stringify(c)), "sigue bloqueado por QC");
    return "QC aprobado · emisión desbloqueada";
  });

  /* ------------------------------------------------ FRENTE A · versiones */
  await paso("A · Variables del motor con la OT (ot.codigo, tabla_resultados) y sin OT (bloques)", async () => {
    const s = await ok(U.calidad, "GET", `/informes/plantillas/${C.ie.id}/variables`);
    afirmar(!s.conOt && s.bloques.some((b) => b.clave === "tabla_resultados"), "sin bloques");
    const v = await ok(U.calidad, "GET", `/informes/plantillas/${C.ie.id}/variables?otId=${C.ot.id}`);
    afirmar(v.conOt && v.datos.includes("ot.codigo") && v.datos.includes("plantilla.numero_version"), `datos ${v.datos.slice(0, 20)}`);
    return `${v.datos.length} variables · ${v.bloques.length} bloques`;
  });

  await paso("A · Borrador: el analista no redacta (403); Administración redacta sin tocar la vigente", async () => {
    const vig = await ok(U.calidad, "GET", `/informes/plantillas/versiones/${C.v0.id}`);
    C.cuerpo0 = vig.cuerpoHtml ?? "";
    await exigir(403, U.a1, "POST", `/informes/plantillas/${C.ie.id}/borrador`, { cuerpoHtml: "x" });
    const b = await ok(U.admin, "POST", `/informes/plantillas/${C.ie.id}/borrador`, { cuerpoHtml: `${C.cuerpo0}\n<p>${MARCA}</p>`, motivo: "Prueba de versionado" });
    afirmar(b.estado === "BORRADOR" && b.numero === C.v0.numero + 1, `borrador ${b.estado} v${b.numero}`);
    C.b1 = b;
    const p = await ok(U.jefe, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: C.ie.id });
    afirmar(!p.html.includes(MARCA), "la vista previa normal ya usa el borrador");
    return `borrador v${b.numero}`;
  });

  await paso("A · Vista previa del borrador con la OT: HTML con el cambio y PDF", async () => {
    const h = await ok(U.admin, "POST", `/informes/plantillas/versiones/${C.b1.id}/previsualizar`, { otId: C.ot.id });
    afirmar(h.html.includes(MARCA) && h.html.includes(C.ot.codigo), "la vista previa del borrador no trae el cambio");
    const pdf = await ok(U.admin, "POST", `/informes/plantillas/versiones/${C.b1.id}/previsualizar`, { otId: C.ot.id, formato: "pdf" });
    afirmar(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === "%PDF-", "sin PDF");
    await exigir(403, U.otroLab, "POST", `/informes/plantillas/versiones/${C.b1.id}/previsualizar`, { otId: C.ot.id });
    return `PDF ${pdf.length} bytes`;
  });

  await paso("A · Aprobar: Administración no tiene permiso (403); Calidad aprueba; la anterior queda RETIRADA", async () => {
    await exigir(403, U.admin, "POST", `/informes/plantillas/versiones/${C.b1.id}/aprobar`, {});
    const a = await ok(U.calidad, "POST", `/informes/plantillas/versiones/${C.b1.id}/aprobar`, {});
    afirmar(a.estado === "VIGENTE", `estado ${a.estado}`);
    const h = await ok(U.calidad, "GET", `/informes/plantillas/${C.ie.id}/versiones`);
    afirmar(h.vigente.id === C.b1.id && h.versiones.find((v) => v.id === C.v0.id).estado === "RETIRADA", "la anterior no quedó retirada");
    const p = await ok(U.jefe, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: C.ie.id });
    afirmar(p.html.includes(MARCA), "el render no usa la nueva vigente");
    return `v${a.numero} vigente`;
  });

  await paso("A · Quien redacta no aprueba su propio borrador (403), aunque tenga plantilla.aprobar", async () => {
    const b = await ok(U.calidad, "POST", `/informes/plantillas/${C.ie.id}/borrador`, { motivo: "Prueba de segregación" });
    const e = await exigir(403, U.calidad, "POST", `/informes/plantillas/versiones/${b.id}/aprobar`, {});
    afirmar(/no puede aprobarlo/.test(msg(e)), msg(e));
    await ok(U.calidad, "DELETE", `/informes/plantillas/versiones/${b.id}`);
  });

  await paso("A · Formato: guardarlo crea un borrador pendiente; la vigente no cambia", async () => {
    const f = await ok(U.calidad, "GET", `/informes/plantillas/${C.ie.id}/formato`);
    const g = await ok(U.calidad, "PUT", `/informes/plantillas/${C.ie.id}/formato`, { formato: { ...(f.guardado ?? {}), referencias: !f.efectivo.referencias } });
    afirmar(g.pendienteAprobacion && g.borrador, "no quedó en borrador");
    const f2 = await ok(U.calidad, "GET", `/informes/plantillas/${C.ie.id}/formato`);
    afirmar(f2.efectivo.referencias === f.efectivo.referencias, "la vigente cambió sin aprobar");
    await ok(U.calidad, "DELETE", `/informes/plantillas/versiones/${g.borrador.id}`);
  });

  await paso("A · Emisión: el documento guarda la versión vigente con que se emitió", async () => {
    const r = await ok(U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.ie.id });
    const circ = await ok(U.jefe, "GET", `/informes/${r.certificado.id}/circuito`);
    afirmar(circ.plantillaVersion?.numero === C.b1.numero, `versión del documento ${JSON.stringify(circ.plantillaVersion)}`);
    const l = await ok(U.jefe, "GET", `/informes/documentos?otId=${C.ot.id}`);
    const d = lista(l).find((x) => x.id === r.certificado.id);
    afirmar(d && d.plantillaVersion === C.b1.numero, `listado ${JSON.stringify(d?.plantillaVersion)}`);
    return `${r.numero} · plantilla v${circ.plantillaVersion.numero}`;
  });

  await paso("A · Comparar v anterior con la nueva y volver a la anterior (borrador copia, aprobado por Dirección)", async () => {
    const c = await ok(U.calidad, "GET", `/informes/plantillas/versiones/${C.b1.id}/comparar/${C.v0.id}`);
    afirmar(c.cuerpo.some((l) => l.tipo === "agregada" && l.texto.includes(MARCA)), "el diff no muestra el cambio");
    const r = await ok(U.admin, "POST", `/informes/plantillas/versiones/${C.v0.id}/restaurar`, {});
    afirmar(r.estado === "BORRADOR" && r.origen === "restaurada", `restaurada ${r.estado}`);
    await exigir(409, U.admin, "POST", `/informes/plantillas/versiones/${C.v0.id}/restaurar`, {});
    const a = await ok(U.director, "POST", `/informes/plantillas/versiones/${r.id}/aprobar`, {});
    const v = await ok(U.calidad, "GET", `/informes/plantillas/versiones/${a.id}`);
    afirmar((v.cuerpoHtml ?? "") === C.cuerpo0, "el cuerpo restaurado no es el de la versión anterior");
    return `v${a.numero} vigente = v${C.v0.numero}`;
  });

  await paso("A · Duplicar la plantilla: v1 en borrador, sin vigente hasta aprobar; REPID repetido → 409", async () => {
    const d = await ok(U.admin, "POST", `/informes/plantillas/${C.ie.id}/duplicar`, { repid: `PRB-${sello.slice(-6)}`, nombre: `Copia de prueba ${sello}` });
    afirmar(d.vigente === null && d.borrador?.numero === 1 && d.borrador.origen === "duplicada", JSON.stringify(d).slice(0, 200));
    await exigir(409, U.admin, "POST", `/informes/plantillas/${C.ie.id}/duplicar`, { repid: `PRB-${sello.slice(-6)}`, nombre: `Copia de prueba ${sello}` });
    return d.plantilla.repid;
  });

  await paso("Se restaura la configuración de QC del método 1139", async () => {
    await ok(U.calidad, "PUT", `/qc/metodos/${C.m.id}`, { qcRequerido: !!C.qcOrig.qcRequerido, qcTipos: C.qcOrig.qcTipos ?? [], qcCriterios: C.qcOrig.qcCriterios ?? {} });
  });
}

main()
  .then(() => {
    console.log(`\nFrente plantillas + QC microbiológico: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
