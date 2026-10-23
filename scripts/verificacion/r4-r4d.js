#!/usr/bin/env node
/**
 * Frente r4d · Comercial, datos de la OT, cobro, no conformidades, QC y recepción.
 * Recorre de punta a punta, con perfiles demo.* que pueden y que no:
 *
 *   T22 · BL-172 plantas del cliente · BL-173 oportunidad → cotización enlazada → ganada.
 *   T05 · BL-149 precio solo de la ficha · BL-210 solicitante y documento ·
 *         BL-151 costeo de comisión y Programa de Trabajo LEM ·
 *         BL-209 adjunto de aceptación · BL-150 O/C vs cotización.
 *   T15 · BL-159 herencia de la cotización · BL-160 OT institucional sin cobro ·
 *         BL-161/162 contrato, lote y carril DSA (portada del IVC) · BL-163 validación del laboratorio.
 *   (más secciones al final: T17, T27, T18, T19, T08)
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r4-r4d.js [--arrancar] [--base http://localhost:4871/api]
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja datos de prueba
 * ficticios: úsese en una base de pruebas. Se puede correr varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4871/api");
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
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: CLAVE }),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
    sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id ?? carga.sub };
    return sesiones[username];
  }
  throw new Error(`login ${username}: demasiados intentos`);
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = username ? await login(username) : null;
  const esForm = typeof FormData !== "undefined" && cuerpo instanceof FormData;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
      ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}),
    },
    body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json, tipo: r.headers.get("content-type") ?? "" };
}
const msg = (j) =>
  (typeof j === "string"
    ? j
    : j?.message
      ? `${Array.isArray(j.message) ? j.message.join("; ") : j.message}${Array.isArray(j.issues) ? ` · ${j.issues.map((i) => i.message).join("; ")}` : ""}`
      : JSON.stringify(j)
  ).slice(0, 400);
async function exigir(esperado, username, metodo, ruta, cuerpo, patron) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  if (patron && !patron.test(msg(r.json))) throw new Error(`${username} ${metodo} ${ruta}: el mensaje «${msg(r.json)}» no dice ${patron}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

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
    throw e;
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
  const puerto = new URL(BASE).port || "4871";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4872",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r4-r4d-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  ventas: "demo.ventas",
  dco: "demo.dco.jefe",
  planif: "demo.planificacion",
  finanzas: "demo.finanzas",
  calidad: "demo.calidad",
  director: "demo.director",
  auditor: "demo.auditor",
  recepcion: "demo.recepcion",
  lqcJefe: "demo.lqc.jefe",
  lqcAnalista: "demo.lqc.analista1",
  lqcRevisor: "demo.lqc.revisor",
  lpnJefe: "demo.lpn.jefe",
  lrbJefe: "demo.lrb.jefe",
  dsaJefe: "demo.dsa.jefe",
  bpch: "demo.bpch.jefe",
};
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const masDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
/** PDF mínimo válido (la API comprueba la firma %PDF-). */
function pdf(nombre, campos = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  f.append("archivo", new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")], { type: "application/pdf" }), nombre);
  return f;
}

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(4, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  await paso("Preparación · cliente con contacto, laboratorios y ensayos del catálogo", async () => {
    const base = 76000000 + (Number(sello.slice(-6)) % 999999);
    C.cliente = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Cliente Prueba r4d ${sello}`, tipo: "particulares", giro: "Pruebas", direccion: "Calle 1" });
    await ok(U.ventas, "POST", "/contactos", { clienteId: C.cliente.id, nombre: "A. B.", cargo: "Jefe de Calidad", principal: true });
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    C.lpn = labs.find((u) => u.codigo === "LPN");
    afirmar(C.lqc && C.lpn, "LQC/LPN no figuran en /ot/laboratorios");
    const buscar = async (codigo) => lista(await ok(U.lqcJefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
    C.mPh = await buscar("251");
    C.mGrumos = await buscar("2053");
    afirmar(C.mPh?.ensayoId && C.mGrumos?.ensayoId, "métodos 251/2053 no encontrados");
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    C.ccLqc = cfg.centrosCosto.find((c) => c.codigo === "LQC" || c.laboratorio === "LQC");
    afirmar(cfg.reposicionLrb === 4, `reposicionLrb ${cfg.reposicionLrb}`);
    return `${C.cliente.razonSocial} · LQC`;
  });

  /* ------------------------------------------------------------ T22 */
  await paso("BL-172 · Comercial registra las plantas del cliente; el analista no puede", async () => {
    const p1 = await ok(U.ventas, "POST", `/clientes/${C.cliente.id}/plantas`, { nombre: "Planta Norte", direccion: "Ruta 5 km 10", ciudad: "Antofagasta" });
    const p2 = await ok(U.ventas, "POST", `/clientes/${C.cliente.id}/plantas`, { nombre: "Planta Sur" });
    afirmar(p1.codigo === "P01" && p2.codigo === "P02", `códigos ${p1.codigo} ${p2.codigo}`);
    await exigir(400, U.ventas, "POST", `/clientes/${C.cliente.id}/plantas`, { nombre: "planta norte" }, /ya tiene una planta/);
    await exigir(403, U.lqcAnalista, "POST", `/clientes/${C.cliente.id}/plantas`, { nombre: "X" });
    await ok(U.ventas, "PATCH", `/clientes/${C.cliente.id}/plantas/${p2.id}`, { activa: false });
    const ps = await ok(U.ventas, "GET", `/clientes/${C.cliente.id}/plantas`);
    afirmar(ps.length === 2 && ps.find((p) => p.id === p2.id).activa === false, "desactivar");
    const cs = await ok(U.ventas, "GET", `/clientes/${C.cliente.id}/contactos`);
    C.contacto = cs[0];
    afirmar(C.contacto?.cargo === "Jefe de Calidad", "contacto");
    return "P01 y P02 (desactivada); nombre repetido 400; analista 403";
  });

  await paso("BL-173 · Oportunidad con laboratorio y año en curso; alcance por laboratorio; perder exige motivo", async () => {
    C.opp = await ok(U.ventas, "POST", "/oportunidades", { titulo: `Análisis de agua ${sello}`, clienteId: C.cliente.id, unidadId: C.lqc.id, montoEstimado: 100000 });
    afirmar(C.opp.codigo.startsWith(`OPP-${hoyCl().slice(0, 4)}-`), `código ${C.opp.codigo}`);
    afirmar(C.opp.unidad_codigo === "LQC", "laboratorio");
    await ok(U.lqcJefe, "GET", `/oportunidades/${C.opp.id}`);
    await exigir(403, U.lpnJefe, "GET", `/oportunidades/${C.opp.id}`);
    afirmar(!lista(await ok(U.lpnJefe, "GET", "/oportunidades?limit=200")).some((o) => o.id === C.opp.id), "LPN la ve en la lista");
    const otra = await ok(U.ventas, "POST", "/oportunidades", { titulo: `Perdida ${sello}`, clienteId: C.cliente.id, unidadId: C.lqc.id });
    await exigir(400, U.ventas, "POST", `/oportunidades/${otra.id}/perder`, {});
    const perdida = await ok(U.ventas, "POST", `/oportunidades/${otra.id}/perder`, { motivo: "El cliente eligió otro laboratorio" });
    afirmar(perdida.estado === "perdida" && perdida.motivo_perdida, "perdida");
    await exigir(400, U.ventas, "POST", `/oportunidades/${otra.id}/convertir`, {}, /perdida/);
    const conv = await ok(U.ventas, "POST", `/oportunidades/${C.opp.id}/convertir`, {});
    afirmar(conv.ruta.includes(C.opp.id) && conv.clienteId === C.cliente.id, "convertir");
    return C.opp.codigo;
  });

  /* ------------------------------------------------------------ T05 */
  await paso("BL-149 · El precio del ensayo sale de la ficha: precio manual, ensayo sin valor y línea libre se rechazan", async () => {
    const cab = { clienteId: C.cliente.id, formato: "NORMAL", centroCostoId: C.ccLqc?.id ?? null, plazoEntregaDias: 10 };
    await exigir(400, U.ventas, "POST", "/cotizaciones", { ...cab, lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 1, precioUnitario: 1 }] }, /no admite un precio manual/);
    await exigir(400, U.ventas, "POST", "/cotizaciones", { ...cab, lineas: [{ catEnsayoId: C.mGrumos.ensayoId, cantidad: 1, precioUnitario: 5000 }] }, /no tiene valor en su ficha/);
    await exigir(400, U.ventas, "POST", "/cotizaciones", { ...cab, lineas: [{ descripcion: "Servicio libre", cantidad: 1, precioUnitario: 1000 }] }, /gasto tipificado/);
    return "3 rechazos con su motivo";
  });

  await paso("BL-210/173 · Cotización desde la oportunidad con solicitante y oficio; la oportunidad pasa a Propuesta", async () => {
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", centroCostoId: C.ccLqc?.id ?? null, plazoEntregaDias: 10, moneda: "CLP",
      referencia: `OF Nº 77/${sello}`, descripcionTecnica: "pH de agua potable", formaPago: "contado_30", oportunidadId: C.opp.id,
      solicitud: { solicitanteContactoId: C.contacto.id, solicitudMedio: "oficio", solicitudNumero: `77/${sello}`, solicitudFecha: hoyCl() },
      lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 2 }, { tipo: "viatico", descripcion: "Viático toma de muestra", cantidad: 1, precioUnitario: 25000 }],
    });
    const d = await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}`);
    afirmar(d.solicitud?.solicitudMedio === "oficio" && d.solicitud.solicitanteCargo === "Jefe de Calidad", `solicitud ${JSON.stringify(d.solicitud)}`);
    afirmar(d.solicitud.oportunidadCodigo === C.opp.codigo, "enlace con la oportunidad");
    const o = await ok(U.ventas, "GET", `/oportunidades/${C.opp.id}`);
    afirmar(o.etapa === "propuesta" && o.cotizacion_id === C.cot.id, `etapa ${o.etapa}`);
    await exigir(400, U.ventas, "POST", `/oportunidades/${C.opp.id}/convertir`, {}, /ya tiene la cotización/);
    C.total = Number(d.total);
    return `${C.cot.codigo} · total ${C.total}`;
  });

  await paso("BL-151 · Comercial pide el costeo de una comisión; el Jefe de LQC responde FORM05 y Programa (el analista no)", async () => {
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/solicitudes-laboratorio`, { unidadId: C.lqc.id, tipoServicio: "comision", comentario: "Comisión a Arica" });
    const circ = await ok(U.lqcJefe, "GET", `/cotizaciones/${C.cot.id}/circuito`);
    const sol = circ.solicitudes.find((x) => x.unidadCodigo === "LQC");
    afirmar(sol?.tipoServicio === "comision" && sol.numero, `solicitud ${JSON.stringify(sol)?.slice(0, 120)}`);
    const ruta = `/cotizaciones/solicitudes-laboratorio/${sol.id}/responder`;
    await exigir(400, U.lqcJefe, "POST", ruta, { respuesta: "aceptar", programa: { etapas: [], plazoEntregaDias: 10 } }, /Comisión/);
    await exigir(403, U.lqcAnalista, "POST", ruta, { respuesta: "aceptar", programa: { etapas: [], plazoEntregaDias: 10 } });
    await ok(U.lqcJefe, "POST", ruta, {
      respuesta: "aceptar",
      programa: { etapas: [{ actividad: "Muestreo en terreno" }], plazoEntregaDias: 12, puntosEt: "4.1.1 y 4.2", numItems: 6 },
      costeo: {
        horasHombre: [{ tipo: "civil", categoria: "Profesional", horas: 16, valorHora: 12000 }],
        viaticos: [{ ambito: "nacional", zona: "Arica", grado: "Profesional", dias: 2, montoDiario: 60000, porcentaje: 40 }],
        pasajes: [{ ambito: "nacional", tramo: "SCL-ARI", cantidad: 1, valorUnitario: 180000 }],
      },
    });
    const c = await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}/circuito`);
    const r = c.solicitudes.find((x) => x.id === sol.id);
    afirmar(r.programa.puntosEt === "4.1.1 y 4.2" && r.programa.numItems === 6 && r.costeo?.resultado?.cdt > 0, "programa/costeo");
    C.circuito = c;
    return `${r.numero} · CDT ${r.costeo.resultado.cdt}`;
  });

  await paso("Circuito · V°B° del laboratorio y del departamento, firma del Jefe DCO", async () => {
    const sol = C.circuito.solicitudes.find((x) => x.unidadCodigo === "LQC");
    await ok(U.lqcJefe, "POST", `/cotizaciones/solicitudes-laboratorio/${sol.id}/vb`, { accion: "dar" });
    await ok("demo.dqo.jefe", "POST", `/cotizaciones/solicitudes-laboratorio/${sol.id}/vb`, { accion: "dar" });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    return "firmada";
  });

  await paso("BL-209 · El documento de aceptación se adjunta como archivo (Comercial sí; el analista no; un no-PDF no)", async () => {
    await exigir(403, U.lqcAnalista, "POST", `/cotizaciones/${C.cot.id}/adjuntos`, pdf("oc.pdf", { clase: "aceptacion" }));
    const malo = new FormData();
    malo.append("clase", "aceptacion");
    malo.append("archivo", new Blob([Buffer.from("no es un pdf")], { type: "application/pdf" }), "falso.pdf");
    await exigir(400, U.ventas, "POST", `/cotizaciones/${C.cot.id}/adjuntos`, malo, /PDF, PNG o JPEG/);
    C.adjunto = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/adjuntos`, pdf(`OC-${sello}.pdf`, { clase: "aceptacion" }));
    afirmar(C.adjunto.id && C.adjunto.mime === "application/pdf", "adjunto");
    const r = await llamar(U.ventas, "GET", `/cotizaciones/${C.cot.id}/adjuntos/${C.adjunto.id}`);
    afirmar(r.status === 200 && r.tipo.includes("application/pdf"), `descarga ${r.status} ${r.tipo}`);
    return C.adjunto.nombre;
  });

  await paso("BL-150 · O/C distinta del total: sin discrepancia 409; «Anular orden del cliente» deja la cotización Abierta", async () => {
    const base = { tipo: "OC", numero: `OC-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.lqc.id, adjuntoId: C.adjunto.id };
    await exigir(409, U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, { ...base, montoOc: C.total - 5000 }, /difiere del total cotizado/);
    await exigir(403, U.lqcJefe, "POST", `/cotizaciones/${C.cot.id}/anular-orden-cliente`, { numero: "OC-X", motivo: "No corresponde" });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/anular-orden-cliente`, { numero: `OC-${sello}-A`, montoOc: 1000, motivo: "La O/C es de otro servicio" });
    const d = await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}`);
    afirmar(d.estado === "abierta", `estado ${d.estado}`);
    return "409 sin discrepancia · orden anulada, cotización Abierta";
  });

  await paso("BL-150/159/173 · Aceptación con discrepancia registrada: OT con datos heredados y oportunidad Ganada", async () => {
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.lqc.id, adjuntoId: C.adjunto.id,
      montoOc: C.total - 5000, discrepancia: "El cliente excluye el viático; se ajusta al facturar",
    });
    C.ot = r.ot;
    const d = await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}`);
    afirmar(d.aceptacionAdjunto === C.adjunto.nombre, `adjunto en la aceptación: ${d.aceptacionAdjunto}`);
    const c = await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}/circuito`);
    const acc = c.eventos.map((e) => e.accion);
    afirmar(acc.includes("discrepancia_oc") && acc.includes("orden_cliente_anulada"), `hitos ${acc.join(",")}`);
    const o = await ok(U.ventas, "GET", `/oportunidades/${C.opp.id}`);
    afirmar(o.estado === "ganada" && o.ot_id === C.ot.id, `oportunidad ${o.estado}`);
    const e = await ok(U.lqcJefe, "GET", `/ot/${C.ot.id}/encargo`);
    afirmar(e.encargo.moneda === "CLP" && e.encargo.formaPago === "contado_30" && e.encargo.referencia?.startsWith("OF Nº") && e.encargo.descripcionTecnica && Number(e.encargo.valorInicial) === C.total,
      `herencia ${JSON.stringify(e.encargo).slice(0, 200)}`);
    return `${C.ot.codigo} · ${o.codigo} ganada`;
  });

  /* ------------------------------------------------------------ T15 */
  await paso("BL-159/161/162 · Comercial completa el encargo (tipo de trabajo, lote, carril DSA); el analista no", async () => {
    const ruta = `/ot/${C.ot.id}/encargo`;
    await exigir(403, U.lqcAnalista, "PUT", ruta, { tipoTrabajo: "ENSAYOS" });
    await exigir(400, U.ventas, "PUT", ruta, { lugarEjecucion: "FABRICA_EXTRANJERO" }, /país/);
    await exigir(400, U.ventas, "PUT", ruta, { carrilDsa: "COMISION_FABRICA" }, /US\$/);
    await exigir(400, U.ventas, "PUT", ruta, { paga: "proveedor" }, /OT de origen/);
    const v = await ok(U.ventas, "PUT", ruta, {
      tipoTrabajo: "ADQUISICIONES", nivelTecnologico: "AB", requiereMuestreo: true, mandante: "DIVLOG",
      contrato: `CT-${sello}`, contratoFecha: masDias(hoyCl(), -30), proyecto: "Proyecto Prueba", proveedor: "Proveedor Prueba",
      fabricante: "Fabricante Prueba", paisOrigen: "Chile", item: "Bidón de agua 20 L", cantidad: 1500, unidadCantidad: "unidades",
      etTexto: "E.T. 123 v2", lugarMuestreo: "Bodega central", fechaMuestreo: hoyCl(), carrilDsa: "PARTICULAR", lugarEjecucion: "IDIC",
    });
    afirmar(v.tipoTrabajo === "ADQUISICIONES" && v.documentoPropuesto === "IVC", `tipo ${v.tipoTrabajo}`);
    afirmar(v.encargo.contrato === `CT-${sello}` && v.encargo.cantidad === 1500, "contrato y cantidad");
    return `${C.ot.codigo} · emite IVC`;
  });

  await paso("BL-163 · Jefe de LQC: alcance no conforme devuelve a Ventas; luego recepciona con fechas internas (Comercial y LPN no)", async () => {
    const ruta = `/ot/${C.ot.id}/encargo/validacion-laboratorio`;
    await exigir(403, U.ventas, "POST", ruta, { alcanceConforme: true, fechaInicio: hoyCl(), fechaInforme: hoyCl() });
    await exigir(403, U.lpnJefe, "POST", ruta, { alcanceConforme: true, fechaInicio: hoyCl(), fechaInforme: hoyCl() });
    await exigir(400, U.lqcJefe, "POST", ruta, { alcanceConforme: false }, /motivo/);
    let v = await ok(U.lqcJefe, "POST", ruta, { alcanceConforme: false, observacion: "La E.T. citada no corresponde al producto" });
    afirmar(v.encargo.devueltaVentasAt && v.encargo.alcanceConforme === false, "devuelta");
    await exigir(400, U.lqcJefe, "POST", ruta, { alcanceConforme: true, fechaInicio: masDias(hoyCl(), 5), fechaTermino: masDias(hoyCl(), 2), fechaInforme: masDias(hoyCl(), 9) }, /término es anterior/);
    v = await ok(U.lqcJefe, "POST", ruta, { alcanceConforme: true, fechaInicio: masDias(hoyCl(), 1), fechaTermino: masDias(hoyCl(), 4), fechaInforme: masDias(hoyCl(), 60) });
    afirmar(v.encargo.validadaAt && !v.encargo.devueltaVentasAt && v.encargo.fechaInforme === masDias(hoyCl(), 60), "validada");
    afirmar(v.avisos.length === 1, `aviso de plazo: ${JSON.stringify(v.avisos)}`);
    return "devuelta y luego recepcionada; aviso por informe después del plazo";
  });

  await paso("BL-161 · La portada del IVC se precarga con el contrato y el lote", async () => {
    const pls = lista(await ok(U.lqcJefe, "GET", "/plantillas?limit=100&search=IVC")).filter((x) => x.tipo === "IVC");
    let portada = null;
    for (const pl of pls) {
      const r = await llamar(U.lqcJefe, "POST", "/informes/propuesta", { otId: C.ot.id, plantillaId: pl.id });
      if ([200, 201].includes(r.status) && r.json?.portada) { portada = r.json.portada; break; }
    }
    if (!portada) return "ninguna plantilla de la base tiene portada IVC (se omite)";
    afirmar(portada.contrato === `CT-${sello}` && portada.proveedor === "Proveedor Prueba" && /1500 unidades/.test(portada.cantidad), `portada ${JSON.stringify(portada)}`);
    return `portada: ${portada.contrato} · ${portada.cantidad}`;
  });

  await paso("BL-160 · OT institucional sin cobro con oficio y laboratorios que intervienen", async () => {
    const cuerpo = { clienteId: C.cliente.id, origenTrabajo: "INSTITUCIONAL", unidadPrincipalId: C.lqc.id, tipoTrabajo: "ENSAYOS" };
    await exigir(400, U.ventas, "POST", "/ot", cuerpo, /oficio/);
    await exigir(400, U.ventas, "POST", "/ot", { ...cuerpo, conCobro: true, oficioNumero: "OF 1", oficioFecha: hoyCl() }, /sin cobro/);
    await exigir(403, U.lqcAnalista, "POST", "/ot", { ...cuerpo, oficioNumero: "OF 1", oficioFecha: hoyCl() });
    const ot = await ok(U.ventas, "POST", "/ot", { ...cuerpo, oficioNumero: `OF ${sello}`, oficioFecha: hoyCl(), laboratoriosIntervienen: [C.lqc.id, C.lpn.id], costoEstimado: 40000 });
    afirmar(ot.conCobro === false && ot.origenTrabajo === "INSTITUCIONAL", `ot ${ot.conCobro} ${ot.origenTrabajo}`);
    const e = await ok(U.ventas, "GET", `/ot/${ot.id}/encargo`);
    afirmar(e.encargo.oficioNumero === `OF ${sello}` && e.encargo.laboratoriosDetalle.length === 2, "oficio y laboratorios");
    C.otInst = ot;
    return `${ot.codigo} sin cobro · oficio OF ${sello}`;
  });

  /* ------------------------------------------------------------ T17 */
  await paso("BL-164 · Informe mensual de la tasa 1,5 %: Comercial lo consulta y descarga; solo el Jefe DCO lo emite", async () => {
    const mes = hoyCl().slice(0, 7);
    await exigir(403, U.lqcJefe, "GET", `/internaciones/tasa-mensual?mes=${mes}`);
    await exigir(403, U.finanzas, "GET", `/internaciones/tasa-mensual?mes=${mes}`);
    const inf = await ok(U.ventas, "GET", `/internaciones/tasa-mensual?mes=${mes}`);
    afirmar(Array.isArray(inf.filas) && inf.resumen && inf.difusion.length >= 1, "informe");
    afirmar(inf.puedeEmitir === false, "Comercial no emite");
    const csv = await llamar(U.ventas, "GET", `/internaciones/tasa-mensual?mes=${mes}&formato=csv`);
    afirmar(csv.status === 200 && csv.tipo.includes("text/csv") && String(csv.json).includes("Resolución DGMN"), `csv ${csv.status} ${csv.tipo}`);
    await exigir(403, U.ventas, "POST", "/internaciones/tasa-mensual/emitir", { mes });
    await exigir(400, U.dco, "POST", "/internaciones/tasa-mensual/emitir", { mes: "1990-01" }, /No hay tasas/);
    const d = await ok(U.dco, "GET", `/internaciones/tasa-mensual?mes=${mes}`);
    afirmar(d.puedeEmitir === true, "el Jefe DCO puede emitir");
    if (!d.filas.length) return `${mes}: sin tasas calculadas (no se emite)`;
    if (d.emitido) {
      await exigir(409, U.dco, "POST", "/internaciones/tasa-mensual/emitir", { mes }, /ya se emitió/);
      return `${mes}: ${d.filas.length} tasas · ya emitido (409 al repetir)`;
    }
    const e = await ok(U.dco, "POST", "/internaciones/tasa-mensual/emitir", { mes, observaciones: "Prueba r4d" });
    afirmar(e.emitido && /Dirección/.test(e.emitido.difusion), `emitido ${JSON.stringify(e.emitido)}`);
    await exigir(409, U.dco, "POST", "/internaciones/tasa-mensual/emitir", { mes }, /ya se emitió/);
    return `${mes}: ${d.filas.length} tasas · ${e.resumen.total} · emitido y difundido`;
  });

  /* ------------------------------------------------------------ T27 */
  await paso("BL-193/194 · Planilla de costos reales: trae los gastos de comisión del costeo y valida las OT internas (el analista no)", async () => {
    const ruta = `/laboratorio/ot/${C.ot.id}/costos-reales`;
    const v = await ok(U.lqcJefe, "GET", ruta);
    const sug = v.sugerencias.lineas ?? [];
    const com = sug.filter((x) => x.categoria === "comision");
    afirmar(com.some((x) => x.tipoGasto === "viatico" && x.costoUnitario === 24000) && com.some((x) => x.tipoGasto === "pasaje"), `sugeridas ${JSON.stringify(sug)}`);
    const lineas = com.map((x) => ({ categoria: x.categoria, tipoGasto: x.tipoGasto, descripcion: x.descripcion, cantidad: x.cantidad, costoUnitario: x.costoUnitario }));
    await exigir(403, U.lqcAnalista, "PUT", ruta, { lineas });
    await exigir(400, U.lqcJefe, "PUT", ruta, { lineas: [...lineas, { categoria: "comision", cantidad: 1, costoUnitario: 1 }] }, /tipo de gasto de comisión/);
    await exigir(400, U.lqcJefe, "PUT", ruta, { lineas: [{ categoria: "ot_interna", ordenInternaId: crypto.randomUUID(), cantidad: 1, costoUnitario: 50000 }] }, /no es de esta OT/);
    const g = await ok(U.lqcJefe, "PUT", ruta, { lineas: [...lineas, { categoria: "ot_interna", descripcion: "Orden interna externa (servicio LME)", cantidad: 1, costoUnitario: 50000 }] });
    afirmar(g.resumen.porCategoria.comision.total === 228000 && g.resumen.porCategoria.ot_interna.total === 50000, `resumen ${JSON.stringify(g.resumen.porCategoria)}`);
    afirmar(!(g.sugerencias.lineas ?? []).some((x) => x.categoria === "comision"), "no vuelve a sugerir lo cargado");
    return `comisión ${g.resumen.porCategoria.comision.total} + OT internas ${g.resumen.porCategoria.ot_interna.total} = ${g.resumen.total}`;
  });

  /* ------------------------------------------------------------ T18 */
  await paso("BL-165 · PNC IDIC-PG12 desde la captura: «Reejecutar» devuelve el ensayo; escalar al Jefe de Sección", async () => {
    await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: "Agua potable", metodoIds: [C.mPh.id] }] });
    const rs = (await ok(U.lqcJefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.res = rs[rs.length - 1];
    await ok(U.lqcJefe, "POST", `/flujo/resultado/${C.res.id}/valor`, { valor: "7,2" });
    const base = { titulo: "PNC · pH fuera de control", descripcion: "Se usó un buffer vencido en la calibración del pHmetro", tipo: "ensayo", clase: "PNC", otId: C.ot.id };
    await exigir(400, U.lqcJefe, "POST", "/no-conformidades", base, /acción/);
    await exigir(400, U.lqcJefe, "POST", "/no-conformidades", { ...base, accion: "reejecutar" }, /ensayos afectados/);
    await exigir(400, U.lqcJefe, "POST", "/no-conformidades", { ...base, accion: "reejecutar", resultadoIds: [crypto.randomUUID()] }, /no es de la OT/);
    await exigir(403, U.ventas, "POST", "/no-conformidades", { ...base, accion: "reejecutar", resultadoIds: [C.res.id] });
    const nc = await ok(U.lqcJefe, "POST", "/no-conformidades", { ...base, accion: "reejecutar", resultadoIds: [C.res.id], costoNoCalidad: 15000 });
    afirmar(nc.clase === "PNC" && nc.formulario === "IDIC-PG12-FORM01" && nc.costoNoCalidad === 15000, `nc ${JSON.stringify([nc.clase, nc.formulario, nc.costoNoCalidad])}`);
    await exigir(403, U.lqcAnalista, "POST", `/no-conformidades/${nc.id}/ejecutar-accion`, {});
    await exigir(403, U.lpnJefe, "POST", `/no-conformidades/${nc.id}/ejecutar-accion`, {});
    const r = await ok(U.lqcJefe, "POST", `/no-conformidades/${nc.id}/ejecutar-accion`, {});
    afirmar(/1 ensayo/.test(r.mensaje) && r.accionEjecutadaAt, `mensaje ${r.mensaje}`);
    const est = (await ok(U.lqcJefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados.find((x) => x.id === C.res.id);
    afirmar(est.estado === "devuelto", `estado del ensayo ${est.estado}`);
    await exigir(409, U.lqcJefe, "POST", `/no-conformidades/${nc.id}/ejecutar-accion`, {}, /ya se ejecutó/);
    await exigir(400, U.lqcJefe, "POST", `/no-conformidades/${nc.id}/escalar`, { motivo: "x" });
    const e = await ok(U.lqcJefe, "POST", `/no-conformidades/${nc.id}/escalar`, { motivo: "Se repite en dos corridas: requiere análisis de la Sección" });
    afirmar(e.escaladaAt, "escalada");
    return `${nc.codigo} PNC · ensayo devuelto a la captura · escalada`;
  });

  await paso("BL-219 · Reclamos: Comercial registra, responde y cierra; el analista no", async () => {
    await exigir(403, U.lqcAnalista, "GET", "/reclamos");
    await exigir(400, U.ventas, "POST", "/reclamos", { fecha: hoyCl(), clienteId: C.cliente.id, motivo: "x", responsableRol: "JEFE_LAB" });
    const otro = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(77000000 + (Number(sello.slice(-5)) % 99999)), razonSocial: `Otro cliente ${sello}`, tipo: "particulares" });
    await exigir(400, U.ventas, "POST", "/reclamos", { fecha: hoyCl(), clienteId: otro.id, otId: C.ot.id, motivo: "Informe con error de unidad", responsableRol: "JEFE_LAB" }, /otro cliente/);
    const r = await ok(U.ventas, "POST", "/reclamos", { fecha: hoyCl(), clienteId: C.cliente.id, otId: C.ot.id, motivo: "El informe llegó con la unidad equivocada", responsableRol: "JEFE_LAB" });
    afirmar(r.estadoReclamo === "abierto" && r.unidadCodigo === "LQC", `reclamo ${r.estadoReclamo} ${r.unidadCodigo}`);
    await exigir(409, U.ventas, "POST", `/reclamos/${r.id}/cerrar`, {}, /respuesta/);
    await ok(U.ventas, "POST", `/reclamos/${r.id}/responder`, { respuesta: "Se reemitió el informe corregido el mismo día" });
    const c = await ok(U.ventas, "POST", `/reclamos/${r.id}/cerrar`, { comentario: "Cliente conforme" });
    afirmar(c.estadoReclamo === "cerrado", "cerrado");
    const l = await ok(U.ventas, "GET", "/reclamos?estado=cerrado");
    afirmar(l.data.some((x) => x.id === r.id), "en la lista de cerrados");
    return `${r.codigo} abierto → respondido → cerrado`;
  });

  await paso("BL-166 · Apelación de un Informe de Rechazo: plazo en días hábiles, la registra la jefatura y la resuelve el Director", async () => {
    const cuerpo = { otId: C.ot.id, documentoNumero: `IR-${sello}`, fechaRecepcionDoc: masDias(hoyCl(), -20), fechaIngreso: hoyCl(), fundamento: "El ensayo se hizo con la norma anterior a la del contrato" };
    await exigir(403, U.ventas, "POST", "/apelaciones", cuerpo);
    await exigir(403, U.lpnJefe, "POST", "/apelaciones", cuerpo);
    await exigir(400, U.lqcJefe, "POST", "/apelaciones", { ...cuerpo, fechaIngreso: masDias(hoyCl(), -30) }, /antes de recibir/);
    const a = await ok(U.lqcJefe, "POST", "/apelaciones", cuerpo);
    afirmar(a.fueraDePlazo === true && a.aviso && a.plazoDias === 5, `plazo ${a.fueraDePlazo} ${a.plazoDias}`);
    await exigir(409, U.lqcJefe, "POST", "/apelaciones", cuerpo, /en trámite/);
    await ok(U.lqcJefe, "POST", `/apelaciones/${a.id}/adjuntos`, pdf(`antecedentes-${sello}.pdf`));
    await exigir(403, U.lqcJefe, "POST", `/apelaciones/${a.id}/resolver`, { decision: "rechaza", resolucionFecha: hoyCl(), resolucionTexto: "No ha lugar" });
    const r = await ok(U.director, "POST", `/apelaciones/${a.id}/resolver`, { decision: "rechaza", resolucionFecha: hoyCl(), resolucionTexto: "Fuera de plazo y sin antecedentes nuevos" });
    afirmar(r.estado === "resuelta" && r.decision === "rechaza" && r.adjuntos.length === 1, "resuelta");
    await exigir(409, U.director, "POST", `/apelaciones/${a.id}/resolver`, { decision: "acoge", resolucionFecha: hoyCl(), resolucionTexto: "x x x x" }, /inapelable/);
    return `${a.codigo} fuera de plazo (vencía ${a.venceEl}) · rechazada por el Director`;
  });

  /* ------------------------------------------------------------ T19 */
  await paso("BL-167 · QC por método: tipos exigidos (MRC), criterio del método y aprobación por otra persona", async () => {
    const ruta = `/qc/metodos/${C.mPh.id}`;
    const antes = await ok(U.lqcJefe, "GET", ruta);
    try {
      await exigir(403, U.lqcAnalista, "PUT", ruta, { qcRequerido: true, qcTipos: ["mrc"] });
      await exigir(403, U.lpnJefe, "PUT", ruta, { qcRequerido: true, qcTipos: ["mrc"] });
      await exigir(400, U.calidad, "PUT", ruta, { qcRequerido: true, qcTipos: ["mrc", "otro"] }, /desconocido/);
      await exigir(400, U.calidad, "PUT", ruta, { qcRequerido: false, qcTipos: ["mrc"] }, /QC requerido/);
      const cfg = await ok(U.calidad, "PUT", ruta, { qcRequerido: true, qcTipos: ["mrc"], qcCriterios: { mrc: "95-105" } });
      afirmar(cfg.qcRequerido && cfg.qcTipos.join() === "mrc" && cfg.qcCriterios.mrc === "95-105", `cfg ${JSON.stringify(cfg)}`);
      let e = await ok(U.lqcJefe, "GET", `/qc/ot/${C.ot.id}`);
      const m = e.metodos.find((x) => x.id === C.mPh.id);
      afirmar(m && !m.aprobado && m.tiposFaltantes.join() === "mrc", `faltan ${JSON.stringify(m)}`);
      await exigir(400, U.lqcAnalista, "POST", `/qc/ot/${C.ot.id}/control`, { catMetodoId: C.mPh.id, tipo: "mrc", valorObtenido: 9.8 }, /valor certificado/);
      const c = await ok(U.lqcAnalista, "POST", `/qc/ot/${C.ot.id}/control`, { catMetodoId: C.mPh.id, tipo: "mrc", valorEsperado: 10, valorObtenido: 9.8, mrcReferencia: "MRC pH 7 lote 123" });
      afirmar(c.criterio === "95-105" && c.evaluacion === "aprobado" && c.resultado === "pendiente", `control ${JSON.stringify([c.criterio, c.evaluacion, c.resultado])}`);
      const malo = await ok(U.lqcAnalista, "POST", `/qc/ot/${C.ot.id}/control`, { catMetodoId: C.mPh.id, tipo: "mrc", valorEsperado: 10, valorObtenido: 8.9 });
      afirmar(malo.resultado === "rechazado", "89 % fuera de 95-105");
      await exigir(403, U.lqcAnalista, "PATCH", `/qc/control/${c.id}`, { resultado: "aprobado" }, /resultado.revisar/);
      await ok(U.lqcRevisor, "PATCH", `/qc/control/${c.id}`, { resultado: "aprobado" });
      e = await ok(U.lqcJefe, "GET", `/qc/ot/${C.ot.id}`);
      afirmar(e.metodos.find((x) => x.id === C.mPh.id).aprobado === true, "aprobado");
      return "MRC 98 % con criterio 95-105 del método · aprobado por el revisor";
    } finally {
      // Deja el método como estaba: otros guiones emiten informes con él.
      await ok(U.calidad, "PUT", ruta, { qcRequerido: !!antes.qcRequerido, qcTipos: antes.qcTipos ?? [], qcCriterios: antes.qcCriterios ?? {} });
    }
  });
}

main()
  .then(() => {
    console.log(`\nFrente r4d: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
