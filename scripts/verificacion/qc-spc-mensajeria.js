#!/usr/bin/env node
/**
 * Pruebas funcionales documentadas (contrato §5.7) de tres módulos contra una
 * API real: control de calidad (QC), control estadístico (SPC) y mensajería.
 * Cada caso tiene un código (QC-01…, SPC-01…, MSJ-01…) que se repite en el
 * documento de resultados (docs/PRUEBAS_FUNCIONALES_BLOQUE_A.md).
 *
 *   QC   · registro con evaluación automática (+/−, cepa y lote del medio),
 *          rechazo automático, segregación (quien registra no aprueba),
 *          aprobación por el revisor, estado global de la OT y alcance por
 *          laboratorio; los controles de prueba se retiran al final.
 *   SPC  · analitos con datos, serie de un analito y estadísticos (media, σ,
 *          LC ± 3σ, rango móvil, puntos fuera de control) recalculados aquí,
 *          alcance por laboratorio y validación de parámetros.
 *   MSJ  · plantillas, historial con filtros, notificación del resultado de una
 *          OT con registro en la bitácora (sin servidor de correo el envío queda
 *          registrado con su error, sin romper la operación) y permisos.
 *
 * Uso: node scripts/verificacion/qc-spc-mensajeria.js [--base http://localhost:3001/api]
 * Variables: CLAVE_DEMO (o la CLAVE_DEMO_EMBEBIDA del código). Úsese en una base
 * de pruebas con los usuarios demo (demo.lmb.*, demo.lqa.*, demo.comercial…).
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
const SALIDA = arg("--salida", null);

function claveDemo() {
  if (process.env.CLAVE_DEMO) return process.env.CLAVE_DEMO;
  const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/auth/auth.service.ts"), "utf8");
  return src.match(/CLAVE_DEMO_EMBEBIDA\s*=\s*"([^"]+)"/)[1];
}
const CLAVE = claveDemo();

const sesiones = {};
async function login(u) {
  if (sesiones[u]) return sesiones[u];
  const r = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: CLAVE }) });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${u}: HTTP ${r.status}`);
  return (sesiones[u] = j.accessToken);
}
async function pedir(u, metodo, ruta, cuerpo) {
  const headers = { authorization: `Bearer ${await login(u)}` };
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
}

const casos = [];
function caso(codigo, descripcion, ok, detalle = "") {
  casos.push({ codigo, descripcion, ok: !!ok, detalle: String(detalle).slice(0, 240) });
  console.log(`${ok ? "OK " : "NO "} ${codigo} ${descripcion}${detalle ? ` · ${String(detalle).slice(0, 160)}` : ""}`);
}

/* ======================================================================= QC */
async function qc() {
  const AN = "demo.lmb.analista1";
  const RV = "demo.lmb.revisor";
  const OTRO = "demo.lqa.analista1";
  // OT del LMB con métodos que exigen QC y algo pendiente.
  const ots = await pedir(AN, "GET", "/ot?page=1&limit=100");
  let ot = null;
  let estado = null;
  for (const o of ots.j?.data ?? []) {
    const e = await pedir(AN, "GET", `/qc/ot/${o.id}`);
    if (e.status === 200 && e.j.metodos?.some((m) => m.tiposFaltantes?.includes("positivo"))) {
      ot = o;
      estado = e.j;
      break;
    }
  }
  caso("QC-01", "El analista ve el QC de una OT de su laboratorio con los tipos exigidos por método", !!ot, ot ? `${ot.codigo}: ${estado.metodos.map((m) => `${m.codigo} exige ${m.tiposExigidos.join("/")}`).join("; ")}` : "sin OT del LMB con QC pendiente");
  if (!ot) return;
  const metodo = estado.metodos.find((m) => m.tiposFaltantes.includes("positivo"));
  const cepas = (await pedir(AN, "GET", "/qc/cepas")).j;
  const cepa = (Array.isArray(cepas) ? cepas : cepas.data ?? []).find((c) => c.activo);
  const creados = [];

  const sinCepa = await pedir(AN, "POST", `/qc/ot/${ot.id}/control`, { catMetodoId: metodo.id, tipo: "positivo", resultadoCualitativo: "+", loteMedio: "PRUEBA-L1", observaciones: "PRUEBA bloque A" });
  caso("QC-02", "Un control positivo sin cepa de referencia ATCC no se registra", sinCepa.status === 400, `HTTP ${sinCepa.status} ${sinCepa.j?.message ?? ""}`);
  if (sinCepa.status < 300) creados.push(sinCepa.j.id);

  const pos = await pedir(AN, "POST", `/qc/ot/${ot.id}/control`, { catMetodoId: metodo.id, tipo: "positivo", resultadoCualitativo: "+", loteMedio: "PRUEBA-L1", cepaId: cepa?.id, observaciones: "PRUEBA bloque A" });
  caso("QC-03", "Positivo que crece (+) con cepa y lote: cumple y queda pendiente de aprobación", pos.status < 300 && pos.j?.resultado === "pendiente", `HTTP ${pos.status} resultado=${pos.j?.resultado}`);
  if (pos.j?.id) creados.push(pos.j.id);

  const malo = await pedir(AN, "POST", `/qc/ot/${ot.id}/control`, { catMetodoId: metodo.id, tipo: "negativo", resultadoCualitativo: "+", loteMedio: "PRUEBA-L1", observaciones: "PRUEBA bloque A" });
  caso("QC-04", "Negativo que crece (+): se rechaza automáticamente", malo.status < 300 && malo.j?.resultado === "rechazado", `HTTP ${malo.status} resultado=${malo.j?.resultado}`);
  if (malo.j?.id) creados.push(malo.j.id);

  const neg = await pedir(AN, "POST", `/qc/ot/${ot.id}/control`, { catMetodoId: metodo.id, tipo: "negativo", resultadoCualitativo: "-", loteMedio: "PRUEBA-L1", observaciones: "PRUEBA bloque A" });
  const bla = await pedir(AN, "POST", `/qc/ot/${ot.id}/control`, { catMetodoId: metodo.id, tipo: "blanco", resultadoCualitativo: "-", loteMedio: "PRUEBA-L1", observaciones: "PRUEBA bloque A" });
  [neg, bla].forEach((x) => x.j?.id && creados.push(x.j.id));
  caso("QC-05", "Negativo (−) y blanco de medio (−) cumplen: pendientes de aprobación", neg.j?.resultado === "pendiente" && bla.j?.resultado === "pendiente", `negativo=${neg.j?.resultado} blanco=${bla.j?.resultado}`);

  const propio = await pedir(AN, "PATCH", `/qc/control/${pos.j?.id}`, { resultado: "aprobado" });
  caso("QC-06", "Aprobar exige el permiso de revisión: el analista que lo registró no puede aprobarlo", propio.status === 403 || propio.status === 409, `HTTP ${propio.status} ${propio.j?.message ?? ""}`);

  // Segregación: ni siquiera un revisor aprueba el control que él mismo registró.
  const delRevisor = await pedir(RV, "POST", `/qc/ot/${ot.id}/control`, { catMetodoId: metodo.id, tipo: "negativo", resultadoCualitativo: "-", loteMedio: "PRUEBA-L2", observaciones: "PRUEBA bloque A (registrado por el revisor)" });
  if (delRevisor.j?.id) creados.push(delRevisor.j.id);
  const autoAprob = await pedir(RV, "PATCH", `/qc/control/${delRevisor.j?.id}`, { resultado: "aprobado" });
  caso("QC-06b", "Segregación: un revisor no puede aprobar el control que él mismo registró", autoAprob.status === 403 || autoAprob.status === 409, `HTTP ${autoAprob.status} ${autoAprob.j?.message ?? ""}`);

  const antes = (await pedir(AN, "GET", `/qc/ot/${ot.id}`)).j.metodos.find((m) => m.id === metodo.id);
  caso("QC-07", "Mientras falten aprobaciones el método no está aprobado (bloquea la emisión del informe)", antes && antes.aprobado === false, `aprobado=${antes?.aprobado}`);

  const aps = [];
  for (const c of [pos, neg, bla]) aps.push(await pedir(RV, "PATCH", `/qc/control/${c.j?.id}`, { resultado: "aprobado", observaciones: "PRUEBA aprobación del revisor" }));
  caso("QC-08", "El revisor del laboratorio aprueba los tres controles", aps.every((a) => a.status < 300 && a.j?.resultado === "aprobado"), aps.map((a) => `${a.status}/${a.j?.resultado}`).join(" "));

  const despues = (await pedir(AN, "GET", `/qc/ot/${ot.id}`)).j.metodos.find((m) => m.id === metodo.id);
  caso("QC-09", "Con positivo, negativo y blanco aprobados, el método queda aprobado (no le faltan tipos)", despues?.aprobado === true && despues.tiposFaltantes.length === 0, `aprobado=${despues?.aprobado} faltan=${despues?.tiposFaltantes?.join(",")}`);

  const ajeno = await pedir(OTRO, "GET", `/qc/ot/${ot.id}`);
  caso("QC-10", "Alcance: un analista de otro laboratorio no ve el QC de esta OT", ajeno.status === 403 || ajeno.status === 404, `HTTP ${ajeno.status}`);

  const retAprob = await pedir(AN, "DELETE", `/qc/control/${pos.j?.id}`);
  caso("QC-11", "Un control ya aprobado no se puede retirar", retAprob.status >= 400, `HTTP ${retAprob.status} ${retAprob.j?.message ?? ""}`);

  // Limpieza: los controles de prueba no aprobados se retiran; los aprobados se rechazan y retiran.
  let retirados = 0;
  for (const id of creados) {
    let d = await pedir(AN, "DELETE", `/qc/control/${id}`);
    if (d.status >= 400) {
      await pedir(RV, "PATCH", `/qc/control/${id}`, { resultado: "rechazado", observaciones: "PRUEBA limpieza" });
      d = await pedir(AN, "DELETE", `/qc/control/${id}`);
    }
    if (d.status < 300) retirados++;
  }
  caso("QC-12", "Limpieza: los controles PRUEBA se retiran (baja lógica)", retirados === creados.length, `${retirados}/${creados.length}`);
}

