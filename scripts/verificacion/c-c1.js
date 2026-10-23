#!/usr/bin/env node
/**
 * Frente c1 · Permisos, alcance, OT y bandejas · correcciones del recorrido de
 * los manuales de proceso v2.0 (backlog B-nnn, 23-10-2026). Cada fallo
 * corregido se reproduce con un perfil demo.* que puede y otro que no.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/c-c1.js [--arrancar] [--base http://localhost:4951/api]
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4951/api");
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
    sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id ?? carga.sub, permisos: carga.permisos ?? [] };
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
  const puerto = new URL(BASE).port || "4951";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4952",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-c1-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  admin: "demo.admin",
  ventas: "demo.ventas",
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  calidad: "demo.calidad",
  auditor: "demo.auditor",
  lqaJefe: "demo.lqa.jefe",
  lqaAnalista: "demo.lqa.analista1",
  lmbJefe: "demo.lmb.jefe",
  lmbAnalista: "demo.lmb.analista1",
  lpnJefe: "demo.lpn.jefe",
  lpnAnalista: "demo.lpn.analista1",
  lmeJefe: "demo.lme.jefe",
  lmeAnalista: "demo.lme.analista1",
  lqcJefe: "demo.lqc.jefe",
};
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const masDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function rechazo(esperado, patron, u, m, ruta, c) { return exigir(esperado, u, m, ruta, c, patron); }
const sello = Date.now().toString(36);

/* =============================================================== PASOS === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const unidades = lista(await ok(U.admin, "GET", "/ot/laboratorios"));
  C.u = Object.fromEntries(unidades.map((x) => [x.codigo, x]));
  C.cliente = lista(await ok(U.ventas, "GET", "/clientes?limit=5"))[0];
  afirmar(C.cliente, "no hay clientes en la base");

  /* ------------------------------------------------------------ B-001 */
  const metodo = async (codigo) => {
    const m = lista(await ok(U.admin, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
    afirmar(m, `no existe el método ${codigo}`);
    return m;
  };
  const elemento = async (codigo, nombre) => {
    const e = lista(await ok(U.admin, "GET", `/cat/elementos?search=${encodeURIComponent(nombre ?? codigo)}&limit=200`)).find((x) => x.codigo === codigo);
    afirmar(e, `no existe el elemento ${codigo}`);
    return e;
  };
  await paso("B-001 · Comercial (sin muestra.crear) registra la OT con su elemento y métodos: OT y muestras en una sola operación", async () => {
    const s = await login(U.ventas);
    afirmar(s.permisos.includes("ot.crear") && !s.permisos.includes("muestra.crear"), "demo.ventas debería tener ot.crear y no muestra.crear");
    C.nitrato = await elemento("6697");
    C.m11301 = await metodo("11301");
    const cuerpo = {
      clienteId: C.cliente.id, unidadPrincipalId: C.u.LME.id, origenTrabajo: "INSTITUCIONAL", oficioNumero: `OF-C1-${sello}`, oficioFecha: hoyCl(), conCobro: false,
      muestras: [{ catElementoId: C.nitrato.id, metodoIds: [C.m11301.id] }, { catElementoId: C.nitrato.id, metodoIds: [C.m11301.id] }],
    };
    C.otLme = await ok(U.ventas, "POST", "/ot", cuerpo);
    const reg = await ok(U.lmeJefe, "GET", `/flujo/ot/${C.otLme.id}/registro-muestras`);
    afirmar(reg.muestras.length === 2 && reg.muestras.every((m) => m.ensayos > 0), `muestras ${JSON.stringify(reg.muestras.map((m) => [m.codigo, m.ensayos]))}`);
    // B-011: la descripción es el producto, nunca «Lab. X [códigos]».
    afirmar(reg.muestras.every((m) => m.nombre === "Nitrato de Amonio" && !/\[/.test(m.nombre)), `descripción ${reg.muestras.map((m) => m.nombre)}`);
    // Todo o nada: si una muestra falla no queda la OT a medias.
    const antes = (await ok(U.admin, "GET", "/ot?limit=1")).meta.total;
    const generico = await elemento("90", "Materiales Energ");
    await rechazo(400, /descripción/, U.ventas, "POST", "/ot", { ...cuerpo, oficioNumero: `OF-C1-${sello}-b`, muestras: [{ catElementoId: generico.id, metodoIds: [C.m11301.id] }] });
    await rechazo(400, /no existe|método/, U.ventas, "POST", "/ot", {
      ...cuerpo, oficioNumero: `OF-C1-${sello}-c`,
      muestras: [{ catElementoId: C.nitrato.id, metodoIds: [C.m11301.id] }, { catElementoId: C.nitrato.id, metodoIds: ["00000000-0000-4000-8000-000000000000"] }],
    });
    const despues = (await ok(U.admin, "GET", "/ot?limit=1")).meta.total;
    afirmar(antes === despues, `quedó una OT a medias (${antes} → ${despues})`);
    // Quien no tiene ot.crear no registra nada.
    await exigir(403, U.lmeAnalista, "POST", "/ot", cuerpo);
    return `${C.otLme.codigo} con 2 muestras «Nitrato de Amonio»; muestra que falla → 400 sin OT a medias; sin ot.crear → 403`;
  });

  /* ------------------------------------------------------------ B-009 */
  await paso("B-009 · OT sin elemento (calibración, OT interna) y con métodos del laboratorio sin elemento", async () => {
    const sinNada = await ok(U.ventas, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.u.LQC.id, origenTrabajo: "OT_INTERNA", tipoTrabajo: "CALIBRACION" });
    afirmar(sinNada.id, "no se creó la OT sin elementos");
    const conMetodos = await ok(U.ventas, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.u.LME.id,
      muestras: [{ nombre: "Pólvora negra lote C1", metodoIds: [C.m11301.id] }],
    });
    const reg = await ok(U.lmeJefe, "GET", `/flujo/ot/${conMetodos.id}/registro-muestras`);
    afirmar(reg.muestras.length === 1 && reg.muestras[0].nombre === "Pólvora negra lote C1" && !reg.muestras[0].catElementoId, "muestra sin elemento");
    await rechazo(400, /descripción/, U.ventas, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.u.LME.id, muestras: [{ metodoIds: [C.m11301.id] }] });
    return `${sinNada.codigo} sin elementos · ${conMetodos.codigo} con métodos sin elemento`;
  });

  /* ------------------------------------------------------------ B-010 */
  await paso("B-010 · toda OT nace con fecha de compromiso (plazo por defecto del parámetro ot_plazo)", async () => {
    const d = await ok(U.lmeJefe, "GET", `/ot/${C.otLme.id}`);
    afirmar(d.fechaCompromiso, "la OT nace sin fecha de compromiso");
    const dia = String(d.fechaCompromiso).slice(0, 10);
    afirmar(dia === masDias(hoyCl(), 10), `fecha ${dia}, esperada ${masDias(hoyCl(), 10)}`);
    return `fecha de compromiso ${dia} (hoy + 10 días corridos)`;
  });

  /* ------------------------------------------------------------ B-011 / B-012 */
  await paso("B-011/B-012 · la recepción no ofrece el elemento del laboratorio como producto; Registrar OT ofrece los productos del LME", async () => {
    const pr = await ok(U.lmeJefe, "GET", `/recepcion/ot/${C.otLme.id}/productos`);
    afirmar(pr.productos.some((p) => p.codigo === "6697") && !pr.productos.some((p) => /^Lab/.test(p.nombreCatalogo)), "productos del LME");
    const otLqc = await ok(U.ventas, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.u.LQC.id });
    const lqc = await ok(U.lqcJefe, "GET", `/recepcion/ot/${otLqc.id}/productos`);
    afirmar(!lqc.productos.some((p) => /Quimico Central/i.test(p.nombre)) && lqc.sinLista === true, `LQC ofrece ${lqc.productos.map((p) => p.nombre)}`);
    const busca = await ok(U.lqcJefe, "GET", `/recepcion/ot/${otLqc.id}/productos?search=Quimico`);
    afirmar(!busca.encontrados.some((p) => /Quimico Central/i.test(p.nombre)), "la búsqueda ofrece el elemento genérico");
    const generico = await elemento("90", "Materiales Energ");
    const prods = await ok(U.ventas, "GET", `/recepcion/elemento/${generico.id}/productos`);
    afirmar(prods.productos.length === 4 && prods.productos.some((p) => p.codigo === "6697" && p.metodos > 0), `productos ${JSON.stringify(prods.productos.map((p) => p.codigo))}`);
    return `LME: ${pr.productos.length} productos · LQC sin lista (sinLista) · elemento 90 → ${prods.productos.length} productos con panel`;
  });

  /* ------------------------------------------------------------ B-013 */
  await paso("B-013 · testigo del LME sin ensayos → bodega con retención; muestra de análisis sin métodos → 400", async () => {
    const otT = await ok(U.ventas, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.u.LME.id });
    const reg = await ok(U.lmeJefe, "GET", `/flujo/ot/${otT.id}/registro-muestras`);
    const toma = reg.opcionesToma[0]?.codigo;
    const recep = (clase) => ({ tomaMuestra: toma, condicionRecepcion: "cumple", claseCustodia: clase, catElementoId: C.nitrato.id, datos: { verif_especificacion: true, verif_ot: true, verif_formulario_muestreo: true } });
    await rechazo(400, /al menos un método/, U.lmeJefe, "POST", `/flujo/ot/${otT.id}/muestras`, { muestras: [{ nombre: "Nitrato análisis", metodoIds: [], recepcion: recep("analisis") }] });
    const r = await ok(U.lmeJefe, "POST", `/flujo/ot/${otT.id}/muestras`, { muestras: [{ nombre: "Testigo nitrato de amonio", metodoIds: [], recepcion: recep("testigo") }] });
    afirmar(r.muestras.length === 1 && r.ensayos === 0, JSON.stringify(r).slice(0, 200));
    const ret = await ok(U.lmeJefe, "GET", "/recepcion/retenciones");
    afirmar(JSON.stringify(ret).includes(r.muestras[0].codigo), "el testigo no figura en retenciones");
    await exigir(403, U.ventas, "POST", `/flujo/ot/${otT.id}/muestras`, { muestras: [{ nombre: "Testigo", metodoIds: [], recepcion: recep("testigo") }] });
    return `${r.muestras[0].codigo} testigo sin ensayos, en retenciones; Comercial sin muestra.crear → 403`;
  });

  /* ------------------------------------------------------------ B-002 */
  await paso("B-002 · el laboratorio que participa (destino de una orden interna) abre el expediente, la ruta, sus muestras y la cobertura de emisión; otro laboratorio no", async () => {
    const lqaEl = await elemento("86", "Bromatolog");
    const panel = lista(await ok(U.admin, "GET", `/cascada/elementos/${lqaEl.id}/panel`));
    afirmar(panel.length, "el elemento 86 no tiene panel");
    C.otLqa = await ok(U.ventas, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.u.LQA.id,
      muestras: [{ catElementoId: lqaEl.id, nombre: "Queso fresco lote C1", metodoIds: [panel[0].metodoId] }],
    });
    const reg = await ok(U.lqaJefe, "GET", `/flujo/ot/${C.otLqa.id}/registro-muestras`);
    // Antes de la orden interna, el LMB no ve la OT.
    await exigir(403, U.lmbAnalista, "GET", `/ot/${C.otLqa.id}`);
    const destinos = await ok(U.lqaJefe, "GET", `/ordenes-internas/destinos?otId=${C.otLqa.id}`);
    const lmb = destinos.find((d) => d.unidadCodigo === "LMB");
    afirmar(lmb, `LMB no figura como destino (${destinos.map((d) => d.unidadCodigo)})`);
    const ens = await ok(U.lqaJefe, "GET", `/ordenes-internas/destinos/${lmb.id}/ensayos?otId=${C.otLqa.id}`);
    afirmar(ens.length, "LMB sin ensayos");
    C.oiLmb = await ok(U.lqaJefe, "POST", "/ordenes-internas", {
      otId: C.otLqa.id, destinoLab: lmb.id, ensayos: [ens[0].id], detalle: "Recuento microbiológico (frente c1)",
      muestraId: reg.muestras[0].id, requisito: "RSA vigente", fechaEnvio: hoyCl(),
    });
    // Mientras la orden está abierta el LMB ya participa (es su bandeja de entrada).
    const ot = await ok(U.lmbAnalista, "GET", `/ot/${C.otLqa.id}`);
    afirmar(ot.participacion?.laboratorios?.some((l) => l.codigo === "LMB"), `participación ${JSON.stringify(ot.participacion)}`);
    await ok(U.lmbAnalista, "GET", `/ot/${C.otLqa.id}/avance`);
    await ok(U.lmbAnalista, "GET", `/ot/${C.otLqa.id}/historial`);
    await ok(U.lmbAnalista, "GET", `/flujo/ot/${C.otLqa.id}/registro-muestras`);
    const cob = await ok(U.lmbJefe, "GET", `/informes/ot/${C.otLqa.id}/cobertura`);
    afirmar(cob, "sin cobertura");
    // El responsable sigue viendo la OT entera; un laboratorio ajeno, 403.
    const lqa = await ok(U.lqaJefe, "GET", `/ot/${C.otLqa.id}`);
    afirmar(lqa.participacion === null, "el responsable no ve la OT entera");
    await exigir(403, U.lpnAnalista, "GET", `/ot/${C.otLqa.id}`);
    await exigir(403, U.lpnJefe, "GET", `/informes/ot/${C.otLqa.id}/cobertura`);
    await exigir(403, U.lpnAnalista, "GET", `/ot/${C.otLqa.id}/avance`);
    // Escribir en la OT sigue siendo del responsable: el LMB no cambia sus analistas.
    await exigir(403, U.lmbJefe, "PUT", `/ot/${C.otLqa.id}/analistas`, { usuarioIds: [] });
    return `${C.otLqa.codigo} (LQA) · ${C.oiLmb.numero} → LMB abre expediente, ruta, muestras y cobertura; LPN 403`;
  });

  /* ------------------------------------------------------------ B-005 */
  await paso("B-005 · «Quitar ensayo» con motivo: la jefatura del laboratorio sí; el analista y otro laboratorio no; queda en «Ensayos eliminados»", async () => {
    const res = await ok(U.lmeJefe, "GET", `/flujo/ot/${C.otLme.id}/resultados`);
    const r = res.resultados[0];
    afirmar(r, "la OT no tiene ensayos");
    await rechazo(400, /mínimo 5/, U.lmeJefe, "POST", `/resultados/${r.id}/quitar`, { motivo: "no" });
    await exigir(403, U.lmeAnalista, "POST", `/resultados/${r.id}/quitar`, { motivo: "No aplica a la matriz" });
    await exigir(403, U.lpnJefe, "POST", `/resultados/${r.id}/quitar`, { motivo: "No aplica a la matriz" });
    const q = await ok(U.lmeJefe, "POST", `/resultados/${r.id}/quitar`, { motivo: "Analito de otra matriz (frente c1)" });
    afirmar(q.quitado, JSON.stringify(q));
    const despues = await ok(U.lmeJefe, "GET", `/flujo/ot/${C.otLme.id}/resultados`);
    afirmar(!despues.resultados.some((x) => x.id === r.id), "el ensayo sigue en la OT");
    const pl = await ok(U.lmeJefe, "GET", `/laboratorio/ot/${C.otLme.id}/planilla-calculos`);
    afirmar(pl.eliminados.some((e) => e.resultadoId === r.id && e.motivo === "Analito de otra matriz (frente c1)"), "no figura en «Ensayos eliminados» con su motivo");
    return `${r.analito ?? r.id} quitado con motivo; analista y LPN → 403`;
  });

  /* ------------------------------------------------------------ B-014 */
  await paso("B-014 · la D11 y el Jefe de Sucursal eligen cliente con el buscador acotado; sin acceso al maestro completo", async () => {
    const d11 = await ok("demo.d11.jefe", "GET", `/clientes-buscador?search=${encodeURIComponent(C.cliente.razonSocial.slice(0, 4))}`);
    afirmar(d11.data.some((c) => c.id === C.cliente.id), "la D11 no encuentra el cliente");
    afirmar(Object.keys(d11.data[0]).sort().join(",") === "id,nombreFantasia,razonSocial,rut", `campos ${Object.keys(d11.data[0])}`);
    await exigir(403, "demo.d11.jefe", "GET", "/clientes?limit=5");
    const suc = await ok("demo.sstgo.jefe", "GET", "/clientes-buscador?limit=200");
    afirmar(suc.data.length > 0, "el Jefe de Sucursal no ve clientes");
    await exigir(403, "demo.abastecimiento", "GET", "/clientes-buscador?search=a");
    return `D11 y Jefe de Sucursal eligen cliente (${suc.data.length}); /clientes sigue 403; Abastecimiento 403`;
  });
//PASOS
}

main()
  .then(() => {
    console.log(`
Frente c1: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`
${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
