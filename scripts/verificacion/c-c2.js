#!/usr/bin/env node
/**
 * Frente c2 · correcciones del recorrido de los manuales de proceso (emisión,
 * documentos, Metrología, SAEC y nombre de empresa ficticio). Reproduce, contra
 * una API real, cada fallo corregido del Backlog_Correcciones_Recorrido (pestaña
 * «Plan», frente 2) con un perfil que puede y otro que no:
 *
 *   B-006 plantilla HCP VLCB con nombre ficticio · B-003 oficio con serie propia ·
 *   B-022/B-076 tipo de documento de la plantilla y número en la vista previa ·
 *   B-023 «Emitir informe» con la OT · B-024 medios oficio / Oficina de partes ·
 *   B-026/B-075 IVCOR, membrete LQC y firmas del circuito en la vista previa ·
 *   B-004 cierre técnico con no calibrable devuelto · B-029 entrega del certificado
 *   externo · B-028 sin patrón no se envía · B-043 valores del patrón del maestro ·
 *   B-027 condiciones de la hoja al motor · B-081 correo propuesto · B-082 reemitir
 *   tras la entrega · B-074 pie técnico e informe técnico · B-079 URL de verificación ·
 *   B-044 coincidencia IBIS con motivo · B-077 listado CU en .xlsx · B-078 RUT del
 *   nuevo titular. (B-025: pruebas unitarias de filas-informe.)
 *   Cierre de la OT de Metrología con no calibrables (decisión 24-10): el informe
 *   técnico y el certificado externo cuentan como documento; ruta, «OT listas para
 *   cerrar», cierre final y factura.
 *
 * Usa datos que dejan los guiones anteriores de la lista (documento oficial del LQC
 * de r4-r4c / informe-ensayo y calibraciones emitidas de r1-r1a / r4-r4a): córrase
 * después de ellos, como en la vuelta completa.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/c-c2.js [--arrancar] [--base http://localhost:4961/api]
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA (no se escribe
 * aquí). Deja datos de prueba ficticios; se puede correr varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4961/api");
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
  let r, j;
  // Límite de intentos de ingreso (429): se espera y se reintenta, como en r4-r4c.
  for (let i = 0; i < 40; i++) {
    r = await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: CLAVE }),
    });
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  j = await r.json().catch(() => ({}));
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
  const puerto = new URL(BASE).port || "4961";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-c2-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };


/* ============================================================ RECORRIDO === */
const U = {
  admin: "demo.admin", calidad: "demo.calidad", ventas: "demo.ventas", fin: "demo.finanzas", planif: "demo.planificacion",
  lqcJefe: "demo.lqc.jefe", lqcA: "demo.lqc.analista1",
  jefe: "demo.lmt.jefe", metro: "demo.lmt.analista1", depto: "demo.dsa.jefe",
  d11: "demo.d11.jefe", bpch: "demo.bpch.jefe",
};
const sello = Date.now().toString(36).toUpperCase();
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const CONF = "/parametros/configurables";
const PDF_MIN = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%" + "EOF\n", "latin1");
const recibir = (calibrable, extra = {}) => ({
  fechaHora: new Date().toISOString(), entregadoPor: "Cliente de prueba c2", estadoFisico: calibrable ? "bueno" : "danado", ubicacion: "Estante C2",
  calibrable, ...(calibrable ? {} : { estadoFisicoObs: "Golpe en la carcasa", motivoNoCalibrable: "Daño en el mecanismo: no repite la indicación" }), ...extra,
});
const html = (r) => (r?.html ?? r?.data?.html ?? "");

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = { restaurar: [] };
  try {
    await recorrido(C);
  } finally {
    for (const f of C.restaurar.reverse()) await f().catch((e) => console.log(`  (no se pudo restaurar: ${e.message})`));
  }
}

