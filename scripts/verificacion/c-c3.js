#!/usr/bin/env node
/**
 * Frente c3 · Correcciones del recorrido de los manuales (comercial, facturación,
 * formularios, captura y transversal). Reproduce cada fallo corregido con un
 * perfil demo.* que puede y otro que no (B-030 … B-097, pestaña «Plan» del
 * backlog Backlog_Correcciones_Recorrido_Aiuken.xlsx).
 *
 * Uso:
 *   node scripts/verificacion/c-c3.js [--base http://localhost:4971/api]
 *   DATABASE_URL=… node scripts/verificacion/c-c3.js --arrancar
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4971/api");
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
  const puerto = new URL(BASE).port || "4971";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4972",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-c3-api.log"));
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
  recepcion: "demo.recepcion",
  muestreo: "demo.muestreo",
  lqaA1: "demo.lqa.analista1",
  lqaRev: "demo.lqa.revisor",
  lqaJefe: "demo.lqa.jefe",
  lesA1: "demo.les.analista1",
  lccJefe: "demo.lcc.jefe",
  lccA1: "demo.lcc.analista1",
  lqcA1: "demo.lqc.analista1",
  lemJefe: "demo.lem.jefe",
  lemA1: "demo.lem.analista1",
  lmtJefe: "demo.lmt.jefe",
  lmtA1: "demo.lmt.analista1",
  scc: "demo.scc.jefe",
  sccInsp: "demo.scc.inspector1",
  bpch: "demo.bpch.jefe",
};
const sello = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const diaCl = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const masDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ahoraCl = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
function pdf(nombre, campos = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  f.append("archivo", new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")], { type: "application/pdf" }), nombre);
  return f;
}
const C = {};

async function main() {
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  console.log(`Frente c3 · ${BASE}\n`);

  await paso("Preparación: laboratorios, cliente y métodos del catálogo", async () => {
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    for (const c of ["LQA", "LCC", "LEM", "LMT", "LQC"]) {
      C[c] = labs.find((u) => u.codigo === c);
      afirmar(C[c], `${c} no figura en /ot/laboratorios`);
    }
    C.cliente = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(76000000 + (parseInt(sello.slice(-6), 36) % 999999)), razonSocial: `Cliente c3 ${sello}`, tipo: "particulares",
      contactoNombre: "Ana Pérez Soto", contactoCargo: "Jefa de calidad", contactoEmail: `ana.${sello}@ejemplo.cl`,
    });
    const metodo = async (codigo) => {
      const m = lista(await ok(U.lqaJefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
      afirmar(m, `método ${codigo} no encontrado`);
      return m;
    };
    C.mCen = await metodo("386");
    C.mHum = await metodo("395");
    return `${C.cliente.razonSocial} · métodos ${C.mCen.codigo}, ${C.mHum.codigo}`;
  });

  /* ------------------------------------------------------------ B-030 */
  await paso("B-030 · La fecha de ingreso de hoy (medianoche UTC) queda en el día de Chile; otro día, a las 12:00 de Chile", async () => {
    const hoy = hoyCl();
    C.otLqa = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.LQA.id, conCobro: true, descripcionTrabajo: `c3 ${sello}`, fechaIngreso: `${hoy}T00:00:00.000Z`,
    });
    const ot = await ok(U.planif, "GET", `/ot/${C.otLqa.id}`);
    afirmar(diaCl(ot.fechaRecepcion) === hoy, `ingreso ${ot.fechaRecepcion} → ${diaCl(ot.fechaRecepcion)} en Chile, esperado ${hoy}`);
    const antes = masDias(hoy, -3);
    const o2 = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LQA.id, conCobro: false, fechaIngreso: `${antes}T00:00:00.000Z` });
    const ot2 = await ok(U.planif, "GET", `/ot/${o2.id}`);
    afirmar(diaCl(ot2.fechaRecepcion) === antes, `ingreso de otro día ${ot2.fechaRecepcion}`);
    await exigir(403, U.lesA1, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LQA.id, conCobro: false });
    return `${ot.codigo} ${diaCl(ot.fechaRecepcion)} · ${ot2.codigo} ${diaCl(ot2.fechaRecepcion)} (${ot2.fechaRecepcion}) · LES no registra OT (403)`;
  });

  await paso("B-030 · Preparación del LQA: «Fecha y hora» exige la hora; el LES no la registra (403)", async () => {
    const reg = await ok(U.recepcion, "POST", `/flujo/ot/${C.otLqa.id}/muestras`, {
      muestras: [{ nombre: `Harina c3 ${sello}`, metodoIds: [C.mHum.id, C.mCen.id], recepcion: { tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple" } }],
    });
    C.muestraLqa = reg.muestras[0];
    const v = await ok(U.lqaA1, "GET", `/formularios/ot/${C.otLqa.id}/preparacion`);
    const fila = v.filas.find((f) => f.muestra.id === C.muestraLqa.id && f.laboratorio === "LQA");
    const campo = fila?.campos.find((c) => c.campo === "fecha");
    afirmar(campo?.tipo === "fechahora", `campo fecha del LQA: ${campo?.tipo}`);
    const datos = { homogeneizacion: "Molienda y cuarteo", porcion_analitica: "5,0" };
    await exigir(400, U.lqaA1, "PUT", `/formularios/ot/${C.otLqa.id}/preparacion/${C.muestraLqa.id}`, { laboratorio: "LQA", datos: { ...datos, fecha: hoyCl() } }, /fecha y la hora/);
    await exigir(403, U.lesA1, "PUT", `/formularios/ot/${C.otLqa.id}/preparacion/${C.muestraLqa.id}`, { laboratorio: "LQA", datos: { ...datos, fecha: ahoraCl() } });
    const r = await ok(U.lqaA1, "PUT", `/formularios/ot/${C.otLqa.id}/preparacion/${C.muestraLqa.id}`, { laboratorio: "LQA", datos: { ...datos, fecha: ahoraCl() } });
    return `tipo ${campo.tipo} · solo fecha → 400 · LES 403 · registrada ${JSON.stringify(r?.registro?.datos?.valores?.fecha ?? r?.datos?.valores?.fecha ?? "")}`;
  });

  /* ------------------------------------------------------------ B-031 */
  await paso("B-031 · Campos de lectura de plomo (269): ppm, F y g en el orden de la fórmula; Stormer en K.U.", async () => {
    const plomo = lista(await ok(U.lqaJefe, "GET", "/cat/metodos?search=269&limit=50")).find((m) => m.codigo === "269");
    afirmar(plomo, "método 269 no encontrado");
    const pasos = lista(await ok(U.lqaJefe, "GET", `/pasos-metodo?catMetodoId=${plomo.id}&limit=50`)).filter((p) => p.activo !== false && p.catMetodoId === plomo.id);
    const nombres = pasos.sort((a, b) => a.orden - b.orden).map((p) => `${p.nombre}${p.unidad ? ` (${p.unidad})` : ""}`);
    afirmar(nombres.length === 3 && /ppm/.test(nombres[0]) && /Factor de dilución/.test(nombres[1]) && /\(g\)/.test(nombres[2]), `campos de plomo: ${nombres.join(" | ")}`);
    const st = lista(await ok(U.lqaJefe, "GET", "/cat/metodos?search=Viscosidad%20stormer&limit=50")).find((m) => m.codigo === "659");
    if (st) {
      const an = lista(await ok(U.lqaJefe, "GET", `/cat/analitos?metodoId=${st.id}&limit=20`)).filter((a) => a.metodoId === st.id);
      afirmar(!an.length || an.every((a) => a.unidad === "K.U."), `unidad Stormer: ${an.map((a) => a.unidad).join(",")}`);
    }
    return nombres.join(" | ");
  });

  /* ------------------------------------------------------------ B-032 */
  await paso("B-032 · «Decidir…» un «< LD» exige motivo; quien capturó no decide; el informe anota la decisión", async () => {
    const res = await ok(U.lqaA1, "GET", `/flujo/ot/${C.otLqa.id}/resultados`);
    C.rCen = res.resultados.find((r) => r.catMetodoId === C.mCen.id)?.id;
    afirmar(C.rCen, "sin resultado de cenizas");
    const cen = await ok(U.lqaA1, "POST", `/flujo/resultado/${C.rCen}/valor`, { valor: "< 10" });
    afirmar(cen.veredicto === "pendiente", `cenizas «< 10» → ${cen.veredicto}`);
    await exigir([403, 409], U.lqaA1, "POST", `/resultados/${C.rCen}/veredicto`, { veredicto: "cumple", motivo: "Lo decido yo mismo" });
    await exigir(400, U.lqaJefe, "POST", `/resultados/${C.rCen}/veredicto`, { veredicto: "cumple" }, /motivo/);
    const motivo = "Límite de detección sobre el requisito: se informa conforme según la norma";
    const v = await ok(U.lqaJefe, "POST", `/resultados/${C.rCen}/veredicto`, { veredicto: "cumple", motivo });
    afirmar(v.veredicto === "cumple" && v.veredictoMotivo === motivo, `veredicto ${v.veredicto} · motivo ${v.veredictoMotivo}`);
    const pls = lista(await ok(U.lqaJefe, "GET", "/plantillas?limit=100"));
    const pl = pls.find((p) => /ENSAYO|^IE$/i.test(p.tipo ?? "") && /LQA|ALIMENT/i.test(`${p.repid} ${p.nombre}`)) ?? pls.find((p) => /ENSAYO|^IE$/i.test(p.tipo ?? ""));
    afirmar(pl, "sin plantilla IE");
    const pv = await ok(U.lqaJefe, "POST", "/informes/previsualizar", { otId: C.otLqa.id, plantillaId: pl.id });
    afirmar(/Veredicto decidido por el revisor/.test(pv.html ?? ""), "el informe no anota la decisión del revisor");
    return `analista 403/409 · sin motivo 400 · decidido con motivo · informe ${pl.repid ?? pl.nombre} con la nota`;
  });

  /* ------------------------------------------------------------ B-033 */
  await paso("B-033 · Inspección sin ensayo de la E.T. forma el checklist y se captura; Ventas no confirma el plan (403)", async () => {
    const et = await ok(U.lccJefe, "POST", "/especificaciones-tecnicas", { codigo: `ET-C3-${sello}`, nombre: "Bota c3", laboratorios: [C.LCC.id], origen: "cliente" });
    const cat = await ok(U.lccJefe, "GET", `/especificaciones-tecnicas/catalogo/metodos?laboratorio=${C.LCC.id}`);
    const mHilo = (cat.metodos ?? []).find((m) => m.analitos.length === 1);
    afirmar(mHilo, "sin método del LCC con un analito");
    const puntos = [
      { punto: "6.2", caracteristica: "Empaque", tipo: "inspeccion", requisito: "Par en caja individual" },
      { punto: "5.1", caracteristica: "Ensayo del producto", tipo: "numerico", catMetodoId: mHilo.id, limiteInf: "0" },
    ];
    await ok(U.lccJefe, "PUT", `/especificaciones-tecnicas/${et.id}/puntos`, { puntos });
    const pub = await ok(U.lccJefe, "POST", `/especificaciones-tecnicas/${et.id}/publicar`);
    C.otLcc = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LCC.id, conCobro: false, descripcionTrabajo: `c3 ${sello}: botas` });
    await ok(U.ventas, "PUT", `/especificaciones-tecnicas/ot/${C.otLcc.id}`, { etId: pub.id ?? et.id });
    const reg = await ok(U.lccA1, "POST", `/flujo/ot/${C.otLcc.id}/muestras`, { muestras: [{ nombre: "Par de botas c3", metodoIds: [mHilo.id], claseCustodia: "contramuestra" }] });
    C.mBota = reg.muestras[0];
    const plan = await ok(U.lccA1, "GET", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`);
    afirmar(plan.plan.inspecciones.puntos.length === 1 && plan.plan.inspecciones.sinEnsayo.length === 1 && plan.plan.sinEnsayo.length === 0, `plan ${JSON.stringify(plan.plan).slice(0, 200)}`);
    await exigir(403, U.ventas, "POST", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`, {});
    await ok(U.lccA1, "POST", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`, {});
    await ok(U.lccA1, "POST", `/especificaciones-tecnicas/muestra/${C.mBota.id}/desglose`, {});
    const res = await ok(U.lccA1, "GET", `/flujo/ot/${C.otLcc.id}/resultados`);
    const item = res.resultados.filter((r) => r.inspeccionEt && r.muestraId === C.mBota.id);
    afirmar(item.length === 1 && /Empaque/.test(item[0].analitoNombre) && item[0].tipoDato === "atributo" && item[0].puedo?.capturar, `ítem ${JSON.stringify(item.map((x) => [x.analitoNombre, x.tipoDato, x.puedo]))}`);
    const cap = await ok(U.lccA1, "POST", `/flujo/resultado/${item[0].id}/valor`, { atributo: "cumple", valor: "Caja individual rotulada" });
    afirmar(cap.veredicto === "cumple", `captura del ítem → ${cap.veredicto}`);
    await exigir(403, U.lesA1, "POST", `/flujo/resultado/${item[0].id}/valor`, { atributo: "cumple" });
    return `«${item[0].analitoNombre}» (1 sola vez tras 2 confirmaciones) capturado Cumple · LES 403`;
  });

  /* ------------------------------------------------------------ B-034 */
  await paso("B-034 · Devolver el excedente del lote no dispone de la contramuestra; Ventas no registra custodia (403)", async () => {
    const cuerpo = { muestraId: C.mBota.id, evento: "devolucion", porcion: "excedente", cantidadDevuelta: 12, guiaDespacho: `GD-${sello.slice(-5)}`, medioDevolucion: "retiro del proveedor", motivo: "Excedente del lote" };
    await exigir(403, U.ventas, "POST", "/custodia", cuerpo);
    const c = await ok(U.lccJefe, "POST", "/custodia", cuerpo);
    const ret = lista(await ok(U.lccJefe, "GET", "/recepcion/retenciones")).find((x) => x.id === C.mBota.id);
    afirmar(!ret || (ret.estado !== "dispuesta" && !ret.disposicion), `contramuestra tras devolver el excedente: ${JSON.stringify(ret && [ret.estado, ret.disposicion])}`);
    const cadena = lista(await ok(U.lccJefe, "GET", `/custodia?muestraId=${C.mBota.id}&limit=50`));
    const dev = cadena.find((x) => x.id === c.id);
    afirmar(dev?.porcion === "excedente", `eslabón ${dev?.porcion}`);
    return `eslabón «excedente» · contramuestra ${ret ? ret.estado : "sin retención"}`;
  });

  /* ------------------------------------------------------------ B-035 */
  await paso("B-035 · Editar el precio del ensayo con el valor como texto (como lo envía el formulario); un analista no (403)", async () => {
    const e = lista(await ok(U.calidad, "GET", `/cat/ensayos?search=${encodeURIComponent(C.mCen.ensayo?.codigo ?? "")}&limit=5`))[0]
      ?? lista(await ok(U.calidad, "GET", "/cat/ensayos?limit=1"))[0];
    afirmar(e, "sin ensayos en el catálogo");
    const precio = String(e.precio ?? "1000");
    await exigir(403, U.lqaA1, "PATCH", `/cat/ensayos/${e.id}`, { precio });
    const r = await ok(U.calidad, "PATCH", `/cat/ensayos/${e.id}`, { precio });
    afirmar(Number(r.precio) === Number(precio), `precio ${r.precio}`);
    return `${e.codigo}: precio «${precio}» guardado`;
  });

  /* ------------------------------------------------------------ B-036 */
  await paso("B-036 · La E.T. se asocia a su cliente: buscador acotado para el Jefe del LEM; el analista no (403)", async () => {
    const pref = C.cliente.razonSocial.slice(0, 10);
    const cl = await ok(U.lemJefe, "GET", `/especificaciones-tecnicas/clientes?q=${encodeURIComponent(pref)}`);
    afirmar(cl.some((x) => x.id === C.cliente.id) && Object.keys(cl[0]).sort().join() === "id,razonSocial,rut", `buscador: ${JSON.stringify(cl[0])}`);
    await exigir(403, U.lemA1, "GET", `/especificaciones-tecnicas/clientes?q=${encodeURIComponent(pref)}`);
    const et = await ok(U.lemJefe, "POST", "/especificaciones-tecnicas", { codigo: `ET-LEM-C3-${sello}`, nombre: "E.T. de cliente c3", laboratorios: [C.LEM.id], origen: "cliente", reutilizable: false, clienteId: C.cliente.id });
    const d = await ok(U.lemJefe, "GET", `/especificaciones-tecnicas/${et.id}`);
    afirmar((d.clienteId ?? d.et?.clienteId) === C.cliente.id, "la E.T. no quedó con su cliente");
    const ed = await ok(U.lemJefe, "PUT", `/especificaciones-tecnicas/${et.id}`, { clienteId: null });
    afirmar((ed.clienteId ?? ed.et?.clienteId ?? null) === null, "no se pudo quitar el cliente en borrador");
    return `alta con cliente y corrección en borrador · analista 403`;
  });

  /* ------------------------------------------------------------ B-038 */
  await paso("B-038 · El contacto principal de la ficha está en Contactos; marcar otro como principal actualiza la ficha", async () => {
    const cts = await ok(U.ventas, "GET", `/clientes/${C.cliente.id}/contactos`);
    const pr = cts.find((c) => c.principal);
    afirmar(pr && pr.nombre === "Ana Pérez Soto" && pr.cargo === "Jefa de calidad", `contactos ${JSON.stringify(cts)}`);
    await exigir(403, U.lqaA1, "POST", "/contactos", { clienteId: C.cliente.id, nombre: "Otro", principal: true });
    const nuevo = await ok(U.ventas, "POST", "/contactos", { clienteId: C.cliente.id, nombre: "Bruno Díaz", cargo: "Comprador", principal: true });
    const cts2 = await ok(U.ventas, "GET", `/clientes/${C.cliente.id}/contactos`);
    afirmar(cts2.filter((c) => c.principal).length === 1 && cts2.find((c) => c.principal).id === nuevo.id, "más de un principal");
    const cli = await ok(U.ventas, "GET", `/clientes/${C.cliente.id}`);
    afirmar(cli.contactoNombre === "Bruno Díaz", `ficha ${cli.contactoNombre}`);
    C.contacto = nuevo;
    return `principal «${pr.nombre}» → «Bruno Díaz» (ficha actualizada) · analista 403`;
  });

  /* ------------------------------------------- B-086, B-090, B-038 (cotización → OT) */
  await paso("B-086/B-090/B-038 · Cotización con gasto: la bitácora anota la aceptación y la OT; el gasto no va a la recepción; la OT trae el solicitante", async () => {
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    const cc = (cfg.centrosCosto ?? []).find((c) => (c.laboratorio ?? c.codigo ?? "").toUpperCase() === "LQA") ?? null;
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", plazoEntregaDias: 10, referencia: `c3 ${sello}`, ...(cc ? { centroCostoId: cc.id } : {}),
      solicitud: { solicitanteContactoId: C.contacto.id },
      lineas: [
        { catEnsayoId: C.mHum.ensayoId, cantidad: 1 },
        { tipo: "otros", descripcion: "Traslado de la muestra", cantidad: 1, precioUnitario: 15000 },
      ],
    });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    await exigir(403, U.lqaA1, "POST", `/cotizaciones/${C.cot.id}/aceptar`, { tipo: "OC", numero: "X", unidadPrincipalId: C.LQA.id });
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, { tipo: "OC", numero: `OC-C3-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.LQA.id });
    C.otCot = r.ot;
    const circ = await ok(U.ventas, "GET", `/cotizaciones/${C.cot.id}/circuito`);
    const ev = (circ.eventos ?? []).find((e) => e.accion === "aceptada");
    afirmar(ev && ev.detalle?.otId === r.ot.id && ev.detalle?.otCodigo === r.ot.codigo, `bitácora sin la aceptación: ${JSON.stringify((circ.eventos ?? []).map((e) => e.accion))}`);
    const prop = await ok(U.lqaJefe, "GET", `/flujo/ot/${r.ot.id}/registro-muestras`);
    afirmar(prop.lineas.length === 1 && prop.lineas[0].ensayoId === C.mHum.ensayoId, `líneas propuestas ${JSON.stringify(prop.lineas.map((l) => l.descripcion))}`);
    const ot = await ok(U.ventas, "GET", `/ot/${r.ot.id}`);
    afirmar(/Bruno Díaz/.test(ot.solicitante ?? ""), `solicitante de la OT «${ot.solicitante}»`);
    return `${C.cot.codigo} → ${r.ot.codigo} en la bitácora · recepción sin el traslado · solicitante «${ot.solicitante}»`;
  });

  /* ------------------------------------------------------------ B-084 */
  await paso("B-084 · Datos del encargo: forma de pago con su etiqueta; la OT del BPCH emite Informe de Inspección", async () => {
    const e = await ok(U.ventas, "GET", `/ot/${C.otCot.id}/encargo`);
    afirmar((e.listas.formaPago ?? []).some((o) => o.codigo === "contado_30" && /Contado 30/.test(o.etiqueta)), "sin la lista de formas de pago");
    afirmar(e.documentoPropuesto !== "II", `una OT del LQA no emite II (${e.documentoPropuesto})`);
    const labs = await ok(U.planif, "GET", "/ot/laboratorios");
    const suc = labs.find((u) => u.codigo === "SSTGO");
    afirmar(suc, "SSTGO no figura entre los laboratorios");
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: suc.id, notas: "OT directa de inspección (c3)" });
    const eb = await ok("demo.sstgo.jefe", "GET", `/ot/${ot.id}/encargo`);
    afirmar(eb.documentoPropuesto === "II", `OT del BPCH (${suc.codigo}) propone ${eb.documentoPropuesto}`);
    return `forma de pago con etiqueta · ${suc.codigo}: Emite II`;
  });

  /* ------------------------------------------------------------ B-045 */
  await paso("B-045 · Línea de cotización de Metrología con instrumento; «Cargar desde la cotización» lo hereda", async () => {
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    const cc = (cfg.centrosCosto ?? []).find((c) => ["LMT"].includes((c.laboratorio ?? c.codigo ?? "").toUpperCase()));
    const ens = lista(await ok(U.lmtJefe, "GET", "/cat/ensayos?search=EN1074&limit=5"))[0] ?? lista(await ok(U.lmtJefe, "GET", "/cat/ensayos?search=EN&limit=5"))[0];
    afirmar(ens, "sin ensayo de calibración en el catálogo");
    const cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", plazoEntregaDias: 10, referencia: `c3 met ${sello}`, ...(cc ? { centroCostoId: cc.id } : {}),
      lineas: [{ catEnsayoId: ens.id, cantidad: 1, instrumento: "Balanza analítica", instrumentoMarca: "Marca Demo", instrumentoModelo: "BA-220", instrumentoRango: "0 – 220 g", instrumentoPuntos: "10, 50, 100, 200 g" }],
    });
    const l = cot.lineas?.[0];
    afirmar(l?.instrumento === "Balanza analítica" && l.instrumentoRango === "0 – 220 g", `línea ${JSON.stringify(l)}`);
    await exigir(400, U.ventas, "POST", "/cotizaciones", { clienteId: C.cliente.id, formato: "NORMAL", lineas: [{ catEnsayoId: ens.id, cantidad: 1, instrumentoSentido: "X" }] });
    await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/aceptar`, { tipo: "OC", numero: `OC-MET-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.LMT.id });
    await exigir(403, U.lqaA1, "POST", `/ot/${r.ot.id}/instrumentos/desde-cotizacion`);
    await ok(U.lmtJefe, "POST", `/ot/${r.ot.id}/instrumentos/desde-cotizacion`);
    const it = await ok(U.lmtJefe, "GET", `/ot/${r.ot.id}/metrologia`);
    const item = (it.items ?? it.instrumentos ?? it.data?.items ?? [])[0];
    afirmar(item && item.descripcion === "Balanza analítica" && item.marca === "Marca Demo" && item.rango === "0 – 220 g" && item.puntos === "10, 50, 100, 200 g", `ítem ${JSON.stringify(item)}`);
    return `${r.ot.codigo}: ítem «${item.descripcion} · ${item.marca} ${item.modelo} · ${item.rango}» · analista LQA 403`;
  });

  /* ------------------------------------------------------------ B-046 */
  await paso("B-046 · Plan NCh 44 del lote con los parámetros de la operación; sin sesión no (401)", async () => {
    const p = await ok(U.sccInsp, "GET", "/muestreo/plan?tamanoLote=500&config=1");
    afirmar(p.letra === "H" && p.nExtraer === 50 && p.clases?.mayor?.ac === 3 && p.clases?.mayor?.re === 4, `plan ${JSON.stringify(p).slice(0, 200)}`);
    await exigir(401, null, "GET", "/muestreo/plan?tamanoLote=500&config=1");
    return `lote 500 → letra ${p.letra}, n = ${p.nExtraer}, mayores Ac ${p.clases.mayor.ac} / Re ${p.clases.mayor.re}`;
  });

  /* ------------------------------------------------------------ B-087 */
  await paso("B-087 · El muestreo nuevo trae proveedor, lugar, producto y lote del encargo; Ventas no muestrea (403)", async () => {
    await ok(U.planif, "PUT", `/ot/${C.otLcc.id}/encargo`, { proveedor: "Proveedor Demo Ltda.", lugarMuestreo: "Bodega del proveedor", item: "Bota de servicio", cantidad: 500, unidadCantidad: "pares" });
    await exigir(403, U.ventas, "POST", `/muestreo/ot/${C.otLcc.id}`, { tipoFormulario: "extraccion", numeroFormulario: `EXT-V-${sello}` });
    const r = await ok(U.muestreo, "POST", `/muestreo/ot/${C.otLcc.id}`, { tipoFormulario: "extraccion", numeroFormulario: `EXT-C3-${sello}` });
    const mu = (r.muestreos ?? []).find((m) => m.numeroFormulario === `EXT-C3-${sello}`);
    afirmar(mu && mu.proveedor === "Proveedor Demo Ltda." && mu.lugar === "Bodega del proveedor" && /Bota de servicio/.test(mu.producto ?? "") && Number(mu.tamanoLote) === 500, `muestreo ${JSON.stringify(mu && [mu.proveedor, mu.lugar, mu.producto, mu.tamanoLote])}`);
    return `${mu.numeroFormulario}: ${mu.proveedor} · ${mu.lugar} · ${mu.producto} · lote ${mu.tamanoLote}`;
  });

  /* ------------------------------------------------------------ B-089 */
  await paso("B-089 · LEM con lugar de ejecución en una unidad militar: se propone en terreno y exige aprobación", async () => {
    const ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LEM.id, conCobro: false, descripcionTrabajo: `c3 terreno ${sello}` });
    await ok(U.planif, "PUT", `/ot/${ot.id}/encargo`, { lugarEjecucion: "UNIDAD_MILITAR" });
    const t = await ok(U.lemJefe, "GET", `/formularios/ot/${ot.id}/trabajo`);
    afirmar(t.documentacion?.terreno === true && t.exige === true, `terreno ${t.documentacion?.terreno} · exige ${t.exige}`);
    await exigir(403, U.lesA1, "GET", `/formularios/ot/${ot.id}/trabajo`);
    const ot2 = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.LEM.id, conCobro: false });
    await ok(U.planif, "PUT", `/ot/${ot2.id}/encargo`, { lugarEjecucion: "IDIC" });
    const t2 = await ok(U.lemJefe, "GET", `/formularios/ot/${ot2.id}/trabajo`);
    afirmar(t2.documentacion?.terreno !== true, "en el IDIC no es terreno");
    return `${ot.codigo}: en terreno (aprobación previa) · ${ot2.codigo} en el IDIC: no · LES 403`;
  });

  /* ------------------------------------------------------------ B-091 */
  await paso("B-091 · El buscador de métodos trae el laboratorio del ensayo", async () => {
    const ms = lista(await ok(U.sccInsp, "GET", "/cat/metodos?search=Inspecci%C3%B3n%20visual&limit=20"));
    afirmar(ms.length > 0, "sin métodos");
    const conLab = ms.filter((m) => m.ensayo?.familia);
    afirmar(conLab.length > 0, "ningún método trae ensayo.familia");
    return `${ms.length} métodos · ${conLab.length} con laboratorio (${[...new Set(conLab.map((m) => m.ensayo.familia.laboratorio ?? m.ensayo.familia.nombre))].slice(0, 3).join(", ")})`;
  });

  /* ------------------------------------------------------------ B-092 */
  await paso("B-092 · La prueba IT21 admite su registro adjunto; clase desconocida 400; Ventas 403", async () => {
    const c = await ok(U.sccInsp, "POST", "/bpch/clasificaciones", { sustancia: `Sustancia c3 ${sello}`, descripcion: "Prueba", pruebas: { it21: { aplica: true, serie1: { ensayos: [{ tuboFragmentado: false, placaPerforada: false }] } } } });
    const a = await exigir([200, 201], U.sccInsp, "POST", `/bpch/clasificaciones/${c.id}/adjuntos`, pdf("registro-it21.pdf", { clase: "registro_it21" }));
    await exigir(400, U.sccInsp, "POST", `/bpch/clasificaciones/${c.id}/adjuntos`, pdf("otro.pdf", { clase: "video" }));
    await exigir(403, U.ventas, "POST", `/bpch/clasificaciones/${c.id}/adjuntos`, pdf("x.pdf", { clase: "registro_it21" }));
    const d = await ok(U.sccInsp, "GET", `/bpch/clasificaciones/${c.id}`);
    afirmar((d.adjuntos ?? []).some((x) => x.clase === "registro_it21"), "el adjunto no figura en la clasificación");
    return `${c.codigo}: registro IT21 adjunto (${a.nombre ?? "pdf"})`;
  });

  /* ------------------------------------------------------------ B-040 */
  await paso("B-040 · La OT con cobro sin cotización se cierra con una factura con las líneas de sus ensayos", async () => {
    const res = await ok(U.lqaA1, "GET", `/flujo/ot/${C.otLqa.id}/resultados`);
    const hum = res.resultados.find((r) => r.catMetodoId === C.mHum.id);
    await ok(U.lqaA1, "POST", `/flujo/resultado/${hum.id}/valor`, { replicasTexto: "13,2 13,4" });
    await ok(U.lqaRev, "POST", `/resultados/ot/${C.otLqa.id}/revisar`, {});
    await ok(U.lqaJefe, "POST", `/resultados/ot/${C.otLqa.id}/revisar`, {}).catch(() => null);
    await ok(U.lqaJefe, "POST", `/resultados/ot/${C.otLqa.id}/aprobar`, {});
    const pls = lista(await ok(U.lqaJefe, "GET", "/plantillas?limit=200"));
    const pl = pls.find((p) => /ENSAYO|^IE$/i.test(p.tipo ?? "") && /LQA|ALIMENT/i.test(`${p.repid} ${p.nombre}`)) ?? pls.find((p) => /ENSAYO|^IE$/i.test(p.tipo ?? ""));
    const doc = await ok(U.lqaJefe, "POST", "/informes/emitir", { otId: C.otLqa.id, plantillaId: pl.id });
    const d0 = doc.certificado ?? doc.documento ?? doc;
    const docId = d0.id ?? doc.certificadoId ?? doc.id;
    afirmar(docId, `la emisión no devolvió el documento: ${JSON.stringify(doc).slice(0, 200)}`);
    for (const u of ["demo.lqa.jefe", "demo.lqa.revisor", "demo.lqa.analista2", "demo.dqo.jefe", "demo.director", "demo.dco.jefe", "demo.sal.jefe", "demo.calidad"]) await login(u).catch(() => null);
    const porId = Object.fromEntries(Object.entries(sesiones).map(([u, x]) => [x.id, u]));
    const circ = await ok(U.lqaJefe, "GET", `/informes/${docId}/circuito`);
    const pasosFirma = circ.pasos ?? [];
    const firmantes = new Set();
    for (const orden of [...new Set(pasosFirma.map((p) => p.orden))].sort((a, b) => a - b)) {
      for (const p of pasosFirma.filter((x) => x.orden === orden && x.estado !== "omitido")) {
        const cand = (p.responsables ?? []).map((r) => porId[r.usuarioId]).filter(Boolean);
        const quien = cand.find((u) => !firmantes.has(u)) ?? cand[0];
        afirmar(quien, `paso ${orden}: sin responsable entre los usuarios de prueba (${(p.responsables ?? []).map((r) => r.nombre).join(", ")})`);
        await ok(quien, "POST", `/informes/${docId}/firmar`, {});
        firmantes.add(quien);
      }
    }
    await ok(U.planif, "POST", `/informes/${docId}/entregar`, { medio: "correo", destinatario: "c3@example.cl" });
    await exigir(403, U.lqaA1, "POST", `/ot/${C.otLqa.id}/cerrar`, {});
    const r = await ok(U.planif, "POST", `/ot/${C.otLqa.id}/cerrar`, {});
    const fac = r.facturaCreada;
    afirmar(fac, "no se generó la factura en borrador");
    const f = await ok(U.finanzas, "GET", `/facturas/${fac.id}`);
    const lineas = f.lineas ?? [];
    afirmar(lineas.length === 2 && Number(f.neto) > 0 && lineas.every((l) => /^\d+ · /.test(l.descripcion) && !/^(\d+) · \1 ·/.test(l.descripcion)), `factura ${JSON.stringify(lineas.map((l) => [l.descripcion, l.subtotal]))}`);
    return `${fac.numero}: ${lineas.map((l) => `${l.descripcion} $${Number(l.subtotal)}`).join(" · ")} · neto $${Number(f.neto)} · analista no cierra (403)`;
  });

  /* ------------------------------------------------------------ B-097 */
  await paso("B-097 · Base de demostración: equipos vigentes en LQC, LPN y LME; OT interlaboratorio con el cliente interno", async () => {
    const eqs = lista(await ok(U.calidad, "GET", "/equipos?search=DEMO-&limit=100"));
    const hoy = hoyCl();
    for (const c of ["DEMO-LQC-BAL-02", "DEMO-LPN-VIS-01", "DEMO-LME-BAL-01"]) {
      const e = eqs.find((x) => x.codigo === c);
      afirmar(e && String(e.proxima_calibracion ?? e.proximaCalibracion).slice(0, 10) > hoy, `${c}: ${JSON.stringify(e && (e.proxima_calibracion ?? e.proximaCalibracion))}`);
    }
    const cl = lista(await ok(U.ventas, "GET", "/clientes?tipo=interlaboratorio&limit=5"));
    afirmar(cl.length >= 1, "sin cliente interlaboratorio");
    return `3 equipos vigentes · cliente «${cl[0].razonSocial}»`;
  });
}

main()
  .then(() => {
    const fallos = pasos.filter((p) => !p.ok).length;
    console.log(fallos ? `\nFrente c3: ${pasos.length - fallos} pasos OK, ${fallos} con fallo.` : `\nFrente c3: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(fallos ? 1 : 0);
  })
  .catch((e) => {
    console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    pararApi();
    process.exit(1);
  });
