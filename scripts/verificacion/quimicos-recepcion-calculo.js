#!/usr/bin/env node
/**
 * Verificación contra una API real de lo pedido por el Depto. Químico el 15-10-2026
 * (docs/FLUJO_QUIMICOS_RECEPCION_CALCULO.md): recepción de la muestra, factor de la
 * fórmula, historial de cambios, planilla de registros y cálculos (con CSV) y
 * planilla de costos reales por OT. Cada regla se prueba con el perfil que debe
 * poder y con uno que no.
 *
 * Uso:
 *   node scripts/verificacion/quimicos-recepcion-calculo.js [--arrancar] [--base http://localhost:4321/api]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO (o la constante
 * CLAVE_DEMO_EMBEBIDA de auth.service.ts). Deja datos de prueba en la base (una
 * cotización, una OT de LQC con su muestra, una orden interna y una planilla de
 * costos): úsese en una base de pruebas. Pone un factor por defecto al método 258
 * (Azufre) durante la prueba y lo deja como estaba al terminar.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4321/api");
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
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json, texto, tipo: r.headers.get("content-type") ?? "" };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!ok) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

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
  const puerto = new URL(BASE).port || "4321";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-quimicos-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* Perfiles */
const U = {
  ventas: "demo.ventas",
  recepcion: "demo.recepcion",
  planif: "demo.planificacion",
  a1: "demo.lqc.analista1",
  revisor: "demo.lqc.revisor",
  jefe: "demo.lqc.jefe",
  dqo: "demo.dqo.jefe",
  otroJefe: "demo.lpn.jefe",
  otroAnalista: "demo.lpn.analista1",
  lccJefe: "demo.lcc.jefe",
  lccAnalista: "demo.lcc.analista1",
  finanzas: "demo.finanzas",
  admin: "demo.admin",
};

