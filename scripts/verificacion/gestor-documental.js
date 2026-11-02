#!/usr/bin/env node
/**
 * Verificación contra una API real del frente documental
 * (packages/db/align_gestor_documental.sql):
 *   · A: gestor documental (§4.6.1–§4.6.3): carpetas jerárquicas con
 *     restricción por laboratorio heredada, subida con firma real del archivo,
 *     versiones BORRADOR → PUBLICADA → REEMPLAZADA, lectores que solo ven la
 *     publicada, renombrar y mover, vínculo a OT por código con alcance,
 *     permisos por usuario (restringido), y borrados;
 *   · B: exportación a Excel (§4.6.6–§4.6.7): equipos, consumibles y
 *     actividades, libro .xlsx con resumen dinámico y gráfico, validaciones y
 *     plantillas de exportación guardadas.
 *
 * Uso:
 *   node scripts/verificacion/gestor-documental.js [--base http://localhost:3001/api] [--salida carpeta]
 *
 * Variables: CLAVE_DEMO (o CLAVE_DEMO_EMBEBIDA). Todo lo que crea lleva «PRUEBA»
 * en el nombre: úsese en una base de pruebas.
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
const SALIDA = arg("--salida", null);

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
  sesiones[username] = { token: j.accessToken };
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
  if (!tipo.includes("json")) return { status: r.status, tipo, json: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, tipo, json };
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
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/* ---------------------------------------------------------------- datos --- */
const U = {
  calidad: "demo.calidad",
  admin: "demo.admin",
  lmbJefe: "demo.lmb.jefe",
  lmbAnalista: "demo.lmb.analista1",
  lmbRevisor: "demo.lmb.revisor",
  lqcJefe: "demo.lqc.jefe",
};
const sello = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const pdf = (texto) => Buffer.from(`%PDF-1.4\n% PRUEBA ${texto}\n%%EOF\n`);
const C = {};

