#!/usr/bin/env node
/**
 * Integración con el software de armas del BPCH · ida y vuelta contra la API real
 * y un BPCH SIMULADO (servidor HTTP local). docs/INTEGRACION_ARMAS_BPCH.md
 *
 *   1. Parámetros: integración activa, url_base = el BPCH simulado, ruta de enlaces.
 *   2. Se adjunta la resolución (PDF PRUEBA) y se encola la OT; «procesar» la envía:
 *      el BPCH simulado comprueba Bearer, X-Idempotency-Key y el JSON, descarga la
 *      resolución por su enlace firmado y responde 201 con bpch_id.
 *   3. Webhook con firma inválida → 401; estado 6 firmado → 200; mismo X-Event-ID → duplicado.
 *   4. Estado 2 (firmada) con url_ot → el LIMS pide los enlaces al BPCH (GET ruta_enlaces_ot)
 *      y guarda los de certificados; el de un servidor no permitido se descarta.
 *   5. Opción 1 (POST directo con token del LIMS): devolución con motivo (estado 1).
 *   6. Estado 8 con acta en base64 → acta guardada como PDF de la OT; certificados NO.
 *
 * Uso: node scripts/verificacion/integracion-armas.js [--base http://localhost:3061/api] [--bd lims_armas_prueba] [--puerto 3099]
 * La API debe arrancar con JWT_SECRET (el de las pruebas locales), BPCH_ARMAS_TOKEN=token-bpch-prueba
 * y BPCH_ARMAS_HMAC_SECRET=clave-hmac-prueba. Datos «PRUEBA»: úsese en una base de pruebas.
 */
"use strict";
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:3061/api");
const BD = arg("--bd", process.env.BD || "lims_armas_prueba");
const PUERTO = Number(arg("--puerto", "3099"));
const SECRETO = process.env.JWT_SECRET || "recorrido-local-pruebas-0123456789abcdef";
const TOKEN_BPCH = process.env.BPCH_ARMAS_TOKEN || "token-bpch-prueba";
const HMAC = process.env.BPCH_ARMAS_HMAC_SECRET || "clave-hmac-prueba";

