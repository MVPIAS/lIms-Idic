#!/usr/bin/env node
/**
 * Recorrido de punta a punta del flujo estándar del LIMS contra una API real.
 *
 *   Cliente → Cotización (con plazo) → Aceptación (nace la OT con laboratorio) →
 *   Recepción de la muestra (desde el expediente, con los ensayos de la
 *   cotización: la misma ruta que la pestaña «Muestras») → Asignación → Captura
 *   (numérico con límites del catálogo, numérico con especificación de la orden,
 *   atributo) → Revisión → Aprobación → Emisión → Reapertura de un resultado
 *   aprobado (anula el documento en firma) → corrección, revisión, aprobación y
 *   reemisión → Firma según la matriz → Entrega → Cierre → Factura → Emisión de
 *   la factura → Pago parcial → Pago total.
 *
 * Cada paso lo hace el perfil que corresponde y se comprueba también que un
 * perfil que NO debe poder, no puede (403/409). Además: un analista de otro
 * laboratorio no ve ni toca la OT, y las tarjetas de Mi bandeja de cada perfil
 * cambian lo esperado en cada etapa (y su enlace lleva a una lista que incluye
 * el elemento).
 *
 * Uso:
 *   node scripts/verificacion/flujo-completo.js [--arrancar] [--base http://localhost:3521/api]
 *
 *   --arrancar  lanza `node apps/api/dist/main.js` como proceso hijo (hay que
 *               compilar antes: pnpm --filter @lims-idic/api build) con
 *               DATABASE_URL (obligatoria), PORT/API_PORT = puerto de --base,
 *               NODE_ENV=production y ACCESOS_DEMO=true; lo cierra al terminar.
 *
 * Contraseña de los usuarios demo.*: variable de entorno CLAVE_DEMO; si no
 * está, se lee la constante CLAVE_DEMO_EMBEBIDA de apps/api/src/auth/auth.service.ts.
 * No escribe contraseñas en ningún sitio. Deja datos de prueba en la base
 * (cliente, cotización, OT, factura): úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:3521/api");
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
const sesiones = {}; // username → { token, id }
async function login(username) {
  if (sesiones[username]) return sesiones[username];
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: CLAVE }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
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
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);

/** Exige un código HTTP (o uno de varios) y devuelve el cuerpo. */
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!ok) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

/* -------------------------------------------------------------- informe --- */
const pasos = [];
let actual = null;
async function paso(nombre, fn) {
  actual = nombre;
  const t0 = Date.now();
  try {
    const detalle = await fn();
    pasos.push({ nombre, ok: true, detalle });
    console.log(`  OK    ${nombre}${detalle ? ` · ${detalle}` : ""} (${Date.now() - t0} ms)`);
  } catch (e) {
    pasos.push({ nombre, ok: false, detalle: e.message });
    console.log(`  FALLO ${nombre} · ${e.message}`);
    throw e;
  }
}
function afirmar(cond, texto) {
  if (!cond) throw new Error(texto);
}

/* ---------------------------------------------------------- Mi bandeja --- */
async function bandeja(username) {
  const items = await ok(username, "GET", "/me/bandeja");
  return Object.fromEntries(items.map((i) => [i.clave, i]));
}
/** Compara la bandeja con la base: { clave: delta esperado }. Devuelve el texto. */
async function exigirBandeja(username, base, esperados) {
  const b = await bandeja(username);
  const partes = [];
  for (const [clave, delta] of Object.entries(esperados)) {
    afirmar(b[clave], `${username}: Mi bandeja no tiene la tarjeta «${clave}»`);
    const antes = base[clave]?.cantidad ?? 0;
    const ahora = b[clave].cantidad;
    afirmar(ahora - antes === delta, `${username}: «${b[clave].titulo}» = ${ahora}, esperado ${antes + delta} (base ${antes}${delta >= 0 ? "+" : ""}${delta})`);
    partes.push(`${clave} ${antes}→${ahora}`);
  }
  return `${username.replace("demo.", "")}: ${partes.join(", ")}`;
}

/**
 * API que sirve la lista a la que lleva cada tarjeta (la misma consulta que
 * hace la pantalla). null = la tarjeta no tiene lista contable (indicador).
 */
function apiDeRuta(ruta) {
  const [p, q = ""] = ruta.split("?");
  const qs = new URLSearchParams(q);
  if (p === "/ot") { qs.set("limit", "1"); return `/ot?${qs}`; }
  if (p === "/cotizaciones") { qs.set("limit", "1"); return `/cotizaciones?${qs}`; }
  if (p === "/facturas") { qs.set("limit", "1"); return `/facturas?${qs}`; }
  if (p === "/certificados") { qs.set("limit", "1"); return `/informes/documentos?${qs}`; }
  if (p === "/captura-ot") { qs.set("limit", "1"); return `/resultados/bandeja?${qs}`; }
  if (p === "/informes/por-firmar") return "/informes/por-firmar";
  return null;
}
const totalDe = (j) => (Array.isArray(j) ? j.length : j?.meta?.total ?? (Array.isArray(j?.data) ? j.data.length : null));

