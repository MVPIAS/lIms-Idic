#!/usr/bin/env node
/**
 * Frente r4c · bandejas por rol, avisos, despacho y entrega, oficio conductor,
 * reportes de gestión y carpeta de trabajo (T14, T20, T03, T23).
 * Recorre de punta a punta, con perfiles demo.* que pueden y que no:
 *
 *   T14  «OT sin plazo · Asignar plazo» con «lo que le toca» (= /ot?semaforo=sin_fecha);
 *        documentos por despachar, despachos por recibir, oficios por firmar,
 *        por despachar y devueltos; enlaces de cada fila; Ruta de la inspección
 *        del BPCH; OT de la D11 en su ruta de armas desde que nace.
 *   T20  Plazo asignado por el laboratorio y «Notificar plazo al cliente»;
 *        «Avisar →» y avisos internos sin repetir; aviso No cumple al aprobar
 *        (contrato §4.2.6); «documento listo» a Comercial; «Despachar →» al DCO,
 *        recepción y recepción en DCO con días de atraso; documentos no-informe
 *        con versión; envío conjunto con guía. Sin correo configurado nada falla.
 *   T03  Oficio conductor del documento y de la cotización: número de la
 *        unidad, matriz OFICIO (V°B° → firma), devolución, despacho por la
 *        Oficina de partes; parámetro «oficio_conductor».
 *   T23  Reporte de gestión con Excel; Carpeta de Trabajo y su archivo.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r4-r4c.js [--arrancar] [--base http://localhost:4861/api]
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o CLAVE_DEMO_EMBEBIDA de
 * apps/api/src/auth/auth.service.ts (no se escribe aquí). Deja datos de prueba
 * ficticios (Cliente prueba r4c…): úsese en una base de pruebas. Se puede correr
 * varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4861/api");
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
    const carga = JSON.parse(Buffer.from(j.accessToken.split(".")[1], "base64url").toString("utf8"));
    sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id ?? carga.sub };
    return sesiones[username];
  }
  throw new Error(`login ${username}: demasiados intentos`);
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = username ? await login(username) : null;
  const esForm = typeof FormData !== "undefined" && cuerpo instanceof FormData;
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
      ...(cuerpo !== undefined && !esForm ? { "content-type": "application/json" } : {}),
    },
    body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json, tipo: r.headers.get("content-type") ?? "" };
}
const msg = (j) =>
  (typeof j === "string"
    ? j
    : j?.message
      ? `${Array.isArray(j.message) ? j.message.join("; ") : j.message}${Array.isArray(j.issues) ? ` · ${j.issues.map((i) => i.message).join("; ")}` : ""}`
      : JSON.stringify(j)
  ).slice(0, 400);
async function exigir(esperado, username, metodo, ruta, cuerpo, patron) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username ?? "anónimo"} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  if (patron && !patron.test(msg(r.json))) throw new Error(`${username} ${metodo} ${ruta}: el mensaje «${msg(r.json)}» no dice ${patron}`);
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
    // R4C_HASTA="11.11" deja la OT a medio camino (para recorrerla en el navegador).
    if (process.env.R4C_HASTA && nombre.startsWith(process.env.R4C_HASTA)) {
      console.log(`
Detenido tras «${nombre}» (R4C_HASTA).`);
      pararApi();
      process.exit(0);
    }
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
  const puerto = new URL(BASE).port || "4861";
  const env = {
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4862",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r4-r4c-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ AYUDAS === */
const U = {
  ventas: "demo.ventas",
  recepcion: "demo.recepcion",
  planif: "demo.planificacion",
  dco: "demo.dco.jefe",
  jefe: "demo.lqc.jefe",
  a1: "demo.lqc.analista1",
  a2: "demo.lqc.analista2",
  rev: "demo.lqc.revisor",
  dqo: "demo.dqo.jefe",
  director: "demo.director",
  calidad: "demo.calidad",
  finanzas: "demo.finanzas",
  otroLab: "demo.lpn.analista1",
  lpnJefe: "demo.lpn.jefe",
  auditor: "demo.auditor",
  admin: "demo.admin",
  stgo: "demo.sstgo.jefe",
  stgoInsp: "demo.sstgo.inspector",
  muestreo: "demo.muestreo",
};
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sumar = (dia, n) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const bandeja = async (u) => Object.fromEntries((await ok(u, "GET", "/me/bandeja")).map((i) => [i.clave, i]));
const POSIBLES_FIRMANTES = [U.jefe, U.rev, U.a1, U.a2, U.dqo, U.director, U.calidad, "demo.squ.jefe", U.dco];
const CONF = "/parametros/configurables";

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(4, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of [...new Set([...Object.values(U), ...POSIBLES_FIRMANTES])]) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });
  const porId = () => Object.fromEntries(Object.entries(sesiones).map(([u, s]) => [s.id, u]));

  /* ------------------------------------------------ preparación: OT de LQC */
  await paso("Preparación · cotización firmada y aceptada → OT de LQC sin plazo en la cotización", async () => {
    const buscar = async (codigo) => lista(await ok(U.jefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
    C.mPh = await buscar("251");
    C.mAzufre = await buscar("258");
    afirmar(C.mPh && C.mAzufre, "faltan los métodos 251/258 de LQC");
    C.lqc = (await ok(U.ventas, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQC");
    const cfg = await ok(U.ventas, "GET", "/cotizaciones/config");
    const tipo = ((cfg?.parametros?.tipo_cliente ?? []).find((t) => t.codigo === "ejercito") ?? {}).codigo ?? "ejercito";
    const cuerpo = String(71000000 + (Number(sello.slice(-7)) % 999999));
    let s = 0, m = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
    const dv = 11 - (s % 11);
    C.cliente = await ok(U.ventas, "POST", "/clientes", { rut: `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`, razonSocial: `Cliente prueba r4c ${sello}`, tipo, email: "r4c@example.cl" });
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", referencia: `r4c ${sello}`,
      lineas: [{ catEnsayoId: C.mPh.ensayoId, cantidad: 1 }, { catEnsayoId: C.mAzufre.ensayoId, cantidad: 1 }],
    });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-r4c-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.lqc.id,
    });
    C.ot = await ok(U.jefe, "GET", `/ot/${r?.ot?.id ?? r?.otId}`);
    afirmar(!C.ot.fechaCompromiso, `la OT trae fecha de compromiso ${C.ot.fechaCompromiso} (la cotización no tenía plazo)`);
    return `${C.cot.codigo} → ${C.ot.codigo} (LQC, sin plazo)`;
  });

  /* ------------------------------------------------ T14 · Mi bandeja */
  await paso("T14 · «OT sin plazo · Asignar plazo»: tarjeta del Jefe LQC con la OT en su lista; = /ot?semaforo=sin_fecha", async () => {
    const b = await bandeja(U.jefe);
    const t = b.ot_sin_plazo;
    afirmar(t && t.cantidad >= 1, "el Jefe LQC no tiene la tarjeta «OT sin plazo»");
    afirmar((t.elementos ?? []).length >= 1 && t.elementos.every((e) => e.ruta && e.texto), "la tarjeta no trae «lo que le toca»");
    const l = await ok(U.jefe, "GET", "/ot?semaforo=sin_fecha&limit=1");
    afirmar((l.meta?.total ?? lista(l).length) === t.cantidad, `tarjeta ${t.cantidad} ≠ lista ${l.meta?.total}`);
    const bo = await bandeja(U.otroLab);
    afirmar(!bo.ot_sin_plazo, "un analista de LPN ve «OT sin plazo»");
    return `${t.cantidad} OT · primera ${t.elementos[0].texto}`;
  });

  await paso("T20 · Plazo: el laboratorio lo asigna; «Notificar plazo al cliente» (Ventas sí; analista 403; sin correo configurado queda registrado)", async () => {
    await exigir(409, U.ventas, "POST", `/ot/${C.ot.id}/notificar-plazo`, { medio: "oficio" }, /fecha de compromiso/);
    C.compromiso = sumar(hoyCl(), 2);
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/fecha-compromiso`, { fecha: C.compromiso, motivo: "Plazo fijado por el laboratorio (prueba r4c)" });
    await exigir(403, U.a1, "POST", `/ot/${C.ot.id}/notificar-plazo`, { medio: "oficio" });
    const r = await ok(U.ventas, "POST", `/ot/${C.ot.id}/notificar-plazo`, { medio: "correo", destinatarios: ["r4c@example.cl"] });
    afirmar(["sin_configurar", "error", "enviado"].includes(r.correo), `correo ${r.correo}`);
    afirmar(r.plazo.notificadoAt && r.plazo.medio === "correo", "el aviso del plazo no quedó registrado");
    const h = await ok(U.jefe, "GET", `/ot/${C.ot.id}/historial`);
    afirmar(h.some((x) => x.tipo === "plazo_notificado"), "sin hito en el historial");
    return `entrega ${C.compromiso} informada · correo: ${r.correo}`;
  });

  await paso("T20 · Avisos de plazo: «Avisar →» (Planificación sí; analista 403) → aviso al Jefe LQC con hito; no se repite", async () => {
    await exigir(403, U.a1, "POST", "/avisos/plazos", { otIds: [C.ot.id] });
    const r = await ok(U.planif, "POST", "/avisos/plazos", { otIds: [C.ot.id] });
    afirmar(r.porVencer === 1 && r.personas >= 1, `resultado ${JSON.stringify(r)}`);
    const a = await ok(U.jefe, "GET", "/avisos?noLeidos=1");
    const mio = a.data.find((x) => x.tipo === "ot_por_vencer" && x.otCodigo === C.ot.codigo);
    afirmar(mio, "el Jefe LQC no recibió el aviso «OT por vencer»");
    afirmar(["sin_configurar", "sin_correo", "error", "enviado"].includes(mio.correoEstado), `correo ${mio.correoEstado}`);
    const otro = await ok(U.otroLab, "GET", "/avisos");
    afirmar(!otro.data.some((x) => x.otCodigo === C.ot.codigo), "el analista de LPN recibió el aviso de una OT de LQC");
    await ok(U.jefe, "POST", `/avisos/${mio.id}/leido`, {});
    const b = await ok(U.jefe, "GET", "/avisos?noLeidos=1");
    afirmar(!b.data.some((x) => x.id === mio.id), "el aviso sigue sin leer");
    // La revisión automática no repite el «por vencer» de la misma fecha.
    const auto = await ok(U.planif, "POST", "/avisos/plazos", {});
    const c = await ok(U.jefe, "GET", "/avisos?noLeidos=1");
    afirmar(!c.data.some((x) => x.tipo === "ot_por_vencer" && x.otCodigo === C.ot.codigo), "el aviso automático se repitió");
    return `aviso ${mio.correoEstado} · leído · revisión general: ${auto.porVencer} por vencer, ${auto.vencidas} vencidas`;
  });

  /* ------------------------------------------------ captura con No cumple */
  await paso("Preparación · muestra, asignación, captura (pH 9,9 No cumple), revisión", async () => {
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, { muestras: [{ nombre: "Muestra r4c", metodoIds: [C.mPh.id, C.mAzufre.id] }] });
    C.muestra = r.muestras[0];
    await ok(U.jefe, "PUT", `/ot/${C.ot.id}/analistas`, { usuarioIds: [sesiones[U.a1].id] });
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.rPh = rs.find((x) => x.catMetodoId === C.mPh.id);
    C.rAz = rs.find((x) => x.catMetodoId === C.mAzufre.id);
    if (!(C.rPh.limiteInf && C.rPh.limiteSup)) await ok(U.a1, "PATCH", `/flujo/resultado/${C.rPh.id}/especificacion`, { limiteInf: "6,5", limiteSup: "8,5" });
    const v = await ok(U.a1, "POST", `/flujo/resultado/${C.rPh.id}/valor`, { valor: "9,9" });
    afirmar(v.veredicto === "no_cumple", `veredicto ${v.veredicto}`);
    await ok(U.a1, "PATCH", `/flujo/resultado/${C.rAz.id}/especificacion`, { limiteInf: "0", limiteSup: "0,5", unidad: "%" });
    await ok(U.a1, "POST", `/flujo/resultado/${C.rAz.id}/valor`, { valor: "0,3" });
    await ok(U.rev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    return `${C.muestra.codigo}: pH 9,9 No cumple · Azufre 0,3 cumple`;
  });

  await paso("T20 · Contrato §4.2.6: al aprobar un No cumple, el Jefe LQC recibe el aviso (sin correo configurado no falla)", async () => {
    await ok(U.jefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    let aviso = null;
    for (let i = 0; i < 20 && !aviso; i++) {
      aviso = (await ok(U.jefe, "GET", "/avisos?noLeidos=1")).data.find((x) => x.tipo === "no_cumple" && x.otCodigo === C.ot.codigo);
      if (!aviso) await new Promise((ok2) => setTimeout(ok2, 250));
    }
    afirmar(aviso, "el Jefe LQC no recibió el aviso «Resultado No cumple»");
    afirmar(aviso.severidad === "alta" && /No cumple/.test(aviso.titulo), aviso.titulo);
    const otro = await ok(U.lpnJefe, "GET", "/avisos");
    afirmar(!otro.data.some((x) => x.otCodigo === C.ot.codigo), "el Jefe LPN recibió el aviso");
    return `${aviso.titulo} · correo: ${aviso.correoEstado}`;
  });

  /* ------------------------------------------------ emisión, firmas y oficial */
  await paso("Preparación · emitir y firmar el informe según la matriz → oficial (aviso «documento listo» a Comercial)", async () => {
    const pl = lista(await ok(U.jefe, "GET", "/plantillas?limit=200"));
    const plantilla = pl.find((p) => p.repid === "BolAn") ?? pl.find((p) => p.tipo === "BOLETIN" && p.activo !== false);
    const r = await ok(U.jefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: plantilla.id });
    C.docId = (r.certificado ?? r.documento ?? r).id ?? r.certificadoId;
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    const ids = porId();
    const hechos = new Set();
    for (const orden of [...new Set(circ.pasos.map((p) => p.orden))].sort((a, b) => a - b))
      for (const p of circ.pasos.filter((x) => x.orden === orden)) {
        const cands = (p.responsables ?? []).map((x) => ids[x.usuarioId]).filter(Boolean);
        const quien = cands.find((u) => !hechos.has(u)) ?? cands[0];
        afirmar(quien, `paso ${orden} sin firmante de prueba`);
        await ok(quien, "POST", `/informes/${C.docId}/firmar`, {});
        hechos.add(quien);
      }
    const fin = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    afirmar(fin.estado === "oficial", `estado ${fin.estado}`);
    C.docNumero = fin.numero;
    let aviso = null;
    for (let i = 0; i < 20 && !aviso; i++) {
      aviso = (await ok(U.ventas, "GET", "/avisos?noLeidos=1")).data.find((x) => x.tipo === "documento_listo" && x.otCodigo === C.ot.codigo);
      if (!aviso) await new Promise((ok2) => setTimeout(ok2, 250));
    }
    afirmar(aviso, "Ventas (ejecutivo de la cotización) no recibió «Documento oficial»");
    afirmar(fin.puedo.despachar === true, "el Jefe LQC no ve «Despachar →»");
    return `${C.docNumero} oficial · aviso a Ventas`;
  });

  /* ------------------------------------------------ despacho y recepción */
  await paso("T20 · «Documentos por despachar»: tarjeta del Jefe LQC con el documento", async () => {
    const b = await bandeja(U.jefe);
    const t = b.seguimiento_por_despachar;
    afirmar(t && t.elementos.some((e) => e.id === C.docId), "el documento no está en «Documentos por despachar»");
    const l = await ok(U.jefe, "GET", "/seguimiento/pendientes?vista=por_despachar");
    afirmar(l.total === t.cantidad, `tarjeta ${t.cantidad} ≠ lista ${l.total}`);
    afirmar(!(await bandeja(U.lpnJefe)).seguimiento_por_despachar?.elementos?.some((e) => e.id === C.docId), "LPN ve el despacho de LQC");
    return `${t.cantidad} por despachar`;
  });

  await paso("T20 · «Despachar →» al DCO (Jefe LQC sí; Planificación y analista 403; otro laboratorio 403; validaciones)", async () => {
    const cuerpo = { destino: "DCO", ejemplares: 2, fecha: hoyCl(), distribucion: [{ destinatario: "Cliente", ejemplares: 1 }, { destinatario: "Archivo LQC", ejemplares: 1 }], copiaArchivada: true, archivoUbicacion: "Archivo LQC · estante 1", retencionMeses: 24 };
    await exigir(403, U.planif, "POST", `/informes/${C.docId}/despachar`, cuerpo);
    await exigir(403, U.a1, "POST", `/informes/${C.docId}/despachar`, cuerpo);
    await exigir(403, U.lpnJefe, "POST", `/informes/${C.docId}/despachar`, cuerpo);
    await exigir(409, U.jefe, "POST", `/informes/${C.docId}/despachar`, { ...cuerpo, fecha: sumar(hoyCl(), 1) }, /futura/);
    await exigir(409, U.jefe, "POST", `/informes/${C.docId}/despachar`, { ...cuerpo, destino: "LAB_SOLICITANTE" }, /solicitante/);
    const s = await ok(U.jefe, "POST", `/informes/${C.docId}/despachar`, cuerpo);
    afirmar(s.despacho?.destino === "DCO" && s.despacho.ejemplares === 2, JSON.stringify(s.despacho));
    await exigir(409, U.jefe, "POST", `/informes/${C.docId}/despachar`, cuerpo, /ya fue despachado/);
    return `despachado a DCO · 2 ejemplares · copia en ${s.despacho.archivoUbicacion}`;
  });

  await paso("T20 · El DCO recibe aviso y tarjeta «Despachos por recibir»; Planificación lo da por recibido (analista 403)", async () => {
    const b = await bandeja(U.planif);
    afirmar(b.seguimiento_por_recibir?.elementos?.some((e) => e.id === C.docId), "Planificación no tiene «Despachos por recibir»");
    const av = await ok(U.planif, "GET", "/avisos?noLeidos=1");
    afirmar(av.data.some((x) => x.tipo === "despacho" && x.otCodigo === C.ot.codigo), "Planificación no recibió el aviso del despacho");
    await exigir(403, U.a1, "POST", `/informes/${C.docId}/despacho/recibir`, {});
    const r = await ok(U.planif, "POST", `/informes/${C.docId}/despacho/recibir`, {});
    afirmar(r.despacho?.recibidoAt, "no quedó recibido");
    await exigir(409, U.planif, "POST", `/informes/${C.docId}/despacho/recibir`, {});
    return "aviso y tarjeta al DCO · recibido";
  });

  await paso("T20 · Recepción en DCO: días de atraso y estado (Ventas sí; analista 403; fecha futura 400)", async () => {
    await exigir(403, U.a1, "POST", `/ot/${C.ot.id}/recepcion-dco`, { fecha: hoyCl() });
    await exigir(400, U.ventas, "POST", `/ot/${C.ot.id}/recepcion-dco`, { fecha: sumar(hoyCl(), 1) }, /futura/);
    const r = await ok(U.ventas, "POST", `/ot/${C.ot.id}/recepcion-dco`, { fecha: hoyCl() });
    afirmar(r.recepcionDco?.estado === "Terminado dentro de plazo" && r.recepcionDco.texto === "2 días a favor", JSON.stringify(r.recepcionDco));
    const ot = await ok(U.jefe, "GET", `/ot/${C.ot.id}`);
    afirmar(ot.estadoEnvio === "Terminado dentro de plazo" && ot.diasAtraso === 0, `${ot.estadoEnvio} · ${ot.diasAtraso}`);
    return `${r.recepcionDco.estado} (${r.recepcionDco.texto})`;
  });

  /* ------------------------------------------------ oficio conductor */
  await paso("T03 · Oficio exigido (parámetro, solo Calidad): con IE y DQO marcados, el documento sin oficio no se entrega (409); se restituye", async () => {
    const grupos = await ok(U.calidad, "GET", CONF);
    const lista0 = grupos.grupos ?? grupos;
    afirmar(lista0.some?.((g) => g.categoria === "oficio_conductor") && lista0.some?.((g) => g.categoria === "avisos"), "faltan los grupos «oficio_conductor» y «avisos» en Parámetros de la operación");
    await exigir(403, U.jefe, "PUT", `${CONF}/oficio_conductor/exige_departamentos`, { valor: ["DSA", "DQO"], motivo: "Prueba sin permiso" });
    await ok(U.calidad, "PUT", `${CONF}/oficio_conductor/exige_tipos`, { valor: ["IVC", "INFORME_TECNICO", "INFORME_RECHAZO", "INFORME_ENSAYO"], motivo: "Prueba r4c: el IE también exige oficio" });
    await ok(U.calidad, "PUT", `${CONF}/oficio_conductor/exige_departamentos`, { valor: ["DSA", "DQO"], motivo: "Prueba r4c: el DQO también exige oficio" });
    try {
      await exigir(409, U.planif, "POST", `/informes/${C.docId}/entregar`, { medio: "mano", destinatario: "Cliente" }, /oficio conductor/);
    } finally {
      await ok(U.calidad, "PUT", `${CONF}/oficio_conductor/exige_tipos`, { valor: ["IVC", "INFORME_TECNICO", "INFORME_RECHAZO"], motivo: "Prueba r4c: se restituye el valor por defecto" });
      await ok(U.calidad, "PUT", `${CONF}/oficio_conductor/exige_departamentos`, { valor: ["DSA"], motivo: "Prueba r4c: se restituye el valor por defecto" });
    }
    return "sin oficio → 409 «oficio conductor» · parámetros restituidos";
  });

  await paso("T03 · Oficio conductor del documento: el analista no lo elabora (403); el Jefe LQC sí → borrador", async () => {
    const cuerpo = { otId: C.ot.id, documentos: [C.docId], destinatario: "Comandante de la unidad cliente (prueba)", materia: `Remite ${C.docNumero}`, distribucion: [{ destinatario: "Archivo DQO", ejemplares: 1 }] };
    await exigir(403, U.a1, "POST", "/oficios", cuerpo);
    await exigir(403, U.lpnJefe, "POST", "/oficios", cuerpo);
    await exigir(400, U.jefe, "POST", "/oficios", { ...cuerpo, documentos: [] }, /documento/);
    C.oficio = await ok(U.jefe, "POST", "/oficios", cuerpo);
    afirmar(C.oficio.estado === "borrador" && !C.oficio.numero && C.oficio.unidad.codigo === "LQC", JSON.stringify({ e: C.oficio.estado, n: C.oficio.numero, u: C.oficio.unidad }));
    return `borrador de ${C.oficio.unidad.codigo}`;
  });

  await paso("T03 · «Generar oficio → firmas»: número de la unidad y circuito OFICIO (V°B° Jefe DQO → firma Director)", async () => {
    const g = await ok(U.jefe, "POST", `/oficios/${C.oficio.id}/generar`, {});
    afirmar(g.estado === "en_firma" && /^OF-LQC-\d{4}-\d{4}$/.test(g.numero), `${g.estado} · ${g.numero}`);
    const acciones = g.pasos.map((p) => `${p.accion}:${p.rolCodigo}`);
    afirmar(acciones.join(",") === "VB:JEFE_DEPTO,FIRMA:DIRECTOR", acciones.join(","));
    C.oficio = g;
    const b = await bandeja(U.dqo);
    afirmar(b.oficios_por_firmar?.elementos?.some((e) => e.id === C.oficio.id), "el Jefe DQO no tiene «Oficios por firmar»");
    return `${g.numero} · ${acciones.join(" → ")}`;
  });

  await paso("T03 · Firmas en orden: el Director no se adelanta (403); V°B° del Jefe DQO; firma del Director", async () => {
    await exigir(403, U.director, "POST", `/oficios/${C.oficio.id}/firmar`, {});
    await exigir(403, U.ventas, "POST", `/oficios/${C.oficio.id}/firmar`, {});
    await ok(U.dqo, "POST", `/oficios/${C.oficio.id}/firmar`, {});
    const f = await ok(U.director, "POST", `/oficios/${C.oficio.id}/firmar`, {});
    afirmar(f.estado === "firmado", `estado ${f.estado}`);
    const pdf = await llamar(U.jefe, "GET", `/oficios/${C.oficio.id}/pdf`);
    afirmar(pdf.status === 200 && /pdf/.test(pdf.tipo), `PDF ${pdf.status} ${pdf.tipo}`);
    return "V°B° → firma · PDF del oficio";
  });

  await paso("T03 · «Firmar y despachar» por la Oficina de partes: Dirección sí; Jefe LQC y Ventas 403", async () => {
    const b = await bandeja(U.director);
    afirmar(b.oficios_por_despachar?.elementos?.some((e) => e.id === C.oficio.id), "Dirección no tiene «Oficios por despachar»");
    await exigir(403, U.jefe, "POST", `/oficios/${C.oficio.id}/despachar`, { numero: "123" });
    await exigir(403, U.ventas, "POST", `/oficios/${C.oficio.id}/despachar`, { numero: "123" });
    await exigir(400, U.director, "POST", `/oficios/${C.oficio.id}/despachar`, { numero: "123", fecha: sumar(hoyCl(), 3) }, /futura/);
    const d = await ok(U.director, "POST", `/oficios/${C.oficio.id}/despachar`, { numero: `OP-${sello.slice(-5)}`, fecha: hoyCl() });
    afirmar(d.estado === "despachado" && d.despacho?.numero, JSON.stringify(d.despacho));
    await exigir(409, U.director, "POST", `/oficios/${C.oficio.id}/despachar`, { numero: "1" });
    return `despacho Nº ${d.despacho.numero}`;
  });

  await paso("T20 · Documentos y envío: carta registrada (versión 2 al repetir el Nº) y envío conjunto con guía; el documento queda entregado", async () => {
    await exigir(403, U.finanzas, "POST", `/ot/${C.ot.id}/documentos-registro`, { tipo: "CARTA", numero: `C-${sello}` });
    const pdf = Buffer.from("%PDF-1.4\n% prueba r4c\n").toString("base64");
    await ok(U.ventas, "POST", `/ot/${C.ot.id}/documentos-registro`, { tipo: "CARTA", numero: `C-${sello}`, copias: 1, archivo: { nombre: "carta.pdf", mime: "application/pdf", datos: pdf } });
    const v = await ok(U.ventas, "POST", `/ot/${C.ot.id}/documentos-registro`, { tipo: "CARTA", numero: `C-${sello}`, copias: 2 });
    const reg = v.registros.filter((r) => r.numero === `C-${sello}`);
    afirmar(reg.length === 2 && reg.map((r) => r.version).sort().join() === "1,2", JSON.stringify(reg.map((r) => r.version)));
    await exigir(400, U.ventas, "POST", `/ot/${C.ot.id}/documentos-registro`, { tipo: "CARTA", numero: "X", archivo: { nombre: "x.exe", mime: "application/x-msdownload", datos: pdf } });
    const arch = await llamar(U.jefe, "GET", `/ot/${C.ot.id}/documentos-registro/${reg[0].id}/archivo`);
    afirmar(arch.status === 200, `archivo ${arch.status}`);
    await exigir(403, U.a1, "POST", `/ot/${C.ot.id}/envios`, { medio: "mano", destinatario: "Cliente", certificadoIds: [C.docId] });
    const e = await ok(U.ventas, "POST", `/ot/${C.ot.id}/envios`, {
      medio: "courier", destinatario: "Cliente prueba r4c", certificadoIds: [C.docId], registroIds: [reg[1].id], oficioIds: [C.oficio.id], guia: `G-${sello.slice(-6)}`,
    });
    afirmar(e.envio.estado === "Enviado al cliente" && e.envios.length === 1, JSON.stringify(e.envio));
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    afirmar(circ.entregadoAt && circ.seguimiento?.entrega?.guia === `G-${sello.slice(-6)}`, "el envío no dejó entregado el documento con su guía");
    return `${e.envios[0].documentos.length} documentos enviados por courier · guía ${circ.seguimiento.entrega.guia}`;
  });

  await paso("T03/T23 · El documento muestra su despacho y su oficio; la Ruta de la OT avanza al cierre", async () => {
    const circ = await ok(U.jefe, "GET", `/informes/${C.docId}/circuito`);
    afirmar(circ.seguimiento.despacho?.recibidoAt && circ.seguimiento.oficios.some((o) => o.id === C.oficio.id), "faltan despacho u oficio en la ficha del documento");
    const a = await ok(U.planif, "GET", `/ot/${C.ot.id}/avance`);
    afirmar(a.etapaActual === "cierre", `etapa ${a.etapaActual}`);
    afirmar(a.pestanas?.muestreo === true && a.pestanas?.preparacion === true, "una OT de LQC debe mostrar Muestreo y Preparación");
    return `etapa ${a.etapaActual}`;
  });

  await paso("T23 · Carpeta de Trabajo: lista versiones y oficios; no se archiva abierta (409); cerrada, el analista la archiva una vez", async () => {
    const c = await ok(U.a1, "GET", `/ot/${C.ot.id}/carpeta`);
    afirmar(c.secciones.documentos.length >= 1 && c.secciones.oficios.length === 1 && c.secciones.registros.length === 2, "faltan secciones en la carpeta");
    afirmar(c.puedoArchivar === false, "se ofrece archivar una OT abierta");
    await exigir(409, U.a1, "POST", `/ot/${C.ot.id}/carpeta/archivar`, {});
    await exigir([403, 404], U.otroLab, "GET", `/ot/${C.ot.id}/carpeta`);
    await ok(U.planif, "POST", `/ot/${C.ot.id}/cerrar`, {});
    await exigir(403, U.finanzas, "POST", `/ot/${C.ot.id}/carpeta/archivar`, {});
    const r = await ok(U.a1, "POST", `/ot/${C.ot.id}/carpeta/archivar`, { ubicacion: "Archivo LQC · caja 3" });
    afirmar(r.archivada?.ubicacion === "Archivo LQC · caja 3", JSON.stringify(r.archivada));
    await exigir(409, U.a1, "POST", `/ot/${C.ot.id}/carpeta/archivar`, {});
    return `${Object.values(c.secciones).reduce((s, x) => s + x.length, 0)} registros · archivada`;
  });

  await paso("T03 · Oficio de la cotización (Ejército y FF.AA.): unidad DCO; el Jefe DCO devuelve con motivo; Ventas corrige y reenvía", async () => {
    const o = await ok(U.ventas, "POST", "/oficios", { cotizacionId: C.cot.id, destinatario: "Comandante de prueba", materia: `Remite cotización ${C.cot.codigo}` });
    afirmar(o.unidad.codigo === "DCO", `unidad ${o.unidad.codigo}`);
    const g = await ok(U.ventas, "POST", `/oficios/${o.id}/generar`, {});
    afirmar(g.pasos[0].rolCodigo === "JEFE_DEPTO" && g.pasos[0].unidadCodigo === "DCO", JSON.stringify(g.pasos[0]));
    await exigir(400, U.dco, "POST", `/oficios/${o.id}/devolver`, { motivo: "x" });
    const d = await ok(U.dco, "POST", `/oficios/${o.id}/devolver`, { motivo: "Falta el número de la cotización en la materia" });
    afirmar(d.estado === "devuelto", d.estado);
    const b = await bandeja(U.ventas);
    afirmar(b.oficios_devueltos?.elementos?.some((e) => e.id === o.id), "Ventas no tiene «Oficios devueltos»");
    await ok(U.ventas, "PATCH", `/oficios/${o.id}`, { materia: `Remite cotización Nº ${C.cot.codigo}` });
    const g2 = await ok(U.ventas, "POST", `/oficios/${o.id}/generar`, {});
    afirmar(g2.estado === "en_firma" && g2.numero === g.numero, `${g2.estado} · ${g2.numero} (antes ${g.numero})`);
    await ok(U.ventas, "POST", `/oficios/${o.id}/anular`, { motivo: "Prueba r4c: se anula al terminar" });
    return `${g.numero} devuelto → corregido → en firma con el mismo número → anulado`;
  });

  /* ------------------------------------------------ T23 · reportes */
  await paso("T23 · Reporte de gestión y Excel (Planificación sí; Ventas sin reporte.ver 403; Jefe LPN solo su laboratorio)", async () => {
    await exigir(403, U.ventas, "GET", "/reportes/gestion");
    const r = await ok(U.planif, "GET", "/reportes/gestion");
    afirmar(r.otPorEstado.filas.some((f) => f.laboratorio === "LQC") && r.plazos.length && r.trazabilidad.some((t) => t.ot === C.ot.codigo), "falta la OT en el reporte");
    const lpn = await ok(U.lpnJefe, "GET", "/reportes/gestion");
    afirmar(lpn.otPorEstado.filas.every((f) => f.laboratorio === "LPN"), `LPN ve: ${lpn.otPorEstado.filas.map((f) => f.laboratorio).join(",")}`);
    afirmar(!lpn.trazabilidad.some((t) => t.ot === C.ot.codigo), "LPN ve la OT de LQC en la trazabilidad");
    const x = await fetch(`${BASE}/reportes/gestion.xlsx`, { headers: { authorization: `Bearer ${(await login(U.planif)).token}` } });
    const buf = Buffer.from(await x.arrayBuffer());
    afirmar(x.status === 200 && buf.subarray(0, 2).toString() === "PK" && /spreadsheetml/.test(x.headers.get("content-type")), `xlsx ${x.status}`);
    const exp = await llamar(U.jefe, "GET", "/reportes/tabla?entidad=factura");
    afirmar(exp.status === 403, `el Jefe LQC exporta facturas (${exp.status})`);
    return `${r.otPorEstado.filas.length} laboratorios · Excel ${buf.length} bytes`;
  });

  /* ------------------------------------------------ correcciones de integración */
  await paso("Integración · OT de la D11 sin armas: ruta de armas desde que nace y sin pestañas Muestreo/Preparación", async () => {
    const l = lista(await ok(U.admin, "GET", "/ot?q=OT-DEMO-D11&limit=10"));
    const d11 = l.find((o) => o.codigo === "OT-DEMO-D11-1") ?? l[0];
    afirmar(d11, "no está la OT de demostración de la D11");
    const a = await ok(U.admin, "GET", `/ot/${d11.id}/avance`);
    afirmar(a.tipo === "armas" && a.etapaActual === "d11_programacion", `${a.tipo} · ${a.etapaActual}`);
    afirmar(a.pestanas.muestreo === false && a.pestanas.preparacion === false, JSON.stringify(a.pestanas));
    return `${d11.codigo}: ${a.tipo} · ${a.etapaActual}`;
  });

  await paso("T14 · OT directa del BPCH: Ruta de la inspección (cabecera → lotes → … → Remitir a DCO) sin Muestreo/Preparación", async () => {
    const stgo = (await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "SSTGO");
    afirmar(stgo, "SSTGO no está entre los laboratorios");
    const o = await ok(U.planif, "POST", "/ot", { clienteId: C.cliente.id, unidadPrincipalId: stgo.id, notas: "OT directa de inspección (prueba r4c)" });
    const otId = o.id ?? o.ot?.id;
    const a = await ok(U.stgo, "GET", `/ot/${otId}/avance`);
    afirmar(a.tipo === "bpch", `tipo ${a.tipo}`);
    afirmar(a.etapas.map((e) => e.clave).join(",").startsWith("apertura,cabecera,lotes,resultados,informe,documento_final,remision_dco"), a.etapas.map((e) => e.clave).join(","));
    afirmar(a.pestanas.muestreo === false, "la OT del BPCH muestra Muestreo");
    return `${a.tipo}: ${a.etapas.length} fases · actual ${a.etapaActual}`;
  });

  await paso("T14 · Mi bandeja: cada tarjeta con «lo que le toca» lleva a una página que existe; avisos internos por persona", async () => {
    const malas = [];
    for (const u of [U.jefe, U.planif, U.ventas, U.director, U.dqo, U.stgo, U.recepcion]) {
      for (const t of await ok(u, "GET", "/me/bandeja")) {
        for (const e of t.elementos ?? []) {
          const p = e.ruta.split("?")[0].replace(/^\//, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "[id]");
          if (!fs.existsSync(path.join(RAIZ, "apps/web/app/(app)", p, "page.tsx"))) malas.push(`${u}: ${t.clave} → ${e.ruta}`);
        }
        if ((t.elementos ?? []).length > 5) malas.push(`${u}: ${t.clave} trae más de 5 filas`);
      }
    }
    afirmar(!malas.length, malas.join(" | "));
    return "enlaces de las filas válidos";
  });
}

main()
  .then(() => {
    console.log(`\nFrente r4c: ${pasos.length} pasos OK.`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    if (!pasos.some((p) => !p.ok)) console.log(`  FALLO ${actual ?? "preparación"} · ${e.message}`);
    console.log(`\n${pasos.filter((p) => p.ok).length} pasos OK; se detuvo en «${actual}».`);
    pararApi();
    process.exit(1);
  });
