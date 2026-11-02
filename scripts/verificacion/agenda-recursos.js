#!/usr/bin/env node
/**
 * Verificación contra una API real de la agenda de recursos y eventos
 * (packages/db/align_agenda_recursos.sql, contrato §4.5.8 y §4.5.9):
 *   · catálogo de recursos con costos y alcance por laboratorio;
 *   · eventos únicos y recurrentes con participantes y recursos, choques de
 *     reservas, anulación de una ocurrencia, edición solo del organizador;
 *   · calendario día/semana/mes y disponibilidad valorizada por recurso.
 *
 * Uso:
 *   node scripts/verificacion/agenda-recursos.js [--base http://localhost:3001/api]
 *
 * Variables: CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA). Todo lo que crea lleva «PRUEBA»
 * en el nombre y queda dado de baja al final: úsese en una base de pruebas.
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
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: CLAVE }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${username}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  sesiones[username] = { token: j.accessToken, id: j.user?.id ?? j.usuario?.id ?? null };
  return sesiones[username];
}
async function pedir(username, metodo, ruta, cuerpo) {
  const s = await login(username);
  const headers = { authorization: `Bearer ${s.token}` };
  let body;
  if (cuerpo !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(cuerpo);
  }
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : j?.message ? (Array.isArray(j.message) ? j.message.join("; ") : j.message) : JSON.stringify(j)).slice(0, 300);
async function exigir(esperado, username, metodo, ruta, cuerpo) {
  const r = await pedir(username, metodo, ruta, cuerpo);
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

/* ---------------------------------------------------------------- datos --- */
const U = {
  admin: "demo.admin",
  calidad: "demo.calidad",
  lmbJefe: "demo.lmb.jefe",
  lmbAnalista: "demo.lmb.analista1",
  lmbRevisor: "demo.lmb.revisor",
  lqcJefe: "demo.lqc.jefe",
};
const sello = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
// Semana de pruebas: lunes 16-11-2026 a domingo 22-11-2026.
const LUNES = "2026-11-16";
const C = {};

