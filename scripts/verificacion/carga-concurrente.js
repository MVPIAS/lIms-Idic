#!/usr/bin/env node
/**
 * Prueba de carga concurrente (contrato §4.7.6: «soportar ≥ 1000 usuarios y
 * ≥ 20 conexiones concurrentes»). Sin dependencias: Node 20 (fetch nativo).
 *
 * Cada usuario virtual ingresa con SU PROPIA cuenta y repite, durante la
 * duración indicada, un recorrido de lecturas típicas de analista (avisos, OT,
 * muestras, resultados, equipos, catálogo, agenda, documentos) con una pausa entre
 * peticiones. Mide por ruta y en total: peticiones, errores, p50, p95, p99 y
 * máximo (ms), y el rendimiento (peticiones/s). Opcionalmente mide además el
 * listado y la búsqueda de usuarios con los 1000 de carga-1000-usuarios.sql.
 *
 * Uso:
 *   node scripts/verificacion/carga-concurrente.js --base http://localhost:3012/api \
 *        [--usuarios 25] [--duracion 60] [--pausa 250] [--prefijo prueba.carga.] [--salida informe.json]
 *   node scripts/verificacion/carga-concurrente.js --anonimo --base https://servidor/api --web https://servidor \
 *        [--usuarios 25] [--duracion 30]      (solo GET sin sesión: salud de la API y pantalla de ingreso)
 *
 * Variables: CLAVE_DEMO (o la CLAVE_DEMO_EMBEBIDA del código). Solo lee: no
 * crea ni modifica datos (salvo la fecha de último ingreso de cada cuenta).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const tiene = (n) => args.includes(n);
const BASE = arg("--base", process.env.API_BASE || "http://localhost:3001/api").replace(/\/$/, "");
const WEB = arg("--web", null);
const N = Number(arg("--usuarios", "25"));
const DURACION = Number(arg("--duracion", "60")) * 1000;
const PAUSA = Number(arg("--pausa", "250"));
const PREFIJO = arg("--prefijo", "prueba.carga.");
const SALIDA = arg("--salida", null);
const ANONIMO = tiene("--anonimo");

function claveDemo() {
  if (process.env.CLAVE_DEMO) return process.env.CLAVE_DEMO;
  const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/auth/auth.service.ts"), "utf8");
  const m = src.match(/CLAVE_DEMO_EMBEBIDA\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("No se encontró CLAVE_DEMO_EMBEBIDA; defina CLAVE_DEMO.");
  return m[1];
}

/**
 * Recorrido de lecturas de una jornada de analista de laboratorio (el rol de
 * las cuentas de carga): bandeja de avisos, OT, muestras, resultados, equipos,
 * catálogo, agenda y documentos. Todas son lecturas que el rol puede hacer: un
 * 403 aquí sería un error de verdad.
 */
const RUTAS_SESION = [
  "/auth/me",
  "/avisos?soloNoLeidos=true",
  "/ot?page=1&limit=20",
  "/muestras?page=1&limit=20",
  "/resultados?page=1&limit=20",
  "/equipos?page=1&limit=20",
  "/cat/metodos?page=1&limit=20",
  "/cat/ensayos?page=1&limit=20",
  "/agenda/calendario?vista=semana",
  "/documentos/carpetas",
];

/* --------------------------------------------------------------- medidas --- */
const medidas = new Map(); // ruta → { t: number[], errores: number, codigos: {} }
function anotar(ruta, ms, codigo) {
  if (!medidas.has(ruta)) medidas.set(ruta, { t: [], errores: 0, codigos: {} });
  const m = medidas.get(ruta);
  m.t.push(ms);
  m.codigos[codigo] = (m.codigos[codigo] ?? 0) + 1;
  if (!(codigo >= 200 && codigo < 400)) m.errores++;
}
/** Percentil por el método del rango más cercano (nearest-rank). */
function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  const k = Math.max(1, Math.ceil((p / 100) * ordenados.length));
  return ordenados[k - 1];
}
function resumen(t, errores) {
  const o = [...t].sort((a, b) => a - b);
  const r = (v) => (v == null ? null : Math.round(v));
  return { n: o.length, errores, p50: r(percentil(o, 50)), p95: r(percentil(o, 95)), p99: r(percentil(o, 99)), max: r(o[o.length - 1]) };
}

async function pedir(url, token, etiqueta) {
  const t0 = performance.now();
  let codigo = 0;
  try {
    const r = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    await r.arrayBuffer();
    codigo = r.status;
  } catch {
    codigo = 0;
  }
  anotar(etiqueta, performance.now() - t0, codigo);
  return codigo;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------- login --- */
async function ingresar(username, clave) {
  for (let intento = 0; intento < 4; intento++) {
    const t0 = performance.now();
    const r = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: clave }),
    });
    const j = await r.json().catch(() => ({}));
    anotar("POST /auth/login", performance.now() - t0, r.status);
    if (j.accessToken) return j.accessToken;
    if (r.status === 429) {
      await dormir(61_000); // límite de intentos de ingreso por minuto
      continue;
    }
    throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  }
  throw new Error(`login ${username}: demasiados reintentos`);
}