/* ====================================================================== SPC */
function estadisticos(v) {
  const n = v.length;
  const media = v.reduce((s, x) => s + x, 0) / n;
  const de = Math.sqrt(v.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1));
  const mr = v.slice(1).map((x, i) => Math.abs(x - v[i]));
  const mrBar = mr.reduce((s, x) => s + x, 0) / mr.length;
  return { media, de, lsc: media + 3 * de, lic: media - 3 * de, mrBar };
}
const cerca = (a, b, tol = 1e-4) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

async function spc() {
  const JE = "demo.lqa.jefe";
  const AD = "demo.admin";
  const an = await pedir(AD, "GET", "/spc/analitos");
  const lista = Array.isArray(an.j) ? an.j : an.j?.data ?? [];
  caso("SPC-01", "Lista de analitos con suficientes resultados numéricos para la carta", an.status === 200 && lista.length > 0, `${lista.length} analitos (p. ej. ${lista[0]?.nombre} n=${lista[0]?.n})`);
  if (!lista.length) return;
  const a = lista[0];
  const s = await pedir(AD, "GET", `/spc/series?catAnalitoId=${a.catAnalitoId}&catMetodoId=${a.catMetodoId}`);
  const v = (s.j?.puntos ?? []).map((p) => p.valor);
  caso("SPC-02", "La serie trae un punto por resultado (fecha, valor, OT y muestra)", s.status === 200 && v.length === a.n && s.j.puntos.every((p) => p.fecha && p.otCodigo), `${v.length} puntos de ${a.n}`);
  const e = s.j?.estadisticos ?? {};
  const r = estadisticos(v);
  caso("SPC-03", "Media, desviación y límites LC ± 3σ coinciden con el cálculo independiente", cerca(e.media, r.media) && cerca(e.desviacion, r.de) && cerca(e.lsc, r.lsc) && cerca(e.lic, r.lic), `media ${e.media} vs ${r.media.toFixed(6)} · σ ${e.desviacion} vs ${r.de.toFixed(6)} · LSC ${e.lsc} · LIC ${e.lic}`);
  caso("SPC-04", "Rango móvil medio y LSC de la carta R (D4 = 3,267)", cerca(e.rangoMovilMedio, r.mrBar) && cerca(e.lscR, 3.267 * r.mrBar, 1e-3), `MR̄ ${e.rangoMovilMedio} vs ${r.mrBar.toFixed(6)} · LSC-R ${e.lscR}`);
  const fuera = v.filter((x) => x > r.lsc + 1e-9 || x < r.lic - 1e-9).length;
  caso("SPC-05", "Puntos fuera de control: los que superan LC ± 3σ", (e.fueraDeControl ?? []).length === fuera, `${(e.fueraDeControl ?? []).length} informados, ${fuera} calculados`);
  // Alcance: el jefe de LQA no puede ver más puntos que el administrador.
  const sj = await pedir(JE, "GET", `/spc/series?catAnalitoId=${a.catAnalitoId}&catMetodoId=${a.catMetodoId}`);
  caso("SPC-06", "Alcance: un jefe de laboratorio solo ve los puntos de sus OT", sj.status === 200 && (sj.j.puntos?.length ?? 0) <= v.length, `jefe LQA ${sj.j?.puntos?.length ?? sj.status} · global ${v.length}`);
  const malo = await pedir(AD, "GET", `/spc/series?catAnalitoId=no-es-uuid`);
  caso("SPC-07", "Parámetro inválido: responde error de validación, no 500", malo.status >= 400 && malo.status < 500, `HTTP ${malo.status}`);
  const futuro = await pedir(AD, "GET", `/spc/series?catAnalitoId=${a.catAnalitoId}&desde=2099-01-01`);
  caso("SPC-08", "Rango de fechas sin datos: serie vacía y estadísticos nulos", futuro.status === 200 && (futuro.j.puntos?.length ?? 0) === 0 && futuro.j.estadisticos?.media == null, `puntos=${futuro.j?.puntos?.length} media=${futuro.j?.estadisticos?.media}`);
}

