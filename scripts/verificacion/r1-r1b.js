#!/usr/bin/env node
/**
 * Verificación del frente r1b contra una API real (docs/FLUJO_LABORATORIO.md
 * › «Órdenes internas», docs/FLUJO_NUMERACION_DOCUMENTOS.md,
 * docs/FLUJO_DOCUMENTOS_POR_OT.md, docs/FLUJO_BPCH_CABECERA_OT.md). Recorre cada
 * proceso de punta a punta con los perfiles demo.*, cada regla con un perfil que
 * puede y otro que no:
 *   OI · órdenes internas: emitir (analista), bandeja de entrada del destino,
 *        recibir, responder (Nº, horas, costo), cerrar (resultados sin 0,00),
 *        dar por recibido (solicitante).
 *   NUM · numeración oficial por laboratorio y tipo: reglas, ejemplo, alcance
 *        del permiso, número del documento emitido.
 *   DOC · varios documentos vigentes por OT (por muestra, producto o
 *        laboratorio): cobertura, solapes, firmas, entrega, cierre e IE no emitido.
 *   BPCH · cabecera de inspección en la OT directa y en Producción Nacional.
 *
 * Uso:
 *   node scripts/verificacion/r1-r1b.js [--arrancar] [--base http://localhost:4721/api]
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA.
 * Deja datos de prueba (órdenes internas, documentos, cabeceras). Úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4721/api");
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
  const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
  sesiones[username] = { token: j.accessToken, permisos: carga.permisos ?? [] };
  return sesiones[username];
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const esForm = cuerpo instanceof FormData;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}) },
    body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
  });
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
async function rechazo(esperado, re, u, m, ruta, c) {
  const j = await exigir(esperado, u, m, ruta, c);
  if (re && !re.test(msg(j))) throw new Error(`${u} ${m} ${ruta}: el mensaje no explica el motivo (${msg(j)})`);
  return msg(j);
}

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
  const puerto = new URL(BASE).port || "4251";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1b-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };



const U = {
  admin: "demo.admin",
  calidad: "demo.calidad",            // documento.numeracion; sin orden_interna.emitir ni emisión
  lqcA1: "demo.lqc.analista1",        // emite órdenes internas (EP-01 2.2)
  lqcJefe: "demo.lqc.jefe",           // responder, pero el destino (LCC) no es suyo
  lpnA1: "demo.lpn.analista1",
  lpnJefe: "demo.lpn.jefe",
  lccJefe: "demo.lcc.jefe",           // laboratorio de destino: recibe, responde y cierra
  lccA1: "demo.lcc.analista1",        // captura en el destino; no recibe ni cierra
  lccRev: "demo.lcc.revisor",         // revisa en el destino (r1g: el destino revisa y aprueba lo suyo)
};
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? []);

async function seccionOrdenesInternas(C) {
  await paso("OI · preparar: OT abierta de LQC con muestra y laboratorio de destino LCC", async () => {
    const ots = lista(await ok(U.admin, "GET", "/ot?unidad=LQC&limit=100")).filter((o) => !["cerrada", "anulada"].includes(o.estado));
    for (const o of ots) {
      const reg = await ok(U.admin, "GET", `/flujo/ot/${o.id}/registro-muestras`);
      if ((reg.muestras ?? []).length) {
        C.ot = o;
        C.muestra = reg.muestras[0];
        break;
      }
    }
    afirmar(C.ot, "no hay OT abierta de LQC con muestras");
    const d = await ok(U.lqcA1, "GET", `/ordenes-internas/destinos?otId=${C.ot.id}`);
    C.lcc = d.find((x) => x.unidadCodigo === "LCC");
    afirmar(C.lcc, "LCC no figura como destino");
    // Un ensayo de LCC que aún no esté en la OT: cada vuelta del guion parte de un resultado nuevo.
    const e = await ok(U.lqcA1, "GET", `/ordenes-internas/destinos/${C.lcc.id}/ensayos?otId=${C.ot.id}`);
    C.candidatos = e.filter((x) => !x.enOt);
    C.ensayo = C.candidatos.shift();
    afirmar(C.ensayo, "LCC sin ensayos libres para derivar");
    return `${C.ot.codigo} · muestra ${C.muestra.codigo} · ${C.ensayo.nombre}`;
  });

  await paso("OI · 1 Emitir: el analista sí (EP-01 2.2); Calidad 403; otro laboratorio 403; sin requisito, fecha o muestra 400", async () => {
    const cuerpo = {
      otId: C.ot.id, destinoLab: C.lcc.id, ensayos: [C.ensayo.id], muestraId: C.muestra.id,
      requisito: "Cr total ≤ 3,0 % (E.T. punto 4.2)", fechaEnvio: hoy(), detalle: "Química del cuero (r1b)",
    };
    await exigir(403, U.calidad, "POST", "/ordenes-internas", cuerpo);
    await exigir(403, U.lpnA1, "POST", "/ordenes-internas", cuerpo);
    await rechazo(400, /requisito/, U.lqcA1, "POST", "/ordenes-internas", { ...cuerpo, requisito: "" });
    await rechazo(400, /fecha de envío/, U.lqcA1, "POST", "/ordenes-internas", { ...cuerpo, fechaEnvio: undefined });
    await rechazo(400, /muestra de origen/, U.lqcA1, "POST", "/ordenes-internas", { ...cuerpo, muestraId: undefined });
    C.cuerpoOi = cuerpo;
    C.oi = await ok(U.lqcA1, "POST", "/ordenes-internas", cuerpo);
    afirmar(/^OI-\d{4}-\d{4,}$/.test(C.oi.numero) && C.oi.estado === "abierta", JSON.stringify(C.oi).slice(0, 200));
    return C.oi.numero;
  });

  await paso("OI · bandeja de entrada: la ve el destino (LCC) con su origen; LPN no", async () => {
    const b = await ok(U.lccJefe, "GET", "/ordenes-internas/bandeja");
    const f = b.find((x) => x.id === C.oi.id);
    afirmar(f && f.otUnidadCodigo === "LQC" && f.muestraCodigo === C.muestra.codigo && /Cr total/.test(f.requisito), `fila ${JSON.stringify(f).slice(0, 240)}`);
    const otro = await ok(U.lpnJefe, "GET", "/ordenes-internas/bandeja?estado=todas");
    afirmar(!otro.some((x) => x.id === C.oi.id), "LPN la ve en su bandeja");
    // La bandeja es de llegada: LQC (que la emitió) no la tiene como entrada.
    const lqc = await ok(U.lqcJefe, "GET", "/ordenes-internas/bandeja?estado=todas");
    afirmar(!lqc.some((x) => x.id === C.oi.id), "el solicitante la ve en su bandeja de entrada");
    return `${b.length} en la bandeja de LCC`;
  });

  await paso("OI · 2 Recibir: el jefe de LCC sí y crea el ensayo en la muestra; analista 403; LQC y LPN 403 (destino ajeno)", async () => {
    await exigir(403, U.lccA1, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    await exigir(403, U.lpnJefe, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    await exigir(403, U.lqcJefe, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    let f = await ok(U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    afirmar(f.estado === "recibida" && f.recibidaAt, `estado ${f.estado}`);
    // Si el ensayo elegido no tiene método con analitos en el catálogo, no se crea nada: se anula y se prueba otro.
    for (let i = 0; !f.resultados.length && i < 10 && C.candidatos.length; i++) {
      await ok(U.lqcJefe, "POST", `/ordenes-internas/${C.oi.id}/anular`, { motivo: "Ensayo sin método en el catálogo (guion r1b)" });
      C.ensayo = C.candidatos.shift();
      C.oi = await ok(U.lqcA1, "POST", "/ordenes-internas", { ...C.cuerpoOi, ensayos: [C.ensayo.id] });
      f = await ok(U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    }
    afirmar(f.resultados.length >= 1 && f.resultados.every((r) => r.muestra === C.muestra.codigo), `resultados ${JSON.stringify(f.resultados).slice(0, 200)}`);
    afirmar(f.resultados.every((r) => r.estado === "pendiente"), `los resultados derivados no nacen pendientes: ${f.resultados.map((r) => r.estado)}`);
    C.resultados = f.resultados;
    await rechazo(409, /ya fue recibida/, U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    // Recibida: el solicitante ya no cambia el contenido.
    await rechazo(409, /ya fue recibida/, U.lqcA1, "PATCH", `/ordenes-internas/${C.oi.id}`, { requisito: "otro" });
    return `${f.resultados.length} resultado(s) del ensayo derivado en ${C.muestra.codigo}`;
  });

  await paso("OI · ficha: cada perfil ve solo los botones que la API acepta", async () => {
    const dest = await ok(U.lccJefe, "GET", `/ordenes-internas/${C.oi.id}`);
    afirmar(dest.puedo.responder && dest.puedo.cerrar && !dest.puedo.darPorRecibido && !dest.puedo.editar, `destino ${JSON.stringify(dest.puedo)}`);
    const orig = await ok(U.lqcA1, "GET", `/ordenes-internas/${C.oi.id}`);
    afirmar(!orig.puedo.responder && !orig.puedo.cerrar && !orig.puedo.recibir, `origen ${JSON.stringify(orig.puedo)}`);
    afirmar(/^I\.E\. N° \d+\/\d{4}$/.test(dest.respuestaNumeroPropuesto ?? ""), `número propuesto ${dest.respuestaNumeroPropuesto}`);
    await exigir(404, U.lpnJefe, "GET", `/ordenes-internas/${C.oi.id}`);
    return `propuesto ${dest.respuestaNumeroPropuesto}`;
  });

  await paso("OI · 3 Responder: validación (400), destino ajeno 403; guarda Nº «I.E. N° …/año», horas y costo directo", async () => {
    await rechazo(400, /horas/, U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/responder`, { horas: -1, costoDirecto: 1000 });
    await exigir(403, U.lqcJefe, "POST", `/ordenes-internas/${C.oi.id}/responder`, { horas: 1, costoDirecto: 1000 });
    const f = await ok(U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/responder`, {
      horas: 2.5, costoDirecto: 38500, insumos: "Ácido nítrico, patrón Cr", informe: "Cromo total en base seca según IUC 8.",
    });
    afirmar(/^I\.E\. N° \d+\/\d{4}$/.test(f.respuestaNumero) && f.respuestaHoras === 2.5 && f.costoDirecto === 38500, `respuesta ${f.respuestaNumero} ${f.respuestaHoras} ${f.costoDirecto}`);
    C.respuesta = f.respuestaNumero;
    return f.respuestaNumero;
  });

  await paso("OI · 4 Cerrar: sin resultados 409; con 0,00 sin observación 409; sin aprobar 409; aprobado por el destino → cerrada", async () => {
    await rechazo(409, /sin capturar|no tiene resultado/, U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {});
    // El analista de LCC captura en la muestra de LQC (solo los ensayos derivados): primero un 0 sin explicar.
    for (const r of C.resultados) {
      const cero = await llamar(U.lccA1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "0" });
      afirmar([200, 201].includes(cero.status), `el analista de LCC no pudo capturar en la muestra de LQC: ${cero.status} ${msg(cero.json)}`);
    }
    await rechazo(409, /0,00 sin observación/, U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {});
    // Un ensayo propio de LQC en la misma muestra no es del destino: 403.
    const ajeno = (await ok(U.admin, "GET", `/flujo/ot/${C.ot.id}/resultados`).catch(() => []));
    const propio = (Array.isArray(ajeno) ? ajeno : ajeno.data ?? ajeno.resultados ?? []).find((x) => !C.resultados.some((r) => r.id === x.id));
    if (propio) await exigir(403, U.lccA1, "POST", `/flujo/resultado/${propio.id}/valor`, { valor: "1" });
    for (const r of C.resultados)
      await ok(U.lccA1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "2,4", motivo: "Valor real; el 0 era una prueba", observacion: "Base seca" });
    await exigir(403, U.lccA1, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {});
    // r1g (recorrido MP-02, D02-02): el destino revisa y aprueba lo suyo antes de devolverlo.
    await rechazo(409, /sin aprobar/, U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {});
    await ok(U.lccRev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    await ok(U.lccJefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    const f = await ok(U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {});
    afirmar(f.estado === "cerrada" && f.cerradaAt, `estado ${f.estado}`);
    await rechazo(409, /cerrada/, U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/responder`, { horas: 1, costoDirecto: 1 });
    return `${C.oi.numero} cerrada con ${C.respuesta}`;
  });

  await paso("OI · Mi bandeja: «Órdenes internas por atender» (destino) e «Informes internos por integrar» (origen) cuadran con su lista", async () => {
    const tarjeta = async (u, clave) => (await ok(u, "GET", "/me/bandeja")).find((i) => i.clave === clave);
    const t1 = await tarjeta(U.lccJefe, "oi_por_atender");
    const pend = await ok(U.lccJefe, "GET", "/ordenes-internas/bandeja");
    afirmar(t1 && t1.cantidad === pend.length, `por atender ${t1?.cantidad} ≠ bandeja ${pend.length}`);
    const t2 = await tarjeta(U.lqcJefe, "oi_por_integrar");
    const todas = (await ok(U.lqcJefe, "GET", "/ordenes-internas?limit=500")).data;
    const n = todas.filter((o) => o.otUnidadCodigo === "LQC" && o.estado === "cerrada" && !o.aceptadaAt).length;
    afirmar(t2 && t2.cantidad === n && n >= 1, `por integrar ${t2?.cantidad} ≠ ${n}`);
    return `LCC por atender ${t1.cantidad} · LQC por integrar ${t2.cantidad}`;
  });

  await paso("OI · 5 Dar por recibido: LCC 403 (OT ajena); el analista de LQC sí; no se repite (409)", async () => {
    await exigir(403, U.lccJefe, "POST", `/ordenes-internas/${C.oi.id}/dar-por-recibido`, {});
    // Cerrada: el destino ya no captura en la muestra de origen.
    await exigir([403, 409], U.lccA1, "POST", `/flujo/resultado/${C.resultados[0].id}/valor`, { valor: "2,5", motivo: "Intento tras el cierre" });
    const f = await ok(U.lqcA1, "POST", `/ordenes-internas/${C.oi.id}/dar-por-recibido`, { observacion: "Integrado al informe de la OT" });
    afirmar(f.aceptadaAt && f.paso === 5, `paso ${f.paso}`);
    await rechazo(409, /ya se dio por recibida/, U.lqcA1, "POST", `/ordenes-internas/${C.oi.id}/dar-por-recibido`, {});
    const acciones = f.historial.map((h) => h.accion).join(",");
    afirmar(acciones === "creada,recibida,respondida,cerrada,dada_por_recibida", `historial ${acciones}`);
    afirmar(f.resultados.every((r) => r.valor === 2.4), `resultados ${JSON.stringify(f.resultados).slice(0, 160)}`);
    afirmar(f.costoDirectoOt >= 38500, `costo de la OT ${f.costoDirectoOt}`);
    return acciones;
  });

  await paso("OI · cerrar por PATCH ya no se puede (lo hace el destino con su respuesta)", async () => {
    const otra = await ok(U.lqcA1, "POST", "/ordenes-internas", {
      otId: C.ot.id, destinoLab: C.lcc.id, ensayos: [C.ensayo.id], muestraId: C.muestra.id, requisito: "Prueba de PATCH (r1b)", fechaEnvio: hoy(),
    });
    await ok(U.lccJefe, "POST", `/ordenes-internas/${otra.id}/recibir`, {});
    await rechazo(409, /Cerrar OT interna/, U.lqcA1, "PATCH", `/ordenes-internas/${otra.id}`, { estado: "cerrada" });
    // Anular: el analista emite pero no anula; la jefatura del laboratorio de la OT sí.
    await exigir(403, U.lqcA1, "POST", `/ordenes-internas/${otra.id}/anular`, { motivo: "Prueba del frente r1b" });
    await ok(U.lqcJefe, "POST", `/ordenes-internas/${otra.id}/anular`, { motivo: "Prueba del frente r1b" });
    return `${otra.numero} anulada por la jefatura`;
  });
}


const UD = {
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  jefe: "demo.lqc.jefe",
  a1: "demo.lqc.analista1",
  rev: "demo.lqc.revisor",
  lpnJefe: "demo.lpn.jefe",
};
const FIRMANTES = [
  "demo.lqc.jefe", "demo.lqc.revisor", "demo.lqc.analista1", "demo.lqc.analista2", "demo.dqo.jefe", "demo.director",
  "demo.calidad", "demo.squ.jefe", "demo.dco.jefe",
];
const idDe = async (u) => JSON.parse(Buffer.from((await login(u)).token.split(".")[1], "base64url").toString("utf8")).sub;

/** Firma un documento siguiendo la matriz (cada paso, con un responsable de prueba). */
async function firmarTodo(docId) {
  const porId = {};
  for (const u of FIRMANTES) {
    try { porId[await idDe(u)] = u; } catch { /* perfil opcional */ }
  }
  for (let vuelta = 0; vuelta < 8; vuelta++) {
    const circ = await ok(UD.jefe, "GET", `/informes/${docId}/circuito`);
    const estado = circ.documento?.estado ?? circ.estado;
    if (estado === "oficial") return;
    const pasosF = circ.pasos ?? circ.firmas ?? [];
    const pend = pasosF.filter((p) => p.estado === "pendiente").sort((a, b) => a.orden - b.orden);
    afirmar(pend.length, `documento ${estado} sin pasos pendientes`);
    const actual = pend.filter((p) => p.orden === pend[0].orden);
    for (const p of actual) {
      const quien = (p.responsables ?? []).map((r) => porId[r.usuarioId]).find(Boolean);
      afirmar(quien, `paso ${p.orden}: sin responsable de prueba (${(p.responsables ?? []).map((r) => r.nombre).join(", ")})`);
      await ok(quien, "POST", `/informes/${docId}/firmar`, {});
    }
  }
  throw new Error("el documento no quedó oficial");
}

