#!/usr/bin/env node
/**
 * Verificación contra una API real del frente ALI-D4 (EP-02 §3.2, §3.9, §5 y
 * §9.1; packages/db/align_ali_d4_metodos_lqa.sql): métodos de LQA con lecturas
 * y fórmula dentro de la captura estándar.
 *   · proteína Kjeldahl (403): m, V, N y factor (6,25 por defecto, por
 *     confirmar) → %P = 1,4 × N × V × Factor / m; duplicado X y X′ con
 *     promedio; |X − X′| ≤ 0,38 avisa antes de guardar (409 + confirmación);
 *   · materia grasa (399): peso constante ≤ 0,001 g; humedad (395) y acidez
 *     (966) con sus fórmulas (por confirmar);
 *   · solo el valor final sigue funcionando; parámetro captura_reglas.modo
 *     (avisar | impedir) que rige al guardar; otro laboratorio no captura.
 *
 * Uso:
 *   node scripts/verificacion/ali-d4.js [--arrancar] [--base http://localhost:4321/api]
 *
 * Variables: DATABASE_URL (con --arrancar), CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA de
 * auth.service.ts). Deja en la base un «Cliente Prueba ALI-D4 …» con una OT
 * «OT-PRUEBA ALI-D4» de LQA y su muestra «PRUEBA harina …»: úsese en una base
 * de pruebas. El parámetro captura_reglas.modo se restaura al terminar.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:4321/api");
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
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  sesiones[username] = { token: j.accessToken, id: j.usuario?.id ?? j.user?.id };
  return sesiones[username];
}
async function llamar(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${s.token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const tipo = r.headers.get("content-type") ?? "";
  if (tipo.includes("application/pdf")) return { status: r.status, json: Buffer.from(await r.arrayBuffer()) };
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
function afirmar(cond, texto) {
  if (!cond) throw new Error(texto);
}

/* ------------------------------------------------------------ arranque --- */
let hijo = null;
function arrancarApi() {
  if (!process.env.DATABASE_URL) throw new Error("--arrancar necesita DATABASE_URL");
  const puerto = new URL(BASE).port || "3921";
  const env = {
    ...process.env, PORT: puerto, API_PORT: puerto, NODE_ENV: "production", ACCESOS_DEMO: "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || `http://localhost:${puerto}`,
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  };
  hijo = spawn(process.execPath, ["dist/main.js"], { cwd: path.join(RAIZ, "apps/api"), env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(os.tmpdir(), "lims-ali-d4-api.log"));
  hijo.stdout.pipe(log);
  hijo.stderr.pipe(log);
}
const pararApi = () => { if (hijo && !hijo.killed) hijo.kill(); };
async function esperarApi(ms = 120000) {
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


const U = {
  ventas: "demo.ventas",
  planif: "demo.planificacion",
  recepcion: "demo.recepcion",
  jefe: "demo.lqa.jefe",
  a1: "demo.lqa.analista1",
  otroLab: "demo.lmb.analista1",
  calidad: "demo.calidad",
};
const CONF = "/parametros/configurables";
const parametro = (conf, cat, cod) => conf.grupos.find((g) => g.categoria === cat)?.parametros.find((p) => p.codigo === cod);
let modoOriginal = null;
async function modoReglas(valor, motivo) {
  const conf = await ok(U.calidad, "GET", CONF);
  const p = parametro(conf, "captura_reglas", "modo");
  afirmar(p && !p.falta, "falta el parámetro captura_reglas.modo (align_ali_d4_metodos_lqa.sql)");
  if (modoOriginal === null) modoOriginal = p.valor;
  if (p.valor === valor) return;
  await ok(U.calidad, "PUT", `${CONF}/captura_reglas/modo`, { valor, motivo });
}
function rutValido(base) {
  const cuerpo = String(base);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += Number(cuerpo[i]) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${cuerpo}-${dv === 11 ? "0" : dv === 10 ? "K" : dv}`;
}
const cerca = (a, b, tol = 1e-6) => Math.abs(Number(a) - b) <= tol;

/* ============================================================ RECORRIDO === */
async function main() {
  console.log(`API ${BASE}`);
  if (ARRANCAR) arrancarApi();
  await esperarApi();
  const C = {};
  const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

  await paso("Inicio de sesión de los perfiles", async () => {
    for (const u of Object.values(U)) await login(u);
    return `${Object.keys(sesiones).length} perfiles`;
  });

  await paso("Catálogo: LQA y métodos 403 proteína, 399 materia grasa, 395 humedad, 966 acidez", async () => {
    C.lqa = (await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQA");
    afirmar(C.lqa, "LQA no figura entre los laboratorios");
    const buscar = async (codigo) => {
      const m = lista(await ok(U.jefe, "GET", `/cat/metodos?search=${encodeURIComponent(codigo)}&limit=50`)).find((x) => x.codigo === codigo);
      afirmar(m, `método ${codigo} no encontrado`);
      return m;
    };
    C.mP = await buscar("403");
    C.mG = await buscar("399");
    C.mH = await buscar("395");
    C.mA = await buscar("966");
    const conf = await ok(U.calidad, "GET", CONF);
    const p = parametro(conf, "captura_reglas", "modo");
    afirmar(p && p.def?.tipo === "opcion" && p.def.opciones.map((o) => o.valor).join() === "avisar,impedir", `captura_reglas.modo ${JSON.stringify(p?.def)}`);
    return `${C.mP.nombre} · ${C.mG.nombre} · ${C.mH.nombre} · ${C.mA.nombre} · modo ${p.valor}`;
  });

  await paso("Cliente Prueba y OT de LQA (PRUEBA) con una muestra y los 4 métodos", async () => {
    const base = 76000000 + (Number(sello.slice(-6)) % 999999);
    C.cliente = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Cliente Prueba ALI-D4 ${sello}`, tipo: "particulares", giro: "Pruebas", direccion: "Calle Prueba 1" });
    C.ot = await ok(U.planif, "POST", "/ot", {
      clienteId: C.cliente.id, unidadPrincipalId: C.lqa.id, conCobro: false,
      descripcionTrabajo: `OT-PRUEBA ALI-D4 ${sello}: proteína, materia grasa, humedad y acidez de una harina de prueba`,
    });
    const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const toma = (reg.opcionesToma ?? []).find((o) => o.codigo === "seccion_muestreo") ?? reg.opcionesToma?.[0];
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [{
        nombre: `PRUEBA harina ALI-D4 ${sello}`,
        metodoIds: [C.mP.id, C.mG.id, C.mH.id, C.mA.id],
        recepcion: { tomaMuestra: toma.codigo, condicionRecepcion: "cumple", identificacionCliente: "PRUEBA harina" },
      }],
    });
    C.muestra = r.muestras[0];
    return `${C.cliente.razonSocial} · ${C.ot.codigo} · ${C.muestra.codigo}`;
  });

  const resultados = async () => (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
  const de = (rs, m) => rs.find((x) => x.catMetodoId === m.id);

  await paso("La captura trae lecturas, fórmula, factor 6,25 por defecto, reglas y nota «por confirmar»", async () => {
    const rs = await resultados();
    C.rP = de(rs, C.mP); C.rG = de(rs, C.mG); C.rH = de(rs, C.mH); C.rA = de(rs, C.mA);
    afirmar(C.rP && C.rG && C.rH && C.rA, "faltan ensayos en la OT");
    afirmar(C.rP.formulaAplicable === "1.4 * C3 * C2 * C4 / C1" && C.rP.nCampos === 4, `proteína ${C.rP.formulaAplicable} / ${C.rP.nCampos}`);
    const f = C.rP.campos[3];
    afirmar(f && f.valorDefecto === 6.25 && f.porConfirmar === true && f.simbolo === "F", `factor ${JSON.stringify(f)}`);
    afirmar(C.rP.campos.map((c) => c.simbolo).join(",") === "m,V,N,F", `símbolos ${C.rP.campos.map((c) => c.simbolo)}`);
    const rP = C.rP.reglasAceptacion[0];
    afirmar(rP && rP.tipo === "duplicados" && rP.max === 0.38 && rP.modo === "absoluto" && rP.porConfirmar, `regla proteína ${JSON.stringify(rP)}`);
    afirmar(/POR CONFIRMAR/.test(C.rP.notaCaptura ?? ""), "la nota de la proteína no dice qué está por confirmar");
    const rG = C.rG.reglasAceptacion[0];
    afirmar(rG && rG.tipo === "diferencia_campos" && rG.campoA === "C4" && rG.campoB === "C3" && rG.max === 0.001, `regla grasa ${JSON.stringify(rG)}`);
    afirmar(C.rG.formulaAplicable === "(C4 - C2) / C1 * 100" && C.rG.nCampos === 4, `grasa ${C.rG.formulaAplicable}`);
    afirmar(C.rH.formulaAplicable === "(C2 - C3) / (C2 - C1) * 100" && C.rH.nCampos === 3 && C.rH.reglasAceptacion.length === 0, `humedad ${C.rH.formulaAplicable}`);
    afirmar(C.rA.nCampos === 6 && C.rA.campos[5].valorDefecto === 0.064 && C.rA.campos[2].valorDefecto === 0, `acidez ${JSON.stringify(C.rA.campos)}`);
    return `proteína ${C.rP.formulaAplicable} · grasa ${C.rG.formulaAplicable} · humedad ${C.rH.formulaAplicable} · acidez ${C.rA.formulaAplicable}`;
  });

  await paso("Otro laboratorio (LMB) no captura en la OT de LQA (403)", async () => {
    await exigir(403, U.otroLab, "POST", `/flujo/resultado/${C.rP.id}/valor`, { valor: "12" });
  });

  await paso("Proteína: solo el valor final sigue funcionando (sin lecturas no se evalúan reglas)", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { valor: "12,4", observacion: "PRUEBA ALI-D4 valor final" });
    afirmar(Number(r.valorNumerico) === 12.4 && r.avisosAceptacion === null, `valor ${r.valorNumerico} avisos ${JSON.stringify(r.avisosAceptacion)}`);
    // El veredicto es el de la especificación del catálogo (Mín / Máx), igual que antes.
    const esperado = C.rP.limiteInf != null && C.rP.limiteInf !== "" && 12.4 < Number(String(C.rP.limiteInf).replace(",", ".")) ? "no_cumple" : r.veredicto;
    afirmar(r.veredicto === esperado, `veredicto ${r.veredicto} con Mín ${C.rP.limiteInf}`);
    return `12,4 % · ${r.veredicto} (Mín ${C.rP.limiteInf ?? "—"})`;
  });

  const X = { C1: "1,0000", C2: "12,50", C3: "0,1", C4: "" }; // 10,9375 con factor 6,25 por defecto
  const Xmala = { C1: "1,0000", C2: "13,20", C3: "0,1", C4: "" }; // 11,55 → |X − X′| = 0,6125
  const Xbuena = { C1: "1,0020", C2: "12,60", C3: "0,1", C4: "6,25" }; // 11,0030

  await paso("Proteína: duplicados que difieren 0,6125 > 0,38 → 409 con avisos ANTES de guardar", async () => {
    const r = await llamar(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { lecturas: [X, Xmala], motivo: "PRUEBA ALI-D4 se capturan las lecturas" });
    afirmar(r.status === 409 && r.json?.codigo === "AVISOS_ACEPTACION", `→ ${r.status} ${msg(r.json)}`);
    afirmar(r.json.avisos.length === 1 && cerca(r.json.avisos[0].diferencia, 0.6125), `avisos ${JSON.stringify(r.json.avisos)}`);
    const sigue = (await resultados()).find((x) => x.id === C.rP.id);
    afirmar(Number(sigue.valorNumerico) === 12.4, "el 409 no debe guardar nada");
    return msg(r.json);
  });

  await paso("Proteína: el analista confirma → se guarda el promedio con los avisos registrados", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { lecturas: [X, Xmala], confirmarAvisos: true, motivo: "PRUEBA ALI-D4 se confirma con aviso" });
    afirmar(cerca(r.valorNumerico, (10.9375 + 11.55) / 2), `valor ${r.valorNumerico}`);
    afirmar(r.avisosAceptacion?.length === 1, "la respuesta no trae los avisos");
    const v = (await resultados()).find((x) => x.id === C.rP.id);
    afirmar(Array.isArray(v.avisosAceptacion) && v.avisosAceptacion.length === 1, `avisos guardados ${JSON.stringify(v.avisosAceptacion)}`);
    afirmar(v.lecturas[0].C4 === 6.25, `factor por defecto no aplicado: ${JSON.stringify(v.lecturas[0])}`);
    return `${Number(r.valorNumerico).toFixed(5)} %`;
  });

  await paso("Proteína: duplicados dentro de 0,38 → se guarda sin avisos (y se borran los anteriores)", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { lecturas: [X, Xbuena], motivo: "PRUEBA ALI-D4 repetición del duplicado" });
    const esperado = (10.9375 + (1.4 * 0.1 * 12.6 * 6.25) / 1.002) / 2;
    afirmar(cerca(r.valorNumerico, esperado), `valor ${r.valorNumerico} ≠ ${esperado}`);
    afirmar(r.avisosAceptacion === null, "no debía haber avisos");
    const v = (await resultados()).find((x) => x.id === C.rP.id);
    afirmar(v.avisosAceptacion === null, "quedaron los avisos de la captura anterior");
    return `${Number(r.valorNumerico).toFixed(5)} % · ${v.veredicto}`;
  });

  await paso("Con el parámetro en «impedir» la regla no cumplida no se guarda (400) y se restaura «avisar»", async () => {
    await modoReglas("impedir", "PRUEBA ALI-D4: se prueba el modo impedir");
    try {
      const r = await llamar(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { lecturas: [X, Xmala], confirmarAvisos: true, motivo: "PRUEBA ALI-D4 modo impedir" });
      afirmar(r.status === 400 && /Repita la determinación/.test(msg(r.json)), `→ ${r.status} ${msg(r.json)}`);
    } finally {
      await modoReglas(modoOriginal ?? "avisar", "PRUEBA ALI-D4: se vuelve al modo original");
    }
    return `restaurado a ${modoOriginal}`;
  });

  await paso("Materia grasa: sin peso constante (Δ 0,005 g) → 409; a peso constante → 19,74 %", async () => {
    const malo = await llamar(U.a1, "POST", `/flujo/resultado/${C.rG.id}/valor`, { lecturas: [{ C1: "5,0000", C2: "100,0000", C3: "100,9920", C4: "100,9870" }] });
    afirmar(malo.status === 409 && /0,005/.test(msg(malo.json)), `→ ${malo.status} ${msg(malo.json)}`);
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rG.id}/valor`, { lecturas: [{ C1: "5,0000", C2: "100,0000", C3: "100,9876", C4: "100,9870" }] });
    afirmar(cerca(r.valorNumerico, 19.74) && r.avisosAceptacion === null, `valor ${r.valorNumerico}`);
    return `${r.valorNumerico} % · ${r.veredicto}`;
  });

  await paso("Humedad: filtro 1,2 · filtro + muestra 6,2 · peso constante 5,75 → 9 %", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rH.id}/valor`, { lecturas: [{ C1: "1,2000", C2: "6,2000", C3: "5,7500" }] });
    afirmar(cerca(r.valorNumerico, 9), `valor ${r.valorNumerico}`);
    return `${r.valorNumerico} %`;
  });

  await paso("Acidez (cítrico): gasto 15,30 − corrección 0,10 − blanco 0,20, N 0,1, factor 0,064 por defecto → 0,96 %", async () => {
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rA.id}/valor`, { lecturas: [{ C1: "10", C2: "15,30", C3: "0,10", C4: "0,20", C5: "0,1", C6: "" }] });
    afirmar(cerca(r.valorNumerico, 0.96), `valor ${r.valorNumerico}`);
    return `${r.valorNumerico} %`;
  });
}

main()
  .then(() => {
    console.log(`\nFrente ALI-D4: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    pararApi();
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    pararApi();
    process.exit(1);
  });
