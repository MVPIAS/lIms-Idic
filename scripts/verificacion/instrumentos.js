#!/usr/bin/env node
/**
 * Verificación contra una API real de la adquisición de datos desde
 * instrumentos (packages/db/align_instrumentos_importacion.sql, contrato §4.4.6
 * y §4.4.7):
 *   · perfiles de lectura por instrumento con alcance por laboratorio;
 *   · archivo CSV con vista previa (listo, corrige, duplicado, sin muestra,
 *     sin ensayo), aplicación por la captura estándar, corrección con motivo,
 *     archivo repetido, historial y descarga del original (SHA-256);
 *   · perfil XML;
 *   · lectura automática de una carpeta (solo si se indica --carpetas con la
 *     INSTRUMENTOS_DIR de la API).
 *
 * Uso:
 *   node scripts/verificacion/instrumentos.js [--base http://localhost:3001/api] [--carpetas <INSTRUMENTOS_DIR>]
 *
 * Variables: CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA). Crea un cliente y una OT de LQA
 * «PRUEBA» con dos muestras: úsese en una base de pruebas.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:3001/api");
const CARPETAS = arg("--carpetas", null);

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
  a1: "demo.lqa.analista1",
  otroLab: "demo.lmb.analista1",
};
const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
const C = {};

async function main() {
  console.log(`Instrumentos contra ${BASE}`);

  await paso("OT de LQA (PRUEBA) con dos muestras y los métodos 403 (proteína) y 395 (humedad)", async () => {
    C.lqa = lista(await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQA");
    const buscar = async (codigo) => lista(await ok(U.jefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
    C.mP = await buscar("403");
    C.mH = await buscar("395");
    afirmar(C.lqa && C.mP && C.mH, "faltan LQA o los métodos 403/395");
    const base = 77000000 + (Number(sello.slice(-6)) % 999999);
    const cli = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Cliente Prueba Instrumentos ${sello}`, tipo: "particulares", giro: "Pruebas", direccion: "Calle Prueba 1" });
    C.ot = await ok(U.planif, "POST", "/ot", { clienteId: cli.id, unidadPrincipalId: C.lqa.id, conCobro: false, descripcionTrabajo: `OT-PRUEBA instrumentos ${sello}` });
    const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const toma = (reg.opcionesToma ?? []).find((o) => o.codigo === "seccion_muestreo") ?? reg.opcionesToma?.[0];
    const rec = { tomaMuestra: toma.codigo, condicionRecepcion: "cumple", identificacionCliente: "PRUEBA" };
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [1, 2].map((n) => ({ nombre: `PRUEBA harina ${n} ${sello}`, metodoIds: [C.mP.id, C.mH.id], recepcion: rec })),
    });
    [C.m1, C.m2] = r.muestras;
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.r = (m, met) => rs.find((x) => x.muestraId === m.id && x.catMetodoId === met.id);
    C.rP1 = C.r(C.m1, C.mP); C.rH1 = C.r(C.m1, C.mH); C.rP2 = C.r(C.m2, C.mP); C.rH2 = C.r(C.m2, C.mH);
    afirmar(C.rP1 && C.rH1 && C.rP2 && C.rH2, "faltan ensayos");
    C.nombreH = C.rH1.analitoNombre ?? C.rH1.catAnalito?.nombre ?? C.rH1.ensayo ?? null;
    return `${C.ot.codigo} · ${C.m1.codigo}, ${C.m2.codigo}`;
  });

  await paso("Perfil CSV del jefe de LQA con equivalencias; el analista no configura; LMB no lo ve", async () => {
    const pf = {
      nombre: `PRUEBA Analizador NIR LQA ${sello}`, unidadId: C.lqa.id, formato: "CSV", separador: ";", decimal: ".", filaCabecera: 2,
      colMuestra: "Sample", colEnsayo: "Parameter", colValor: "Result", colUnidad: "Unit",
      equivalencias: { Protein: "403", Moisture: "395" },
    };
    C.perfil = (await ok(U.jefe, "POST", "/instrumentos/perfiles", pf)).id;
    await exigir(409, U.jefe, "POST", "/instrumentos/perfiles", { ...pf, nombre: pf.nombre.toLowerCase() });
    await exigir(400, U.jefe, "POST", "/instrumentos/perfiles", { ...pf, nombre: `PRUEBA x ${sello}`, colEnsayo: null });
    await exigir(403, U.a1, "POST", "/instrumentos/perfiles", { ...pf, nombre: `PRUEBA y ${sello}` });
    const a = await ok(U.a1, "GET", "/instrumentos/perfiles");
    afirmar(a.perfiles.some((p) => p.id === C.perfil) && !a.puedeConfigurar, "el analista de LQA no ve el perfil");
    const o = await ok(U.otroLab, "GET", "/instrumentos/perfiles");
    afirmar(!o.perfiles.some((p) => p.id === C.perfil), "LMB ve el perfil de LQA");
  });

  const csv = () =>
    [
      "NIR PRUEBA;exportado 02-11-2026",
      "Sample;Parameter;Result;Unit",
      `${C.m1.codigo};Protein;12.40;%`,
      `${C.m2.codigo};Protein;13.0;%`,
      `${C.m2.codigo};Moisture;10.5;%`,
      `OT-NO-EXISTE-M9;Protein;9.9;%`,
      `${C.m1.codigo};Ash;1.2;%`,
      `${C.m1.codigo};Protein;12.45;%`,
    ].join("\r\n");

  await paso("Vista previa: listo, corrige, duplicado, sin muestra y sin ensayo; nada se captura aún", async () => {
    await ok(U.a1, "POST", `/flujo/resultado/${C.rH2.id}/valor`, { valor: "11,0" });
    C.archivo = Buffer.from(csv(), "utf8");
    const v = await ok(U.a1, "POST", "/instrumentos/importaciones", undefined, formulario({ perfilId: C.perfil, otId: C.ot.id }, "nir_prueba.csv", C.archivo));
    C.imp = v.id;
    const e = Object.fromEntries(v.filas.map((f) => [f.fila, f.estado]));
    afirmar(e[3] === "duplicado" && e[4] === "listo" && e[5] === "corrige" && e[6] === "sin_muestra" && e[7] === "sin_ensayo" && e[8] === "listo", `estados ${JSON.stringify(e)}`);
    afirmar(v.filas.find((f) => f.fila === 8).resultadoId === C.rP1.id && v.filas.find((f) => f.fila === 5).valorAnterior, "emparejamiento");
    afirmar(v.hashSha256 === crypto.createHash("sha256").update(C.archivo).digest("hex") && v.yaImportado.length === 0, "hash");
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    afirmar(rs.find((x) => x.id === C.rP1.id).estado !== "capturado", "la vista previa capturó");
    await exigir(404, U.otroLab, "GET", `/instrumentos/importaciones/${C.imp}`);
    await exigir(400, U.a1, "POST", "/instrumentos/importaciones", undefined, formulario({ perfilId: C.perfil }, "nir.exe", C.archivo));
    return JSON.stringify(v.resumen);
  });

  await paso("Aplicar: 2 ensayos capturados por la captura estándar a nombre del analista; la corrección queda pendiente", async () => {
    await exigir(403, U.jefe, "POST", `/instrumentos/importaciones/${C.imp}/aplicar`, {});
    const r = await ok(U.a1, "POST", `/instrumentos/importaciones/${C.imp}/aplicar`, {});
    afirmar(r.aplicadas === 2 && r.errores === 0, `aplicadas ${r.aplicadas} errores ${r.errores}`);
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    const p1 = rs.find((x) => x.id === C.rP1.id);
    const h2 = rs.find((x) => x.id === C.rH2.id);
    const val = (x) => String(x.valorTexto ?? x.resultadoFinal ?? x.valorNumerico ?? x.promedio ?? "");
    afirmar(p1.estado === "capturado" && /^12[.,]45/.test(val(p1)), `proteína M1 ${p1.estado} ${val(p1)}`);
    afirmar(/^11/.test(val(h2)), `la humedad M2 cambió sin motivo: ${val(h2)}`);
    await exigir(409, U.a1, "POST", `/instrumentos/importaciones/${C.imp}/aplicar`, {});
    return `proteína M1 = ${val(p1)}`;
  });

  await paso("El mismo archivo otra vez: aviso de ya importado; corrección con motivo de la fila elegida", async () => {
    const v = await ok(U.a1, "POST", "/instrumentos/importaciones", undefined, formulario({ perfilId: C.perfil, otId: C.ot.id }, "nir_prueba.csv", C.archivo));
    afirmar(v.yaImportado.length === 1, "no avisa del archivo repetido");
    afirmar(v.filas.find((f) => f.fila === 8).estado === "corrige", "la proteína M1 ya capturada debe pedir motivo");
    await exigir(400, U.a1, "POST", `/instrumentos/importaciones/${v.id}/aplicar`, { filas: [5], motivo: "x" });
    const r = await ok(U.a1, "POST", `/instrumentos/importaciones/${v.id}/aplicar`, { filas: [5], motivo: "PRUEBA valor del instrumento" });
    afirmar(r.aplicadas === 1, `aplicadas ${r.aplicadas}`);
    const h2 = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados.find((x) => x.id === C.rH2.id);
    afirmar(/^10[.,]5/.test(String(h2.valorTexto ?? h2.resultadoFinal ?? h2.valorNumerico ?? "")), "no corrigió la humedad M2");
  });

  await paso("Historial y archivo original íntegro (SHA-256)", async () => {
    const h = await ok(U.a1, "GET", `/instrumentos/importaciones?perfilId=${C.perfil}`);
    afirmar(h.length === 2 && h.every((x) => x.estado === "APLICADA") && h.some((x) => x.aplicadas === 2), JSON.stringify(h.map((x) => [x.estado, x.aplicadas])));
    const o = await exigir(200, U.a1, "GET", `/instrumentos/importaciones/${C.imp}/original`);
    afirmar(Buffer.isBuffer(o) && o.equals(C.archivo), "el original no coincide");
  });

  await paso("Perfil XML (registro con atributo e hijos) y descarte de la vista previa", async () => {
    C.perfilXml = (await ok(U.jefe, "POST", "/instrumentos/perfiles", {
      nombre: `PRUEBA Titulador XML ${sello}`, unidadId: C.lqa.id, formato: "XML", decimal: ".", elementoRegistro: "Result",
      colMuestra: "@sample", colEnsayo: "Method", colValor: "Value",
    })).id;
    const xml = `<?xml version="1.0"?><Run><Result sample="${C.m2.codigo}"><Method>403</Method><Value>13.2</Value></Result><Result sample="${C.m1.codigo}"><Method>Ash</Method><Value>1</Value></Result></Run>`;
    const v = await ok(U.a1, "POST", "/instrumentos/importaciones", undefined, formulario({ perfilId: C.perfilXml }, "titulador.xml", Buffer.from(xml)));
    afirmar(v.filas[0].estado === "corrige" && v.filas[0].valor === "13,2" && v.filas[1].estado === "sin_ensayo", JSON.stringify(v.filas.map((f) => [f.estado, f.valor])));
    await ok(U.a1, "POST", `/instrumentos/importaciones/${v.id}/descartar`);
    await exigir(409, U.a1, "POST", `/instrumentos/importaciones/${v.id}/aplicar`, {});
  });

  if (CARPETAS) {
    await paso("Lectura automática: archivo dejado en la carpeta del perfil → capturado a nombre del responsable y movido a «procesados»", async () => {
      const yo = await ok(U.a1, "GET", "/agenda/usuarios?q=demo.lqa.analista1").catch(() => []);
      const analista = (Array.isArray(yo) ? yo : []).find((x) => x.username === U.a1)?.id ?? sesiones[U.a1].id;
      const carpeta = `prueba_nir_${sello}`;
      await ok(U.jefe, "PATCH", `/instrumentos/perfiles/${C.perfil}`, { carpeta, responsableId: analista });
      const dir = path.join(CARPETAS, carpeta);
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, "lote_automatico.csv");
      // La humedad de la muestra 1 aún no tiene valor: entra sola. La proteína de la 2 ya tiene: queda para una persona.
      fs.writeFileSync(f, ["NIR PRUEBA", "Sample;Parameter;Result;Unit", `${C.m1.codigo};Moisture;9.80;%`, `${C.m2.codigo};Protein;13.5;%`].join("\n"));
      const viejo = new Date(Date.now() - 60000);
      fs.utimesSync(f, viejo, viejo);
      const r = await ok(U.jefe, "POST", "/instrumentos/carpetas/revisar");
      const mio = r.find((x) => x.archivo === "lote_automatico.csv");
      afirmar(mio && mio.estado === "aplicada" && mio.aplicadas === 1 && mio.errores === 0, `revisión ${JSON.stringify(r)}`);
      afirmar(!fs.existsSync(f) && fs.readdirSync(path.join(dir, "procesados")).some((x) => x.endsWith("lote_automatico.csv")), "el archivo no se movió a procesados");
      const h = await ok(U.jefe, "GET", `/instrumentos/importaciones?perfilId=${C.perfil}`);
      afirmar(h[0].origen === "CARPETA", "el historial no registra la lectura automática");
      const d = await ok(U.jefe, "GET", `/instrumentos/importaciones/${h[0].id}`);
      const e = d.filas.map((x) => x.estado).join();
      afirmar(e === "capturado,corrige", `filas ${e}`);
      const h1 = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados.find((x) => x.id === C.rH1.id);
      afirmar(h1.estado === "capturado" && /^9[.,]8/.test(String(h1.valorTexto ?? h1.resultadoFinal ?? h1.valorNumerico ?? "")), `humedad M1 ${h1.estado}`);
      await ok(U.jefe, "PATCH", `/instrumentos/perfiles/${C.perfil}`, { carpeta: null });
      return `${dir} → procesados`;
    });
  } else console.log("  (sin --carpetas: no se prueba la lectura automática)");

  await paso("Baja de los perfiles PRUEBA", async () => {
    for (const id of [C.perfil, C.perfilXml]) await ok(U.jefe, "DELETE", `/instrumentos/perfiles/${id}`);
    afirmar(!(await ok(U.jefe, "GET", "/instrumentos/perfiles")).perfiles.some((p) => [C.perfil, C.perfilXml].includes(p.id)), "siguen listados");
  });
}

main()
  .then(() => {
    console.log(`\nInstrumentos: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    process.exit(1);
  });
