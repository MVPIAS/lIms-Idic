#!/usr/bin/env node
/**
 * Medición formal del tiempo de cada cambio de vista (contrato §4.8.6: «cada
 * cambio de vista debe cargar en ≤ 5 segundos»). Usa el Playwright que ya trae
 * apps/web (Chromium sin interfaz).
 *
 * Para cada vista principal mide dos cosas:
 *   · Carga directa: abrir la URL de la vista (recarga completa del navegador).
 *   · Cambio de vista: pasar a ella desde el menú lateral sin recargar (como lo
 *     hace el usuario); si la vista no está en el menú, navegación del enrutador.
 * Se da por cargada cuando no quedan peticiones a la API pendientes durante
 * 400 ms y no se ve ningún «Cargando…» en la página. Cada vista se mide
 * `--repeticiones` veces y se informa la mediana y el peor caso.
 *
 * Uso:
 *   node scripts/verificacion/tiempos-vista.js --web http://localhost:3130 [--usuario demo.admin]
 *        [--repeticiones 3] [--salida tiempos.json]
 * Variables: CLAVE_DEMO (o la CLAVE_DEMO_EMBEBIDA del código). Solo lee.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const { chromium } = require(require.resolve("@playwright/test", { paths: [path.join(RAIZ, "apps/web")] }));
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const WEB = arg("--web", "http://localhost:3110").replace(/\/$/, "");
const USUARIO = arg("--usuario", "demo.admin");
const REPS = Number(arg("--repeticiones", "3"));
const SALIDA = arg("--salida", null);
const SOLO = arg("--solo", null); // p. ej. "/ot,/muestras"
const LIMITE_MS = 5000;

function claveDemo() {
  if (process.env.CLAVE_DEMO) return process.env.CLAVE_DEMO;
  const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/auth/auth.service.ts"), "utf8");
  return src.match(/CLAVE_DEMO_EMBEBIDA\s*=\s*"([^"]+)"/)[1];
}

/** Vistas principales de cada área (las del menú lateral más usadas). */
const VISTAS = [
  ["/inicio", "Mi bandeja"],
  ["/dashboard", "Panel de indicadores"],
  ["/clientes", "Clientes"],
  ["/crm", "Oportunidades (CRM)"],
  ["/cotizaciones", "Cotizaciones"],
  ["/cotizaciones/nueva", "Nueva cotización"],
  ["/seguimiento", "Seguimiento"],
  ["/facturas", "Facturas"],
  ["/ot", "Órdenes de trabajo"],
  ["/ot/nueva", "Registrar OT"],
  ["/muestras", "Muestras recibidas"],
  ["/recepcion", "Bandeja de entrada"],
  ["/captura-ot", "Captura y revisión"],
  ["/informes", "Emitir informe"],
  ["/certificados", "Informes y certificados"],
  ["/equipos", "Equipos y calibración"],
  ["/consumibles", "Consumibles"],
  ["/qc", "Control de calidad (QC)"],
  ["/spc", "Control estadístico (SPC)"],
  ["/no-conformidades", "No conformidades"],
  ["/metrologia", "Calibraciones"],
  ["/bpch/internaciones", "Internaciones BPCH"],
  ["/saec", "Evidencias SAEC"],
  ["/catalogo", "Catálogo"],
  ["/agenda", "Agenda"],
  ["/documentos", "Gestor documental"],
  ["/instrumentos", "Datos de instrumentos"],
  ["/reportes", "Reportes"],
  ["/mensajeria", "Mensajería"],
  ["/admin/usuarios", "Usuarios"],
  ["/auditoria", "Auditoría"],
];

const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length ? o[Math.floor((o.length - 1) / 2)] : null;
};

