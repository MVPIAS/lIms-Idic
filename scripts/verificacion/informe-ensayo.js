#!/usr/bin/env node
/**
 * Verificación contra una API real del informe de ensayo (docs/FLUJO_INFORME_ENSAYO.md):
 *   · el informe imprime ensayo, método, unidad, requisito, resultado y veredicto
 *     de los resultados del catálogo v2 (antes salían «—»);
 *   · requisitos de agua de la NCh 409 Of.84 retirados del catálogo;
 *   · dos modalidades: cumplimiento y solo resultados (guardada en el documento);
 *   · formato por plantilla: secciones numeradas, referencias, anexo fotográfico,
 *     conclusión; fotos de la OT;
 *   · matriz de firmas: en una OT interna no oficializa el Jefe de Departamento.
 * Cada regla se prueba con un perfil que puede y con uno que no.
 *
 * Uso:
 *   node scripts/verificacion/informe-ensayo.js [--arrancar] [--base http://localhost:3921/api]
 *
 * Mismas variables que flujo-completo.js (DATABASE_URL con --arrancar; CLAVE_DEMO
 * o la constante CLAVE_DEMO_EMBEBIDA). Deja datos de prueba (dos OT de LQC con
 * sus documentos): úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:3921/api");
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
  const esForm = typeof FormData !== "undefined" && cuerpo instanceof FormData;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}) },
    body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
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

/* ------------------------------------------------------------ arranque --- */
let hijo = null;
async function esperarApi(ms = 60000) {
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
function arrancarApi() {
  if (!process.env.DATABASE_URL) throw new Error("--arrancar necesita DATABASE_URL");
  const puerto = new URL(BASE).port || "3921";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-informe-ensayo-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* PNG de 1×1 válido. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function formFoto(buf, nombre, campos = {}) {
  const f = new FormData();
  f.append("archivo", new Blob([buf], { type: "image/png" }), nombre);
  for (const [k, v] of Object.entries(campos)) f.append(k, String(v));
  return f;
}

const U = {
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  ventas: "demo.ventas",
  jefe: "demo.lqc.jefe",
  a1: "demo.lqc.analista1",
  rev: "demo.lqc.revisor",
  otroLab: "demo.lpn.analista1",
  admin: "demo.admin",
  dqo: "demo.dqo.jefe",
};
const FIRMANTES = ["demo.lqc.jefe", "demo.lqc.revisor", "demo.lqc.analista1", "demo.lqc.analista2", "demo.dqo.jefe", "demo.squ.jefe", "demo.director", "demo.calidad"];

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

  await paso("Catálogo: métodos de LQC (pH, Sulfato, Azufre, Formación de grumos) y plantillas", async () => {
    const buscar = async (codigo) => {
      const m = lista(await ok(U.jefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
      afirmar(m, `método ${codigo} no encontrado`);
      return m;
    };
    C.mPh = await buscar("251");
    C.mSulfato = await buscar("310");
    C.mAzufre = await buscar("258");
    C.mGrumos = await buscar("2053");
    C.lqc = (await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQC");
    afirmar(C.lqc, "LQC no figura entre los laboratorios");
    const pl = lista(await ok(U.jefe, "GET", "/plantillas?limit=200"));
    C.pg09 = pl.find((p) => p.repid === "PG09A2");
    C.ensayo = pl.find((p) => p.tipo === "I.ENSAYO" && p.repid !== "PG09A2");
    afirmar(C.pg09, "falta la plantilla PG09A2 (align_informe_ensayo.sql)");
    const cl = lista(await ok(U.admin, "GET", "/clientes?limit=5"));
    afirmar(cl.length, "no hay clientes");
    C.clienteId = cl[0].id;
    return `PG09A2 ${C.pg09.id.slice(0, 8)} · I.ENSAYO ${C.ensayo?.repid}`;
  });

  /* ------------------------------------------------ 1. Dos OT de LQC */
  const crearOt = async (origen) => {
    const ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.clienteId,
      unidadPrincipalId: C.lqc.id,
      conCobro: false,
      ...(origen ? { origenTrabajo: origen } : {}),
      descripcionTrabajo: `Prueba informe de ensayo ${sello}`,
    });
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${ot.id}/muestras`, {
      muestras: [{ nombre: `Agua de pozo ${sello}`, metodoIds: [C.mPh.id, C.mSulfato.id, C.mAzufre.id, C.mGrumos.id] }],
    });
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${ot.id}/resultados`)).resultados;
    const de = (m) => rs.find((x) => x.catMetodoId === m.id);
    return { ot, muestra: r.muestras[0], rPh: de(C.mPh), rSulfato: de(C.mSulfato), rAzufre: de(C.mAzufre), rGrumos: de(C.mGrumos) };
  };
  await paso("Planificación crea una OT de cliente y una OT interna de LQC con sus ensayos", async () => {
    C.A = await crearOt(null);
    C.B = await crearOt("OT_INTERNA");
    afirmar(C.A.rPh && C.A.rSulfato && C.A.rAzufre && C.A.rGrumos, "faltan ensayos en la OT A");
    return `${C.A.ot.codigo} · ${C.B.ot.codigo} (interna)`;
  });

  /* ------------------------------------------------ 2. NCh 409 Of.84 retirada */
  await paso("pH y Sulfato llegan SIN requisito: los límites de la NCh 409 Of.84 ya no se copian", async () => {
    for (const r of [C.A.rPh, C.A.rSulfato]) {
      afirmar(!r.limiteInf && !r.limiteSup && !r.nominal, `${r.catAnalito?.nombre}: trae ${r.limiteInf}–${r.limiteSup} (debería venir vacío)`);
    }
    return "pH sin 6,0–8,5 · Sulfato sin 250 mg/L";
  });

  /* ------------------------------------------------ 3. Captura */
  const capturar = async (X) => {
    await ok(U.a1, "PATCH", `/flujo/resultado/${X.rPh.id}/especificacion`, { limiteInf: "6,5", limiteSup: "8,5" });
    await ok(U.a1, "POST", `/flujo/resultado/${X.rPh.id}/valor`, { valor: "9,1" });
    await ok(U.a1, "POST", `/flujo/resultado/${X.rSulfato.id}/valor`, { valor: "300" });
    await ok(U.a1, "POST", `/flujo/resultado/${X.rAzufre.id}/valor`, { replicasTexto: "0,31 0,29 0,30" });
    await ok(U.a1, "PATCH", `/flujo/resultado/${X.rGrumos.id}/especificacion`, { requisito: "Sin formación de grumos", tipoDato: "atributo" }).catch(async () =>
      ok(U.jefe, "PATCH", `/flujo/resultado/${X.rGrumos.id}/especificacion`, { requisito: "Sin formación de grumos", tipoDato: "atributo" }),
    );
    await ok(U.a1, "POST", `/flujo/resultado/${X.rGrumos.id}/valor`, { atributo: "cumple", valor: "No forma grumos" });
  };
  await paso("El analista fija el pH en la orden (6,5–8,5) y captura los cuatro ensayos", async () => {
    await capturar(C.A);
    await capturar(C.B);
    return "pH 9,1 (no cumple) · Sulfato 300 · Azufre réplicas · Grumos cumple";
  });

  /* ------------------------------------------------ 4. Fotos */
  await paso("Fotos: un perfil sin permiso (Ventas) y otro laboratorio (LPN) no suben ni ven (403)", async () => {
    await exigir(403, U.ventas, "POST", `/informes/ot/${C.A.ot.id}/fotos`, formFoto(PNG_1x1, "a.png"));
    await exigir(403, U.otroLab, "POST", `/informes/ot/${C.A.ot.id}/fotos`, formFoto(PNG_1x1, "a.png"));
    await exigir(403, U.otroLab, "GET", `/informes/ot/${C.A.ot.id}/fotos`);
  });
  await paso("Fotos: un archivo que no es PNG/JPEG se rechaza (400) aunque se llame .png", async () => {
    await exigir(400, U.a1, "POST", `/informes/ot/${C.A.ot.id}/fotos`, formFoto(Buffer.from("<svg onload=alert(1)>"), "x.png"));
  });
  await paso("El analista sube una foto del pH para el anexo, ligada al ensayo", async () => {
    const f = await ok(U.a1, "POST", `/informes/ot/${C.A.ot.id}/fotos`, formFoto(PNG_1x1, "ph.png", { pie: "Lectura del pH-metro", resultadoId: C.A.rPh.id }));
    C.fotoId = f.id;
    const fotos = await ok(U.jefe, "GET", `/informes/ot/${C.A.ot.id}/fotos`);
    afirmar(fotos.length === 1 && fotos[0].enInforme && fotos[0].mime === "image/png", "la foto no quedó registrada");
    // Revisión r3 (hallazgo 18): el listado trae metadatos y la URL de cada foto, no su contenido.
    afirmar(!("dataUrl" in fotos[0]) && !JSON.stringify(fotos).includes("base64"), "el listado de fotos trae el contenido de las imágenes");
    afirmar(fotos[0].url === `informes/fotos/${C.fotoId}/imagen`, `url ${fotos[0].url}`);
    const sJefe = await login(U.jefe);
    const img = await fetch(`${BASE}/${fotos[0].url}`, { headers: { authorization: `Bearer ${sJefe.token}` } });
    const bytes = Buffer.from(await img.arrayBuffer());
    afirmar(img.status === 200 && img.headers.get("content-type") === "image/png" && bytes.equals(PNG_1x1), `imagen HTTP ${img.status} ${img.headers.get("content-type")}`);
    await exigir(403, U.otroLab, "GET", `/${fotos[0].url}`);
    await exigir(403, U.ventas, "GET", `/${fotos[0].url}`);
    // Una foto de esta OT no se puede ligar a un ensayo de otra OT.
    await exigir(400, U.a1, "PATCH", `/informes/fotos/${C.fotoId}`, { resultadoId: C.B.rPh.id });
    return `${fotos[0].bytes} bytes · ligada a ${fotos[0].ensayo}`;
  });

  /* ------------------------------------------------ 5. Estructura */
  await paso("Estructura del informe: el analista no la fija (403); la jefatura sí", async () => {
    const filas = [
      { resultadoId: C.A.rPh.id, seccion: "Parámetros físico-químicos", componente: "Agua de pozo", orden: 1 },
      { resultadoId: C.A.rSulfato.id, seccion: "Parámetros físico-químicos", componente: "Agua de pozo", orden: 2 },
      { resultadoId: C.A.rAzufre.id, seccion: "Otros ensayos", componente: null, orden: 3 },
      { resultadoId: C.A.rGrumos.id, seccion: "Otros ensayos", componente: null, orden: 4 },
    ];
    await exigir(403, U.a1, "PUT", `/informes/ot/${C.A.ot.id}/estructura`, { filas });
    await exigir(400, U.jefe, "PUT", `/informes/ot/${C.A.ot.id}/estructura`, { filas: [{ resultadoId: C.B.rPh.id, seccion: "X" }] });
    await ok(U.jefe, "PUT", `/informes/ot/${C.A.ot.id}/estructura`, { filas });
    const e = await ok(U.jefe, "GET", `/informes/ot/${C.A.ot.id}/estructura`);
    const ph = e.filas.find((f) => f.resultadoId === C.A.rPh.id);
    afirmar(ph.punto === "4.1.1", `punto del pH ${ph.punto}`);
    return `pH en el punto ${ph.punto}`;
  });

  /* ------------------------------------------------ 6. Formato de la plantilla */
  await paso("Formato de la plantilla: la jefatura lo ve pero no lo cambia (403); Administración sí", async () => {
    const f = await ok(U.jefe, "GET", `/informes/plantillas/${C.pg09.id}/formato`);
    afirmar(f.efectivo.agrupacion === "seccion" && f.efectivo.numeracion === "4", `formato PG09A2 ${JSON.stringify(f.efectivo).slice(0, 120)}`);
    C.formatoOriginal = f.guardado;
    await exigir(403, U.jefe, "PUT", `/informes/plantillas/${C.pg09.id}/formato`, { formato: { referencias: false } });
    await exigir(400, U.admin, "PUT", `/informes/plantillas/${C.pg09.id}/formato`, { formato: { agrupacion: "otra" } });
    const g = await ok(U.admin, "PUT", `/informes/plantillas/${C.pg09.id}/formato`, { formato: { ...C.formatoOriginal, etiquetas: { ...(C.formatoOriginal?.etiquetas ?? {}), veredicto: "Condición" } } });
    afirmar(g.efectivo.etiquetas.veredicto === "Condición", "no se guardó la etiqueta");
    return `PG09A2: ${g.efectivo.agrupacion}, numeración ${g.efectivo.numeracion}`;
  });

  /* ------------------------------------------------ 7. Revisión y aprobación */
  await paso("Revisión y aprobación de las dos OT", async () => {
    for (const X of [C.A, C.B]) {
      await ok(U.rev, "POST", `/resultados/ot/${X.ot.id}/revisar`, {});
      await ok(U.jefe, "POST", `/resultados/ot/${X.ot.id}/aprobar`, {});
    }
  });

  /* ------------------------------------------------ 8. Condiciones y matriz */
  await paso("Matriz de firmas: la OT de cliente la oficializa el Jefe DQO; la OT interna no", async () => {
    const a = await ok(U.jefe, "POST", "/informes/condiciones", { otId: C.A.ot.id, plantillaId: C.pg09.id });
    const b = await ok(U.jefe, "POST", "/informes/condiciones", { otId: C.B.ot.id, plantillaId: C.pg09.id });
    afirmar(a.puedeEmitir, `OT A no se puede emitir: ${a.faltantes.join(" ")}`);
    afirmar(b.puedeEmitir, `OT B no se puede emitir: ${b.faltantes.join(" ")}`);
    afirmar(a.pasos.some((p) => p.accion === "OFICIALIZA"), "la OT de cliente perdió la oficialización");
    afirmar(!a.otInterna && b.otInterna, "otInterna mal calculado");
    afirmar(!b.pasos.some((p) => p.accion === "OFICIALIZA" || p.rolCodigo === "JEFE_DEPTO"), "la OT interna sigue pidiendo la firma del Jefe DQO");
    afirmar(b.pasosOmitidos.some((p) => p.accion === "OFICIALIZA"), "no se informa el paso omitido");
    const r = await ok(U.jefe, "GET", `/firmas-matriz/resolver?tipoDocumento=INFORME_ENSAYO&unidadId=${C.lqc.id}&otInterna=1`);
    afirmar(!r.pasos.some((p) => p.accion === "OFICIALIZA") && r.omitidos?.length, "el resolver con otInterna=1 no omite la oficialización");
    return `cliente: ${a.pasos.map((p) => p.accion).join("→")} · interna: ${b.pasos.map((p) => p.accion).join("→")}`;
  });

  await paso("Propuesta: modalidad sugerida «cumplimiento» (la OT tiene requisitos)", async () => {
    const p = await ok(U.jefe, "POST", "/informes/propuesta", { otId: C.A.ot.id, plantillaId: C.pg09.id });
    afirmar(p.modalidad === "cumplimiento", `modalidad ${p.modalidad}`);
    afirmar(p.conRequisito === 2 && p.totalEnsayos === 4, `${p.conRequisito} de ${p.totalEnsayos} con requisito`);
    await exigir(403, U.otroLab, "POST", "/informes/propuesta", { otId: C.A.ot.id, plantillaId: C.pg09.id });
    return `${p.conRequisito} de ${p.totalEnsayos} ensayos con requisito`;
  });

  /* ------------------------------------------------ 9. Contenido del informe */
  await paso("Previsualizar: otro laboratorio no puede (403)", async () => {
    await exigir(403, U.otroLab, "POST", "/informes/previsualizar", { otId: C.A.ot.id, plantillaId: C.pg09.id });
  });
  await paso("Informe de cumplimiento: ensayo, método, requisito (de la orden), resultado, veredicto, referencias y anexo", async () => {
    const p = await ok(U.jefe, "POST", "/informes/previsualizar", {
      otId: C.A.ot.id, plantillaId: C.pg09.id, modalidad: "cumplimiento", datosInforme: { conclusion: "Agua no apta por pH." },
    });
    const h = p.html;
    for (const t of ["<td>pH</td>", "<td>Sulfato</td>", "6,5 – 8,5 *", "No especificado", "9,1", "No forma grumos",
      "4.1 Parámetros físico-químicos", "4.1.1 Agua de pozo", "<th>Condición</th>", "Punto 4.1.1 Agua de pozo no cumple con pH.",
      "Anexo fotográfico", "Foto 1 · Punto 4.1.1 Agua de pozo · Lectura del pH-metro", "archivados en el laboratorio por un período de 5 años",
      "Agua no apta por pH.", "Veredicto de la muestra"]) afirmar(h.includes(t), `falta «${t}» en el informe`);
    // Ninguna fila con el ensayo o el requisito en «—».
    afirmar(!/<tr><td>—<\/td>/.test(h), "hay filas con el ensayo en «—»");
    afirmar(p.modalidad === "cumplimiento", `modalidad ${p.modalidad}`);
    return `${(h.match(/<tr>/g) ?? []).length} filas`;
  });
  await paso("Informe de solo resultados: sin columnas de requisito ni veredicto", async () => {
    const p = await ok(U.jefe, "POST", "/informes/previsualizar", { otId: C.A.ot.id, plantillaId: C.pg09.id, modalidad: "solo_resultados" });
    afirmar(!p.html.includes("<th>Requisito</th>") && !p.html.includes("<th>Condición</th>"), "aparecen requisito o veredicto");
    afirmar(!p.html.includes("Referencias"), "aparecen referencias en solo resultados");
    afirmar(p.html.includes("<td>9,1</td>"), "falta el resultado");
    await exigir(400, U.jefe, "POST", "/informes/previsualizar", { otId: C.A.ot.id, plantillaId: C.pg09.id, modalidad: "otra" });
  });

  /* ------------------------------------------------ 10. Emisión */
  await paso("Emisión de cumplimiento (OT de cliente): la modalidad queda guardada en el documento", async () => {
    await exigir(403, U.a1, "POST", "/informes/emitir", { otId: C.A.ot.id, plantillaId: C.pg09.id, modalidad: "cumplimiento" });
    const r = await ok(U.jefe, "POST", "/informes/emitir", {
      otId: C.A.ot.id, plantillaId: C.pg09.id, modalidad: "cumplimiento", datosInforme: { conclusion: "Agua no apta por pH." },
    });
    C.docA = r.certificado.id;
    afirmar(r.modalidad === "cumplimiento", `modalidad ${r.modalidad}`);
    const circ = await ok(U.jefe, "GET", `/informes/${C.docA}/circuito`);
    afirmar(circ.modalidad === "cumplimiento", `circuito.modalidad ${circ.modalidad}`);
    afirmar(circ.pasos.some((p) => p.accion === "OFICIALIZA"), "falta la oficialización");
    const docs = lista(await ok(U.jefe, "GET", `/informes/documentos?otId=${C.A.ot.id}`));
    afirmar(docs.find((d) => d.id === C.docA)?.modalidad === "cumplimiento", "el listado no trae la modalidad");
    const pdf = await ok(U.jefe, "GET", `/informes/${C.docA}/pdf`);
    afirmar(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === "%PDF-", "el PDF no se generó");
    return `${r.numero} · PDF ${pdf.length} bytes`;
  });
  await paso("Emisión de solo resultados (OT interna): sin Jefe DQO en el circuito", async () => {
    const r = await ok(U.jefe, "POST", "/informes/emitir", { otId: C.B.ot.id, plantillaId: C.pg09.id, modalidad: "solo_resultados" });
    C.docB = r.certificado.id;
    afirmar(r.modalidad === "solo_resultados", `modalidad ${r.modalidad}`);
    afirmar(!r.html.includes("<th>Requisito</th>"), "el documento de solo resultados trae requisito");
    const circ = await ok(U.jefe, "GET", `/informes/${C.docB}/circuito`);
    afirmar(!circ.pasos.some((p) => p.accion === "OFICIALIZA"), "el circuito de la OT interna trae la oficialización");
    // Firma completa sin el Jefe DQO.
    const porId = {};
    for (const u of FIRMANTES) if (sesiones[u]) porId[sesiones[u].id] = u;
    const firmantes = new Set();
    for (const orden of [...new Set(circ.pasos.map((p) => p.orden))].sort((a, b) => a - b)) {
      for (const p of circ.pasos.filter((x) => x.orden === orden)) {
        const cand = (p.responsables ?? []).map((x) => porId[x.usuarioId]).filter(Boolean);
        const quien = cand.find((u) => !firmantes.has(u)) ?? cand[0];
        afirmar(quien, `paso ${orden}: sin responsable entre los perfiles de prueba`);
        afirmar(quien !== U.dqo, "se pidió la firma del Jefe DQO");
        await ok(quien, "POST", `/informes/${C.docB}/firmar`, {});
        firmantes.add(quien);
      }
    }
    const fin = await ok(U.jefe, "GET", `/informes/${C.docB}/circuito`);
    afirmar(fin.estado === "oficial", `estado ${fin.estado}`);
    return `${r.numero} oficial con ${[...firmantes].map((u) => u.replace("demo.", "")).join(" → ")}`;
  });
  await paso("La reemisión conserva la modalidad del documento", async () => {
    await ok(U.admin, "POST", `/informes/${C.docB}/anular`, { motivo: "Prueba de reemisión del informe" }).catch(async () =>
      ok(U.jefe, "POST", `/informes/${C.docB}/anular`, { motivo: "Prueba de reemisión del informe" }),
    );
    const r = await ok(U.jefe, "POST", `/informes/${C.docB}/reemitir`, {});
    afirmar(r.modalidad === "solo_resultados", `modalidad ${r.modalidad}`);
    return r.numero;
  });

  await paso("Se restaura el formato original de la plantilla PG09A2", async () => {
    await ok(U.admin, "PUT", `/informes/plantillas/${C.pg09.id}/formato`, { formato: C.formatoOriginal ?? null });
  });
}

main()
  .then(() => {
    console.log(`\n${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
