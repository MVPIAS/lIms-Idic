#!/usr/bin/env node
/**
 * Frente r1h · segundo recorrido en pantalla de los manuales MP-02 (Sección
 * Alimentos) y MP-06 (BPCH · Internaciones). Reproduce cada corrección con un
 * perfil que puede y otro que no:
 *
 *   Parámetros · «< LD» indeterminado, revisión ≠ aprobación y plazo de la OT de
 *            internación se editan en «Parámetros de la operación» con motivo e
 *            historial (Calidad sí; Jefe de LQC solo lectura; Comercial no entra),
 *            y cada cambio rige en su proceso.
 *   D02-25 · El analista del laboratorio de destino de una orden interna llega a su
 *            captura: el buscador encuentra la OT de origen (?derivadas=1) solo si
 *            tiene ensayos derivados a su laboratorio, la ficha de la orden le
 *            ofrece «Registrar resultados» y Mi bandeja tiene «Ensayos derivados
 *            por capturar» (otros laboratorios y Recepción, no).
 *   D02-28 · El selector de equipos ofrece los del laboratorio dueño del ensayo y
 *            los comunes; un equipo de otro laboratorio se rechaza al capturar.
 *   D06-20 · La API dice por qué quien revisó no aprueba (bloqueoAprobar), según la
 *            configuración; «Aprobar todo» los omite con ese motivo.
 *   D02-30 · «Atención» del informe = contacto principal del cliente si la OT no
 *            trae solicitante.
 *   D02-27 · La hora de las firmas del informe es la de Chile aunque el servidor
 *            esté en UTC (con --arrancar la API se lanza con TZ=UTC).
 *
 * Uso:
 *   DATABASE_URL=… node scripts/verificacion/r1-r1h.js [--arrancar] [--base http://localhost:4781/api]
 *   --arrancar  lanza `node apps/api/dist/main.js` (compilar antes) con DATABASE_URL.
 *
 * Contraseña de los usuarios demo.*: CLAVE_DEMO o la constante CLAVE_DEMO_EMBEBIDA
 * de apps/api/src/auth/auth.service.ts. No escribe contraseñas. Deja datos de
 * prueba (cliente, cotización, OT, orden interna, informe, internación) y
 * restaura los parámetros que cambia: úsese en una base de pruebas. Se puede
 * correr varias veces seguidas.
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
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4781/api");
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
async function exigir(esperado, username, metodo, ruta, cuerpo, patron) {
  const r = await llamar(username, metodo, ruta, cuerpo);
  const okk = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  if (!okk) throw new Error(`${username} ${metodo} ${ruta} → ${r.status} (esperado ${esperado}): ${msg(r.json)}`);
  if (patron && !patron.test(msg(r.json))) throw new Error(`${username} ${metodo} ${ruta}: el mensaje «${msg(r.json)}» no dice ${patron}`);
  return r.json;
}
const ok = (u, m, ruta, c) => exigir([200, 201], u, m, ruta, c);
const lista = (j) => (Array.isArray(j) ? j : j?.data ?? j?.items ?? []);

/* -------------------------------------------------------------- informe --- */
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
  const puerto = new URL(BASE).port || "4781";
  const env = {
    // TZ=UTC: el servidor en la zona del contenedor; las horas de los documentos deben salir en hora de Chile (D02-27).
    ...process.env, TZ: process.env.TZ || "UTC", PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:4782",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(require("os").tmpdir(), "lims-r1-r1h-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };

