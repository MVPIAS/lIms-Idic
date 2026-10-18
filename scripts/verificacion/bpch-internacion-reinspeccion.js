#!/usr/bin/env node
/**
 * Verificación contra una API real de los procesos BPCH de Internación,
 * Reinspección y Codificación Única
 * (docs/FLUJO_BPCH_INTERNACION_REINSPECCION_CODIFICACION.md), ejecutados DESDE
 * CERO como los haría el Banco de Pruebas de Chile:
 *
 *   A · Internación que CUMPLE y está sujeta a la tasa: Codificación Única →
 *       registro de la resolución DGMN → análisis técnico con antecedentes
 *       solicitados a DGMN → OT automática → documentación administrativa →
 *       inspección y lote (muestra con el panel del catálogo) → resultados →
 *       revisión y aprobación → Informe de Inspección → Certificado de
 *       Conformidad → Codificación Única → entrega → tasa → facturación →
 *       cierre (sin factura duplicada).
 *   B · Internación que NO CUMPLE, sin tasa: Informe de Inspección → Informe
 *       de Incumplimiento informado a DGMN → cierre sin factura.
 *   C · Reinspección del producto de A por traspaso: hereda antecedentes,
 *       inspección, Informe de Inspección, trazabilidad y cambio de titular en
 *       la Codificación Única → cierre.
 *   D · Revisión r3: dos lotes del MISMO producto nuevo (mismo CNC, sin
 *       codificar) se registran juntos y se inscriben juntos en la Codificación
 *       Única (hallazgo 3); un doble envío de lotes no crea dos muestras
 *       (hallazgo 10); el listado muestra el avance real (hallazgo 21).
 *
 * Cada regla se prueba con el perfil que debe poder y con uno que no.
 *
 * Uso:
 *   node scripts/verificacion/bpch-internacion-reinspeccion.js [--arrancar] [--base http://localhost:4021/api]
 * Mismas variables que flujo-completo.js (DATABASE_URL con --arrancar; CLAVE_DEMO
 * o la constante CLAVE_DEMO_EMBEBIDA). Deja datos de prueba: úsese en una base de pruebas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4021/api");
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
  const puerto = new URL(BASE).port || "4021";
  const env = {
    ...process.env,
    PORT: puerto,
    API_PORT: puerto,
    NODE_ENV: "production",
    ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-bpch-g1-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
function pararApi() {
  if (hijo && !hijo.killed) hijo.kill();
}

/* ============================================================ AYUDAS === */
const U = {
  ventas: "demo.ventas",
  scc: "demo.scc.jefe",
  inspector: "demo.sstgo.inspector",
  sstgo: "demo.sstgo.jefe",
  bpch: "demo.bpch.jefe",
  planif: "demo.planificacion",
  finanzas: "demo.finanzas",
  otroLab: "demo.lqc.analista1",
  otraSucursal: "demo.santof.jefe",
  director: "demo.director",
};
const POSIBLES_FIRMANTES = ["demo.sstgo.jefe", "demo.scc.jefe", "demo.bpch.jefe", "demo.director", "demo.sstgo.inspector", "demo.scc.inspector1"];
const hoy = () => new Date().toISOString().slice(0, 10);

function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}

/** Captura cada resultado del lote: los defectos en 0 (o 1 en `fallar`), la densidad dentro de rango. */
async function capturarLote(otId, muestraId, fallar = null) {
  const rs = (await ok(U.inspector, "GET", `/flujo/ot/${otId}/resultados`)).resultados.filter((r) => r.muestraId === muestraId);
  afirmar(rs.length > 0, "el lote no tiene ensayos");
  const hechos = [];
  for (const r of rs) {
    const nombre = r.catAnalito?.nombre ?? r.analito?.nombre ?? "";
    if ((r.tipoDato ?? "") === "atributo") {
      await ok(U.inspector, "POST", `/flujo/resultado/${r.id}/valor`, { atributo: "cumple" });
      hechos.push(`${nombre}=Cumple`);
      continue;
    }
    if (r.limiteInf == null && r.limiteSup == null)
      await ok(U.inspector, "PATCH", `/flujo/resultado/${r.id}/especificacion`, { limiteInf: "0", limiteSup: "0", unidad: "Obs." });
    const inf = r.limiteInf != null ? Number(String(r.limiteInf).replace(",", ".")) : 0;
    const sup = r.limiteSup != null ? Number(String(r.limiteSup).replace(",", ".")) : inf;
    let valor = String(((inf + sup) / 2).toFixed(3)).replace(".", ",");
    if (fallar && /cr[ií]tico/i.test(nombre) && !hechos.some((h) => h.includes("FALLA"))) valor = "1";
    const c = await ok(U.inspector, "POST", `/flujo/resultado/${r.id}/valor`, { valor });
    hechos.push(`${nombre}=${valor}→${c.veredicto}${valor === "1" ? " (FALLA)" : ""}`);
  }
  return hechos;
}

/** Firma un documento según su circuito con los usuarios de prueba (rechaza a uno fuera de turno). */
async function firmarTodo(docId) {
  const porId = Object.fromEntries(Object.entries(sesiones).map(([u, s]) => [s.id, u]));
  const hechos = [];
  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const circ = await ok(U.sstgo, "GET", `/informes/${docId}/circuito`).catch(() => ok(U.bpch, "GET", `/informes/${docId}/circuito`));
    const estado = circ.documento?.estado ?? circ.estado;
    if (estado === "oficial") return hechos.join(" → ");
    const pendientes = (circ.pasos ?? []).filter((p) => p.estado === "pendiente");
    const orden = Math.min(...pendientes.map((p) => p.orden));
    const p = pendientes.find((x) => x.orden === orden);
    const candidatos = (p.responsables ?? []).map((r) => porId[r.usuarioId]).filter(Boolean);
    afirmar(candidatos.length, `paso ${orden}: ningún responsable entre los usuarios de prueba (${(p.responsables ?? []).map((r) => r.nombre).join(", ")})`);
    if (vuelta === 0) await exigir(403, U.inspector === candidatos[0] ? U.otroLab : U.inspector, "POST", `/informes/${docId}/firmar`, {});
    await ok(candidatos[0], "POST", `/informes/${docId}/firmar`, {});
    hechos.push(`${orden}:${candidatos[0].replace("demo.", "")}`);
  }
  throw new Error("el documento no quedó oficial");
}