/* =============================================================== Mensajería */
async function mensajeria() {
  const CO = "demo.dco.jefe";
  const AN = "demo.lmb.analista1";
  const pl = await pedir(CO, "GET", "/mensajeria/plantillas");
  // Desde las plantillas por etapa (§4.5.4) la respuesta es { data, ... }.
  if (pl.j && !Array.isArray(pl.j) && Array.isArray(pl.j.data)) pl.j = pl.j.data;
  caso("MSJ-01", "Plantillas de correo disponibles (cotización y resultados)", pl.status === 200 && Array.isArray(pl.j) && pl.j.length >= 2, Array.isArray(pl.j) ? pl.j.map((p) => p.clave).join(", ") : `HTTP ${pl.status}`);
  const h0 = await pedir(CO, "GET", "/mensajeria?page=1&limit=5");
  caso("MSJ-02", "Historial de correos paginado", h0.status === 200 && Array.isArray(h0.j?.data) && h0.j?.meta, `total=${h0.j?.meta?.total}`);
  // Notificación del resultado de una OT a un destinatario de prueba.
  const ots = await pedir(CO, "GET", "/ot?page=1&limit=5");
  const ot = ots.j?.data?.[0];
  const plantillaRes = (pl.j ?? []).find((p) => p.tipo === "resultado")?.clave;
  const env = await pedir(CO, "POST", `/mensajeria/resultado/${ot?.id}`, { destinatarios: ["prueba.bloque-a@prueba.invalid"], plantilla: plantillaRes, veredicto: "PRUEBA bloque A" });
  caso("MSJ-03", "Notificar el resultado de una OT: la operación responde y deja el envío en la bitácora (enviado o con su error si no hay servidor de correo)", env.status < 500 && env.status !== 0, `HTTP ${env.status} ${JSON.stringify(env.j).slice(0, 140)}`);
  const h1 = await pedir(CO, "GET", `/mensajeria?q=${encodeURIComponent("prueba.bloque-a")}`);
  const fila = h1.j?.data?.[0];
  caso("MSJ-04", "Búsqueda en el historial por destinatario encuentra el envío, con estado y OT", !!fila && /prueba\.bloque-a/.test(fila.destinatarios ?? "") && ["enviado", "error", "sin_configurar"].includes(fila.estado), fila ? `estado=${fila.estado} ${fila.error ? `error=${String(fila.error).slice(0, 80)}` : ""}` : `HTTP ${h1.status}, sin filas`);
  const fe = await pedir(CO, "GET", `/mensajeria?estado=${fila?.estado ?? "error"}&tipo=${fila?.tipo ?? "resultado"}`);
  caso("MSJ-05", "Filtros por estado y tipo", fe.status === 200 && (fe.j.data ?? []).every((x) => x.estado === (fila?.estado ?? "error")), `${fe.j?.data?.length ?? 0} filas`);
  // El analista envía correo (correo.enviar) y por eso lee las plantillas, pero no las edita (correo_plantilla.editar).
  const sinPermiso = await pedir(AN, "POST", "/mensajeria/plantillas", { etapa: "resultado", nombre: "PRUEBA no debe crearse", asunto: "x", cuerpo: "x" });
  caso("MSJ-06", "Permisos: un analista no crea ni edita plantillas de correo", sinPermiso.status === 403, `HTTP ${sinPermiso.status}`);
  const malo = await pedir(CO, "POST", `/mensajeria/resultado/${ot?.id}`, { destinatarios: ["no-es-un-correo"] });
  caso("MSJ-07", "Destinatario inválido: se rechaza sin enviar", malo.status >= 400 && malo.status < 500, `HTTP ${malo.status} ${malo.j?.message ?? ""}`);
}

async function main() {
  console.log(`Pruebas funcionales QC · SPC · Mensajería · ${BASE}\n`);
  for (const [n, f] of [["QC", qc], ["SPC", spc], ["Mensajería", mensajeria]]) {
    try {
      await f();
    } catch (e) {
      caso(`${n}-ERR`, `Error inesperado en ${n}`, false, e.message ?? e);
    }
  }
  const ok = casos.filter((c) => c.ok).length;
  console.log(`\n${ok}/${casos.length} casos OK`);
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify({ fecha: new Date().toISOString(), base: BASE, casos }, null, 2));
  process.exit(ok === casos.length ? 0 : 1);
}
main();
