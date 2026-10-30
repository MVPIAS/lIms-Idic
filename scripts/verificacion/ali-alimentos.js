#!/usr/bin/env node
/**
 * Verificación contra una API real del frente ALI · tanda 1 (EP-02, revisión
 * 29-10-2026; packages/db/align_ali_alimentos.sql):
 *   · ALI-D1 recepción con temperatura de llegada, toma y formulario de muestreo;
 *   · ALI-D2 documento de respaldo de la OT y norma de cada ensayo pedido;
 *   · ALI-D7 Informe de Ensayos Alimentos (IDIC-PG09 Anexo 02-02 rev05): solo
 *     resultados, antecedentes de muestreo y recepción, firmas Jefe de
 *     Laboratorio y «Por orden del Director del IDIC» Jefe DQO;
 *   · ALI-D8 Reporte I.V.C. de Alimentos (IBC01) con Mín. / Máx. / Otros y Cumple.
 *
 * Uso:
 *   node scripts/verificacion/ali-alimentos.js [--arrancar] [--base http://localhost:4321/api] [--salida <carpeta>]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA de
 * auth.service.ts). Deja en la base una OT de LMB con su muestra y dos
 * documentos: úsese en una base de pruebas. Con --salida guarda el HTML de las
 * vistas previas y los PDF emitidos.
 */
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
  const log = fs.createWriteStream(path.join(os.tmpdir(), "lims-ali-alimentos-api.log"));
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

