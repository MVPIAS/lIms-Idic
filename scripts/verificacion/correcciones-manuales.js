#!/usr/bin/env node
/**
 * Verificación contra una API real de las correcciones detectadas al reescribir
 * los manuales de usuario (docs/FLUJO_CORRECCIONES_MANUALES.md). Complementa
 * flujo-completo.js (que ya recorre el registro de muestras desde el expediente
 * y la reapertura de un resultado aprobado). Cada regla se prueba con el perfil
 * que debe poder y con uno que no.
 *
 * Uso:
 *   node scripts/verificacion/correcciones-manuales.js [--arrancar] [--base http://localhost:3521/api]
 *
 * Mismas variables que flujo-completo.js (DATABASE_URL con --arrancar; CLAVE_DEMO
 * o la constante CLAVE_DEMO_EMBEBIDA). Deja datos de prueba en la base (OT en
 * SSTGO y D11, controles de QC, una nota de crédito): úsese en una base de pruebas.
 * Bloquea y desbloquea la cuenta demo.muestreo (5 intentos fallidos).
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
const sesiones = {};
async function login(username, password = CLAVE) {
  if (sesiones[username] && password === CLAVE) return sesiones[username];
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) {
    const e = new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
    e.status = r.status;
    throw e;
  }
  const s = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id };
  if (password === CLAVE) sesiones[username] = s;
  return s;
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
  const puerto = new URL(BASE).port || "3521";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:3000",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-correcciones-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* PNG de 1×1 válido (firma de prueba). */
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Preparación: laboratorios, método pH, cliente y plantilla", async () => {
    const labs = await ok("demo.ventas", "GET", "/ot/laboratorios");
    for (const c of ["LQC", "SSTGO", "D11"]) {
      C[c] = labs.find((u) => u.codigo === c);
      afirmar(C[c], `${c} no figura en GET /ot/laboratorios`);
    }
    const m = lista(await ok("demo.lqc.jefe", "GET", "/cat/metodos?search=251&limit=50")).find((x) => x.codigo === "251");
    afirmar(m?.ensayoId, "método 251 (pH) no encontrado");
    C.mPh = m;
    const cl = lista(await ok("demo.ventas", "GET", "/clientes?limit=5"))[0];
    afirmar(cl, "no hay clientes");
    C.cliente = cl;
    const pl = lista(await ok("demo.lqc.jefe", "GET", "/plantillas?limit=200"));
    C.plantilla = pl.find((p) => p.repid === "BolAn") ?? pl.find((p) => p.tipo === "BOLETIN" && p.activo !== false);
    afirmar(C.plantilla, "no hay plantilla de boletín");
    return `pH=${m.codigo} · plantilla ${C.plantilla.repid} (${C.plantilla.tipo})`;
  });

  /** Cotización con el ensayo de pH aceptada para una unidad → OT. */
  const otDe = async (unidad, etiqueta) => {
    const cot = await ok("demo.ventas", "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", referencia: `Correcciones ${etiqueta} ${sello}`,
      lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 2 }],
    });
    const r = await ok("demo.ventas", "POST", `/cotizaciones/${cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-${etiqueta}-${sello}`, fecha: new Date().toISOString().slice(0, 10), conCobro: true, unidadPrincipalId: unidad.id,
    });
    return await ok("demo.director", "GET", `/ot/${r?.ot?.id ?? r?.otId}`);
  };

  /* ---------------- 1 · Registro de muestras desde el expediente (sucursal) */
  await paso("1 · OT de la Sucursal Santiago: el expediente propone el ensayo cotizado", async () => {
    C.otS = await otDe(C.SSTGO, "SSTGO");
    const p = await ok("demo.recepcion", "GET", `/flujo/ot/${C.otS.id}/registro-muestras`);
    const l = p.lineas.find((x) => x.ensayoId === C.mPh.ensayoId);
    afirmar(l && l.cantidad === 2, "la línea de pH no figura con su cantidad");
    afirmar(l.metodos.some((m) => m.id === C.mPh.id), "el método de pH no figura en la línea");
    return `${C.otS.codigo} · ${l.metodos.length} método(s) del ensayo, ${l.sugeridos.length} marcado(s)`;
  });
  await paso("1 · Recepción registra 2 muestras; un analista de otro laboratorio no puede (403)", async () => {
    await exigir(403, "demo.lpn.analista1", "POST", `/flujo/ot/${C.otS.id}/muestras`, { muestras: [{ nombre: "X", metodoIds: [C.mPh.id] }] });
    const r = await ok("demo.recepcion", "POST", `/flujo/ot/${C.otS.id}/muestras`, {
      muestras: [{ nombre: "Lote A", metodoIds: [C.mPh.id] }, { nombre: "Lote B", metodoIds: [C.mPh.id] }],
    });
    afirmar(r.muestras.map((m) => m.codigo).join(",") === `${C.otS.codigo}-M1,${C.otS.codigo}-M2`, `códigos ${r.muestras.map((m) => m.codigo)}`);
    const p = await ok("demo.recepcion", "GET", `/flujo/ot/${C.otS.id}/registro-muestras`);
    afirmar(p.muestras.length === 2 && p.muestras.every((m) => m.ensayos >= 1), "las muestras no quedaron con sus ensayos");
    return `${r.muestras.length} muestras · ${r.ensayos} ensayos`;
  });

  /* ---------------- 3 · Tipo de documento según la unidad */
  await paso("3 · En la sucursal el documento por defecto es «Informe de inspección» y tiene firmante", async () => {
    const c = await ok("demo.director", "POST", "/informes/condiciones", { otId: C.otS.id, plantillaId: C.plantilla.id });
    afirmar(c.tipoDocumento === "INFORME_INSPECCION", `tipo ${c.tipoDocumento}`);
    afirmar(c.tipoDocumentoOrigen === "unidad", `origen ${c.tipoDocumentoOrigen}`);
    afirmar(!c.faltantes.some((f) => /matriz/i.test(f)), `la matriz bloquea: ${c.faltantes.join(" | ")}`);
    afirmar(c.pasos.length >= 1 && c.pasos[0].responsables.length >= 1, "sin firmantes");
    return `${c.tipoDocumento} (de ${c.tipoDocumentoUnidad}) · firma ${c.pasos.map((p) => p.responsables.map((r) => r.nombre).join("/")).join(" → ")}`;
  });
  await paso("3 · Si se fuerza «Informe de ensayo», el mensaje dice qué paso falta y cómo resolverlo", async () => {
    const c = await ok("demo.director", "POST", "/informes/condiciones", { otId: C.otS.id, plantillaId: C.plantilla.id, tipoDocumento: "INFORME_ENSAYO" });
    const m = c.faltantes.find((f) => /matriz de «Informe de ensayo»/.test(f));
    afirmar(m, `sin mensaje de la matriz: ${c.faltantes.join(" | ")}`);
    afirmar(/SSTGO/.test(m) && /Administración › Usuarios/.test(m) && /Matriz de firmas/.test(m), `mensaje poco claro: ${m}`);
    return m.slice(0, 140);
  });
  await paso("3 · La Delegación Nº 11 hereda «Informe de inspección» del Banco de Pruebas", async () => {
    C.otD = await otDe(C.D11, "D11");
    const c = await ok("demo.director", "POST", "/informes/condiciones", { otId: C.otD.id, plantillaId: C.plantilla.id });
    afirmar(c.tipoDocumento === "INFORME_INSPECCION" && c.tipoDocumentoUnidad === "BPCH", `tipo ${c.tipoDocumento} de ${c.tipoDocumentoUnidad}`);
    afirmar(!c.faltantes.some((f) => /matriz/i.test(f)), `la matriz bloquea: ${c.faltantes.join(" | ")}`);
    const l = await ok("demo.director", "POST", "/informes/condiciones", { otId: C.otD.id, plantillaId: C.plantilla.id, tipoDocumento: "IVC" });
    afirmar(l.tipoDocumento === "IVC" && l.tipoDocumentoOrigen === "indicado", "el tipo indicado no manda");
    return `${C.otD.codigo}: ${c.tipoDocumento}`;
  });
  await paso("3 · Un laboratorio sigue emitiendo «Informe de ensayo»", async () => {
    const ots = lista(await ok("demo.lqc.jefe", "GET", "/ot?limit=1"));
    afirmar(ots[0], "LQC sin OT");
    const c = await ok("demo.lqc.jefe", "POST", "/informes/condiciones", { otId: ots[0].id, plantillaId: C.plantilla.id });
    afirmar(c.tipoDocumento === "INFORME_ENSAYO" && c.tipoDocumentoOrigen === "plantilla", `tipo ${c.tipoDocumento} (${c.tipoDocumentoOrigen})`);
  });

  /* ---------------- 4 · Completar tareas del flujo según el paso */
  await paso("4 · Se inicia el flujo FLU-QUI en la OT", async () => {
    const defs = lista(await ok("demo.auditor", "GET", "/flujos"));
    const def = defs.find((d) => d.codigo === "FLU-QUI" && d.versiones?.[0]?.estado === "publicado") ?? defs.find((d) => d.versiones?.[0]?.estado === "publicado");
    afirmar(def, "no hay flujo publicado");
    await ok("demo.planificacion", "POST", `/ot/${C.otS.id}/flujo`, { flujoDefId: def.id });
    const f = await ok("demo.recepcion", "GET", `/ot/${C.otS.id}/flujo`);
    afirmar(f.tareas.length && f.tareas[0].permisoRequerido, "la tarea no informa su permiso");
    C.def = def.codigo;
    return `${def.codigo} · tarea «${f.tareas[0].pasoEjecucion.paso.actividad}» exige ${f.tareas[0].permisoRequerido}`;
  });
  const tareaActual = async () => (await ok("demo.director", "GET", `/ot/${C.otS.id}/flujo`)).tareas[0];
  const quienPuede = { "muestra.crear": "demo.recepcion", "resultado.crear": "demo.sstgo.inspector", "resultado.revisar": "demo.sstgo.jefe", "resultado.aprobar": "demo.sstgo.jefe" };
  await paso("4 · Solo lectura y perfiles sin el permiso del paso no completan (403); quien lo tiene, sí", async () => {
    const hechos = [];
    for (let i = 0; i < 3; i++) {
      const t = await tareaActual();
      if (!t) break;
      const permiso = t.permisoRequerido;
      await exigir(403, "demo.auditor", "POST", `/flujos/tareas/${t.pasoEjecucionId}/completar`, {});
      await exigir(403, "demo.ventas", "POST", `/flujos/tareas/${t.pasoEjecucionId}/completar`, {});
      if (permiso === "resultado.crear")
        await exigir(403, "demo.lpn.analista1", "POST", `/flujos/tareas/${t.pasoEjecucionId}/completar`, {}); // fuera de su alcance
      const u = quienPuede[permiso];
      afirmar(u, `permiso no previsto ${permiso}`);
      await ok(u, "POST", `/flujos/tareas/${t.pasoEjecucionId}/completar`, {});
      hechos.push(`«${t.pasoEjecucion.paso.actividad}» (${permiso}) por ${u.replace("demo.", "")}`);
    }
    return hechos.join(" → ");
  });

  /* ---------------- 5 · Control de calidad: independencia */
  await paso("5 · Un control que cumple queda pendiente; quien lo registra no lo aprueba", async () => {
    const c = await ok("demo.sstgo.inspector", "POST", `/qc/ot/${C.otS.id}/control`, {
      catMetodoId: C.mPh.id, tipo: "estandar", valorEsperado: 10, valorObtenido: 10, criterio: "80-120",
    });
    afirmar(c.resultado === "pendiente" && c.evaluacion === "aprobado", `resultado ${c.resultado} / evaluación ${c.evaluacion}`);
    await exigir(403, "demo.sstgo.inspector", "PATCH", `/qc/control/${c.id}`, { resultado: "aprobado" }); // sin resultado.revisar
    const j = await ok("demo.sstgo.jefe", "POST", `/qc/ot/${C.otS.id}/control`, {
      catMetodoId: C.mPh.id, tipo: "blanco", valorObtenido: 0.1, criterio: "0.5",
    });
    await exigir(409, "demo.sstgo.jefe", "PATCH", `/qc/control/${j.id}`, { resultado: "aprobado" }); // el suyo
    await exigir(403, "demo.lpn.revisor", "PATCH", `/qc/control/${c.id}`, { resultado: "aprobado" }); // otro laboratorio
    const a = await ok("demo.sstgo.jefe", "PATCH", `/qc/control/${c.id}`, { resultado: "aprobado", aprobadoPor: "otra persona" });
    afirmar(a.resultado === "aprobado" && a.aprobadoPorId === sesiones["demo.sstgo.jefe"].id, "no quedó aprobado por el jefe");
    const malo = await ok("demo.sstgo.inspector", "POST", `/qc/ot/${C.otS.id}/control`, {
      catMetodoId: C.mPh.id, tipo: "estandar", valorEsperado: 10, valorObtenido: 50, criterio: "80-120",
    });
    afirmar(malo.resultado === "rechazado", `uno fuera de criterio quedó ${malo.resultado}`);
    return "pendiente → 403 sin permiso, 409 propio, 403 otro lab, aprobado por otra persona; fuera de criterio → rechazado";
  });

  /* ---------------- 6 · Abastecimiento */
  await paso("6 · Abastecimiento: compras y consumibles sí; facturas, centros de costo y parámetros no", async () => {
    const f = lista(await ok("demo.finanzas", "GET", "/facturas?limit=1"))[0];
    await exigir(403, "demo.abastecimiento", "GET", "/facturas?limit=1");
    if (f) await exigir(403, "demo.abastecimiento", "POST", `/facturas/${f.id}/emitir`, { numero: `X-${sello}` });
    await exigir(403, "demo.abastecimiento", "GET", "/centros-costo?limit=1");
    await exigir(403, "demo.abastecimiento", "POST", "/centros-costo", { codigo: `CC${sello.slice(-6)}`, nombre: "Prueba" });
    await exigir(403, "demo.abastecimiento", "POST", "/parametros", { categoria: "x", codigo: "x", nombre: "x" });
    await ok("demo.abastecimiento", "GET", "/ordenes-compra?limit=1");
    await ok("demo.abastecimiento", "GET", "/proveedores?limit=1");
    await ok("demo.abastecimiento", "GET", "/consumibles?limit=1");
    await ok("demo.finanzas", "GET", "/ordenes-compra?limit=1"); // conserva lo que veía
    const b = await ok("demo.abastecimiento", "GET", "/me/bandeja");
    afirmar(b.some((i) => i.clave === "oc_pendientes"), "Abastecimiento perdió su tarjeta de OC");
  });

  /* ---------------- 7 · Alcance del buscador de documentos y de los reportes */
  await paso("7 · Buscador de documentos: un laboratorio no ve los de otro; Dirección ve todo", async () => {
    const doc = lista(await ok("demo.lqc.jefe", "GET", "/informes/documentos?limit=1"))[0];
    afirmar(doc, "LQC no tiene documentos (corra antes flujo-completo.js)");
    const num = encodeURIComponent(doc.numero);
    const lqc = await ok("demo.lqc.jefe", "GET", `/documentos?q=${num}`);
    const lpn = await ok("demo.lpn.analista1", "GET", `/documentos?q=${num}`);
    const dir = await ok("demo.director", "GET", `/documentos?q=${num}`);
    afirmar(lqc.meta.total >= 1 && dir.meta.total >= 1, "LQC o Dirección no ven el documento");
    afirmar(lpn.meta.total === 0, "LPN ve un documento de LQC");
    const tLpn = (await ok("demo.lpn.analista1", "GET", "/documentos?limit=1")).meta.total;
    const tDir = (await ok("demo.director", "GET", "/documentos?limit=1")).meta.total;
    afirmar(tLpn < tDir, `LPN ve ${tLpn} de ${tDir}`);
    return `${doc.numero}: LQC ${lqc.meta.total}, LPN ${lpn.meta.total}, Dirección ${dir.meta.total} · totales LPN ${tLpn} / Dirección ${tDir}`;
  });
  await paso("7 · Reportes: la jefatura de un laboratorio ve solo lo suyo", async () => {
    const j = await ok("demo.lqc.jefe", "GET", "/reportes/productividad");
    const d = await ok("demo.director", "GET", "/reportes/productividad");
    afirmar(j.totales.ordenesTrabajo > 0 && j.totales.ordenesTrabajo < d.totales.ordenesTrabajo, `OT LQC ${j.totales.ordenesTrabajo} / total ${d.totales.ordenesTrabajo}`);
    const tj = await ok("demo.lqc.jefe", "GET", "/reportes/tabla?entidad=ot&campos=codigo");
    afirmar(tj.meta.total === j.totales.ordenesTrabajo, `exportador ${tj.meta.total} ≠ productividad ${j.totales.ordenesTrabajo}`);
    for (const r of ["conformidad", "plazos"]) await ok("demo.lqc.jefe", "GET", `/reportes/${r}`);
    await exigir(403, "demo.lqc.jefe", "GET", "/reportes/comercial");
    const cj = await ok("demo.sstgo.jefe", "GET", "/reportes/conformidad");
    const cd = await ok("demo.director", "GET", "/reportes/conformidad");
    afirmar(cj.global.total <= cd.global.total, "conformidad de la sucursal mayor que la global");
    return `OT: LQC ${j.totales.ordenesTrabajo} / IDIC ${d.totales.ordenesTrabajo} · resultados SSTGO ${cj.global.total} / IDIC ${cd.global.total}`;
  });

  /* ---------------- 2 · No se reabre en una OT cerrada */
  await paso("2 · Un resultado de una OT cerrada no se reabre (409)", async () => {
    const cerrada = lista(await ok("demo.lqc.jefe", "GET", "/ot?estado=cerrada&limit=20"))[0];
    if (!cerrada) return "sin OT cerrada en LQC (se omite)";
    const rs = (await ok("demo.lqc.jefe", "GET", `/flujo/ot/${cerrada.id}/resultados`)).resultados.filter((r) => r.estado === "aprobado");
    if (!rs.length) return `${cerrada.codigo} sin resultados aprobados (se omite)`;
    await exigir(409, "demo.lqc.jefe", "POST", `/resultados/${rs[0].id}/reabrir`, { motivo: "Prueba de reapertura en OT cerrada" });
    return cerrada.codigo;
  });

  /* ---------------- 12 · Notas de crédito */
  await paso("12 · Finanzas guarda una nota de crédito; Abastecimiento no puede", async () => {
    // Una factura con saldo para la nota de 100 (la última puede estar ya pagada:
    // la nota de crédito valida el saldo desde 5d95239, p. ej. tras flujo-completo.js).
    const fs_ = lista(await ok("demo.finanzas", "GET", "/facturas?limit=200"));
    const f = fs_.find((x) => x.saldo === undefined || Number(x.saldo) >= 100);
    afirmar(f, "no hay facturas con saldo para la nota de crédito");
    await exigir(403, "demo.abastecimiento", "POST", "/notas-credito", { facturaId: f.id, numero: `NCX-${sello}`, monto: 1 });
    const nc = await ok("demo.finanzas", "POST", "/notas-credito", { facturaId: f.id, numero: `NC-${sello}`, monto: 100, motivo: "Prueba" });
    afirmar(nc.id && nc.numero === `NC-${sello}`, JSON.stringify(nc).slice(0, 160));
    const l = lista(await ok("demo.finanzas", "GET", `/notas-credito?search=NC-${sello}`));
    afirmar(l.some((x) => x.id === nc.id), "la nota de crédito no aparece en la lista");
    return nc.numero;
  });

  /* ---------------- 13 · Usuarios bloqueados por intentos fallidos */
  await paso("13 · La tarjeta «Usuarios bloqueados» cuenta los bloqueos por intentos fallidos", async () => {
    const tarjeta = async () => (await ok("demo.admin", "GET", "/me/bandeja")).find((i) => i.clave === "usuarios_bloqueados")?.cantidad ?? 0;
    const antes = await tarjeta();
    for (let i = 0; i < 5; i++) await login("demo.muestreo", `clave-erronea-${i}`).catch(() => null);
    const bloqueado = await login("demo.muestreo").then(() => false).catch((e) => e.status === 401);
    afirmar(bloqueado, "demo.muestreo no quedó bloqueado tras 5 intentos fallidos");
    const durante = await tarjeta();
    afirmar(durante === antes + 1, `tarjeta ${antes} → ${durante}`);
    const u = lista(await ok("demo.admin", "GET", "/usuarios")).find((x) => x.username === "demo.muestreo");
    afirmar(u?.bloqueado && /intentos/.test(u.motivoBloqueo ?? ""), "la lista de usuarios no lo marca bloqueado");
    await exigir(403, "demo.ventas", "POST", `/usuarios/${u.id}/desbloquear`, {});
    await ok("demo.admin", "POST", `/usuarios/${u.id}/desbloquear`, {});
    const despues = await tarjeta();
    await login("demo.muestreo");
    afirmar(despues === antes, `tras desbloquear la tarjeta vale ${despues}`);
    C.muestreoId = u.id;
    return `${antes} → ${durante} → ${despues}; vuelve a entrar`;
  });

  /* ---------------- 14 · Firma de cualquier usuario activo */
  await paso("14 · El administrador carga la firma de un usuario activo sin firma; otros perfiles no", async () => {
    const id = C.muestreoId;
    const antes = await ok("demo.admin", "GET", `/mi-firma/usuario/${id}`);
    await exigir(403, "demo.ventas", "PUT", `/mi-firma/usuario/${id}`, { imagen: PNG_1x1 });
    const r = await ok("demo.admin", "PUT", `/mi-firma/usuario/${id}`, { imagen: PNG_1x1 });
    afirmar(r.tieneImagen, "no quedó registrada");
    const inactivo = lista(await ok("demo.admin", "GET", "/usuarios?activo=false"))[0];
    if (inactivo) await exigir(400, "demo.admin", "PUT", `/mi-firma/usuario/${inactivo.id}`, { imagen: PNG_1x1 });
    return `demo.muestreo: ${antes.tieneImagen ? "tenía" : "no tenía"} firma → registrada${inactivo ? `; inactivo ${inactivo.username} rechazado (400)` : ""}`;
  });

  /* ---------------- 8 · OPI */
  await paso("8 · Registrar OPI: Recepción no tiene el permiso (la pantalla oculta el recuadro)", async () => {
    await exigir(403, "demo.recepcion", "POST", `/ot/${C.otS.id}/registrar-opi`, { numero: "OPI-1", fecha: new Date().toISOString().slice(0, 10) });
  });
}

main()
  .then(() => {
    console.log(`\nCorrecciones verificadas: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