/** Cada tarjeta de Mi bandeja cuenta lo mismo que la lista a la que lleva. */
async function contrastarTarjetas(usuarios) {
  const malas = [];
  let n = 0;
  for (const u of usuarios) {
    let items;
    try { items = await ok(u, "GET", "/me/bandeja"); } catch { continue; }
    for (const i of items) {
      const api = apiDeRuta(i.ruta);
      if (!api) continue;
      const r = await llamar(u, "GET", api);
      const total = r.status === 200 ? totalDe(r.json) : null;
      n++;
      if (total !== i.cantidad) malas.push(`${u.replace("demo.", "")} «${i.titulo}» ${i.cantidad} ≠ ${i.ruta} ${r.status === 200 ? total : `HTTP ${r.status}`}`);
    }
  }
  afirmar(!malas.length, malas.join(" | "));
  return `${n} tarjetas cuadran con su lista`;
}
const PERFILES_TARJETAS = [
  "demo.ventas", "demo.planificacion", "demo.lqc.jefe", "demo.lqc.analista1", "demo.lqc.revisor", "demo.finanzas",
  "demo.lpn.analista1", "demo.dqo.jefe", "demo.director", "demo.calidad", "demo.recepcion",
];

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
  const puerto = new URL(BASE).port || "3521";
  const env = {
    ...process.env,
    PORT: puerto,
    API_PORT: puerto,
    NODE_ENV: "production",
    ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:3000",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  const dir = path.join(RAIZ, "apps/api");
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-flujo-completo-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
  hijo.on("exit", (code) => {
    if (code !== null && code !== 0) console.log(`La API terminó con código ${code} (ver ${log.path}).`);
  });
}
function pararApi() {
  if (hijo && !hijo.killed) hijo.kill();
}

/* ============================================================ RECORRIDO === */
const U = {
  ventas: "demo.ventas",
  recepcion: "demo.recepcion",
  planif: "demo.planificacion",
  jefe: "demo.lqc.jefe",
  a1: "demo.lqc.analista1",
  a2: "demo.lqc.analista2",
  rev: "demo.lqc.revisor",
  finanzas: "demo.finanzas",
  otroLab: "demo.lpn.analista1",
};
/** Candidatos a firmar (se mapean por id con los responsables de la matriz). */
const POSIBLES_FIRMANTES = [
  "demo.lqc.jefe", "demo.lqc.revisor", "demo.lqc.analista1", "demo.lqc.analista2", "demo.dqo.jefe", "demo.director",
  "demo.calidad", "demo.sal.jefe", "demo.squ.jefe", "demo.sam.jefe", "demo.sem.jefe", "demo.sve.jefe", "demo.dco.jefe",
];
const PLAZO_DIAS = 2; // por vencer (hoy a +3 días): ejercita el semáforo

