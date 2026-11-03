#!/usr/bin/env node
/**
 * Verificación contra una API real de comunicación y CRM
 * (packages/db/align_comunicacion.sql, contrato §4.1.2, §4.5.4, §4.5.5, §4.5.6):
 *   · plantillas de correo editables por etapa, marcadores validados y envío
 *     automático al crear la OT y al recibir sus muestras;
 *   · correo libre con adjuntos vinculado a una OT, con alcance;
 *   · búsqueda del historial por remitente, destinatario, urgencia, adjuntos,
 *     palabras clave y fechas;
 *   · mensajería interna con adjuntos, urgencia, respuesta en hilo, leído y
 *     archivado, solo visible a remitente y destinatarios;
 *   · historial de interacciones y línea de tiempo del cliente.
 * Sin servidor de correo, los correos quedan registrados como «sin_configurar»
 * (o «error») sin romper la operación.
 *
 * Uso:
 *   node scripts/verificacion/comunicacion.js [--base http://localhost:3001/api]
 *
 * Variables: CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA). Todo lo que crea lleva
 * «PRUEBA»; enciende el envío automático de dos plantillas: úsese en una base
 * de pruebas.
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
  sesiones[username] = { token: j.accessToken, id: j.user?.id ?? null, nombre: j.user?.nombreCompleto ?? j.user?.nombre ?? null };
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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n% PRUEBA adjunto\n"), Buffer.alloc(64, 32)]);
const CSV = Buffer.from("muestra;valor\nPRUEBA-1;12,4\n");
function formulario(campos, adjuntos = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) f.append(k, String(v));
  for (const a of adjuntos) f.append("adjuntos", new Blob([a.datos], { type: a.tipo }), a.nombre);
  return f;
}
/** Correos de la bitácora que cumplen un filtro (los automáticos salen en segundo plano). */
async function correos(u, filtro, minimo = 1, intentos = 12) {
  for (let i = 0; i < intentos; i++) {
    const r = lista(await ok(u, "GET", `/mensajeria?${new URLSearchParams(filtro)}`));
    if (r.length >= minimo) return r;
    await esperar(500);
  }
  return lista(await ok(u, "GET", `/mensajeria?${new URLSearchParams(filtro)}`));
}

/* ---------------------------------------------------------------- datos --- */
const U = {
  admin: "demo.admin",
  ventas: "demo.ventas",
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  lqaJefe: "demo.lqa.jefe",
  lqaAnalista: "demo.lqa.analista1",
  lmbAnalista: "demo.lmb.analista1",
  auditor: "demo.auditor",
};
const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
const NO_ENVIADO = ["enviado", "sin_configurar", "error"];
const C = {};

