#!/usr/bin/env node
/**
 * Frente f5 · Maestros y combos del Mapa de migración v2.1 (24-10-2026).
 * Reproduce cada corrección con un perfil demo.* que puede y otro que no:
 *   1. Moneda: solo CLP y USD; lo guardado en otra moneda es histórico y de solo lectura.
 *   2. Tarifas HH, HM, perfiles HH y servicios primarios en Tablas maestras.
 *   3. Medios de envío: una sola lista («Parámetros del sistema › medio_envio»).
 *   4. «Muestras recibidas» (antes «Maestro de muestras»).
 *
 * Uso:
 *   node scripts/verificacion/c-f5.js [--base http://localhost:5041/api]
 *   DATABASE_URL=… node scripts/verificacion/c-f5.js --arrancar
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja datos de prueba
 * ficticios (tarifas «F5-…», una lista en USD): úsese en una base de pruebas.
 * Se puede correr varias veces seguidas. En una base sin datos de demostración
 * (sin la lista DEMO-UF-2019 de seed_f5_demo.sql) se omite la parte histórica.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:5041/api");
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
const textoError = (j) => `${msg(j)} ${JSON.stringify(j?.issues ?? "")}`;
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
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
  const puerto = new URL(BASE).port || "5041";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:5042",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-c-f5-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  admin: "demo.admin",
  calidad: "demo.calidad",
  ventas: "demo.ventas",
  finanzas: "demo.finanzas",
  recepcion: "demo.recepcion",
  lqcJefe: "demo.lqc.jefe",
  lccA1: "demo.lcc.analista1",
  auditor: "demo.auditor",
};
const sello = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase();
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
const C = {};

async function main() {
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  console.log(`Frente f5 · maestros y combos (${BASE})`);

  /* ============================================================= 1 · Moneda */
  await paso("1a · El parámetro «moneda» (lista de las pantallas) solo ofrece CLP y USD; Ventas lo lee", async () => {
    const m = lista(await ok(U.ventas, "GET", "/parametros?categoria=moneda&activo=true&limit=20")).map((p) => p.codigo).sort();
    afirmar(JSON.stringify(m) === JSON.stringify(["CLP", "USD"]), `monedas ofrecidas ${JSON.stringify(m)}`);
    const r = await llamar(U.calidad, "POST", "/parametros", { categoria: "moneda", codigo: "EUR", etiqueta: "Euro" });
    afirmar(r.status === 409, `alta de EUR en el parámetro → ${r.status} ${msg(r.json)}`);
    await exigir(403, U.ventas, "POST", "/parametros", { categoria: "moneda", codigo: "USD", etiqueta: "x" });
    return `ofrece ${m.join(" y ")} · EUR en el parámetro → 409 · Ventas no gestiona → 403`;
  });

  await paso("1b · Lista de precios: UF y EUR → 400; USD → 201 (Calidad); Ventas no la crea → 403", async () => {
    for (const mon of ["UF", "EUR"]) {
      const r = await llamar(U.calidad, "POST", "/listas-precio", { codigo: `F5-${mon}-${sello}`.slice(0, 30), nombre: `Prueba f5 ${mon}`, moneda: mon });
      afirmar(r.status === 400 && /CLP .* USD/.test(textoError(r.json)), `lista en ${mon} → ${r.status} ${textoError(r.json)}`);
    }
    const usd = await ok(U.calidad, "POST", "/listas-precio", { codigo: `F5-USD-${sello}`.slice(0, 30), nombre: "Prueba f5 en dólares", moneda: "usd" });
    afirmar(usd.moneda === "USD", `moneda guardada ${usd.moneda}`);
    C.listaUsd = usd;
    const cambio = await llamar(U.calidad, "PATCH", `/listas-precio/${usd.id}`, { moneda: "EUR" });
    afirmar(cambio.status === 400, `cambiar a EUR → ${cambio.status} ${msg(cambio.json)}`);
    await exigir(403, U.ventas, "POST", "/listas-precio", { codigo: `F5-X-${sello}`.slice(0, 30), nombre: "x", moneda: "CLP" });
    return `${usd.codigo} en USD · UF/EUR → 400 · cambio a EUR → 400`;
  });

  await paso("1c · Cotización, gastos del costeo y oportunidad: una moneda que no sea CLP o USD → 400", async () => {
    const cot = await llamar(U.ventas, "POST", "/cotizaciones", { moneda: "UF" });
    afirmar(cot.status === 400 && (cot.json?.issues ?? []).some((i) => i.path === "moneda" || String(i.path).includes("moneda")), `cotización en UF → ${cot.status} ${textoError(cot.json)}`);
    const opo = await llamar(U.ventas, "POST", "/oportunidades", { titulo: `Prueba f5 ${sello}`, moneda: "EUR" });
    afirmar(opo.status === 400, `oportunidad en EUR → ${opo.status} ${msg(opo.json)}`);
    return "cotización UF → 400 · oportunidad EUR → 400";
  });

  await paso("1d · Lista histórica en UF (dato migrado): se ve tal cual y es de solo lectura; solo se activa o desactiva", async () => {
    const todas = lista(await ok(U.ventas, "GET", "/listas-precio?search=DEMO-UF-2019&limit=10"));
    const h = todas.find((l) => l.codigo === "DEMO-UF-2019");
    if (!h) return "sin lista histórica en esta base (modo sin-demo): se omite";
    afirmar(h.moneda === "UF", `moneda mostrada ${h.moneda}`);
    const ed = await llamar(U.calidad, "PATCH", `/listas-precio/${h.id}`, { nombre: "Cambio no permitido" });
    afirmar(ed.status === 409 && /histórica/.test(msg(ed.json)), `editar nombre → ${ed.status} ${msg(ed.json)}`);
    // La pantalla envía también la moneda guardada sin cambiarla: se acepta para activar o desactivar.
    await ok(U.calidad, "PATCH", `/listas-precio/${h.id}`, { codigo: h.codigo, nombre: h.nombre, moneda: "UF", activa: false });
    await ok(U.calidad, "PATCH", `/listas-precio/${h.id}`, { activa: h.activa !== false });
    const it = await llamar(U.calidad, "POST", "/lista-precio-items", { listaPrecioId: h.id, codigo: `F5-${sello}`.slice(0, 30), descripcion: "x", precio: 1 });
    afirmar(it.status === 409, `ítem nuevo en la lista UF → ${it.status} ${msg(it.json)}`);
    const del = await llamar(U.calidad, "DELETE", `/listas-precio/${h.id}`);
    afirmar(del.status === 409, `borrar la lista UF → ${del.status} ${msg(del.json)}`);
    await exigir(403, U.ventas, "PATCH", `/listas-precio/${h.id}`, { activa: false });
    const det = await ok(U.ventas, "GET", `/listas-precio/${h.id}/detalle`);
    afirmar(det?.lista?.moneda === "UF", `detalle moneda ${det?.lista?.moneda}`);
    return `${h.codigo} en UF intacta · editar/ítems/borrar → 409 · activar y desactivar → 200 · Ventas → 403`;
  });

  /* ============================================================ 2 · Tarifas */
  const TARIFAS = [
    { r: "/tarifas/hh", alta: { categoria: `F5${sello}`.slice(0, 20), descripcion: "Categoría de prueba f5", valorHoraClp: 25000, vigenteDesde: "2026-01-01" }, campo: "valorHoraClp" },
    { r: "/tarifas/hh-perfiles", alta: { perfil: `perfil f5 ${sello}`.slice(0, 40), ajustePct: 10, descripcion: "Perfil de prueba f5" }, campo: "ajustePct" },
    { r: "/tarifas/hm", alta: { codigo: `EQ${sello}`.slice(0, 20), descripcion: "Equipo de prueba f5", valorHoraClp: 12000, vigenteDesde: "2026-01-01" }, campo: "valorHoraClp" },
    { r: "/tarifas/servicios-primarios", alta: { codigo: `SP-F5-${sello}`.slice(0, 40), descripcion: "Servicio primario de prueba f5", precioClp: 5000, vigenteDesde: "2026-01-01" }, campo: "precioClp" },
  ];
  for (const t of TARIFAS) {
    await paso(`2 · ${t.r}: Calidad crea, edita y desactiva (sin borrado); duplicado → 409; jefatura → 403; Ventas lee y no escribe; analista no lee`, async () => {
      const c = await ok(U.calidad, "POST", t.r, t.alta);
      const dup = await llamar(U.calidad, "POST", t.r, t.alta);
      afirmar(dup.status === 409, `duplicado → ${dup.status} ${msg(dup.json)}`);
      const nuevo = Number(t.alta[t.campo]) + 1;
      const e = await ok(U.calidad, "PATCH", `${t.r}/${c.id}`, { [t.campo]: nuevo });
      afirmar(Number(e[t.campo]) === nuevo, `${t.campo} editado ${e[t.campo]}`);
      const d = await ok(U.calidad, "PATCH", `${t.r}/${c.id}`, { activo: false });
      afirmar(d.activo === false, "no quedó inactiva");
      const del = await llamar(U.calidad, "DELETE", `${t.r}/${c.id}`);
      afirmar(del.status === 409, `borrar → ${del.status}`);
      await exigir(403, U.lqcJefe, "POST", t.r, t.alta);
      await exigir(403, U.lqcJefe, "PATCH", `${t.r}/${c.id}`, { activo: true });
      const buscado = lista(await ok(U.ventas, "GET", `${t.r}?search=${encodeURIComponent(String(t.alta.codigo ?? t.alta.categoria ?? t.alta.perfil))}`));
      afirmar(buscado.some((x) => x.id === c.id && x.activo === false), "Ventas no encuentra la fila desactivada con el buscador");
      await exigir(403, U.ventas, "PATCH", `${t.r}/${c.id}`, { activo: true });
      await exigir(403, U.lccA1, "GET", t.r);
      return `${c.id.slice(0, 8)} · editada, desactivada, sin borrar`;
    });
  }

  await paso("2 · Vigencia: el término no puede ser anterior al inicio (alta y edición) → 400", async () => {
    const r = await llamar(U.calidad, "POST", "/tarifas/hh", { categoria: `V${sello}`.slice(0, 20), valorHoraClp: 1, vigenteDesde: "2026-06-01", vigenteHasta: "2026-01-01" });
    afirmar(r.status === 400, `alta → ${r.status}`);
    const c = await ok(U.calidad, "POST", "/tarifas/hh", { categoria: `W${sello}`.slice(0, 20), valorHoraClp: 1, vigenteDesde: "2026-06-01" });
    const e = await llamar(U.calidad, "PATCH", `/tarifas/hh/${c.id}`, { vigenteHasta: "2026-01-01" });
    afirmar(e.status === 400 && /antes de empezar/.test(msg(e.json)), `edición → ${e.status} ${msg(e.json)}`);
    return "alta y edición → 400";
  });

  /* ======================================================= 3 · Medios de envío */
  await paso("3a · El parámetro «medio_envio» tiene todos los medios que se guardan (fax, inactivo); Ventas lo lee", async () => {
    const filas = lista(await ok(U.ventas, "GET", "/parametros?categoria=medio_envio&limit=50"));
    const activos = filas.filter((f) => f.activo).map((f) => f.codigo);
    for (const c of ["correo", "mano", "courier", "oficio", "oficina_partes", "libro", "plataforma", "otro"])
      afirmar(activos.includes(c), `falta el medio activo ${c}`);
    afirmar(filas.some((f) => f.codigo === "fax" && f.activo === false), "fax no está inactivo");
    return `${activos.length} activos · fax inactivo`;
  });

  await paso("3b · Parámetros: el código del medio va en minúsculas; «correo» no se desactiva; un medio no se borra; Ventas no gestiona", async () => {
    const mal = await llamar(U.calidad, "POST", "/parametros", { categoria: "medio_envio", codigo: "Por Mano", etiqueta: "x" });
    afirmar(mal.status === 400, `código con mayúsculas → ${mal.status}`);
    const correo = lista(await ok(U.calidad, "GET", "/parametros?categoria=medio_envio&limit=50")).find((f) => f.codigo === "correo");
    const des = await llamar(U.calidad, "PATCH", `/parametros/${correo.id}`, { activo: false });
    afirmar(des.status === 409, `desactivar correo → ${des.status}`);
    const del = await llamar(U.calidad, "DELETE", `/parametros/${correo.id}`);
    afirmar(del.status === 409, `borrar correo → ${del.status}`);
    const cod = await llamar(U.calidad, "PATCH", `/parametros/${correo.id}`, { codigo: "email" });
    afirmar(cod.status === 409, `cambiar el código → ${cod.status}`);
    await exigir(403, U.ventas, "PATCH", `/parametros/${correo.id}`, { etiqueta: "x" });
    return "400 · 409 · 409 · 409 · 403";
  });

  await paso("3c · Envío al cliente desde el seguimiento: el medio se valida contra el parámetro (fax inactivo y uno inventado → 400; «libro» pasa); sin ot.seguimiento → 403", async () => {
    const ots = lista(await ok(U.ventas, "GET", "/ot?limit=5"));
    afirmar(ots.length, "Ventas no ve ninguna OT");
    const ot = ots[0];
    const fax = await llamar(U.ventas, "POST", `/ot/${ot.id}/envios`, { medio: "fax", destinatario: "Cliente prueba f5" });
    afirmar(fax.status === 400 && /ya no se usa/.test(msg(fax.json)), `fax → ${fax.status} ${msg(fax.json)}`);
    const otro = await llamar(U.ventas, "POST", `/ot/${ot.id}/envios`, { medio: "whatsapp", destinatario: "Cliente prueba f5" });
    afirmar(otro.status === 400 && /elija uno de la lista/.test(msg(otro.json)), `whatsapp → ${otro.status} ${msg(otro.json)}`);
    // Un medio válido de la lista pasa la comprobación (falla después porque no se eligió ningún documento).
    const libro = await llamar(U.ventas, "POST", `/ot/${ot.id}/envios`, { medio: "libro", destinatario: "Cliente prueba f5" });
    afirmar(!/medio/i.test(msg(libro.json)), `libro rechazado por el medio: ${msg(libro.json)}`);
    await exigir(403, U.lccA1, "POST", `/ot/${ot.id}/envios`, { medio: "libro", destinatario: "x" });
    return `${ot.codigo}: fax → 400 · whatsapp → 400 · libro pasa el medio (${libro.status}: ${msg(libro.json).slice(0, 60)})`;
  });

  await paso("3d · Cotización (cabecera y envío) y entrega de un documento: mismo parámetro (fax → 400); sin permiso → 403", async () => {
    const cliente = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(77000000 + (parseInt(sello.slice(-6), 36) % 999999)), razonSocial: `Cliente prueba f5 ${sello}`, tipo: "particulares", direccion: "Av. Prueba 123, Santiago",
    });
    const base = { clienteId: cliente.id, formato: "NORMAL", plazoEntregaDias: 10, referencia: `f5 ${sello}`, lineas: [{ tipo: "otros", descripcion: "Traslado de la muestra", cantidad: 1, precioUnitario: 15000 }] };
    const conFax = await llamar(U.ventas, "POST", "/cotizaciones", { ...base, medioEnvio: "fax" });
    afirmar(conFax.status === 400 && /ya no se usa/.test(msg(conFax.json)), `cotización con medio fax → ${conFax.status} ${msg(conFax.json)}`);
    const cot = await ok(U.ventas, "POST", "/cotizaciones", { ...base, medioEnvio: "oficina_partes" });
    afirmar(cot.medioEnvio === "oficina_partes", `medio guardado ${cot.medioEnvio}`);
    const r = await llamar(U.ventas, "POST", `/cotizaciones/${cot.id}/enviar-cliente`, { medio: "fax", observacion: "x" });
    afirmar(r.status === 400 && /ya no se usa/.test(msg(r.json)), `envío por fax → ${r.status} ${msg(r.json)}`);
    await exigir(403, U.lccA1, "POST", `/cotizaciones/${cot.id}/enviar-cliente`, { medio: "mano", observacion: "x" });
    const docs = lista(await ok(U.calidad, "GET", "/informes/documentos?limit=5"));
    let doc = "sin documentos emitidos en esta base";
    if (docs.length) {
      const e = await llamar(U.admin, "POST", `/informes/${docs[0].id}/entregar`, { medio: "fax", destinatario: "Cliente prueba f5" });
      afirmar(e.status === 400 || e.status === 409, `entrega por fax → ${e.status} ${msg(e.json)}`);
      if (e.status === 400) afirmar(/ya no se usa/.test(msg(e.json)), `entrega por fax: ${msg(e.json)}`);
      await exigir(403, U.lccA1, "POST", `/informes/${docs[0].id}/entregar`, { medio: "mano", destinatario: "x" });
      doc = `entrega por fax → ${e.status}`;
    }
    return `cotización: medio fax → 400, oficina_partes guardado; envío por fax → 400 · ${doc}`;
  });

  /* ==================================================== 4 · Muestras recibidas */
  await paso("4 · «Muestras recibidas»: menú y pantalla sin «Maestro de muestras»; Recepción la lee y Finanzas no (403)", async () => {
    const nav = fs.readFileSync(path.join(RAIZ, "apps/web/lib/navegacion.ts"), "utf8");
    afirmar(/href: "\/muestras", label: "Muestras recibidas"/.test(nav), "el menú no dice «Muestras recibidas»");
    const pag = fs.readFileSync(path.join(RAIZ, "apps/web/app/(app)/muestras/page.tsx"), "utf8");
    afirmar(/titulo="Muestras recibidas"/.test(pag) && !/Maestro de muestras/i.test(pag), "la pantalla aún dice «Maestro de muestras»");
    await ok(U.recepcion, "GET", "/muestras?limit=5");
    await exigir(403, U.finanzas, "GET", "/muestras?limit=5");
    return "menú, título y ayuda · Recepción 200 · Finanzas 403";
  });
}

main()
  .then(() => {
    const fallos = pasos.filter((p) => !p.ok).length;
    console.log(fallos ? `\nFrente f5: ${pasos.length - fallos} pasos OK, ${fallos} con fallo.` : `\nFrente f5: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(fallos ? 1 : 0);
  })
  .catch((e) => {
    console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    pararApi();
    process.exit(1);
  });
