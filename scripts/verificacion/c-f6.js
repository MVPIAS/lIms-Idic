#!/usr/bin/env node
/**
 * Frente f6 · moneda de las listas de precio y su lectura (26-10-2026).
 * Reproduce cada corrección con un perfil demo.* que puede y otro que no:
 *   1. El precio conserva la moneda de su lista: una lista en USD da dólares
 *      (no pesos); una cotización en CLP no mezcla un precio en USD (bloqueo
 *      con mensaje, sin tipo de cambio inventado); CLP sin decimales y USD con
 *      2 en líneas, IVA, totales y PDF; cotización completa en USD hasta la
 *      factura (OT de Metrología con instrumento no calibrable).
 *   2. Listas de precio con permiso propio (lista_precio.ver): Calidad las ve y
 *      las mantiene sin ver las cotizaciones; quien no tiene el permiso, 403.
 *
 * Uso:
 *   node scripts/verificacion/c-f6.js [--base http://localhost:5051/api]
 *   DATABASE_URL=… node scripts/verificacion/c-f6.js [--arrancar]
 *
 * Necesita la lista de demostración DEMO-USD-2026 (seed_f6_demo.sql); en una
 * base sin datos de demostración se omite la parte en USD. Con DATABASE_URL
 * comprueba además el bloqueo de un ensayo que solo tiene precio en USD (crea
 * una lista temporal F6-USD-… y la desactiva al terminar). Contraseña de los
 * usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja cotizaciones,
 * una OT cerrada y una factura pendiente de prueba: úsese en una base de
 * pruebas. Se puede correr varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:5051/api");
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
    sesiones[username] = { token: j.accessToken, user: j.user };
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
  (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 500);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);
async function rechazo(codigo, patron, u, m, ruta, c) {
  const j = await exigir(codigo, u, m, ruta, c);
  afirmar(patron.test(msg(j)), `${m} ${ruta}: mensaje inesperado «${msg(j)}»`);
  return msg(j);
}

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
  const puerto = new URL(BASE).port || "5051";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:5052",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-f6-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* Prisma (solo con DATABASE_URL): lista temporal para el ensayo que solo tiene precio en USD. */
let prisma = null;
function bd() {
  if (!process.env.DATABASE_URL) return null;
  if (!prisma) {
    const { PrismaClient } = require(require.resolve("@prisma/client", { paths: [path.join(RAIZ, "apps/api")] }));
    prisma = new PrismaClient();
  }
  return prisma;
}

/* ============================================================ AYUDAS === */
const U = {
  admin: "demo.admin",
  calidad: "demo.calidad",
  ventas: "demo.ventas",
  dco: "demo.dco.jefe",
  finanzas: "demo.finanzas",
  planif: "demo.planificacion",
  jefe: "demo.lmt.jefe",
  metro: "demo.lmt.analista1",
  analista: "demo.lqc.analista1",
  recepcion: "demo.recepcion",
};
const sello = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase();
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const DOLAR = 950;
const C = { restaurar: [] };
const precios = (moneda, ids) =>
  ok(U.ventas, "GET", `/cotizaciones/precios-ensayo?clienteId=${C.clienteId}&ids=${ids.join(",")}&fecha=${hoy()}&moneda=${moneda}`);
const linea = (cot, codigo) => cot.lineas.find((l) => l.ensayoCodigo === codigo);
const n = (v) => Number(v);