/* ------------------------------------------------------------- recorridos --- */
async function usuarioVirtual(i, token, fin) {
  let k = i % RUTAS_SESION.length; // cada usuario empieza en un punto distinto
  while (performance.now() < fin) {
    const ruta = RUTAS_SESION[k];
    await pedir(`${BASE}${ruta}`, token, `GET ${ruta.split("?")[0]}`);
    k = (k + 1) % RUTAS_SESION.length;
    if (PAUSA) await dormir(PAUSA * (0.5 + Math.random()));
  }
}

async function anonimo(i, fin) {
  const rutas = [[`${BASE}/health`, "GET /api/health"]];
  if (WEB) rutas.push([`${WEB.replace(/\/$/, "")}/login`, "GET /login (web)"]);
  let k = i % rutas.length;
  while (performance.now() < fin) {
    await pedir(rutas[k][0], null, rutas[k][1]);
    k = (k + 1) % rutas.length;
    if (PAUSA) await dormir(PAUSA * (0.5 + Math.random()));
  }
}

async function main() {
  console.log(`Prueba de carga · ${BASE} · ${N} usuarios concurrentes · ${DURACION / 1000} s · pausa ~${PAUSA} ms${ANONIMO ? " · solo GET sin sesión" : ""}`);
  const extra = {};
  let fin;
  const t0 = performance.now();
  if (ANONIMO) {
    fin = performance.now() + DURACION;
    await Promise.all(Array.from({ length: N }, (_, i) => anonimo(i, fin)));
  } else {
    const clave = claveDemo();
    // Cuentas: prueba.carga.0001… si existen (1000 usuarios); si no, las demo.* activas.
    const admin = await ingresar("demo.admin", clave);
    const lista = await fetch(`${BASE}/usuarios?q=${encodeURIComponent(PREFIJO)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json());
    let cuentas = (lista.data ?? []).map((u) => u.username).filter((u) => u.startsWith(PREFIJO));
    if (cuentas.length < N) {
      const demo = await fetch(`${BASE}/usuarios?q=demo.&activo=true`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json());
      cuentas = (demo.data ?? []).map((u) => u.username).filter((u) => /^demo\./.test(u) && u !== "demo.admin");
    }
    if (cuentas.length < N) throw new Error(`Solo hay ${cuentas.length} cuentas para ${N} usuarios virtuales.`);
    // Capacidad (≥ 1000 usuarios): listado completo y búsqueda con todos los usuarios.
    const tl = performance.now();
    const todos = await fetch(`${BASE}/usuarios`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json());
    extra.usuariosRegistrados = todos.meta?.total ?? null;
    extra.listadoUsuariosMs = Math.round(performance.now() - tl);
    const tb = performance.now();
    await fetch(`${BASE}/usuarios?q=0999`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json());
    extra.busquedaUsuarioMs = Math.round(performance.now() - tb);
    // Cuentas al azar (de entre todas las disponibles) para los N usuarios virtuales.
    const elegidas = cuentas.sort(() => Math.random() - 0.5).slice(0, N);
    console.log(`Ingresando ${N} cuentas (${elegidas[0]} …)`);
    const tokens = [];
    for (const u of elegidas) tokens.push(await ingresar(u, clave)); // en serie: el ingreso tiene límite por minuto
    fin = performance.now() + DURACION;
    await Promise.all(tokens.map((tk, i) => usuarioVirtual(i, tk, fin)));
  }
  const segundos = (performance.now() - t0) / 1000;

  const filas = [];
  const todosT = [];
  let errTot = 0;
  for (const [ruta, m] of [...medidas].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = resumen(m.t, m.errores);
    filas.push({ ruta, ...r, codigos: m.codigos });
    if (!ruta.startsWith("POST /auth/login")) {
      todosT.push(...m.t);
      errTot += m.errores;
    }
  }
  const total = resumen(todosT, errTot);
  const duracionCarga = DURACION / 1000;
  const informe = {
    fecha: new Date().toISOString(),
    base: BASE,
    usuariosConcurrentes: N,
    duracionS: duracionCarga,
    pausaMs: PAUSA,
    total: { ...total, porSegundo: Math.round((total.n / duracionCarga) * 10) / 10, pctErrores: total.n ? Math.round((errTot / total.n) * 1000) / 10 : 0 },
    rutas: filas,
    ...extra,
    duracionTotalS: Math.round(segundos),
  };

  console.log("\n| Ruta | Peticiones | Errores | p50 ms | p95 ms | p99 ms | Máx ms |\n|---|---:|---:|---:|---:|---:|---:|");
  for (const f of filas) console.log(`| ${f.ruta} | ${f.n} | ${f.errores} | ${f.p50} | ${f.p95} | ${f.p99} | ${f.max} |`);
  console.log(`| **Total (sin ingreso)** | **${total.n}** | **${errTot}** | **${total.p50}** | **${total.p95}** | **${total.p99}** | **${total.max}** |`);
  console.log(`\nRendimiento: ${informe.total.porSegundo} peticiones/s · errores ${informe.total.pctErrores} %`);
  if (extra.usuariosRegistrados != null)
    console.log(`Usuarios registrados: ${extra.usuariosRegistrados} · listado ${extra.listadoUsuariosMs} ms · búsqueda ${extra.busquedaUsuarioMs} ms`);
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2));
  // Criterio: sin errores y p95 total bajo 2 s (holgura frente a los 5 s por vista de §4.8.6).
  const ok = informe.total.pctErrores === 0 && (total.p95 ?? 0) < 2000;
  console.log(ok ? "\nRESULTADO: OK" : "\nRESULTADO: REVISAR");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(2);
});