async function main() {
  // Sesión: ingreso por la API (como la pantalla de ingreso) y token en localStorage.
  const r = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USUARIO, password: claveDemo() }),
  });
  const sesion = await r.json();
  if (!sesion.accessToken) throw new Error(`Ingreso ${USUARIO}: HTTP ${r.status}`);

  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  await contexto.addInitScript(([t, u]) => {
    localStorage.setItem("lims_token", t);
    localStorage.setItem("lims_user", u);
  }, [sesion.accessToken, JSON.stringify(sesion.user ?? {})]);
  const pagina = await contexto.newPage();

  // Peticiones a la API en vuelo (para saber cuándo terminó de cargar la vista).
  const enVuelo = new Set();
  let ultimoCambio = Date.now();
  const esApi = (req) => req.url().includes("/api/");
  pagina.on("request", (q) => { if (esApi(q)) { enVuelo.add(q); ultimoCambio = Date.now(); } });
  const fin = (q) => { if (enVuelo.delete(q)) ultimoCambio = Date.now(); };
  pagina.on("requestfinished", fin);
  pagina.on("requestfailed", fin);
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(String(e.message).slice(0, 160)));

  /**
   * Espera a que la vista esté lista y devuelve los ms desde `t0`: hasta la
   * última respuesta de la API (o el cambio de URL, si no hubo peticiones),
   * una vez que no queda nada pendiente durante 400 ms ni se ve «Cargando…».
   */
  async function esperarLista(t0, ruta) {
    const tope = t0 + 20_000;
    await pagina.waitForURL((u) => u.pathname === ruta || u.pathname.startsWith(ruta + "/") || u.pathname === "/login", { timeout: 20_000 }).catch(() => undefined);
    const tUrl = Date.now();
    while (Date.now() < tope) {
      const ultimo = Math.max(tUrl, ultimoCambio);
      if (enVuelo.size === 0 && Date.now() - ultimo >= 400) {
        const cargando = await pagina.locator("text=/Cargando/i").first().isVisible().catch(() => false);
        if (!cargando) return Math.max(tUrl, ultimoCambio) - t0;
      }
      await pagina.waitForTimeout(25);
    }
    console.log(`   (sin terminar a los 20 s en ${ruta}: ${[...enVuelo].map((q) => q.url().replace(/^.*\/api/, "")).join(", ") || "«Cargando…» visible"})`);
    return Date.now() - t0;
  }

  const filas = [];
  await pagina.goto(`${WEB}/inicio`);
  await esperarLista(Date.now(), "/inicio");
  for (const [ruta, nombre] of VISTAS.filter(([r]) => !SOLO || SOLO.split(",").includes(r))) {
    const directa = [];
    const cambio = [];
    let llegada = ruta;
    for (let k = 0; k < REPS; k++) {
      // Cambio de vista desde otra pantalla, por el menú (sin recargar).
      if (ruta !== "/inicio") {
        await pagina.goto(`${WEB}/inicio`);
        await esperarLista(Date.now(), "/inicio");
      } else {
        await pagina.goto(`${WEB}/ot`);
        await esperarLista(Date.now(), "/ot");
      }
      const enlace = pagina.locator(`aside a[href="${ruta}"]`).first();
      const t1 = Date.now();
      if (await enlace.count()) await enlace.click();
      else await pagina.evaluate((r) => { window.history.pushState({}, "", r); window.dispatchEvent(new PopStateEvent("popstate")); }, ruta);
      cambio.push(await esperarLista(t1, ruta));
      // Carga directa (recarga completa).
      const t0 = Date.now();
      await pagina.goto(`${WEB}${ruta}`);
      directa.push(await esperarLista(t0, ruta));
      llegada = new URL(pagina.url()).pathname;
    }
    const f = {
      ruta, nombre,
      cambioMediana: mediana(cambio), cambioMax: Math.max(...cambio),
      directaMediana: mediana(directa), directaMax: Math.max(...directa),
      llegada,
    };
    f.cumple = f.cambioMax <= LIMITE_MS && f.directaMax <= LIMITE_MS && llegada !== "/login";
    filas.push(f);
    console.log(`${f.cumple ? "OK " : "NO "} ${ruta.padEnd(24)} cambio ${String(f.cambioMediana).padStart(5)} ms (máx ${f.cambioMax}) · directa ${String(f.directaMediana).padStart(5)} ms (máx ${f.directaMax})${llegada !== ruta ? ` → ${llegada}` : ""}`);
  }
  await navegador.close();

  const peor = filas.reduce((a, b) => (Math.max(b.cambioMax, b.directaMax) > Math.max(a.cambioMax, a.directaMax) ? b : a));
  const informe = {
    fecha: new Date().toISOString(), web: WEB, usuario: USUARIO, repeticiones: REPS, limiteMs: LIMITE_MS,
    vistas: filas, cumplen: filas.filter((f) => f.cumple).length, total: filas.length,
    peor: { ruta: peor.ruta, ms: Math.max(peor.cambioMax, peor.directaMax) },
    erroresDePagina: [...new Set(errores)].slice(0, 20),
  };
  console.log(`\n${informe.cumplen}/${informe.total} vistas ≤ ${LIMITE_MS} ms · peor ${informe.peor.ruta} ${informe.peor.ms} ms`);
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2));
  process.exit(informe.cumplen === informe.total ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(2);
});
