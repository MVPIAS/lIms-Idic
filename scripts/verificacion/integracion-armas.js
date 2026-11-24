#!/usr/bin/env node
/**
 * Integración con el software de armas del BPCH · ida y vuelta contra la API real
 * y un BPCH SIMULADO (servidor HTTP local). docs/INTEGRACION_ARMAS_BPCH.md
 *
 *    1. Parámetros: integración activa, url_base = el BPCH simulado, ruta de enlaces, modo_adjunto base64.
 *    2. Persona natural mantenida por la D11 (ámbito estricto: fuera de la D11 → 403).
 *    3. Resolución adjunta y envío: viaja DENTRO del mensaje (base64), Bearer, X-Idempotency-Key, 201.
 *    4. Paso 9 de la D11 bloqueado (409) en una OT enviada al sistema de armas.
 *    5. Webhook: firma inválida 401; acuse 200 en < 2 s; mismo X-Event-ID → duplicado; evento
 *       atrasado → historial «fuera de orden» sin retroceder; hora guardada tal cual; código
 *       desconocido → se guarda y avisa.
 *    6. POST directo (opción 1): «Pendiente rechazado» (código provisional 9) y aviso.
 *    7. Firmada (2): el LIMS pide los enlaces (con disparos); el de otro servidor se descarta.
 *    8. Certificado de rechazo (enlace) y rechazo total (4) → notificación a la DGMN pendiente.
 *    9. Finalizada (8) con acta en base64: se guarda el acta; certificados NO.
 *   10. Estadísticas y vista bi_integracion_armas_fases.
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
      // La resolución llega DENTRO del mensaje (base64); con modo url, se descarga.
      for (const d of p.documentos_adjuntos ?? []) {
        if (d.contenido_base64) {
          recibido.descargas.push({ modo: "base64", pdf: Buffer.from(d.contenido_base64, "base64").subarray(0, 5).toString() === "%PDF-" });
        } else {
          const r = await fetch(d.url_descarga);
          const b = Buffer.from(await r.arrayBuffer());
          recibido.descargas.push({ modo: "url", status: r.status, pdf: b.subarray(0, 5).toString() === "%PDF-" });
        }
      }
      return json(201, { codigo: 201, mensaje: "Orden de Trabajo creada exitosamente en BPCH", data: { bpch_id: BPCH_ID, estado_inicial: 1, estado_descripcion: "Pendiente", fecha_creacion: new Date().toISOString() } });
    }
    if (req.method === "GET" && /\/enlaces$/.test(req.url)) {
      recibido.enlaces.push(req.url);
      return json(200, {
        url_ot: `http://localhost:${PUERTO}/ot/${BPCH_ID}`,
        certificados: [
          { numero_serie: "PRUEBA-SERIE-001", url: `http://localhost:${PUERTO}/certificados/1`, idFed: "FED-PRUEBA-1", total_disparos: 3 },
          { numero_serie: "PRUEBA-SERIE-002", url: `http://localhost:${PUERTO}/certificados/2`, idFed: "FED-PRUEBA-2", total_disparos: 3 },
          { numero_serie: "PRUEBA-SERIE-003", url: "https://malicioso.ejemplo/certificados/3" },
        ],
      });
    }
    if (req.method === "GET" && /\/estado$/.test(req.url)) {
      recibido.estado.push(req.url);
      return json(200, { bpch_id: BPCH_ID, ot: "?", estado: 6, estado_descripcion: "Visado Delegación", fecha_actualizacion: "2026-11-24T08:00:00-03:00" });
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
       DELETE FROM integracion_armas_enlace WHERE ot_id = '${ot[0]}'; DELETE FROM integracion_armas_historial WHERE ot_id = '${ot[0]}';
       DELETE FROM registro_adjunto WHERE entidad = 'integracion_armas_ot' AND entidad_id = '${ot[0]}';
       DELETE FROM bpch_notificacion_dgmn WHERE ot_id = '${ot[0]}' AND origen = 'integracion_armas'`);

  // 1 · Parámetros (en la pantalla: Parámetros del sistema › Integración con el software de armas del BPCH).
  for (const [c, v] of [
    ["activa", "si"],
    ["url_base", `http://localhost:${PUERTO}`],
    ["ruta_enlaces_ot", "/api/v1/integracion/lims/ordenes-trabajo/{bpch_id}/enlaces"],
    ["modo_retorno", "webhook"],
    ["modo_adjunto", "base64"],
  ])
    sql(`UPDATE parametro_sistema SET valor = '${v}' WHERE tenant_id = '${tenant}' AND categoria = 'integracion_armas' AND codigo = '${c}'`);

  // 2 · Persona natural mantenida por la D11 (API, con el Jefe de la D11; ámbito estricto D11).
  const JEFE_D11 = sql(`SELECT u.username FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id JOIN unidad un ON un.id = ur.unidad_id
      JOIN rol_permiso rp ON rp.rol_id = ur.rol_id JOIN permiso p ON p.id = rp.permiso_id
      WHERE un.codigo = 'D11' AND p.codigo = 'cliente.persona_natural.gestionar' AND u.deleted_at IS NULL ORDER BY (u.username LIKE '%jefe%') DESC LIMIT 1`);
  ok(!!JEFE_D11, "usuario de la D11 con cliente.persona_natural.gestionar", JEFE_D11);
  const tkD11 = tokenDe(JEFE_D11);
  const fuera = await api(tk, "POST", `/clientes/personas-naturales`, { rut: "22.222.222-2", nombres: "X", apellidos: "Y" });
  ok(fuera.status === 403, "fuera de la D11 no se mantienen personas naturales (ámbito)", fuera.status);
  const rutPrueba = "22.222.222-2";
  sql(`DELETE FROM cliente WHERE REPLACE(rut, '.', '') = '22222222-2' AND es_persona_natural`);
  const pn = await api(tkD11, "POST", `/clientes/personas-naturales`, { rut: rutPrueba, nombres: "Persona", apellidos: "PRUEBA Uno", email: "persona.prueba@ejemplo.cl", comuna: "Santiago" });
  ok(pn.status === 201 && pn.datos?.razonSocial === "Persona PRUEBA Uno", "D11 crea una persona natural", pn.status === 201 ? pn.datos?.razonSocial : pn.datos);
  const pnDup = await api(tkD11, "POST", `/clientes/personas-naturales`, { rut: rutPrueba, nombres: "Otra", apellidos: "PRUEBA" });
  ok(pnDup.status === 409, "no duplica el RUT", pnDup.status);
  const pnEd = await api(tkD11, "PATCH", `/clientes/personas-naturales/${pn.datos?.id}`, { telefono: "+56 2 0000 0000" });
  ok(pnEd.status === 200 && pnEd.datos?.telefono, "D11 edita la persona natural", pnEd.status);

  // 3 · Resolución adjunta + envío (base64 dentro del mensaje).
  const pdf = Buffer.from("%PDF-1.4\n% Resolución PRUEBA\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const f = new FormData();
  f.append("archivo", new Blob([pdf], { type: "application/pdf" }), "resolucion_PRUEBA.pdf");
  const adj = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/adjuntos`, f);
  ok(adj.status === 201, "adjuntar la resolución (PDF PRUEBA)", adj.status);

  const manual = { tipoOrden: 2, resolucionNumero: "RES-PRUEBA-0001", resolucionFecha: "2026-11-20", solicitanteRut: "11.111.111-1", solicitanteEmail: "prueba@ejemplo.cl", cantidadArmas: 3, observaciones: "Envío PRUEBA" };
  const vista = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/previsualizar`, manual);
  ok(vista.status === 200 && vista.datos?.payload?.documentos_adjuntos?.[0]?.contenido_base64?.includes("bytes"), "previsualizar resume el base64", vista.datos?.payload?.documentos_adjuntos);
  const env = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/enviar`, manual);
  ok(env.status === 201 && env.datos?.estado === "pendiente", "encolar el envío", env.datos);
  const env2 = await api(tk, "POST", `/integracion/armas/ot/${ot[0]}/enviar`, manual);
  ok(env2.datos?.yaExistia === true, "volver a enviar no duplica", env2.datos);

  const pr = await api(tk, "POST", `/integracion/armas/procesar`);
  ok(pr.status === 200 && pr.datos?.procesados >= 1, "procesar la cola", pr.datos);
  const c = recibido.crear[0];
  ok(!!c, "el BPCH recibió POST /ordenes-trabajo");
  ok(c?.headers["x-idempotency-key"]?.length === 36, "con X-Idempotency-Key", c?.headers["x-idempotency-key"]);
  ok(c?.payload?.lims_ot_id === ot[1] && c?.payload?.solicitante?.rut === "11111111" && c?.payload?.cantidad_armas === 3, "payload según el documento del BPCH", { ...c?.payload, documentos_adjuntos: undefined });
  ok(recibido.descargas[0]?.modo === "base64" && recibido.descargas[0]?.pdf, "la resolución viajó DENTRO del mensaje (base64)", recibido.descargas);
  let e = await api(tk, "GET", `/integracion/armas/ot/${ot[0]}`);
  ok(e.datos?.estado?.bpchId === String(BPCH_ID) && e.datos?.estado?.enviadoAt, "estado: enviada con bpch_id", e.datos?.estado?.bpchId);
  ok(recibido.estado.length >= 1 && e.datos?.estado?.estado === 6, "consulta de estado (opción 3) → Visado Delegación", recibido.estado);

  // 4 · D11: con la OT en el sistema de armas no se emiten certificados por arma en el LIMS.
  const otD11 = sql(`SELECT ot.id, ot.codigo FROM orden_trabajo ot JOIN unidad u ON u.id = ot.unidad_principal
      WHERE u.codigo = 'D11' AND ot.tenant_id = '${tenant}' AND NOT EXISTS (SELECT 1 FROM integracion_armas_ot i WHERE i.ot_id = ot.id) ORDER BY ot.created_at LIMIT 1`).split("|");
  if (otD11[0]) {
    sql(`INSERT INTO integracion_armas_ot (ot_id, tenant_id, lims_ot_id, tipo_orden) VALUES ('${otD11[0]}', '${tenant}', 'PRUEBA-BLOQUEO-${otD11[1]}', 1)`);
    const d11 = await api(tkD11, "POST", `/d11/ot/${otD11[0]}/certificados`, { armaOtIds: ["00000000-0000-4000-8000-000000000000"] });
    ok(d11.status === 409 && /numeración/.test(d11.datos?.message ?? ""), "paso 9 de la D11 bloqueado en una OT del sistema de armas (409)", d11.datos?.message);
    const exp = await api(tkD11, "GET", `/d11/ot/${otD11[0]}`);
    ok(exp.datos?.sistemaArmas?.certificadosBloqueados === true, "el expediente D11 explica el bloqueo", exp.status);
    sql(`DELETE FROM integracion_armas_ot WHERE ot_id = '${otD11[0]}'`);
  } else ok(false, "no hay OT de la D11 en la base de prueba");

  // 5 · Webhook: firma, acuse, duplicado, hora tal cual, fuera de orden.
  const malo = await webhook({ ot: ot[1], estado: 6 }, { firma: "sha256=" + "0".repeat(64) });
  ok(malo.status === 401, "webhook con firma inválida → 401", malo.status);
  const t0 = Date.now();
  const w7 = await webhook({ evento_id: "evt-prueba-7", ot: ot[1], estado: 7, usuario_rut: "11111111", fecha_cambio: "2026-11-24T09:00:00-03:00" }, { evento: "evt-prueba-7" });
  const ms = Date.now() - t0;
  ok(w7.status === 200 && ms < 2000, `acuse 200 en menos de 2 s (${ms} ms)`, w7.datos);
  const w7b = await webhook({ evento_id: "evt-prueba-7", ot: ot[1], estado: 7 }, { evento: "evt-prueba-7" });
  ok(w7b.status === 200 && w7b.datos?.duplicado === true, "mismo X-Event-ID → 200 duplicado", w7b.datos);
  const viejo = await webhook({ ot: ot[1], estado: 5, fecha_cambio: "2026-11-01T09:00:00-03:00" }, { evento: "evt-prueba-viejo" });
  ok(viejo.status === 200, "evento atrasado → 200", viejo.datos);
  await espera(300);
  e = await api(tk, "GET", `/integracion/armas/ot/${ot[0]}`);
  ok(e.datos?.estado?.estado === 7, "el atrasado no retrocede el estado (sigue 7)", e.datos?.estado?.estado);
  ok((e.datos?.historial ?? []).some((h) => h.nuevo === 5 && h.fueraDeOrden), "queda en el historial marcado fuera de orden");
  ok((e.datos?.historial ?? []).some((h) => h.fechaTexto === "2026-11-24T09:00:00-03:00"), "hora guardada tal cual (texto con desfase)");
  const wx = await webhook({ ot: "NO-EXISTE-PRUEBA", estado: 6 }, { evento: "evt-prueba-x" });
  ok(wx.status === 404, "OT desconocida → 404", wx.status);
  const w42 = await webhook({ ot: ot[1], estado: 42, fecha_cambio: "2026-11-24T09:05:00-03:00" }, { evento: "evt-prueba-42" });
  ok(w42.status === 200, "código desconocido → 200 (se guarda y avisa)", w42.datos);

  // 6 · Devolución (Pendiente rechazado, código provisional 9) por POST directo.
  const sinPermiso = await api(tokenDe(ADMIN, ["ot.ver"]), "POST", `/v1/integracion/bpch/estado`, { ot: ot[1], nuevo_estado: 6 });
  ok(sinPermiso.status === 403, "POST directo sin integracion.armas.estado → 403", sinPermiso.status);
  const p9 = await api(tkServicio, "POST", `/v1/integracion/bpch/estado`, { ot: ot[1], nuevo_estado: 9, fecha_actualizacion: "2026-11-24T09:10:00-03:00", operador_rut: "11111111", motivo: "Falta comprobante PRUEBA" });
  ok(p9.status === 200, "POST directo «Pendiente rechazado» → 200", p9.datos);
  const sinToken = await fetch(`${BASE}/v1/integracion/bpch/estado`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ot: ot[1], nuevo_estado: 6 }) });
  ok(sinToken.status === 401, "POST directo sin token → 401", sinToken.status);
  await espera(300);
  const aviso = sql(`SELECT count(*) FROM aviso WHERE ot_id = '${ot[0]}' AND tipo = 'armas_bpch_rechazo'`);
  ok(Number(aviso) >= 1, "aviso de devolución en Mi bandeja", aviso);

  // 7 · Firmada: pide los enlaces (con disparos; el de otro servidor se descarta).
  const w2 = await webhook({ ot: ot[1], estado: 2, estado_descripcion: "Firmada y en Comercial", fecha_cambio: "2026-11-24T09:20:00-03:00", url_ot: `http://localhost:${PUERTO}/ot/${BPCH_ID}`, total_disparos: 6 }, { evento: "evt-prueba-2" });
  ok(w2.status === 200, "webhook estado 2 → 200", w2.datos);
  await espera(1500);
  ok(recibido.enlaces.length >= 1, "el LIMS pidió los enlaces al BPCH", recibido.enlaces);
  e = await api(tk, "GET", `/integracion/armas/ot/${ot[0]}`);
  const certs = (e.datos?.enlaces ?? []).filter((x) => x.tipo === "certificado");
  ok(certs.length === 2 && certs.every((x) => x.totalDisparos === 3), "enlaces de 2 certificados con disparos (el de otro servidor descartado)", certs.map((x) => x.url));
  ok(e.datos?.estado?.totalDisparos === 6, "disparos de la OT", e.datos?.estado?.totalDisparos);

  // 8 · Certificado de rechazo (enlace) y rechazo total (4) → DGMN pendiente.
  const wr = await webhook({ ot: ot[1], estado: 2, fecha_cambio: "2026-11-24T09:25:00-03:00", enlaces: [{ tipo: "certificado_rechazo", numero_serie: "PRUEBA-SERIE-009", url: `http://localhost:${PUERTO}/rechazos/9` }] }, { evento: "evt-prueba-cr" });
  ok(wr.status === 200, "certificado de rechazo (enlace) → 200", wr.datos);
  const w4 = await webhook({ ot: ot[1], estado: 4, estado_descripcion: "Rechazado total", fecha_cambio: "2026-11-24T09:30:00-03:00", motivo: "Arma no apta PRUEBA" }, { evento: "evt-prueba-4" });
  ok(w4.status === 200, "rechazo total (4) → 200", w4.datos);
  await espera(300);
  const dgmn = sql(`SELECT string_agg(referencia || ':' || estado, ',' ORDER BY referencia) FROM bpch_notificacion_dgmn WHERE ot_id = '${ot[0]}' AND origen = 'integracion_armas'`);
  ok(dgmn === "certificado_rechazo:PRUEBA-SERIE-009:pendiente,rechazo_total:pendiente", "notificaciones a la DGMN pendientes", dgmn);
  const notif = await api(tk, "GET", `/bpch/notificacion-dgmn/ot/${ot[0]}`);
  ok(notif.status === 200 && notif.datos?.aplica && notif.datos?.integracionArmas?.length === 2, "la ficha de DGMN las muestra", notif.status);

  // 9 · Finalizada con acta en base64 (el 8 llega después del 4 terminal: se registra igual).
  const w8 = await webhook({
    ot: ot[1],
    estado: 8,
    estado_descripcion: "OT Finalizada",
    fecha_cambio: "2026-11-24T09:40:00-03:00",
    total_certificados: 3,
    documento_cierre: { nombre: "Acta_Cierre_PRUEBA.pdf", tipo: "acta_finalizacion", descripcion: "Acta PRUEBA", base64: pdf.toString("base64") },
    certificados: [{ numero_serie: "PRUEBA-SERIE-001", url: `http://localhost:${PUERTO}/certificados/1`, base64: pdf.toString("base64") }],
  }, { evento: "evt-prueba-8" });
  ok(w8.status === 200, "webhook estado 8 con acta → 200", w8.datos);
  await espera(300);
  e = await api(tk, "GET", `/integracion/armas/ot/${ot[0]}`);
  ok(e.datos?.estado?.estado === 8 && e.datos?.estado?.totalCertificados === 3, "estado Finalizada, 3 certificados", e.datos?.estado?.estado);
  const clases = (e.datos?.adjuntos ?? []).map((a) => a.clase).sort();
  ok(JSON.stringify(clases) === JSON.stringify(["acta_finalizacion", "resolucion"]), "solo se guardan la resolución y el acta (ningún certificado en PDF)", clases);
  const guardado = sql(`SELECT payload::text || datos::text FROM integracion_armas_evento WHERE evento_id = 'evt-prueba-8'`);
  ok(!guardado.includes(pdf.toString("base64")), "el evento guardado no lleva el base64");

  // 10 · Estadísticas y vista para Metabase.
  const est = await api(tk, "GET", `/integracion/armas/estadisticas?tipo_orden=2`);
  ok(est.status === 200 && est.datos?.totales?.rechazos_totales >= 1 && est.datos?.fases?.length >= 1 && est.datos?.rechazos?.length >= 1, "estadísticas", { totales: est.datos?.totales, fases: est.datos?.fases?.length, rechazos: est.datos?.rechazos?.length });
  const vistaBi = sql(`SELECT count(*) FROM bi_integracion_armas_fases WHERE ot_id = '${ot[0]}'`);
  ok(Number(vistaBi) >= 4, "vista bi_integracion_armas_fases", vistaBi);
  const band = await api(tk, "GET", `/integracion/armas/bandeja`);
  ok(band.status === 200 && band.datos?.config?.claveHmacConfigurada === true && band.datos?.estados?.length >= 9, "bandeja con el mapa de estados", { envios: band.datos?.envios?.length, eventos: band.datos?.eventos?.length });

  sql(`UPDATE parametro_sistema SET valor = 'no' WHERE tenant_id = '${tenant}' AND categoria = 'integracion_armas' AND codigo = 'activa'`);
  servidor.close();
  console.log(fallos ? `\n${fallos} FALLA(S)` : "\nTodo OK");
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error(e);
  servidor.close();
  process.exit(1);
});