/** «aaaa-mm-ddTHH:MM» en hora de Chile, `horas` antes de ahora. */
function inputChile(horasAntes = 0) {
  const d = new Date(Date.now() - horasAntes * 3600e3);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const U = {
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  jefe: "demo.lmb.jefe",
  a1: "demo.lmb.analista1",
  rev: "demo.lmb.revisor",
  otroLab: "demo.lqa.analista1",
  admin: "demo.admin",
  dqo: "demo.dqo.jefe",
};
const FIRMANTES = ["demo.lmb.jefe", "demo.lmb.revisor", "demo.sal.jefe", "demo.dqo.jefe", "demo.director", "demo.calidad"];

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of [...Object.values(U), ...FIRMANTES]) await login(u).catch((e) => { if (Object.values(U).includes(u)) throw e; });
    return `${Object.keys(sesiones).length} perfiles`;
  });

  await paso("Catálogo: LMB, métodos de recuento y Salmonella, plantillas PG09A2-ALI e IBC01", async () => {
    C.lmb = (await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LMB");
    afirmar(C.lmb, "LMB no figura entre los laboratorios");
    const buscar = async (codigo) => {
      const m = lista(await ok(U.jefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
      afirmar(m, `método ${codigo} no encontrado`);
      return m;
    };
    C.mAerobios = await buscar("1139");
    C.mSalmonella = await buscar("429");
    const plantillas = async (q) => lista(await ok(U.jefe, "GET", `/plantillas?search=${encodeURIComponent(q)}&limit=50`));
    C.ie = (await plantillas("PG09A2-ALI")).find((p) => p.repid === "PG09A2-ALI");
    C.ivc = (await plantillas("IBC01")).find((p) => p.repid === "IBC01" && p.nombre === "Planilla respaldo I.V.C.");
    afirmar(C.ie, "falta la plantilla PG09A2-ALI (align_ali_alimentos.sql)");
    afirmar(C.ivc, "falta la plantilla IBC01 «Planilla respaldo I.V.C.»");
    const cl = lista(await ok(U.admin, "GET", "/clientes?limit=5"));
    afirmar(cl.length, "no hay clientes");
    C.clienteId = cl[0].id;
    return `${C.mAerobios.codigo} (norma ${C.mAerobios.norma ?? "—"}) · ${C.mSalmonella.codigo} (norma ${C.mSalmonella.norma ?? "—"})`;
  });

  await paso("Planificación crea una OT de LMB (Unidad Prueba)", async () => {
    C.ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.clienteId, unidadPrincipalId: C.lmb.id, conCobro: false,
      descripcionTrabajo: `OT-PRUEBA Alimentos ${sello}: análisis microbiológico de un plato preparado`,
    });
    return C.ot.codigo;
  });

  /* ------------------------------------------------ ALI-D2 */
  await paso("ALI-D2 · Documento de respaldo: Nº sin tipo → 400; completo se guarda y se lee", async () => {
    await exigir(400, U.planif, "PUT", `/ot/${C.ot.id}/encargo`, { docRespaldoNumero: "952" });
    const v = await ok(U.planif, "PUT", `/ot/${C.ot.id}/encargo`, {
      docRespaldoTipo: "Orden de compra", docRespaldoNumero: `OC-PRUEBA-${sello}`, docRespaldoFecha: "2026-03-23",
      lugarMuestreo: "Unidad Prueba, casino", fechaMuestreo: "2026-09-07",
    });
    const e = v.encargo;
    afirmar(e.docRespaldoTipo === "Orden de compra" && e.docRespaldoNumero === `OC-PRUEBA-${sello}` && e.docRespaldoFecha === "2026-03-23", `encargo ${JSON.stringify(e).slice(0, 200)}`);
    afirmar(e.lugarMuestreo === "Unidad Prueba, casino" && e.fechaMuestreo === "2026-09-07", "la toma de muestra programada no se guardó");
    await exigir(403, U.otroLab, "PUT", `/ot/${C.ot.id}/encargo`, { docRespaldoTipo: "Oficio" });
    return `${e.docRespaldoTipo} ${e.docRespaldoNumero} · ${e.docRespaldoFecha}`;
  });

  /* ------------------------------------------------ ALI-D1 */
  const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
  const toma = (reg.opcionesToma ?? []).find((o) => o.codigo === "seccion_muestreo") ?? reg.opcionesToma?.[0];
  const recepcion = (extra) => ({ tomaMuestra: toma.codigo, condicionRecepcion: "cumple", identificacionCliente: "Ensalada de prueba", ...extra });
  const muestra = (extra) => ({ muestras: [{ nombre: `Plato preparado de prueba ${sello}`, metodoIds: [C.mAerobios.id, C.mSalmonella.id], recepcion: recepcion(extra) }] });

  await paso("ALI-D1 · Recepción: temperatura fuera de rango y toma futura → 400", async () => {
    const a = await exigir(400, U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, muestra({ temperaturaRecepcion: 85 }));
    afirmar(/temperatura de recepción/.test(msg(a)), msg(a));
    const b = await exigir(400, U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, muestra({ fechaTomaMuestra: inputChile(-3) }));
    afirmar(/posterior a la recepción/.test(msg(b)), msg(b));
  });
  await paso("ALI-D1 · Recepción con 3,8 °C, toma y formulario de muestreo; se leen de vuelta", async () => {
    C.toma = inputChile(2);
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, muestra({ temperaturaRecepcion: 3.8, fechaTomaMuestra: C.toma, formularioMuestreo: `FORM-PRUEBA-${sello}` }));
    C.muestra = r.muestras[0];
    const p = await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const m = p.muestras.find((x) => x.id === C.muestra.id);
    afirmar(m && m.temperaturaRecepcion === 3.8, `temperatura ${m?.temperaturaRecepcion}`);
    afirmar(m.formularioMuestreo === `FORM-PRUEBA-${sello}`, `formulario ${m.formularioMuestreo}`);
    afirmar(m.fechaTomaMuestra, "sin fecha de toma");
    // ALI-D2: norma de cada ensayo pedido (del método del catálogo; «null» si no tiene).
    const n = Object.fromEntries((m.metodosNorma ?? []).map((x) => [x.codigo, x.norma]));
    afirmar("1139" in n && "429" in n, `metodosNorma ${JSON.stringify(m.metodosNorma)}`);
    afirmar(n["429"] === (C.mSalmonella.norma ?? null) && n["1139"] === (C.mAerobios.norma || null), `normas ${JSON.stringify(n)}`);
    return `${m.codigo} · ${m.temperaturaRecepcion} °C · normas ${JSON.stringify(n)}`;
  });
  await paso("ALI-D1 · Corregir la recepción: otro laboratorio no puede (403); la corrección conserva la toma", async () => {
    const cuerpo = recepcion({ temperaturaRecepcion: 3.8, fechaTomaMuestra: C.toma, formularioMuestreo: `FORM-PRUEBA-${sello}` });
    await exigir(403, U.otroLab, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    // La toma es anterior a la recepción original: la corrección la acepta.
    const u = await ok(U.recepcion, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    afirmar(Number(u.temperaturaRecepcion) === 3.8, `temperatura ${u.temperaturaRecepcion}`);
  });

  /* ------------------------------------------------ Captura y aprobación */
  await paso("El analista de LMB captura: aerobios 40 ufc/g (Máx. 100000) y Salmonella «Ausencia» (P/A)", async () => {
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.rA = rs.find((x) => x.catMetodoId === C.mAerobios.id);
    C.rS = rs.find((x) => x.catMetodoId === C.mSalmonella.id);
    afirmar(C.rA && C.rS, "faltan ensayos en la OT");
    // Lo que el catálogo ya trae lo cambia la jefatura; el analista completa lo vacío.
    await ok(U.a1, "PATCH", `/flujo/resultado/${C.rA.id}/especificacion`, { limiteSup: "100000" }).catch(async () =>
      ok(U.jefe, "PATCH", `/flujo/resultado/${C.rA.id}/especificacion`, { limiteSup: "100000", motivo: "Límite del RSA para plato preparado (prueba)" }),
    );
    await ok(U.a1, "POST", `/flujo/resultado/${C.rA.id}/valor`, { valor: "40" });
    await ok(U.a1, "PATCH", `/flujo/resultado/${C.rS.id}/especificacion`, { requisito: "Ausencia en 25 g", tipoDato: "atributo" }).catch(async () =>
      ok(U.jefe, "PATCH", `/flujo/resultado/${C.rS.id}/especificacion`, { requisito: "Ausencia en 25 g", tipoDato: "atributo", motivo: "Salmonella se informa presencia o ausencia (prueba)" }),
    );
    await ok(U.a1, "POST", `/flujo/resultado/${C.rS.id}/valor`, { atributo: "cumple", valor: "Ausencia" });
  });
  await paso("Revisión y aprobación de la OT de LMB", async () => {
    await ok(U.rev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    await ok(U.jefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
  });

  /* ------------------------------------------------ ALI-D7 */
  await paso("ALI-D7 · Propuesta del Informe de Ensayos Alimentos: solo resultados aunque haya requisitos", async () => {
    const p = await ok(U.jefe, "POST", "/informes/propuesta", { otId: C.ot.id, plantillaId: C.ie.id });
    afirmar(p.modalidad === "solo_resultados", `modalidad ${p.modalidad}`);
    afirmar(p.conRequisito === 2, `${p.conRequisito} con requisito`);
    await exigir(403, U.otroLab, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: C.ie.id });
    return `${p.conRequisito} de ${p.totalEnsayos} con requisito`;
  });
  await paso("ALI-D7 · Vista previa: antecedentes de muestreo y recepción, 3,8 °C, formulario, normas y firmas", async () => {
    const p = await ok(U.jefe, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: C.ie.id });
    const h = p.html;
    guardar("informe-ensayos-alimentos-vista-previa.html", h);
    const tomaTxt = `${C.toma.slice(8, 10)}-${C.toma.slice(5, 7)}-${C.toma.slice(0, 4)} ${C.toma.slice(11, 16)}`;
    for (const t of ["IDIC-PG09-Anexo02-02", "1. Antecedentes", "Fecha y hora de muestreo", tomaTxt, "Temperatura de recepción", "3,8 °C",
      `FORM-PRUEBA-${sello}`, "3.1. Normas y métodos", "4. Resultados", "<td>40</td>", "Ausencia", "6. Notas aclaratorias", "Por orden del Director del IDIC"])
      afirmar(h.includes(t), `falta «${t}» en el informe`);
    afirmar(!h.includes("Cumple</td>") && !/<th>Veredicto<\/th>|<th>Condición<\/th>/.test(h), "el informe de solo resultados trae veredicto");
    afirmar(!/\{\{/.test(h), "quedan placeholders sin resolver");
    return `${(h.match(/<tr>/g) ?? []).length} filas · muestreo ${tomaTxt}`;
  });
  await paso("ALI-D7 · Emisión: circuito Jefe de Laboratorio → … → Jefe DQO (oficializa) y PDF", async () => {
    const r = await ok(U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.ie.id });
    C.docIe = r.certificado.id;
    afirmar(r.modalidad === "solo_resultados", `modalidad ${r.modalidad}`);
    const circ = await ok(U.jefe, "GET", `/informes/${C.docIe}/circuito`);
    afirmar(circ.pasos.some((p) => p.accion === "OFICIALIZA"), "falta la oficialización del Jefe DQO");
    const porId = {};
    for (const u of FIRMANTES) if (sesiones[u]) porId[sesiones[u].id] = u;
    const firmantes = [];
    for (const orden of [...new Set(circ.pasos.map((p) => p.orden))].sort((a, b) => a - b)) {
      for (const p of circ.pasos.filter((x) => x.orden === orden)) {
        const cand = (p.responsables ?? []).map((x) => porId[x.usuarioId]).filter(Boolean);
        const quien = cand.find((u) => !firmantes.includes(u)) ?? cand[0];
        afirmar(quien, `paso ${orden} (${p.accion} ${p.rolCodigo ?? ""}): sin responsable entre los perfiles de prueba`);
        await ok(quien, "POST", `/informes/${C.docIe}/firmar`, {});
        firmantes.push(quien);
      }
    }
    const fin = await ok(U.jefe, "GET", `/informes/${C.docIe}/circuito`);
    afirmar(fin.estado === "oficial", `estado ${fin.estado}`);
    const pdf = await ok(U.jefe, "GET", `/informes/${C.docIe}/pdf`);
    afirmar(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === "%PDF-", "el PDF no se generó");
    const f = guardar("informe-ensayos-alimentos.pdf", pdf);
    return `${r.numero} oficial · ${circ.pasos.map((p) => `${p.accion}:${p.rolCodigo ?? "?"}`).join(" → ")} · firmaron ${firmantes.map((u) => u.replace("demo.", "")).join(" → ")}${f ? ` · ${f}` : ""}`;
  });

  /* ------------------------------------------------ ALI-D8 */
  await paso("ALI-D8 · Reporte I.V.C. (IBC01): Mín. · Máx. · Otros · Resultado · Observ. con Cumple", async () => {
    const p = await ok(U.jefe, "POST", "/informes/propuesta", { otId: C.ot.id, plantillaId: C.ivc.id });
    afirmar(p.modalidad === "cumplimiento", `modalidad ${p.modalidad}`);
    const v = await ok(U.jefe, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: C.ivc.id });
    const h = v.html;
    guardar("ivc-alimentos-vista-previa.html", h);
    const ths = [...h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    for (const t of ["Análisis", "Mín.", "Máx.", "Otros", "Resultado", "Observ."]) afirmar(ths.includes(t), `falta la columna «${t}» (${ths.join(", ")})`);
    for (const t of ["I.V.C. N.º", "100000", "Cumple", "3,8 °C"]) afirmar(h.includes(t), `falta «${t}» en el I.V.C.`);
    // Salmonella: sin cotas, el requisito («Ausencia», nominal del catálogo) va en «Otros».
    afirmar(/<td class="num">—<\/td><td class="num">—<\/td><td>Ausencia[^<]*<\/td><td>Ausencia<\/td><td class="ok">Cumple<\/td>/.test(h), "Salmonella no trae el requisito en «Otros»");
    const r = await ok(U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.ivc.id });
    const pdf = await ok(U.jefe, "GET", `/informes/${r.certificado.id}/pdf`);
    afirmar(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === "%PDF-", "el PDF del I.V.C. no se generó");
    const f = guardar("ivc-alimentos.pdf", pdf);
    return `${r.numero}${f ? ` · ${f}` : ""}`;
  });
}

main()
  .then(() => {
    console.log(`\nFrente ALI · tanda 1: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