let fallos = 0;
const ok = (cond, texto, extra) => {
  if (!cond) fallos++;
  console.log(`${cond ? "  OK  " : "  FALLA"} ${texto}${extra !== undefined ? ` → ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function sql(q) {
  return execFileSync("docker", ["exec", "-i", "lims-idic-postgres", "psql", "-U", "lims", "-d", BD, "-At", "-F", "|", "-c", q], { encoding: "utf8" }).trim();
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function tokenDe(username, soloPermisos) {
  const [id, tenant] = sql(`SELECT id, tenant_id FROM usuario WHERE username = '${username.replace(/'/g, "")}'`).split("|");
  const roles = sql(`SELECT r.codigo FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id WHERE ur.usuario_id = '${id}'`).split("\n").filter(Boolean);
  const permisos =
    soloPermisos ??
    sql(
      `SELECT DISTINCT p.codigo FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id JOIN rol_permiso rp ON rp.rol_id = r.id JOIN permiso p ON p.id = rp.permiso_id WHERE ur.usuario_id = '${id}'`,
    ).split("\n").filter(Boolean);
  const ahora = Math.floor(Date.now() / 1000);
  const cab = b64({ alg: "HS256", typ: "JWT" });
  // Con `soloPermisos` simula la cuenta de servicio del BPCH (solo integracion.armas.estado, sin roles).
  const cuerpo = b64({ sub: id, username, tenantId: tenant, roles: soloPermisos ? [] : roles, permisos, iat: ahora, exp: ahora + 3600 });
  return `${cab}.${cuerpo}.${crypto.createHmac("sha256", SECRETO).update(`${cab}.${cuerpo}`).digest("base64url")}`;
}
async function api(token, metodo, ruta, cuerpo, extra = {}) {
  const h = { Authorization: `Bearer ${token}`, ...extra };
  let body;
  if (cuerpo instanceof FormData) body = cuerpo;
  else if (cuerpo !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(cuerpo);
  }
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers: h, body });
  return { status: r.status, datos: await r.json().catch(() => null) };
}
async function webhook(cuerpo, { firma, evento } = {}) {
  const crudo = Buffer.from(JSON.stringify(cuerpo));
  const f = firma ?? "sha256=" + crypto.createHmac("sha256", HMAC).update(crudo).digest("hex");
  const r = await fetch(`${BASE}/v1/integracion/bpch/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-BPCH-Signature": f, ...(evento ? { "X-Event-ID": evento } : {}) },
    body: crudo,
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
}

/* ------------------------------------------------- BPCH simulado (PRUEBA) --- */
const recibido = { crear: [], estado: [], enlaces: [], descargas: [] };
const BPCH_ID = 1289;
const servidor = http.createServer((req, res) => {
  const partes = [];
  req.on("data", (c) => partes.push(c));
  req.on("end", async () => {
    const cuerpo = Buffer.concat(partes).toString("utf8");
    const json = (codigo, o) => {
      res.writeHead(codigo, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN_BPCH}`) return json(401, { error: "token" });
    if (req.method === "POST" && req.url === "/api/v1/integracion/lims/ordenes-trabajo") {
      const p = JSON.parse(cuerpo);
      recibido.crear.push({ headers: req.headers, payload: p });
      // Descarga la resolución como lo haría el BPCH.
      for (const d of p.documentos_adjuntos ?? []) {
        const r = await fetch(d.url_descarga);
        const b = Buffer.from(await r.arrayBuffer());
        recibido.descargas.push({ status: r.status, pdf: b.subarray(0, 5).toString() === "%PDF-" });
      }
      return json(201, { codigo: 201, mensaje: "Orden de Trabajo creada exitosamente en BPCH", data: { bpch_id: BPCH_ID, estado_inicial: 1, estado_descripcion: "Pendiente", fecha_creacion: new Date().toISOString() } });
    }
    if (req.method === "GET" && /\/enlaces$/.test(req.url)) {
      recibido.enlaces.push(req.url);
      return json(200, {
        url_ot: `http://localhost:${PUERTO}/ot/${BPCH_ID}`,
        certificados: [
          { numero_serie: "PRUEBA-SERIE-001", url: `http://localhost:${PUERTO}/certificados/1`, idFed: "FED-PRUEBA-1" },
          { numero_serie: "PRUEBA-SERIE-002", url: `http://localhost:${PUERTO}/certificados/2`, idFed: "FED-PRUEBA-2" },
          { numero_serie: "PRUEBA-SERIE-003", url: "https://malicioso.ejemplo/certificados/3" },
        ],
      });
    }
    if (req.method === "GET" && /\/estado$/.test(req.url)) {
      recibido.estado.push(req.url);
      return json(200, { bpch_id: BPCH_ID, ot: "?", estado: 6, estado_descripcion: "Visado Delegación", fecha_actualizacion: new Date().toISOString() });
    }
    json(404, { error: "no existe" });
  });
});