/* ============================================================ RECORRIDO === */
const C = {};
async function restaurarFactorMetodo() {
  if (!C.mAzufre) return;
  await llamar(U.admin, "PATCH", `/cat/metodos/${C.mAzufre.id}`, {
    factorValor: C.factorOriginal?.valor ?? null,
    factorOperacion: C.factorOriginal?.operacion ?? null,
    factorDescripcion: C.factorOriginal?.descripcion ?? null,
  });
}

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Preparación: laboratorios LQC y LCC, métodos pH (251) y Azufre (258), cliente", async () => {
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    C.lcc = labs.find((u) => u.codigo === "LCC");
    afirmar(C.lqc && C.lcc, "LQC o LCC no figuran en GET /ot/laboratorios");
    const buscar = async (codigo) => {
      const m = lista(await ok(U.jefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
      afirmar(m?.ensayoId, `método ${codigo} no encontrado`);
      return m;
    };
    C.mPh = await buscar("251");
    C.mAzufre = await buscar("258");
    // Método con límite VIGENTE en el catálogo para probar que el analista no lo
    // cambia. El pH (251) ya no sirve: su 6,0–8,5 era de la NCh 409 Of.84 y
    // align_informe_ensayo.sql lo retiró (integración, 18-10-2026).
    C.mLim = await buscar("243");
    C.factorOriginal = C.mAzufre.factorValor != null
      ? { valor: Number(C.mAzufre.factorValor), operacion: C.mAzufre.factorOperacion, descripcion: C.mAzufre.factorDescripcion }
      : null;
    C.cliente = lista(await ok(U.ventas, "GET", "/clientes?limit=5"))[0];
    afirmar(C.cliente, "no hay clientes");
    return `pH ${C.mPh.id.slice(0, 8)} · Azufre ${C.mAzufre.id.slice(0, 8)}`;
  });

  /* ---------------- Factor por defecto en el método (catálogo) */
  await paso("El método trae factor por defecto: lo fija quien gestiona el catálogo; un analista no (403)", async () => {
    await exigir(403, U.a1, "PATCH", `/cat/metodos/${C.mAzufre.id}`, { factorValor: 2, factorOperacion: "multiplicar" });
    // Revisión r3 (hallazgo 19): el factor sin su operación (o al revés) es 400 con el motivo, no 500.
    const e1 = await exigir(400, U.admin, "PATCH", `/cat/metodos/${C.mAzufre.id}`, { factorValor: 10 });
    afirmar(/juntos/.test(JSON.stringify(e1)), JSON.stringify(e1).slice(0, 200));
    await exigir(400, U.admin, "PATCH", `/cat/metodos/${C.mAzufre.id}`, { factorValor: null, factorOperacion: "dividir" });
    const m = await ok(U.admin, "PATCH", `/cat/metodos/${C.mAzufre.id}`, { factorValor: 2, factorOperacion: "multiplicar", factorDescripcion: "Dilución de prueba" });
    afirmar(Number(m.factorValor) === 2 && m.factorOperacion === "multiplicar", JSON.stringify(m).slice(0, 160));
    return "Azufre × 2";
  });

  await paso("Nace una OT de LQC desde una cotización aceptada (pH y Azufre)", async () => {
    const cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", referencia: `Químicos 15-10 ${sello}`,
      lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 1 }, { catEnsayoId: C.mAzufre.ensayoId, cantidad: 1 }],
    });
    // Circuito de la cotización (frente r1c): se acepta firmada por el Jefe DCO.
    await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/enviar-a-firma`, {});
    await ok("demo.dco.jefe", "POST", `/cotizaciones/${cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-QUI-${sello}`, fecha: new Date().toISOString().slice(0, 10), conCobro: true, unidadPrincipalId: C.lqc.id,
    });
    C.ot = await ok(U.jefe, "GET", `/ot/${r?.ot?.id ?? r?.otId}`);
    afirmar(C.ot.unidadPrincipal === C.lqc.id, "la OT no quedó en LQC");
    return C.ot.codigo;
  });

  /* ---------------- 1 · Recepción de la muestra */
  await paso("1 · El registro ofrece las tres opciones de «Toma de muestra»", async () => {
    const p = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const cods = (p.opcionesToma ?? []).map((o) => o.codigo);
    for (const c of ["terreno_laboratorio", "entregada_cliente", "seccion_muestreo"]) afirmar(cods.includes(c), `falta la opción ${c}`);
    return (p.opcionesToma ?? []).map((o) => o.etiqueta).join(" · ");
  });
  const base = (recepcion) => ({ muestras: [{ nombre: "Agua potable estanque", metodoIds: [C.mPh.id, C.mAzufre.id, C.mLim.id], recepcion }] });
  await paso("1 · Reglas de la recepción: No cumple sin observación, otros laboratorios vacíos o el propio → 400", async () => {
    await exigir(400, U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, base({ tomaMuestra: "entregada_cliente", condicionRecepcion: "no_cumple" }));
    await exigir(400, U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, base({ tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple", requiereOtrosLabs: true }));
    await exigir(400, U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, base({ tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple", requiereOtrosLabs: true, otrosLabs: [C.lqc.id] }));
    await exigir(400, U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, base({ tomaMuestra: "inventada", condicionRecepcion: "cumple" }));
    await exigir(403, U.ventas, "POST", `/flujo/ot/${C.ot.id}/muestras`, base({ tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple" }));
  });
  await paso("1 · Recepción registra la muestra con toma, condición, sello, identificación del cliente y otro laboratorio", async () => {
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, base({
      tomaMuestra: "seccion_muestreo", condicionRecepcion: "no_cumple", condicionObservacion: "Envase con filtración leve",
      selloNumero: "15572", identificacionCliente: "Estanque Nº 3", requiereOtrosLabs: true, otrosLabs: [C.lcc.id], otrosLabsDetalle: "Cromo en cuero",
    }));
    C.muestra = r.muestras[0];
    const p = await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const m = p.muestras.find((x) => x.id === C.muestra.id);
    afirmar(m.tomaMuestra === "seccion_muestreo" && m.condicionRecepcion === "no_cumple" && m.selloNumero === "15572", JSON.stringify(m).slice(0, 200));
    afirmar(m.identificacionCliente === "Estanque Nº 3" && m.recepcionadaPorNombre, "faltan identificación o quién recepcionó");
    afirmar(m.otrosLabsEnlace?.[0]?.unidad?.codigo === "LCC" && m.otrosLabsEnlace[0].ordenes.length === 0, "el enlace con LCC no figura");
    afirmar(!m.recepcionIncompleta, "marcada como incompleta");
    return `${m.codigo} · sello ${m.selloNumero} · No cumple · LCC sin orden interna aún`;
  });
  await paso("1 · La orden interna a LCC queda enlazada a la muestra", async () => {
    // Las órdenes internas apuntan al laboratorio del catálogo (cat_familia), que se
    // corresponde con la unidad por su código CODSUCDEL.
    const familias = lista(await ok(U.planif, "GET", "/cat/familias?limit=200"));
    const fam = (u) => familias.find((f) => f.codsucdel && f.codsucdel === u.codsucdel);
    afirmar(fam(C.lqc) && fam(C.lcc), "LQC o LCC sin laboratorio en el catálogo (cat_familia)");
    C.famLqc = fam(C.lqc);
    // Desde r1b la emisión exige muestra de origen, requisito y fecha de envío (EP-01 2.2).
    const oi = await ok(U.planif, "POST", "/ordenes-internas", {
      otId: C.ot.id, origenLab: fam(C.lqc).id, destinoLab: fam(C.lcc).id, detalle: "Cromo en cuero",
      muestraId: C.muestra.id, requisito: "Cromo total según E.T.", fechaEnvio: new Date().toISOString().slice(0, 10),
    });
    const p = await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const e = p.muestras.find((x) => x.id === C.muestra.id).otrosLabsEnlace[0];
    afirmar(e.ordenes.some((o) => o.id === oi.id), "la orden interna no aparece enlazada");
    return oi.numero;
  });
  await paso("1 · Corregir la recepción: Recepción sí; Ventas y la jefatura de otro laboratorio no (403); queda en el historial", async () => {
    const cuerpo = { tomaMuestra: "seccion_muestreo", condicionRecepcion: "cumple", selloNumero: "15572", identificacionCliente: "Estanque Nº 3", requiereOtrosLabs: true, otrosLabs: [C.lcc.id] };
    await exigir(403, U.ventas, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    await exigir(403, U.otroJefe, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    await exigir(400, U.recepcion, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, { ...cuerpo, condicionRecepcion: "no_cumple" });
    const m = await ok(U.recepcion, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    afirmar(m.condicionRecepcion === "cumple" && m.condicionObservacion === null, "no se actualizó");
    const h = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    const ev = h.find((x) => x.tipo === "recepcion_muestra");
    afirmar(ev && ev.detalle?.anterior?.condicionRecepcion === "no_cumple", "el historial no guarda lo anterior");
    return "no_cumple → cumple";
  });

  await paso("Revisión r3 · La jefatura corrige el sello: se conserva quién y cuándo recibió; queda quién corrigió (hallazgo 13)", async () => {
    const antes = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`)).muestras.find((x) => x.id === C.muestra.id);
    afirmar(antes.recepcionadaPorNombre && antes.recepcionadaAt, "la muestra no tiene quién la recibió");
    const cuerpo = { tomaMuestra: "seccion_muestreo", condicionRecepcion: "cumple", selloNumero: "15573", identificacionCliente: "Estanque Nº 3", requiereOtrosLabs: true, otrosLabs: [C.lcc.id] };
    await ok(U.jefe, "PATCH", `/flujo/muestras/${C.muestra.id}/recepcion`, cuerpo);
    const desp = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`)).muestras.find((x) => x.id === C.muestra.id);
    afirmar(desp.recepcionadaPorNombre === antes.recepcionadaPorNombre && desp.recepcionadaAt === antes.recepcionadaAt,
      `la corrección cambió quién/cuándo recibió: ${antes.recepcionadaPorNombre} ${antes.recepcionadaAt} → ${desp.recepcionadaPorNombre} ${desp.recepcionadaAt}`);
    afirmar(desp.recepcionCorregidaPorNombre && desp.recepcionCorregidaPorNombre !== antes.recepcionadaPorNombre && desp.recepcionCorregidaAt, "no quedó quién corrigió");
    const h = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    const ev = h.find((x) => x.tipo === "recepcion_muestra" && x.detalle?.nuevo?.selloNumero === "15573");
    afirmar(ev && ev.detalle.anterior.selloNumero === "15572" && ev.detalle.anterior.recepcionadaPor && ev.detalle.anterior.recepcionadaAt,
      `el historial no guarda lo anterior completo: ${JSON.stringify(ev?.detalle?.anterior)}`);
    return `recibida por ${desp.recepcionadaPorNombre} · corregida por ${desp.recepcionCorregidaPorNombre}`;
  });

  await paso("Revisión r3 · LCC tiene un ensayo propio en la OT (método 993, por la orden interna)", async () => {
    const m = lista(await ok(U.jefe, "GET", "/cat/metodos?search=993&limit=50")).find((x) => x.codigo === "993");
    afirmar(m, "método 993 (LCC) no encontrado");
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: "Cuero del calzado (LCC)", metodoIds: [m.id] }] });
    C.muestraLcc = r.muestras[0];
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados.filter((x) => x.muestraId === C.muestraLcc.id);
    afirmar(rs.length >= 1, "el ensayo de LCC no se generó");
    C.rLcc = rs.map((x) => x.id);
    return `${C.muestraLcc.codigo} · ${rs.length} ensayo(s) de LCC sin capturar`;
  });

  /* ---------------- 2/3 · Factor y captura con historial */
  await paso("3 · El ensayo copia el factor del método (× 2, origen «metodo»)", async () => {
    const rs = await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    C.rPh = rs.resultados.find((r) => r.catMetodoId === C.mPh.id);
    C.rAz = rs.resultados.find((r) => r.catMetodoId === C.mAzufre.id);
    C.rLim = rs.resultados.find((r) => r.catMetodoId === C.mLim.id);
    afirmar(C.rLim && (C.rLim.limiteInf || C.rLim.limiteSup) && C.rLim.especOrigen === "catalogo", "el método 243 debería traer límite del catálogo");
    afirmar(C.rPh && C.rAz, "faltan resultados");
    afirmar(Number(C.rAz.factorValor) === 2 && C.rAz.factorOperacion === "multiplicar" && C.rAz.factorOrigen === "metodo", `factor ${C.rAz.factorValor} ${C.rAz.factorOperacion} ${C.rAz.factorOrigen}`);
    await restaurarFactorMetodo(); // el catálogo vuelve a como estaba; la OT conserva su copia
    return `Azufre ${C.rAz.factorOperacion} ${C.rAz.factorValor}`;
  });
  await paso("3 · Se captura Azufre por réplicas: el factor se aplica al promedio", async () => {
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/analistas`, { usuarioIds: [sesiones[U.a1]?.id ?? (await login(U.a1)).id] });
    await ok(U.a1, "PATCH", `/flujo/resultado/${C.rAz.id}/especificacion`, { limiteInf: "0", limiteSup: "0,5", unidad: "%" });
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rAz.id}/valor`, { replicasTexto: "0,31 0,29 0,30" });
    afirmar(Math.abs(Number(r.valorNumerico) - 0.6) < 1e-9 && Math.abs(Number(r.valorSinFactor) - 0.3) < 1e-9, `valor ${r.valorNumerico} sin factor ${r.valorSinFactor}`);
    afirmar(r.formulaAplicada === "PROMEDIO(RN) * 2" && r.veredicto === "no_cumple", `${r.formulaAplicada} · ${r.veredicto}`);
    return `0,30 × 2 = ${r.valorNumerico} → ${r.veredicto}`;
  });
  await paso("3 · Ajustar el factor: el analista no (403), la jefatura de otro laboratorio no (403), sin motivo no (400)", async () => {
    const cuerpo = { valor: 2, operacion: "dividir", motivo: "Dilución real 1:2 informada por el analista" };
    await exigir(403, U.a1, "PATCH", `/flujo/resultado/${C.rAz.id}/factor`, cuerpo);
    await exigir(403, U.otroJefe, "PATCH", `/flujo/resultado/${C.rAz.id}/factor`, cuerpo);
    await exigir(400, U.jefe, "PATCH", `/flujo/resultado/${C.rAz.id}/factor`, { valor: 2, operacion: "dividir" });
    await exigir(400, U.jefe, "PATCH", `/flujo/resultado/${C.rAz.id}/factor`, { ...cuerpo, valor: 0 });
  });
  await paso("3 · La jefatura cambia el factor a ÷ 2: se recalcula el valor y el veredicto", async () => {
    const r = await ok(U.jefe, "PATCH", `/flujo/resultado/${C.rAz.id}/factor`, { valor: 2, operacion: "dividir", motivo: "Dilución real 1:2 informada por el analista" });
    afirmar(Math.abs(Number(r.valorNumerico) - 0.15) < 1e-9 && r.veredicto === "cumple", `valor ${r.valorNumerico} · ${r.veredicto}`);
    afirmar(r.factorOrigen === "orden" && r.factorMotivo && r.formulaAplicada === "PROMEDIO(RN) / 2", `${r.factorOrigen} · ${r.formulaAplicada}`);
    return `0,30 ÷ 2 = ${r.valorNumerico} → ${r.veredicto}`;
  });
  await paso("2 · Corregir un valor ya capturado exige motivo; cambiar un límite del catálogo también", async () => {
    await ok(U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7,2" });
    await exigir(400, U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7,4" });
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7,4", motivo: "Error de digitación en la lectura" });
    afirmar(Number(r.valorNumerico) === 7.4, `valor ${r.valorNumerico}`);
    // El 243 trae del catálogo el MÍNIMO (97) y el máximo vacío: el analista puede
    // rellenar lo vacío, pero no cambiar lo que viene del catálogo.
    afirmar(C.rLim.limiteInf, "el método 243 debería traer el mínimo del catálogo");
    await exigir(403, U.a1, "PATCH", `/flujo/resultado/${C.rLim.id}/especificacion`, { limiteInf: "90", motivo: "Requisito del cliente" });
    await exigir(400, U.jefe, "PATCH", `/flujo/resultado/${C.rLim.id}/especificacion`, { limiteInf: "90" });
    await ok(U.jefe, "PATCH", `/flujo/resultado/${C.rLim.id}/especificacion`, { limiteInf: "90", motivo: "Requisito del cliente para esta OT" });
    return "7,2 → 7,4 con motivo; límite cambiado por la jefatura con motivo";
  });
  await paso("Revisión r3 · Factor sobre un valor ingresado directo: no se aplica, se informa como omitido y la planilla no lo muestra (hallazgo 9)", async () => {
    const r = await ok(U.jefe, "PATCH", `/flujo/resultado/${C.rPh.id}/factor`, { valor: 10, operacion: "multiplicar", motivo: "Dilución informada por el analista", todoElMetodo: true });
    afirmar(r.actualizados === 0 && r.omitidos.some((o) => o.id === C.rPh.id && /directo/.test(o.motivo)), JSON.stringify({ act: r.actualizados, om: r.omitidos }));
    afirmar(Number(r.valorNumerico) === 7.4 && r.factorValor == null, `valor ${r.valorNumerico} · factor ${r.factorValor}`);
    const p = await ok(U.a1, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    const ph = p.ensayos.find((e) => e.resultadoId === C.rPh.id);
    afirmar(!ph.factor || ph.factor.aplicado !== true, `la planilla muestra un factor aplicado: ${JSON.stringify(ph.factor)}`);
    return r.omitidos[0].motivo.slice(0, 80) + "…";
  });
  await paso("Revisión r3 · Una corrección sin variables no conserva las de la captura anterior (hallazgo 12)", async () => {
    await ok(U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7,4", variables: { V: 25 }, motivo: "Se registra el volumen de la alícuota" });
    let ph = (await ok(U.a1, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`)).ensayos.find((e) => e.resultadoId === C.rPh.id);
    afirmar(ph.variables.V === 25, `variables ${JSON.stringify(ph.variables)}`);
    await ok(U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { replicasTexto: "7,3 7,5", motivo: "Corrección con las réplicas del pH-metro" });
    ph = (await ok(U.a1, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`)).ensayos.find((e) => e.resultadoId === C.rPh.id);
    afirmar(Object.keys(ph.variables).length === 0 && ph.replicas.length === 2, `quedaron variables de la captura anterior: ${JSON.stringify(ph.variables)}`);
    return "V=25 en la primera captura · la corrección por réplicas la deja sin variables";
  });

  /* ---------------- 2 · Planilla de registros y cálculos */
  await paso("2 · Planilla de cálculos: lecturas, fórmula aplicada, factor e historial (quién, cuándo, antes, después, motivo)", async () => {
    await exigir(403, U.otroAnalista, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    await exigir(403, U.ventas, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    const p = await ok(U.a1, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    const az = p.ensayos.find((e) => e.resultadoId === C.rAz.id);
    const ph = p.ensayos.find((e) => e.resultadoId === C.rPh.id);
    afirmar(az.replicas.length === 3 && az.factor?.operacion === "dividir" && az.factor.origen === "orden" && az.valorSinFactor === 0.3, JSON.stringify(az).slice(0, 240));
    afirmar(az.formulaAplicada === "PROMEDIO(RN) / 2", `fórmula aplicada ${az.formulaAplicada}`);
    const hf = az.historial.find((h) => h.campo === "factor_operacion");
    afirmar(hf && hf.anterior === "multiplicar" && hf.nuevo === "dividir" && /Dilución/.test(hf.motivo) && hf.usuario && hf.origen === "factor", `historial del factor: ${JSON.stringify(hf)}`);
    afirmar(az.historial.some((h) => h.campo === "alta" && h.origen === "registro"), "falta el alta del ensayo");
    const hv = ph.historial.filter((h) => h.campo === "valor_numerico");
    afirmar(hv.length >= 2 && hv.some((h) => h.origen === "correccion" && /digitación/.test(h.motivo) && Number(h.anterior) === 7.2), `historial del valor: ${JSON.stringify(hv)}`);
    const lim = p.ensayos.find((e) => e.resultadoId === C.rLim.id);
    afirmar(lim?.historial.some((h) => h.campo === "limite_inf" && h.origen === "especificacion" && /cliente/.test(h.motivo)), "falta el cambio de límite");
    return `${p.ensayos.length} ensayos · ${p.ensayos.reduce((s, e) => s + e.historial.length, 0)} cambios registrados`;
  });
  await paso("Revisión r3 · El analista de LCC (orden interna) abre la planilla de cálculos con SOLO sus ensayos (hallazgo 14)", async () => {
    const p = await ok(U.lccAnalista, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    const ids = p.ensayos.map((e) => e.resultadoId);
    afirmar(p.soloSuLaboratorio === true && ids.length === C.rLcc.length && ids.every((x) => C.rLcc.includes(x)), `ensayos visibles: ${ids.length}`);
    afirmar(!ids.includes(C.rPh.id) && !ids.includes(C.rAz.id), "LCC ve ensayos de LQC");
    await exigir(403, U.otroAnalista, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos`);
    return `${ids.length} ensayo(s) de LCC; LPN (sin trabajo en la OT) → 403`;
  });
  await paso("2 · Exportación a Excel (CSV con punto y coma y BOM)", async () => {
    const s = await login(U.a1);
    const r = await fetch(`${BASE}/laboratorio/ot/${C.ot.id}/planilla-calculos?formato=csv`, { headers: { authorization: `Bearer ${s.token}` } });
    const bytes = Buffer.from(await r.arrayBuffer());
    const texto = bytes.toString("utf8");
    afirmar(r.status === 200 && /text\/csv/.test(r.headers.get("content-type") ?? ""), `HTTP ${r.status} ${r.headers.get("content-type")}`);
    afirmar(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, "sin BOM UTF-8 (Excel mostraría mal las tildes)");
    afirmar(texto.includes("Historial de cambios") && texto.includes("PROMEDIO(RN) / 2") && texto.includes(";"), texto.slice(0, 200));
    await exigir(403, U.otroAnalista, "GET", `/laboratorio/ot/${C.ot.id}/planilla-calculos?formato=csv`);
    return `${texto.split("\n").length} líneas`;
  });

  /* ---------------- 4 · Planilla de costos reales */
  await paso("Revisión r3 · Ventas registra la estimación de costos de LQC (solicitud de costeo por laboratorio)", async () => {
    const ot = await ok(U.jefe, "GET", `/ot/${C.ot.id}`);
    afirmar(ot.cotizacionId && C.famLqc, "la OT no tiene cotización o LQC no tiene laboratorio en el catálogo");
    await ok(U.ventas, "POST", "/solicitud-costeo", { cotizacionId: ot.cotizacionId, familiaId: C.famLqc.id, horasHombre: 12, costoDirecto: 25000, estado: "estimado" });
    return "LQC: 12 h·h · $25.000";
  });
  await paso("4 · Costos reales: el analista, Ventas y la jefatura de otro laboratorio no la ven (403)", async () => {
    await exigir(403, U.a1, "GET", `/laboratorio/ot/${C.ot.id}/costos-reales`);
    await exigir(403, U.ventas, "GET", `/laboratorio/ot/${C.ot.id}/costos-reales`);
    await exigir(403, U.otroJefe, "GET", `/laboratorio/ot/${C.ot.id}/costos-reales`);
    const v = await ok(U.jefe, "GET", `/laboratorio/ot/${C.ot.id}/costos-reales`);
    afirmar(v.unidad?.codigo === "LQC" && v.puedeGestionar && v.cargos.length >= 3, JSON.stringify(v).slice(0, 200));
    afirmar(v.unidadesPosibles.some((u) => u.codigo === "LCC"), "LCC (orden interna) no figura como laboratorio posible");
    // Revisión r3 (hallazgo 7): OT con dos laboratorios → se compara con la estimación de LQC, sin margen del total.
    afirmar(v.estimacion.alcance === "laboratorio" && v.estimacion.costoDirecto === 25000 && v.estimacion.horasHombre === 12 && v.comparacion.margen === null,
      `estimación ${JSON.stringify(v.estimacion)}`);
    C.cargos = v.cargos.map((c) => c.codigo);
    return `estimación: costo ${v.estimacion.costoDirecto ?? "—"} (${v.estimacion.fuenteCosto ?? "sin fuente"}), neto ${v.estimacion.neto ?? "—"}`;
  });
  const lineas = () => [
    { categoria: "horas_hombre", cargo: "jefe_laboratorio", cantidad: 0.4, costoUnitario: 20000 },
    { categoria: "horas_hombre", cargo: "analista", cantidad: 15, costoUnitario: 1000 },
    { categoria: "reactivos", descripcion: "HCl 37 %", cantidad: 0.5, unidad: "L", costoUnitario: 3000 },
    { categoria: "equipos", descripcion: "Espectrofotómetro EAA", cantidad: 2, unidad: "h", costoUnitario: 1500 },
    { categoria: "otros", descripcion: "Traslado de muestra", cantidad: 1, costoUnitario: 863 },
  ];
  await paso("4 · El Jefe de Laboratorio la completa; líneas inválidas → 400; Finanzas la ve pero no la edita (403)", async () => {
    await exigir(400, U.jefe, "PUT", `/laboratorio/ot/${C.ot.id}/costos-reales`, { lineas: [{ categoria: "horas_hombre", cantidad: 1, costoUnitario: 1 }] });
    await exigir(403, U.finanzas, "PUT", `/laboratorio/ot/${C.ot.id}/costos-reales`, { lineas: lineas() });
    await exigir(403, U.dqo, "PUT", `/laboratorio/ot/${C.ot.id}/costos-reales`, { lineas: lineas() });
    const v = await ok(U.jefe, "PUT", `/laboratorio/ot/${C.ot.id}/costos-reales`, { observaciones: "Planilla de prueba", lineas: lineas() });
    afirmar(v.resumen.total === 28363 && v.resumen.horasHombre === 15.4 && v.planilla.estado === "borrador", JSON.stringify(v.resumen));
    const f = await ok(U.finanzas, "GET", `/laboratorio/ot/${C.ot.id}/costos-reales`);
    afirmar(f.resumen.total === 28363 && !f.puedeGestionar, "Finanzas no ve el total o figura como gestor");
    return `total ${v.resumen.total} · ${v.resumen.horasHombre} h·h · diferencia vs estimado ${v.comparacion.diferencia ?? "sin estimación"}`;
  });
  await paso("Revisión r3 · Planilla de LCC: sin estimación propia no se compara con el total; «sin aprobar» cuenta solo sus ensayos (hallazgos 7 y 8)", async () => {
    const v = await ok(U.lccJefe, "GET", `/laboratorio/ot/${C.ot.id}/costos-reales?unidadId=${C.lcc.id}`);
    afirmar(v.unidad?.codigo === "LCC", `unidad ${v.unidad?.codigo}`);
    afirmar(v.estimacion.alcance === "sin_estimacion_laboratorio" && v.comparacion.costoEstimado === null && v.comparacion.margen === null && /no se compara/.test(v.estimacion.aviso),
      `estimación ${JSON.stringify(v.estimacion)}`);
    afirmar(v.resultadosSinAprobar === C.rLcc.length, `LCC sin aprobar: ${v.resultadosSinAprobar} (esperado ${C.rLcc.length})`);
    await ok(U.lccJefe, "PUT", `/laboratorio/ot/${C.ot.id}/costos-reales`, { unidadId: C.lcc.id, lineas: [{ categoria: "horas_hombre", cargo: "analista", cantidad: 2, costoUnitario: 1000 }] });
    const e = await exigir(409, U.lccJefe, "POST", `/laboratorio/ot/${C.ot.id}/costos-reales/cerrar`, { unidadId: C.lcc.id });
    afirmar(/1 ensayo|ensayo\(s\) sin aprobar/.test(msg(e)), msg(e));
    return v.estimacion.aviso.slice(0, 80) + "…";
  });
  await paso("4 · No se cierra con ensayos sin aprobar (409)", async () => {
    const r = await exigir(409, U.jefe, "POST", `/laboratorio/ot/${C.ot.id}/costos-reales/cerrar`, {});
    afirmar(/sin aprobar/.test(msg(r)), msg(r));
  });
  await paso("4 · Se revisan y aprueban los ensayos; el Jefe de Laboratorio cierra la planilla", async () => {
    // Los 6 ensayos del método 243 (el del límite del catálogo) también se capturan:
    // la planilla solo se cierra con todos los ensayos del laboratorio aprobados.
    const rs = await ok(U.a1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    for (const r of rs.resultados.filter((x) => x.catMetodoId === C.mLim.id && !x.valorNumerico && x.resultadoFinal == null)) {
      await ok(U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "98" });
    }
    await ok(U.revisor, "POST", `/resultados/ot/${C.ot.id}/revisar`);
    const a = await ok(U.jefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`);
    afirmar(a.hechos >= 2, `aprobados ${a.hechos}: ${JSON.stringify(a.omitidos)}`);
    const v = await ok(U.jefe, "POST", `/laboratorio/ot/${C.ot.id}/costos-reales/cerrar`, {});
    afirmar(v.planilla.estado === "cerrada" && v.planilla.cerradaPor, "no quedó cerrada");
    await exigir(409, U.jefe, "PUT", `/laboratorio/ot/${C.ot.id}/costos-reales`, { lineas: lineas() });
    const h = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    afirmar(h.some((x) => x.tipo === "costos_reales" && x.detalle?.accion === "cerrar"), "el cierre no quedó en el historial de la OT");
    return `cerrada por ${v.planilla.cerradaPor}`;
  });
  await paso("4 · Reabrir exige motivo y la gestión de costos (Finanzas 403)", async () => {
    await exigir(403, U.finanzas, "POST", `/laboratorio/ot/${C.ot.id}/costos-reales/reabrir`, { motivo: "Faltó una hora" });
    await exigir(400, U.jefe, "POST", `/laboratorio/ot/${C.ot.id}/costos-reales/reabrir`, {});
    const v = await ok(U.jefe, "POST", `/laboratorio/ot/${C.ot.id}/costos-reales/reabrir`, { motivo: "Faltó registrar una hora de analista" });
    afirmar(v.planilla.estado === "borrador" && v.planilla.reabiertaMotivo, "no se reabrió");
    const l = lineas();
    l[1].cantidad = 16;
    await ok(U.jefe, "PUT", `/laboratorio/ot/${C.ot.id}/costos-reales`, { lineas: l });
    // Revisión r3 (hallazgo 15): doble clic en «Cerrar» → un cierre y un 409, un solo evento en el historial.
    const cerrarDos = await Promise.all([1, 2].map(() => llamar(U.jefe, "POST", `/laboratorio/ot/${C.ot.id}/costos-reales/cerrar`, {})));
    const est = cerrarDos.map((x) => x.status).sort();
    afirmar(est[0] >= 200 && est[0] < 300 && est[1] === 409, `cierres simultáneos → ${est.join(", ")}`);
    const c = cerrarDos.find((x) => x.status < 300).json;
    afirmar(c.planilla.estado === "cerrada" && c.resumen.total === 29363, `total ${c.resumen.total}`);
    const hist = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    const cierres = hist.filter((x) => x.tipo === "costos_reales" && x.detalle?.accion === "cerrar" && x.detalle?.unidadId === C.lqc.id);
    afirmar(cierres.length === 2, `${cierres.length} eventos de cierre de LQC (esperados 2: el primero y este)`);
    return `reabierta y cerrada de nuevo · total ${c.resumen.total}`;
  });
  await paso("2 · Lo aprobado ya no se corrige ni cambia de factor (409)", async () => {
    await exigir(409, U.jefe, "PATCH", `/flujo/resultado/${C.rAz.id}/factor`, { valor: 3, operacion: "dividir", motivo: "Intento tras aprobar" });
    await exigir(409, U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7,5", motivo: "Intento tras aprobar" });
  });
}

main()
  .then(async () => {
    console.log(`\nDepto. Químico verificado: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch(async (e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    try { await restaurarFactorMetodo(); } catch { /* la API pudo no arrancar */ }
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