async function seccionDocumentos(C) {
  await paso("DOC · preparar: OT de LQC con dos muestras y sus resultados aprobados", async () => {
    const buscar = async (codigo) => lista(await ok(UD.jefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
    C.mPh = await buscar("251");
    afirmar(C.mPh, "método pH (251) no encontrado");
    const labs = await ok(UD.planif, "GET", "/ot/laboratorios");
    C.lqcU = labs.find((u) => u.codigo === "LQC");
    C.lpnU = labs.find((u) => u.codigo === "LPN");
    const otLqc = lista(await ok(UD.planif, "GET", "/ot?unidad=LQC&limit=20")).find((o) => o.clienteId || o.cliente?.id);
    const ot = await ok(UD.planif, "POST", "/ot", { clienteId: otLqc.clienteId ?? otLqc.cliente.id, unidadPrincipalId: C.lqcU.id, notas: "Varios documentos por OT (r1b)" });
    C.docOt = ot;
    const r = await ok(UD.recepcion, "POST", `/flujo/ot/${ot.id}/muestras`, {
      muestras: [{ nombre: "Agua pozo A (r1b)", metodoIds: [C.mPh.id] }, { nombre: "Agua pozo B (r1b)", metodoIds: [C.mPh.id] }],
    });
    afirmar(r.muestras.length === 2, `muestras ${r.muestras.length}`);
    C.m1 = r.muestras[0];
    C.m2 = r.muestras[1];
    const rs = (await ok(UD.jefe, "GET", `/flujo/ot/${ot.id}/resultados`)).resultados;
    for (const x of rs) {
      if (!(x.limiteInf && x.limiteSup)) await ok(UD.a1, "PATCH", `/flujo/resultado/${x.id}/especificacion`, { limiteInf: "6,5", limiteSup: "8,5" });
      await ok(UD.a1, "POST", `/flujo/resultado/${x.id}/valor`, { valor: "7,1" });
    }
    await ok(UD.rev, "POST", `/resultados/ot/${ot.id}/revisar`, {});
    await ok(UD.jefe, "POST", `/resultados/ot/${ot.id}/aprobar`, {});
    const pl = [...lista(await ok(UD.jefe, "GET", "/plantillas?limit=100&search=BolAn")), ...lista(await ok(UD.jefe, "GET", "/plantillas?limit=200"))];
    C.plantilla = pl.find((p) => p.repid === "BolAn") ?? pl.find((p) => p.tipo === "BOLETIN" && p.activo !== false);
    afirmar(C.plantilla, "no hay plantilla de boletín");
    return `${ot.codigo} · ${C.m1.codigo}, ${C.m2.codigo} · ${rs.length} resultado(s) aprobados`;
  });

  await paso("DOC · cobertura: por muestra exige UNA muestra; la propuesta y el número salen de LQC", async () => {
    const base = { otId: C.docOt.id, plantillaId: C.plantilla.id };
    const mal = await ok(UD.jefe, "POST", "/informes/condiciones", { ...base, cobertura: { cobertura: "muestra", muestraIds: [C.m1.id, C.m2.id] } });
    afirmar(!mal.puedeEmitir && mal.faltantes.some((f) => /exactamente una muestra/.test(f)), `faltantes ${mal.faltantes}`);
    const c = await ok(UD.jefe, "POST", "/informes/condiciones", { ...base, cobertura: { cobertura: "muestra", muestraIds: [C.m1.id] } });
    afirmar(c.puedeEmitir, `no se puede emitir: ${c.faltantes.join(" ")}`);
    afirmar(/^IE LQC N° \d{3}\/\d{4}$/.test(c.numeracion?.numero ?? ""), `número propuesto ${c.numeracion?.numero}`);
    afirmar(c.cobertura?.etiqueta === `Muestra ${C.m1.codigo}`, `etiqueta ${c.cobertura?.etiqueta}`);
    const cob = await ok(UD.jefe, "GET", `/informes/ot/${C.docOt.id}/cobertura`);
    afirmar(cob.muestras.length === 2 && cob.muestras.every((m) => m.aprobados === m.resultados && m.resultados > 0), JSON.stringify(cob.muestras).slice(0, 200));
    await exigir(403, UD.lpnJefe, "GET", `/informes/ot/${C.docOt.id}/cobertura`);
    // Un laboratorio que no trabaja en la OT no se cuela pidiendo «por laboratorio».
    await exigir(403, UD.lpnJefe, "POST", "/informes/condiciones", { ...base, cobertura: { cobertura: "laboratorio", unidadId: C.lpnU.id } });
    return `propuesto ${c.numeracion.numero} · ${c.cobertura.etiqueta}`;
  });

  await paso("DOC · emitir el informe de la muestra 1: el analista no (403); dos de la misma muestra o uno de toda la OT, no (409)", async () => {
    const cuerpo = { otId: C.docOt.id, plantillaId: C.plantilla.id, cobertura: { cobertura: "muestra", muestraIds: [C.m1.id] } };
    await exigir(403, UD.a1, "POST", "/informes/emitir", cuerpo);
    const r = await ok(UD.jefe, "POST", "/informes/emitir", cuerpo);
    C.doc1 = r.certificado;
    afirmar(/^IE LQC N° \d{3}\/\d{4}$/.test(r.numero) && r.estado === "en_firma", `número ${r.numero} estado ${r.estado}`);
    afirmar(r.html.includes(C.m1.codigo) && !r.html.includes(C.m2.codigo), "el documento de la muestra 1 imprime otra muestra (o no imprime la suya)");
    await rechazo(409, /Ya existe el documento/, UD.jefe, "POST", "/informes/emitir", cuerpo);
    await rechazo(409, /Ya existe el documento/, UD.jefe, "POST", "/informes/emitir", { otId: C.docOt.id, plantillaId: C.plantilla.id });
    const docs = lista(await ok(UD.jefe, "GET", `/informes/documentos?otId=${C.docOt.id}`));
    afirmar(docs.some((d) => d.id === C.doc1.id && d.cobertura === `Muestra ${C.m1.codigo}`), "la lista no dice qué cubre el documento");
    return `${r.numero} · ${C.m1.codigo}`;
  });

  await paso("DOC · el cierre de la OT exige el documento de la muestra 2", async () => {
    const e = await ok(UD.planif, "GET", `/ot/${C.docOt.id}/cierre`);
    afirmar(e.faltantes.some((f) => f.includes(`La muestra ${C.m2.codigo} no tiene documento`)), `faltantes ${e.faltantes.join(" | ")}`);
    const a = await ok(UD.jefe, "GET", `/ot/${C.docOt.id}/avance`);
    afirmar(a.etapaActual !== "cierre" || /no tiene documento/.test(a.siguiente?.texto ?? ""), "la Ruta de la OT no lo dice");
    return "falta la muestra 2";
  });

  await paso("DOC · «no emitido» de la muestra 2 (LPN: no forma película): reserva número, exige motivo y ocupa su cobertura", async () => {
    const cuerpo = { otId: C.docOt.id, plantillaId: C.plantilla.id, cobertura: { cobertura: "muestra", muestraIds: [C.m2.id] } };
    await exigir(403, UD.lpnJefe, "POST", "/informes/no-emitido", { ...cuerpo, motivo: "No forma película" });
    await exigir(403, UD.a1, "POST", "/informes/no-emitido", { ...cuerpo, motivo: "No forma película" });
    await exigir(400, UD.jefe, "POST", "/informes/no-emitido", { ...cuerpo, motivo: "no" });
    await exigir(400, UD.jefe, "POST", "/informes/no-emitido", { ...cuerpo, cobertura: { cobertura: "ot" }, motivo: "Toda la OT no" });
    const r = await ok(UD.jefe, "POST", "/informes/no-emitido", { ...cuerpo, motivo: "La muestra no forma película (prueba r1b)" });
    afirmar(/^IE LQC N° \d{3}\/\d{4}$/.test(r.numero) && r.estado === "anulado" && r.noEmitido, JSON.stringify(r));
    afirmar(r.numero !== C.doc1.numero, "reutilizó el número");
    await rechazo(409, /no se emite/, UD.jefe, "POST", "/informes/emitir", cuerpo);
    const cob = await ok(UD.jefe, "GET", `/informes/ot/${C.docOt.id}/cobertura`);
    afirmar(cob.pendientes.length === 0, `pendientes ${cob.pendientes}`);
    C.noEmitido = r.numero;
    return `${r.numero} no emitido`;
  });

  await paso("DOC · el documento de la muestra 1: firmas de la matriz, entrega y cierre de la OT", async () => {
    await firmarTodo(C.doc1.id);
    await exigir(403, UD.a1, "POST", `/informes/${C.doc1.id}/entregar`, { medio: "mano", destinatario: "Cliente" });
    await ok(UD.planif, "POST", `/informes/${C.doc1.id}/entregar`, { medio: "correo", destinatario: "cliente@example.cl" });
    const e = await ok(UD.planif, "GET", `/ot/${C.docOt.id}/cierre`);
    afirmar(e.puedeCerrar, `no se puede cerrar: ${e.faltantes.join(" | ")}`);
    await ok(UD.planif, "POST", `/ot/${C.docOt.id}/cerrar`, {});
    const ot = await ok(UD.planif, "GET", `/ot/${C.docOt.id}`);
    afirmar(ot.estado === "cerrada", `estado ${ot.estado}`);
    return `${C.doc1.numero} oficial y entregado · ${C.noEmitido} no emitido · OT cerrada`;
  });
}


const UN = {
  admin: "demo.admin",
  calidad: "demo.calidad",      // documento.numeracion (Gestión de Calidad)
  lqcJefe: "demo.lqc.jefe",     // sin documento.numeracion
  ventas: "demo.ventas",
};

async function seccionNumeracion(C) {
  await paso("NUM · reglas sembradas por especificación (LPN, SVE, DSA, BPCH, respuesta a OI); el permiso es de Administración/Calidad", async () => {
    const r = await ok(UN.calidad, "GET", "/numeracion-documentos");
    const de = (u, t) => r.reglas.find((x) => x.activo && x.unidadCodigo === u && x.tipoDocumento === t);
    afirmar(de("LPN", "INFORME_ENSAYO")?.formato === "IE {LAB} N° {N:3}/{AAAA}", "falta la regla del IE de LPN");
    afirmar(de("SVE", "IVC")?.formato === "IVC.DQO.{LAB} Nº {OT_N}/{AAAA}", "falta la regla del IVC de LCC/LTX");
    afirmar(de("BPCH", "INFORME_INSPECCION")?.correlativoPorUnidad, "la regla del BPCH no numera por sucursal");
    afirmar(r.reglas.some((x) => x.unidadCodigo === "LRB" && x.tipoDocumento === null), "falta la regla del LRB");
    afirmar(r.reglas.some((x) => x.unidadCodigo === null && x.tipoDocumento === "RESPUESTA_OI"), "falta la regla general de la respuesta a OI");
    afirmar(r.tokens.length >= 10 && r.tipos.some((t) => t.codigo === "RESPUESTA_OI"), "sin tokens o tipos");
    await exigir(403, UN.lqcJefe, "GET", "/numeracion-documentos");
    await exigir(403, UN.ventas, "POST", "/numeracion-documentos/probar", { formato: "{N}" });
    return `${r.reglas.filter((x) => x.activo).length} reglas activas · ${r.reglas.filter((x) => x.porConfirmar).length} por confirmar`;
  });

  await paso("NUM · probar un formato: ejemplo en vivo y validación (token desconocido, sin dato variable)", async () => {
    const lab = (await ok(UN.admin, "GET", "/unidades")).find?.((u) => u.codigo === "LME") ?? lista(await ok(UN.admin, "GET", "/unidades")).find((u) => u.codigo === "LME");
    const p = await ok(UN.calidad, "POST", "/numeracion-documentos/probar", { formato: "IE {LAB} N° {N:3}/{AAAA}", unidadId: lab.id });
    afirmar(p.numero === `IE LME N° 007/${new Date().getFullYear()}`, `ejemplo ${p.numero}`);
    const m = await ok(UN.calidad, "POST", "/numeracion-documentos/probar", { formato: "IE {FOO}" });
    afirmar(m.numero === null && /desconocidos/.test(m.errores.join(" ")), JSON.stringify(m));
    await rechazo(400, /cambie por documento/, UN.calidad, "POST", "/numeracion-documentos", { formato: "IE {LAB}/{AAAA}" });
    C.lme = lab;
    return p.numero;
  });

  await paso("NUM · crear, editar y desactivar una regla (una activa por unidad y tipo: 409)", async () => {
    // Regla de prueba para un tipo que el LME no usa (no altera los documentos de los otros guiones).
    const previa = (await ok(UN.calidad, "GET", "/numeracion-documentos")).reglas.find((x) => x.activo && x.unidadCodigo === "LME" && x.tipoDocumento === "INFORME_TECNICO");
    if (previa) await ok(UN.calidad, "POST", `/numeracion-documentos/${previa.id}/desactivar`);
    await exigir(403, UN.lqcJefe, "POST", "/numeracion-documentos", { unidadId: C.lme.id, tipoDocumento: "INFORME_TECNICO", formato: "IT {LAB} {N}/{AAAA}" });
    const r = await ok(UN.calidad, "POST", "/numeracion-documentos", {
      unidadId: C.lme.id, tipoDocumento: "INFORME_TECNICO", formato: "IT {LAB} {N}/{AAAA}", reinicio: "anual", porConfirmar: true, fuente: "Prueba del guion r1b",
    });
    await rechazo(409, /Ya hay una regla activa/, UN.calidad, "POST", "/numeracion-documentos", { unidadId: C.lme.id, tipoDocumento: "INFORME_TECNICO", formato: "IT2 {N}" });
    const e = await ok(UN.calidad, "PATCH", `/numeracion-documentos/${r.id}`, { formato: "IT.{LAB} N° {N:3}/{AAAA}" });
    afirmar(e.formato === "IT.{LAB} N° {N:3}/{AAAA}", `formato ${e.formato}`);
    await rechazo(400, /desconocidos/, UN.calidad, "PATCH", `/numeracion-documentos/${r.id}`, { formato: "IT {X}{N}" });
    const d = await ok(UN.calidad, "POST", `/numeracion-documentos/${r.id}/desactivar`);
    afirmar(d.activo === false, "no quedó desactivada");
    await rechazo(409, /desactivada/, UN.calidad, "PATCH", `/numeracion-documentos/${r.id}`, { formato: "IT {N}" });
    return "creada · editada · desactivada";
  });

  await paso("NUM · el informe emitido en LQC lleva el número de su laboratorio y no se repite", async () => {
    afirmar(C.doc1 && C.noEmitido, "falta la sección DOC");
    const a = Number(C.doc1.numero.match(/N° (\d{3})\//)[1]);
    const b = Number(C.noEmitido.match(/N° (\d{3})\//)[1]);
    afirmar(b === a + 1, `correlativo ${a} → ${b}`);
    return `${C.doc1.numero} → ${C.noEmitido}`;
  });
}


const UB = {
  planif: "demo.planificacion",
  stgoJefe: "demo.sstgo.jefe",
  stgoInsp: "demo.sstgo.inspector",
  antofJefe: "demo.santof.jefe",
  lqcJefe: "demo.lqc.jefe",
  ventas: "demo.ventas",
  admin: "demo.admin",
};

async function seccionCabeceraBpch(C) {
  await paso("BPCH · OT directa de la Sucursal Santiago: sin cabecera no se emite el Informe de Inspección", async () => {
    const labs = await ok(UB.planif, "GET", "/ot/laboratorios");
    const sstgo = labs.find((u) => u.codigo === "SSTGO");
    afirmar(sstgo, "SSTGO no figura entre los laboratorios");
    const otRef = lista(await ok(UB.planif, "GET", "/ot?limit=20")).find((o) => o.clienteId || o.cliente?.id);
    C.otB = await ok(UB.planif, "POST", "/ot", { clienteId: otRef.clienteId ?? otRef.cliente.id, unidadPrincipalId: sstgo.id, notas: "OT directa de inspección (r1b)" });
    const f = await ok(UB.stgoJefe, "GET", `/bpch/cabecera-ot/${C.otB.id}`);
    afirmar(f.esBpch && f.proceso === "DIRECTA" && f.editable && f.faltantesEmision.some((x) => /Registre la cabecera/.test(x)), JSON.stringify(f).slice(0, 240));
    const pl = lista(await ok(UB.stgoJefe, "GET", "/plantillas?search=SCCII&limit=50"));
    C.plSccii = pl.find((p) => p.repid === "SCCII");
    afirmar(C.plSccii, "no hay plantilla SCCII");
    const c = await ok(UB.stgoJefe, "POST", "/informes/condiciones", { otId: C.otB.id, plantillaId: C.plSccii.id, tipoDocumento: "INFORME_INSPECCION" });
    afirmar(c.faltantes.some((x) => /cabecera de inspección/.test(x)), `faltantes ${c.faltantes.join(" | ")}`);
    const a = await ok(UB.stgoJefe, "GET", `/ot/${C.otB.id}/avance`);
    return `${C.otB.codigo} · etapa ${a.etapaActual}`;
  });

  await paso("BPCH · alcance y permisos: LQC 403; otra sucursal 403; Comercial no la registra (403); en una OT de LQC no aplica", async () => {
    await exigir(403, UB.lqcJefe, "GET", `/bpch/cabecera-ot/${C.otB.id}`);
    await exigir(403, UB.antofJefe, "PUT", `/bpch/cabecera-ot/${C.otB.id}`, { procedimiento: "SAC-PG01-P01" });
    await exigir(403, UB.ventas, "PUT", `/bpch/cabecera-ot/${C.otB.id}`, { procedimiento: "SAC-PG01-P01" });
    if (C.docOt) {
      const lqc = await ok(UB.lqcJefe, "GET", `/bpch/cabecera-ot/${C.docOt.id}`);
      afirmar(lqc.esBpch === false, "una OT de LQC dice tener cabecera BPCH");
      await rechazo(400, /no es de una unidad del Banco de Pruebas/, UB.admin, "PUT", `/bpch/cabecera-ot/${C.docOt.id}`, { procedimiento: "SAC-PG01-P01" });
    }
    return "403 · 403 · 403 · no aplica en LQC";
  });

  await paso("BPCH · el inspector registra la cabecera (EP-10 10.3): validación, «Guardar cabecera → muestrear lotes» e historial", async () => {
    const u = `/bpch/cabecera-ot/${C.otB.id}`;
    await rechazo(400, /procedimiento de control/, UB.stgoInsp, "PUT", u, { lugarInspeccion: "Polvorín de prueba (r1b)" });
    await rechazo(400, /CNC-DGMN/, UB.stgoInsp, "PUT", u, { procedimiento: "SAC-PG01-P01", cncDgmn: "123" });
    await rechazo(400, /no puede superar/, UB.stgoInsp, "PUT", u, { procedimiento: "SAC-PG01-P01", tamanoLote: 5, tamanoMuestra: 8 });
    const f = await ok(UB.stgoInsp, "PUT", u, {
      procedimiento: "SAC-PG01-P01", lugarInspeccion: "Polvorín de prueba (r1b)", direccion: "Camino de prueba km 3", comuna: "Comuna de prueba",
      fechaInspeccion: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" }), inspectores: "R. R. · N. C.", documentoOrigen: "Solicitud de prueba 1/2026",
      esquema: "LOTES", elementoEspecifico: "Emulsión de prueba", cncDgmn: "E-I/7/176/673/30365/3202", claseDivisionUn: "1.1D", numeroUn: "0241",
      identificacionLote: "L-PRUEBA-01", tamanoLote: 100, tamanoMuestra: 8,
    });
    afirmar(f.faltantesEmision.length === 0, `faltan ${f.faltantesEmision}`);
    afirmar(f.vista?.proceso === "DIRECTA" && f.vista.lugar_inspeccion === "Polvorín de prueba (r1b)" && f.vista.cnc_dgmn === "E-I/7/176/673/30365/3202", JSON.stringify(f.vista).slice(0, 240));
    const g = await ok(UB.stgoJefe, "PUT", u, { lugarInspeccion: "Polvorín de prueba 2 (r1b)" });
    afirmar(g.historial.length === 2 && g.historial[0].cambios.lugarInspeccion?.despues === "Polvorín de prueba 2 (r1b)", `historial ${JSON.stringify(g.historial).slice(0, 200)}`);
    // Sin cambios no ensucia el historial.
    const h = await ok(UB.stgoJefe, "PUT", u, { lugarInspeccion: "Polvorín de prueba 2 (r1b)" });
    afirmar(h.historial.length === 2, "un guardado sin cambios quedó en el historial");
    return `cabecera completa · ${g.historial.length} cambios en el historial`;
  });

  await paso("BPCH · la cabecera llega al Informe de Inspección (previsualización con {{bpch.*}})", async () => {
    const c = await ok(UB.stgoJefe, "POST", "/informes/condiciones", { otId: C.otB.id, plantillaId: C.plSccii.id, tipoDocumento: "INFORME_INSPECCION" });
    afirmar(!c.faltantes.some((x) => /cabecera de inspección/.test(x)), `aún falta la cabecera: ${c.faltantes.join(" | ")}`);
    const p = await ok(UB.stgoJefe, "POST", "/informes/previsualizar", { otId: C.otB.id, plantillaId: C.plSccii.id });
    const trozo = p.html.slice(Math.max(0, p.html.indexOf("Lugar de inspecci") - 40), p.html.indexOf("Lugar de inspecci") + 200);
    afirmar(p.html.includes("Polvorín de prueba 2 (r1b)") && p.html.includes("E-I/7/176/673/30365/3202"), `el documento no imprime la cabecera de la OT directa: ${trozo}`);
    afirmar(/3000\/\d{4}\/\d{5}\/\d{6}|CERT-/.test(p.html), "sin número en la vista previa");
    return "lugar y CNC impresos";
  });

  await paso("BPCH · internación: la cabecera vive en el expediente; en la OT solo dirección, comuna y contacto", async () => {
    const ints = lista(await ok(UB.admin, "GET", "/bpch/internaciones?limit=50"));
    let otI = null;
    for (const i of ints) {
      if (!i.otId) continue;
      const o = await ok(UB.admin, "GET", `/ot/${i.otId}`);
      if (!["cerrada", "anulada"].includes(o.estado)) { otI = o; break; }
    }
    if (!otI) return "sin internación abierta en la base (lo recorre bpch-internacion-reinspeccion.js)";
    await rechazo(400, /se registra en su expediente/, UB.admin, "PUT", `/bpch/cabecera-ot/${otI.id}`, { lugarInspeccion: "otro", direccion: "x" });
    const f = await ok(UB.admin, "PUT", `/bpch/cabecera-ot/${otI.id}`, { direccion: "Puerto de prueba, sitio 4", contacto: "Jefe de bodega" });
    afirmar(f.soloComplemento && f.vista?.proceso === "INTERNACION" && f.vista.direccion === "Puerto de prueba, sitio 4", JSON.stringify(f.vista).slice(0, 200));
    return `${otI.codigo}: dirección en la cabecera de la internación`;
  });
}

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  await seccionOrdenesInternas(C);
  await seccionDocumentos(C);
  await seccionNumeracion(C);
  await seccionCabeceraBpch(C);
}

main()
  .then(() => {
    console.log(`\n${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    console.error(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