(async () => {
  await new Promise((r) => servidor.listen(PUERTO, r));
  console.log(`API ${BASE} · base ${BD} · BPCH simulado en http://localhost:${PUERTO}`);
  const tenant = sql(`SELECT id FROM tenant ORDER BY codigo LIMIT 1`);
  const ADMIN = sql(`SELECT u.username FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id JOIN rol r ON r.id = ur.rol_id
      JOIN rol_permiso rp ON rp.rol_id = r.id JOIN permiso p ON p.id = rp.permiso_id
      WHERE p.codigo = 'integracion.armas.gestionar' AND r.codigo IN ('SUPERADMIN', 'ADMIN') AND u.deleted_at IS NULL AND u.tenant_id = '${tenant}'
      ORDER BY (r.codigo = 'SUPERADMIN') DESC, u.username LIMIT 1`);
  ok(!!ADMIN, "usuario administrador con integracion.armas.gestionar", ADMIN);
  const tk = tokenDe(ADMIN);
  const tkServicio = tokenDe(ADMIN, ["integracion.armas.estado"]);

  // OT de prueba: la última OT del tenant (los datos de la resolución se dan a mano).
  const ot = sql(`SELECT id, codigo FROM orden_trabajo WHERE tenant_id = '${tenant}' ORDER BY created_at DESC LIMIT 1`).split("|");
  ok(!!ot[0], "hay una OT de prueba", ot[1]);
  sql(`DELETE FROM integracion_armas_envio WHERE ot_id = '${ot[0]}'; DELETE FROM integracion_armas_ot WHERE ot_id = '${ot[0]}'; DELETE FROM integracion_armas_evento WHERE ot_externa = '${ot[1]}';
       DELETE FROM integracion_armas_enlace WHERE ot_id = '${ot[0]}'; DELETE FROM registro_adjunto WHERE entidad = 'integracion_armas_ot' AND entidad_id = '${ot[0]}'`);

  // 1 · Parámetros (en la pantalla: Parámetros del sistema › Integración con el software de armas del BPCH).
  for (const [c, v] of [
    ["activa", "si"],
    ["url_base", `http://localhost:${PUERTO}`],
    ["ruta_enlaces_ot", "/api/v1/integracion/lims/ordenes-trabajo/{bpch_id}/enlaces"],
    ["modo_retorno", "webhook"],
  ])
    sql(`UPDATE parametro_sistema SET valor = '${v}' WHERE tenant_id = '${tenant}' AND categoria = 'integracion_armas' AND codigo = '${c}'`);

  // 2 · Resolución adjunta + envío.
  const pdf = Buffer.from("%PDF-1.4\n% Resolución PRUEBA\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const f = new FormData();
  f.append("archivo", new Blob([pdf], { type: "application/pdf" }), "resolucion_PRUEBA.pdf");
  const adj = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/adjuntos`, f);
  ok(adj.status === 201, "adjuntar la resolución (PDF PRUEBA)", adj.status);

  const manual = { tipoOrden: 2, resolucionNumero: "RES-PRUEBA-0001", resolucionFecha: "2026-11-20", solicitanteRut: "11.111.111-1", solicitanteEmail: "prueba@ejemplo.cl", cantidadArmas: 3, observaciones: "Envío PRUEBA" };
  const sinDatos = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/previsualizar`, { cantidadArmas: 3 });
  ok(sinDatos.status === 200, "previsualizar responde (con lo que falte)", sinDatos.datos?.errores);
  const env = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/enviar`, manual);
  ok(env.status === 201 && env.datos?.estado === "pendiente", "encolar el envío", env.datos);
  const env2 = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/enviar`, manual);
  ok(env2.datos?.yaExistia === true, "volver a enviar no duplica", env2.datos);

  const pr = await api(tk, "POST", `/integracion/armas/procesar`);
  ok(pr.status === 200 && pr.datos?.procesados >= 1, "procesar la cola", pr.datos);
  const c = recibido.crear[0];
  ok(!!c, "el BPCH recibió POST /ordenes-trabajo");
  ok(c?.headers["x-idempotency-key"]?.length === 36, "con X-Idempotency-Key", c?.headers["x-idempotency-key"]);
  ok(c?.payload?.lims_ot_id === ot[1] && c?.payload?.solicitante?.rut === "11111111" && c?.payload?.cantidad_armas === 3, "payload según el documento del BPCH", c?.payload);
  ok(recibido.descargas[0]?.status === 200 && recibido.descargas[0]?.pdf, "el BPCH descargó la resolución por el enlace firmado", recibido.descargas);
  let e = await api(tk, "GET", `/integracion/armas/ot/${ot[0]}`);
  // «procesar» además consulta el estado (opción 3): el BPCH simulado responde 6.
  ok(e.datos?.estado?.bpchId === String(BPCH_ID) && e.datos?.estado?.enviadoAt, "estado: enviada con bpch_id", e.datos?.estado);
  ok(recibido.estado.length >= 1 && e.datos?.estado?.estado === 6, "consulta de estado (opción 3) → Visado Delegación", recibido.estado);

  // 3 · Webhook.
  const malo = await webhook({ ot: ot[1], estado: 6 }, { firma: "sha256=" + "0".repeat(64) });
  ok(malo.status === 401, "webhook con firma inválida → 401", malo.status);
  const w6 = await webhook({ evento_id: "evt-prueba-6", ot: ot[1], estado: 6, usuario_rut: "11111111", fecha_cambio: new Date(Date.now() - 60_000).toISOString() }, { evento: "evt-prueba-6" });
  ok(w6.status === 200, "webhook estado 6 (Visado Delegación) → 200", w6.datos);
  const w6b = await webhook({ evento_id: "evt-prueba-6", ot: ot[1], estado: 6 }, { evento: "evt-prueba-6" });
  ok(w6b.status === 200 && w6b.datos?.duplicado === true, "mismo X-Event-ID → duplicado", w6b.datos);
  const wx = await webhook({ ot: "NO-EXISTE-PRUEBA", estado: 6 }, { evento: "evt-prueba-x" });
  ok(wx.status === 404, "OT desconocida → 404", wx.status);

  // 4 · Firmada: pide los enlaces.
  const w2 = await webhook({ evento_id: "evt-prueba-2", ot: ot[1], estado: 2, estado_descripcion: "Firmada y en Comercial", fecha_cambio: new Date(Date.now() - 30_000).toISOString(), url_ot: `http://localhost:${PUERTO}/ot/${BPCH_ID}` }, { evento: "evt-prueba-2" });
  ok(w2.status === 200, "webhook estado 2 (Firmada y en Comercial) → 200", w2.datos);
  await espera(1500);
  ok(recibido.enlaces.length >= 1, "el LIMS pidió los enlaces al BPCH", recibido.enlaces);
  e = await api(tk, "GET", `/integracion/armas/ot/${ot[0]}`);
  const certs = (e.datos?.enlaces ?? []).filter((x) => x.tipo === "certificado");
  ok(certs.length === 2, "enlaces de 2 certificados (el de otro servidor descartado)", certs.map((x) => x.url));
  ok(e.datos?.estado?.urlOtExterna === `http://localhost:${PUERTO}/ot/${BPCH_ID}`, "enlace a la OT en el BPCH", e.datos?.estado?.urlOtExterna);

  // 5 · Opción 1: POST directo con token del LIMS (devolución).
  const sinPermiso = await api(tokenDe(ADMIN, ["ot.ver"]), "POST", `/v1/integracion/bpch/estado`, { ot: ot[1], nuevo_estado: 6 });
  ok(sinPermiso.status === 403, "POST directo sin integracion.armas.estado → 403", sinPermiso.status);
  const p1 = await api(tkServicio, "POST", `/v1/integracion/bpch/estado`, { ot: ot[1], nuevo_estado: 1, estado_descripcion: "Rechazada", fecha_actualizacion: new Date(Date.now() - 20_000).toISOString(), operador_rut: "11111111", motivo: "Falta comprobante PRUEBA" });
  ok(p1.status === 200, "POST directo (opción 1) con motivo → 200", p1.datos);
  const sinToken = await fetch(`${BASE}/v1/integracion/bpch/estado`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ot: ot[1], nuevo_estado: 6 }) });
  ok(sinToken.status === 401, "POST directo sin token → 401", sinToken.status);
  const aviso = sql(`SELECT count(*) FROM aviso WHERE ot_id = '${ot[0]}' AND tipo = 'armas_bpch_rechazo'`);
  ok(Number(aviso) >= 1, "aviso de devolución en Mi bandeja", aviso);

  // 6 · Finalizada con acta en base64.
  const w8 = await webhook({
    evento_id: "evt-prueba-8",
    ot: ot[1],
    estado: 8,
    estado_descripcion: "OT Finalizada",
    fecha_cambio: new Date().toISOString(),
    total_certificados: 3,
    documento_cierre: { nombre: "Acta_Cierre_PRUEBA.pdf", tipo: "acta_finalizacion", descripcion: "Acta PRUEBA", base64: pdf.toString("base64") },
    certificados: [{ numero_serie: "PRUEBA-SERIE-001", url: `http://localhost:${PUERTO}/certificados/1`, base64: pdf.toString("base64") }],
  }, { evento: "evt-prueba-8" });
  ok(w8.status === 200, "webhook estado 8 con acta → 200", w8.datos);
  e = await api(tk, "GET", `/integracion/armas/ot/${ot[0]}`);
  ok(e.datos?.estado?.estado === 8 && e.datos?.estado?.totalCertificados === 3, "estado Finalizada, 3 certificados", e.datos?.estado);
  const clases = (e.datos?.adjuntos ?? []).map((a) => a.clase).sort();
  ok(JSON.stringify(clases) === JSON.stringify(["acta_finalizacion", "resolucion"]), "solo se guardan la resolución y el acta (ningún certificado en PDF)", clases);
  ok((e.datos?.historial ?? []).length >= 4, "historial de estados", (e.datos?.historial ?? []).map((h) => h.nuevo));
  const guardado = sql(`SELECT payload::text FROM integracion_armas_evento WHERE evento_id = 'evt-prueba-8'`);
  ok(!guardado.includes(pdf.toString("base64")), "el evento guardado no lleva el base64");
  const band = await api(tk, "GET", `/integracion/armas/bandeja`);
  ok(band.status === 200 && band.datos?.config?.claveHmacConfigurada === true, "bandeja", { envios: band.datos?.envios?.length, eventos: band.datos?.eventos?.length });

  sql(`UPDATE parametro_sistema SET valor = 'no' WHERE tenant_id = '${tenant}' AND categoria = 'integracion_armas' AND codigo = 'activa'`);
  servidor.close();
  console.log(fallos ? `\n${fallos} FALLA(S)` : "\nTodo OK");
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error(e);
  servidor.close();
  process.exit(1);
});
