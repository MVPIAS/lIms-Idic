#!/usr/bin/env node
/**
 * Verificación del frente K (huecos de pantalla destapados al redactar los
 * manuales v1.2) contra una API real. Cada regla con un perfil que puede y otro
 * que no:
 *   1. Órdenes internas: crear (destino + ensayos del destino), ver por alcance,
 *      editar mientras está abierta, avanzar estado, anular con motivo, borrar.
 *   2. Porcentajes de la tasa de internación (bpch_tasa): ver, cambiar con
 *      validación, motivo e historial; solo catalogo.gestionar.
 *   3. Fotos del anexo: el analista las sube desde su OT sin emitir informes.
 *   4. Formato de las plantillas: Gestión de Calidad sin emisión de informes.
 *   6. Internación: «Registrar OT» ya no admite el origen Internación.
 *   7. Matriz de firmas: responsable alternativo del paso de emisión del
 *      Certificado de Calibración, que se quita y repone sin tocar código.
 *   8. demo.lqc.planificador: ot.crear con alcance de un solo laboratorio.
 * (El 5 lo recorre bpch-produccion-prototipos-clasificacion.js, paso B4b, y el 7
 * completo metrologia-1510.js.)
 *
 * Uso:
 *   node scripts/verificacion/frente-k.js [--arrancar] [--base http://localhost:4251/api]
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA.
 * Deja datos de prueba (órdenes internas, una foto borrada) y deja los porcentajes y
 * la matriz como estaban. Úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4251/api");
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
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: CLAVE }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
  sesiones[username] = { token: j.accessToken, permisos: carga.permisos ?? [] };
  return sesiones[username];
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const esForm = cuerpo instanceof FormData;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}) },
    body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
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
async function esperarApi(ms = 60000) {
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
  const puerto = new URL(BASE).port || "4251";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-frente-k-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function formFoto(buf, nombre, campos = {}) {
  const f = new FormData();
  f.append("archivo", new Blob([buf], { type: "image/png" }), nombre);
  for (const [k, v] of Object.entries(campos)) f.append(k, String(v));
  return f;
}

/* ============================================================ RECORRIDO === */
const U = {
  planLqc: "demo.lqc.planificador", // ot.crear con alcance SOLO de LQC (encargo 8)
  planif: "demo.planificacion",     // Planificación y Control (global)
  admin: "demo.admin",
  calidad: "demo.calidad",          // catalogo.gestionar y plantilla.gestionar, sin emitir informes
  ventas: "demo.ventas",
  lqcA1: "demo.lqc.analista1",
  lpnA1: "demo.lpn.analista1",
  lccJefe: "demo.lcc.jefe",         // laboratorio de destino de la orden interna
  lpnJefe: "demo.lpn.jefe",
};

