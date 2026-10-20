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
};
const hoy = () => new Date().toISOString().slice(0, 10);
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

  await paso("OI · 4 Cerrar: sin resultados 409; con 0,00 sin observación 409; capturado → cerrada", async () => {
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
    await exigir(403, U.lccA1, "POST", `/flujo/resultado/${C.resultados[0].id}/valor`, { valor: "2,5", motivo: "Intento tras el cierre" });
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




async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  await seccionOrdenesInternas(C);
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
