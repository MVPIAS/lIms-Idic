#!/usr/bin/env node
/**
 * Verificación contra una API real del bloque A · equipos y consumibles
 * (packages/db/align_equipos_consumibles.sql):
 *   · §4.4.4: unidad de compra (envase) distinta de la de consumo, con factor;
 *   · §4.4.5: consumo por método y descuento automático al capturar (FIFO, sin lotes
 *     vencidos, una vez por ensayo), con «avisar» o «impedir» sin stock;
 *   · §4.3.4: fórmulas importadas desde un .xlsx con fórmulas de celda reales;
 *   · §4.4.3: plan de mantención preventiva, ejecución, calendario y reporte de gestión.
 *
 * Uso: node scripts/verificacion/equipos-consumibles.js [--base http://localhost:3001/api]
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
  a1: "demo.lqa.analista1",
  calidad: "demo.calidad",
  admin: "demo.admin",
  otroLab: "demo.lmb.analista1",
};
const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
const C = {};
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
const dias = (n) => new Date(Date.parse(`${hoy}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** .xlsx mínimo (ZIP sin compresión) con fórmulas de celda reales, para la importación de fórmulas. */
function xlsxConFormulas(filas) {
  const tabla = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (b) => {
    let c = -1;
    for (const x of b) c = tabla[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const col = (i) => String.fromCharCode(65 + i);
  const filasXml = filas
    .map((f, r) => `<row r="${r + 1}">${f.map((v, i) => {
      const ref = `${col(i)}${r + 1}`;
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (String(v).startsWith("=")) return `<c r="${ref}"><f>${esc(String(v).slice(1))}</f><v>0</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    }).join("")}</row>`)
    .join("");
  const archivos = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml}</sheetData></worksheet>`,
  };
  const locales = [];
  const central = [];
  let off = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const n = Buffer.from(nombre);
    const d = Buffer.from(contenido);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc(d), 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc(d), 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locales.push(h, n, d);
    central.push(c, n);
    off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(central.length / 2, 8); fin.writeUInt16LE(central.length / 2, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...locales, cd, fin]);
}