async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};

  /* ---------------------------------------------- 8 · perfil de un laboratorio */
  await paso("8 · demo.lqc.planificador: tiene ot.crear y solo ve OT de LQC", async () => {
    const s = await login(U.planLqc);
    afirmar(s.permisos.includes("ot.crear") && s.permisos.includes("ot.ver"), `permisos ${s.permisos.join(",")}`);
    const r = await ok(U.planLqc, "GET", "/ot?limit=100");
    afirmar(r.data.length > 0, "no ve ninguna OT de LQC");
    const ajenas = r.data.filter((o) => o.unidad?.codigo !== "LQC");
    afirmar(!ajenas.length, `ve OT de otros laboratorios: ${ajenas.map((o) => `${o.codigo}(${o.unidad?.codigo})`).join(", ")}`);
    C.otLqc = r.data.find((o) => !["cerrada", "anulada"].includes(o.estado)) ?? r.data[0];
    const lpn = await ok(U.admin, "GET", "/ot?unidad=LPN&limit=5");
    afirmar(lpn.data.length > 0, "no hay OT de LPN en la base");
    C.otLpn = lpn.data[0];
    await exigir(403, U.planLqc, "GET", `/ot/${C.otLpn.id}`);
    const accesos = await fetch(`${BASE}/auth/accesos-demo`).then((x) => x.json());
    afirmar(accesos.usuarios.some((u) => u.username === U.planLqc && u.grupo === "DQO"), "no sale en la pantalla de ingreso (pestaña Químico)");
    return `${r.data.length} OT, todas de LQC · ${C.otLpn.codigo} (LPN) → 403`;
  });

  await paso("8 · registrar OT: para LQC sí; para otro laboratorio 403 (alcance)", async () => {
    const cli = await ok(U.planLqc, "GET", `/ot/${C.otLqc.id}`);
    const cuerpo = { clienteId: cli.clienteId ?? cli.cliente?.id, notas: "OT de prueba del frente K" };
    const ru = await ok(U.admin, "GET", "/unidades");
    const unidades = Array.isArray(ru) ? ru : ru.data;
    C.uLqc = unidades.find((u) => u.codigo === "LQC");
    C.uLpn = unidades.find((u) => u.codigo === "LPN");
    await exigir(403, U.planLqc, "POST", "/ot", { ...cuerpo, unidadPrincipalId: C.uLpn.id });
    const nueva = await ok(U.planLqc, "POST", "/ot", { ...cuerpo, unidadPrincipalId: C.uLqc.id });
    afirmar(nueva.unidadPrincipal === C.uLqc.id, "la OT no quedó en LQC");
    return `${nueva.codigo} en LQC · LPN → 403`;
  });

  /* ---------------------------------------------------- 1 · órdenes internas */
  await paso("1 · destinos y ensayos: no ofrece el laboratorio responsable; ensayos del destino", async () => {
    const d = await ok(U.planLqc, "GET", `/ordenes-internas/destinos?otId=${C.otLqc.id}`);
    afirmar(d.length > 0 && !d.some((x) => x.unidadCodigo === "LQC"), "ofrece LQC como destino de su propia OT");
    C.destLcc = d.find((x) => x.unidadCodigo === "LCC");
    afirmar(C.destLcc, "LCC no figura como destino");
    const todos = await ok(U.admin, "GET", "/ordenes-internas/destinos");
    C.famLqc = todos.find((x) => x.unidadCodigo === "LQC");
    const e = await ok(U.planLqc, "GET", `/ordenes-internas/destinos/${C.destLcc.id}/ensayos?otId=${C.otLqc.id}`);
    afirmar(e.length >= 2, "LCC no tiene ensayos en el catálogo");
    C.ensLcc = e.slice(0, 2).map((x) => x.id);
    C.ensLqc = (await ok(U.admin, "GET", `/ordenes-internas/destinos/${C.famLqc.id}/ensayos`))[0].id;
    await exigir(403, U.planLqc, "GET", `/ordenes-internas/destinos?otId=${C.otLpn.id}`);
    return `${d.length} destinos · LCC con ${e.length} ensayos`;
  });

  await paso("1 · crear: en OT de LQC sí; en OT de LPN 403; sin orden_interna.emitir 403; destino propio o ensayo ajeno 400", async () => {
    // Desde r1b la emisión exige muestra de origen, requisito y fecha de envío (EP-01 2.2).
    // Se usa una OT abierta de LQC que tenga muestras (la del paso 8 puede ser la recién creada, sin ellas).
    const candidatas = [C.otLqc, ...(await ok(U.planLqc, "GET", "/ot?limit=100")).data.filter((o) => !["cerrada", "anulada"].includes(o.estado))];
    for (const o of candidatas) {
      const reg = await ok(U.admin, "GET", `/flujo/ot/${o.id}/registro-muestras`);
      if ((reg.muestras ?? []).length) { C.otLqc = o; C.mLqc = reg.muestras[0]; break; }
    }
    afirmar(C.mLqc, "no hay OT abierta de LQC con muestras");
    C.emision = { muestraId: C.mLqc.id, requisito: "Cr total según E.T. (frente K)", fechaEnvio: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" }) };
    const cuerpo = { otId: C.otLqc.id, destinoLab: C.destLcc.id, ensayos: C.ensLcc, detalle: "Cromo en cuero (frente K)", ...C.emision };
    await exigir(403, U.planLqc, "POST", "/ordenes-internas", { ...cuerpo, otId: C.otLpn.id });
    // El analista sí emite desde r1b (orden_interna.emitir, EP-01 2.2); Calidad no.
    await exigir(403, U.calidad, "POST", "/ordenes-internas", cuerpo);
    await rechazo(400, /OTRO laboratorio/, U.planLqc, "POST", "/ordenes-internas", { ...cuerpo, destinoLab: C.famLqc.id, ensayos: [] });
    await rechazo(400, /no son del laboratorio de destino/, U.planLqc, "POST", "/ordenes-internas", { ...cuerpo, ensayos: [C.ensLcc[0], C.ensLqc] });
    C.oi = await ok(U.planLqc, "POST", "/ordenes-internas", cuerpo);
    afirmar(/^OI-\d{4}-\d{4,}$/.test(C.oi.numero) && C.oi.ensayos.length === 2 && C.oi.estado === "abierta", JSON.stringify(C.oi).slice(0, 200));
    return C.oi.numero;
  });

  await paso("1 · ver: la OT de origen y el laboratorio de destino la ven; otro laboratorio no", async () => {
    const deOt = await ok(U.lqcA1, "GET", `/ordenes-internas/ot/${C.otLqc.id}`);
    const f = deOt.find((x) => x.id === C.oi.id);
    afirmar(f && f.destinoUnidadCodigo === "LCC" && f.ensayosDetalle.length === 2, "la ficha de la OT no la muestra con su destino y ensayos");
    const lcc = await ok(U.lccJefe, "GET", "/ordenes-internas?limit=500");
    afirmar(lcc.data.some((x) => x.id === C.oi.id), "el laboratorio de destino no la ve");
    const lpn = await ok(U.lpnJefe, "GET", "/ordenes-internas?limit=500");
    afirmar(!lpn.data.some((x) => x.id === C.oi.id), "otro laboratorio la ve");
    await exigir(404, U.lpnJefe, "GET", `/ordenes-internas/${C.oi.id}`);
    await exigir(403, U.lpnA1, "GET", `/ordenes-internas/ot/${C.otLqc.id}`);
    const det = await ok(U.lccJefe, "GET", `/ordenes-internas/${C.oi.id}`);
    afirmar(det.historial.length === 1 && det.historial[0].accion === "creada", "sin historial de creación");
    return "LQC y LCC la ven; LPN 404/403";
  });

  await paso("1 · editar mientras está abierta; recibida → solo avanza o se anula; anular con motivo", async () => {
    await ok(U.planLqc, "PATCH", `/ordenes-internas/${C.oi.id}`, { detalle: "Cromo VI en cuero curtido", ensayos: [C.ensLcc[0]] });
    await exigir(403, U.lpnJefe, "PATCH", `/ordenes-internas/${C.oi.id}`, { detalle: "x" });
    await rechazo(409, /abierta → recibida → cerrada/, U.planLqc, "PATCH", `/ordenes-internas/${C.oi.id}`, { estado: "cerrada" });
    await ok(U.planLqc, "PATCH", `/ordenes-internas/${C.oi.id}`, { estado: "recibida" });
    await rechazo(409, /ya fue recibida/, U.planLqc, "PATCH", `/ordenes-internas/${C.oi.id}`, { detalle: "otro" });
    await rechazo(409, /anúlela/, U.planLqc, "DELETE", `/ordenes-internas/${C.oi.id}`);
    await exigir(400, U.planLqc, "POST", `/ordenes-internas/${C.oi.id}/anular`, { motivo: "no" });
    await exigir(403, U.lqcA1, "POST", `/ordenes-internas/${C.oi.id}/anular`, { motivo: "Sin permiso para anular" });
    const a = await ok(U.planLqc, "POST", `/ordenes-internas/${C.oi.id}/anular`, { motivo: "Laboratorio de destino equivocado" });
    afirmar(a.estado === "anulada" && a.motivoAnulacion === "Laboratorio de destino equivocado", "no quedó anulada con su motivo");
    afirmar(a.historial.map((h) => h.accion).join(",") === "creada,editada,estado,anulada", `historial ${a.historial.map((h) => h.accion)}`);
    await exigir(409, U.planLqc, "POST", `/ordenes-internas/${C.oi.id}/anular`, { motivo: "Otra vez la misma" });
    const otra = await ok(U.planif, "POST", "/ordenes-internas", { otId: C.otLqc.id, destinoLab: C.destLcc.id, ensayos: [C.ensLcc[1]], ...C.emision });
    await ok(U.planif, "DELETE", `/ordenes-internas/${otra.id}`);
    return `${C.oi.numero} anulada; ${otra.numero} borrada estando abierta`;
  });

  /* ---------------------------------------- 2 · porcentajes de la tasa (bpch_tasa) */
  await paso("2 · porcentajes de la tasa: ver; cambiar con validación, motivo e historial; solo catalogo.gestionar", async () => {
    const p = await ok(U.calidad, "GET", "/parametros/porcentajes");
    const tasa = p.valores.find((v) => v.codigo === "tasa_pct");
    afirmar(tasa && tasa.numero === 1.5 && p.valores.some((v) => v.codigo === "iva_pct"), `valores ${JSON.stringify(p.valores)}`);
    await ok(U.ventas, "GET", "/parametros/porcentajes"); // Comercial lo ve (internaciones)
    await exigir(403, U.lqcA1, "GET", "/parametros/porcentajes");
    const ruta = "/parametros/porcentajes/bpch_tasa/tasa_pct";
    await exigir(403, U.ventas, "PUT", ruta, { valor: "1,75", motivo: "Comercial no configura la tasa" });
    await rechazo(400, /entre 0 y 100/, U.calidad, "PUT", ruta, { valor: "150", motivo: "Fuera de rango" });
    await rechazo(400, /número/, U.calidad, "PUT", ruta, { valor: "1,7x", motivo: "No es un número" });
    await rechazo(400, /motivo/, U.calidad, "PUT", ruta, { valor: "1,75", motivo: "" });
    await rechazo(409, /historial/, U.calidad, "PATCH", `/parametros/${tasa.id}`, { valor: "2" });
    try {
      const r = await ok(U.calidad, "PUT", ruta, { valor: "1,75", motivo: "Prueba del frente K" });
      afirmar(r.valor === "1.75" && r.valorAnterior === "1.5", JSON.stringify(r));
      const h = await ok(U.calidad, "GET", "/parametros/porcentajes");
      afirmar(h.historial[0].valorNuevo === "1.75" && h.historial[0].motivo === "Prueba del frente K", "no quedó en el historial");
    } finally {
      await ok(U.calidad, "PUT", ruta, { valor: "1,5", motivo: "Vuelve al valor levantado (1,5 %)" });
    }
    const fin = await ok(U.calidad, "GET", "/parametros/porcentajes");
    afirmar(fin.valores.find((v) => v.codigo === "tasa_pct").valor === "1.5", "la tasa no volvió a 1,5");
    return "1,5 → 1,75 → 1,5 con motivo e historial";
  });

  /* ---------------------------------------------------- 3 · fotos del analista */
  await paso("3 · el analista sube y ve fotos de su OT sin permiso de emisión; otro laboratorio no", async () => {
    const s = await login(U.lqcA1);
    afirmar(!s.permisos.includes("certificado.emitir") && s.permisos.includes("resultado.crear"), "el analista tiene emisión o no captura");
    const f = await ok(U.lqcA1, "POST", `/informes/ot/${C.otLqc.id}/fotos`, formFoto(PNG_1x1, "frente-k.png", { pie: "Foto de prueba (frente K)" }));
    const lista = await ok(U.lqcA1, "GET", `/informes/ot/${C.otLqc.id}/fotos`);
    afirmar(lista.some((x) => x.id === f.id), "la foto no aparece");
    await exigir(403, U.lpnA1, "POST", `/informes/ot/${C.otLqc.id}/fotos`, formFoto(PNG_1x1, "x.png"));
    await exigir(403, U.lpnA1, "GET", `/informes/ot/${C.otLqc.id}/fotos`);
    await ok(U.lqcA1, "DELETE", `/informes/fotos/${f.id}`);
    return "subida, listada y quitada por demo.lqc.analista1";
  });

  /* -------------------------------------------- 4 · formato de las plantillas */
  await paso("4 · Gestión de Calidad cambia el formato de una plantilla sin emitir informes; el analista no", async () => {
    const s = await login(U.calidad);
    afirmar(s.permisos.includes("plantilla.gestionar") && !s.permisos.includes("certificado.emitir"), "Calidad sin plantilla.gestionar o con emisión");
    const pl = await ok(U.calidad, "GET", "/plantillas?limit=100");
    const p = pl.data.find((x) => x.tipo === "I.ENSAYO") ?? pl.data[0];
    const f = await ok(U.calidad, "GET", `/informes/plantillas/${p.id}/formato`);
    await ok(U.calidad, "PUT", `/informes/plantillas/${p.id}/formato`, { formato: f.guardado });
    await exigir(403, U.lqcA1, "PUT", `/informes/plantillas/${p.id}/formato`, { formato: f.guardado });
    return `${p.repid} · formato guardado sin cambios`;
  });

  /* ------------------------------------------------------ 6 · internación */
  await paso("6 · «Registrar OT» ya no admite el origen Internación; la búsqueda comercial sigue", async () => {
    const cli = await ok(U.planif, "GET", `/ot/${C.otLqc.id}`);
    await rechazo(400, /resolución DGMN en Internaciones/, U.planif, "POST", "/ot", {
      clienteId: cli.clienteId ?? cli.cliente?.id, origenTrabajo: "INTERNACION", resolucion: "17.798-2026-K", unidadPrincipalId: C.uLqc.id,
    });
    const r = await ok(U.ventas, "GET", "/internaciones/ot?limit=5");
    afirmar(Array.isArray(r.data), "la búsqueda de OT de internación no responde");
    await ok(U.ventas, "GET", "/bpch/internaciones?limit=5");
    return "Internación → 400 · /bpch/internaciones abre para Comercial";
  });

  /* ------------------------------------- 7 · responsable alternativo en la matriz */
  await paso("7 · matriz: el paso de emisión del Certificado de Calibración admite al metrólogo; se quita y repone sin código", async () => {
    const unidades = await ok(U.admin, "GET", "/unidades");
    const lmt = (Array.isArray(unidades) ? unidades : unidades.data).find((u) => u.codigo === "LMT");
    const res = await ok(U.admin, "GET", `/firmas-matriz/resolver?tipoDocumento=CERTIFICADO_CALIBRACION&unidadId=${lmt.id}`);
    const emite = res.pasos[res.pasos.length - 1];
    afirmar(emite.alternativo?.rol.codigo === "METROLOGO" && emite.responsables.some((r) => r.via === "alternativo"), `paso ${JSON.stringify(emite).slice(0, 200)}`);
    const reglas = await ok(U.admin, "GET", "/firmas-matriz?tipoDocumento=CERTIFICADO_CALIBRACION");
    const regla = reglas.data.find((r) => r.rolAlternativoId);
    await exigir(403, U.calidad, "PATCH", `/firmas-matriz/${regla.id}`, { rolAlternativoId: null });
    try {
      await ok(U.admin, "PATCH", `/firmas-matriz/${regla.id}`, { rolAlternativoId: null });
      const sin = await ok(U.admin, "GET", `/firmas-matriz/resolver?tipoDocumento=CERTIFICADO_CALIBRACION&unidadId=${lmt.id}`);
      const p = sin.pasos[sin.pasos.length - 1];
      afirmar(!p.alternativo && !p.responsables.some((r) => r.via === "alternativo"), "quitarlo no lo quitó");
    } finally {
      await ok(U.admin, "PATCH", `/firmas-matriz/${regla.id}`, { rolAlternativoId: regla.rolAlternativoId, nivelUnidadAlternativo: "MISMA" });
    }
    return `alternativo ${emite.alternativo.rol.nombre} (${emite.responsables.filter((r) => r.via === "alternativo").length} personas) · quitado y repuesto`;
  });
}

main()
  .then(() => {
    console.log(`\n${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    console.error(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