async function main() {
  console.log(`Agenda de recursos y eventos contra ${BASE}`);

  await paso("Recursos: Administración crea sala institucional y camioneta de LMB con costos; nombre repetido 409; Calidad sin permiso 403", async () => {
    const labs = lista(await ok(U.admin, "GET", "/ot/laboratorios"));
    C.lmb = labs.find((u) => u.codigo === "LMB");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    afirmar(C.lmb && C.lqc, "faltan las unidades LMB y LQC");
    C.sala = (await ok(U.admin, "POST", "/agenda/recursos", { tipo: "SALA", nombre: `PRUEBA Sala de reuniones ${sello}`, capacidad: 12, costoHora: 10000, costoUso: 2000 })).id;
    C.camioneta = (await ok(U.admin, "POST", "/agenda/recursos", {
      tipo: "VEHICULO", nombre: `PRUEBA Camioneta muestreo ${sello}`, unidadId: C.lmb.id, costoHora: 5000, costoUso: 30000, horaDesde: "07:00", horaHasta: "19:00", diasHabiles: [1, 2, 3, 4, 5, 6],
    })).id;
    await exigir(409, U.admin, "POST", "/agenda/recursos", { tipo: "SALA", nombre: `prueba sala de reuniones ${sello}` });
    await exigir(400, U.admin, "POST", "/agenda/recursos", { tipo: "SALA", nombre: `PRUEBA mala ${sello}`, horaDesde: "18:00", horaHasta: "08:00" });
    await exigir(403, U.calidad, "POST", "/agenda/recursos", { tipo: "SALA", nombre: `PRUEBA x ${sello}` });
  });

  await paso("Recursos: el jefe LMB registra un equipo de su laboratorio, no uno institucional ni de LQC", async () => {
    const eq = await ok(U.lmbJefe, "GET", "/agenda/recursos/origenes?tipo=EQUIPO");
    C.equipo = (await ok(U.lmbJefe, "POST", "/agenda/recursos", { tipo: "EQUIPO", nombre: `PRUEBA Autoclave ${sello}`, unidadId: C.lmb.id, equipoId: eq[0]?.id ?? null, costoHora: 8000 })).id;
    await exigir(403, U.lmbJefe, "POST", "/agenda/recursos", { tipo: "SALA", nombre: `PRUEBA inst ${sello}` });
    await exigir(403, U.lmbJefe, "POST", "/agenda/recursos", { tipo: "SALA", nombre: `PRUEBA lqc ${sello}`, unidadId: C.lqc.id });
    return `${eq.length} equipos ligables en su alcance`;
  });

  await paso("Recursos: LQC no ve la camioneta de LMB; el analista la ve sin costos", async () => {
    const q = await ok(U.lqcJefe, "GET", "/agenda/recursos");
    afirmar(q.recursos.some((r) => r.id === C.sala) && !q.recursos.some((r) => r.id === C.camioneta), "alcance de recursos de LQC");
    const a = await ok(U.lmbAnalista, "GET", "/agenda/recursos");
    const c = a.recursos.find((r) => r.id === C.camioneta);
    afirmar(c && !a.verCostos && c.costoHora === undefined && a.puedeCrearEventos && !a.puedeGestionar, `analista ${JSON.stringify(c)}`);
    const ad = await ok(U.admin, "GET", "/agenda/recursos");
    afirmar(ad.recursos.find((r) => r.id === C.camioneta).costoUso === 30000, "costos para Administración");
  });

  await paso("Evento único con sala y participante; choque de horario 409; tramo contiguo permitido", async () => {
    const yo = await login(U.lmbRevisor);
    const usuarios = await ok(U.lmbAnalista, "GET", "/agenda/usuarios?q=revisor");
    C.revisor = (usuarios.find((x) => x.username === U.lmbRevisor) ?? {}).id ?? yo.id;
    afirmar(C.revisor, "no se encontró al revisor");
    C.reunion = (await ok(U.lmbAnalista, "POST", "/agenda/eventos", {
      titulo: `PRUEBA Revisión de resultados ${sello}`, tipo: "REUNION", fecha: LUNES, horaInicio: "09:00", horaFin: "10:30", recursos: [C.sala], participantes: [C.revisor],
    })).id;
    const r = await pedir(U.lmbJefe, "POST", "/agenda/eventos", { titulo: `PRUEBA choque ${sello}`, fecha: LUNES, horaInicio: "10:00", horaFin: "11:00", recursos: [C.sala] });
    afirmar(r.status === 409 && /Sala de reuniones/.test(msg(r.json)) && /2026-11-16/.test(msg(r.json)), `choque: ${r.status} ${msg(r.json)}`);
    C.contigua = (await ok(U.lmbJefe, "POST", "/agenda/eventos", { titulo: `PRUEBA Capacitación ${sello}`, tipo: "CAPACITACION", fecha: LUNES, horaInicio: "10:30", horaFin: "11:30", recursos: [C.sala] })).id;
    return msg(r.json).slice(0, 90);
  });

  await paso("Evento recurrente: muestreo lunes y miércoles, 6 veces, camioneta de LMB", async () => {
    C.serie = (await ok(U.lmbJefe, "POST", "/agenda/eventos", {
      titulo: `PRUEBA Salida a terreno ${sello}`, tipo: "SALIDA_TERRENO", unidadId: C.lmb.id, fecha: LUNES, horaInicio: "08:00", horaFin: "12:00",
      recurrencia: "SEMANAL", diasSemana: [1, 3], repeticiones: 6, recursos: [C.camioneta], participantes: [C.revisor],
    })).id;
    const f = await ok(U.lmbJefe, "GET", `/agenda/eventos/${C.serie}`);
    afirmar(f.ultimaFecha === "2026-12-02" && f.costoOcurrencia === 50000, `serie ${f.ultimaFecha} costo ${f.costoOcurrencia}`);
    const mes = await ok(U.lmbJefe, "GET", `/agenda/calendario?vista=mes&fecha=${LUNES}`);
    const nov = mes.ocurrencias.filter((o) => o.eventoId === C.serie).map((o) => o.fecha);
    afirmar(mes.desde === "2026-11-01" && mes.hasta === "2026-11-30" && nov.join() === "2026-11-16,2026-11-18,2026-11-23,2026-11-25,2026-11-30", `noviembre ${nov}`);
    await exigir(400, U.lmbJefe, "POST", "/agenda/eventos", { titulo: `PRUEBA sin fin ${sello}`, fecha: LUNES, todoDia: true, recurrencia: "DIARIA" });
    await exigir(400, U.lmbJefe, "POST", "/agenda/eventos", { titulo: `PRUEBA horas ${sello}`, fecha: LUNES, horaInicio: "11:00", horaFin: "10:00" });
    return `noviembre: ${nov.length} salidas`;
  });

  await paso("Choque con una ocurrencia de la serie; anular esa ocurrencia libera la camioneta", async () => {
    const r = await pedir(U.lmbAnalista, "POST", "/agenda/eventos", { titulo: `PRUEBA traslado ${sello}`, fecha: "2026-11-25", horaInicio: "11:00", horaFin: "13:00", recursos: [C.camioneta] });
    afirmar(r.status === 409 && /2026-11-25/.test(msg(r.json)), `choque serie: ${r.status} ${msg(r.json)}`);
    await exigir(403, U.lmbAnalista, "POST", `/agenda/eventos/${C.serie}/anular-ocurrencia`, { fecha: "2026-11-25" });
    await exigir(400, U.lmbJefe, "POST", `/agenda/eventos/${C.serie}/anular-ocurrencia`, { fecha: "2026-11-24" });
    await ok(U.lmbJefe, "POST", `/agenda/eventos/${C.serie}/anular-ocurrencia`, { fecha: "2026-11-25" });
    C.traslado = (await ok(U.lmbAnalista, "POST", "/agenda/eventos", { titulo: `PRUEBA traslado ${sello}`, fecha: "2026-11-25", horaInicio: "11:00", horaFin: "13:00", recursos: [C.camioneta] })).id;
    const sem = await ok(U.lmbJefe, "GET", "/agenda/calendario?vista=semana&fecha=2026-11-25");
    const s = sem.ocurrencias.filter((o) => o.eventoId === C.serie).map((o) => o.fecha);
    afirmar(sem.desde === "2026-11-23" && s.join() === "2026-11-23", `semana ${s}`);
  });

  await paso("Permisos del evento: el analista no edita la serie; el revisor acepta la invitación; el organizador la mueve", async () => {
    await exigir(403, U.lmbAnalista, "PATCH", `/agenda/eventos/${C.serie}`, { titulo: "x" });
    await ok(U.lmbRevisor, "POST", `/agenda/eventos/${C.reunion}/respuesta`, { respuesta: "ACEPTA" });
    await exigir(403, U.lqcJefe, "POST", `/agenda/eventos/${C.reunion}/respuesta`, { respuesta: "ACEPTA" });
    const f = await ok(U.lmbAnalista, "GET", `/agenda/eventos/${C.reunion}`);
    afirmar(f.participantes[0]?.respuesta === "ACEPTA" && f.puedeEditar && f.costoOcurrencia === undefined, JSON.stringify(f.participantes));
    const mios = await ok(U.lmbRevisor, "GET", `/agenda/calendario?vista=semana&fecha=${LUNES}&soloMios=true`);
    afirmar(mios.ocurrencias.some((o) => o.eventoId === C.reunion) && !mios.ocurrencias.some((o) => o.eventoId === C.contigua), "«solo mis eventos» del revisor");
    await ok(U.lmbAnalista, "PATCH", `/agenda/eventos/${C.reunion}`, { horaInicio: "08:30", horaFin: "10:00" });
    const g = await ok(U.lmbAnalista, "GET", `/agenda/eventos/${C.reunion}`);
    afirmar(g.horaInicio === "08:30" && g.recursos.length === 1 && g.participantes.length === 1, "edición parcial");
  });

  await paso("Alcance: LQC no ve la serie de LMB pero sí la reunión sin unidad", async () => {
    const q = await ok(U.lqcJefe, "GET", `/agenda/calendario?vista=semana&fecha=${LUNES}`);
    afirmar(!q.ocurrencias.some((o) => o.eventoId === C.serie) && q.ocurrencias.some((o) => o.eventoId === C.reunion), "alcance del calendario");
    await exigir(404, U.lqcJefe, "GET", `/agenda/eventos/${C.serie}`);
  });

  await paso("Disponibilidad valorizada de la semana (día, ocupación y costo por recurso)", async () => {
    const d = await ok(U.admin, "GET", `/agenda/disponibilidad?vista=semana&fecha=${LUNES}`);
    afirmar(d.dias.length === 7 && d.verCostos, "vista semana");
    const sala = d.recursos.find((x) => x.recurso.id === C.sala);
    const lun = sala.dias.find((x) => x.dia === LUNES);
    // 08:30–10:00 (90 min) + 10:30–11:30 (60 min): 10.000/h × 2,5 h + 2 × 2.000 = 29.000
    afirmar(lun.ocupado === 150 && lun.eventos === 2 && lun.costo === 29000 && lun.jornada === 540, `sala lunes ${JSON.stringify(lun)}`);
    afirmar(sala.dias.find((x) => x.dia === "2026-11-21").jornada === 0, "el sábado no es hábil para la sala");
    const cam = d.recursos.find((x) => x.recurso.id === C.camioneta);
    // Salidas lunes y miércoles 4 h (2 × 50.000) más nada: el 18 es miércoles de la misma semana.
    afirmar(cam.total.costo === 100000 && cam.total.ocupado === 480 && cam.total.jornada === 720 * 6, `camioneta ${JSON.stringify(cam.total)}`);
    const a = await ok(U.lmbAnalista, "GET", `/agenda/disponibilidad?vista=dia&fecha=${LUNES}`);
    afirmar(a.dias.length === 1 && !a.verCostos && a.recursos.every((x) => x.total.costo === undefined), "el analista no ve costos");
    await exigir(400, U.admin, "GET", "/agenda/disponibilidad?desde=2026-01-01&hasta=2026-06-30");
    return `sala ${sala.total.ocupacion} % · camioneta ${cam.total.ocupacion} %`;
  });

  await paso("Bajas: recurso con eventos vigentes 409; se eliminan los eventos y luego los recursos PRUEBA", async () => {
    await exigir(409, U.admin, "DELETE", `/agenda/recursos/${C.sala}`);
    for (const id of [C.reunion, C.contigua, C.serie, C.traslado]) await ok(U.admin, "DELETE", `/agenda/eventos/${id}`);
    await exigir(404, U.lmbAnalista, "GET", `/agenda/eventos/${C.reunion}`);
    for (const id of [C.sala, C.camioneta, C.equipo]) await ok(U.admin, "DELETE", `/agenda/recursos/${id}`);
    const r = await ok(U.admin, "GET", "/agenda/recursos");
    afirmar(!r.recursos.some((x) => [C.sala, C.camioneta, C.equipo].includes(x.id)), "siguen listados");
  });
}

main()
  .then(() => {
    console.log(`\nAgenda de recursos y eventos: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    process.exit(1);
  });
