#!/usr/bin/env node
/**
 * Frente r1g · correcciones del recorrido en pantalla de los manuales MP-02
 * (Sección Alimentos) y MP-06 (BPCH · Internaciones). Reproduce cada fallo
 * corregido con un perfil que puede y otro que no:
 *
 *   D02-01 · Nº interno (bigint): GET /muestras?otId= y /recepcion/retenciones
 *            responden 200 con el número como texto (antes 500 «BigInt»).
 *   D02-02 · Orden interna: el analista y el jefe del laboratorio de destino (LMB)
 *            capturan, revisan y aprueban SOLO los ensayos derivados y solo con la
 *            orden recibida; cerrada la orden, ya no.
 *   D02-03 · «< 10» frente a Máx 100 → cumple; «< 10» frente a un Mín 0,0001 → sin
 *            veredicto: no se revisa ni aprueba hasta decidirlo; lo decide el
 *            revisor (el analista no).
 *   D02-04 · Alcance por ensayo: el LQA ve los derivados en solo lectura y no los
 *            revisa ni aprueba; el LES no ve la OT; bandejas por laboratorio dueño.
 *   D06-05 · Quien revisó no aprueba (409); lo aprueba otra jefatura.
 *   D02-07 · «Un laboratorio» sin elegir no dice «sin laboratorio responsable».
 *   D02-09 · La OT nace con el costo estimado = total de la cotización.
 *   D02-18 · La cotización se emite con la fecha de Chile.
 *   D02-10 · Temperatura de llegada en la recepción de LQA.
 *   D02-11 · Tarjeta «OT por recepcionar» de Recepción (cuadra con su bandeja).
 *   D06-02 · Tarjetas «Internaciones por analizar» (SCC) y «Lotes por inspeccionar»
 *            (inspector), con su lista filtrada; otros laboratorios no las ven.
 *   D06-09 · La OT de internación nace con fecha de compromiso.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r1-r1g.js [--arrancar] [--base http://localhost:4771/api]
 *   --arrancar  lanza `node apps/api/dist/main.js` (compilar antes) con DATABASE_URL.
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA
 * de apps/api/src/auth/auth.service.ts. No escribe contraseñas. Deja datos de
 * prueba (cliente, cotización, OT, orden interna, internación): úsese en una base
 * de pruebas. Se puede correr varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4771/api");
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
  const s = await login(username);
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo, patron) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  if (patron && !patron.test(msg(r.json))) throw new Error(`${username} ${metodo} ${ruta}: el mensaje «${msg(r.json)}» no dice ${patron}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

/* -------------------------------------------------------------- informe --- */
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
  const puerto = new URL(BASE).port || "4771";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4772",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1g-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ RECORRIDO === */
const U = {
  ventas: "demo.ventas",
  dco: "demo.dco.jefe",
  recepcion: "demo.recepcion",
  lqaA1: "demo.lqa.analista1",
  lqaRev: "demo.lqa.revisor",
  lqaJefe: "demo.lqa.jefe",
  dqoJefe: "demo.dqo.jefe",
  lmbA1: "demo.lmb.analista1",
  lmbRev: "demo.lmb.revisor",
  lmbJefe: "demo.lmb.jefe",
  lesA1: "demo.les.analista1",
  lesJefe: "demo.les.jefe",
  scc: "demo.scc.jefe",
  inspector: "demo.sstgo.inspector",
  lqcA1: "demo.lqc.analista1",
  lqcJefe: "demo.lqc.jefe",
};
/** Hoy en Chile (AAAA-MM-DD), como lo usa el servidor. */
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sumarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const sello = String(Date.now()).slice(-7);
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
const bandeja = async (u) => Object.fromEntries((await ok(u, "GET", "/me/bandeja")).map((i) => [i.clave, i]));