async function main() {
  console.log(`Frente documental contra ${BASE}`);

  /* ------------------------------------------------ A · gestor documental --- */
  await paso("A · Árbol inicial y carpeta PRUEBA restringida a LMB (Calidad, perfil global)", async () => {
    const a = await ok(U.calidad, "GET", "/documentos/carpetas");
    C.raizLab = a.carpetas.find((c) => c.nombre === "Laboratorios" && !c.padreId);
    afirmar(C.raizLab && a.puedeGestionar, "falta la carpeta raíz «Laboratorios» o el permiso de gestión");
    const labs = lista(await ok(U.calidad, "GET", "/ot/laboratorios"));
    C.lmb = labs.find((u) => u.codigo === "LMB");
    C.lqc = labs.find((u) => u.codigo === "LQC");
    const r = await ok(U.calidad, "POST", "/documentos/carpetas", { nombre: `PRUEBA LMB ${sello}`, padreId: C.raizLab.id, unidadId: C.lmb.id });
    C.carpLmb = r.id;
    await exigir(409, U.calidad, "POST", "/documentos/carpetas", { nombre: `prueba lmb ${sello}`, padreId: C.raizLab.id });
    return `${a.carpetas.length} carpetas`;
  });

  await paso("A · Alcance: LQC no ve la carpeta de LMB; el jefe LMB sí, crea subcarpeta y no puede crear raíces", async () => {
    const q = await ok(U.lqcJefe, "GET", "/documentos/carpetas");
    afirmar(!q.carpetas.some((c) => c.id === C.carpLmb), "LQC ve la carpeta de LMB");
    const m = await ok(U.lmbJefe, "GET", "/documentos/carpetas");
    afirmar(m.carpetas.some((c) => c.id === C.carpLmb), "LMB no ve su carpeta");
    const s = await ok(U.lmbJefe, "POST", "/documentos/carpetas", { nombre: "PRUEBA Instructivos", padreId: C.carpLmb });
    C.carpSub = s.id;
    const m2 = await ok(U.lmbJefe, "GET", "/documentos/carpetas");
    const sub = m2.carpetas.find((c) => c.id === C.carpSub);
    afirmar(sub.unidadEfectiva === C.lmb.id && sub.ruta.endsWith(`PRUEBA LMB ${sello} / PRUEBA Instructivos`), `subcarpeta ${JSON.stringify(sub)}`);
    await exigir(403, U.lmbJefe, "POST", "/documentos/carpetas", { nombre: `PRUEBA raíz ${sello}` });
    await exigir(403, U.lmbJefe, "POST", "/documentos/carpetas", { nombre: "PRUEBA x", padreId: C.carpLmb, unidadId: C.lqc.id });
    await exigir(404, U.lqcJefe, "POST", "/documentos/carpetas", { nombre: "PRUEBA y", padreId: C.carpLmb });
    return sub.ruta;
  });

  await paso("A · Subida: firma del archivo validada (PDF falso y .exe → 400); v1 queda en BORRADOR", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]);
    await exigir(400, U.lmbJefe, "POST", "/documentos/archivos", undefined, formulario({ carpetaId: C.carpSub }, "falso.pdf", zip));
    await exigir(400, U.lmbJefe, "POST", "/documentos/archivos", undefined, formulario({ carpetaId: C.carpSub }, "programa.exe", pdf("x")));
    await exigir(403, U.lmbAnalista, "POST", "/documentos/archivos", undefined, formulario({ carpetaId: C.carpSub }, "a.pdf", pdf("x")));
    C.v1 = pdf("v1");
    const d = await ok(U.lmbJefe, "POST", "/documentos/archivos", undefined, formulario({ carpetaId: C.carpSub, titulo: "PRUEBA instructivo de siembra", comentario: "Primera redacción" }, "instructivo v1.pdf", C.v1));
    afirmar(/^DOC-\d{4}-\d{5}$/.test(d.codigo), `código ${d.codigo}`);
    afirmar(d.versiones.length === 1 && d.versiones[0].estado === "BORRADOR" && d.versionPublicada === null, "v1 no es borrador");
    afirmar(d.versiones[0].hashSha256 === sha(C.v1), "hash distinto");
    C.doc = d.id;
    C.codigo = d.codigo;
    return d.codigo;
  });

  await paso("A · El analista (solo documento.ver) ve el documento pero no el borrador ni lo descarga", async () => {
    const l = await ok(U.lmbAnalista, "GET", `/documentos/archivos?carpetaId=${C.carpLmb}&subcarpetas=true`);
    afirmar(l.some((x) => x.id === C.doc), "el analista no lo lista");
    const v = await ok(U.lmbAnalista, "GET", `/documentos/archivos/${C.doc}`);
    afirmar(v.versiones.length === 0 && v.puedeEditar === false, "el analista ve versiones o puede editar");
    await exigir(404, U.lmbAnalista, "GET", `/documentos/archivos/${C.doc}/descargar`);
    await exigir(404, U.lqcJefe, "GET", `/documentos/archivos/${C.doc}`);
  });

  await paso("A · v2 subida y publicada: el lector descarga v2 íntegra; v1 sigue en el historial y no la descarga", async () => {
    C.v2 = pdf("v2 corregida");
    const d = await ok(U.lmbJefe, "POST", `/documentos/archivos/${C.doc}/versiones`, undefined, formulario({ comentario: "Corrige temperatura", publicar: "true" }, "instructivo v2.pdf", C.v2));
    afirmar(d.versionPublicada === 2, `publicada ${d.versionPublicada}`);
    afirmar(d.versiones.map((v) => `${v.numero}:${v.estado}`).join(",") === "2:PUBLICADA,1:BORRADOR", d.versiones.map((v) => `${v.numero}:${v.estado}`).join(","));
    const b = await ok(U.lmbAnalista, "GET", `/documentos/archivos/${C.doc}/descargar`);
    afirmar(Buffer.isBuffer(b) && sha(b) === sha(C.v2), "la descarga no es v2");
    await exigir(403, U.lmbAnalista, "GET", `/documentos/archivos/${C.doc}/descargar?numero=1`);
    const b1 = await ok(U.lmbJefe, "GET", `/documentos/archivos/${C.doc}/descargar?numero=1`);
    afirmar(sha(b1) === sha(C.v1), "v1 alterada");
    return "v2 publicada";
  });

  await paso("A · Publicar v1: v2 pasa a REEMPLAZADA (una sola publicada); publicar la ya publicada → 409", async () => {
    const d = await ok(U.lmbJefe, "POST", `/documentos/archivos/${C.doc}/versiones/1/publicar`);
    afirmar(d.versionPublicada === 1 && d.versiones.map((v) => v.estado).join(",") === "REEMPLAZADA,PUBLICADA", d.versiones.map((v) => v.estado).join(","));
    await exigir(409, U.lmbJefe, "POST", `/documentos/archivos/${C.doc}/versiones/1/publicar`);
    await ok(U.lmbJefe, "POST", `/documentos/archivos/${C.doc}/versiones/2/publicar`);
  });

  await paso("A · Renombrar, mover a la carpeta padre y vincular a una OT de LMB por código; OT de LQC → 403", async () => {
    const otLmb = lista(await ok(U.lmbJefe, "GET", "/ot?limit=50")).find((o) => o.codigo);
    let d = await ok(U.lmbJefe, "PATCH", `/documentos/archivos/${C.doc}`, { titulo: "PRUEBA instructivo de siembra (rev.)", carpetaId: C.carpLmb });
    afirmar(d.titulo.endsWith("(rev.)") && d.carpetaId === C.carpLmb, "no renombró o no movió");
    if (otLmb) {
      d = await ok(U.lmbJefe, "PATCH", `/documentos/archivos/${C.doc}`, { otCodigo: otLmb.codigo });
      afirmar(d.otCodigo === otLmb.codigo, "sin vínculo a la OT");
      const porOt = await ok(U.lmbJefe, "GET", `/documentos/archivos?otId=${d.otId ?? otLmb.id}`);
      afirmar(porOt.some((x) => x.id === C.doc), "no aparece al filtrar por OT");
    }
    const otLqc = lista(await ok(U.lqcJefe, "GET", "/ot?limit=50")).find((o) => o.codigo);
    if (otLqc) await exigir(403, U.lmbJefe, "PATCH", `/documentos/archivos/${C.doc}`, { otCodigo: otLqc.codigo });
    await exigir(400, U.lmbJefe, "PATCH", `/documentos/archivos/${C.doc}`, { otCodigo: "OT-NO-EXISTE" });
    return otLmb ? `vinculado a ${otLmb.codigo}` : "sin OT de LMB en la base: vínculo no probado";
  });

  await paso("A · Restringido a una persona: el revisor lo ve, el analista ya no; el editor por permiso puede publicar", async () => {
    const yo = await ok(U.lmbJefe, "GET", `/documentos/usuarios?q=${encodeURIComponent("lmb.revisor")}`);
    const rev = yo.find((u) => u.username === U.lmbRevisor);
    afirmar(rev, "no se encontró al revisor");
    const d = await ok(U.lmbJefe, "PUT", `/documentos/archivos/${C.doc}/accesos`, { restringido: true, accesos: [{ usuarioId: rev.id, nivel: "ver" }] });
    afirmar(d.restringido && d.accesos.length === 1, "no quedó restringido");
    await exigir(404, U.lmbAnalista, "GET", `/documentos/archivos/${C.doc}`);
    const l = await ok(U.lmbAnalista, "GET", `/documentos/archivos?carpetaId=${C.carpLmb}`);
    afirmar(!l.some((x) => x.id === C.doc), "el analista lo sigue listando");
    const v = await ok(U.lmbRevisor, "GET", `/documentos/archivos/${C.doc}`);
    afirmar(v.versiones.length === 1 && !v.puedeEditar, "el revisor no ve solo la publicada");
    const c = await ok(U.calidad, "GET", `/documentos/archivos/${C.doc}`);
    afirmar(c.puedeEditar, "Calidad (global) no puede editar");
    await exigir(400, U.lmbJefe, "PUT", `/documentos/archivos/${C.doc}/accesos`, { restringido: true, accesos: [{ usuarioId: rev.id, nivel: "todo" }] });
  });

  await paso("A · Carpetas: no se mueve dentro de sí misma; una carpeta con contenido no se borra", async () => {
    await exigir(400, U.calidad, "PATCH", `/documentos/carpetas/${C.carpLmb}`, { padreId: C.carpSub });
    await exigir(409, U.calidad, "DELETE", `/documentos/carpetas/${C.carpLmb}`);
    const r = await ok(U.calidad, "PATCH", `/documentos/carpetas/${C.carpSub}`, { nombre: "PRUEBA Instructivos LMB" });
    afirmar(r.id === C.carpSub, "no renombró la carpeta");
  });

  await paso("A · Borrado lógico del documento y de la carpeta vacía", async () => {
    await exigir(403, U.lmbRevisor, "DELETE", `/documentos/archivos/${C.doc}`);
    await ok(U.lmbJefe, "DELETE", `/documentos/archivos/${C.doc}`);
    await exigir(404, U.lmbJefe, "GET", `/documentos/archivos/${C.doc}`);
    await ok(U.lmbJefe, "DELETE", `/documentos/carpetas/${C.carpSub}`);
    return `${C.codigo} eliminado (queda en la base con deleted_at)`;
  });

  /* ------------------------------------------------- B · exportación Excel --- */
  await paso("B · Entidades exportables: equipos, consumibles y actividades", async () => {
    const e = await ok(U.calidad, "GET", "/reportes/entidades");
    for (const k of ["equipo", "consumible_lote", "consumible_movimiento", "actividad"]) afirmar(e[k]?.campos?.length, `falta ${k}`);
    afirmar(e.actividad.permiso === "audit.ver", "actividad sin permiso adicional");
    return Object.keys(e).join(", ");
  });

  await paso("B · Excel de OT con resumen por estado × prioridad y gráfico de columnas", async () => {
    const q = "entidad=ot&campos=codigo,estado,prioridad,created_at&formato=xlsx&resumenFilas=estado&resumenColumnas=prioridad&grafico=columna&titulo=PRUEBA OT por estado";
    const r = await pedir(U.calidad, "GET", `/reportes/tabla?${q}`);
    afirmar(r.status === 200 && r.tipo.includes("spreadsheetml"), `HTTP ${r.status} ${r.tipo}`);
    const b = r.json;
    afirmar(b.subarray(0, 2).toString() === "PK", "no es un ZIP");
    const s = b.toString("latin1");
    for (const parte of ["xl/charts/chart1.xml", "xl/drawings/drawing1.xml", "<autoFilter"]) afirmar(s.includes(parte), `falta ${parte}`);
    if (SALIDA) {
      fs.mkdirSync(SALIDA, { recursive: true });
      fs.writeFileSync(path.join(SALIDA, "PRUEBA_ot_resumen.xlsx"), b);
    }
    return `${b.length} bytes`;
  });

  await paso("B · Excel de equipos (suma), movimientos de consumibles y actividades; el analista no exporta actividades", async () => {
    for (const q of [
      "entidad=equipo&formato=xlsx&resumenFilas=estado&grafico=torta",
      "entidad=consumible_movimiento&formato=xlsx&resumenFilas=tipo&resumenValor=cantidad&resumenAgregado=suma&grafico=barra",
      "entidad=actividad&formato=xlsx&resumenFilas=accion&grafico=linea&desde=2026-10-01",
      "entidad=consumible_lote&formato=xlsx",
    ]) {
      const r = await pedir(U.calidad, "GET", `/reportes/tabla?${q}`);
      afirmar(r.status === 200 && Buffer.isBuffer(r.json), `${q} → ${r.status} ${msg(r.json)}`);
      if (SALIDA) fs.writeFileSync(path.join(SALIDA, `PRUEBA_${q.split("&")[0].split("=")[1]}.xlsx`), r.json);
    }
    await exigir(403, U.lmbAnalista, "GET", "/reportes/tabla?entidad=actividad&formato=xlsx");
  });

  await paso("B · Validaciones del resumen: campo fuera de las columnas y suma sin campo → 400", async () => {
    await exigir(400, U.calidad, "GET", "/reportes/tabla?entidad=ot&campos=codigo&formato=xlsx&resumenFilas=estado");
    await exigir(400, U.calidad, "GET", "/reportes/tabla?entidad=ot&campos=codigo,estado&formato=xlsx&resumenFilas=estado&resumenAgregado=suma");
    await exigir(400, U.calidad, "GET", "/reportes/tabla?entidad=ot&formato=xlsx&resumenFilas=estado&grafico=radar");
  });

  await paso("B · Plantillas de exportación: crear, listar a otros, nombre repetido → 409, solo su autor la cambia, borrar", async () => {
    const nombre = `PRUEBA OT abiertas últimos 30 días ${sello}`;
    const p = await ok(U.calidad, "POST", "/reportes/plantillas", {
      nombre,
      entidad: "ot",
      campos: ["codigo", "estado", "prioridad"],
      filtros: { ultimosDias: 30 },
      resumen: { filas: "estado", agregado: "conteo", grafico: "columna" },
    });
    afirmar(p.propia && p.filtros.ultimosDias === 30 && p.resumen.filas === "estado", JSON.stringify(p).slice(0, 200));
    await exigir(409, U.calidad, "POST", "/reportes/plantillas", { nombre: nombre.toUpperCase(), entidad: "ot", campos: ["codigo"] });
    await exigir(400, U.calidad, "POST", "/reportes/plantillas", { nombre: `PRUEBA mala ${sello}`, entidad: "ot", campos: ["no_existe"] });
    const otros = await ok(U.lmbJefe, "GET", "/reportes/plantillas");
    afirmar(otros.some((x) => x.id === p.id && !x.propia), "otro usuario no ve la plantilla compartida");
    await exigir(403, U.lmbJefe, "PATCH", `/reportes/plantillas/${p.id}`, { nombre: "x" });
    const e = await ok(U.calidad, "PATCH", `/reportes/plantillas/${p.id}`, { resumen: { filas: "prioridad", grafico: "torta" } });
    afirmar(e.resumen.filas === "prioridad" && e.campos.length === 3, "no actualizó");
    await ok(U.calidad, "DELETE", `/reportes/plantillas/${p.id}`);
    afirmar(!(await ok(U.calidad, "GET", "/reportes/plantillas")).some((x) => x.id === p.id), "sigue listada");
  });
}

main()
  .then(() => {
    console.log(`\nFrente documental: ${pasos.filter((p) => p.ok).length}/${pasos.length} pasos OK`);
    process.exit(0);
  })
  .catch((e) => {
    console.log(`\nFALLÓ: ${e.message}`);
    process.exit(1);
  });