/** Avance que muestra el listado de internaciones para un expediente (hallazgo 21). */
async function avanceEnListado(usuario, id) {
  const fila = lista(await ok(usuario, "GET", "/bpch/internaciones?limit=200")).find((x) => x.id === id);
  afirmar(fila, "la internación no figura en el listado");
  return fila.avance;
}

async function plantilla(cfg, tipo) {
  const p = cfg.plantillas?.[tipo]?.[0];
  afirmar(p, `no hay plantilla para ${tipo}`);
  return p;
}

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(4, 14);
  const n6 = () => String(Math.floor(100000 + Math.random() * 899999));

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of [...Object.values(U), ...POSIBLES_FIRMANTES]) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  await paso("Configuración BPCH: unidades que inspeccionan, parámetros de tasa y plantillas SCC", async () => {
    C.cfg = await ok(U.ventas, "GET", "/bpch/config");
    C.sstgo = C.cfg.unidades.find((u) => u.codigo === "SSTGO");
    afirmar(C.sstgo, "Sucursal Santiago no figura entre las unidades que inspeccionan");
    afirmar(!C.cfg.unidades.some((u) => u.codigo === "LQC"), "un laboratorio fuera del BPCH figura como unidad que inspecciona");
    afirmar(C.cfg.parametros.tasaPct === 1.5, `tasa ${C.cfg.parametros.tasaPct}`);
    afirmar(C.cfg.parametros.motivosReinspeccion.length >= 3, "faltan motivos de reinspección");
    for (const t of ["INFORME_INSPECCION", "CERTIFICADO_CONFORMIDAD", "INFORME_INCUMPLIMIENTO"]) await plantilla(C.cfg, t);
    await exigir(403, U.otroLab, "GET", "/bpch/config");
    return `${C.cfg.unidades.length} unidades · tasa ${C.cfg.parametros.tasaPct} % · IVA ${C.cfg.parametros.ivaPct} %`;
  });

  await paso("Catálogo: elemento Tronex Plus con su panel de ensayos", async () => {
    const els = lista(await ok(U.bpch, "GET", `/cat/elementos?search=${encodeURIComponent("Tronex Plus")}&limit=50`));
    C.elemento = els.find((e) => e.codigo === "253") ?? els[0];
    afirmar(C.elemento, "no se encontró el elemento Tronex Plus");
    C.panel = await ok(U.inspector, "GET", `/bpch/panel?catElementoId=${C.elemento.id}`);
    const por = (c) => C.panel.find((m) => m.codigo === c);
    C.metodos = ["7464", "9362", "1917"].map(por).filter(Boolean).map((m) => m.id);
    afirmar(C.metodos.length === 3, `panel sin los métodos esperados (${C.panel.map((m) => m.codigo).join(",")})`);
    return `${C.elemento.nombre}: ${C.panel.length} métodos en el panel`;
  });

  await paso("Ventas crea las empresas (importador y comprador)", async () => {
    const base = 76000000 + (Number(sello.slice(-6)) % 999999);
    C.importador = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Importadora prueba BPCH ${sello}`, tipo: "particulares" });
    C.comprador = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base + 1), razonSocial: `Compradora prueba BPCH ${sello}`, tipo: "particulares" });
    return `${C.importador.razonSocial} · ${C.comprador.razonSocial}`;
  });

  /* ------------------------------------------------ Codificación Única */
  await paso("Codificación Única: inscripción con validaciones y permisos", async () => {
    C.cnc = `E-I/21/${n6()}/7357/30537/${n6()}`;
    const cuerpo = {
      listado: "EXPLOSIVOS", cnc: C.cnc, clienteId: C.importador.id, elementoGenerico: "Explosivo encartuchado", producto: `Tronex Plus prueba ${sello}`,
      claseDivisionUn: "1.1D", numeroUn: "0241", catElementoId: C.elemento.id,
    };
    await exigir(403, U.ventas, "POST", "/bpch/codificacion", cuerpo);
    await exigir(403, U.otroLab, "GET", "/bpch/codificacion");
    await exigir(400, U.bpch, "POST", "/bpch/codificacion", { ...cuerpo, cnc: "DE00027864" });
    await exigir(400, U.bpch, "POST", "/bpch/codificacion", { ...cuerpo, numeroUn: "" });
    C.cod = await ok(U.bpch, "POST", "/bpch/codificacion", cuerpo);
    afirmar(C.cod.estado === "VIGENTE" && C.cod.historial[0]?.evento === "alta", "la inscripción no quedó vigente con historial");
    await exigir(409, U.bpch, "POST", "/bpch/codificacion", { ...cuerpo, cnc: C.cnc.replace(/\//g, " / ") });
    const enc = await ok(U.ventas, "GET", `/bpch/codificacion?q=${encodeURIComponent(C.cnc)}`);
    afirmar(lista(enc).some((x) => x.id === C.cod.id), "la búsqueda por código no encuentra el producto");
    return `${C.cnc} vigente · duplicado con espacios rechazado (409)`;
  });

  await paso("Codificación Única: receso y reactivación con motivo", async () => {
    await exigir(409, U.bpch, "POST", `/bpch/codificacion/${C.cod.id}/estado`, { estado: "EN_RECESO", motivo: "" });
    await ok(U.bpch, "POST", `/bpch/codificacion/${C.cod.id}/estado`, { estado: "EN_RECESO", motivo: "Baja temporal solicitada" });
    const r = await ok(U.bpch, "POST", `/bpch/codificacion/${C.cod.id}/estado`, { estado: "VIGENTE", motivo: "Reactivado para la prueba" });
    afirmar(r.estado === "VIGENTE" && r.historial.some((h) => h.evento === "receso"), "no quedó el historial de receso");
    return "VIGENTE → EN_RECESO → VIGENTE";
  });

  /* ------------------------------------------------ A · Internación que cumple */
  const registroA = () => ({
    resolucionNumero: `Res. Ex. DGMN ${sello.slice(-4)}`,
    resolucionFecha: hoy(),
    oficio: `02/080/2026/${sello.slice(-4)}`,
    clienteId: C.importador.id,
    documentoAduanero: `DIN ${sello.slice(-6)}`,
    paisOrigen: "Suecia",
    esquema: "LOTES",
    procedimiento: "SAC-PG01-P01",
    unidadInspeccionId: C.sstgo.id,
    sujetaTasa: true,
    items: [{ codificacionId: C.cod.id, catElementoId: C.elemento.id, cantidad: 1482, unidadMedida: "uds" }],
  });

  await paso("A · Registro de la internación: permisos y validaciones", async () => {
    await exigir(403, U.otroLab, "GET", "/bpch/internaciones");
    await exigir(403, U.inspector, "POST", "/bpch/internaciones", registroA());
    await exigir(400, U.ventas, "POST", "/bpch/internaciones", { ...registroA(), items: [{ elementoEspecifico: "Sin UN" }] });
    await exigir(400, U.ventas, "POST", "/bpch/internaciones", { ...registroA(), items: [] });
    C.A = await ok(U.ventas, "POST", "/bpch/internaciones", registroA());
    afirmar(C.A.estado === "registrada" && /^INT-\d{4}-\d{4}$/.test(C.A.numero), `estado ${C.A.estado} número ${C.A.numero}`);
    const it = C.A.items[0];
    afirmar(it.cnc === C.cnc && it.claseDivisionUn === "1.1D" && it.numeroUn === "0241", "el elemento no heredó los datos de la Codificación Única");
    afirmar(C.A.documentacion.estado === "pendiente", `documentación ${C.A.documentacion.estado}`);
    return `${C.A.numero} · ${it.elementoEspecifico} (CNC, clase y Nº UN heredados)`;
  });

  await paso("A · Análisis técnico: información incompleta → solicitud a DGMN", async () => {
    await exigir(403, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoy() });
    await exigir(409, U.scc, "POST", `/bpch/internaciones/${C.A.id}/analisis`, { infoCompleta: false, fechaAnalisis: hoy() });
    const r = await ok(U.scc, "POST", `/bpch/internaciones/${C.A.id}/analisis`, {
      infoCompleta: false, fechaAnalisis: hoy(), solicitud: { destinatario: "DGMN · Dpto. Técnico", detalle: "Falta la ficha técnica del fabricante" },
    });
    afirmar(r.estado === "antecedentes_pendientes" && r.solicitudes.length === 1 && !r.otId, `estado ${r.estado}`);
    await exigir(409, U.scc, "POST", `/bpch/internaciones/${C.A.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoy() });
    C.A = await ok(U.scc, "POST", `/bpch/internaciones/${C.A.id}/solicitudes/${r.solicitudes[0].id}/respuesta`, { fechaRespuesta: hoy(), respuesta: "DGMN remite la ficha técnica" });
    return "antecedentes pendientes; no se completa mientras la solicitud no tenga respuesta (409)";
  });

  await paso("A · Información completa → OT automática de la Sucursal Santiago", async () => {
    C.A = await ok(U.scc, "POST", `/bpch/internaciones/${C.A.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoy(), observaciones: "Información técnica completa" });
    afirmar(C.A.estado === "ot_generada" && C.A.otId, `estado ${C.A.estado}`);
    C.otA = await ok(U.sstgo, "GET", `/ot/${C.A.otId}`);
    afirmar(C.otA.origenTrabajo === "INTERNACION" && C.otA.conCobro === true && C.otA.unidadPrincipal === C.sstgo.id, "la OT no nació como internación con cobro en SSTGO");
    afirmar(C.otA.numeroLey === registroA().resolucionNumero, "la OT no lleva la resolución");
    await exigir(409, U.scc, "POST", `/bpch/internaciones/${C.A.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoy() });
    await exigir(409, U.ventas, "PATCH", `/bpch/internaciones/${C.A.id}`, registroA());
    const l = lista(await ok(U.ventas, "GET", `/internaciones/ot?resolucion=${encodeURIComponent(registroA().resolucionNumero)}`));
    afirmar(l.some((o) => o.id === C.A.otId), "la OT no aparece en la lista de OT de internación");
    return `${C.otA.codigo} · ${C.otA.unidad?.codigo} · con cobro`;
  });

  await paso("A · Alcance: otra sucursal y otro laboratorio no ven la internación", async () => {
    await exigir(403, U.otraSucursal, "GET", `/bpch/internaciones/${C.A.id}`);
    const l = lista(await ok(U.otraSucursal, "GET", "/bpch/internaciones?limit=200"));
    afirmar(!l.some((x) => x.id === C.A.id), "Antofagasta ve la internación de Santiago");
    afirmar(lista(await ok(U.scc, "GET", "/bpch/internaciones?limit=200")).some((x) => x.id === C.A.id), "la Sección Certificación no ve la internación");
  });

  await paso("A · Documentación administrativa para la tasa (solicitar → recibir → conforme)", async () => {
    await exigir(409, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 184500, paridad: 945.2 });
    await exigir(409, U.scc, "POST", `/bpch/internaciones/${C.A.id}/documentacion`, { accion: "conforme", fecha: hoy() });
    await exigir(400, U.scc, "POST", `/bpch/internaciones/${C.A.id}/documentacion`, { accion: "solicitar", fecha: hoy() });
    await ok(U.scc, "POST", `/bpch/internaciones/${C.A.id}/documentacion`, { accion: "solicitar", fecha: hoy(), detalle: "DIN, factura comercial y valor CIF" });
    await ok(U.scc, "POST", `/bpch/internaciones/${C.A.id}/documentacion`, { accion: "recibir", fecha: hoy(), facturaComercial: "FC-123" });
    C.A = await ok(U.scc, "POST", `/bpch/internaciones/${C.A.id}/documentacion`, { accion: "conforme", fecha: hoy() });
    afirmar(C.A.documentacion.estado === "conforme", `documentación ${C.A.documentacion.estado}`);
    return "conforme";
  });

  await paso("A · Inspección: lote y tamaños (muestra ≤ lote) y registro del lote como muestra con el panel", async () => {
    const it = C.A.items[0];
    await exigir(400, U.inspector, "PATCH", `/bpch/internaciones/${C.A.id}/inspeccion`, { items: [{ id: it.id, identificacionLote: "L1", tamanoLote: 8, tamanoMuestra: 9 }] });
    await exigir(400, U.inspector, "POST", `/bpch/internaciones/${C.A.id}/lotes`, { items: [{ id: it.id, metodoIds: C.metodos }] });
    C.loteA = `DE${sello.slice(-8)}`;
    await ok(U.inspector, "PATCH", `/bpch/internaciones/${C.A.id}/inspeccion`, {
      lugarInspeccion: "Polvorín de prueba, Ruta 5 Norte", fechaInspeccion: hoy(), inspectores: "R. R. · N. C.",
      fechaVencimientoProducto: "2029-04-26", vigenciaInforme: "2027-04-26", observaciones: "Sin observaciones.",
      items: [{ id: it.id, identificacionLote: C.loteA, tamanoLote: 1482, tamanoMuestra: 36 }],
    });
    await exigir(403, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/lotes`, { items: [{ id: it.id, metodoIds: C.metodos }] });
    afirmar((await avanceEnListado(U.scc, C.A.id)) === "ot_generada", "antes de los lotes el listado debería decir «OT generada»");
    // Doble envío simultáneo (revisión r3, hallazgo 10): uno registra el lote y el otro recibe 400.
    const dobles = await Promise.all([1, 2].map(() => llamar(U.inspector, "POST", `/bpch/internaciones/${C.A.id}/lotes`, { items: [{ id: it.id, metodoIds: C.metodos }] })));
    const estados = dobles.map((r) => r.status).sort();
    afirmar(estados[0] >= 200 && estados[0] < 300 && estados[1] === 400, `doble envío de lotes → ${estados.join(", ")}`);
    C.A = dobles.find((r) => r.status < 300).json;
    C.muestraA = C.A.items[0].muestraId;
    afirmar(C.muestraA, "el lote no quedó registrado como muestra");
    const regA = await ok(U.inspector, "GET", `/flujo/ot/${C.A.otId}/registro-muestras`);
    afirmar(regA.muestras.length === 1, `el doble envío dejó ${regA.muestras.length} muestras`);
    afirmar((await avanceEnListado(U.scc, C.A.id)) === "en_inspeccion", "con el lote registrado el listado debería decir «En inspección»");
    await exigir(400, U.inspector, "POST", `/bpch/internaciones/${C.A.id}/lotes`, { items: [{ id: it.id, metodoIds: C.metodos }] });
    return `${C.A.items[0].muestraCodigo} · ${C.A.lotesRegistrados?.[0]?.ensayos} ensayos`;
  });

  await paso("A · Captura del inspector (todo cumple), revisión del jefe de sucursal y aprobación del jefe BPCH", async () => {
    await exigir([403, 404], U.otroLab, "GET", `/flujo/ot/${C.A.otId}/resultados`);
    const h = await capturarLote(C.A.otId, C.muestraA);
    await exigir([403, 409], U.inspector, "POST", `/resultados/ot/${C.A.otId}/revisar`, {});
    await ok(U.sstgo, "POST", `/resultados/ot/${C.A.otId}/revisar`, {});
    await ok(U.bpch, "POST", `/resultados/ot/${C.A.otId}/aprobar`, {});
    C.A = await ok(U.scc, "GET", `/bpch/internaciones/${C.A.id}`);
    afirmar(C.A.estadoOt.condicion === "cumple", `condición ${C.A.estadoOt.condicion}`);
    afirmar(C.A.fases.find((f) => f.clave === "resultados").estado === "hecho", "la fase de resultados no quedó hecha");
    return h.join(" · ").slice(0, 160);
  });

  await paso("A · Certificado antes del Informe de Inspección: rechazado (409)", async () => {
    const pc = await plantilla(C.cfg, "CERTIFICADO_CONFORMIDAD");
    const cond = await ok(U.sstgo, "POST", "/informes/condiciones", { otId: C.A.otId, plantillaId: pc.id, tipoDocumento: "CERTIFICADO_CONFORMIDAD" });
    afirmar(!cond.puedeEmitir && cond.faltantes.some((f) => /Informe de Inspección/.test(f)), `faltantes: ${cond.faltantes.join(" | ")}`);
    await exigir(409, U.sstgo, "POST", "/informes/emitir", { otId: C.A.otId, plantillaId: pc.id, tipoDocumento: "CERTIFICADO_CONFORMIDAD" });
  });

  await paso("A · Informe de Inspección: emisión, cabecera BPCH y firma del Jefe de Sucursal", async () => {
    const pi = await plantilla(C.cfg, "INFORME_INSPECCION");
    const r = await ok(U.sstgo, "POST", "/informes/emitir", { otId: C.A.otId, plantillaId: pi.id, tipoDocumento: "INFORME_INSPECCION" });
    C.informeA = (r.certificado ?? r).id;
    const html = await llamar(U.sstgo, "GET", `/informes/${C.informeA}/html`);
    const texto = typeof html.json === "string" ? html.json : JSON.stringify(html.json);
    for (const d of [C.cnc, C.loteA, "1.1D", "CUMPLE", "Sucursal Santiago"]) afirmar(texto.includes(d), `el informe no muestra «${d}»`);
    afirmar(/Mínimo/.test(texto) && /Condición/.test(texto), "el informe no lleva la tabla de inspección");
    return firmarTodo(C.informeA);
  });

  await paso("A · Informe de Incumplimiento con condición CUMPLE: rechazado (409)", async () => {
    const pn = await plantilla(C.cfg, "INFORME_INCUMPLIMIENTO");
    await exigir(409, U.sstgo, "POST", "/informes/emitir", { otId: C.A.otId, plantillaId: pn.id, tipoDocumento: "INFORME_INCUMPLIMIENTO" });
  });

  await paso("A · Certificado de Conformidad: emisión y firma de la Sección Certificación", async () => {
    await exigir(409, U.bpch, "POST", `/bpch/internaciones/${C.A.id}/codificacion`, { items: [{ id: C.A.items[0].id }] });
    const pc = await plantilla(C.cfg, "CERTIFICADO_CONFORMIDAD");
    const r = await ok(U.sstgo, "POST", "/informes/emitir", { otId: C.A.otId, plantillaId: pc.id, tipoDocumento: "CERTIFICADO_CONFORMIDAD" });
    C.certA = (r.certificado ?? r).id;
    const html = await llamar(U.sstgo, "GET", `/informes/${C.certA}/html`);
    const texto = typeof html.json === "string" ? html.json : "";
    afirmar(texto.includes("CERTIFICADO DE CONFORMIDAD") && texto.includes(C.cnc), "el certificado no lleva la cabecera BPCH");
    return firmarTodo(C.certA);
  });

  await paso("A · Codificación Única: el producto queda con el certificado asociado", async () => {
    await exigir(403, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/codificacion`, { items: [{ id: C.A.items[0].id }] });
    C.A = await ok(U.bpch, "POST", `/bpch/internaciones/${C.A.id}/codificacion`, { items: [{ id: C.A.items[0].id }] });
    const cod = await ok(U.ventas, "GET", `/bpch/codificacion/${C.cod.id}`);
    afirmar(cod.certificadoId === C.certA && cod.historial.some((h) => h.evento === "certificacion"), "la codificación no quedó con el certificado");
    afirmar(C.A.fases.find((f) => f.clave === "codificacion").estado === "hecho", "la fase de codificación no quedó hecha");
    return `${cod.cnc} · certificado ${cod.certificadoNumero}`;
  });

  await paso("A · Entrega del informe y del certificado", async () => {
    await ok(U.planif, "POST", `/informes/${C.informeA}/entregar`, { medio: "mano", destinatario: "BPCH SCC (archivo)" });
    await ok(U.planif, "POST", `/informes/${C.certA}/entregar`, { medio: "correo", destinatario: "Importador" });
  });

  await paso("A · Tasa: cálculo con el parámetro (1,5 %) y remisión a facturación", async () => {
    await exigir(403, U.inspector, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 184500, paridad: 945.2 });
    await exigir(400, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 0, paridad: 945.2 });
    // Revisión de seguridad r3: los porcentajes son los del parámetro; otros solo con el
    // permiso de configuración (catalogo.gestionar). Comercial no; la jefatura BPCH sí.
    const e = await exigir(403, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 184500, paridad: 945.2, tasaPct: 2 });
    afirmar(/catalogo\.gestionar/.test(msg(e)), msg(e));
    await exigir(403, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 184500, paridad: 945.2, ivaPct: 0 });
    const otra = await ok(U.bpch, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 184500, paridad: 945.2, tasaPct: 2 });
    afirmar(otra.tasa.tasaPct === 2, `tasa con 2 %: ${otra.tasa.tasaPct}`);
    await ok(U.ventas, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 184500, paridad: 945.2, tasaPct: C.cfg.parametros.tasaPct });
    C.A = await ok(U.ventas, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 184500, paridad: 945.2, pctAfecto: 100 });
    afirmar(C.A.tasa.tasa === 2615841, `tasa ${C.A.tasa.tasa} (esperado 2.615.841)`);
    const iva = Math.round(2615841 * (C.cfg.parametros.ivaPct / 100));
    afirmar(C.A.tasa.total === 2615841 + iva, `total ${C.A.tasa.total}`);
    const r = await ok(U.ventas, "POST", `/bpch/internaciones/${C.A.id}/remitir-facturacion`);
    C.facturaA = r.facturaId;
    await exigir(409, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/remitir-facturacion`);
    await exigir(409, U.ventas, "POST", `/bpch/internaciones/${C.A.id}/tasa`, { cifUsd: 1, paridad: 1 });
    const f = await ok(U.finanzas, "GET", `/facturas/${C.facturaA}`);
    afirmar(f.estado === "pendiente" && Number(f.total) === C.A.tasa.total && f.lineas.length === 1, `factura ${f.estado} ${f.total}`);
    afirmar((await avanceEnListado(U.ventas, C.A.id)) === "tasa_remitida", "el listado no muestra la tasa remitida");
    return `tasa $${C.A.tasa.tasa} + IVA = $${C.A.tasa.total} · factura ${f.numero} pendiente`;
  });

  await paso("A · Cierre de la OT: usa la factura de la tasa (sin duplicar)", async () => {
    const r = await ok(U.planif, "POST", `/ot/${C.A.otId}/cerrar`, {});
    afirmar(r.facturaCreada?.id === C.facturaA, `el cierre creó otra factura (${r.facturaCreada?.id})`);
    const fs2 = lista(await ok(U.finanzas, "GET", `/facturas?estado=pendiente&limit=500`)).filter((f) => f.otId === C.A.otId);
    afirmar(fs2.length === 1, `${fs2.length} facturas pendientes para la OT`);
    C.A = await ok(U.scc, "GET", `/bpch/internaciones/${C.A.id}`);
    const pend = C.A.fases.filter((f) => f.estado !== "hecho" && f.estado !== "no_aplica");
    afirmar(!pend.length, `fases sin completar: ${pend.map((f) => f.clave).join(", ")}`);
    // Revisión r3 (hallazgo 21): con la OT cerrada el listado ya no dice «OT generada».
    afirmar(C.A.avance === "ot_cerrada", `avance del expediente ${C.A.avance}`);
    afirmar((await avanceEnListado(U.scc, C.A.id)) === "ot_cerrada", "el listado sigue sin mostrar la OT cerrada");
    return `${C.A.fases.length} fases completas · listado: ${C.A.avanceTexto}`;
  });

  /* ------------------------------------------------ B · Internación que no cumple */
  await paso("B · Registro por la Sección Certificación (elemento no codificado, sin tasa) y OT", async () => {
    C.cncB = `E-I/7/${n6()}/673/30365/${n6()}`;
    const registroB = (clienteId) => ({
      resolucionNumero: `Res. Ex. DGMN B${sello.slice(-4)}`, resolucionFecha: hoy(), clienteId, esquema: "LOTES",
      unidadInspeccionId: C.sstgo.id, sujetaTasa: false,
      items: [{ catElementoId: C.elemento.id, elementoGenerico: "Explosivo encartuchado", elementoEspecifico: `Tronex Plus lote B ${sello}`, cnc: C.cncB, claseDivisionUn: "1.1D", numeroUn: "0241", cantidad: 500 }],
    });
    C.B = await ok(U.scc, "POST", "/bpch/internaciones", registroB(C.importador.id));
    afirmar(C.B.documentacion.estado === "no_aplica", `documentación ${C.B.documentacion.estado}`);
    // Revisión de seguridad r3: corregir el registro mientras el análisis genera la OT. La
    // corrección bloquea la fila: o entra antes (y la OT nace con el dato corregido) o
    // responde 409; nunca deja una OT con un cliente distinto del expediente.
    const [an, co] = await Promise.all([
      llamar(U.scc, "POST", `/bpch/internaciones/${C.B.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoy() }),
      llamar(U.ventas, "PATCH", `/bpch/internaciones/${C.B.id}`, registroB(C.comprador.id)),
    ]);
    afirmar(an.status < 300 && (co.status < 300 || co.status === 409), `análisis ${an.status} · corrección ${co.status}: ${msg(co.json)}`);
    C.B = await ok(U.scc, "GET", `/bpch/internaciones/${C.B.id}`);
    const ot = await ok(U.sstgo, "GET", `/ot/${C.B.otId}`);
    afirmar(ot.clienteId === C.B.cliente.id, `la OT quedó con otro cliente que el expediente (${ot.clienteId} ≠ ${C.B.cliente.id})`);
    await exigir(409, U.ventas, "PATCH", `/bpch/internaciones/${C.B.id}`, registroB(C.importador.id));
    afirmar(ot.conCobro === false, "una internación sin tasa nació con cobro");
    await exigir(409, U.scc, "POST", `/bpch/internaciones/${C.B.id}/documentacion`, { accion: "solicitar", fecha: hoy(), detalle: "x" });
    return `${C.B.numero} · ${ot.codigo} sin cobro`;
  });

  await paso("B · Lote con un defecto crítico → NO CUMPLE", async () => {
    const it = C.B.items[0];
    await ok(U.inspector, "PATCH", `/bpch/internaciones/${C.B.id}/inspeccion`, {
      lugarInspeccion: "Bodega de prueba", fechaInspeccion: hoy(), inspectores: "R. R. · N. C.", observaciones: "Defecto crítico en embalaje.",
      items: [{ id: it.id, identificacionLote: `LB${sello.slice(-6)}`, tamanoLote: 500, tamanoMuestra: 20 }],
    });
    C.B = await ok(U.inspector, "POST", `/bpch/internaciones/${C.B.id}/lotes`, { items: [{ id: it.id, metodoIds: C.metodos }] });
    const h = await capturarLote(C.B.otId, C.B.items[0].muestraId, true);
    await ok(U.sstgo, "POST", `/resultados/ot/${C.B.otId}/revisar`, {});
    await ok(U.bpch, "POST", `/resultados/ot/${C.B.otId}/aprobar`, {});
    C.B = await ok(U.scc, "GET", `/bpch/internaciones/${C.B.id}`);
    afirmar(C.B.estadoOt.condicion === "no_cumple", `condición ${C.B.estadoOt.condicion}`);
    return h.filter((x) => x.includes("FALLA")).join(" ");
  });

  await paso("B · Informe de Inspección; el certificado se rechaza y se emite el Informe de Incumplimiento", async () => {
    const pi = await plantilla(C.cfg, "INFORME_INSPECCION");
    const r = await ok(U.sstgo, "POST", "/informes/emitir", { otId: C.B.otId, plantillaId: pi.id, tipoDocumento: "INFORME_INSPECCION" });
    C.informeB = (r.certificado ?? r).id;
    await firmarTodo(C.informeB);
    const pc = await plantilla(C.cfg, "CERTIFICADO_CONFORMIDAD");
    const cond = await ok(U.sstgo, "POST", "/informes/condiciones", { otId: C.B.otId, plantillaId: pc.id, tipoDocumento: "CERTIFICADO_CONFORMIDAD" });
    afirmar(cond.faltantes.some((f) => /Corresponde el Informe de Incumplimiento/.test(f)), `faltantes: ${cond.faltantes.join(" | ")}`);
    await exigir(409, U.sstgo, "POST", "/informes/emitir", { otId: C.B.otId, plantillaId: pc.id, tipoDocumento: "CERTIFICADO_CONFORMIDAD" });
    const pn = await plantilla(C.cfg, "INFORME_INCUMPLIMIENTO");
    const r2 = await ok(U.sstgo, "POST", "/informes/emitir", { otId: C.B.otId, plantillaId: pn.id, tipoDocumento: "INFORME_INCUMPLIMIENTO" });
    C.incumpB = (r2.certificado ?? r2).id;
    const html = await llamar(U.sstgo, "GET", `/informes/${C.incumpB}/html`);
    afirmar(String(html.json).includes("INFORME DE INCUMPLIMIENTO") && String(html.json).includes("NO CUMPLE"), "el incumplimiento no lleva su cabecera");
    return firmarTodo(C.incumpB);
  });

  await paso("B · Se informa a DGMN (entrega del incumplimiento) y la OT se cierra sin factura", async () => {
    await exigir(409, U.bpch, "POST", `/bpch/internaciones/${C.B.id}/codificacion`, { items: [{ id: C.B.items[0].id, listado: "EXPLOSIVOS" }] });
    await exigir(409, U.ventas, "POST", `/bpch/internaciones/${C.B.id}/tasa`, { cifUsd: 1, paridad: 1 });
    await ok(U.planif, "POST", `/informes/${C.informeB}/entregar`, { medio: "mano", destinatario: "BPCH SCC (archivo)" });
    await ok(U.bpch, "POST", `/informes/${C.incumpB}/entregar`, { medio: "oficina_partes", destinatario: "DGMN · DCAE", observacion: "Copia al internador" });
    C.B = await ok(U.scc, "GET", `/bpch/internaciones/${C.B.id}`);
    afirmar(C.B.fases.find((f) => f.clave === "documento_final").estado === "hecho", "la fase del incumplimiento no quedó hecha");
    const r = await ok(U.planif, "POST", `/ot/${C.B.otId}/cerrar`, {});
    afirmar(!r.facturaCreada, "se creó factura para una internación sin tasa");
    return "informado a DGMN · OT cerrada sin factura";
  });

  /* ------------------------------------------------ D · Dos lotes del mismo producto nuevo (revisión r3) */
  await paso("D · Dos lotes del mismo producto nuevo (mismo CNC, sin codificar): OT, lotes y resultados", async () => {
    C.cncD = `E-I/9/${n6()}/1/2/${n6()}`;
    const item = (lote) => ({ catElementoId: C.elemento.id, elementoGenerico: "Explosivo encartuchado", elementoEspecifico: `Tronex Plus D ${sello}`,
      cnc: C.cncD, claseDivisionUn: "1.1D", numeroUn: "0241", cantidad: 100 + lote });
    C.D = await ok(U.scc, "POST", "/bpch/internaciones", {
      resolucionNumero: `Res. Ex. DGMN D${sello.slice(-4)}`, resolucionFecha: hoy(), clienteId: C.importador.id, esquema: "LOTES",
      unidadInspeccionId: C.sstgo.id, sujetaTasa: false, items: [item(1), item(2)],
    });
    afirmar(C.D.items.length === 2 && C.D.items.every((x) => x.cnc === C.cncD && !x.codificacionId), "los dos lotes no quedaron con el mismo CNC sin codificar");
    C.D = await ok(U.scc, "POST", `/bpch/internaciones/${C.D.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoy() });
    await ok(U.inspector, "PATCH", `/bpch/internaciones/${C.D.id}/inspeccion`, {
      lugarInspeccion: "Bodega de prueba D", fechaInspeccion: hoy(), inspectores: "R. R.",
      items: C.D.items.map((x, i) => ({ id: x.id, identificacionLote: `LD${i + 1}-${sello.slice(-6)}`, tamanoLote: 100, tamanoMuestra: 5 })),
    });
    C.D = await ok(U.inspector, "POST", `/bpch/internaciones/${C.D.id}/lotes`, { items: C.D.items.map((x) => ({ id: x.id, metodoIds: C.metodos })) });
    afirmar(C.D.items.every((x) => x.muestraId), "no se registraron los dos lotes");
    for (const x of C.D.items) await capturarLote(C.D.otId, x.muestraId);
    await ok(U.sstgo, "POST", `/resultados/ot/${C.D.otId}/revisar`, {});
    await ok(U.bpch, "POST", `/resultados/ot/${C.D.otId}/aprobar`, {});
    return `${C.D.numero} · 2 lotes · CNC ${C.cncD}`;
  });

  await paso("D · Informe de Inspección y Certificado de Conformidad oficiales", async () => {
    const pi = await plantilla(C.cfg, "INFORME_INSPECCION");
    const r = await ok(U.sstgo, "POST", "/informes/emitir", { otId: C.D.otId, plantillaId: pi.id, tipoDocumento: "INFORME_INSPECCION" });
    await firmarTodo((r.certificado ?? r).id);
    const pc = await plantilla(C.cfg, "CERTIFICADO_CONFORMIDAD");
    const c = await ok(U.sstgo, "POST", "/informes/emitir", { otId: C.D.otId, plantillaId: pc.id, tipoDocumento: "CERTIFICADO_CONFORMIDAD" });
    C.certD = (c.certificado ?? c).id;
    await firmarTodo(C.certD);
    afirmar((await avanceEnListado(U.scc, C.D.id)) === "certificado_emitido", "el listado no muestra el certificado emitido");
  });

  await paso("D · Codificación Única: los dos lotes del mismo CNC se inscriben juntos, una sola vez (hallazgo 3)", async () => {
    C.D = await ok(U.bpch, "POST", `/bpch/internaciones/${C.D.id}/codificacion`, { items: C.D.items.map((x) => ({ id: x.id, listado: "EXPLOSIVOS" })) });
    const ids = [...new Set(C.D.items.map((x) => x.codificacionId))];
    afirmar(ids.length === 1 && ids[0], `los lotes quedaron con ${ids.length} productos distintos`);
    const cod = await ok(U.ventas, "GET", `/bpch/codificacion/${ids[0]}`);
    const ev = cod.historial.map((h) => h.evento);
    afirmar(cod.certificadoId === C.certD && ev.includes("alta_certificacion") && ev.includes("certificacion"), `historial ${ev.join(",")}`);
    const enc = lista(await ok(U.ventas, "GET", `/bpch/codificacion?q=${encodeURIComponent(C.cncD)}`));
    afirmar(enc.length === 1, `${enc.length} inscripciones con el mismo CNC`);
    return `${cod.cnc} inscrito una vez · historial: ${ev.join(" ← ")}`;
  });

  /* ------------------------------------------------ C · Reinspección */
  await paso("C · Antecedente: hereda de la OT original titular, producto, código y lote", async () => {
    C.ant = await ok(U.sstgo, "GET", `/bpch/reinspecciones/antecedente?otId=${C.A.otId}`);
    const p = C.ant.propuesta;
    afirmar(p.clienteId === C.importador.id && p.cnc === C.cnc && p.codificacionId === C.cod.id && p.identificacionLote === C.loteA, `propuesta ${JSON.stringify(p).slice(0, 200)}`);
    afirmar(C.ant.ot.condicion === "cumple", `condición original ${C.ant.ot.condicion}`);
    await exigir(403, U.otraSucursal, "GET", `/bpch/reinspecciones/antecedente?otId=${C.A.otId}`);
    const x = await ok(U.sstgo, "GET", `/bpch/reinspecciones/antecedente?cnc=${encodeURIComponent("E-I/1/2/3/4/5")}`);
    afirmar(x.cncNoCodificado === true, "un código no codificado no se marca");
    return `${C.ant.ot.codigo} · ${p.elementoEspecifico}`;
  });

  const solicitudC = () => ({
    motivo: "TRASPASO", solicitadoPor: "Jefe Sucursal Santiago", documentoSolicitud: "SOLICITUD JEFE SSTGO", fechaSolicitud: hoy(),
    origenOtId: C.A.otId, certificadoOrigenId: C.certA, clienteDestinoId: C.comprador.id, procedimiento: "SAC-PG05",
    unidadInspeccionId: C.sstgo.id, conCobro: false, identificacionLote: C.loteA, tamanoLote: 8, tamanoMuestra: 2,
  });

  await paso("C · Solicitud de reinspección: permisos y validaciones", async () => {
    await exigir(403, U.inspector, "POST", "/bpch/reinspecciones", solicitudC());
    await exigir(403, U.otroLab, "GET", "/bpch/reinspecciones");
    await exigir(400, U.sstgo, "POST", "/bpch/reinspecciones", { ...solicitudC(), origenOtId: null, certificadoOrigenId: null });
    await exigir(400, U.sstgo, "POST", "/bpch/reinspecciones", { ...solicitudC(), origenOtId: null, certificadoOrigenId: null, cnc: "E-I/1/2/3/4/5" });
    await exigir(400, U.sstgo, "POST", "/bpch/reinspecciones", { ...solicitudC(), motivo: "OTRO" });
    await exigir(400, U.sstgo, "POST", "/bpch/reinspecciones", { ...solicitudC(), tamanoMuestra: 9 });
    C.R = await ok(U.sstgo, "POST", "/bpch/reinspecciones", solicitudC());
    afirmar(/^REI-\d{4}-\d{4}$/.test(C.R.numero) && C.R.otId, `número ${C.R.numero}`);
    afirmar(C.R.producto.cnc === C.cnc && C.R.codificacion?.id === C.cod.id && C.R.cliente.id === C.importador.id, "no heredó del antecedente");
    afirmar(C.R.origenOt?.id === C.A.otId && C.R.certificadoOrigen?.id === C.certA, "no quedó ligada a la OT y al certificado originales");
    const ot = await ok(U.sstgo, "GET", `/ot/${C.R.otId}`);
    afirmar(ot.origenTrabajo === "REINSPECCION" && ot.conCobro === false, `origen ${ot.origenTrabajo}`);
    await exigir(403, U.otraSucursal, "GET", `/bpch/reinspecciones/${C.R.id}`);
    return `${C.R.numero} · ${ot.codigo} · OT original ${C.R.origenOt.codigo}`;
  });

  await paso("C · Inspección del lote, resultados e Informe de Inspección de la reinspección", async () => {
    await exigir(403, U.ventas, "PATCH", `/bpch/reinspecciones/${C.R.id}/inspeccion`, {});
    await ok(U.inspector, "PATCH", `/bpch/reinspecciones/${C.R.id}/inspeccion`, {
      lugarInspeccion: "Ruta F-800 km 5", fechaInspeccion: hoy(), inspectores: "V. R. · N. C.", fechaVencimientoProducto: "2029-06-30", vigenciaInforme: "2027-01-29",
      observaciones: "Reinspección por traspaso entre empresas.",
    });
    const dobles = await Promise.all([1, 2].map(() => llamar(U.inspector, "POST", `/bpch/reinspecciones/${C.R.id}/lote`, { metodoIds: C.metodos.slice(0, 2) })));
    const est = dobles.map((r) => r.status).sort();
    afirmar(est[0] >= 200 && est[0] < 300 && est[1] === 409, `doble envío del lote de reinspección → ${est.join(", ")}`);
    C.R = dobles.find((r) => r.status < 300).json;
    afirmar(C.R.lote.muestraId, "el lote no quedó como muestra");
    afirmar((await ok(U.inspector, "GET", `/flujo/ot/${C.R.otId}/registro-muestras`)).muestras.length === 1, "el doble envío dejó dos muestras");
    await capturarLote(C.R.otId, C.R.lote.muestraId);
    await ok(U.sstgo, "POST", `/resultados/ot/${C.R.otId}/revisar`, {});
    await ok(U.bpch, "POST", `/resultados/ot/${C.R.otId}/aprobar`, {});
    const pi = await plantilla(C.cfg, "INFORME_INSPECCION");
    await exigir(409, U.sstgo, "POST", `/bpch/reinspecciones/${C.R.id}/trazabilidad`, {});
    const r = await ok(U.sstgo, "POST", "/informes/emitir", { otId: C.R.otId, plantillaId: pi.id, tipoDocumento: "INFORME_INSPECCION" });
    C.informeR = (r.certificado ?? r).id;
    const html = String((await llamar(U.sstgo, "GET", `/informes/${C.informeR}/html`)).json);
    afirmar(html.includes("Reinspección") && html.includes("SAC-PG05"), "el informe no muestra el origen Reinspección y su procedimiento");
    return firmarTodo(C.informeR);
  });

  await paso("C · Trazabilidad y cambio de titular en la Codificación Única", async () => {
    await exigir(403, U.sstgo, "POST", `/bpch/reinspecciones/${C.R.id}/trazabilidad`, { cambiarTitular: true, motivo: "Venta a la compradora" });
    C.R = await ok(U.bpch, "POST", `/bpch/reinspecciones/${C.R.id}/trazabilidad`, { cambiarTitular: true, motivo: "Venta a la compradora" });
    afirmar(C.R.trazabilidadAt, "no quedó la trazabilidad");
    const cod = await ok(U.ventas, "GET", `/bpch/codificacion/${C.cod.id}`);
    afirmar(cod.clienteId === C.comprador.id, "el titular no cambió");
    const ev = cod.historial.map((h) => h.evento);
    afirmar(ev.includes("reinspeccion") && ev.includes("cambio_titular"), `historial ${ev.join(",")}`);
    await exigir(409, U.bpch, "POST", `/bpch/reinspecciones/${C.R.id}/trazabilidad`, {});
    return `historial: ${ev.join(" ← ")}`;
  });

  await paso("C · Entrega interna y cierre de la OT de reinspección (sin factura)", async () => {
    await ok(U.sstgo, "POST", `/informes/${C.informeR}/entregar`, { medio: "mano", destinatario: "BPCH SCC · BPCH SUC (archivo)" });
    const r = await ok(U.sstgo, "POST", `/ot/${C.R.otId}/cerrar`, {});
    afirmar(!r.facturaCreada, "la reinspección sin cobro generó factura");
    C.R = await ok(U.sstgo, "GET", `/bpch/reinspecciones/${C.R.id}`);
    const pend = C.R.fases.filter((f) => f.estado !== "hecho" && f.estado !== "no_aplica");
    afirmar(!pend.length, `fases sin completar: ${pend.map((f) => f.clave).join(", ")}`);
    return `${C.R.fases.length} fases completas`;
  });
}

main()
  .then(() => {
    console.log(`\nRecorrido BPCH completo: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