async function main() {
  if (ARRANCAR) { arrancarApi(); await esperarApi(); }
  console.log(`Frente r1g · recorrido MP-02 / MP-06 contra ${BASE}`);
  const C = {};

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  await paso("Catálogo: métodos de LQA (humedad, cenizas) y ensayos de LMB (S. aureus en placa Máx 100, Salmonella)", async () => {
    const metodo = async (codigo) => {
      const m = lista(await ok(U.lqaJefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
      afirmar(m && m.ensayoId, `método ${codigo} no encontrado`);
      return m;
    };
    C.mHum = await metodo("395");
    C.mCen = await metodo("386");
    C.mSau = await metodo("417");
    C.mSal = await metodo("429");
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    C.lqa = labs.find((u) => u.codigo === "LQA");
    afirmar(C.lqa, "LQA no figura en /ot/laboratorios");
    return `${C.mHum.nombre} · ${C.mCen.nombre} · ${C.mSau.nombre} · ${C.mSal.nombre}`;
  });

  /* ------------------------------------ D02-09 / D02-18 · Cotización → OT */
  await paso("D02-18 · La cotización se emite con la fecha de Chile; D02-09 · la OT hereda el total como costo estimado", async () => {
    C.cliente = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(77000000 + (Number(sello) % 999999)), razonSocial: `Cliente prueba r1g ${sello}`, tipo: "particulares",
    });
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", plazoEntregaDias: 10, referencia: `Recorrido MP-02 r1g ${sello}`,
      lineas: [C.mHum, C.mCen, C.mSau, C.mSal].map((m) => ({ catEnsayoId: m.ensayoId, cantidad: 1 })),
    });
    afirmar(String(C.cot.fechaEmision).slice(0, 10) === hoyCl(), `fecha de emisión ${C.cot.fechaEmision} ≠ hoy en Chile ${hoyCl()}`);
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    await exigir(403, U.lqaA1, "POST", `/cotizaciones/${C.cot.id}/aceptar`, { tipo: "OC", numero: "X", unidadPrincipalId: C.lqa.id });
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-R1G-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.lqa.id,
    });
    C.ot = await ok(U.lqaJefe, "GET", `/ot/${r.ot.id}`);
    const total = Number(C.cot.total);
    afirmar(total > 0 && Number(C.ot.costoEstimado) === total, `costo estimado ${C.ot.costoEstimado} ≠ total ${total}`);
    return `${C.cot.codigo} (${String(C.cot.fechaEmision).slice(0, 10)}) → ${C.ot.codigo} · costo estimado ${C.ot.costoEstimado}`;
  });

  /* ------------------------------------ Recepción y Nº interno (D02-01, D02-10) */
  await paso("D02-10 · Recepción con temperatura de llegada; D02-01 · Nº interno asignado", async () => {
    await exigir(403, U.lmbA1, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: "X", metodoIds: [C.mHum.id] }] });
    const reg = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [{
        nombre: `Harina de trigo · bolsa 1 kg (r1g ${sello})`,
        metodoIds: [C.mHum.id, C.mCen.id],
        recepcion: { tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple", datos: { lote: `L-${sello}`, temperatura_llegada: 4.5 } },
      }],
    });
    C.muestra = reg.muestras[0];
    const n = await ok(U.recepcion, "POST", `/recepcion/ot/${C.ot.id}/numeros`, {});
    afirmar(n.asignados.length === 1, `Nº asignados ${n.asignados.length}`);
    C.numero = String(n.asignados[0].numeroInterno);
    const prop = await ok(U.lqaJefe, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const m = prop.muestras.find((x) => x.id === C.muestra.id);
    afirmar(m?.datos?.temperatura_llegada === 4.5, `temperatura de llegada ${JSON.stringify(m?.datos)}`);
    return `${C.muestra.codigo} · Nº interno ${C.numero} · 4,5 °C`;
  });

  await paso("D02-01 · Muestras de la OT con Nº interno: 200 con el número como texto (antes 500); otro laboratorio no las ve", async () => {
    const j = await ok(U.lqaJefe, "GET", `/muestras?otId=${C.ot.id}&limit=200`);
    const m = lista(j).find((x) => x.id === C.muestra.id);
    afirmar(m && m.numeroInterno === C.numero && typeof m.numeroInterno === "string", `numeroInterno ${JSON.stringify(m?.numeroInterno)}`);
    const otro = await ok(U.lesA1, "GET", `/muestras?otId=${C.ot.id}&limit=200`);
    afirmar(!lista(otro).length, "LES ve las muestras de una OT de LQA");
    await ok(U.lqaJefe, "GET", "/recepcion/retenciones");
    return `numeroInterno «${m.numeroInterno}» · LES 0 filas · /recepcion/retenciones 200`;
  });

  /* ------------------------------------ Orden interna a LMB (D02-02) */
  await paso("Orden interna LQA → LMB (S. aureus y Salmonella); la recibe el jefe de LMB", async () => {
    const d = await ok(U.lqaA1, "GET", `/ordenes-internas/destinos?otId=${C.ot.id}`);
    C.lmb = d.find((x) => x.unidadCodigo === "LMB");
    afirmar(C.lmb, "LMB no figura como destino");
    C.oi = await ok(U.lqaA1, "POST", "/ordenes-internas", {
      otId: C.ot.id, destinoLab: C.lmb.id, ensayos: [C.mSau.ensayoId, C.mSal.ensayoId], muestraId: C.muestra.id,
      requisito: "RSA vigente: S. aureus ≤ 100 ufc/g; Salmonella ausencia en 25 g", fechaEnvio: hoyCl(),
    });
    // Antes de recibirla, el destino no trabaja la OT.
    const f = await ok(U.lmbJefe, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    afirmar(f.estado === "recibida" && f.resultados.length >= 2, `recibida con ${f.resultados.length} resultado(s)`);
    return `${C.oi.numero} recibida · ${f.resultados.length} ensayos derivados en ${C.muestra.codigo}`;
  });

  await paso("D02-02/D02-04 · Captura por OT: LMB ve solo lo derivado (y puede capturar); LQA lo ve en solo lectura; LES 403", async () => {
    const lmb = await ok(U.lmbA1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    afirmar(lmb.resultados.length >= 2 && lmb.resultados.every((r) => r.derivado && r.laboratorio === "LMB" && r.puedo.capturar),
      `LMB ve ${lmb.resultados.map((r) => `${r.laboratorio}:${r.puedo?.capturar}`).join(",")}`);
    const lqa = await ok(U.lqaA1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    const der = lqa.resultados.filter((r) => r.derivado);
    const propios = lqa.resultados.filter((r) => !r.derivado);
    afirmar(der.length >= 2 && der.every((r) => !r.puedo.capturar && !r.puedo.revisar && !r.puedo.aprobar), "el LQA puede trabajar un derivado");
    afirmar(propios.length === 2 && propios.every((r) => r.puedo.capturar), "el LQA no puede capturar lo suyo");
    await exigir(403, U.lesA1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    const eq = await ok(U.lmbA1, "GET", `/flujo/ot/${C.ot.id}/equipos`);
    afirmar(eq.equipos.some((e) => e.codigo === "DEMO-LMB-INC-01"), "el destino no ve sus equipos para la captura");
    const id = (rs, m) => rs.find((r) => r.catMetodoId === m.id)?.id;
    C.rSau = id(lmb.resultados, C.mSau);
    C.rSal = id(lmb.resultados, C.mSal);
    C.rHum = id(propios, C.mHum);
    C.rCen = id(propios, C.mCen);
    afirmar(C.rSau && C.rSal && C.rHum && C.rCen, "faltan resultados de la OT");
    return `LMB ${lmb.resultados.length} derivados · LQA ${propios.length} propios + ${der.length} en solo lectura · LES 403`;
  });

  await paso("D02-02 · El LMB captura sus derivados («< 10» frente a Máx 100 → Cumple); el LQA no (403); el LMB no captura lo del LQA (403)", async () => {
    await exigir(403, U.lqaA1, "POST", `/flujo/resultado/${C.rSau}/valor`, { valor: "< 10" });
    await exigir(403, U.lmbA1, "POST", `/flujo/resultado/${C.rHum}/valor`, { valor: "13" });
    await exigir(403, U.lesA1, "POST", `/flujo/resultado/${C.rSau}/valor`, { valor: "< 10" });
    const sau = await ok(U.lmbA1, "POST", `/flujo/resultado/${C.rSau}/valor`, { valor: "< 10" });
    afirmar(sau.veredicto === "cumple" && sau.valorTexto === "< 10", `S. aureus «< 10» → ${sau.veredicto}`);
    const sal = await ok(U.lmbA1, "POST", `/flujo/resultado/${C.rSal}/valor`, { atributo: "cumple", valor: "Ausencia en 25 g" });
    afirmar(sal.veredicto === "cumple", `Salmonella → ${sal.veredicto}`);
    return "S. aureus «< 10» ≤ 100 → Cumple · Salmonella Cumple";
  });

  await paso("D02-03 · LQA: réplicas en la fila; «< 10» frente a Mín 0,0001 queda sin veredicto y no se revisa (409)", async () => {
    const hum = await ok(U.lqaA1, "POST", `/flujo/resultado/${C.rHum}/valor`, { replicasTexto: "13,2 13,4" });
    afirmar(Math.abs(Number(hum.valorNumerico) - 13.3) < 1e-9 && hum.replicas.length === 2, `humedad ${hum.valorNumerico}`);
    const cen = await ok(U.lqaA1, "POST", `/flujo/resultado/${C.rCen}/valor`, { valor: "< 10" });
    afirmar(cen.veredicto === "pendiente", `cenizas «< 10» frente a Mín 0,0001 → ${cen.veredicto}`);
    await exigir(409, U.lqaRev, "POST", `/resultados/${C.rCen}/revisar`, undefined, /Pendiente/);
    return "humedad 13,3 (2 réplicas) · cenizas «< 10» Pendiente: revisar → 409";
  });

  await paso("D02-04 · Bandejas por laboratorio dueño: «Por revisar» del LQA sin los derivados; la del LMB solo con ellos", async () => {
    const lqa = lista(await ok(U.lqaRev, "GET", `/resultados/bandeja?estado=capturado&otId=${C.ot.id}&limit=200`)).map((r) => r.id);
    const lmb = lista(await ok(U.lmbRev, "GET", `/resultados/bandeja?estado=capturado&otId=${C.ot.id}&limit=200`)).map((r) => r.id);
    afirmar(lqa.includes(C.rHum) && !lqa.includes(C.rSau) && !lqa.includes(C.rSal), `bandeja LQA ${lqa.length}`);
    afirmar(lmb.includes(C.rSau) && lmb.includes(C.rSal) && !lmb.includes(C.rHum), `bandeja LMB ${lmb.length}`);
    return `LQA ${lqa.length} · LMB ${lmb.length}`;
  });

  await paso("D02-04 · Revisión: el revisor del LQA no revisa derivados (403) y «Revisar todo» solo toca lo suyo; el del LMB revisa los derivados", async () => {
    await exigir(403, U.lqaRev, "POST", `/resultados/${C.rSau}/revisar`);
    const r = await ok(U.lqaRev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    afirmar(r.hechos === 1 && r.deOtrosLaboratorios === 2, `LQA revisó ${r.hechos} (de otros laboratorios ${r.deOtrosLaboratorios})`);
    afirmar(r.omitidos.some((o) => o.id === C.rCen && /Pendiente/.test(o.motivo)), "cenizas sin veredicto no se informó como omitido");
    const m = await ok(U.lmbRev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    afirmar(m.hechos === 2, `LMB revisó ${m.hechos}`);
    return `LQA 1 revisado (+1 sin veredicto, 2 ajenos) · LMB 2 revisados`;
  });

  await paso("D02-03 · El veredicto lo decide el revisor, no quien capturó; luego se revisa", async () => {
    await exigir([403, 409], U.lqaA1, "POST", `/resultados/${C.rCen}/veredicto`, { veredicto: "cumple" });
    const v = await ok(U.lqaJefe, "POST", `/resultados/${C.rCen}/veredicto`, { veredicto: "cumple" });
    afirmar(v.veredicto === "cumple", `veredicto ${v.veredicto}`);
    // Revisa el jefe del LQA (prueba de segregación del paso siguiente).
    await ok(U.lqaJefe, "POST", `/resultados/${C.rCen}/revisar`);
    return "analista 403/409 · jefe LQA decide «Cumple» y revisa";
  });

  await paso("D06-05 · Quien revisó no aprueba (409); otra jefatura sí. D02-04 · el LQA no aprueba derivados", async () => {
    await exigir(409, U.lqaJefe, "POST", `/resultados/${C.rCen}/aprobar`, undefined, /revisó usted/);
    await exigir(403, U.lqaJefe, "POST", `/resultados/${C.rSau}/aprobar`);
    const a = await ok(U.lqaJefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    afirmar(a.hechos === 1 && a.deOtrosLaboratorios === 2 && a.omitidos.some((o) => o.id === C.rCen && /revisó usted/.test(o.motivo)),
      `aprobar todo LQA: ${JSON.stringify(a).slice(0, 240)}`);
    await ok(U.dqoJefe, "POST", `/resultados/${C.rCen}/aprobar`);
    return "jefe LQA: 1 aprobado, cenizas omitida (la revisó él) → la aprueba el jefe DQO";
  });

  await paso("D02-02 · El LMB no cierra la orden con derivados sin aprobar (409); los aprueba su jefe y cierra; después ya no captura", async () => {
    await ok(U.lmbJefe, "POST", `/ordenes-internas/${C.oi.id}/responder`, { horas: 3, costoDirecto: 28000, informe: "S. aureus < 10 ufc/g; Salmonella ausencia en 25 g." });
    await exigir(409, U.lmbJefe, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {}, /sin aprobar/);
    await exigir(403, U.lesJefe, "POST", `/resultados/${C.rSau}/aprobar`);
    const a = await ok(U.lmbJefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    afirmar(a.hechos === 2, `LMB aprobó ${a.hechos}`);
    const c = await ok(U.lmbJefe, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {});
    afirmar(c.estado === "cerrada", `orden ${c.estado}`);
    await exigir(409, U.lmbA1, "POST", `/flujo/resultado/${C.rSau}/valor`, { valor: "< 10", motivo: "Intento tras el cierre" });
    const lqa = await ok(U.lqaA1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    afirmar(lqa.resultados.every((r) => r.estado === "aprobado") && lqa.veredictoOt === "cumple", `OT ${lqa.veredictoOt}`);
    return `${C.oi.numero} cerrada · 4/4 aprobados · veredicto de la OT ${lqa.veredictoOt}`;
  });

  await paso("D02-07 · «Un laboratorio» sin elegir pide el laboratorio, sin decir que la OT no tiene responsable", async () => {
    const pl = lista(await ok(U.lqaJefe, "GET", "/plantillas?limit=300"));
    const p = pl.find((x) => x.repid === "PG09A2") ?? pl.find((x) => x.tipo === "I.ENSAYO");
    const c = await ok(U.lqaJefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: p.id, cobertura: { cobertura: "laboratorio" } });
    afirmar(!c.puedeEmitir && !c.faltantes.some((f) => /no tiene laboratorio responsable|no tiene resultados registrados/.test(f)), c.faltantes.join(" | "));
    const t = await ok(U.lqaJefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: p.id });
    afirmar(!t.faltantes.some((f) => /por aprobar|sin veredicto/.test(f)), t.faltantes.join(" | "));
    return `${c.faltantes.length} falta(s): ${c.faltantes.join(" ").slice(0, 90)}`;
  });

  /* ------------------------------------ Mi bandeja (D02-11, D06-02) y OT de internación (D06-09) */
  await paso("D02-11 · Recepción tiene «OT por recepcionar» y cuadra con su bandeja de entrada; el analista de LQA no", async () => {
    const b = await bandeja(U.recepcion);
    afirmar(b.ot_por_recepcionar, "Recepción sin la tarjeta «OT por recepcionar»");
    const e = await ok(U.recepcion, "GET", "/recepcion/bandeja");
    const total = e.meta.total;
    // La bandeja de entrada muestra hasta 300 OT y 300 órdenes internas.
    afirmar(b.ot_por_recepcionar.cantidad === total || (total >= 300 && b.ot_por_recepcionar.cantidad >= total), `tarjeta ${b.ot_por_recepcionar.cantidad} ≠ bandeja ${total}`);
    const a = await bandeja(U.lqaA1);
    afirmar(!a.ot_por_recepcionar, "el analista de LQA tiene la tarjeta de Recepción");
    return `${b.ot_por_recepcionar.cantidad} por recepcionar`;
  });

  await paso("D06-02 · SCC: «Internaciones por analizar» = lista ?pendiente=analisis; LQC no la tiene", async () => {
    const cfg = await ok(U.ventas, "GET", "/bpch/config");
    C.sstgo = cfg.unidades.find((u) => u.codigo === "SSTGO");
    C.importador = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(76100000 + (Number(sello) % 899999)), razonSocial: `Importadora prueba r1g ${sello}`, tipo: "particulares",
    });
    C.int = await ok(U.ventas, "POST", "/bpch/internaciones", {
      resolucionNumero: `RES-R1G-${sello}`, resolucionFecha: hoyCl(), clienteId: C.importador.id, esquema: "LOTES",
      procedimiento: "SAC-PG01-P01", unidadInspeccionId: C.sstgo.id, sujetaTasa: false,
      items: [{ elementoEspecifico: `Emulsión prueba r1g ${sello}`, claseDivisionUn: "1.1D", numeroUn: "0241", cantidad: 10, unidadMedida: "uds" }],
    });
    afirmar(String(C.int.resolucionFecha).slice(0, 10) === hoyCl(), `fecha de la resolución ${C.int.resolucionFecha}`);
    const b = await bandeja(U.scc);
    afirmar(b.internaciones_por_analizar?.cantidad >= 1, "la SCC no tiene «Internaciones por analizar»");
    const l = await ok(U.scc, "GET", "/bpch/internaciones?pendiente=analisis&limit=200");
    afirmar(l.meta.total === b.internaciones_por_analizar.cantidad, `tarjeta ${b.internaciones_por_analizar.cantidad} ≠ lista ${l.meta.total}`);
    afirmar(lista(l).some((x) => x.id === C.int.id), "la internación nueva no está en la lista");
    afirmar(!(await bandeja(U.lqcJefe)).internaciones_por_analizar, "el jefe de LQC tiene la tarjeta de la SCC");
    return `${C.int.numero} · ${b.internaciones_por_analizar.cantidad} por analizar`;
  });

  await paso("D06-09 · La OT de internación nace con fecha de compromiso; D06-02 · el inspector tiene «Lotes por inspeccionar»", async () => {
    const r = await ok(U.scc, "POST", `/bpch/internaciones/${C.int.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoyCl() });
    afirmar(r.estado === "ot_generada" && r.otId, `estado ${r.estado}`);
    const ot = await ok(U.inspector, "GET", `/ot/${r.otId}`);
    afirmar(String(ot.fechaCompromiso).slice(0, 10) === sumarDias(hoyCl(), 10), `fecha de compromiso ${ot.fechaCompromiso}`);
    const b = await bandeja(U.inspector);
    afirmar(b.lotes_por_inspeccionar?.cantidad >= 1, "el inspector no tiene «Lotes por inspeccionar»");
    const l = await ok(U.inspector, "GET", "/bpch/internaciones?pendiente=inspeccion&limit=200");
    afirmar(l.meta.total === b.lotes_por_inspeccionar.cantidad && lista(l).some((x) => x.id === C.int.id), `tarjeta ${b.lotes_por_inspeccionar.cantidad} ≠ lista ${l.meta.total}`);
    afirmar(!(await bandeja(U.lqcA1)).lotes_por_inspeccionar, "un analista de LQC tiene la tarjeta del inspector");
    return `${ot.codigo} · compromiso ${String(ot.fechaCompromiso).slice(0, 10)} · ${b.lotes_por_inspeccionar.cantidad} por inspeccionar`;
  });

  const okN = pasos.filter((p) => p.ok).length;
  console.log(`\n${okN}/${pasos.length} pasos en verde`);
}

main()
  .then(() => { pararApi(); process.exit(pasos.every((p) => p.ok) ? 0 : 1); })
  .catch((e) => { console.log(`\nFALLÓ: ${e.message}`); pararApi(); process.exit(1); });