/* ============================================================ RECORRIDO === */
const U = {
  ventas: "demo.ventas",
  dco: "demo.dco.jefe",
  recepcion: "demo.recepcion",
  calidad: "demo.calidad",
  lqcJefe: "demo.lqc.jefe",
  lqaA1: "demo.lqa.analista1",
  lqaRev: "demo.lqa.revisor",
  lqaJefe: "demo.lqa.jefe",
  dqoJefe: "demo.dqo.jefe",
  lmbA1: "demo.lmb.analista1",
  lmbRev: "demo.lmb.revisor",
  lmbJefe: "demo.lmb.jefe",
  lesA1: "demo.les.analista1",
  scc: "demo.scc.jefe",
  inspector: "demo.sstgo.inspector",
};
const CONF = "/parametros/configurables";
const hoyCl = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sumarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** dd-mm-aaaa HH:MM de un instante en la zona indicada. */
function fechaHoraEn(iso, zona) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.day}-${p.month}-${p.year} ${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}
const sello = String(Date.now()).slice(-7);
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
const bandeja = async (u) => Object.fromEntries((await ok(u, "GET", "/me/bandeja")).map((i) => [i.clave, i]));
const parametro = (conf, cat, cod) => conf.grupos.find((g) => g.categoria === cat)?.parametros.find((p) => p.codigo === cod);

/** Valores que el guion cambia y restaura al final (aunque falle un paso). */
const ORIGINALES = [];
async function cambiarParametro(cat, cod, valor, motivo) {
  const conf = await ok(U.calidad, "GET", CONF);
  const p = parametro(conf, cat, cod);
  afirmar(p && !p.falta, `falta el parámetro ${cat}.${cod}`);
  if (!ORIGINALES.some((o) => o.cat === cat && o.cod === cod)) ORIGINALES.push({ cat, cod, valor: p.valor });
  if (JSON.stringify(p.valor) === JSON.stringify(valor)) return p;
  return ok(U.calidad, "PUT", `${CONF}/${cat}/${cod}`, { valor, motivo });
}
async function restaurar() {
  for (const o of ORIGINALES.reverse()) {
    const conf = await ok(U.calidad, "GET", CONF);
    const p = parametro(conf, o.cat, o.cod);
    if (JSON.stringify(p?.valor) !== JSON.stringify(o.valor))
      await ok(U.calidad, "PUT", `${CONF}/${o.cat}/${o.cod}`, { valor: o.valor, motivo: "Se restaura el valor tras el guion r1-r1h" });
  }
}

async function main() {
  if (ARRANCAR) { arrancarApi(); await esperarApi(); }
  console.log(`Frente r1h · segundo recorrido MP-02 / MP-06 contra ${BASE}`);
  const C = {};
  try {
    await recorrido(C);
  } finally {
    await restaurar().catch((e) => console.log(`  AVISO no se pudieron restaurar los parámetros: ${e.message}`));
  }
  const okN = pasos.filter((p) => p.ok).length;
  console.log(`\n${okN}/${pasos.length} pasos en verde`);
}