async function main() {
  console.log(`Comunicación y CRM contra ${BASE}`);

  await paso("Plantillas por etapa: Comercial las lee, no las edita; marcadores, scripts y automático en etapa manual se rechazan", async () => {
    const r = await ok(U.ventas, "GET", "/mensajeria/plantillas");
    afirmar(r.etapas.length === 6 && r.data.length >= 8, `etapas ${r.etapas.length}, plantillas ${r.data.length}`);
    C.ot_creada = r.data.find((p) => p.clave === "ot_creada");
    C.resultado = r.data.find((p) => p.clave === "resultado_estandar");
    afirmar(C.ot_creada?.id && C.resultado?.id, "faltan las plantillas iniciales");
    await exigir(403, U.ventas, "PATCH", `/mensajeria/plantillas/${C.ot_creada.id}`, { asunto: "x y z" });
    await exigir(400, U.admin, "PATCH", `/mensajeria/plantillas/${C.ot_creada.id}`, { asunto: "PRUEBA {{total}} {{codigo}}" });
    await exigir(400, U.admin, "PATCH", `/mensajeria/plantillas/${C.ot_creada.id}`, { cuerpo: "<p>Hola</p><script>alert(1)</script>" });
    await exigir(400, U.admin, "PATCH", `/mensajeria/plantillas/${C.resultado.id}`, { automatico: true });
    return `${r.etapas.length} etapas, ${r.data.length} plantillas`;
  });

  await paso("Administración edita «OT creada» y enciende su envío automático; crea una variante automática de «Muestras recibidas»", async () => {
    const p = await ok(U.admin, "PATCH", `/mensajeria/plantillas/${C.ot_creada.id}`, {
      asunto: "PRUEBA · OT {{codigo}} registrada", automatico: true, activa: true,
    });
    afirmar(p.automatico && p.asunto.startsWith("PRUEBA") && p.actualizadoPor, JSON.stringify(p).slice(0, 200));
    const v = await ok(U.admin, "POST", "/mensajeria/plantillas", {
      etapa: "muestras_recibidas", nombre: `PRUEBA muestras ${sello}`, asunto: "PRUEBA · {{cantidad}} muestra(s) de {{codigo}}",
      cuerpo: "<p>Estimado(a) {{cliente}}: recibimos {{muestras}}.</p>",
    });
    await ok(U.admin, "PATCH", `/mensajeria/plantillas/${v.id}`, { automatico: true });
    const r = await ok(U.admin, "GET", "/mensajeria/plantillas");
    const auto = r.data.filter((x) => x.etapa === "muestras_recibidas" && x.automatico);
    afirmar(auto.length === 1 && auto[0].id === v.id, "una sola automática por etapa");
    C.variante = v;
  });

  await paso("Envío automático: al crear la OT y al registrar sus muestras sale el correo al cliente y queda en la bitácora", async () => {
    C.lqa = lista(await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQA");
    const buscar = async (codigo) => lista(await ok(U.lqaJefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
    const mH = await buscar("395");
    afirmar(C.lqa && mH, "faltan LQA o el método 395");
    const base = 76000000 + (Number(sello.slice(-6)) % 999999);
    C.cliente = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(base), razonSocial: `Cliente PRUEBA Comunicación ${sello}`, tipo: "particulares", giro: "Pruebas", direccion: "Calle Prueba 1",
      email: `prueba.${sello}@cliente-prueba.cl`,
    });
    C.ot = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: C.lqa.id, conCobro: false, descripcionTrabajo: `OT-PRUEBA comunicación ${sello}` });
    const c1 = await correos(U.ventas, { otId: C.ot.id, tipo: "etapa" }, 1);
    afirmar(c1.length === 1 && c1[0].plantilla === "ot_creada" && c1[0].asunto === `PRUEBA · OT ${C.ot.codigo} registrada`, JSON.stringify(c1).slice(0, 300));
    afirmar(NO_ENVIADO.includes(c1[0].estado) && c1[0].enviado_por_nombre && c1[0].cliente_nombre === C.cliente.razonSocial, `estado ${c1[0].estado}`);
    const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const toma = (reg.opcionesToma ?? []).find((o) => o.codigo === "seccion_muestreo") ?? reg.opcionesToma?.[0];
    const rec = { tomaMuestra: toma.codigo, condicionRecepcion: "cumple", identificacionCliente: "PRUEBA" };
    await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [1, 2].map((n) => ({ nombre: `PRUEBA harina ${n} ${sello}`, metodoIds: [mH.id], recepcion: rec })),
    });
    const c2 = await correos(U.ventas, { otId: C.ot.id, tipo: "etapa" }, 2);
    const m = c2.find((x) => x.plantilla === C.variante.clave);
    afirmar(m && m.asunto === `PRUEBA · 2 muestra(s) de ${C.ot.codigo}`, JSON.stringify(c2.map((x) => x.asunto)));
    C.estadoSmtp = c1[0].estado;
    return `estado del correo sin servidor: ${c1[0].estado}`;
  });

  await paso("Correo libre con adjuntos (PDF y CSV), urgente y vinculado a la OT; .exe y alcance ajeno rechazados; adjunto descargable", async () => {
    const r = await ok(U.ventas, "POST", "/mensajeria/correo", undefined, formulario(
      { destinatarios: `prueba.${sello}@cliente-prueba.cl`, asunto: `PRUEBA informe parcial ${sello}`, cuerpo: "Adjuntamos avance.\n\nSaludos.", prioridad: "urgente", otCodigo: C.ot.codigo },
      [{ nombre: "avance PRUEBA.pdf", tipo: "application/pdf", datos: PDF }, { nombre: "datos PRUEBA.csv", tipo: "text/csv", datos: CSV }],
    ));
    afirmar(r.id && NO_ENVIADO.includes(r.estado), JSON.stringify(r));
    C.correo = r.id;
    await exigir(400, U.ventas, "POST", "/mensajeria/correo", undefined, formulario(
      { destinatarios: "x@cliente-prueba.cl", asunto: "PRUEBA exe", cuerpo: "x" }, [{ nombre: "virus.exe", tipo: "application/octet-stream", datos: Buffer.from("MZ") }],
    ));
    await exigir(403, U.lmbAnalista, "POST", "/mensajeria/correo", undefined, formulario({ destinatarios: "x@cliente-prueba.cl", asunto: "PRUEBA ajena", cuerpo: "x", otCodigo: C.ot.codigo }));
    const h = lista(await ok(U.ventas, "GET", `/mensajeria?q=${sello}&tipo=otro`));
    const fila = h.find((x) => x.id === C.correo);
    afirmar(fila && fila.prioridad === "urgente" && fila.n_adjuntos === 2 && fila.asunto.startsWith("[URGENTE]") && fila.ot_codigo === C.ot.codigo, JSON.stringify(fila).slice(0, 300));
    const pdf = fila.adjuntos.find((a) => a.nombre === "avance PRUEBA.pdf");
    const bin = await ok(U.ventas, "GET", `/mensajeria/correos/${C.correo}/adjuntos/${pdf.id}`);
    afirmar(Buffer.isBuffer(bin) && bin.equals(PDF), "el adjunto descargado no coincide");
  });

  await paso("Búsqueda del historial: remitente, destinatario, asunto, urgencia, con/sin adjuntos, palabras clave y fechas", async () => {
    const yo = await login(U.ventas);
    const nombre = (yo.nombre ?? "").split(" ")[0] || "demo";
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const buscar = async (q) => lista(await ok(U.ventas, "GET", `/mensajeria?${new URLSearchParams(q)}`)).map((x) => x.id);
    afirmar((await buscar({ prioridad: "urgente", adjuntos: "si", q: sello })).includes(C.correo), "urgente + adjuntos");
    afirmar(!(await buscar({ adjuntos: "no", q: sello })).includes(C.correo), "sin adjuntos lo excluye");
    afirmar((await buscar({ remitente: nombre, destinatario: `prueba.${sello}`, asunto: "informe parcial" })).includes(C.correo), `remitente ${nombre}`);
    afirmar((await buscar({ desde: hoy, hasta: hoy, q: "informe parcial" })).includes(C.correo), "rango de fechas de hoy");
    afirmar(!(await buscar({ hasta: "2020-01-01", q: sello })).length, "fechas pasadas no lo traen");
    afirmar((await buscar({ remitente: "Sistema LIMS", otId: C.ot.id })).length >= 2, "los automáticos tienen remitente «Sistema LIMS»");
    afirmar(!(await buscar({ prioridad: "alta", q: sello })).includes(C.correo), "urgencia distinta lo excluye");
  });

  await paso("Mensajería interna: el jefe LQA escribe al analista con adjunto, urgencia alta, OT vinculada y copia por correo", async () => {
    const an = await login(U.lqaAnalista);
    const r = await ok(U.lqaJefe, "POST", "/mensajes", undefined, formulario(
      { destinatarios: an.id, asunto: `PRUEBA repetir humedad ${sello}`, cuerpo: "Repita la humedad de la muestra 2.\nGracias.", prioridad: "alta", otCodigo: C.ot.codigo, copiaCorreo: "true" },
      [{ nombre: "criterio PRUEBA.pdf", tipo: "application/pdf", datos: PDF }],
    ));
    // Sin correo registrado del destinatario no hay copia (correo null); con correo, queda en la bitácora.
    afirmar(r.id && r.adjuntos === 1 && (r.correo === null || NO_ENVIADO.includes(r.correo)), JSON.stringify(r));
    C.msg = r.id;
    await exigir(403, U.lmbAnalista, "POST", "/mensajes", undefined, formulario({ destinatarios: an.id, asunto: "PRUEBA ajena", cuerpo: "x", otCodigo: C.ot.codigo }));
    await exigir(400, U.lqaJefe, "POST", "/mensajes", undefined, formulario({ destinatarios: (await login(U.lqaJefe)).id, asunto: "PRUEBA a mí", cuerpo: "x" }));
    // La copia la ve en el historial de correos su remitente; un tercero (Ventas) no, aunque vea la OT.
    const copia = lista(await ok(U.lqaJefe, "GET", `/mensajeria?tipo=mensaje&q=${sello}`));
    afirmar(copia.length === (r.correo ? 1 : 0) && (!r.correo || copia[0].asunto.includes("[Prioridad alta]")), "copia por correo en la bitácora");
    afirmar(!lista(await ok(U.ventas, "GET", `/mensajeria?tipo=mensaje&q=${sello}`)).length, "un tercero no ve la copia del mensaje interno");
    return r.correo ? `copia por correo: ${r.correo}` : "destinatario sin correo registrado: sin copia";
  });

  await paso("Bandeja: no leído, búsqueda, lectura con adjunto, respuesta en hilo, archivado; un tercero no lo ve", async () => {
    const b = await ok(U.lqaAnalista, "GET", `/mensajes?noLeidos=true&q=${sello}`);
    const m = b.data.find((x) => x.id === C.msg);
    afirmar(m && !m.leidoAt && m.nAdjuntos === 1 && m.prioridad === "alta" && m.otCodigo === C.ot.codigo && b.noLeidos >= 1, JSON.stringify(b).slice(0, 300));
    afirmar(!lista(await ok(U.lqaAnalista, "GET", `/mensajes?adjuntos=no&q=${sello}`)).some((x) => x.id === C.msg), "filtro sin adjuntos");
    const nombreJefe = ((await login(U.lqaJefe)).nombre ?? "").split(" ")[0];
    afirmar(lista(await ok(U.lqaAnalista, "GET", `/mensajes?${new URLSearchParams({ remitente: nombreJefe, prioridad: "alta", q: "humedad" })}`)).some((x) => x.id === C.msg), `remitente ${nombreJefe}`);
    const d = await ok(U.lqaAnalista, "GET", `/mensajes/${C.msg}`);
    afirmar(d.cuerpo.includes("Repita la humedad") && d.adjuntos.length === 1, "detalle");
    const bin = await ok(U.lqaAnalista, "GET", `/mensajes/${C.msg}/adjuntos/${d.adjuntos[0].id}`);
    afirmar(Buffer.isBuffer(bin) && bin.equals(PDF), "adjunto del mensaje");
    afirmar(!lista(await ok(U.lqaAnalista, "GET", `/mensajes?noLeidos=true&q=${sello}`)).some((x) => x.id === C.msg), "quedó leído");
    await exigir(404, U.lmbAnalista, "GET", `/mensajes/${C.msg}`);
    const jefe = await login(U.lqaJefe);
    const resp = await ok(U.lqaAnalista, "POST", "/mensajes", undefined, formulario({ destinatarios: jefe.id, asunto: `Re: PRUEBA repetir humedad ${sello}`, cuerpo: "Hecho: 12,1 %.", respuestaA: C.msg }));
    const dj = await ok(U.lqaJefe, "GET", `/mensajes/${resp.id}`);
    afirmar(dj.hilo.length === 1 && dj.hilo[0].id === C.msg, "hilo de la respuesta");
    afirmar(lista(await ok(U.lqaJefe, "GET", `/mensajes?bandeja=enviados&q=${sello}`)).some((x) => x.id === C.msg), "enviados del jefe");
    await ok(U.lqaAnalista, "POST", `/mensajes/${C.msg}/archivar`);
    afirmar(lista(await ok(U.lqaAnalista, "GET", `/mensajes?bandeja=archivados&q=${sello}`)).some((x) => x.id === C.msg), "archivados");
    afirmar(!lista(await ok(U.lqaAnalista, "GET", `/mensajes?q=${sello}`)).some((x) => x.id === C.msg), "fuera de recibidos");
    await exigir(400, U.lqaJefe, "POST", `/mensajes/${C.msg}/archivar`);
  });

  await paso("CRM: Comercial registra una llamada y una visita; fecha futura 400; el Lector no registra (403)", async () => {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    C.llamada = await ok(U.ventas, "POST", `/clientes/${C.cliente.id}/interacciones`, {
      tipo: "llamada", fecha: `${hoy}T09:15`, asunto: `PRUEBA llamada de seguimiento ${sello}`, contacto: "Contacto PRUEBA",
      detalle: "Consulta por plazos.", proximaAccion: "Enviar informe parcial", proximaFecha: "2026-12-01", otId: C.ot.id,
    });
    afirmar(C.llamada.id && C.llamada.otCodigo === C.ot.codigo && C.llamada.responsable, JSON.stringify(C.llamada).slice(0, 200));
    await ok(U.ventas, "POST", `/clientes/${C.cliente.id}/interacciones`, { tipo: "visita", fecha: "2026-10-20", asunto: `PRUEBA visita a planta ${sello}` });
    await exigir(400, U.ventas, "POST", `/clientes/${C.cliente.id}/interacciones`, { tipo: "nota", fecha: "2030-01-01T10:00", asunto: "PRUEBA futura" });
    await exigir(400, U.ventas, "POST", `/clientes/${C.cliente.id}/interacciones`, { tipo: "nota", fecha: `${hoy}T08:00`, asunto: "PRUEBA sin acción", proximaFecha: "2026-12-01" });
    await exigir(403, U.auditor, "POST", `/clientes/${C.cliente.id}/interacciones`, { tipo: "nota", fecha: `${hoy}T08:00`, asunto: "PRUEBA lector" });
  });

  await paso("Línea de tiempo del cliente: interacciones, OT, correos y filtro por tipo; quien no ve clientes, 403", async () => {
    const h = await ok(U.ventas, "GET", `/clientes/${C.cliente.id}/historial`);
    const clases = new Set(h.data.map((x) => x.clase));
    afirmar(clases.has("interaccion") && clases.has("ot") && clases.has("correo"), `clases ${[...clases]}`);
    afirmar(h.conteo.interaccion === 2 && h.conteo.correo >= 3 && h.conteo.ot === 1, JSON.stringify(h.conteo));
    const fechas = h.data.map((x) => Date.parse(x.fecha));
    afirmar(fechas.every((t, i) => i === 0 || fechas[i - 1] >= t), "orden descendente");
    const solo = await ok(U.ventas, "GET", `/clientes/${C.cliente.id}/historial?clases=interaccion`);
    afirmar(solo.data.length === 2 && solo.data.every((x) => x.clase === "interaccion"), "filtro por clase");
    await exigir(403, U.lqaAnalista, "GET", `/clientes/${C.cliente.id}/historial`);
    await ok(U.ventas, "DELETE", `/clientes/${C.cliente.id}/interacciones/${C.llamada.id}`);
    afirmar((await ok(U.ventas, "GET", `/clientes/${C.cliente.id}/historial?clases=interaccion`)).data.length === 1, "anulada");
    return JSON.stringify(h.conteo);
  });

  const fallos = pasos.filter((p) => !p.ok).length;
  console.log(`\n${pasos.length - fallos}/${pasos.length} pasos correctos.`);
  if (fallos) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nDetenido: ${e.message}`);
  console.log(`${pasos.filter((p) => p.ok).length}/${pasos.length} pasos correctos.`);
  process.exitCode = 1;
});