/** Rutas de las tarjetas: deben existir como página del front. */
function paginaExiste(ruta) {
  const p = ruta.split("?")[0].replace(/^\//, "");
  return fs.existsSync(path.join(RAIZ, "apps/web/app/(app)", p, "page.tsx"));
}

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();

  const C = {}; // contexto del recorrido
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Inicio de sesión de todos los perfiles", async () => {
    for (const u of [...Object.values(U), ...POSIBLES_FIRMANTES]) await login(u).catch((e) => { if (Object.values(U).includes(u)) throw e; });
    return `${Object.keys(sesiones).length} sesiones`;
  });

  // Bandejas de partida (se comparan por diferencia: la base ya trae datos).
  const B0 = {};
  for (const u of Object.values(U)) B0[u] = await bandeja(u);

  await paso("Tarjetas de Mi bandeja: cada enlace abre una página que existe", async () => {
    const rutas = new Set();
    for (const u of Object.values(U)) for (const i of Object.values(B0[u])) rutas.add(i.ruta);
    for (const u of ["demo.admin", "demo.director", "demo.calidad", "demo.abastecimiento", "demo.dqo.jefe"]) {
      try { for (const i of Object.values(await bandeja(u))) rutas.add(i.ruta); } catch { /* perfil opcional */ }
    }
    const faltan = [...rutas].filter((r) => !paginaExiste(r));
    afirmar(!faltan.length, `rutas sin página: ${faltan.join(", ")}`);
    return `${rutas.size} rutas`;
  });

  await paso("Tarjetas de Mi bandeja = total de la lista que abren (inicio)", () => contrastarTarjetas(PERFILES_TARJETAS));

  /* ---------------- Catálogo LQC: pH (límites), Azufre (sin límites), Formación de grumos (atributo) */
  await paso("Catálogo LQC: métodos pH, Azufre y Formación de grumos", async () => {
    const buscar = async (codigo) => {
      const j = await ok(U.jefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`);
      const m = lista(j).find((x) => x.codigo === codigo);
      afirmar(m && m.ensayoId, `método ${codigo} no encontrado en el catálogo`);
      return m;
    };
    C.mPh = await buscar("251");
    C.mAzufre = await buscar("258");
    C.mGrumos = await buscar("2053");
    const labs = await ok(U.ventas, "GET", "/ot/laboratorios");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    afirmar(C.lqc, "LQC no figura en GET /ot/laboratorios");
    return `pH=${C.mPh.ensayo?.codigo} Azufre=${C.mAzufre.ensayo?.codigo} Grumos=${C.mGrumos.ensayo?.codigo}`;
  });

  /* ---------------- 1. Cliente */
  await paso("Ventas crea el cliente", async () => {
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    const tipos = cfg?.parametros?.tipo_cliente ?? [];
    const tipo = (tipos.find((t) => t.codigo === "ejercito") ?? tipos[0])?.codigo ?? "ejercito";
    // RUT válido (módulo 11) a partir del sello.
    const cuerpoRut = String(70000000 + (Number(sello.slice(-7)) % 9999999));
    let s = 0, m = 2;
    for (let i = cuerpoRut.length - 1; i >= 0; i--) { s += Number(cuerpoRut[i]) * m; m = m === 7 ? 2 : m + 1; }
    const dv = 11 - (s % 11);
    const rut = `${cuerpoRut}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
    C.cliente = await ok(U.ventas, "POST", "/clientes", { rut, razonSocial: `Cliente prueba flujo ${sello}`, tipo, email: "flujo@example.cl" });
    return `${C.cliente.razonSocial} (${rut})`;
  });

  /* ---------------- 2. Cotización */
  await paso("Ventas crea la cotización con plazo de entrega", async () => {
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id,
      formato: "NORMAL",
      plazoEntregaDias: PLAZO_DIAS,
      referencia: `Flujo completo ${sello}`,
      lineas: [
        { catEnsayoId: C.mPh.ensayoId, cantidad: 1 },
        { catEnsayoId: C.mAzufre.ensayoId, cantidad: 1 },
        { catEnsayoId: C.mGrumos.ensayoId, cantidad: 1, precioUnitario: 5000 },
      ],
    });
    afirmar(C.cot.estado === "abierta", `estado ${C.cot.estado}`);
    afirmar(C.cot.plazoEntregaDias === PLAZO_DIAS, `plazoEntregaDias no se guardó (${C.cot.plazoEntregaDias})`);
    C.neto = Number(C.cot.total ?? C.cot.subtotal);
    return `${C.cot.codigo} total ${C.cot.total} · válida hasta ${String(C.cot.validaHasta).slice(0, 10)}`;
  });

  await paso("Un analista no puede aceptar la cotización (403)", async () => {
    await exigir(403, U.a1, "POST", `/cotizaciones/${C.cot.id}/aceptar`, { tipo: "OC", numero: "X", unidadPrincipalId: C.lqc.id });
  });

  /* ---------------- 3. Aceptación → OT */
  await paso("Ventas registra la aceptación y nace la OT de LQC", async () => {
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-${sello}`, fecha: new Date().toISOString().slice(0, 10), conCobro: true, unidadPrincipalId: C.lqc.id,
    });
    const otId = r?.ot?.id ?? r?.otId ?? r?.ot_id;
    afirmar(otId, `la aceptación no devolvió la OT: ${JSON.stringify(r).slice(0, 200)}`);
    C.ot = await ok(U.jefe, "GET", `/ot/${otId}`);
    afirmar(C.ot.unidadPrincipal === C.lqc.id, `laboratorio ${C.ot.unidad?.codigo ?? C.ot.unidadPrincipal}, esperado LQC`);
    afirmar(C.ot.fechaCompromiso, "la OT no tiene fecha de compromiso (plazo de la cotización)");
    return `${C.ot.codigo} · LQC · compromiso ${String(C.ot.fechaCompromiso).slice(0, 10)}`;
  });

  await paso("Mi bandeja tras nacer la OT", async () => {
    return [
      await exigirBandeja(U.jefe, B0[U.jefe], { ot_sin_asignar: 1, ot_por_vencer: 1 }),
      await exigirBandeja(U.planif, B0[U.planif], { ot_abiertas: 1, ot_por_vencer: 1 }),
      await exigirBandeja(U.ventas, B0[U.ventas], { cotizaciones_aceptadas_sin_ot: 0, ot_por_vencer: 1 }),
      await exigirBandeja(U.otroLab, B0[U.otroLab], { ot_en_curso: 0 }),
    ].join(" | ");
  });

  await paso("Enlaces de bandeja: /ot?sinAsignar=1 y /ot?semaforo=por_vencer incluyen la OT", async () => {
    const a = lista(await ok(U.jefe, "GET", "/ot?sinAsignar=1&estado=abiertas&limit=200"));
    afirmar(a.some((o) => o.id === C.ot.id), "OT ausente de «OT sin analista»");
    const b = lista(await ok(U.planif, "GET", "/ot?semaforo=por_vencer&limit=200"));
    afirmar(b.some((o) => o.id === C.ot.id), "OT ausente de «OT por vencer»");
    const c = lista(await ok(U.planif, "GET", "/ot/plazos?semaforo=por_vencer"));
    afirmar(c.some((o) => o.id === C.ot.id), "OT ausente de GET /ot/plazos?semaforo=por_vencer");
    const d = lista(await ok(U.planif, "GET", "/ot?semaforo=vencida&limit=200"));
    afirmar(!d.some((o) => o.id === C.ot.id), "OT en plazo aparece como vencida");
  });

  await paso("Analista de otro laboratorio (LPN) no ve la OT", async () => {
    await exigir([403, 404], U.otroLab, "GET", `/ot/${C.ot.id}`);
    const j = await ok(U.otroLab, "GET", `/ot?q=${encodeURIComponent(C.ot.codigo)}`);
    afirmar(lista(j).length === 0, "la búsqueda de LPN encuentra la OT de LQC");
  });

  /* ---------------- 4. Recepción de la muestra (expediente › Muestras) */
  await paso("El expediente propone los ensayos de la cotización aceptada", async () => {
    // Lo mismo que pide la pestaña «Muestras» del expediente de la OT.
    C.propuesta = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    afirmar(C.propuesta.cotizacion?.id === C.cot.id, "la propuesta no viene de la cotización aceptada");
    afirmar(C.propuesta.muestras.length === 0, `la OT ya tiene ${C.propuesta.muestras.length} muestras`);
    const ensayos = C.propuesta.lineas.map((l) => l.ensayoId);
    for (const m of [C.mPh, C.mAzufre, C.mGrumos])
      afirmar(ensayos.includes(m.ensayoId), `la propuesta no trae el ensayo de ${m.codigo}`);
    const linea = (m) => C.propuesta.lineas.find((l) => l.ensayoId === m.ensayoId);
    for (const m of [C.mPh, C.mAzufre, C.mGrumos])
      afirmar(linea(m).metodos.some((x) => x.id === m.id), `el método ${m.codigo} no figura en su línea`);
    const sugeridos = C.propuesta.lineas.flatMap((l) => l.sugeridos);
    return `${C.propuesta.lineas.length} línea(s) de ${C.propuesta.cotizacion.codigo}; ${sugeridos.length} método(s) propuestos marcados`;
  });
  await paso("Ventas no registra muestras (403)", async () => {
    await exigir(403, U.ventas, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: "X", metodoIds: [C.mPh.id] }] });
  });
  await paso("Recepción registra la muestra y sus ensayos desde el expediente", async () => {
    // Igual que la pantalla: los métodos marcados (propuestos) + los que la persona marca o busca.
    // Los propuestos solo pueden ser métodos de los ensayos cotizados (aquí, los tres elegidos).
    const nuestros = new Set([C.mPh.id, C.mAzufre.id, C.mGrumos.id]);
    const marcados = new Set(C.propuesta.lineas.flatMap((l) => l.sugeridos));
    afirmar([...marcados].every((id) => nuestros.has(id)), "la propuesta marca métodos que no son de los ensayos cotizados");
    for (const id of nuestros) marcados.add(id);
    await exigir(400, U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: " ", metodoIds: [] }] });
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [{ nombre: "Muestra de prueba del flujo", metodoIds: [...marcados] }],
    });
    afirmar(r.muestras.length === 1 && r.ensayos >= 3, `se crearon ${r.muestras.length} muestra(s) y ${r.ensayos} ensayo(s)`);
    C.muestra = r.muestras[0];
    afirmar(C.muestra.codigo === `${C.ot.codigo}-M1`, `código de muestra ${C.muestra.codigo}`);
    const hist = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    afirmar(hist.some((h) => h.tipo === "registro_muestras"), "el registro de muestras no quedó en el historial de la OT");
    const rs = await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    const todos = rs.resultados ?? lista(rs);
    const deMetodo = (m) => todos.filter((r) => r.catMetodoId === m.id);
    C.rPh = deMetodo(C.mPh)[0];
    C.rAzufre = deMetodo(C.mAzufre)[0];
    C.rGrumos = deMetodo(C.mGrumos)[0];
    C.resultados = todos.map((r) => r.id);
    afirmar(C.rPh && C.rAzufre && C.rGrumos, "faltan resultados de algún método");
    // Desde align_informe_ensayo.sql el pH ya no trae el 6,0–8,5 de la NCh 409 Of.84
    // (retirado a pedido del laboratorio): llega sin requisito y se fija en la orden.
    C.phDelCatalogo = Boolean(C.rPh.limiteInf && C.rPh.limiteSup);
    afirmar(!C.rAzufre.limiteInf && !C.rAzufre.limiteSup, "Azufre trae límites: se esperaba sin especificación");
    return `${C.muestra.codigo} · ${todos.length} análisis · pH ${C.rPh.limiteInf}–${C.rPh.limiteSup}`;
  });

  /* ---------------- 5. Asignación */
  await paso("Un analista no puede asignar (403)", async () => {
    await exigir(403, U.a2, "PUT", `/ot/${C.ot.id}/analistas`, { usuarioIds: [sesiones[U.a2].id] });
  });
  await paso("Jefe LQC asigna la OT a analista1", async () => {
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/analistas`, { usuarioIds: [sesiones[U.a1].id] });
    const ot = await ok(U.jefe, "GET", `/ot/${C.ot.id}`);
    afirmar((ot.analistas ?? []).some((a) => a.id === sesiones[U.a1].id), "analista1 no figura en la OT");
  });
  await paso("No se puede asignar a alguien de otro laboratorio (400/403)", async () => {
    await exigir([400, 403], U.jefe, "PUT", `/ot/${C.ot.id}/analistas`, { usuarioIds: [sesiones[U.a1].id, sesiones[U.otroLab].id] });
  });
  await paso("Mi bandeja tras asignar", async () => {
    const mias = lista(await ok(U.a1, "GET", "/ot?mias=1&estado=abiertas&limit=200"));
    afirmar(mias.some((o) => o.id === C.ot.id), "OT ausente de «Mis OT» de analista1");
    return [
      await exigirBandeja(U.jefe, B0[U.jefe], { ot_sin_asignar: 0 }),
      await exigirBandeja(U.a1, B0[U.a1], { ot_asignadas: 1 }),
      await exigirBandeja(U.a2, B0[U.a2], { ot_asignadas: 0 }),
    ].join(" | ");
  });

  /* ---------------- 6. Captura */
  await paso("Analista de LPN no puede capturar en la OT de LQC (403)", async () => {
    await exigir([403, 404], U.otroLab, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7" });
    await exigir([403, 404], U.otroLab, "GET", `/flujo/ot/${C.ot.id}/resultados`);
  });
  await paso("Analista1 captura pH (límites del catálogo o de la orden) → cumple", async () => {
    if (!C.phDelCatalogo) {
      const e = await ok(U.a1, "PATCH", `/flujo/resultado/${C.rPh.id}/especificacion`, { limiteInf: "6,5", limiteSup: "8,5" });
      afirmar(e.especOrigen === "orden", `especOrigen ${e.especOrigen}`);
      Object.assign(C.rPh, { limiteInf: e.limiteInf, limiteSup: e.limiteSup });
    }
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7,2" });
    afirmar(r.veredicto === "cumple", `veredicto ${r.veredicto}`);
    return `7,2 en [${C.rPh.limiteInf}; ${C.rPh.limiteSup}] → ${r.veredicto}`;
  });
  await paso("Analista1 no puede cambiar lo que es de la jefatura: límite del catálogo o fórmula (403)", async () => {
    if (C.phDelCatalogo) await exigir(403, U.a1, "PATCH", `/flujo/resultado/${C.rPh.id}/especificacion`, { limiteSup: "9" });
    await exigir(403, U.a1, "PATCH", `/flujo/resultado/${C.rPh.id}/especificacion`, { formula: "C1 * 2" });
  });
  await paso("Analista1 completa la especificación de Azufre en la orden y captura réplicas", async () => {
    const e = await ok(U.a1, "PATCH", `/flujo/resultado/${C.rAzufre.id}/especificacion`, { limiteInf: "0", limiteSup: "0,5", unidad: "%" });
    afirmar(e.especOrigen === "orden", `especOrigen ${e.especOrigen}`);
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rAzufre.id}/valor`, { replicasTexto: "0,31 0,29 0,30" });
    afirmar(r.veredicto === "cumple", `veredicto ${r.veredicto}`);
    return `réplicas 0,31 0,29 0,30 → ${r.valorNumerico ?? ""} ${r.veredicto}`;
  });
  await paso("Analista1 define el atributo de Formación de grumos y marca Cumple", async () => {
    await ok(U.a1, "PATCH", `/flujo/resultado/${C.rGrumos.id}/especificacion`, { requisito: "Sin formación de grumos", tipoDato: "atributo" });
    await exigir(400, U.a1, "POST", `/flujo/resultado/${C.rGrumos.id}/valor`, { atributo: "no_cumple" });
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rGrumos.id}/valor`, { atributo: "cumple" });
    afirmar(r.veredicto === "cumple", `veredicto ${r.veredicto}`);
    return "«No cumple» sin observación rechazado (400); Cumple";
  });
  await paso("Tarjetas de Mi bandeja = total de la lista que abren (con resultados por revisar)", () => contrastarTarjetas(PERFILES_TARJETAS));
  await paso("Mi bandeja tras capturar", async () => {
    const pend = lista(await ok(U.rev, "GET", "/resultados/bandeja?estado=capturado&limit=500"));
    afirmar(C.resultados.every((id) => pend.some((r) => r.id === id || r.resultadoId === id)), "faltan resultados en la bandeja «capturado» del revisor");
    return [
      await exigirBandeja(U.rev, B0[U.rev], { resultados_por_revisar: 3 }),
      await exigirBandeja(U.jefe, B0[U.jefe], { resultados_por_revisar: 3, resultados_por_aprobar: 0 }),
    ].join(" | ");
  });

  /* ---------------- 7. Revisión y aprobación */
  await paso("Analista1 NO puede revisar lo que capturó (403/409)", async () => {
    await exigir([403, 409], U.a1, "POST", `/resultados/${C.rPh.id}/revisar`, {});
  });
  await paso("No se emite el informe antes de aprobar (409)", async () => {
    const pl = lista(await ok(U.jefe, "GET", "/plantillas?limit=200"));
    C.plantilla = pl.find((p) => p.repid === "BolAn") ?? pl.find((p) => p.tipo === "BOLETIN" && p.activo !== false);
    afirmar(C.plantilla, "no hay plantilla de boletín");
    const cond = await ok(U.jefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: C.plantilla.id });
    afirmar(cond.puedeEmitir === false, "condiciones dice que se puede emitir sin aprobar");
    await exigir(409, U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.plantilla.id });
    return (cond.faltantes ?? [])[0]?.slice(0, 90);
  });
  await paso("Revisor revisa la OT completa", async () => {
    const r = await ok(U.rev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    const rs = (await ok(U.rev, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    afirmar(rs.every((x) => x.estado === "revisado_n1"), `estados: ${rs.map((x) => x.estado).join(",")}`);
    return `${r.actualizados ?? r.procesados ?? rs.length} revisados`;
  });
  await paso("Mi bandeja tras revisar", async () => {
    return [
      await exigirBandeja(U.rev, B0[U.rev], { resultados_por_revisar: 0 }),
      await exigirBandeja(U.jefe, B0[U.jefe], { resultados_por_revisar: 0, resultados_por_aprobar: 3 }),
    ].join(" | ");
  });
  await paso("Analista2 no puede aprobar (403)", async () => {
    await exigir(403, U.a2, "POST", `/resultados/${C.rPh.id}/aprobar`, {});
  });
  await paso("Jefe LQC aprueba la OT completa", async () => {
    await ok(U.jefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    afirmar(rs.every((x) => x.estado === "aprobado"), `estados: ${rs.map((x) => x.estado).join(",")}`);
    return await exigirBandeja(U.jefe, B0[U.jefe], { resultados_por_aprobar: 0 });
  });

  /* ---------------- 8. Emisión */
  await paso("Se emite el informe (queda en firma)", async () => {
    const cond = await ok(U.jefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: C.plantilla.id });
    afirmar(cond.puedeEmitir, `no se puede emitir: ${(cond.faltantes ?? []).join(" | ")}`);
    const r = await ok(U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.plantilla.id });
    C.doc = r.certificado ?? r.documento ?? r;
    C.docId = C.doc.id ?? r.certificadoId ?? r.id;
    afirmar(C.docId, `la emisión no devolvió el documento: ${JSON.stringify(r).slice(0, 200)}`);
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    C.pasosFirma = circ.pasos ?? [];
    afirmar((circ.documento?.estado ?? circ.estado ?? C.doc.estado) === "en_firma", "el documento no quedó en firma");
    afirmar(C.pasosFirma.length > 0, "el documento no tiene pasos de firma");
    // «Informes por oficializar» cuenta los documentos en firma del ámbito (no los boletines antiguos).
    await exigirBandeja(U.jefe, B0[U.jefe], { informes_por_oficializar: 1 });
    return `${C.doc.numero ?? C.doc.codigo ?? C.docId} · ${C.pasosFirma.length} paso(s): ${C.pasosFirma.map((p) => `${p.orden}:${(p.responsables ?? []).map((x) => x.nombre).join("/")}`).join(" → ")}`;
  });

  /* ---------------- 8b. Reapertura de un resultado aprobado */
  await paso("Un analista no puede reabrir un resultado aprobado (403)", async () => {
    await exigir(403, U.a1, "POST", `/resultados/${C.rPh.id}/reabrir`, { motivo: "Valor transcrito mal" });
  });
  await paso("Jefe LQC reabre pH: vuelve al analista y se anula el documento en firma", async () => {
    await exigir(400, U.jefe, "POST", `/resultados/${C.rPh.id}/reabrir`, { motivo: "x" });
    const r = await ok(U.jefe, "POST", `/resultados/${C.rPh.id}/reabrir`, { motivo: "El pH se transcribió mal del equipo" });
    afirmar(r.estado === "devuelto", `estado ${r.estado}`);
    afirmar((r.documentosAnulados ?? []).some((d) => d.id === C.docId), "el documento en firma no se anuló");
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    afirmar((circ.documento?.estado ?? circ.estado) === "anulado", `documento ${circ.documento?.estado ?? circ.estado}`);
    await exigirBandeja(U.jefe, B0[U.jefe], { informes_por_oficializar: 0, resultados_por_aprobar: 0 });
    await exigir(409, U.jefe, "POST", `/resultados/${C.rPh.id}/reabrir`, { motivo: "Otra vez, sin estar aprobado" });
    const hist = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    afirmar(hist.some((h) => h.tipo === "reapertura_resultado"), "la reapertura no quedó en el historial de la OT");
    return (r.avisos ?? []).join(" ").slice(0, 120);
  });
  await paso("Se corrige, revisa y aprueba de nuevo; se reemite como nueva versión", async () => {
    const c = await ok(U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "7,3" });
    afirmar(c.veredicto === "cumple", `veredicto ${c.veredicto}`);
    await ok(U.rev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    await ok(U.jefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    const anterior = C.docId;
    const r = await ok(U.jefe, "POST", `/informes/${anterior}/reemitir`, {});
    const doc = r.certificado ?? r.documento ?? r;
    C.docId = doc.id ?? r.certificadoId;
    afirmar(C.docId && C.docId !== anterior, "la reemisión no creó un documento nuevo");
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    afirmar((circ.documento?.estado ?? circ.estado) === "en_firma", "la nueva versión no quedó en firma");
    afirmar(circ.version === 2 || circ.documento?.version === 2, `versión ${circ.version ?? circ.documento?.version}`);
    C.pasosFirma = circ.pasos ?? [];
    return `${circ.numero ?? circ.documento?.numero} (V2) · ${C.pasosFirma.length} paso(s)`;
  });

  /* ---------------- 9. Firma según la matriz */
  const usuarioDeId = () => Object.fromEntries(Object.entries(sesiones).map(([u, s]) => [s.id, u]));
  await paso("Firma en orden según la matriz (quien está fuera de turno es rechazado)", async () => {
    const porId = usuarioDeId();
    const ordenes = [...new Set(C.pasosFirma.map((p) => p.orden))].sort((a, b) => a - b);
    const hechos = [];
    const firmantes = new Set();
    let base1 = null;
    for (const orden of ordenes) {
      const delOrden = C.pasosFirma.filter((p) => p.orden === orden && p.estado !== "omitido");
      for (const p of delOrden) {
        const candidatos = (p.responsables ?? []).map((r) => porId[r.usuarioId]).filter(Boolean);
        const quien = candidatos.find((u) => !firmantes.has(u)) ?? candidatos[0];
        afirmar(quien, `paso ${orden}: ningún responsable entre los usuarios de prueba (${(p.responsables ?? []).map((r) => r.nombre).join(", ")})`);
        if (orden === ordenes[0] && !base1) {
          base1 = { quien, b: await bandeja(quien) };
          const pf = lista(await ok(quien, "GET", "/informes/por-firmar"));
          afirmar(pf.some((d) => (d.id ?? d.certificadoId) === C.docId), `${quien}: el documento no está en «Documentos por firmar»`);
          afirmar((base1.b.firmas_pendientes?.cantidad ?? 0) >= 1, `${quien}: «Documentos por firmar» = 0`);
        }
        // Fuera de turno: un responsable de un paso posterior, o alguien ajeno.
        const posterior = C.pasosFirma.find((x) => x.orden > orden);
        const ajeno = (posterior?.responsables ?? []).map((r) => porId[r.usuarioId]).find((u) => u && !candidatos.includes(u)) ?? U.a2;
        await exigir(403, ajeno, "POST", `/informes/${C.docId}/firmar`, {});
        await ok(quien, "POST", `/informes/${C.docId}/firmar`, {});
        firmantes.add(quien);
        hechos.push(`${orden}:${quien.replace("demo.", "")} (rechazado ${ajeno.replace("demo.", "")})`);
      }
    }
    return hechos.join(" → ");
  });
  await paso("El documento queda oficial", async () => {
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    const estado = circ.documento?.estado ?? circ.estado;
    afirmar(estado === "oficial", `estado ${estado}`);
    const pe = lista(await ok(U.planif, "GET", "/informes/documentos?estado=por_entregar&limit=200"));
    afirmar(pe.some((d) => d.id === C.docId), "el documento no figura en «por entregar»");
    return [
      await exigirBandeja(U.jefe, B0[U.jefe], { documentos_por_entregar: 1, ot_listas_cerrar: 0, informes_por_oficializar: 0 }),
      await exigirBandeja(U.planif, B0[U.planif], { documentos_por_entregar: 1 }),
    ].join(" | ");
  });

  /* ---------------- 10. Entrega */
  await paso("No se cierra la OT sin entregar el documento (409)", async () => {
    await exigir(409, U.planif, "POST", `/ot/${C.ot.id}/cerrar`, {});
  });
  await paso("Se registra la entrega", async () => {
    await exigir(403, U.a1, "POST", `/informes/${C.docId}/entregar`, { medio: "mano", destinatario: "Cliente" });
    await ok(U.planif, "POST", `/informes/${C.docId}/entregar`, { medio: "correo", destinatario: "flujo@example.cl" });
    await exigir([400, 409], U.planif, "POST", `/informes/${C.docId}/entregar`, { medio: "correo", destinatario: "flujo@example.cl" });
    const lc = lista(await ok(U.jefe, "GET", "/ot?listasCierre=1&limit=200"));
    afirmar(lc.some((o) => o.id === C.ot.id), "OT ausente de «OT listas para cerrar»");
    return [
      await exigirBandeja(U.jefe, B0[U.jefe], { documentos_por_entregar: 0, ot_listas_cerrar: 1 }),
      await exigirBandeja(U.planif, B0[U.planif], { documentos_por_entregar: 0, ot_listas_cerrar: 1 }),
    ].join(" | ");
  });

  /* ---------------- 11. Cierre */
  await paso("Un analista no puede cerrar la OT (403)", async () => {
    await exigir(403, U.a1, "POST", `/ot/${C.ot.id}/cerrar`, {});
  });
  await paso("Planificación cierra la OT y nace la factura pendiente", async () => {
    const r = await ok(U.planif, "POST", `/ot/${C.ot.id}/cerrar`, {});
    C.factura = r.facturaCreada;
    afirmar(C.factura && C.factura.estado === "pendiente", `factura: ${JSON.stringify(r.facturaCreada)}`);
    const ot = await ok(U.planif, "GET", `/ot/${C.ot.id}`);
    afirmar(ot.estado === "cerrada", `estado ${ot.estado}`);
    return `${C.factura.numero} total ${C.factura.total} · recorrido ${(r.recorrido ?? []).join("→")}`;
  });
  await paso("Mi bandeja tras cerrar", async () => {
    const fp = lista(await ok(U.finanzas, "GET", "/facturas?estado=pendiente&limit=200"));
    afirmar(fp.some((f) => f.id === C.factura.id), "factura ausente de «Pendientes de facturar»");
    await ok(U.finanzas, "GET", "/ot?estado=cerrada&sinFactura=1&limit=200");
    return [
      await exigirBandeja(U.jefe, B0[U.jefe], { ot_listas_cerrar: 0, ot_por_vencer: 0 }),
      await exigirBandeja(U.planif, B0[U.planif], { ot_listas_cerrar: 0, ot_abiertas: 0 }),
      await exigirBandeja(U.a1, B0[U.a1], { ot_asignadas: 0 }),
      await exigirBandeja(U.finanzas, B0[U.finanzas], { facturas_pendientes: 1, facturas_por_cobrar: 0, ot_cerradas_sin_factura: 0 }),
    ].join(" | ");
  });

  /* ---------------- 12. Factura y pagos */
  await paso("Finanzas emite la factura con folio", async () => {
    await exigir(403, U.ventas, "POST", `/facturas/${C.factura.id}/emitir`, { numero: `F-${sello}` });
    const f = await ok(U.finanzas, "POST", `/facturas/${C.factura.id}/emitir`, { numero: `F-${sello}` });
    afirmar(f.estado === "emitida", `estado ${f.estado}`);
    C.total = Number(f.total);
    afirmar(C.total > 0, `total ${f.total}`);
    return [`F-${sello} total ${C.total}`, await exigirBandeja(U.finanzas, B0[U.finanzas], { facturas_pendientes: 0, facturas_por_cobrar: 1 })].join(" | ");
  });
  await paso("Pago parcial y pago total", async () => {
    const mitad = Math.round(C.total / 2);
    await ok(U.finanzas, "POST", "/pagos", { facturaId: C.factura.id, monto: mitad, medio: "transferencia", referencia: `P1-${sello}` });
    let s = await ok(U.finanzas, "GET", `/facturas/${C.factura.id}/saldo`);
    afirmar((s.estado ?? s.factura?.estado) === "parcial" || Number(s.saldo) === C.total - mitad, `tras el parcial: ${JSON.stringify(s)}`);
    await exigir([400, 409], U.finanzas, "POST", "/pagos", { facturaId: C.factura.id, monto: C.total, medio: "transferencia" });
    await ok(U.finanzas, "POST", "/pagos", { facturaId: C.factura.id, monto: C.total - mitad, medio: "transferencia", referencia: `P2-${sello}` });
    s = await ok(U.finanzas, "GET", `/facturas/${C.factura.id}/saldo`);
    const fac = await ok(U.finanzas, "GET", `/facturas/${C.factura.id}`);
    afirmar(fac.estado === "pagada", `estado ${fac.estado}`);
    afirmar(Number(s.saldo) === 0, `saldo ${s.saldo}`);
    return [`${mitad} + ${C.total - mitad} → pagada (sobrepago rechazado)`, await exigirBandeja(U.finanzas, B0[U.finanzas], { facturas_pendientes: 0, facturas_por_cobrar: 0 })].join(" | ");
  });

  await paso("Tarjetas de Mi bandeja = total de la lista que abren (final)", () => contrastarTarjetas(PERFILES_TARJETAS));

  await paso("LPN sigue sin ver nada de la OT (OT, resultados, documento)", async () => {
    await exigir([403, 404], U.otroLab, "GET", `/ot/${C.ot.id}`);
    await exigir([403, 404], U.otroLab, "GET", `/ot/${C.ot.id}/cierre`);
    await exigir([403, 404], U.otroLab, "GET", `/informes/${C.docId}/circuito`);
    const docs = lista(await llamar(U.otroLab, "GET", `/informes/documentos?otId=${C.ot.id}`).then((r) => r.json));
    afirmar(!docs.some((d) => d.id === C.docId), "LPN ve el documento de la OT de LQC");
    return await exigirBandeja(U.otroLab, B0[U.otroLab], { ot_en_curso: 0, ot_asignadas: 0 });
  });
}

main()
  .then(() => {
    console.log(`\nRecorrido completo: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