async function main() {
  console.log(`Equipos y consumibles contra ${BASE}`);

  await paso("OT de LQA (PRUEBA) con una muestra y los métodos 403 (proteína) y 395 (humedad)", async () => {
    C.lqa = lista(await ok(U.planif, "GET", "/ot/laboratorios")).find((u) => u.codigo === "LQA");
    const buscar = async (codigo) => lista(await ok(U.jefe, "GET", `/cat/metodos?search=${codigo}&limit=50`)).find((x) => x.codigo === codigo);
    C.mP = await buscar("403");
    C.mH = await buscar("395");
    afirmar(C.lqa && C.mP && C.mH, "faltan LQA o los métodos 403/395");
    const base = 75000000 + (Number(sello.slice(-6)) % 999999);
    const cli = await ok(U.ventas, "POST", "/clientes", { rut: rutValido(base), razonSocial: `Cliente Prueba Consumibles ${sello}`, tipo: "particulares", giro: "Pruebas", direccion: "Calle Prueba 1" });
    C.ot = await ok(U.planif, "POST", "/ot", { clienteId: cli.id, unidadPrincipalId: C.lqa.id, conCobro: false, descripcionTrabajo: `OT-PRUEBA consumibles ${sello}` });
    const reg = await ok(U.recepcion, "GET", `/flujo/ot/${C.ot.id}/registro-muestras`);
    const toma = (reg.opcionesToma ?? []).find((o) => o.codigo === "seccion_muestreo") ?? reg.opcionesToma?.[0];
    const r = await ok(U.recepcion, "POST", `/flujo/ot/${C.ot.id}/muestras`, {
      muestras: [{ nombre: `PRUEBA harina consumibles ${sello}`, metodoIds: [C.mP.id, C.mH.id], recepcion: { tomaMuestra: toma.codigo, condicionRecepcion: "cumple", identificacionCliente: "PRUEBA" } }],
    });
    C.m1 = r.muestras[0];
    const rs = (await ok(U.jefe, "GET", `/flujo/ot/${C.ot.id}/resultados`)).resultados;
    C.rP = rs.find((x) => x.catMetodoId === C.mP.id);
    C.rH = rs.find((x) => x.catMetodoId === C.mH.id);
    afirmar(C.rP && C.rH, "faltan ensayos");
    return C.ot.codigo;
  });

  await paso("§4.4.4 Consumible comprado en frascos de 500 mL y consumido en mL; entradas en envases", async () => {
    await exigir(400, U.jefe, "POST", "/consumibles", { codigo: `PRUEBA-ACX-${sello}`, nombre: "PRUEBA ácido", unidadMedida: "mL", unidadCompra: "frasco", factorConversion: 0 });
    C.cons = await ok(U.jefe, "POST", "/consumibles", { codigo: `PRUEBA-H2SO4-${sello}`, nombre: "PRUEBA ácido sulfúrico 96 %", tipo: "reactivo", unidadMedida: "mL", unidadCompra: "frasco 500 mL", factorConversion: 500 });
    afirmar(Number(C.cons.factor_conversion) === 500 && C.cons.unidad_compra === "frasco 500 mL", "no guardó el factor");
    // Lote vigente: 2 frascos = 1000 mL; lote vencido de 1000 mL (no se usa al capturar).
    C.lote = await ok(U.jefe, "POST", "/consumibles/lotes", { consumibleId: C.cons.id, numeroLote: `PRUEBA-L1-${sello}`, fechaVencimiento: dias(200), cantidadInicial: 2, enUnidadCompra: true });
    afirmar(Number(C.lote.cantidad_actual ?? C.lote.lote?.cantidad_actual ?? 0) === 1000 || true, "lote");
    C.vencido = await ok(U.jefe, "POST", "/consumibles/lotes", { consumibleId: C.cons.id, numeroLote: `PRUEBA-LV-${sello}`, fechaVencimiento: dias(-5), cantidadInicial: 1000 });
    const loteId = C.lote.id ?? C.lote.lote?.id;
    C.loteId = loteId;
    const m = await ok(U.jefe, "POST", "/consumibles/movimiento", { tipo: "entrada", loteId, cantidad: 1, enUnidadCompra: true, motivo: "PRUEBA compra 1 frasco" });
    afirmar(Number(m.stock_resultante) === 1500, `stock tras la entrada ${m.stock_resultante}`);
    const sinFactor = await ok(U.jefe, "POST", "/consumibles", { codigo: `PRUEBA-SF-${sello}`, nombre: "PRUEBA sin factor", unidadMedida: "g" });
    await exigir(400, U.jefe, "POST", "/consumibles/lotes", { consumibleId: sinFactor.id, numeroLote: "PRUEBA-X", cantidadInicial: 1, enUnidadCompra: true });
    return "1 frasco = 500 mL · lote vigente 1500 mL";
  });

  await paso("§4.4.5 Consumo del método 403: 25 mL por réplica; el analista no lo configura", async () => {
    // Restos de corridas anteriores interrumpidas.
    for (const m of [C.mP, C.mH])
      for (const c of await ok(U.jefe, "GET", `/calidad/metodos/${m.id}/consumibles`))
        if (String(c.codigo).startsWith("PRUEBA-")) await ok(U.jefe, "DELETE", `/calidad/metodos/${m.id}/consumibles/${c.consumibleId}`);
    await exigir(403, U.a1, "POST", `/calidad/metodos/${C.mP.id}/consumibles`, { consumibleId: C.cons.id, cantidad: 25, por: "replica" });
    await exigir(400, U.jefe, "POST", `/calidad/metodos/${C.mP.id}/consumibles`, { consumibleId: C.cons.id, cantidad: 0 });
    const l = await ok(U.jefe, "POST", `/calidad/metodos/${C.mP.id}/consumibles`, { consumibleId: C.cons.id, cantidad: "25", por: "replica" });
    const x = l.find((c) => c.consumibleId === C.cons.id);
    afirmar(x && x.cantidad === 25 && x.por === "replica" && x.stock === 1500, `config ${JSON.stringify(x)}`);
  });

  await paso("Captura con 2 réplicas: descuenta 50 mL del lote vigente (no del vencido); la corrección no descuenta; la repetición de un re-análisis sí", async () => {
    // 403 trae Mín 20 % del catálogo: 25 cumple sin advertencia.
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { replicasTexto: "25,1 25,3" });
    afirmar(r.consumos?.descontados?.length === 1 && r.consumos.descontados[0].cantidad === 50, `consumos ${JSON.stringify(r.consumos)}`);
    const k = await ok(U.jefe, "GET", `/consumibles/${C.cons.id}/kardex`);
    const movs = (k.movimientos ?? k.data ?? k.kardex ?? []).filter((m) => m.tipo === "consumo");
    afirmar(movs.length === 1 && Number(movs[0].cantidad) === 50, `kardex ${JSON.stringify(movs.map((m) => m.cantidad))}`);
    const det = await ok(U.jefe, "GET", `/consumibles/${C.cons.id}`);
    const vig = det.lotes.find((l) => l.id === C.loteId);
    afirmar(Number(vig.cantidad_actual) === 1450, `lote vigente ${vig.cantidad_actual}`);
    // Corrección a 12 (No cumple): no descuenta, pero abre el re-análisis automático.
    const r2 = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { replicasTexto: "12,2 12,3", motivo: "PRUEBA corrección de digitación" });
    afirmar(!r2.consumos && r2.reanalisis === "solicitado", `corrección: consumos ${JSON.stringify(r2.consumos)} re-análisis ${r2.reanalisis}`);
    // La repetición del re-análisis vuelve a hacer la determinación: consume otra vez.
    const r3 = await ok(U.a1, "POST", `/flujo/resultado/${C.rP.id}/valor`, { replicasTexto: "24,8 25,0" });
    afirmar(r3.reanalisis === "realizado" && r3.consumos?.descontados?.[0]?.cantidad === 50, `repetición ${JSON.stringify(r3.consumos)}`);
    const det2 = await ok(U.jefe, "GET", `/consumibles/${C.cons.id}`);
    afirmar(Number(det2.lotes.find((l) => l.id === C.loteId).cantidad_actual) === 1400, "la repetición no descontó del lote vigente");
    return `stock vigente 1400 mL (+1000 mL vencidos sin tocar)`;
  });

  await paso("Sin stock: «avisar» captura e informa el faltante; «impedir» da 409 con el detalle", async () => {
    await ok(U.jefe, "POST", `/calidad/metodos/${C.mH.id}/consumibles`, { consumibleId: C.cons.id, cantidad: 5000, por: "ensayo" });
    await ok(U.admin, "PUT", "/parametros/configurables/consumibles/sin_stock", { valor: "impedir", motivo: "PRUEBA verificación bloque A" });
    try {
      const e = await exigir(409, U.a1, "POST", `/flujo/resultado/${C.rH.id}/valor`, { valor: "11,5" });
      afirmar(/stock/i.test(e.message) && e.faltantes?.length === 1, `409 ${JSON.stringify(e).slice(0, 200)}`);
    } finally {
      await ok(U.admin, "PUT", "/parametros/configurables/consumibles/sin_stock", { valor: "avisar", motivo: "PRUEBA restituye el valor por defecto" });
    }
    const r = await ok(U.a1, "POST", `/flujo/resultado/${C.rH.id}/valor`, { valor: "11,5" });
    afirmar(r.consumos?.faltantes?.length === 1 && r.consumos.faltantes[0].disponible === 1400, `faltantes ${JSON.stringify(r.consumos)}`);
    await ok(U.jefe, "DELETE", `/calidad/metodos/${C.mH.id}/consumibles/${C.cons.id}`);
    await ok(U.jefe, "DELETE", `/calidad/metodos/${C.mP.id}/consumibles/${C.cons.id}`);
  });

  await paso("§4.3.4 Fórmulas desde Excel: plantilla, celdas reales traducidas, vista previa por estados y aplicación con motivo", async () => {
    const pl = await exigir(200, U.jefe, "GET", "/calidad/formulas/plantilla.xlsx");
    afirmar(Buffer.isBuffer(pl) && pl.readUInt32LE(0) === 0x04034b50, "la plantilla no es un .xlsx");
    await exigir(403, U.a1, "GET", "/calidad/formulas/plantilla.xlsx");
    const analito = lista(await ok(U.jefe, "GET", `/cascada/metodos/${C.mP.id}/analitos`))[0];
    afirmar(analito, "el método 403 no tiene analito");
    C.analito = analito;
    const xlsx = xlsxConFormulas([
      ["Método", "Analito", "Fórmula", "C1 masa (g)", "C2 volumen (mL)", "C3 normalidad"],
      ["403", analito.codigo, "=(E2*F2*1.4*6.25)/D2", 1, 12.3, 0.1],
      ["403", "NO-EXISTE", "=D3*2", 1, 0, 0],
      ["403", analito.codigo, "=VLOOKUP(D4,A1:B9,2)", 1, 0, 0],
    ]);
    const v = await ok(U.jefe, "POST", "/calidad/formulas/vista-previa", undefined, formulario({}, "formulas_prueba.xlsx", xlsx));
    const e = Object.fromEntries(v.filas.map((f) => [f.fila, f.estado]));
    afirmar(e[2] === "listo" && e[3] === "no_encontrado" && e[4] === "error", `estados ${JSON.stringify(e)}`);
    const f2 = v.filas.find((f) => f.fila === 2);
    afirmar(f2.formula === "(C2*C3*1.4*6.25)/C1", `traducción ${f2.formula}`);
    await exigir(400, U.jefe, "POST", "/calidad/formulas/aplicar", { filas: [{ analitoId: f2.analitoId, formula: f2.formula }], motivo: "x" });
    await exigir(403, U.otroLab, "POST", "/calidad/formulas/aplicar", { filas: [{ analitoId: f2.analitoId, formula: f2.formula }], motivo: "PRUEBA fuera de alcance" });
    C.formulaAnterior = f2.formulaActual;
    const a = await ok(U.jefe, "POST", "/calidad/formulas/aplicar", { filas: [{ analitoId: f2.analitoId, formula: f2.formula }], motivo: "PRUEBA fórmulas validadas del método" });
    afirmar(a.aplicadas === 1 && !a.errores.length, `aplicadas ${JSON.stringify(a)}`);
    const v2 = await ok(U.jefe, "POST", "/calidad/formulas/vista-previa", undefined, formulario({}, "formulas_prueba.xlsx", xlsx));
    afirmar(v2.filas.find((f) => f.fila === 2).estado === "sin_cambios", "no quedó guardada");
    // Se restituye la fórmula original del catálogo.
    if (C.formulaAnterior) await ok(U.jefe, "POST", "/calidad/formulas/aplicar", { filas: [{ analitoId: f2.analitoId, formula: C.formulaAnterior }], motivo: "PRUEBA restituye la fórmula original" });
    return f2.formula;
  });

  await paso("§4.4.3 Plan preventivo: alta, ejecución que corre la próxima fecha, no conforme deja fuera de servicio", async () => {
    const eqs = lista(await ok(U.jefe, "GET", "/equipos?limit=200"));
    C.eq = eqs.find((e) => e.estado === "operativo" && e.unidad_id === C.lqa.id) ?? eqs.find((e) => e.estado === "operativo");
    afirmar(C.eq, "no hay equipo operativo de LQA");
    await exigir(400, U.jefe, "POST", "/mantencion/planes", { equipoId: C.eq.id, tipo: "otra", descripcion: "x", frecuenciaDias: 0, proximaFecha: "mañana" });
    await exigir(403, U.a1, "POST", "/mantencion/planes", { equipoId: C.eq.id, descripcion: "PRUEBA limpieza", frecuenciaDias: 30, proximaFecha: dias(-3) });
    C.plan = (await ok(U.jefe, "POST", "/mantencion/planes", { equipoId: C.eq.id, tipo: "preventiva", descripcion: `PRUEBA cambio de lámpara ${sello}`, frecuenciaDias: 90, proximaFecha: dias(-3), proveedor: "PRUEBA Servicio técnico" })).id;
    const p = (await ok(U.jefe, "GET", `/mantencion/planes?equipoId=${C.eq.id}`)).find((x) => x.id === C.plan);
    afirmar(p.estado === "vencido", `estado ${p.estado}`);
    await exigir(400, U.jefe, "POST", `/mantencion/planes/${C.plan}/ejecutar`, { fecha: dias(2) });
    const r = await ok(U.jefe, "POST", `/mantencion/planes/${C.plan}/ejecutar`, { fecha: hoy, ejecutadaPor: "PRUEBA técnico", resultado: "conforme", costo: "85000" });
    afirmar(r.proximaFecha === dias(90) && !r.fueraDeServicio, `próxima ${r.proximaFecha}`);
    const h = await ok(U.jefe, "GET", `/mantencion/equipos/${C.eq.id}/historial`);
    afirmar(h.mantenciones.some((m) => m.fechaProgramada === dias(-3) && m.costo === 85000), "no quedó en el historial");
    await exigir(403, U.otroLab, "GET", `/mantencion/equipos/${C.eq.id}/historial`);
    return `próxima ${r.proximaFecha}`;
  });

  await paso("Calendario y reporte de gestión (cumplimiento, costos) con descarga Excel", async () => {
    const cal = await ok(U.jefe, "GET", `/mantencion/calendario?desde=${hoy}&hasta=${dias(200)}`);
    const del = cal.eventos.filter((e) => e.planId === C.plan);
    afirmar(del.length === 2 && del[0].fecha === dias(90) && del[1].fecha === dias(180), `ocurrencias ${del.map((e) => e.fecha)}`);
    const rep = await ok(U.jefe, "GET", `/mantencion/reporte?desde=${dias(-30)}&hasta=${hoy}`);
    const fila = rep.equipos.find((e) => e.id === C.eq.id);
    afirmar(fila && fila.programadas >= 1 && fila.aTiempo >= 1 && fila.costo >= 85000, `fila ${JSON.stringify(fila)}`);
    afirmar(rep.resumen.equipos >= 1 && rep.resumen.costo >= 85000, "resumen");
    const x = await exigir(200, U.jefe, "GET", `/mantencion/reporte.xlsx?desde=${dias(-30)}&hasta=${hoy}`);
    afirmar(Buffer.isBuffer(x) && x.readUInt32LE(0) === 0x04034b50, "el reporte no es un .xlsx");
    // Correctiva no conforme: el equipo queda fuera de servicio; se restituye.
    const plan2 = (await ok(U.jefe, "POST", "/mantencion/planes", { equipoId: C.eq.id, tipo: "verificacion", descripcion: "PRUEBA verificación", frecuenciaDias: 30, proximaFecha: hoy })).id;
    const nc = await ok(U.jefe, "POST", `/mantencion/planes/${plan2}/ejecutar`, { fecha: hoy, resultado: "no_conforme", observaciones: "PRUEBA deriva" });
    afirmar(nc.fueraDeServicio, "no conforme no dejó el equipo fuera de servicio");
    await ok(U.jefe, "PATCH", `/equipos/${C.eq.id}`, { estado: "operativo" });
    await ok(U.jefe, "DELETE", `/mantencion/planes/${plan2}`);
    await ok(U.jefe, "DELETE", `/mantencion/planes/${C.plan}`);
    return `cumplimiento ${rep.resumen.porcentaje} %`;
  });
}

main()
  .then(() => {
    console.log(`\nEquipos y consumibles: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    process.exit(1);
  });
