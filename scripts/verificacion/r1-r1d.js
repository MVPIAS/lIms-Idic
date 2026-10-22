#!/usr/bin/env node
/**
 * Verificación del frente r1d (entrega R1): recepción y custodia de la muestra,
 * equipo usado en la captura y peticiones del LME del 20-10-2026, de punta a
 * punta contra una API real, con los perfiles demo.*. Cada regla con un perfil
 * que puede y otro que no:
 *   1. Bandeja de entrada del laboratorio (origen, producto, plazo) por alcance.
 *   2. Recepción e identificación de la muestra en el LME: producto (matriz)
 *      obligatorio, toma «Sucursal Santiago», cliente del maestro, condición,
 *      sellos verificados, tipo de muestra y verificaciones obligatorias.
 *   3. Nº de muestra interno: correlativo, una sola vez, por alcance.
 *   4. Registro fotográfico de la recepción (quien recepciona, sin emitir).
 *   5. Custodia: testigo con plazo de retención; muestra en custodia no se
 *      destruye; la cadena respeta el alcance.
 *   6. Equipo usado en la captura: obligatorio en el método marcado, bloqueo
 *      por calibración vencida, equipo de otro laboratorio rechazado.
 *   7. Informes del LME: tabla de 5 columnas, informe interno, cliente externo
 *      (IDIC-PG09 Anexo 02-02 rev05) con fecha del análisis y termograma.
 *   8. Circuito del LME: Jefe de Laboratorio → Jefe de Sección → Jefe DQO, sin
 *      Gestión de Calidad, firmado en orden hasta quedar oficial.
 *   9. Ruta de la OT: el siguiente paso de la recepción.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r1-r1d.js [--arrancar] [--base http://localhost:4741/api]
 * Contraseña: CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA. Deja datos de prueba
 * (una OT del LME con sus muestras, dos equipos EQ-R1D-*) y deja el método como
 * estaba («exige equipo» vuelve a su valor). Úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4741/api");
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
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: CLAVE }),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
    const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
    sesiones[username] = { token: j.accessToken, id: carga.sub, permisos: carga.permisos ?? [] };
    return sesiones[username];
  }
  throw new Error(`login ${username}: demasiados intentos`);
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const esForm = cuerpo instanceof FormData;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}) },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
    return { status: r.status, json };
  }
  throw new Error(`${username} ${metodo} ${ruta}: demasiadas peticiones (429)`);
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 400);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
async function rechazo(esperado, re, u, m, ruta, c) {
  const j = await exigir(esperado, u, m, ruta, c);
  if (re && !re.test(msg(j))) throw new Error(`${u} ${m} ${ruta}: el mensaje no explica el motivo (${msg(j)})`);
  return msg(j);
}
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

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
function afirmar(cond, texto) { if (!cond) throw new Error(texto); }

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
  const puerto = new URL(BASE).port || "4741";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1d-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function formFoto(campos = {}) {
  const f = new FormData();
  f.append("archivo", new Blob([PNG_1x1], { type: "image/png" }), "foto.png");
  for (const [k, v] of Object.entries(campos)) f.append(k, String(v));
  return f;
}
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const masDias = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ============================================================ RECORRIDO === */
const U = {
  jefe: "demo.lme.jefe",
  a1: "demo.lme.analista1",
  a2: "demo.lme.analista2",
  rev: "demo.lme.revisor",
  squ: "demo.squ.jefe",
  dqo: "demo.dqo.jefe",
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  ventas: "demo.ventas",
  calidad: "demo.calidad",
  otroLab: "demo.lqc.jefe",
  otroAnalista: "demo.lqc.analista1",
};

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  /* ---------------------------------------------------------- 0. La OT */
  await paso("Planificación abre una OT del LME (sin cotización, sin cobro)", async () => {
    const labs = await ok(U.planif, "GET", "/ot/laboratorios");
    C.lme = labs.find((u) => u.codigo === "LME");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    afirmar(C.lme && C.lqc, "LME o LQC no figuran entre los laboratorios");
    const cl = lista(await ok(U.planif, "GET", "/clientes?limit=5"));
    afirmar(cl.length >= 1, "no hay clientes");
    C.cliente = cl[0];
    C.otroCliente = cl[1] ?? null;
    C.ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id,
      unidadPrincipalId: C.lme.id,
      conCobro: false,
      descripcionTrabajo: `Verificación r1d ${sello}: nitrato de amonio, condición de control BPCH`,
    });
    afirmar(C.ot.unidadPrincipal === C.lme.id, "la OT no quedó en el LME");
    return C.ot.codigo;
  });

  await paso("Ruta de la OT · Recepción: el siguiente paso nombra lo que se registra al recibir", async () => {
    const a = await ok(U.jefe, "GET", `/ot/${C.ot.id}/avance`);
    afirmar(a.etapaActual === "recepcion", `etapa ${a.etapaActual}`);
    afirmar(/producto, condición de recepción, Nº interno/.test(a.siguiente?.texto ?? ""), `siguiente: ${a.siguiente?.texto}`);
    return a.siguiente.texto;
  });

  /* ---------------------------------------------------------- 1. Bandeja */
  await paso("1 · Bandeja de entrada: el LME ve la OT por recepcionar (origen DCO); el LQC no; Ventas sin muestra.crear → 403", async () => {
    const b = await ok(U.jefe, "GET", "/recepcion/bandeja");
    const f = lista(b).find((x) => x.ot?.id === C.ot.id);
    afirmar(f, "la OT no está en la bandeja del LME");
    afirmar(f.origen === "DCO" && f.estado === "Por recepcionar" && f.laboratorio === "LME", JSON.stringify(f).slice(0, 200));
    afirmar(f.ruta === `/ot/${C.ot.id}?tab=muestras`, `ruta ${f.ruta}`);
    const otro = await ok(U.otroLab, "GET", "/recepcion/bandeja");
    afirmar(!lista(otro).some((x) => x.ot?.id === C.ot.id), "el jefe del LQC ve la OT del LME en su bandeja");
    afirmar(lista(otro).every((x) => x.laboratorio === "LQC"), "el LQC ve filas de otros laboratorios");
    await exigir(403, U.ventas, "GET", "/recepcion/bandeja");
    return `${b.meta.total} fila(s) · ${JSON.stringify(b.meta.porOrigen)}`;
  });

  /* ---------------------------------------------------------- 2. Recepción */
  await paso("2 · Configuración de la recepción del LME: producto obligatorio, campos propios y «Sucursal Santiago»", async () => {
    const p = await ok(U.a1, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    C.cfg = p.configRecepcion;
    afirmar(C.cfg.productoObligatorio === true, "el LME no exige el producto");
    const cods = C.cfg.campos.map((c) => c.codigo);
    for (const c of ["clase_custodia", "verif_especificacion", "verif_ot", "verif_formulario_muestreo", "fabricante", "lote", "ubicacion"])
      afirmar(cods.includes(c), `falta el campo ${c}`);
    afirmar((p.opcionesToma ?? []).some((o) => o.codigo === "sucursal_santiago" && o.etiqueta === "Sucursal Santiago"), "falta la toma «Sucursal Santiago»");
    return cods.join(", ");
  });

  await paso("2 · Productos del LME (nitrocelulosa, aluminio, nitrato de amonio, hexamina) y su panel", async () => {
    const r = await ok(U.a1, "GET", `/recepcion/ot/${C.ot.id}/productos`);
    const nombres = r.productos.map((x) => x.nombre);
    for (const n of ["Nitrocelulosa", "Aluminio", "Nitrato de amonio", "Nitrato de hexamina"]) afirmar(nombres.includes(n), `falta el producto ${n}`);
    C.producto = r.productos.find((x) => x.nombre === "Nitrato de amonio");
    const b = await ok(U.a1, "GET", `/recepcion/ot/${C.ot.id}/productos?search=nitrocel`);
    afirmar(Array.isArray(b.encontrados), "la búsqueda en el catálogo no responde");
    const panel = await ok(U.a1, "GET", `/recepcion/ot/${C.ot.id}/productos/${C.producto.id}/panel`);
    const porNombre = (n) => panel.metodos.find((m) => m.nombre.toLowerCase() === n.toLowerCase() && m.analitos > 0);
    C.mNitritos = porNombre("Contenidos de nitritos");
    C.mPureza = porNombre("Pureza");
    C.mHumedad = porNombre("Humedad");
    afirmar(C.mNitritos && C.mPureza && C.mHumedad, `el panel no trae nitritos, pureza y humedad: ${panel.metodos.map((m) => m.nombre).join(", ")}`);
    await exigir(403, U.otroLab, "GET", `/recepcion/ot/${C.ot.id}/productos`);
    return `${r.productos.length} productos · panel de ${panel.metodos.length} métodos`;
  });

  const recepcionLme = (extra = {}) => ({
    tomaMuestra: "sucursal_santiago",
    condicionRecepcion: "cumple",
    selloNumero: "S-R1D-01, S-R1D-02",
    sellosVerificados: true,
    identificacionCliente: "Saco Nº 1",
    claseCustodia: "testigo",
    ubicacion: "Bodega",
    datos: { fabricante: "Fabricante de prueba", lote: `L-${sello}`, cantidad_recibida: "100 g", verif_especificacion: true, verif_ot: true, verif_formulario_muestreo: true },
    ...extra,
  });
  const cuerpo = (rec, conProducto = true, nombre = "Nitrato de amonio · muestra testigo") => ({
    muestras: [{ nombre, ...(conProducto ? { catElementoId: C.producto.id } : {}), metodoIds: [C.mNitritos.id, C.mPureza.id, C.mHumedad.id], recepcion: rec }],
  });

  await paso("2 · Reglas de la recepción del LME → 400 (producto, tipo de muestra, verificaciones, opción fuera de lista)", async () => {
    await rechazo(400, /producto \(matriz\)/, U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme(), false));
    await rechazo(400, /Tipo de muestra/, U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme({ claseCustodia: null })));
    await rechazo(400, /Verificada contra la O\/T/, U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`,
      cuerpo(recepcionLme({ datos: { verif_especificacion: true, verif_formulario_muestreo: true } })));
    await rechazo(400, /no es una de las opciones/, U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme({ ubicacion: "Pasillo" })));
    await rechazo(400, /no está definido/, U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`,
      cuerpo(recepcionLme({ datos: { ...recepcionLme().datos, color: "rojo" } })));
    await rechazo(400, /sellos que verificó/, U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme({ selloNumero: null })));
    await rechazo(400, /qué se encontró/, U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme({ condicionRecepcion: "no_cumple" })));
    return "7 rechazos con su motivo";
  });

  await paso("2 · Ventas (sin muestra.crear) y el jefe del LQC (otro laboratorio) no recepcionan → 403", async () => {
    await exigir(403, U.ventas, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme()));
    await exigir(403, U.otroLab, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme()));
  });

  await paso("2 · El analista del LME recepciona: muestra testigo con cliente del maestro y otra de análisis", async () => {
    const extraCliente = C.otroCliente ? { clienteId: C.otroCliente.id } : {};
    const r1 = await ok(U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`, cuerpo(recepcionLme(extraCliente)));
    const r2 = await ok(U.a1, "POST", `/flujo/ot/${C.ot.id}/muestras`,
      cuerpo(recepcionLme({ claseCustodia: "analisis", ubicacion: "Sala de preparación", selloNumero: null, sellosVerificados: null }), true, "Nitrato de amonio · muestra de análisis"));
    C.mTestigo = r1.muestras[0];
    C.mAnalisis = r2.muestras[0];
    const p = await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const t = p.muestras.find((m) => m.id === C.mTestigo.id);
    afirmar(t.productoNombre === "Nitrato de Amonio" && t.catElementoId === C.producto.id, `producto ${t.productoNombre}`);
    afirmar(t.tomaMuestra === "sucursal_santiago" && t.condicionRecepcion === "cumple" && t.sellosVerificados === true, "toma, condición o sellos");
    afirmar(t.claseCustodia === "testigo" && t.ubicacion === "Bodega", `destino ${t.claseCustodia} · ${t.ubicacion}`);
    afirmar(t.datos?.fabricante === "Fabricante de prueba" && t.datos?.verif_ot === true, `datos ${JSON.stringify(t.datos)}`);
    afirmar(t.retenerHasta && t.retenerHasta > hoy(), `retener hasta ${t.retenerHasta}`);
    if (C.otroCliente) afirmar(t.clienteId === C.otroCliente.id, "el cliente de la muestra no quedó");
    afirmar(!t.recepcionIncompleta && (t.faltantesRecepcion ?? []).length === 0, `incompleta: ${(t.faltantesRecepcion ?? []).join(", ")}`);
    C.retenerHasta = t.retenerHasta;
    return `${C.mTestigo.codigo} (testigo hasta ${t.retenerHasta}) · ${C.mAnalisis.codigo} · ${r1.ensayos + r2.ensayos} ensayos`;
  });

  await paso("2 · Corregir la recepción queda en el historial; el LQC no puede corregirla (403)", async () => {
    await exigir(403, U.otroLab, "PATCH", `/flujo/muestras/${C.mAnalisis.id}/recepcion`, recepcionLme({ claseCustodia: "custodia" }));
    await ok(U.jefe, "PATCH", `/flujo/muestras/${C.mAnalisis.id}/recepcion`,
      recepcionLme({ claseCustodia: "custodia", ubicacion: "Bodega", selloNumero: null, sellosVerificados: null }));
    const hist = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    const h = hist.find((x) => x.tipo === "recepcion_muestra");
    afirmar(h && JSON.stringify(h.detalle).includes("custodia"), "la corrección no quedó en el historial con lo nuevo");
    return "análisis → en custodia";
  });

  /* ---------------------------------------------------------- 3. Nº interno */
  await paso("3 · Nº de muestra interno: el analista lo asigna; no se cambia (409); el LQC no (403)", async () => {
    await exigir(403, U.otroLab, "POST", `/recepcion/muestras/${C.mTestigo.id}/numero`);
    await exigir(403, U.ventas, "POST", `/recepcion/muestras/${C.mTestigo.id}/numero`);
    const n1 = await ok(U.a1, "POST", `/recepcion/muestras/${C.mTestigo.id}/numero`);
    await rechazo(409, /no se cambia/, U.a1, "POST", `/recepcion/muestras/${C.mTestigo.id}/numero`);
    const n2 = await ok(U.jefe, "POST", `/recepcion/ot/${C.ot.id}/numeros`);
    afirmar(n2.asignados.length === 1 && n2.asignados[0].muestraId === C.mAnalisis.id, `asignados ${JSON.stringify(n2.asignados)}`);
    afirmar(BigInt(n2.asignados[0].numeroInterno) === BigInt(n1.numeroInterno) + 1n, `correlativo ${n1.numeroInterno} → ${n2.asignados[0].numeroInterno}`);
    const hist = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    afirmar(hist.some((x) => x.tipo === "numero_muestra"), "la asignación no quedó en el historial");
    C.numeroTestigo = n1.numeroInterno;
    return `Nº ${n1.numeroInterno} y ${n2.asignados[0].numeroInterno}`;
  });

  /* ---------------------------------------------------------- 4. Fotos */
  await paso("4 · Registro fotográfico: Recepción sube la foto de la muestra; no una del anexo (403) ni sin muestra (400)", async () => {
    await exigir(403, U.ventas, "POST", `/informes/ot/${C.ot.id}/fotos`, formFoto({ tipo: "recepcion", muestraId: C.mTestigo.id }));
    await exigir(403, U.recepcion, "POST", `/informes/ot/${C.ot.id}/fotos`, formFoto({ tipo: "anexo", pie: "x" }));
    await rechazo(400, /muestra/, U.recepcion, "POST", `/informes/ot/${C.ot.id}/fotos`, formFoto({ tipo: "recepcion" }));
    const f = await ok(U.recepcion, "POST", `/informes/ot/${C.ot.id}/fotos`, formFoto({ tipo: "recepcion", muestraId: C.mTestigo.id, pie: "Saco con sellos" }));
    C.fotoRecepcion = f.id;
    const fs1 = await ok(U.recepcion, "GET", `/informes/ot/${C.ot.id}/fotos`);
    afirmar(fs1.length >= 1 && fs1.every((x) => x.tipo === "recepcion"), "Recepción ve fotos que no son de la recepción");
    const nueva = fs1.find((x) => x.id === f.id);
    afirmar(nueva && nueva.enInforme === false, "la foto de recepción quedó marcada para el informe");
    return `foto ${f.id.slice(0, 8)} · no va al informe salvo que se marque`;
  });

  /* ---------------------------------------------------------- 5. Custodia */
  await paso("5 · Custodia: el testigo no se destruye antes de su plazo; la muestra en custodia no se destruye (409)", async () => {
    await rechazo(409, /debe conservarse hasta/, U.jefe, "POST", "/custodia", { muestraId: C.mTestigo.id, evento: "destruccion", motivo: "Fin del análisis" });
    await rechazo(409, /se devuelve/, U.jefe, "POST", "/custodia", { muestraId: C.mAnalisis.id, evento: "destruccion", motivo: "Fin del análisis" });
    await ok(U.jefe, "POST", "/custodia", { muestraId: C.mTestigo.id, evento: "almacenamiento", motivo: "Testigo a bodega", ubicacionDestino: "Bodega externa" });
    return `retención hasta ${C.retenerHasta}`;
  });

  await paso("5 · La cadena de custodia respeta el alcance: el LQC no la ve ni registra traspasos (403)", async () => {
    await exigir(403, U.otroLab, "GET", `/custodia?muestraId=${C.mTestigo.id}`);
    await exigir(403, U.otroLab, "POST", "/custodia", { muestraId: C.mTestigo.id, evento: "traslado", motivo: "x" });
    const cad = await ok(U.jefe, "GET", `/custodia?muestraId=${C.mTestigo.id}`);
    afirmar(lista(cad).length >= 1, "la cadena no tiene el traspaso");
    const rec = lista(await ok(U.otroLab, "GET", "/custodia?limit=200"));
    afirmar(!rec.some((x) => x.muestra_id === C.mTestigo.id), "el LQC ve traspasos de muestras del LME");
    return `${lista(cad).length} eslabón(es)`;
  });

  await paso("5 · Retenciones: el LME ve su testigo y su muestra en custodia; el LQC no", async () => {
    const r = await ok(U.jefe, "GET", "/recepcion/retenciones");
    const t = lista(r).find((x) => x.id === C.mTestigo.id);
    const c = lista(r).find((x) => x.id === C.mAnalisis.id);
    afirmar(t && t.estado === "vigente" && t.claseCustodia === "testigo", `testigo ${JSON.stringify(t)}`);
    afirmar(c && c.estado === "sin_plazo" && c.claseCustodia === "custodia", `custodia ${JSON.stringify(c)}`);
    const o = await ok(U.otroLab, "GET", "/recepcion/retenciones");
    afirmar(!lista(o).some((x) => x.id === C.mTestigo.id), "el LQC ve los testigos del LME");
    return `testigo vigente · custodia sin plazo`;
  });

  /* ---------------------------------------------------------- 6. Equipo */
  await paso("6 · Equipos del LME: uno vigente y uno con la calibración vencida", async () => {
    const asegurar = async (codigo, nombre, proxima) => {
      const ex = lista(await ok(U.jefe, "GET", `/equipos?search=${codigo}`)).find((e) => e.codigo === codigo);
      if (ex) return ex;
      return ok(U.jefe, "POST", "/equipos", { codigo, nombre, unidadId: C.lme.id, estado: "operativo", proximaCalibracion: proxima });
    };
    C.eqOk = await asegurar("EQ-R1D-BAL", "Balanza analítica (verificación r1d)", masDias(365));
    C.eqVencido = await asegurar("EQ-R1D-EST", "Estufa (verificación r1d)", masDias(-20));
    await exigir(403, U.otroLab, "PATCH", `/equipos/${C.eqOk.id}`, { nombre: C.eqOk.nombre });
    const lqc = lista(await ok(U.otroLab, "GET", "/equipos?limit=200"));
    C.eqLqc = lqc.find((e) => e.unidad_id === C.lqc.id);
    afirmar(C.eqLqc, "el LQC no tiene equipos de ejemplo");
    const r = await ok(U.a1, "GET", `/flujo/ot/${C.ot.id}/equipos`);
    const ok1 = r.equipos.find((e) => e.id === C.eqOk.id);
    const ven = r.equipos.find((e) => e.id === C.eqVencido.id);
    afirmar(ok1?.apto === true && ven?.apto === false && /vencida/.test(ven?.motivo ?? ""), JSON.stringify(r.equipos).slice(0, 300));
    afirmar(!r.equipos.some((e) => e.id === C.eqLqc.id), "se ofrece un equipo del LQC en la captura del LME");
    await exigir(403, U.ventas, "GET", `/flujo/ot/${C.ot.id}/equipos`);
    return `${r.equipos.length} equipos · modo ${r.modo}`;
  });

  await paso("6 · Calidad marca «exige equipo» en el método de nitritos; el analista no puede (403)", async () => {
    const m = await ok(U.calidad, "GET", `/cat/metodos/${C.mNitritos.id}`);
    C.equipoRequeridoAntes = !!m.equipoRequerido;
    await exigir(403, U.a1, "PATCH", `/cat/metodos/${C.mNitritos.id}`, { equipoRequerido: true });
    const r = await ok(U.calidad, "PATCH", `/cat/metodos/${C.mNitritos.id}`, { equipoRequerido: true });
    afirmar(r.equipoRequerido === true, "no quedó marcado");
    const rs = (await ok(U.a1, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.rs = rs;
    const nit = rs.filter((x) => x.catMetodoId === C.mNitritos.id);
    afirmar(nit.length === 2 && nit.every((x) => x.equipoRequerido === true), "los ensayos de nitritos no exigen equipo");
    afirmar(rs.filter((x) => x.catMetodoId !== C.mNitritos.id).every((x) => x.equipoRequerido === false), "otros ensayos exigen equipo");
    return `${nit.length} ensayos de nitritos exigen equipo`;
  });

  try {
    await paso("6 · Captura: sin equipo (400), con equipo vencido (409), de otro laboratorio (400), HR fuera de rango (400)", async () => {
      const r = C.rs.find((x) => x.catMetodoId === C.mNitritos.id && x.muestraId === C.mTestigo.id);
      C.rNitritos = r;
      await rechazo(400, /equipo/, U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "0,00" });
      await rechazo(409, /[Cc]alibración vencida/, U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "0,00", equipoId: C.eqVencido.id });
      await rechazo(400, /no es del laboratorio/, U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "0,00", equipoId: C.eqLqc.id });
      await rechazo(400, /humedad/i, U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "0,00", equipoId: C.eqOk.id, humedad: 140 });
      await rechazo(400, /futura/, U.a1, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "0,00", equipoId: C.eqOk.id, fechaEnsayo: new Date(Date.now() + 86400000).toISOString() });
      await exigir(403, U.otroAnalista, "POST", `/flujo/resultado/${r.id}/valor`, { valor: "0,00", equipoId: C.eqOk.id });
    });

    await paso("6 · Captura con el equipo apto y las condiciones del ensayo", async () => {
      const ayer = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
      for (const r of C.rs) {
        const conEquipo = r.catMetodoId === C.mNitritos.id;
        const valor = r.catMetodoId === C.mNitritos.id ? "0,00" : r.catMetodoId === C.mPureza.id ? "97,75" : "0,05";
        const c = await ok(U.a1, "POST", `/flujo/resultado/${r.id}/valor`, {
          valor, ...(conEquipo ? { equipoId: C.eqOk.id, fechaEnsayo: ayer, temperatura: 21.5, humedad: 45, incertidumbre: "± 0,01 mg/L" } : { fechaEnsayo: ayer }),
        });
        afirmar(c.estado === "capturado", `estado ${c.estado}`);
        if (conEquipo) afirmar(c.equipoId === C.eqOk.id && Number(c.humedad) === 45 && c.fechaEnsayo, "no quedó el equipo o las condiciones");
      }
      const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
      const nit = rs.find((x) => x.id === C.rNitritos.id);
      afirmar(nit.equipo?.codigo === "EQ-R1D-BAL", `equipo ${JSON.stringify(nit.equipo)}`);
      return `${rs.length} ensayos capturados · nitritos con ${nit.equipo.codigo}`;
    });
  } finally {
    // El método vuelve a como estaba: los demás recorridos no exigen equipo.
    await llamar(U.calidad, "PATCH", `/cat/metodos/${C.mNitritos.id}`, { equipoRequerido: C.equipoRequeridoAntes ?? false });
  }

  await paso("6 · Revisión y aprobación (segregación: revisa el revisor, aprueba el jefe)", async () => {
    await ok(U.rev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    await ok(U.jefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    afirmar(rs.every((x) => x.estado === "aprobado"), `estados ${rs.map((x) => x.estado).join(",")}`);
    return `${rs.length} aprobados`;
  });

  /* ---------------------------------------------------------- 7. Informes */
  await paso("7 · Plantillas del LME sembradas con su formato", async () => {
    const pl = lista(await ok(U.jefe, "GET", "/plantillas?limit=300"));
    C.pIt03 = pl.find((p) => p.repid === "LME-IT03");
    C.pInt = pl.find((p) => p.repid === "LME-INT");
    C.pExt = pl.find((p) => p.repid === "PG09A2-LME");
    afirmar(C.pIt03 && C.pInt && C.pExt, "faltan plantillas del LME");
    const f = await ok(U.calidad, "GET", `/informes/plantillas/${C.pIt03.id}/formato`);
    afirmar(f.efectivo.columnasRequisito === "min_max" && f.efectivo.textoSinCota === "-.-" && f.efectivo.unidadEnResultado === true, JSON.stringify(f.efectivo).slice(0, 200));
    await exigir(403, U.a1, "PUT", `/informes/plantillas/${C.pIt03.id}/formato`, { formato: f.guardado });
    await ok(U.calidad, "PUT", `/informes/plantillas/${C.pIt03.id}/formato`, { formato: f.guardado });
    return "LME-IT03 · LME-INT · PG09A2-LME";
  });

  await paso("7 · Termograma: el analista lo adjunta a la OT (no va al anexo fotográfico)", async () => {
    const f = await ok(U.a1, "POST", `/informes/ot/${C.ot.id}/fotos`, formFoto({ tipo: "termograma", muestraId: C.mTestigo.id, pie: "DSC nitrato de amonio" }));
    afirmar(f.tipo === "termograma", `tipo ${f.tipo}`);
  });

  const previa = async (plantilla) => {
    const r = await ok(U.jefe, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: plantilla.id, modalidad: "cumplimiento" });
    afirmar(typeof r.html === "string" && r.html.length > 200, "previsualización vacía");
    return r.html;
  };
  const cabeceras = (html) => [...html.matchAll(/<table class="rep"><thead><tr>(.*?)<\/tr><\/thead>/g)].map((m) => [...m[1].matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((x) => x[1]));

  await paso("7 · Informe LIMS del LME: Análisis · Mínimo · Máximo · Resultado (unidad) · Condición, con «-.-»", async () => {
    const html = await previa(C.pIt03);
    const cab = cabeceras(html)[0];
    afirmar(JSON.stringify(cab) === JSON.stringify(["Análisis", "Mínimo", "Máximo", "Resultado", "Condición"]), `cabecera ${JSON.stringify(cab)}`);
    afirmar(html.includes("-.-"), "las cotas vacías no salen como «-.-»");
    afirmar(/0 mg\/L|0,00 mg\/L/.test(html), "la unidad no va junto al resultado");
    afirmar(html.includes(`Nº ${C.numeroTestigo}`) && html.includes("Fabricante de prueba"), "la identificación no trae el Nº interno o los datos de recepción");
    return cab.join(" · ");
  });

  await paso("7 · Informe interno del LME: Muestra · Ensayo · Requisito · Resultado · Condición (una tabla)", async () => {
    const html = await previa(C.pInt);
    const cabs = cabeceras(html);
    afirmar(cabs.length === 1, `${cabs.length} tablas de resultados`);
    afirmar(JSON.stringify(cabs[0]) === JSON.stringify(["Muestra", "Ensayo", "Requisito", "Resultado", "Condición"]), `cabecera ${JSON.stringify(cabs[0])}`);
    afirmar(html.includes(C.mTestigo.codigo) && html.includes(C.mAnalisis.codigo), "faltan muestras en la tabla única");
    return cabs[0].join(" · ");
  });

  await paso("7 · Informe para cliente externo (IDIC-PG09 Anexo 02-02 rev05): normas y métodos con la fecha del análisis y termograma", async () => {
    const html = await previa(C.pExt);
    for (const t of ["1. Antecedentes", "2. Identificación de la muestra", "3.1. Normas y métodos", "4. Resultados", "5. Conclusiones", "6. Notas aclaratorias"])
      afirmar(html.includes(t), `falta «${t}»`);
    afirmar(html.includes("<th>Fecha del análisis</th>") && /\d{2}\.[A-Z]{3}\.\d{2} \(\d{2}:\d{2}\)/.test(html), "la tabla de métodos no trae la fecha y hora del análisis");
    afirmar(html.includes("Termograma 1") && html.includes("DSC nitrato de amonio"), "falta el termograma");
    afirmar(!html.includes("<h2>Conclusión</h2>"), "título de conclusión duplicado bajo el punto 5");
    afirmar(!/Anexo fotográfico[\s\S]*DSC nitrato de amonio/.test(html), "el termograma salió en el anexo fotográfico");
    return "6 secciones · fecha del análisis · termograma";
  });

  /* ---------------------------------------------------------- 8. Circuito */
  await paso("8 · Circuito del LME: Jefe de Laboratorio → Jefe de Sección → Jefe DQO, sin Gestión de Calidad", async () => {
    const cond = await ok(U.jefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: C.pExt.id });
    afirmar(cond.puedeEmitir, `no se puede emitir: ${(cond.faltantes ?? []).join(" | ")}`);
    const roles = cond.pasos.map((p) => `${p.orden}:${p.rolCodigo}`);
    afirmar(JSON.stringify(roles) === JSON.stringify(["1:JEFE_LAB", "2:JEFE_SECCION", "3:JEFE_DEPTO"]), `circuito ${roles.join(" → ")}`);
    afirmar(!cond.pasos.some((p) => p.rolCodigo === "CALIDAD"), "firma Gestión de Calidad");
    return cond.pasos.map((p) => `${p.orden} ${p.rolNombre}`).join(" → ");
  });

  await paso("8 · Se emite y se firma en orden; fuera de turno → 403; queda oficial", async () => {
    await exigir(403, U.a1, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.pExt.id });
    const r = await ok(U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.pExt.id, modalidad: "cumplimiento" });
    const doc = r.certificado ?? r.documento ?? r;
    C.docId = doc.id ?? r.certificadoId ?? r.id;
    const orden = [U.jefe, U.squ, U.dqo];
    await exigir(403, U.dqo, "POST", `/informes/${C.docId}/firmar`, {});
    await exigir(403, U.squ, "POST", `/informes/${C.docId}/firmar`, {});
    await ok(U.jefe, "POST", `/informes/${C.docId}/firmar`, {});
    await exigir(403, U.dqo, "POST", `/informes/${C.docId}/firmar`, {});
    await ok(U.squ, "POST", `/informes/${C.docId}/firmar`, {});
    await ok(U.dqo, "POST", `/informes/${C.docId}/firmar`, {});
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    const estado = circ.documento?.estado ?? circ.estado;
    afirmar(estado === "oficial", `estado ${estado}`);
    return `${circ.documento?.numero ?? circ.numero ?? C.docId} oficial · firmaron ${orden.map((u) => u.replace("demo.", "")).join(" → ")}`;
  });

  console.log(`\n${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
}

main()
  .then(() => { pararApi(); process.exit(0); })
  .catch((e) => {
    console.error(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