async function recorrido(C) {
  const met = async (otId, u = U.jefe) => ok(u, "GET", `/ot/${otId}/metrologia`);

  await paso("Preparación: laboratorios, cliente, plantillas y documento del LQC", async () => {
    const labs = lista(await ok(U.planif, "GET", "/ot/laboratorios"));
    for (const k of ["LMT", "LQC"]) C[k] = labs.find((u) => u.codigo === k);
    C.clienteId = lista(await ok(U.admin, "GET", "/clientes?limit=5"))[0]?.id;
    afirmar(C.LMT && C.LQC && C.clienteId, "faltan laboratorios o un cliente");
    const docs = lista(await ok(U.lqcJefe, "GET", "/informes/documentos?limit=100"));
    C.docLqc = docs.find((d) => ["oficial", "emitido"].includes(d.estado) && (d.otId ?? d.ot?.id));
    const cualquiera = docs.find((d) => d.otId ?? d.ot?.id);
    afirmar(cualquiera, "no hay documentos del LQC: corra antes informe-ensayo y r4-r4c");
    C.otLqc = cualquiera.otId ?? cualquiera.ot?.id;
    const pl = [];
    for (let p = 1; p <= 5; p++) {
      const r = await ok(U.calidad, "GET", `/plantillas?limit=100&page=${p}`);
      pl.push(...lista(r));
      if (!r?.meta || p >= (r.meta.totalPages ?? 1)) break;
    }
    C.pl = (repid) => pl.find((x) => x.repid === repid);
    afirmar(C.pl("SCCII") && C.pl("PG09A2-LQC") && C.pl("IVCOR"), "faltan plantillas SCCII, PG09A2-LQC o IVCOR");
    return `LMT y LQC · OT del LQC con documento · ${C.docLqc ? `oficial ${C.docLqc.numero}` : "sin oficial"}`;
  });

  /* ----------------------------------------------------------- B-006 */
  await paso("B-006 · La HCP del VLCB cita a «Contratista Prueba Aiuken S.A.» (ninguna empresa real); el Jefe LQC no la edita", async () => {
    const g = (await ok(U.calidad, "GET", CONF)).grupos.find((x) => x.categoria === "hcp_plantilla");
    const v = JSON.stringify(g?.parametros.find((p) => p.codigo === "VLCB")?.valor ?? "");
    afirmar(v.includes("Contratista Prueba Aiuken S.A.") && !/salinas/i.test(v), "la plantilla VLCB conserva el nombre real o no tiene el ficticio");
    await exigir(403, U.lqcJefe, "PUT", `${CONF}/hcp_plantilla/VLCB`, { valor: [], motivo: "No le corresponde" });
    return "VLCB con nombre ficticio · Jefe LQC → 403";
  });

  /* ----------------------------------------------------------- B-003 */
  await paso("B-003 · Con una regla «todos los tipos» del LQC, el oficio conductor toma su serie OF-LQC-… (no la del informe)", async () => {
    if (!C.docLqc) return "sin documento oficial del LQC en esta base (se omite: corra r4-r4c antes)";
    const regla = { unidadId: C.LQC.id, tipoDocumento: null, formato: "LQC-PRUEBA-C2-{N}", reinicio: "continuo" };
    await exigir(403, U.lqcJefe, "POST", "/numeracion-documentos", regla);
    let r = await llamar(U.admin, "POST", "/numeracion-documentos", regla);
    if (r.status === 409) {
      const rs = (await ok(U.admin, "GET", "/numeracion-documentos")).reglas;
      r = { json: rs.find((x) => x.activo && x.unidadId === C.LQC.id && x.tipoDocumento === null) };
    } else afirmar([200, 201].includes(r.status), `regla: ${r.status} ${msg(r.json)}`);
    const reglaId = r.json.id;
    C.restaurar.push(() => ok(U.admin, "POST", `/numeracion-documentos/${reglaId}/desactivar`));
    const cuerpo = { otId: C.docLqc.otId ?? C.docLqc.ot?.id, documentos: [C.docLqc.id], destinatario: "Destinatario de prueba c2", materia: `Remite documento ${sello}` };
    await exigir(403, U.lqcA, "POST", "/oficios", cuerpo);
    const o = await ok(U.lqcJefe, "POST", "/oficios", cuerpo);
    const g = await ok(U.lqcJefe, "POST", `/oficios/${o.id}/generar`, {});
    const num = g.numero ?? g.data?.numero;
    await ok(U.lqcJefe, "POST", `/oficios/${o.id}/anular`, { motivo: "Prueba c2: se anula al terminar" });
    afirmar(/^OF-LQC-\d{4}-\d{4}$/.test(num) && num !== C.docLqc.numero, `número del oficio: ${num}`);
    return `oficio ${num} (documento ${C.docLqc.numero}) · analista → 403 · Jefe LQC sin documento.numeracion → 403`;
  });

  /* ----------------------------------------------------- B-022 / B-076 */
  await paso("B-022 · «Automático» toma el tipo de la plantilla (SCCII → informe de inspección); Calidad lo edita, el Jefe LQC no", async () => {
    const sccii = C.pl("SCCII");
    afirmar(sccii.tipoDocumento === "INFORME_INSPECCION", `SCCII.tipoDocumento = ${sccii.tipoDocumento}`);
    const c = await ok(U.lqcJefe, "POST", "/informes/condiciones", { otId: C.otLqc, plantillaId: sccii.id });
    afirmar(c.tipoDocumento === "INFORME_INSPECCION" && c.tipoDocumentoOrigen === "plantilla", `condiciones: ${c.tipoDocumento} (${c.tipoDocumentoOrigen})`);
    await exigir(403, U.lqcJefe, "PATCH", `/plantillas/${sccii.id}`, { tipoDocumento: "INFORME_TECNICO" });
    await ok(U.calidad, "PATCH", `/plantillas/${sccii.id}`, { tipoDocumento: "INFORME_INSPECCION" });
    await exigir(400, U.calidad, "PATCH", `/plantillas/${sccii.id}`, { tipoDocumento: "NO_EXISTE" });
    return "SCCII → INFORME_INSPECCION (origen plantilla) · Jefe LQC → 403 · tipo inválido → 400";
  });

  await paso("B-076 · La vista previa numera con el tipo de documento elegido (IE LQC N° …) y no con CERT-AAAA-XXXX", async () => {
    const pg = C.pl("PG09A2-LQC");
    const ie = html(await ok(U.lqcJefe, "POST", "/informes/previsualizar", { otId: C.otLqc, plantillaId: pg.id, tipoDocumento: "INFORME_ENSAYO" }));
    afirmar(/IE LQC N/.test(ie) && /BORRADOR/.test(ie), "la vista previa no muestra el número IE LQC");
    await exigir(403, U.ventas, "POST", "/informes/previsualizar", { otId: C.otLqc, plantillaId: pg.id, tipoDocumento: "INFORME_ENSAYO" });
    await exigir(400, U.lqcJefe, "POST", "/informes/previsualizar", { otId: C.otLqc, plantillaId: pg.id, tipoDocumento: "NO_EXISTE" });
    return "IE LQC N° … (BORRADOR) · Ventas → 403 · tipo inválido → 400";
  });

  /* ------------------------------------------------- B-075 / B-026 / B-079 */
  await paso("B-075/B-026 · Vista previa: membrete «Laboratorio Químico Central», IVCOR con estructura del Anexo 01 y firmas del circuito", async () => {
    const lqc = html(await ok(U.lqcJefe, "POST", "/informes/previsualizar", { otId: C.otLqc, plantillaId: C.pl("PG09A2-LQC").id }));
    afirmar(/Laboratorio Químico Central/.test(lqc) && !/Laboratorio de Química \(LQC\)/.test(lqc), "membrete del LQC");
    afirmar(/firmas-e/.test(lqc) && /Pendiente de firma/.test(lqc), "la vista previa no trae las firmas del circuito");
    const ivc = await ok(U.lqcJefe, "POST", "/informes/previsualizar", { otId: C.otLqc, plantillaId: C.pl("IVCOR").id });
    const h = html(ivc);
    afirmar(!ivc.usaPlantillaPorDefecto && ["I. Antecedentes", "II. Material", "III. Trabajos efectuados", "IV. Resultados", "V. Conclusión", "IDIC-PG09-Anexo01"].every((s) => h.includes(s)),
      "IVCOR sin el cuerpo del Anexo 01");
    afirmar(!/verificar\.idic\.cl/.test(lqc + h), "la vista previa cita el dominio de producción");
    return "membrete LQC · firmas pendientes del circuito · IVCOR I–V";
  });

  await paso("B-023 · «Emitir informe» de la captura y del cierre llevan la OT; /informes sin ?otId propone la OT de la captura", async () => {
    const web = path.join(RAIZ, "apps/web");
    const cap = fs.readFileSync(path.join(web, "app/(app)/captura-ot/page.tsx"), "utf8");
    const inf = fs.readFileSync(path.join(web, "app/(app)/informes/page.tsx"), "utf8");
    const cierre = fs.readFileSync(path.join(web, "components/documentos/PanelCierreOt.tsx"), "utf8");
    afirmar(cap.includes("href={`/informes?otId=${ot.id}`") && cap.includes("aria-label={`Emitir informe de la OT") && cap.includes("recordarOtActiva(ot.id)"), "captura sin enlace con OT");
    afirmar(cierre.includes("/informes?otId=${otId}"), "panel de cierre sin OT");
    afirmar(inf.includes("otActiva()"), "/informes no propone la OT en curso");
    return "enlaces con ?otId y OT recordada (código; en pantalla, capturas B-023)";
  });

  /* ----------------------------------------------------------- B-024 */
  await paso("B-024 · Envío de la cotización por «Oficina de partes» exige el Nº; Finanzas no envía; la Carpeta distingue el origen del oficio", async () => {
    const cots = lista(await ok(U.ventas, "GET", "/cotizaciones?limit=20"));
    afirmar(cots.length, "no hay cotizaciones");
    const id = cots[0].id;
    await exigir(403, U.fin, "POST", `/cotizaciones/${id}/enviar-cliente`, { medio: "oficina_partes" });
    const r = await llamar(U.ventas, "POST", `/cotizaciones/${id}/enviar-cliente`, { medio: "oficina_partes" });
    afirmar([400, 409].includes(r.status) && !/Invalid enum|Expected/.test(msg(r.json)), `${r.status} ${msg(r.json)}`);
    afirmar(r.status === 409 || /Nº del oficio o del registro de la Oficina de partes/.test(msg(r.json)), msg(r.json));
    const car = await ok(U.lqcJefe, "GET", `/ot/${C.otLqc}/carpeta`);
    const of = car.secciones?.oficios ?? [];
    afirmar(of.every((o) => o.origen === "ot" || o.origen === "cotizacion"), "la carpeta no distingue el origen del oficio");
    return `medio aceptado (${r.status}: ${msg(r.json).slice(0, 70)}) · Finanzas → 403 · carpeta con ${of.length} oficio(s)`;
  });

  /* ------------------------------------------------- Metrología: B-004 */
  await paso("B-004 · No calibrable con informe técnico, devuelto: «Cerrar técnicamente» sigue disponible (Comercial no; Jefe LMT sí)", async () => {
    C.otB = await ok(U.planif, "POST", "/ot", { clienteId: C.clienteId, unidadPrincipalId: C.LMT.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: `C2 B-004 ${sello}` });
    const it = await ok(U.jefe, "POST", `/ot/${C.otB.id}/instrumentos`, { descripcion: "Celda de carga (prueba c2)", serie: `CC-${sello}` });
    C.iB = it.data.id;
    await ok(U.metro, "POST", `/ot/${C.otB.id}/instrumentos/${C.iB}/recepcion`, recibir(false));
    const b = `/ot/${C.otB.id}/instrumentos/${C.iB}`;
    const inf = { motivo: "La celda no entrega señal estable", hallazgos: "Cable de señal cortado y conector oxidado", recomendacion: "Reparar y volver a calibrar" };
    await ok(U.metro, "POST", `${b}/informe-tecnico`, inf);
    await ok(U.metro, "POST", `${b}/informe-tecnico/enviar`);
    await exigir(403, U.metro, "POST", `${b}/informe-tecnico/emitir`);
    C.itNum = (await ok(U.jefe, "POST", `${b}/informe-tecnico/emitir`)).data.numero;
    await ok(U.ventas, "POST", `${b}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    await ok(U.metro, "POST", `${b}/devolucion`, { fechaHora: new Date().toISOString(), recibidoPor: "Encargado del cliente", estadoFisico: "danado", observacion: "Se devuelve sin calibrar" });
    const m = await met(C.otB.id);
    afirmar(m.instrumentos[0].estado === "devuelto" && m.cierreTecnico.posible, `cierre técnico: ${m.cierreTecnico.motivo}`);
    afirmar((m.instrumentos[0].documentosNoCalibrable ?? []).some((d) => d.numero === C.itNum && d.entregadoAt), "la tabla no lista el informe técnico entregado (B-029)");
    await exigir(403, U.ventas, "POST", `/ot/${C.otB.id}/metrologia/cierre-tecnico`);
    const r = await ok(U.jefe, "POST", `/ot/${C.otB.id}/metrologia/cierre-tecnico`);
    afirmar(r.data.estado === "finalizada", JSON.stringify(r.data));
    return `${C.otB.codigo} · ${C.itNum} entregado · ítem devuelto · Comercial → 403 · finalizada`;
  });

  await paso("B-074 · Informe técnico: fecha de la OT dd-mm-aaaa y firma del metrólogo con fecha", async () => {
    const h = html(await ok(U.jefe, "GET", `/ot/${C.otB.id}/instrumentos/${C.iB}/informe-tecnico/html`));
    afirmar(!/\b\d{4}-\d{2}-\d{2}\b/.test(h.replace(/<style[\s\S]*?<\/style>/g, "")), "el informe técnico imprime fechas ISO");
    afirmar((h.match(/Firmado electrónicamente el/g) ?? []).length >= 2, "falta la fecha de alguna firma");
    await exigir(403, U.lqcJefe, "GET", `/ot/${C.otB.id}/instrumentos/${C.iB}/informe-tecnico/html`);
    return "fechas dd-mm-aaaa · dos firmas fechadas · LQC → 403";
  });

  /* ----------------------------------------------------------- B-029 */
  await paso("B-029 · Certificado externo validado: se entrega al cliente (Finanzas no) y figura en el cierre", async () => {
    C.otC = await ok(U.planif, "POST", "/ot", { clienteId: C.clienteId, unidadPrincipalId: C.LMT.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: `C2 B-029 ${sello}` });
    const it = await ok(U.jefe, "POST", `/ot/${C.otC.id}/instrumentos`, { descripcion: "Manómetro de alta presión (prueba c2)", serie: `MP-${sello}` });
    const b = `/ot/${C.otC.id}/instrumentos/${it.data.id}/servicio-externo`;
    await ok(U.metro, "POST", `/ot/${C.otC.id}/instrumentos/${it.data.id}/recepcion`, recibir(false, { requiereExterno: true, motivoNoCalibrable: "Rango sobre el alcance del laboratorio" }));
    const prov = lista(await ok(U.jefe, "GET", `/ot/${C.otC.id}/metrologia/proveedores`));
    afirmar(prov.length, "no hay proveedores");
    await ok(U.jefe, "POST", b, { proveedorId: prov[0].id, justificacion: "El rango supera la capacidad del patrón", costo: 1 });
    await ok(U.depto, "POST", `${b}/aprobar`);
    await ok(U.jefe, "POST", `${b}/envio`, { ocNumero: `OC-C2-${sello}`, fechaEnvio: hoy() });
    await rechazo(409, /validado/, U.ventas, "POST", `${b}/entregar`, { medio: "mano", destinatario: "Cliente" });
    const f = new FormData();
    f.append("archivo", new Blob([PDF_MIN], { type: "application/pdf" }), "externo.pdf");
    f.append("numero", `EXT-C2-${sello}`);
    f.append("fechaRetorno", hoy());
    await ok(U.metro, "PUT", `${b}/certificado`, f);
    await ok(U.jefe, "POST", `${b}/validar`, { aptitud: "apto", comentario: "Cumple" });
    const docs = (await ok(U.ventas, "GET", `/ot/${C.otC.id}/metrologia/documentos`)).data;
    afirmar(docs[0].accionesExterno.includes("ENTREGAR"), "Comercial no ve «Registrar entrega» del externo");
    await exigir(403, U.fin, "POST", `${b}/entregar`, { medio: "mano", destinatario: "Cliente" });
    await ok(U.ventas, "POST", `${b}/entregar`, { medio: "oficio", destinatario: "Encargado del cliente", observacion: "Oficio Nº 123" });
    await rechazo(409, /ya está registrada/, U.ventas, "POST", `${b}/entregar`, { medio: "mano", destinatario: "Cliente" });
    const m = await met(C.otC.id);
    const d = m.instrumentos[0].documentosNoCalibrable.find((x) => x.tipo === "certificado_externo");
    afirmar(d?.numero === `EXT-C2-${sello}` && d.entregadoAt && d.entregaMedio === "oficio", JSON.stringify(d));
    return `EXT-C2-${sello} entregado por oficio · sin validar → 409 · Finanzas → 403 · repetido → 409`;
  });

  /* ---------------- Cierre de la OT de Metrología con no calibrables (24-10) */
  // Decisión del 24-10: el informe técnico emitido y el certificado externo validado cuentan
  // como documento para el cierre final, con la misma regla de entrega que los demás.
  const avance = async (otId, u = U.planif) => { const a = await ok(u, "GET", `/ot/${otId}/avance`); return a?.data ?? a; };
  const etapaDe = (a, clave) => (a.etapas ?? []).find((e) => e.clave === clave);
  const enListas = async (ot) => lista(await ok(U.planif, "GET", `/ot?listasCierre=1&search=${encodeURIComponent(ot.codigo)}&limit=50`)).some((x) => x.id === ot.id);

  await paso("Cierre Metrología · Todos no calibrables (con cobro): informe técnico emitido sin entregar → el cierre lo pide; no figura en «OT listas para cerrar»", async () => {
    const svc = lista(await ok(U.ventas, "GET", "/cat/ensayos?search=EN1074&limit=5")).find((e) => e.codigo === "EN1074");
    afirmar(svc, "falta el servicio EN1074 en el catálogo");
    const cot = await ok(U.ventas, "POST", "/cotizaciones", { clienteId: C.clienteId, formato: "NORMAL", plazoEntregaDias: 15, referencia: `C2 cierre no calibrable ${sello}`, lineas: [{ catEnsayoId: svc.id, cantidad: 1 }] });
    await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/enviar-a-firma`, {});
    await ok("demo.dco.jefe", "POST", `/cotizaciones/${cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/aceptar`, { tipo: "OC", numero: `OC-NC-${sello}`, fecha: hoy(), conCobro: true, unidadPrincipalId: C.LMT.id });
    C.otN = await ok(U.jefe, "GET", `/ot/${r?.ot?.id ?? r?.otId ?? r?.ot_id}`);
    afirmar(C.otN.conCobro, "la OT de la cotización no es con cobro");
    await ok(U.jefe, "POST", `/ot/${C.otN.id}/instrumentos/desde-cotizacion`);
    C.iN = (await met(C.otN.id)).instrumentos[0].id;
    await ok(U.jefe, "PUT", `/ot/${C.otN.id}/instrumentos/${C.iN}`, { descripcion: "Balanza con plato deformado (prueba c2)", serie: `BN-${sello}`, procesoCodigo: "ITM02" });
    await ok(U.metro, "POST", `/ot/${C.otN.id}/instrumentos/${C.iN}/recepcion`, recibir(false));
    const b = `/ot/${C.otN.id}/instrumentos/${C.iN}`;
    await ok(U.metro, "POST", `${b}/informe-tecnico`, { motivo: "El plato está deformado: no repite la indicación", hallazgos: "Deformación del plato y golpe en la carcasa", recomendacion: "Reparar y volver a calibrar" });
    await ok(U.metro, "POST", `${b}/informe-tecnico/enviar`);
    C.itN = (await ok(U.jefe, "POST", `${b}/informe-tecnico/emitir`)).data.numero;
    const c = await ok(U.planif, "GET", `/ot/${C.otN.id}/cierre`);
    afirmar(!c.puedeCerrar && c.faltantes.some((f) => f.includes(C.itN) && /falta registrar su entrega/.test(f)), `faltantes: ${c.faltantes.join(" | ")}`);
    afirmar(!c.faltantes.some((f) => /no tiene informes ni certificados/.test(f)), "el informe técnico emitido no cuenta como documento");
    afirmar((c.documentosNoCalibrables ?? []).some((d) => d.numero === C.itN && !d.entregadoAt), "el panel de cierre no lista el informe técnico");
    const a = await avance(C.otN.id);
    afirmar(a.etapaActual === "entrega" && a.siguiente?.texto === `Registrar la entrega del informe técnico ${C.itN}`, `ruta: ${a.etapaActual} · ${a.siguiente?.texto}`);
    afirmar(!(await enListas(C.otN)), "figura en «OT listas para cerrar» con el informe sin entregar");
    return `${cot.codigo} → ${C.otN.codigo} · ${C.itN} emitido · cierre y ruta piden su entrega`;
  });

  await paso("Cierre Metrología · Todos no calibrables: entrega → devolución → cierre técnico → lista para cerrar → cierre (el metrólogo no) → factura", async () => {
    const b = `/ot/${C.otN.id}/instrumentos/${C.iN}`;
    await exigir(403, U.fin, "POST", `${b}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Cliente" });
    await ok(U.ventas, "POST", `${b}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    await ok(U.metro, "POST", `${b}/devolucion`, { fechaHora: new Date().toISOString(), recibidoPor: "Encargado del cliente", estadoFisico: "danado", observacion: "Se devuelve sin calibrar" });
    const ct = await ok(U.jefe, "POST", `/ot/${C.otN.id}/metrologia/cierre-tecnico`);
    afirmar(ct.data.estado === "finalizada", JSON.stringify(ct.data));
    const a = await avance(C.otN.id);
    afirmar(a.etapaActual === "cierre" && etapaDe(a, "cierre")?.detalle === "Lista para cerrar", `ruta: ${a.etapaActual} · ${etapaDe(a, "cierre")?.detalle} · ${a.siguiente?.texto}`);
    afirmar(await enListas(C.otN), "no figura en «OT listas para cerrar»");
    const ban = lista(await ok(U.planif, "GET", "/me/bandeja")).find((x) => x.clave === "ot_listas_cerrar");
    afirmar(ban && ban.cantidad >= 1, "la tarjeta «OT listas para cerrar» no cuenta la OT");
    const c = await ok(U.planif, "GET", `/ot/${C.otN.id}/cierre`);
    afirmar(c.puedeCerrar && !c.faltantes.length, `faltantes: ${c.faltantes.join(" | ")}`);
    await exigir(403, U.metro, "POST", `/ot/${C.otN.id}/cerrar`, {});
    const r = await ok(U.planif, "POST", `/ot/${C.otN.id}/cerrar`, {});
    afirmar(r.ot.estado === "cerrada" && r.facturaCreada?.id && r.facturaCreada.total > 0, `cierre: ${r.ot.estado} · factura ${JSON.stringify(r.facturaCreada)}`);
    afirmar(!(await enListas(C.otN)), "la OT cerrada sigue en «OT listas para cerrar»");
    const a2 = await avance(C.otN.id);
    afirmar(a2.etapaActual === "factura" && etapaDe(a2, "cierre")?.estado === "hecho", `ruta tras cerrar: ${a2.etapaActual}`);
    return `${C.otN.codigo} cerrada · factura ${r.facturaCreada.numero} $${Number(r.facturaCreada.total).toLocaleString("es-CL")} · metrólogo → 403`;
  });

  await paso("Cierre Metrología · Servicio externo: certificado validado y entregado (B-029) → devolución → cierre técnico → cierre", async () => {
    const it = (await met(C.otC.id)).instrumentos[0];
    const c0 = await ok(U.planif, "GET", `/ot/${C.otC.id}/cierre`);
    afirmar(!c0.faltantes.some((f) => /no tiene informes ni certificados/.test(f)), "el certificado externo validado no cuenta como documento");
    afirmar((c0.documentosNoCalibrables ?? []).some((d) => d.tipo === "certificado_externo" && d.entregadoAt), "el panel de cierre no lista el certificado externo");
    await ok(U.metro, "POST", `/ot/${C.otC.id}/instrumentos/${it.id}/devolucion`, { fechaHora: new Date().toISOString(), recibidoPor: "Encargado del cliente", estadoFisico: "bueno", observacion: "Vuelve del proveedor externo" });
    await ok(U.jefe, "POST", `/ot/${C.otC.id}/metrologia/cierre-tecnico`);
    afirmar(await enListas(C.otC), "la OT del externo no figura en «OT listas para cerrar»");
    const r = await ok(U.planif, "POST", `/ot/${C.otC.id}/cerrar`, {});
    afirmar(r.ot.estado === "cerrada" && !r.facturaCreada, `cierre: ${r.ot.estado} · factura ${JSON.stringify(r.facturaCreada)}`);
    return `${C.otC.codigo} cerrada con EXT-C2-${sello} (OT interna sin cobro: sin factura)`;
  });

  /* ----------------------------------------- B-028 / B-043 / B-027 / B-081 */
  await paso("Preparación Metrología: OT del LMT con una balanza recibida y asignada; PM-01 y PM-48 del maestro", async () => {
    C.otA = await ok(U.planif, "POST", "/ot", { clienteId: C.clienteId, unidadPrincipalId: C.LMT.id, origenTrabajo: "OT_INTERNA", conCobro: false, descripcionTrabajo: `C2 metrología ${sello}` });
    const it = await ok(U.jefe, "POST", `/ot/${C.otA.id}/instrumentos`, { descripcion: "Balanza analítica (prueba c2)", serie: `B-${sello}`, procesoCodigo: "ITM02" });
    C.iA = it.data.id;
    const c = await ok(U.jefe, "GET", `/ot/${C.otA.id}/instrumentos/${C.iA}/metrologos`);
    await ok(U.jefe, "POST", `/ot/${C.otA.id}/instrumentos/${C.iA}/asignar`, { metrologoId: c.data.find((x) => x.username === U.metro).id });
    await ok(U.metro, "POST", `/ot/${C.otA.id}/instrumentos/${C.iA}/recepcion`, recibir(true));
    const p = (await ok(U.jefe, "GET", `/metrologia/patrones?fecha=${hoy()}`)).data;
    C.pat = p.find((x) => x.codigo === "PM-01"); C.th = p.find((x) => x.codigo === "PM-48");
    afirmar(C.pat && C.th && C.pat.valores_certificado, "falta PM-01 con sus valores de certificado o PM-48");
    C.datos = (await ok(U.metro, "GET", "/metrologia/motores/ITM02/ejemplo")).data.datos;
    return `${C.otA.codigo} · PM-01 con ${Object.keys(C.pat.valores_certificado).length} piezas`;
  });

  await paso("B-028 · Sin patrón del maestro la calibración no se envía a firma; el LQC no calibra", async () => {
    const cuerpo = { otInstrumentoId: C.iA, procesoCodigo: "ITM02", fecha: hoy(), intervaloMeses: 12, motor: { datos: C.datos, opciones: {} } };
    await exigir(403, U.lqcA, "POST", "/metrologia/calibraciones", cuerpo);
    C.cal = (await ok(U.metro, "POST", "/metrologia/calibraciones", cuerpo)).data;
    await rechazo([400, 403, 409], /patrón vigente/, U.metro, "POST", `/metrologia/calibraciones/${C.cal.id}/enviar`);
    const d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(!d.acciones.includes("ENVIAR"), "la ficha ofrece «Enviar» sin patrón");
    afirmar("correo_propuesto" in d, "B-081: la ficha no trae el correo propuesto");
    return `${C.cal.codigo}: enviar sin patrón → rechazado · LQC → 403 · ficha con correo propuesto`;
  });

  await paso("B-043/B-027 · Con PM-01 y PM-48: el motor toma los valores del certificado y las condiciones de la hoja; cambiarlos pide motivo", async () => {
    const datos = JSON.parse(JSON.stringify(C.datos));
    datos.pat = {};
    const cuerpo = {
      procesoCodigo: "ITM02", fecha: hoy(), intervaloMeses: 12, patronIds: [C.pat.id],
      auxiliares: { termohigrometroId: C.th.id, lecturas: { temp: [20.4, 20.6], hum: [51, 52], pres: [] } },
      motor: { datos, opciones: {} },
    };
    await ok(U.metro, "PUT", `/metrologia/calibraciones/${C.cal.id}`, cuerpo);
    let d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(Object.keys(d.datos.pat ?? {}).length === Object.keys(C.pat.valores_certificado).length, "el motor no cargó los valores del patrón del maestro");
    afirmar(JSON.stringify(d.datos.temp) === "[20.4,20.6]" && JSON.stringify(d.datos.hum) === "[51,52]", `condiciones del motor: ${JSON.stringify([d.datos.temp, d.datos.hum])}`);
    const cambiado = JSON.parse(JSON.stringify(datos));
    cambiado.pat = { ...d.datos.pat, "20 mg E2": { ...d.datos.pat["20 mg E2"], U: 0.009 } };
    await rechazo(400, /motivo/, U.metro, "PUT", `/metrologia/calibraciones/${C.cal.id}`, { ...cuerpo, motor: { datos: cambiado, opciones: {} } });
    await ok(U.metro, "PUT", `/metrologia/calibraciones/${C.cal.id}`, { ...cuerpo, motor: { datos: cambiado, opciones: {} }, motivoValoresPatron: "Certificado nuevo de la pieza de 20 mg (prueba)" });
    d = await ok(U.metro, "GET", `/metrologia/calibraciones/${C.cal.id}`);
    afirmar(d.datos.pat["20 mg E2"].U === 0.009 && d.eventos.some((e) => /Certificado nuevo de la pieza/.test(e.comentario ?? "")), "el cambio con motivo no quedó en la bitácora");
    afirmar(d.acciones.includes("ENVIAR"), "con patrón la calibración debería poder enviarse");
    await ok(U.metro, "POST", `/metrologia/calibraciones/${C.cal.id}/enviar`);
    return "pat del maestro · temp/hum de la hoja · cambio sin motivo → 400 · con motivo en la bitácora · enviada";
  });

  /* ------------------------------------------------- B-082 / B-079 */
  await paso("B-082/B-079 · Certificado emitido y entregado: el Jefe LMT puede reemitir (el metrólogo no); el certificado apunta a la instalación", async () => {
    const cals = lista(await ok(U.jefe, "GET", "/metrologia/calibraciones?limit=100")).filter((c) => c.estado === "emitida" && c.entregado_at);
    if (!cals.length) return "sin certificados entregados en esta base (se omite)";
    const jefe = await ok(U.jefe, "GET", `/metrologia/calibraciones/${cals[0].id}`);
    const metro = await ok(U.metro, "GET", `/metrologia/calibraciones/${cals[0].id}`).catch(() => ({ acciones: [] }));
    afirmar(jefe.acciones.includes("REEMITIR") && !metro.acciones.includes("REEMITIR"), `acciones jefe ${jefe.acciones} · metrólogo ${metro.acciones}`);
    const h = html(await ok(U.jefe, "GET", `/metrologia/calibraciones/${cals[0].id}/html`));
    afirmar(!/verificar\.idic\.cl/.test(h), "el certificado apunta al dominio de producción");
    return `${cals[0].numero_certificado ?? cals[0].codigo}: Jefe → REEMITIR · metrólogo no · sin verificar.idic.cl`;
  });

  /* ----------------------------------------------------------- B-044 */
  await paso("B-044 · Coincidencia IBIS: se confirma con motivo (sin motivo 400; Ventas 403; dos veces 400)", async () => {
    const uuid = `C2-HIT-${sello}`;
    const xml = `<?xml version="1.0"?><Export><Hits><Hit><UUID>${uuid}</UUID><ExhibitUUID>C2-A-${sello}</ExhibitUUID><MatchedExhibitUUID>C2-B-${sello}</MatchedExhibitUUID><Score>87.5</Score></Hit></Hits></Export>`;
    await ok(U.d11, "POST", "/ibis/importar", { xml, nombreArchivo: `prueba-c2-${sello}.xml` });
    const hits = lista(await ok(U.d11, "GET", "/ibis/hits?limit=200"));
    const h = hits.find((x) => x.uuid_ibis === uuid);
    afirmar(h, "el XML de prueba no creó la coincidencia");
    await exigir(403, U.ventas, "POST", `/ibis/hits/${h.id}/estado`, { estado: "confirmado", motivo: "Cotejo positivo" });
    await rechazo(400, /motivo/, U.d11, "POST", `/ibis/hits/${h.id}/estado`, { estado: "confirmado" });
    const r = await ok(U.d11, "POST", `/ibis/hits/${h.id}/estado`, { estado: "confirmado", motivo: "Cotejo positivo del perito (prueba)" });
    afirmar(r.estado === "confirmado" && r.estado_motivo && r.estado_at, JSON.stringify(r).slice(0, 200));
    await rechazo(400, /ya está/, U.d11, "POST", `/ibis/hits/${h.id}/estado`, { estado: "confirmado", motivo: "Otra vez" });
    return `${uuid} confirmada con motivo`;
  });

  /* ------------------------------------------------------ B-077 / B-078 */
  await paso("B-078/B-077 · Traspaso a un titular escrito a mano: la lista muestra su RUT; el listado se exporta a .xlsx (un analista de laboratorio no)", async () => {
    const n6 = () => String(Math.floor(Math.random() * 900000) + 100000);
    const fab = `Fabricante C2 ${sello}`;
    const base = { listado: "EXPLOSIVOS", elementoGenerico: "Explosivo de prueba", claseDivisionUn: "1.1D", numeroUn: "0241" };
    await ok(U.bpch, "POST", "/bpch/codificacion", { ...base, cnc: `E-I/21/${n6()}/7357/30537/${n6()}`, fabricanteNombre: fab, fabricanteRut: "11.111.111-1", producto: `Producto A ${sello}` });
    const b = await ok(U.bpch, "POST", "/bpch/codificacion", { ...base, cnc: `E-I/21/${n6()}/7357/30537/${n6()}`, fabricanteNombre: `Otro titular C2 ${sello}`, producto: `Producto B ${sello}` });
    await exigir(403, U.ventas, "POST", `/bpch/codificacion/${b.id}/titular`, { fabricanteNombre: fab, motivo: "Traspaso de prueba" });
    await ok(U.bpch, "POST", `/bpch/codificacion/${b.id}/titular`, { fabricanteNombre: fab, motivo: "Traspaso de prueba c2" });
    const l = lista(await ok(U.bpch, "GET", `/bpch/codificacion?q=${encodeURIComponent(`Producto B ${sello}`)}`));
    afirmar(l[0]?.fabricanteNombre === fab && l[0]?.fabricanteRut === "11.111.111-1", `lista: ${JSON.stringify(l[0] ?? {}).slice(0, 200)}`);
    const cuerpo = { listado: "EXPLOSIVOS", fabricante: fab, fechaEdicion: hoy() };
    await exigir(403, U.lqcA, "POST", "/bpch/codificacion/listado-oficial/excel", cuerpo);
    const x = await llamar(U.bpch, "POST", "/bpch/codificacion/listado-oficial/excel", cuerpo);
    afirmar(x.status === 201 && /spreadsheetml/.test(x.tipo) && x.buf.subarray(0, 2).toString("latin1") === "PK", `Excel ${x.status} ${x.tipo}`);
    return "RUT del nuevo titular en la lista · .xlsx (PK) · Ventas no traspasa (403) · analista LQC no exporta (403)";
  });
}

main()
  .then(() => {
    console.log(`\nFrente c2 (correcciones de emisión, documentos, Metrología y SAEC) verificado: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