async function recorrido(C) {
  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} sesiones`;
  });

  /* ------------------------------------------------ Parámetros de la operación */
  await paso("Parámetros: «< LD», revisión ≠ aprobación y plazo de internación en «Parámetros de la operación»; Comercial no entra", async () => {
    await exigir(403, U.ventas, "GET", CONF);
    const conf = await ok(U.lqcJefe, "GET", CONF);
    afirmar(conf.puedeEditar === false, "el Jefe de LQC podría editar");
    const ld = parametro(conf, "captura_ld", "indeterminado");
    const modo = parametro(conf, "segregacion_resultado", "revisor_aprobador");
    const exc = parametro(conf, "segregacion_resultado", "excepciones");
    const plazo = parametro(conf, "ot_plazo", "internacion_dias");
    afirmar(ld?.def?.tipo === "opcion" && ld.def.opciones.map((o) => o.valor).join() === "pendiente,no_cumple,cumple", `captura_ld ${JSON.stringify(ld?.def)}`);
    afirmar(modo?.def?.tipo === "opcion", "segregación sin opciones");
    afirmar(exc?.def?.tipo === "multiple" && exc.def.opciones.some((o) => o.valor === "LQA") && exc.def.opciones.some((o) => o.valor === "LMB"),
      "las excepciones no ofrecen los laboratorios de la base");
    afirmar(plazo?.def?.tipo === "entero" && plazo.def.min === 1 && plazo.def.max === 365, `plazo ${JSON.stringify(plazo?.def)}`);
    C.idPlazo = plazo.id;
    return `«< LD» ${ld.texto} · revisión ${modo.texto} · excepciones ${exc.texto} · plazo ${plazo.texto}`;
  });

  await paso("Parámetros: Calidad cambia el plazo con motivo (400 sin motivo o fuera de rango, 409 si es igual); Jefe de LQC 403; la tabla genérica 409", async () => {
    await exigir(403, U.lqcJefe, "PUT", `${CONF}/ot_plazo/internacion_dias`, { valor: 12, motivo: "Prueba del guion r1h" });
    await exigir(400, U.calidad, "PUT", `${CONF}/ot_plazo/internacion_dias`, { valor: 12 }, /motivo/);
    await exigir(400, U.calidad, "PUT", `${CONF}/ot_plazo/internacion_dias`, { valor: 0, motivo: "Prueba del guion r1h" }, /entre 1 y 365/);
    await exigir(400, U.calidad, "PUT", `${CONF}/segregacion_resultado/excepciones`, { valor: ["XYZ"], motivo: "Prueba del guion r1h" }, /desconocidas/);
    await exigir(409, U.calidad, "PATCH", `/parametros/${C.idPlazo}`, { valor: "12" }, /Parámetros de la operación/);
    await cambiarParametro("ot_plazo", "internacion_dias", 12, "Prueba del guion r1h: plazo de 12 días");
    await exigir(409, U.calidad, "PUT", `${CONF}/ot_plazo/internacion_dias`, { valor: 12, motivo: "Prueba del guion r1h" }, /igual/);
    const conf = await ok(U.calidad, "GET", CONF);
    const h = conf.historial.find((x) => x.categoria === "ot_plazo" && x.codigo === "internacion_dias");
    afirmar(h && h.despues === "12 días corridos" && /r1h/.test(h.motivo), `historial ${JSON.stringify(h)}`);
    return `historial: ${h.antes} → ${h.despues} (${h.usuarioNombre ?? "—"})`;
  });

  await paso("Parámetros · rige: la OT de internación nace con compromiso = hoy + 12 días", async () => {
    const cfg = await ok(U.ventas, "GET", "/bpch/config");
    const sstgo = cfg.unidades.find((u) => u.codigo === "SSTGO");
    const imp = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(76200000 + (Number(sello) % 799999)), razonSocial: `Importadora prueba r1h ${sello}`, tipo: "particulares",
    });
    const int = await ok(U.ventas, "POST", "/bpch/internaciones", {
      resolucionNumero: `RES-R1H-${sello}`, resolucionFecha: hoyCl(), clienteId: imp.id, esquema: "LOTES",
      procedimiento: "SAC-PG01-P01", unidadInspeccionId: sstgo.id, sujetaTasa: false,
      items: [{ elementoEspecifico: `Emulsión prueba r1h ${sello}`, claseDivisionUn: "1.1D", numeroUn: "0241", cantidad: 5, unidadMedida: "uds" }],
    });
    const r = await ok(U.scc, "POST", `/bpch/internaciones/${int.id}/analisis`, { infoCompleta: true, fechaAnalisis: hoyCl() });
    const ot = await ok(U.inspector, "GET", `/ot/${r.otId}`);
    afirmar(String(ot.fechaCompromiso).slice(0, 10) === sumarDias(hoyCl(), 12), `compromiso ${ot.fechaCompromiso} ≠ hoy + 12`);
    await cambiarParametro("ot_plazo", "internacion_dias", 10, "Se vuelve al plazo por defecto (guion r1h)");
    return `${ot.codigo} · compromiso ${String(ot.fechaCompromiso).slice(0, 10)} · plazo restaurado a 10`;
  });

  /* ------------------------------------------------ OT de LQA con orden interna a LMB */
  await paso("Catálogo: humedad y cenizas (LQA); S. aureus y Salmonella (LMB)", async () => {
    const metodo = async (codigo) => {
      const m = lista(await ok(U.lqaJefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
      afirmar(m && m.ensayoId, `método ${codigo} no encontrado`);
      return m;
    };
    C.mHum = await metodo("395");
    C.mCen = await metodo("386");
    C.mSau = await metodo("417");
    C.mSal = await metodo("429");
    C.lqa = (await ok(U.ventas, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQA");
    afirmar(C.lqa, "LQA no figura en /ot/laboratorios");
    const pl = lista(await ok(U.lqaJefe, "GET", "/plantillas?limit=300"));
    C.pg09 = pl.find((x) => x.repid === "PG09A2");
    afirmar(C.pg09, "falta la plantilla PG09A2");
    return `${C.mHum.nombre} · ${C.mCen.nombre} · ${C.mSau.nombre} · ${C.mSal.nombre}`;
  });

  await paso("Cliente con contacto principal (J. P.) → cotización → OT de LQA sin solicitante; muestra recibida", async () => {
    C.cliente = await ok(U.ventas, "POST", "/clientes", {
      rut: rutValido(77100000 + (Number(sello) % 899999)), razonSocial: `Cliente prueba r1h ${sello}`, tipo: "particulares",
      contactoNombre: "J. P.", contactoCargo: "Jefe de Calidad",
    });
    C.cot = await ok(U.ventas, "POST", "/cotizaciones", {
      clienteId: C.cliente.id, formato: "NORMAL", plazoEntregaDias: 10, referencia: `Recorrido MP-02 r1h ${sello}`,
      lineas: [C.mHum, C.mCen, C.mSau, C.mSal].map((m) => ({ catEnsayoId: m.ensayoId, cantidad: 1 })),
    });
    await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/enviar-a-firma`, {});
    await ok(U.dco, "POST", `/cotizaciones/${C.cot.id}/firmar`, {});
    const r = await ok(U.ventas, "POST", `/cotizaciones/${C.cot.id}/aceptar`, {
      tipo: "OC", numero: `OC-R1H-${sello}`, fecha: hoyCl(), conCobro: true, unidadPrincipalId: C.lqa.id,
    });
    C.ot = await ok(U.lqaJefe, "GET", `/ot/${r.ot.id}`);
    afirmar(!String(C.ot.solicitante ?? "").trim(), `la OT trae solicitante «${C.ot.solicitante}»`);
    const reg = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [{
        nombre: `Harina de trigo · bolsa 1 kg (r1h ${sello})`,
        metodoIds: [C.mHum.id, C.mCen.id],
        recepcion: { tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple", datos: { lote: `L-${sello}` } },
      }],
    });
    C.muestra = reg.muestras[0];
    return `${C.cot.codigo} → ${C.ot.codigo} · ${C.muestra.codigo}`;
  });

  await paso("Orden interna LQA → LMB (S. aureus y Salmonella) emitida por el analista de LQA", async () => {
    const d = await ok(U.lqaA1, "GET", `/ordenes-internas/destinos?otId=${C.ot.id}`);
    C.lmb = d.find((x) => x.unidadCodigo === "LMB");
    afirmar(C.lmb, "LMB no figura como destino");
    C.oi = await ok(U.lqaA1, "POST", "/ordenes-internas", {
      otId: C.ot.id, destinoLab: C.lmb.id, ensayos: [C.mSau.ensayoId, C.mSal.ensayoId], muestraId: C.muestra.id,
      requisito: "RSA vigente: S. aureus ≤ 100 ufc/g; Salmonella ausencia en 25 g", fechaEnvio: hoyCl(),
    });
    return C.oi.numero;
  });

  /* ------------------------------------------------ D02-25 */
  await paso("D02-25 · Buscador de la captura (?derivadas=1): el analista de LMB encuentra la OT de LQA; sin el filtro no; LES tampoco", async () => {
    const q = encodeURIComponent(C.ot.codigo);
    const con = lista(await ok(U.lmbA1, "GET", `/ot?derivadas=1&q=${q}&limit=20`));
    afirmar(con.some((o) => o.id === C.ot.id), "el analista de LMB no encuentra la OT de origen con ?derivadas=1");
    const sin = lista(await ok(U.lmbA1, "GET", `/ot?q=${q}&limit=20`));
    afirmar(!sin.some((o) => o.id === C.ot.id), "la lista de OT normal del LMB muestra la OT de LQA");
    const les = lista(await ok(U.lesA1, "GET", `/ot?derivadas=1&q=${q}&limit=20`));
    afirmar(!les.some((o) => o.id === C.ot.id), "el analista de LES encuentra una OT sin derivados a su laboratorio");
    const lqa = lista(await ok(U.lqaA1, "GET", `/ot?derivadas=1&q=${q}&limit=20`));
    afirmar(lqa.some((o) => o.id === C.ot.id), "el LQA dejó de ver su OT con ?derivadas=1");
    return "LMB la encuentra · LMB sin filtro no · LES no";
  });

  await paso("D02-25 · Ficha de la orden: «Registrar resultados» (puedo.capturar) para el analista de LMB solo con la orden recibida; LQA no; LES 404", async () => {
    let f = await ok(U.lmbA1, "GET", `/ordenes-internas/${C.oi.id}`);
    afirmar(f.puedo.capturar === false, "el analista de LMB podría capturar antes de recibir la orden");
    const rec = await ok(U.lmbJefe, "POST", `/ordenes-internas/${C.oi.id}/recibir`, {});
    afirmar(rec.estado === "recibida", `orden ${rec.estado}`);
    f = await ok(U.lmbA1, "GET", `/ordenes-internas/${C.oi.id}`);
    afirmar(f.puedo.capturar === true && f.puedo.responder === false, `analista LMB: ${JSON.stringify(f.puedo)}`);
    const o = await ok(U.lqaA1, "GET", `/ordenes-internas/${C.oi.id}`);
    afirmar(o.puedo.capturar === false, "el analista de LQA (solicitante) tiene «Registrar resultados»");
    await exigir(404, U.lesA1, "GET", `/ordenes-internas/${C.oi.id}`);
    const v = await ok(U.lmbA1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    afirmar(v.resultados.length === 2 && v.resultados.every((r) => r.derivado && r.puedo.capturar), `la captura del LMB trae ${v.resultados.length} ensayos`);
    const id = (rs, m) => rs.find((r) => r.catMetodoId === m.id)?.id;
    C.rSau = id(v.resultados, C.mSau);
    C.rSal = id(v.resultados, C.mSal);
    C.lmbUnidad = v.resultados[0].laboratorioId;
    const l = await ok(U.lqaA1, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    C.rHum = id(l.resultados, C.mHum);
    C.rCen = id(l.resultados, C.mCen);
    afirmar(C.rSau && C.rSal && C.rHum && C.rCen && C.lmbUnidad, "faltan resultados o su laboratorio");
    return `${C.oi.numero} recibida · analista LMB: capturar sí, responder no · solo los 2 derivados`;
  });

  await paso("D02-25 · Mi bandeja: «Ensayos derivados por capturar» del analista de LMB = su bandeja ?derivados=1; LQA y Recepción no los tienen", async () => {
    const b = await bandeja(U.lmbA1);
    const t = b.derivados_por_capturar;
    afirmar(t && t.cantidad >= 2 && t.ruta === "/captura-ot?estado=pendiente,devuelto,rechazado&derivados=1", `tarjeta ${JSON.stringify(t)}`);
    const l = await ok(U.lmbA1, "GET", "/resultados/bandeja?estado=pendiente,devuelto,rechazado&derivados=1&limit=200");
    afirmar(l.meta.total === t.cantidad, `tarjeta ${t.cantidad} ≠ bandeja ${l.meta.total}`);
    afirmar([C.rSau, C.rSal].every((x) => lista(l).some((r) => r.id === x)), "la bandeja no trae los derivados de esta OT");
    const lqa = await ok(U.lqaA1, "GET", `/resultados/bandeja?estado=pendiente,devuelto,rechazado&derivados=1&otId=${C.ot.id}&limit=200`);
    afirmar(lqa.meta.total === 0, `el LQA ve ${lqa.meta.total} derivados de LMB`);
    afirmar(!(await bandeja(U.recepcion)).derivados_por_capturar, "Recepción tiene la tarjeta (no abre la captura)");
    return `${t.cantidad} por capturar · LQA 0 · Recepción sin tarjeta`;
  });

  /* ------------------------------------------------ D02-28 */
  await paso("D02-28 · Equipos: el LMB ve los suyos y no los del LQA; el LQA, los suyos y no los del LMB; un equipo de otro laboratorio → 400", async () => {
    const lmb = (await ok(U.lmbA1, "GET", `/flujo/ot/${C.ot.id}/equipos`)).equipos;
    afirmar(lmb.some((e) => e.codigo === "DEMO-LMB-INC-01"), "el LMB no ve su incubadora");
    afirmar(!lmb.some((e) => e.unidadCodigo === "LQA"), `el LMB ve equipos del LQA: ${lmb.filter((e) => e.unidadCodigo === "LQA").map((e) => e.codigo).join(", ")}`);
    afirmar(lmb.every((e) => !e.unidadId || e.unidadId === C.lmbUnidad), "hay equipos de otro laboratorio");
    const lqa = (await ok(U.lqaA1, "GET", `/flujo/ot/${C.ot.id}/equipos`)).equipos;
    afirmar(lqa.some((e) => e.codigo === "DEMO-LQA-BAL-01") && !lqa.some((e) => e.unidadCodigo === "LMB"), "el LQA no ve solo los suyos");
    const balanza = lqa.find((e) => e.codigo === "DEMO-LQA-BAL-01");
    const inc = lmb.find((e) => e.codigo === "DEMO-LMB-INC-01");
    await exigir(400, U.lmbA1, "POST", `/flujo/resultado/${C.rSau}/valor`, { valor: "< 10", equipoId: balanza.id }, /no es del laboratorio de este ensayo/);
    const sau = await ok(U.lmbA1, "POST", `/flujo/resultado/${C.rSau}/valor`, { valor: "< 10", equipoId: inc.id });
    afirmar(sau.equipoId === inc.id && sau.veredicto === "cumple", `S. aureus ${sau.veredicto} con ${sau.equipoId}`);
    await exigir(400, U.lqaA1, "POST", `/flujo/resultado/${C.rHum}/valor`, { valor: "13,3", equipoId: inc.id }, /no es del laboratorio de este ensayo/);
    const sal = await ok(U.lmbA1, "POST", `/flujo/resultado/${C.rSal}/valor`, { atributo: "cumple", valor: "Ausencia en 25 g" });
    afirmar(sal.veredicto === "cumple", `Salmonella ${sal.veredicto}`);
    return `LMB ${lmb.length} equipo(s) · LQA ${lqa.length} · balanza en S. aureus 400 · incubadora OK`;
  });

  /* ------------------------------------------------ captura_ld rige */
  await paso("Parámetros · rige: «< LD» indeterminado = «No cumple» decide la captura; vuelto a «Pendiente», se corrige con motivo", async () => {
    await cambiarParametro("captura_ld", "indeterminado", "no_cumple", "Prueba del guion r1h: «< LD» indeterminado no cumple");
    const cen = await ok(U.lqaA1, "POST", `/flujo/resultado/${C.rCen}/valor`, { valor: "< 10" });
    afirmar(cen.veredicto === "no_cumple", `cenizas «< 10» con criterio no_cumple → ${cen.veredicto}`);
    await cambiarParametro("captura_ld", "indeterminado", "pendiente", "Se vuelve al criterio por defecto (guion r1h)");
    const cen2 = await ok(U.lqaA1, "POST", `/flujo/resultado/${C.rCen}/valor`, { valor: "< 10", motivo: "Recaptura tras volver al criterio por defecto" });
    afirmar(cen2.veredicto === "pendiente", `cenizas «< 10» con criterio pendiente → ${cen2.veredicto}`);
    const cen3 = await ok(U.lqaA1, "POST", `/flujo/resultado/${C.rCen}/valor`, { valor: "0,62", motivo: "Valor definitivo de cenizas" });
    afirmar(cen3.veredicto === "cumple", `cenizas 0,62 → ${cen3.veredicto}`);
    const hum = await ok(U.lqaA1, "POST", `/flujo/resultado/${C.rHum}/valor`, { replicasTexto: "13,2 13,4" });
    afirmar(["cumple", "informativo"].includes(hum.veredicto), `humedad → ${hum.veredicto}`);
    return `«< 10» → No cumple · → Pendiente · 0,62 Cumple · humedad 13,3 ${hum.veredicto}`;
  });

  /* ------------------------------------------------ D06-20 */
  await paso("D06-20 · Quien revisó ve bloqueoAprobar («Lo revisó usted…»); otra jefatura no; «Aprobar todo» los omite con ese motivo", async () => {
    const rv = await ok(U.lqaJefe, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    afirmar(rv.hechos === 2, `el jefe de LQA revisó ${rv.hechos}`);
    const j = await ok(U.lqaJefe, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    const propios = j.resultados.filter((r) => !r.derivado);
    afirmar(propios.length === 2 && propios.every((r) => /revisó usted/.test(r.bloqueoAprobar ?? "")), `bloqueoAprobar ${propios.map((r) => r.bloqueoAprobar).join(" | ")}`);
    const d = await ok(U.dqoJefe, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    afirmar(d.resultados.filter((r) => !r.derivado).every((r) => r.bloqueoAprobar === null), "el Jefe DQO aparece bloqueado");
    const a = await ok(U.lqaJefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    afirmar(a.hechos === 0 && a.omitidos.filter((o) => /revisó usted/.test(o.motivo)).length === 2, `aprobar todo: ${JSON.stringify(a).slice(0, 200)}`);
    return "jefe LQA: 2 bloqueados (los revisó) · Jefe DQO: 0 · aprobar todo: 0 hechos, 2 omitidos";
  });

  await paso("Parámetros · rige: con LQA en las excepciones el mismo jefe aprueba lo que revisó; restaurado, vuelve el 409", async () => {
    await exigir(403, U.lqcJefe, "PUT", `${CONF}/segregacion_resultado/excepciones`, { valor: ["LQA"], motivo: "Prueba del guion r1h" });
    await cambiarParametro("segregacion_resultado", "excepciones", ["LQA"], "Prueba del guion r1h: LQA de dos personas");
    const j = await ok(U.lqaJefe, "GET", `/flujo/ot/${C.ot.id}/resultados`);
    afirmar(j.resultados.filter((r) => !r.derivado).every((r) => r.bloqueoAprobar === null), "sigue bloqueado con LQA en las excepciones");
    await ok(U.lqaJefe, "POST", `/resultados/${C.rHum}/aprobar`);
    await cambiarParametro("segregacion_resultado", "excepciones", [], "Se vuelve a la regla para todos los laboratorios (guion r1h)");
    await exigir(409, U.lqaJefe, "POST", `/resultados/${C.rCen}/aprobar`, undefined, /revisó usted/);
    await ok(U.dqoJefe, "POST", `/resultados/${C.rCen}/aprobar`);
    return "excepción LQA: aprueba humedad · restaurado: cenizas 409 → la aprueba el Jefe DQO";
  });

  await paso("Derivados: el revisor de LMB los revisa, el jefe de LMB los aprueba, responde y cierra; ya no hay derivados por capturar", async () => {
    const r = await ok(U.lmbRev, "POST", `/resultados/ot/${C.ot.id}/revisar`, {});
    afirmar(r.hechos === 2, `LMB revisó ${r.hechos}`);
    const a = await ok(U.lmbJefe, "POST", `/resultados/ot/${C.ot.id}/aprobar`, {});
    afirmar(a.hechos === 2, `LMB aprobó ${a.hechos}`);
    await ok(U.lmbJefe, "POST", `/ordenes-internas/${C.oi.id}/responder`, { horas: 2, costoDirecto: 15000, informe: "S. aureus < 10 ufc/g; Salmonella ausencia en 25 g." });
    await ok(U.lmbJefe, "POST", `/ordenes-internas/${C.oi.id}/cerrar`, {});
    const f = await ok(U.lmbA1, "GET", `/ordenes-internas/${C.oi.id}`);
    afirmar(f.puedo.capturar === false, "con la orden cerrada el analista de LMB sigue con «Registrar resultados»");
    const b = await ok(U.lmbA1, "GET", `/resultados/bandeja?estado=pendiente,devuelto,rechazado&derivados=1&otId=${C.ot.id}&limit=200`);
    afirmar(b.meta.total === 0, `quedan ${b.meta.total} derivados por capturar tras el cierre`);
    return `${C.oi.numero} cerrada · derivados por capturar de la OT: 0`;
  });

  /* ------------------------------------------------ D02-30 / D02-27 */
  await paso("D02-30 · «Atención» del informe = contacto principal del cliente (la OT no trae solicitante); LES no previsualiza (403)", async () => {
    await exigir(403, U.lesA1, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: C.pg09.id });
    const p = await ok(U.lqaJefe, "POST", "/informes/previsualizar", { otId: C.ot.id, plantillaId: C.pg09.id, modalidad: "cumplimiento" });
    afirmar(/<th>Atención<\/th><td>J\. P\., Jefe de Calidad<\/td>/.test(p.html), "«Atención» no trae el contacto principal del cliente");
    return "Atención: J. P., Jefe de Calidad";
  });

  await paso("D02-27 · La hora de la firma del informe es la de Chile (servidor en UTC); LES no abre el documento", async () => {
    const c = await ok(U.lqaJefe, "POST", "/informes/condiciones", { otId: C.ot.id, plantillaId: C.pg09.id });
    afirmar(c.puedeEmitir, `no se puede emitir: ${c.faltantes.join(" | ")}`);
    const e = await ok(U.lqaJefe, "POST", "/informes/emitir", { otId: C.ot.id, plantillaId: C.pg09.id, modalidad: "cumplimiento" });
    C.doc = e.certificado.id;
    const circ = await ok(U.lqaJefe, "GET", `/informes/${C.doc}/circuito`);
    const porId = {};
    // Firmantes posibles: los perfiles ya conectados (sin nuevos inicios de sesión, que el límite de ritmo frena).
    for (const [u, s] of Object.entries(sesiones)) porId[s.id] = u;
    const orden = Math.min(...circ.pasos.map((p) => p.orden));
    const p1 = circ.pasos.find((p) => p.orden === orden);
    const quien = (p1.responsables ?? []).map((x) => porId[x.usuarioId]).find(Boolean);
    afirmar(quien, "sin firmante para el primer paso entre los perfiles de prueba");
    await ok(quien, "POST", `/informes/${C.doc}/firmar`, {});
    const fin = await ok(U.lqaJefe, "GET", `/informes/${C.doc}/circuito`);
    const firmado = fin.pasos.find((p) => p.estado === "firmado" && p.firmadoAt);
    afirmar(firmado, `no hay firma registrada: ${JSON.stringify(fin.pasos).slice(0, 200)}`);
    const html = await exigir(200, U.lqaJefe, "GET", `/informes/${C.doc}/html`);
    const chile = fechaHoraEn(firmado.firmadoAt, "America/Santiago");
    const utc = fechaHoraEn(firmado.firmadoAt, "UTC");
    afirmar(String(html).includes(chile), `el documento no trae la hora de Chile ${chile}`);
    afirmar(chile === utc || !String(html).includes(utc), `el documento trae la hora UTC ${utc}`);
    await exigir([403, 404], U.lesA1, "GET", `/informes/${C.doc}/html`);
    return `${e.numero} · firma ${chile} (en UTC sería ${utc})`;
  });
}

main()
  .then(() => { pararApi(); process.exit(pasos.every((p) => p.ok) ? 0 : 1); })
  .catch((e) => { console.log(`\nFALLÓ: ${e.message}`); pararApi(); process.exit(1); });