async function main() {
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  console.log(`Frente f6 · moneda de las listas y su lectura (${BASE})`);
  try {
    await recorrido();
  } finally {
    for (const f of C.restaurar.reverse()) await f().catch((e) => console.log(`  (no se pudo restaurar: ${e.message})`));
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
}

async function recorrido() {
  await paso("Preparación: cliente particular, LMT, EN1074/EN1075 y la lista DEMO-USD-2026", async () => {
    const labs = lista(await ok(U.planif, "GET", "/ot/laboratorios"));
    C.LMT = labs.find((u) => u.codigo === "LMT");
    afirmar(C.LMT, "falta el LMT");
    for (const cod of ["EN1074", "EN1075"]) {
      C[cod] = lista(await ok(U.ventas, "GET", `/cat/ensayos?search=${cod}&limit=5`)).find((e) => e.codigo === cod);
      afirmar(C[cod], `falta el servicio ${cod}`);
    }
    // Un cliente particular (toma el neto de la lista; un Ejército, por defecto, la ficha).
    for (const c of lista(await ok(U.ventas, "GET", "/clientes?limit=50"))) {
      const r = await ok(U.ventas, "GET", `/cotizaciones/precios-ensayo?clienteId=${c.id}&ids=${C.EN1074.id}&fecha=${hoy()}`);
      if (r.regla === "PARTICULAR") { C.clienteId = c.id; C.cliente = c.razonSocial; break; }
    }
    afirmar(C.clienteId, "no hay un cliente particular");
    C.usd = lista(await ok(U.ventas, "GET", "/listas-precio?search=DEMO-USD-2026&limit=5")).find((l) => l.codigo === "DEMO-USD-2026");
    return `${C.cliente} · ${C.usd ? `DEMO-USD-2026 (${C.usd.items?.length ?? 0} ítems)` : "sin DEMO-USD-2026 (base sin demo): se omite la parte en USD"}`;
  });

  /* ======================================== 1 · el precio conserva su moneda */
  await paso("1a · precios-ensayo: en USD, EN1074 = US$ 150 de DEMO-USD-2026; en CLP, $ 123.387 de LP-2026 (manda la lista de la moneda pedida)", async () => {
    if (!C.usd) return "omitido (sin lista USD de demostración)";
    const u = await precios("USD", [C.EN1074.id]);
    const pu = u.precios[C.EN1074.id];
    afirmar(u.moneda === "USD" && pu.moneda === "USD" && n(pu.precio) === 150 && pu.lista?.codigo === "DEMO-USD-2026" && !pu.bloqueo, `USD: ${JSON.stringify(pu)}`);
    const c = await precios("CLP", [C.EN1074.id]);
    const pc = c.precios[C.EN1074.id];
    afirmar(pc.moneda === "CLP" && pc.lista?.codigo === "LP-2026" && n(pc.precio) === 123387 && !pc.bloqueo, `CLP: ${JSON.stringify(pc)}`);
    await exigir(400, U.ventas, "GET", `/cotizaciones/precios-ensayo?clienteId=${C.clienteId}&ids=${C.EN1074.id}&moneda=UF`);
    await exigir(403, U.analista, "GET", `/cotizaciones/precios-ensayo?clienteId=${C.clienteId}&ids=${C.EN1074.id}&moneda=USD`);
    return "USD → US$ 150 (DEMO-USD-2026) · CLP → $ 123.387 (LP-2026) · UF → 400 · analista → 403";
  });

  await paso("1b · Cotización en USD (dólar 950, IVA 19 %): toma US$ 150,00 y US$ 250,50 tal cual (no ÷ 950); totales a 2 decimales", async () => {
    if (!C.usd) return "omitido";
    const cuerpo = {
      clienteId: C.clienteId, formato: "NORMAL", plazoEntregaDias: 15, referencia: `F6 USD ${sello}`, moneda: "USD", dolarValor: DOLAR, ivaPct: 19,
      lineas: [{ catEnsayoId: C.EN1074.id, cantidad: 1 }, { catEnsayoId: C.EN1075.id, cantidad: 2 }],
    };
    await exigir(403, U.finanzas, "POST", "/cotizaciones", cuerpo);
    const cot = await ok(U.ventas, "POST", "/cotizaciones", cuerpo);
    C.cotUsd = cot;
    const l1 = linea(cot, "EN1074"), l2 = linea(cot, "EN1075");
    afirmar(cot.moneda === "USD" && n(l1.precioUnitario) === 150 && n(l2.precioUnitario) === 250.5 && n(l2.subtotal) === 501, `líneas ${n(l1.precioUnitario)} / ${n(l2.precioUnitario)} · ${n(l2.subtotal)}`);
    afirmar(n(cot.subtotal) === 651 && n(cot.ivaMonto) === 123.69 && n(cot.total) === 774.69, `totales ${n(cot.subtotal)} · IVA ${n(cot.ivaMonto)} · total ${n(cot.total)}`);
    // El precio no se escribe a mano (ni con el valor «en pesos» de antes).
    await rechazo(400, /no admite un precio manual/, U.ventas, "POST", "/cotizaciones", { ...cuerpo, lineas: [{ catEnsayoId: C.EN1074.id, cantidad: 1, precioUnitario: 129.88 }] });
    return `${cot.codigo}: US$ 150,00 + 2 × US$ 250,50 = US$ 651,00 · IVA US$ 123,69 · total US$ 774,69 · Finanzas → 403`;
  });

  await paso("1c · Cotización en CLP con EN1074: neto de LP-2026 en pesos, sin decimales; IVA redondeado", async () => {
    const cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.clienteId, formato: "NORMAL", referencia: `F6 CLP ${sello}`, moneda: "CLP", ivaPct: 19, lineas: [{ catEnsayoId: C.EN1074.id, cantidad: 1 }],
    });
    C.cotClp = cot;
    const l = linea(cot, "EN1074");
    afirmar(cot.moneda === "CLP" && n(l.precioUnitario) === 123387, `precio ${l.precioUnitario}`);
    afirmar(n(cot.ivaMonto) === 23444 && n(cot.total) === 146831 && Number.isInteger(n(cot.total)), `IVA ${cot.ivaMonto} · total ${cot.total}`);
    return `${cot.codigo}: $ 123.387 · IVA $ 23.444 · total $ 146.831`;
  });

  await paso("1d · Cambiar la moneda al editar (CLP → USD): la línea se revaloriza con la lista en USD, no conserva el precio en pesos", async () => {
    if (!C.usd) return "omitido";
    await exigir(403, U.finanzas, "PATCH", `/cotizaciones/${C.cotClp.id}`, { moneda: "USD", dolarValor: DOLAR });
    const r = await ok(U.ventas, "PATCH", `/cotizaciones/${C.cotClp.id}`, { moneda: "USD", dolarValor: DOLAR, lineas: [{ catEnsayoId: C.EN1074.id, cantidad: 1 }] });
    afirmar(r.moneda === "USD" && n(linea(r, "EN1074").precioUnitario) === 150 && n(r.total) === 178.5, `tras el cambio: ${r.moneda} ${linea(r, "EN1074").precioUnitario} · total ${r.total}`);
    return `${C.cotClp.codigo}: $ 123.387 → US$ 150,00 · total US$ 178,50`;
  });

  await paso("1e · Ensayo con precio SOLO en una lista en USD: en CLP → 400 con mensaje (no se mezclan monedas); en USD → su precio en dólares", async () => {
    const db = bd();
    if (!db) return "omitido (sin DATABASE_URL)";
    const [e] = await db.$queryRawUnsafe(
      `SELECT ce.id::text AS id, ce.codigo FROM cat_ensayo ce JOIN tenant t ON t.id = ce.tenant_id AND t.codigo = 'IDIC'
        WHERE ce.deleted_at IS NULL AND ce.precio > 0
          AND NOT EXISTS (SELECT 1 FROM lista_precio_item i JOIN lista_precio lp ON lp.id = i.lista_precio_id
                           WHERE i.cat_ensayo_id = ce.id AND lp.deleted_at IS NULL AND COALESCE(lp.activa, TRUE))
        ORDER BY ce.codigo LIMIT 1`,
    );
    if (!e) return "omitido (no hay un ensayo con ficha y sin lista)";
    const codigo = `F6-USD-${sello}`.slice(0, 40);
    const lp = await ok(U.calidad, "POST", "/listas-precio", { codigo, nombre: "Prueba f6 en dólares", moneda: "USD", vigenteDesde: "2026-01-01" });
    C.restaurar.push(() => ok(U.calidad, "PATCH", `/listas-precio/${lp.id}`, { activa: false }));
    const it = await ok(U.calidad, "POST", "/lista-precio-items", { listaPrecioId: lp.id, codigo: "F6-1", descripcion: `Prueba f6 ${e.codigo}`, precio: 42.5 });
    await db.$executeRawUnsafe(`UPDATE lista_precio_item SET cat_ensayo_id = $1::uuid, enlace = 'manual' WHERE id = $2::uuid`, e.id, it.id);
    const pc = (await precios("CLP", [e.id])).precios[e.id];
    afirmar(pc.moneda === "USD" && n(pc.precio) === 42.5 && /está en USD .*Emita la cotización en USD/.test(pc.bloqueo ?? ""), `vista previa CLP: ${JSON.stringify(pc)}`);
    const m = await rechazo(400, /Línea 1: El precio del ensayo .* está en USD \(dólares\) en la lista «Prueba f6 en dólares».*CLP.*Emita la cotización en USD/, U.ventas, "POST", "/cotizaciones", {
      clienteId: C.clienteId, formato: "NORMAL", moneda: "CLP", lineas: [{ catEnsayoId: e.id, cantidad: 1 }],
    });
    const cot = await ok(U.ventas, "POST", "/cotizaciones", { clienteId: C.clienteId, formato: "NORMAL", moneda: "USD", dolarValor: DOLAR, lineas: [{ catEnsayoId: e.id, cantidad: 1 }] });
    afirmar(n(cot.lineas[0].precioUnitario) === 42.5, `en USD: ${cot.lineas[0].precioUnitario}`);
    return `${e.codigo}: CLP → 400 «${m.slice(0, 90)}…» · USD → US$ 42,50`;
  });

  await paso("1f · Documento de la cotización: USD con 2 decimales (US$ 150,00 · total US$ 774,69); CLP sin decimales", async () => {
    if (!C.usd) return "omitido";
    const h = await ok(U.ventas, "GET", `/cotizaciones/${C.cotUsd.id}/html`);
    afirmar(typeof h === "string" && h.includes("US$ 150,00") && h.includes("US$ 501,00") && h.includes("US$ 774,69") && h.includes("dólares estadounidenses"), "el HTML no muestra los importes en US$ con 2 decimales");
    afirmar(!/\$ 123\.387/.test(h), "el HTML de la cotización en USD muestra pesos");
    const c = await ok(U.ventas, "POST", "/cotizaciones", { clienteId: C.clienteId, formato: "NORMAL", moneda: "CLP", ivaPct: 19, lineas: [{ catEnsayoId: C.EN1074.id, cantidad: 1 }] });
    const hc = await ok(U.ventas, "GET", `/cotizaciones/${c.id}/html`);
    afirmar(hc.includes("$ 123.387") && hc.includes("$ 146.831") && !/US\$/.test(hc.replace(/<style[\s\S]*?<\/style>/g, "")), "el HTML de la cotización en CLP no muestra pesos sin decimales");
    await exigir(403, U.analista, "GET", `/cotizaciones/${C.cotUsd.id}/html`);
    return "USD: US$ 150,00 · US$ 501,00 · US$ 774,69 · CLP: $ 123.387 · $ 146.831 · analista → 403";
  });

  await paso("1g · Cotización completa en USD → firma → aceptación → OT (hereda USD y US$ 178,50) → cierre → factura en USD", async () => {
    if (!C.usd) return "omitido";
    const cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.clienteId, formato: "NORMAL", plazoEntregaDias: 15, referencia: `F6 USD a factura ${sello}`, moneda: "USD", dolarValor: DOLAR, ivaPct: 19,
      lineas: [{ catEnsayoId: C.EN1074.id, cantidad: 1, instrumento: "Balanza de prueba f6" }],
    });
    afirmar(n(cot.total) === 178.5, `total ${cot.total}`);
    await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${cot.id}/aceptar`, { tipo: "OC", numero: `OC-F6-${sello}`, fecha: hoy(), conCobro: true, montoOc: 178.5, unidadPrincipalId: C.LMT.id });
    const ot = await ok(U.jefe, "GET", `/ot/${r?.ot?.id ?? r?.otId ?? r?.ot_id}`);
    C.ot = ot;
    const enc = await ok(U.jefe, "GET", `/ot/${ot.id}/encargo`);
    const e = enc?.data?.encargo ?? enc?.encargo ?? enc?.data ?? enc;
    afirmar(e.moneda === "USD" && n(e.valorInicial) === 178.5 && n(e.paridad) === DOLAR, `encargo: ${JSON.stringify({ moneda: e.moneda, valor: e.valorInicial, paridad: e.paridad })}`);
    // El costo estimado de la OT está en CLP: US$ 178,50 × 950 (el dólar de la cotización), no «$ 179».
    afirmar(n(ot.costoEstimado) === Math.round(178.5 * DOLAR), `costo estimado de la OT ${ot.costoEstimado} (esperado ${Math.round(178.5 * DOLAR)} CLP)`);
    // Metrología: el instrumento no es calibrable → informe técnico emitido y entregado, devolución y cierre.
    await ok(U.jefe, "POST", `/ot/${ot.id}/instrumentos/desde-cotizacion`);
    const iId = (await ok(U.jefe, "GET", `/ot/${ot.id}/metrologia`)).instrumentos[0].id;
    await ok(U.jefe, "PUT", `/ot/${ot.id}/instrumentos/${iId}`, { descripcion: "Balanza de prueba f6", serie: `F6-${sello}`, procesoCodigo: "ITM02" });
    const b = `/ot/${ot.id}/instrumentos/${iId}`;
    await ok(U.metro, "POST", `${b}/recepcion`, {
      fechaHora: new Date().toISOString(), entregadoPor: "Cliente de prueba f6", estadoFisico: "danado", ubicacion: "Estante F6", calibrable: false,
      estadoFisicoObs: "Plato deformado", motivoNoCalibrable: "No repite la indicación",
    });
    await ok(U.metro, "POST", `${b}/informe-tecnico`, { motivo: "No repite la indicación", hallazgos: "Plato deformado", recomendacion: "Reparar y volver a calibrar" });
    await ok(U.metro, "POST", `${b}/informe-tecnico/enviar`);
    await ok(U.jefe, "POST", `${b}/informe-tecnico/emitir`);
    await ok(U.ventas, "POST", `${b}/informe-tecnico/entregar`, { medio: "mano", destinatario: "Encargado del cliente" });
    await ok(U.metro, "POST", `${b}/devolucion`, { fechaHora: new Date().toISOString(), recibidoPor: "Encargado del cliente", estadoFisico: "danado", observacion: "Se devuelve sin calibrar" });
    await ok(U.jefe, "POST", `/ot/${ot.id}/metrologia/cierre-tecnico`);
    await exigir(403, U.metro, "POST", `/ot/${ot.id}/cerrar`, {});
    const c = await ok(U.planif, "POST", `/ot/${ot.id}/cerrar`, {});
    afirmar(c.facturaCreada?.id, `el cierre no creó la factura: ${JSON.stringify(c.facturaCreada)}`);
    const f = await ok(U.finanzas, "GET", `/facturas/${c.facturaCreada.id}`);
    const fl = f.lineas ?? [];
    afirmar(f.moneda === "USD" && n(f.neto) === 150 && n(f.ivaMonto) === 28.5 && n(f.total) === 178.5, `factura ${f.moneda} neto ${f.neto} IVA ${f.ivaMonto} total ${f.total}`);
    afirmar(fl.length === 1 && n(fl[0].precioUnitario) === 150, `líneas de la factura: ${JSON.stringify(fl.map((l) => [l.descripcion, l.precioUnitario]))}`);
    C.factura = f;
    return `${cot.codigo} → ${ot.codigo} (USD, US$ 178,50, paridad ${DOLAR}; costo estimado $ ${Math.round(178.5 * DOLAR).toLocaleString("es-CL")}) → factura ${f.numero}: neto US$ 150,00 · IVA US$ 28,50 · total US$ 178,50`;
  });

  await paso("1h · Factura de una OT SIN cotización y total estimado de «Registrar OT»: en CLP, nunca el precio de una lista en USD", async () => {
    const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/facturacion/facturacion.module.ts"), "utf8");
    const cat = fs.readFileSync(path.join(RAIZ, "apps/api/src/catalogo/catalogo-v2.module.ts"), "utf8");
    const llamadas = (t) => t.split("\n").filter((l) => l.includes("await itemsListaVigente("));
    afirmar(llamadas(src).length === 1 && llamadas(src).every((l) => l.includes('{ soloMoneda: "CLP" }')), "el borrador sin cotización no se limita a listas en CLP");
    afirmar(llamadas(cat).length === 1 && llamadas(cat).every((l) => l.includes('{ soloMoneda: "CLP" }')), "el panel de Registrar OT no se limita a listas en CLP");
    return "borrador sin cotización y panel: soloMoneda CLP (regla pura en precio-lista.spec.ts)";
  });

  /* ============================================ 2 · lectura de las listas */
  await paso("2a · Calidad ve las listas de precio y su detalle (lista_precio.ver) y las mantiene; NO ve las cotizaciones (403)", async () => {
    const ls = lista(await ok(U.calidad, "GET", "/listas-precio?limit=50"));
    const lp = ls.find((l) => l.codigo === "LP-2026") ?? ls[0];
    afirmar(lp, "Calidad no ve ninguna lista");
    const d = await ok(U.calidad, "GET", `/listas-precio/${lp.id}/detalle?limit=1`);
    afirmar(d.resumen?.items >= 1, "Calidad no ve el detalle de la lista");
    afirmar(lista(await ok(U.calidad, "GET", "/lista-precio-items?limit=5")).length >= 1, "Calidad no ve los ítems");
    const nueva = await ok(U.calidad, "POST", "/listas-precio", { codigo: `F6-CAL-${sello}`.slice(0, 40), nombre: "Prueba f6 de Calidad", moneda: "CLP" });
    await ok(U.calidad, "PATCH", `/listas-precio/${nueva.id}`, { activa: false });
    await exigir(403, U.calidad, "GET", "/cotizaciones?limit=5");
    if (C.cotUsd) await exigir(403, U.calidad, "GET", `/cotizaciones/${C.cotUsd.id}`);
    await exigir(403, U.calidad, "GET", `/cotizaciones/precios-ensayo?clienteId=${C.clienteId}&ids=${C.EN1074.id}`);
    return `${ls.length} listas y detalle de ${lp.codigo} · alta y baja de ${nueva.codigo} · cotizaciones → 403`;
  });

  await paso("2b · Sin lista_precio.ver (analista, Recepción) → 403; Ventas las lee pero no las mantiene (403)", async () => {
    for (const u of [U.analista, U.recepcion]) {
      await exigir(403, u, "GET", "/listas-precio?limit=5");
      await exigir(403, u, "GET", "/lista-precio-items?limit=5");
    }
    const lp = lista(await ok(U.ventas, "GET", "/listas-precio?limit=5"))[0];
    await exigir(403, U.analista, "GET", `/listas-precio/${lp.id}/detalle`);
    await ok(U.ventas, "GET", `/listas-precio/${lp.id}/detalle?limit=1`);
    await exigir(403, U.ventas, "POST", "/listas-precio", { codigo: `F6-X-${sello}`.slice(0, 40), nombre: "x", moneda: "CLP" });
    await exigir(403, U.ventas, "PATCH", `/listas-precio/${lp.id}`, { nombre: lp.nombre });
    return "analista y Recepción → 403 · Ventas lee (200) y no escribe (403)";
  });

  await paso("2c · Menú y botones: «Listas de precio» e «Ítems de lista» piden lista_precio.ver (no cotizacion.ver)", async () => {
    const nav = fs.readFileSync(path.join(RAIZ, "apps/web/lib/navegacion.ts"), "utf8");
    const rec = fs.readFileSync(path.join(RAIZ, "apps/web/lib/permisosRecurso.ts"), "utf8");
    afirmar(/href: "\/listas-precio", label: "Listas de precio", icon: "[^"]+", perm: "lista_precio\.ver"/.test(nav), "el menú de listas no pide lista_precio.ver");
    afirmar(/href: "\/lista-precio-items", label: "Ítems de lista", icon: "[^"]+", perm: "lista_precio\.ver"/.test(nav), "el menú de ítems no pide lista_precio.ver");
    afirmar(/"listas-precio": todos\("lista_precio\.ver", "catalogo\.gestionar"\)/.test(rec) && /"lista-precio-items": todos\("lista_precio\.ver", "catalogo\.gestionar"\)/.test(rec), "permisosRecurso no usa lista_precio.ver");
    const perms = (await login(U.calidad)).user?.permisos ?? null;
    if (perms) afirmar(perms.includes("lista_precio.ver") && !perms.includes("cotizacion.ver"), `permisos de Calidad: ${perms.filter((p) => /lista|cotiz/.test(p))}`);
    return `navegación y permisosRecurso${perms ? " · Calidad: lista_precio.ver sí, cotizacion.ver no" : ""}`;
  });
}

main()
  .then(() => {
    const fallos = pasos.filter((p) => !p.ok).length;
    console.log(fallos ? `\nFrente f6: ${pasos.length - fallos} pasos OK, ${fallos} con fallo.` : `\nFrente f6: ${pasos.length}/${pasos.length} pasos OK.`);
    pararApi();
    process.exit(fallos ? 1 : 0);
  })
  .catch((e) => {
    console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    pararApi();
    process.exit(1);
  });
