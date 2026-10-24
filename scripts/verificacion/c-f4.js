#!/usr/bin/env node
/**
 * Frente f4 · Diferencias del recorrido de los manuales v2.1 (24-10-2026) y
 * nombres ficticios en la demostración. Reproduce cada diferencia corregida con
 * un perfil demo.* que puede y otro que no (Diferencias_Recorrido_MP-*_Aiuken.xlsx).
 *
 * Uso:
 *   node scripts/verificacion/c-f4.js [--base http://localhost:5031/api]
 *   DATABASE_URL=… node scripts/verificacion/c-f4.js --arrancar
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:5031/api");
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
    sesiones[username] = { token: j.accessToken };
    return sesiones[username];
  }
  throw new Error(`login ${username}: demasiados intentos`);
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = username ? await login(username) : null;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
      ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) =>
  (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 400);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);
const dato = (j) => j?.data ?? j;

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
  const puerto = new URL(BASE).port || "5031";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:5032",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-f4-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  ventas: "demo.ventas",
  dco: "demo.dco.jefe",
  planif: "demo.planificacion",
  calidad: "demo.calidad",
  abast: "demo.abastecimiento",
  muestreo: "demo.muestreo",
  lccJefe: "demo.lcc.jefe",
  lccA1: "demo.lcc.analista1",
  lqaJefe: "demo.lqa.jefe",
  lmbJefe: "demo.lmb.jefe",
  lpnJefe: "demo.lpn.jefe",
  lqcA1: "demo.lqc.analista1",
  lqcJefe: "demo.lqc.jefe",
  lmtJefe: "demo.lmt.jefe",
  metro: "demo.lmt.analista1",
  svmJefe: "demo.svm.jefe",
  svmA1: "demo.svm.analista1",
  scc: "demo.scc.jefe",
  bpch: "demo.bpch.jefe",
  stgo: "demo.sstgo.jefe",
};
const sello = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
const recibido = { tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple" };
const C = {};

async function main() {
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  console.log(`Frente f4 · ${BASE}\n`);

  await paso("Preparación: laboratorios y cliente de prueba", async () => {
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    for (const c of ["LCC", "LQA", "LMB", "LMT", "SVM", "LQC"]) {
      C[c] = labs.find((u) => u.codigo === c);
      afirmar(C[c], `${c} no figura en /ot/laboratorios`);
    }
    C.cliente = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(76000000 + (parseInt(sello.slice(-6), 36) % 999999)), razonSocial: `Cliente prueba f4 ${sello}`, tipo: "particulares",
      direccion: "Av. Prueba 123, Santiago",
    });
    return C.cliente.razonSocial;
  });

  /* ------------------------------------------------------------ D03-18 */
  await paso("D03-18 · Registrar la OT por la E.T.: la muestra del producto solo con sus métodos; los del componente van a su submuestra (Ventas no desglosa: 403)", async () => {
    const cat = await ok(U.lccJefe, "GET", `/especificaciones-tecnicas/catalogo/metodos?laboratorio=${C.LCC.id}`);
    const conUno = (cat.metodos ?? []).filter((m) => m.analitos.length === 1);
    afirmar(conUno.length >= 2, "faltan dos métodos del LCC con un analito");
    const [mProd, mComp] = conUno;
    const et = await ok(U.lccJefe, "POST", "/especificaciones-tecnicas", { codigo: `ET-F4-${sello}`, nombre: "Bota f4", laboratorios: [C.LCC.id], origen: "cliente" });
    await ok(U.lccJefe, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, {
      puntos: [
        { punto: "1", caracteristica: "Ensayo del producto", tipo: "numerico", catMetodoId: mProd.id, limiteInf: "0" },
        { punto: "2", caracteristica: "Ensayo del componente", tipo: "numerico", catMetodoId: mComp.id, limiteInf: "0", componente: "Planta" },
      ],
    });
    const pub = await ok(U.lccJefe, "POST", `/especificaciones-tecnicas/${et.id}/publicar`);
    const etId = pub.id ?? et.id;
    const det = await ok(U.lccJefe, "GET", `/especificaciones-tecnicas/${etId}`);
    afirmar(JSON.stringify(det.metodosProducto) === JSON.stringify([mProd.id]), `metodosProducto ${JSON.stringify(det.metodosProducto)}`);
    // «Registrar OT» crea la muestra del producto con metodosProducto (lo que envía la pantalla).
    C.otEt = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.LCC.id, conCobro: false, prioridad: "normal", fechaIngreso: new Date().toISOString(),
      etId, muestras: [{ nombre: "Par de botas f4", metodoIds: det.metodosProducto }],
    });
    const reg = await ok(U.lccA1, "GET", `/flujo/ot/${C.otEt.id}/registro-muestras`);
    const m1 = reg.muestras[0];
    await exigir(403, U.ventas, "POST", `/especificaciones-tecnicas/muestra/${m1.id}/desglose`, {});
    await ok(U.lccA1, "POST", `/especificaciones-tecnicas/muestra/${m1.id}/desglose`, {});
    const res = await ok(U.lccA1, "GET", `/flujo/ot/${C.otEt.id}/resultados`);
    const de = (id) => res.resultados.filter((r) => r.muestraId === id).map((r) => r.catMetodoId ?? r.metodoId);
    const sub = (await ok(U.lccA1, "GET", `/flujo/ot/${C.otEt.id}/registro-muestras`)).muestras.find((x) => x.id !== m1.id);
    afirmar(sub, "sin submuestra del componente");
    const enM1 = de(m1.id), enC1 = de(sub.id);
    afirmar(enM1.length === 1 && !res.resultados.some((r) => r.muestraId === m1.id && /componente/i.test(r.especFuente ?? "") ), `M1: ${enM1.length} ensayo(s)`);
    afirmar(enC1.length === 1, `C1: ${enC1.length} ensayo(s)`);
    return `${C.otEt.codigo ?? ""}: M1 ${enM1.length} ensayo · ${sub.codigo} ${enC1.length} ensayo (sin duplicados)`;
  });

  /* ------------------------------------------------------------ D04-28 */
  await paso("D04-28 · Los proveedores de la demostración son ficticios (Abastecimiento los ve; un analista no: 403)", async () => {
    const reales = /agilent|merck|calibraciones metrol|instru-lab|indura|cesmec|perkinelmer|hanna|instron/i;
    await exigir(403, U.lqcA1, "GET", "/proveedores?limit=200");
    const ps = lista(await ok(U.abast, "GET", "/proveedores?limit=200"));
    const demo = ps.filter((p) => /^Proveedor Prueba [1-5] Aiuken S\.A\.$/.test(p.razonSocial));
    afirmar(demo.length === 5 && demo.every((p) => /^99\.999\.91[1-5]-[\dK]$/.test(p.rut ?? "")), `proveedores ficticios: ${demo.map((p) => `${p.razonSocial} ${p.rut}`).join(" | ")}`);
    afirmar(!ps.some((p) => reales.test(p.razonSocial)), "queda un proveedor con nombre de empresa real");
    const eq = lista(await ok(U.calidad, "GET", "/equipos?search=EQ-&limit=50"));
    for (const e of eq.slice(0, 8)) {
      const cal = lista(await ok(U.calidad, "GET", `/equipos/${e.id}/calibraciones`));
      afirmar(!cal.some((c) => reales.test(String(c.ejecutadaPor ?? c.ejecutada_por ?? ""))), `${e.codigo}: laboratorio real en su calibración`);
    }
    return `${demo.length} proveedores ficticios · ${eq.length} equipos sin laboratorios reales`;
  });

  /* ---------------------------------------------- D01-14 · D01-21 (catálogo) */
  await paso("D01-14 · Viscosidad Stormer: especificaciones en K.U. · D01-21 · Sólidos en peso (613): 3 lecturas para ((C1 − C2) / C3) × 100", async () => {
    const met = async (codigo) => lista(await ok(U.lpnJefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
    const st = await met("661");
    afirmar(st, "sin método 661");
    const an = lista(await ok(U.lpnJefe, "GET", `/cascada/metodos/${st.id}/analitos`));
    afirmar(an.length, "661 sin analitos");
    const es = lista(await ok(U.lpnJefe, "GET", `/cascada/analitos/${an[0].id}/especificaciones`));
    afirmar(es.length && es.every((e) => e.unidad === "K.U."), `unidades ${es.map((e) => e.unidad).join(",")}`);
    const sol = await met("613");
    const pasosM = lista(await ok(U.lpnJefe, "GET", `/pasos-metodo?catMetodoId=${sol.id}&activo=true&limit=50`)).filter((p) => p.activo !== false);
    afirmar(pasosM.length === 3 && pasosM.map((p) => p.unidad).every((u) => u === "g"), `613: ${pasosM.map((p) => `${p.orden}:${p.nombre}`).join(" | ")}`);
    await exigir(403, U.ventas, "POST", "/pasos-metodo", { catMetodoId: sol.id, orden: 9, nombre: "Otro campo", tipoDato: "numero" });
    return `661: ${es.length} especificación(es) en K.U. · 613: ${pasosM.map((p) => p.nombre).join(" / ")}`;
  });

  /* ------------------------------------------------------------ D02-44 */
  await paso("D02-44 · Jefatura de un laboratorio que participa (LMB en OT del LQA): la propuesta ya elige su laboratorio y ve las fotos; LPN no (403)", async () => {
    const el = lista(await ok(U.lqaJefe, "GET", "/cat/elementos?search=Bromatolog&limit=20")).find((e) => e.codigo === "86")
      ?? lista(await ok(U.lqaJefe, "GET", "/cat/elementos?search=86&limit=50")).find((e) => e.codigo === "86");
    afirmar(el, "sin elemento 86 (LQA)");
    const panel = lista(await ok(U.lqaJefe, "GET", `/cascada/elementos/${el.id}/panel`));
    C.otAli = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.LQA.id, conCobro: false, prioridad: "normal", fechaIngreso: new Date().toISOString(),
      muestras: [{ catElementoId: el.id, nombre: "Queso f4", metodoIds: [panel[0].metodoId] }],
    });
    // El LQA deriva un ensayo al LMB por orden interna: el LMB trabaja en la OT (B-002).
    const reg = await ok(U.lqaJefe, "GET", `/flujo/ot/${C.otAli.id}/registro-muestras`);
    const lmb = (await ok(U.lqaJefe, "GET", `/ordenes-internas/destinos?otId=${C.otAli.id}`)).find((d) => d.unidadCodigo === "LMB");
    afirmar(lmb, "LMB no figura como destino de la orden interna");
    const ens = await ok(U.lqaJefe, "GET", `/ordenes-internas/destinos/${lmb.id}/ensayos?otId=${C.otAli.id}`);
    await ok(U.lqaJefe, "POST", "/ordenes-internas", {
      otId: C.otAli.id, destinoLab: lmb.id, ensayos: [ens[0].id], detalle: "Recuento microbiológico (f4)", muestraId: reg.muestras[0].id, requisito: "RSA", fechaEnvio: hoyCl(),
    });
    const pl = lista(await ok(U.lqaJefe, "GET", "/plantillas?limit=300"));
    const p = pl.find((x) => x.repid === "PG09A2") ?? pl.find((x) => x.tipo === "I.ENSAYO");
    const prop = await ok(U.lmbJefe, "POST", "/informes/propuesta", { otId: C.otAli.id, plantillaId: p.id });
    afirmar(prop.cobertura?.cobertura === "laboratorio" && prop.cobertura?.unidadId === C.LMB.id, `cobertura ${JSON.stringify(prop.cobertura)}`);
    const cond = await ok(U.lmbJefe, "POST", "/informes/condiciones", { otId: C.otAli.id, plantillaId: p.id, cobertura: { cobertura: "laboratorio", unidadId: C.LMB.id } });
    afirmar(Array.isArray(cond.faltantes), "condiciones sin faltantes");
    await ok(U.lmbJefe, "GET", `/informes/ot/${C.otAli.id}/fotos`);
    const propLqa = await ok(U.lqaJefe, "POST", "/informes/propuesta", { otId: C.otAli.id, plantillaId: p.id });
    afirmar(propLqa.cobertura?.unidadId == null, "al responsable se le propuso un laboratorio");
    await exigir(403, U.lpnJefe, "GET", `/informes/ot/${C.otAli.id}/fotos`);
    await exigir(403, U.lpnJefe, "POST", "/informes/propuesta", { otId: C.otAli.id, plantillaId: p.id });
    return `propuesta LMB «${prop.cobertura.cobertura}» · fotos 200 · LPN 403`;
  });

  /* ------------------------------------------------------------ D03-19 */
  await paso("D03-19 · OT que requiere muestreo: la ruta sigue en Recepción (le toca a la Sección Muestreo) aunque tenga muestras", async () => {
    const cat = await ok(U.lccJefe, "GET", `/especificaciones-tecnicas/catalogo/metodos?laboratorio=${C.LCC.id}`);
    const m = (cat.metodos ?? []).find((x) => x.analitos.length === 1);
    const ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.LCC.id, conCobro: false, prioridad: "normal", fechaIngreso: new Date().toISOString(),
      requiereMuestreo: true, muestras: [{ nombre: "Lote de botas f4", metodoIds: [m.id] }],
    });
    const a = dato(await ok(U.lccJefe, "GET", `/ot/${ot.id}/avance`));
    afirmar(a.etapaActual === "recepcion" && /Registrar el muestreo/.test(a.siguiente?.texto ?? ""), `ruta ${a.etapaActual} · ${a.siguiente?.texto}`);
    afirmar(a.siguiente?.leToca?.rol === "Sección Muestreo", `le toca a ${a.siguiente?.leToca?.rol}`);
    const sin = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.LCC.id, conCobro: false, prioridad: "normal", fechaIngreso: new Date().toISOString(),
      requiereMuestreo: false, muestras: [{ nombre: "Botas sin muestreo f4", metodoIds: [m.id] }],
    });
    const b = dato(await ok(U.lccJefe, "GET", `/ot/${sin.id}/avance`));
    afirmar(b.etapaActual !== "recepcion", `sin muestreo sigue en ${b.etapaActual}`);
    await exigir(403, U.lpnJefe, "GET", `/ot/${ot.id}/avance`);
    return `con muestreo: «${a.siguiente.texto}» · sin muestreo: ${b.etapaActual}`;
  });

  /* ------------------------------------------- D04-26 · D04-27 · D04-29 */
  await paso("D04-26/27 · La OT de calibración entrega solicitante, contacto y dirección; el informe técnico imprime el solicitante", async () => {
    const svc = lista(await ok(U.ventas, "GET", "/cat/ensayos?search=EN1074&limit=5")).find((e) => e.codigo === "EN1074");
    afirmar(svc, "falta el servicio EN1074 en el catálogo");
    const cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", plazoEntregaDias: 15, referencia: `F4 metrología ${sello}`, solicitud: { solicitanteNombre: "M. R. Prueba f4" },
      lineas: [{ catEnsayoId: svc.id, cantidad: 1 }],
    });
    await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/aceptar`, { tipo: "OC", numero: `OC-F4-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.LMT.id });
    C.otMet = await ok(U.lmtJefe, "GET", `/ot/${r?.ot?.id ?? r?.otId ?? r?.ot_id}`);
    await ok(U.lmtJefe, "POST", `/ot/${C.otMet.id}/instrumentos/desde-cotizacion`);
    const res = await ok(U.lmtJefe, "GET", `/ot/${C.otMet.id}/metrologia`);
    afirmar(res.ot.solicitante === "M. R. Prueba f4" && res.ot.clienteDireccion === "Av. Prueba 123, Santiago", `ot ${JSON.stringify({ s: res.ot.solicitante, d: res.ot.clienteDireccion })}`);
    C.iMet = res.instrumentos[0].id;
    await ok(U.lmtJefe, "PUT", `/ot/${C.otMet.id}/instrumentos/${C.iMet}`, { descripcion: "Balanza dañada (prueba f4)", serie: `BF4-${sello}`, procesoCodigo: "ITM02" });
    await ok(U.metro, "POST", `/ot/${C.otMet.id}/instrumentos/${C.iMet}/recepcion`, {
      fechaHora: new Date().toISOString(), entregadoPor: "Cliente de prueba f4", estadoFisico: "danado", ubicacion: "Estante F4", calibrable: false,
      estadoFisicoObs: "Golpe en la carcasa", motivoNoCalibrable: "No repite la indicación",
    });
    const b = `/ot/${C.otMet.id}/instrumentos/${C.iMet}`;
    await ok(U.metro, "POST", `${b}/informe-tecnico`, { motivo: "No repite la indicación", hallazgos: "Golpe en la carcasa", recomendacion: "Reparar" });
    const h = await ok(U.metro, "GET", `${b}/informe-tecnico/html`);
    const html = h?.html ?? h?.data?.html ?? String(h);
    afirmar(/<th>Solicitante<\/th><td>M\. R\. Prueba f4<\/td>/.test(html), "el informe técnico no imprime el solicitante");
    await exigir(403, U.lqcJefe, "GET", `/ot/${C.otMet.id}/metrologia`);
    return `${C.otMet.codigo}: solicitante «${res.ot.solicitante}», contacto «${res.ot.contacto ?? "—"}», informe técnico con solicitante`;
  });

  await paso("D04-29 · Todo entregado y devuelto: «Falta el cierre técnico» (no figura en listas para cerrar); tras «Cerrar técnicamente» (el metrólogo no), «Lista para cerrar»", async () => {
    const b = `/ot/${C.otMet.id}/instrumentos/${C.iMet}`;
    await ok(U.metro, "POST", `${b}/informe-tecnico/enviar`);
    await ok(U.lmtJefe, "POST", `${b}/informe-tecnico/emitir`);
    await ok(U.ventas, "POST", `${b}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    await ok(U.metro, "POST", `${b}/devolucion`, { fechaHora: new Date().toISOString(), recibidoPor: "Encargado del cliente", estadoFisico: "danado", observacion: "Se devuelve sin calibrar" });
    const cierre = (a) => (a.etapas ?? []).find((e) => e.clave === "cierre");
    const enListas = async () => lista(await ok(U.planif, "GET", `/ot?listasCierre=1&search=${encodeURIComponent(C.otMet.codigo)}&limit=50`)).some((x) => x.id === C.otMet.id);
    let a = dato(await ok(U.planif, "GET", `/ot/${C.otMet.id}/avance`));
    afirmar(a.etapaActual === "cierre" && cierre(a)?.detalle === "Falta el cierre técnico" && /^Cerrar técnicamente/.test(a.siguiente?.texto ?? ""), `ruta ${cierre(a)?.detalle} · ${a.siguiente?.texto}`);
    afirmar(!(await enListas()), "figura en «OT listas para cerrar» antes del cierre técnico");
    await exigir(403, U.metro, "POST", `/ot/${C.otMet.id}/metrologia/cierre-tecnico`);
    await ok(U.lmtJefe, "POST", `/ot/${C.otMet.id}/metrologia/cierre-tecnico`);
    a = dato(await ok(U.planif, "GET", `/ot/${C.otMet.id}/avance`));
    afirmar(cierre(a)?.detalle === "Lista para cerrar", `tras el cierre técnico: ${cierre(a)?.detalle}`);
    afirmar(await enListas(), "no figura en «OT listas para cerrar» tras el cierre técnico");
    const enc = lista(await ok(U.ventas, "GET", "/encuestas?estado=pendiente&limit=500")).some((e) => e.codigo === `ENC-${C.otMet.codigo}`);
    return `antes: «Falta el cierre técnico» · después: «Lista para cerrar» · encuesta pendiente al finalizar: ${enc ? "sí (EP-00 9.1)" : "no"}`;
  });

  /* ------------------------------------------------------------ D05-21 */
  await paso("D05-21 · La HCP propone chasis, motor, año y km de la recepción del vehículo (Jefe SVM; LQC no: 403)", async () => {
    const cat = await ok(U.svmJefe, "GET", `/especificaciones-tecnicas/catalogo/metodos?laboratorio=${C.SVM.id}`).catch(() => null);
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.SVM.id, conCobro: false, prioridad: "normal", fechaIngreso: new Date().toISOString() });
    const datos = { chasis: `9BW-F4-${sello}`.slice(0, 30), motor: "MTR-F4-01", anio: 2025, km: 1250.5 };
    const mets = (cat?.metodos ?? []).slice(0, 1).map((m) => m.id);
    await ok(U.svmJefe, "POST", `/flujo/ot/${ot.id}/muestras`, { muestras: [{ nombre: "Vehículo f4 Nº 1", metodoIds: mets, recepcion: { ...recibido, datos } }] });
    const v = await ok(U.svmJefe, "GET", `/formularios/ot/${ot.id}/hcp`);
    const r = v.vehiculos?.[0]?.recepcion;
    afirmar(r && r.chasis === datos.chasis && r.motor === datos.motor && r.anio === 2025 && r.kmLlegada === 1250.5, `recepción en la HCP: ${JSON.stringify(r)}`);
    await exigir(403, U.lqcJefe, "GET", `/formularios/ot/${ot.id}/hcp`);
    return `cabecera propuesta: ${r.chasis} · ${r.motor} · ${r.anio} · ${r.kmLlegada} km`;
  });

  /* ------------------------------------------------------------ D07-12 */
  await paso("D07-12 · Producción Nacional: la cabecera de la OT propone el tamaño del lote = cantidad programada (LQC no la ve: 403)", async () => {
    const anio = new Date().getFullYear();
    const mes = new Date().getMonth() + 1;
    const cfg = await ok(U.scc, "GET", "/bpch/pn/config");
    const unidades = Object.fromEntries(cfg.unidades.map((u) => [u.codigo, u]));
    const tipo = (cfg.tiposCliente.find((t) => t.codigo === "ley_17798") ?? cfg.tiposCliente[0]).codigo;
    const fab = await ok(U.scc, "POST", "/bpch/pn/fabricantes", {
      rut: rutValido(70000000 + (parseInt(sello.slice(-6), 36) % 999999)), razonSocial: `Fabricante prueba f4 ${sello}`, tipo, ciudad: "Santiago",
    });
    const raf = await ok(U.scc, "POST", "/bpch/pn/rafs", {
      clienteId: fab.id, numero: `RAF-F4-${sello}`, fecha: `${anio}-01-10`, tipoLinea: "FIJA", planta: "Planta de prueba f4",
      vigenciaHasta: `${anio + 1}-12-31`, listadoProductos: "Emulsión encartuchada", resAlmacenamiento: `Res. f4 ${sello}`,
    });
    const oc = await ok(U.bpch, "POST", "/bpch/pn/oc", {
      rafId: raf.id, numero: `OC-F4-${sello}`, anio, vigenciaDesde: `${anio}-01-01`, vigenciaHasta: `${anio}-12-31`, conCobro: false,
      productos: [{ producto: "Emulsión encartuchada f4", unidadMedida: "u", cantidadAutorizada: 5000 }],
    });
    const prog = await ok(U.stgo, "POST", `/bpch/pn/oc/${oc.id}/programa`, {
      lineas: [{ ocProductoId: oc.productos[0].id, unidadId: unidades.SSTGO.id, mes, lote: `L-F4-${sello}`, cantidad: 1200 }],
    });
    const linea = prog.programa.find((l) => l.unidad.codigo === "SSTGO");
    const g = await ok(U.stgo, "POST", `/bpch/pn/programa/${linea.id}/generar-ot`);
    const f = await ok(U.stgo, "GET", `/bpch/cabecera-ot/${g.ot.id}`);
    afirmar(f.heredados?.tamanoLote === 1200 && f.heredados?.identificacionLote === `L-F4-${sello}`, `heredados ${JSON.stringify(f.heredados)}`);
    await exigir(403, U.lqcJefe, "GET", `/bpch/cabecera-ot/${g.ot.id}`);
    C.otPn = g.ot;
    return `${g.ot.codigo}: tamaño del lote propuesto ${f.heredados.tamanoLote} · lote ${f.heredados.identificacionLote}`;
  });

  /* ------------------------------------------------------------ D10-12 */
  await paso("D10-12 · La fecha de compromiso que la OT toma por defecto queda con origen «plazo_defecto» (no «manual»)", async () => {
    const c = await ok(U.planif, "GET", `/ot/${C.otAli.id}/cierre`);
    afirmar(c.plazo?.fechaCompromiso && c.plazo?.origen === "plazo_defecto", `plazo ${JSON.stringify(c.plazo && { f: c.plazo.fechaCompromiso, o: c.plazo.origen })}`);
    await exigir(403, U.lpnJefe, "GET", `/ot/${C.otAli.id}/cierre`);
    return `${c.plazo.fechaCompromiso} · origen ${c.plazo.origen}`;
  });
}

main()
  .then(() => {
    const fallos = pasos.filter((p) => !p.ok).length;
    console.log(fallos ? `\nFrente f4: ${pasos.length - fallos} pasos OK, ${fallos} con fallo.` : `\nFrente f4: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(fallos ? 1 : 0);
  })
  .catch((e) => {
    console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    pararApi();
    process.exit(1);
  });
