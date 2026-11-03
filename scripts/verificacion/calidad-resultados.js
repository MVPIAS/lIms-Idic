#!/usr/bin/env node
/**
 * Verificación contra una API real del bloque A · laboratorio y calidad
 * (packages/db/align_calidad_resultados.sql):
 *   · §4.2.6 / §4.3.9: dictamen «advertencia» (cumple cerca de un límite), re-análisis
 *     automático por No cumple que bloquea revisar hasta repetir, re-análisis manual del
 *     revisor y descarte con motivo por la jefatura, avisos al laboratorio;
 *   · §4.3.1: POE del método desde el gestor documental, visible en la captura;
 *   · §4.3.5: acreditación ISO/IEC 17025 con alcance por método y vigencia;
 *   · §4.2.1: alícuotas de una muestra, consumo y estados, con alcance por laboratorio.
 *
 * Uso: node scripts/verificacion/calidad-resultados.js [--base http://localhost:3001/api]
 * Variables: CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA). Crea datos «PRUEBA»: úsese en una base de pruebas.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:3001/api");

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
  const r = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: CLAVE }) });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  sesiones[username] = { token: j.accessToken, id: j.user?.id ?? null };
  return sesiones[username];
}
async function pedir(username, metodo, ruta, cuerpo, multipart) {
  const s = await login(username);
  const headers = { authorization: `Bearer ${s.token}` };
  let body;
  if (multipart) body = multipart;
  else if (cuerpo !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(cuerpo);
  }
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body });
  const tipo = r.headers.get("content-type") ?? "";
  if (!tipo.includes("json")) return { status: r.status, json: Buffer.from(await r.arrayBuffer()) };
  const t = await r.text();
  let json = null;
  try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, json };
}
const msg = (j) => (Buffer.isBuffer(j) ? `${j.length} bytes` : typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo, multipart) {
  const r = await pedir(username, metodo, ruta, cuerpo, multipart);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  return r.json;
}
const ok = (u, m, ruta, c, mp) => exigir([200, 201], u, m, ruta, c, mp);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);
function formulario(campos, nombre, contenido) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) f.append(k, String(v));
  f.append("archivo", new Blob([contenido]), nombre);
  return f;
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
function afirmar(cond, texto) {
  if (!cond) throw new Error(texto);
}
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}

/* ---------------------------------------------------------------- datos --- */
const U = {
  ventas: "demo.ventas",
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  jefe: "demo.lqa.jefe",
  revisor: "demo.lqa.revisor",
  a1: "demo.lqa.analista1",
  calidad: "demo.calidad",
  otroLab: "demo.lmb.analista1",
};
const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
const C = {};
const filaDe = async (id) => (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados.find((x) => x.id === id);

async function main() {
  console.log(`Calidad de resultados contra ${BASE}`);

  await paso("OT de LQA (PRUEBA) con una muestra y los métodos 403 (proteína) y 395 (humedad)", async () => {
    C.lqa = lista(await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQA");
    const buscar = async (codigo) => lista(await ok(U.jefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
    C.mP = await buscar("403");
    C.mH = await buscar("395");
    afirmar(C.lqa && C.mP && C.mH, "faltan LQA o los métodos 403/395");
    const base = 76000000 + (Number(sello.slice(-6)) % 999999);
    const cli = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Cliente Prueba Calidad ${sello}`, tipo: "particulares", giro: "Pruebas", direccion: "Calle Prueba 1" });
    C.ot = await ok(U.planif, "POST", "/ot", { clienteId: cli.id, unidadPrincipalId: C.lqa.id, conCobro: false, descripcionTrabajo: `OT-PRUEBA calidad ${sello}` });
    const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const toma = (reg.opcionesToma ?? []).find((o) => o.codigo === "seccion_muestreo") ?? reg.opcionesToma?.[0];
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [{ nombre: `PRUEBA harina calidad ${sello}`, metodoIds: [C.mP.id, C.mH.id], recepcion: { tomaMuestra: toma.codigo, condicionRecepcion: "cumple", identificacionCliente: "PRUEBA" } }],
    });
    C.m1 = r.muestras[0];
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.rP = rs.find((x) => x.catMetodoId === C.mP.id);
    C.rH = rs.find((x) => x.catMetodoId === C.mH.id);
    afirmar(C.rP && C.rH, "faltan ensayos");
    // Especificación de la orden (jefatura, con motivo): proteína 10–14 %, humedad ≤ 12 %.
    await ok(U.jefe, "PATCH", `/flujo/resultado/${C.rP.id}/especificacion`, { tipoDato: "numerico", limiteInf: "10", limiteSup: "14", unidad: "%", motivo: "PRUEBA especificación del cliente" });
    await ok(U.jefe, "PATCH", `/flujo/resultado/${C.rH.id}/especificacion`, { tipoDato: "numerico", limiteInf: null, limiteSup: "12", unidad: "%", motivo: "PRUEBA especificación del cliente" });
    return `${C.ot.codigo} · ${C.m1.codigo}`;
  });

  await paso("§4.2.6 Advertencia: 13,8 en 10–14 (margen 10 % = 0,4) cumple con advertencia; 12,0 no", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { valor: "13,8" });
    afirmar(r.veredicto === "cumple" && r.advertencia === true && /del Máx 14/.test(r.advertenciaMotivo), `captura ${r.veredicto} ${r.advertencia} ${r.advertenciaMotivo}`);
    afirmar(r.reanalisis === null, "una advertencia no abre re-análisis con el modo por defecto");
    const f = await filaDe(C.rP.id);
    afirmar(f.advertencia && f.advertenciaMotivo, "la captura por OT no muestra la advertencia");
    const r2 = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { valor: "12,0", motivo: "PRUEBA corrección de digitación" });
    afirmar(r2.advertencia === false, "12,0 no debe quedar en advertencia");
    return r.advertenciaMotivo;
  });

  await paso("§4.2.6 Re-análisis automático: humedad 13 > 12 No cumple → pendiente; no se revisa (409)", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rH.id}/valor`, { valor: "13" });
    afirmar(r.veredicto === "no_cumple" && r.reanalisis === "solicitado", `captura ${r.veredicto} ${r.reanalisis}`);
    const f = await filaDe(C.rH.id);
    afirmar(f.reanalisis?.estado === "solicitado" && f.reanalisis.origen === "automatico", "la captura no muestra el re-análisis");
    await exigir(409, U.revisor, "POST", `/resultados/${C.rH.id}/revisar`);
    const b = await ok(U.jefe, "GET", "/calidad/reanalisis");
    afirmar(b.some((x) => x.resultadoId === C.rH.id && x.estado === "solicitado"), "no aparece en la bandeja de re-análisis");
    const o = await ok(U.otroLab, "GET", "/calidad/reanalisis");
    afirmar(!o.some((x) => x.resultadoId === C.rH.id), "LMB ve el re-análisis de LQA");
  });

  await paso("Avisos: el jefe de LQA recibe la advertencia y el re-análisis en «Mi bandeja»", async () => {
    await new Promise((r) => setTimeout(r, 800));
    const a = await ok(U.jefe, "GET", "/avisos?limite=100");
    const tipos = (a.data ?? []).filter((x) => x.otId === C.ot.id).map((x) => x.tipo);
    afirmar(tipos.includes("advertencia") && tipos.includes("reanalisis"), `avisos ${JSON.stringify(tipos)}`);
    return tipos.join(", ");
  });

  await paso("Repetir: la nueva captura (sin escribir motivo) cierra el re-análisis; un segundo No cumple no abre otro", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rH.id}/valor`, { valor: "13,2" });
    afirmar(r.veredicto === "no_cumple" && r.reanalisis === "realizado", `repetición ${r.veredicto} ${r.reanalisis}`);
    const f = await filaDe(C.rH.id);
    afirmar(f.reanalisis?.estado === "realizado", "el re-análisis no quedó realizado");
    await ok(U.revisor, "POST", `/resultados/${C.rH.id}/revisar`);
    const b = await ok(U.jefe, "GET", "/calidad/reanalisis?estado=realizado");
    const x = b.find((y) => y.resultadoId === C.rH.id);
    afirmar(x && x.valorAnterior?.veredicto === "no_cumple" && x.valorNuevo, "faltan los valores anterior y repetido");
  });

  await paso("Re-análisis manual del revisor y descarte con motivo por la jefatura", async () => {
    await exigir(400, U.revisor, "POST", `/calidad/resultados/${C.rP.id}/reanalisis`, { motivo: "x" });
    await exigir(403, U.a1, "POST", `/calidad/resultados/${C.rP.id}/reanalisis`, { motivo: "PRUEBA dudas del valor" });
    await ok(U.revisor, "POST", `/calidad/resultados/${C.rP.id}/reanalisis`, { motivo: "PRUEBA réplicas dispersas" });
    await exigir(409, U.revisor, "POST", `/calidad/resultados/${C.rP.id}/reanalisis`, { motivo: "PRUEBA otra vez" });
    await exigir(409, U.revisor, "POST", `/resultados/${C.rP.id}/revisar`);
    const id = (await ok(U.jefe, "GET", "/calidad/reanalisis")).find((x) => x.resultadoId === C.rP.id).id;
    await exigir(403, U.revisor, "POST", `/calidad/reanalisis/${id}/descartar`, { motivo: "PRUEBA no corresponde" });
    await ok(U.jefe, "POST", `/calidad/reanalisis/${id}/descartar`, { motivo: "PRUEBA la dispersión está dentro del método" });
    await ok(U.revisor, "POST", `/resultados/${C.rP.id}/revisar`);
  });

  await paso("§4.3.1 POE: documento del gestor vinculado al método 403; se ve en la captura y el analista lo descarga", async () => {
    const carpetas = (await ok(U.calidad, "GET", "/documentos/carpetas")).carpetas;
    const raiz = carpetas.find((c) => !c.padreId);
    const carp = await ok(U.calidad, "POST", "/documentos/carpetas", { nombre: `PRUEBA POE ${sello}`, padreId: raiz.id });
    C.pdf = Buffer.from(`%PDF-1.4\n% PRUEBA POE proteína ${sello}\n%%EOF\n`);
    const d = await ok(U.calidad, "POST", "/documentos/archivos", undefined, formulario({ carpetaId: carp.id, titulo: `PRUEBA POE proteína Kjeldahl ${sello}` }, "poe.pdf", C.pdf));
    await ok(U.calidad, "POST", `/documentos/archivos/${d.id}/versiones/1/publicar`);
    await exigir(403, U.a1, "POST", `/calidad/metodos/${C.mP.id}/poe`, { documentoId: d.id });
    const ficha = await ok(U.calidad, "POST", `/calidad/metodos/${C.mP.id}/poe`, { documentoId: d.id });
    afirmar(ficha.poe.some((p) => p.documentoId === d.id && p.principal), "no quedó vinculado");
    const f = await filaDe(C.rP.id);
    afirmar(f.poe?.some((p) => p.documentoId === d.id), "la captura no muestra el POE");
    const bin = await exigir(200, U.a1, "GET", `/documentos/archivos/${d.id}/descargar`);
    afirmar(Buffer.isBuffer(bin) && bin.equals(C.pdf), "el analista no descarga el POE");
    return d.codigo;
  });

  await paso("§4.3.5 Acreditación: alcance vigente marca «Acreditado» solo el método 403; vencida no cuenta", async () => {
    await exigir(403, U.a1, "POST", "/calidad/acreditaciones", { numero: `PRUEBA LE ${sello}` });
    await exigir(400, U.calidad, "POST", "/calidad/acreditaciones", { numero: `PRUEBA LE ${sello}`, vigenteDesde: "2026-05-01", vigenteHasta: "2026-01-01" });
    const a = await ok(U.calidad, "POST", "/calidad/acreditaciones", { organismo: "INN", numero: `PRUEBA LE ${sello}`, unidadId: C.lqa.id, vigenteDesde: "2025-01-01", vigenteHasta: "2029-12-31" });
    await exigir(409, U.calidad, "POST", "/calidad/acreditaciones", { organismo: "INN", numero: `PRUEBA LE ${sello}` });
    await ok(U.calidad, "POST", `/calidad/acreditaciones/${a.id}/alcance`, { metodoIds: [C.mP.id], matriz: "PRUEBA harinas", rango: "5 a 30 %" });
    const v = await ok(U.calidad, "POST", "/calidad/acreditaciones", { organismo: "INN", numero: `PRUEBA LE-V ${sello}`, vigenteDesde: "2020-01-01", vigenteHasta: "2021-01-01" });
    await ok(U.calidad, "POST", `/calidad/acreditaciones/${v.id}/alcance`, { metodoIds: [C.mH.id] });
    const fP = await filaDe(C.rP.id);
    const fH = await filaDe(C.rH.id);
    afirmar(fP.acreditacion?.numero === `PRUEBA LE ${sello}` && !fH.acreditacion, `acreditado P=${JSON.stringify(fP.acreditacion)} H=${JSON.stringify(fH.acreditacion)}`);
    const l = await ok(U.a1, "GET", "/calidad/acreditaciones");
    afirmar(l.some((x) => x.id === a.id && x.alcance.length === 1), "el listado no trae el alcance");
  });

  await paso("Margen propio del método: 0 % apaga la advertencia; vacío vuelve al general", async () => {
    await exigir(400, U.calidad, "PATCH", `/calidad/metodos/${C.mP.id}/margen`, { margenPct: 80 });
    await ok(U.calidad, "PATCH", `/calidad/metodos/${C.mP.id}/margen`, { margenPct: 0 });
    await ok(U.revisor, "POST", `/resultados/${C.rP.id}/devolver`, { motivo: "PRUEBA repetir con margen del método" });
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { valor: "13,9", motivo: "PRUEBA repetición" });
    afirmar(r.veredicto === "cumple" && r.advertencia === false, `con margen 0: ${r.advertencia}`);
    await ok(U.calidad, "PATCH", `/calidad/metodos/${C.mP.id}/margen`, { margenPct: null });
  });

  await paso("§4.2.1 Alícuotas: 3 de 10 g, consumo, exceso rechazado, descarte con motivo, alcance por laboratorio", async () => {
    const c = await ok(U.a1, "POST", `/calidad/muestras/${C.m1.id}/alicuotas`, { n: 3, cantidad: "10", unidad: "g", proposito: "PRUEBA humedad" });
    afirmar(c.creadas.length === 3 && c.creadas[2] === `${C.m1.codigo}-A3`, `códigos ${c.creadas}`);
    let d = await ok(U.a1, "GET", `/calidad/muestras/${C.m1.id}/alicuotas`);
    const [a1, a2] = d.alicuotas;
    const m = await ok(U.a1, "POST", `/calidad/alicuotas/${a1.id}/movimiento`, { tipo: "consumo", cantidad: "4", resultadoId: C.rH.id });
    afirmar(m.estado === "en_uso" && m.cantidadRestante === 6, `consumo ${JSON.stringify(m)}`);
    await exigir(400, U.a1, "POST", `/calidad/alicuotas/${a1.id}/movimiento`, { tipo: "consumo", cantidad: "7" });
    await ok(U.a1, "POST", `/calidad/alicuotas/${a1.id}/movimiento`, { tipo: "consumo", cantidad: "6" });
    await exigir(400, U.a1, "POST", `/calidad/alicuotas/${a1.id}/movimiento`, { tipo: "consumo", cantidad: "1" });
    await exigir(400, U.a1, "POST", `/calidad/alicuotas/${a2.id}/movimiento`, { tipo: "estado", estado: "descartada" });
    await ok(U.a1, "POST", `/calidad/alicuotas/${a2.id}/movimiento`, { tipo: "estado", estado: "descartada", detalle: "PRUEBA derrame" });
    d = await ok(U.a1, "GET", `/calidad/muestras/${C.m1.id}/alicuotas`);
    const e = d.alicuotas.map((x) => x.estado);
    afirmar(e.join() === "consumida,descartada,disponible" && d.alicuotas[0].movimientos.length === 3, `estados ${e} movs ${d.alicuotas[0].movimientos.length}`);
    await exigir(403, U.otroLab, "GET", `/calidad/muestras/${C.m1.id}/alicuotas`);
    await exigir(403, U.otroLab, "POST", `/calidad/muestras/${C.m1.id}/alicuotas`, { n: 1 });
    const b = await ok(U.a1, "GET", `/calidad/muestras?q=${encodeURIComponent(C.m1.codigo)}`);
    afirmar(b.some((x) => x.id === C.m1.id && x.alicuotas === 3), "el buscador no encuentra la muestra");
    return e.join(", ");
  });
}

main()
  .then(() => {
    console.log(`\nCalidad de resultados: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    process.exit(1);
  });
