#!/usr/bin/env node
/**
 * Frente F4 · Firma Electrónica Avanzada (FEA) en el PDF final · recorrido real contra la API.
 * docs/FLUJO_FEA_DOCUMENTOS.md
 *
 * Firma de verdad: genera con openssl un certificado autofirmado «PRUEBA» (no es FirmaGob),
 * agrega la firma al PDF descargado del LIMS como actualización incremental (PAdES,
 * /SubFilter ETSI.CAdES.detached, CMS con atributos firmados) y lo sube. Comprueba además
 * con `openssl cms -verify` que el CMS firma exactamente los tramos del /ByteRange.
 *
 *   INF · Informe de ensayo oficial sin entregar (firmante final = jefatura del depto.):
 *         parámetro «exige FEA» = sí → entregar 409; PDF emitido congelado (mismo SHA-256 en
 *         dos descargas); sin firma 400; no PDF 400; quien no firmó 403; firmado → corresponde;
 *         /informes/:id/pdf y la verificación pública usan la versión FEA; deja de estar en
 *         «pendientes»; ahora sí se entrega.
 *   EXC · PDF firmado de OTRO documento: 409 «requiere excepción»; con motivo y sin permiso
 *         403; jefatura con motivo → aceptado como EXCEPCIÓN en el historial.
 *   MET · Certificado de calibración emitido: la descarga y la verificación usan la FEA.
 *   D11 · Certificado por arma oficial: la verificación pública muestra la FEA y el arma.
 *
 * Uso: node scripts/verificacion/fea.js [--base http://localhost:3034/api] [--bd pl_f4]
 * Requiere: API compilada (apps/api/dist) arrancada con JWT_SECRET (por defecto el de las
 * pruebas locales), docker con lims-idic-postgres y openssl en el PATH. Deja documentos con
 * versión FEA y una entrega «PRUEBA FEA»: úsese en una base de pruebas.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = arg("--base", process.env.API_BASE || "http://localhost:3034/api");
const BD = arg("--bd", process.env.BD || "pl_f4");
const SECRETO = process.env.JWT_SECRET || "recorrido-local-pruebas-0123456789abcdef";
const { firmarPdfPrueba } = require(path.join(RAIZ, "apps/api/dist/fea/pdf-firma-prueba.js"));
const { detectarFirmas } = require(path.join(RAIZ, "apps/api/dist/fea/fea.reglas.js"));

/* ------------------------------------------------------------ utilidades --- */
let fallos = 0;
const ok = (cond, texto, extra) => {
  if (!cond) fallos++;
  console.log(`${cond ? "  OK  " : "  FALLA"} ${texto}${extra !== undefined ? ` → ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
};
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
function sql(q) {
  return execFileSync("docker", ["exec", "-i", "lims-idic-postgres", "psql", "-U", "lims", "-d", BD, "-At", "-F", "|", "-c", q], { encoding: "utf8" }).trim();
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokens = {};
function token(username) {
  if (tokens[username]) return tokens[username];
  const [id, tenant] = sql(`SELECT id, tenant_id FROM usuario WHERE username = '${username.replace(/'/g, "")}'`).split("|");
  const roles = sql(`SELECT r.codigo FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id WHERE ur.usuario_id = '${id}'`).split("\n").filter(Boolean);
  const permisos = sql(
    `SELECT DISTINCT p.codigo FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id JOIN rol_permiso rp ON rp.rol_id = r.id JOIN permiso p ON p.id = rp.permiso_id WHERE ur.usuario_id = '${id}'`,
  ).split("\n").filter(Boolean);
  const ahora = Math.floor(Date.now() / 1000);
  const cab = b64({ alg: "HS256", typ: "JWT" });
  const cuerpo = b64({ sub: id, username, tenantId: tenant, roles, permisos, iat: ahora, exp: ahora + 3600 });
  const firma = crypto.createHmac("sha256", SECRETO).update(`${cab}.${cuerpo}`).digest("base64url");
  return (tokens[username] = `${cab}.${cuerpo}.${firma}`);
}
async function api(usuario, metodo, ruta, cuerpo) {
  const h = { Authorization: `Bearer ${token(usuario)}` };
  let body;
  if (cuerpo instanceof FormData) body = cuerpo;
  else if (cuerpo !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(cuerpo);
  }
  const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers: h, body });
  const tipo = r.headers.get("content-type") || "";
  const datos = tipo.includes("application/pdf") ? Buffer.from(await r.arrayBuffer()) : await r.json().catch(() => null);
  return { status: r.status, datos };
}
const publico = async (ruta) => {
  const r = await fetch(`${BASE}${ruta}`);
  return { status: r.status, datos: await r.json().catch(() => null) };
};
function formPdf(buf, nombre, motivo) {
  const f = new FormData();
  f.append("archivo", new Blob([buf], { type: "application/pdf" }), nombre);
  if (motivo) f.append("motivoExcepcion", motivo);
  return f;
}

/* -------------------------------------------- firma real con openssl --- */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fea-prueba-"));
const KEY = path.join(DIR, "prueba.key");
const CRT = path.join(DIR, "prueba.crt");
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", KEY, "-out", CRT, "-days", "30",
  "-subj", "/C=CL/O=PRUEBA LIMS/CN=FIRMANTE PRUEBA FEA",
], { stdio: "ignore" });
let ultimoCms = null;
let ultimosDatos = null;
function cmsOpenssl(datos) {
  const ent = path.join(DIR, `datos-${Date.now()}.bin`);
  const sal = path.join(DIR, `cms-${Date.now()}.der`);
  fs.writeFileSync(ent, datos);
  execFileSync("openssl", ["cms", "-sign", "-binary", "-in", ent, "-signer", CRT, "-inkey", KEY, "-outform", "DER", "-out", sal, "-md", "sha256", "-nosmimecap"]);
  ultimoCms = sal;
  ultimosDatos = ent;
  return fs.readFileSync(sal);
}
function firmarReal(pdf, nombre) {
  return firmarPdfPrueba(pdf, { nombre, fecha: "D:20261114103000-03'00'", motivo: "Firma PRUEBA (certificado autofirmado, no FirmaGob)", reservar: 8192, firmarCms: cmsOpenssl });
}
function verificarOpenssl() {
  try {
    const out = execFileSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", ultimoCms, "-content", ultimosDatos, "-noverify", "-out", path.join(DIR, "nul.bin")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    void out;
    return true;
  } catch (e) {
    return String(e.stderr || e.message);
  }
}

/* ------------------------------------------------------------- recorrido --- */
(async () => {
  console.log(`API ${BASE} · base ${BD} · certificados de prueba en ${DIR}`);
  const ADMIN = sql(`SELECT u.username FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id JOIN rol_permiso rp ON rp.rol_id = ur.rol_id
      JOIN permiso p ON p.id = rp.permiso_id WHERE p.codigo = 'catalogo.gestionar' AND u.deleted_at IS NULL ORDER BY (u.username = 'demo.admin') DESC, u.username LIMIT 1`);

  // Informe de ensayo oficial sin entregar ni versión FEA, y su firmante final.
  const inf = sql(`SELECT c.id, COALESCE(c.numero, c.codigo), c.codigo_verificacion,
      (SELECT u.username FROM documento_firma f JOIN usuario u ON u.id = f.firmado_por WHERE f.certificado_id = c.id AND f.estado = 'firmado' AND f.obligatorio ORDER BY f.orden DESC LIMIT 1),
      (SELECT u.username FROM documento_firma f JOIN usuario u ON u.id = f.firmado_por WHERE f.certificado_id = c.id AND f.estado = 'firmado' AND f.obligatorio ORDER BY f.orden ASC LIMIT 1)
    FROM certificado c WHERE c.estado = 'oficial' AND c.entregado_at IS NULL AND c.tipo_documento = 'INFORME_ENSAYO' AND c.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM documento_fea_archivo x WHERE x.documento_id = c.id AND x.clase = 'firmado')
      AND (SELECT count(*) FROM documento_firma f WHERE f.certificado_id = c.id AND f.estado = 'firmado') >= 2
    ORDER BY c.oficial_at DESC NULLS LAST LIMIT 1`).split("|");
  if (!inf[0]) {
    console.log("No hay un informe de ensayo oficial sin entregar con dos firmas en esta base: no se puede recorrer INF.");
    process.exit(2);
  }
  const [infId, infNum, infCod, firmante, otroFirmante] = inf;
  console.log(`\nINF · ${infNum} · firmante final ${firmante} · primer firmante ${otroFirmante}`);

  let r = await api(firmante, "GET", `/fea/informe/${infId}`);
  ok(r.status === 200 && r.datos.oficial && !r.datos.firmado && r.datos.puedo.subir, "estado FEA: oficial, sin versión firmada, el firmante puede subir", r.datos?.puedo);
  r = await api(firmante, "GET", `/fea/pendientes`);
  ok(r.status === 200 && r.datos.data.some((d) => d.id === infId), "aparece en «pendientes de firma FEA» del firmante", r.datos?.total);
  r = await api(otroFirmante, "GET", `/fea/pendientes`);
  ok(r.status === 200 && !r.datos.data.some((d) => d.id === infId), "no aparece en los pendientes de quien firmó un paso anterior");

  r = await api(ADMIN, "PUT", `/parametros/configurables/fea/informe_ensayo`, { valor: true, motivo: "PRUEBA FEA: exigir firma antes de entregar" });
  ok(r.status === 200 || r.status === 201, "parámetro «Informe de ensayo: exige FEA» = sí", r.status);
  r = await api(firmante, "GET", `/fea/informe/${infId}`);
  ok(r.datos?.exigeFea === true, "la ficha informa que se exige FEA");
  r = await api(firmante, "POST", `/informes/${infId}/entregar`, { medio: "mano", destinatario: "PRUEBA FEA" });
  ok(r.status === 409 && /firma electrónica avanzada/.test(r.datos?.message), "entregar sin versión FEA → 409 con mensaje claro", r.datos?.message?.slice(0, 120));
  r = await api(firmante, "POST", `/informes/${infId}/enviar-correo`, { destinatarios: ["prueba@lims.local"] });
  ok(r.status === 409, "enviar por correo sin versión FEA → 409", r.status);

  const o1 = await api(firmante, "GET", `/fea/informe/${infId}/original`);
  const o2 = await api(otroFirmante, "GET", `/fea/informe/${infId}/original`);
  ok(o1.status === 200 && Buffer.isBuffer(o1.datos) && sha(o1.datos) === sha(o2.datos), "PDF para firmar congelado: dos descargas, mismo SHA-256", sha(o1.datos).slice(0, 16));
  const original = o1.datos;

  r = await api(firmante, "POST", `/fea/informe/${infId}/firmado`, formPdf(original, "sin-firma.pdf"));
  ok(r.status === 400 && /no trae ninguna firma digital/.test(r.datos?.message), "subir el PDF sin firmar → 400", r.datos?.message?.slice(0, 90));
  r = await api(firmante, "POST", `/fea/informe/${infId}/firmado`, formPdf(Buffer.from("texto PRUEBA, no es PDF"), "x.pdf"));
  ok(r.status === 400 && /no es un PDF/.test(r.datos?.message), "subir algo que no es PDF → 400");

  const firmado = firmarReal(original, "JEFATURA PRUEBA FEA");
  const v = verificarOpenssl();
  ok(v === true, "openssl cms -verify: el CMS firma exactamente los tramos del /ByteRange", v === true ? "Verification successful" : v);
  const det = detectarFirmas(firmado)[0];
  ok(det && det.integra === true && det.nombre === "JEFATURA PRUEBA FEA", "detección local: firma íntegra con /Name y /M", { nombre: det?.nombre, fecha: det?.fecha, integra: det?.integra });
  fs.writeFileSync(path.join(DIR, `${infNum.replace(/[^A-Za-z0-9]/g, "_")}_FEA.pdf`), firmado);

  r = await api(otroFirmante, "POST", `/fea/informe/${infId}/firmado`, formPdf(firmado, "firmado.pdf"));
  ok(r.status === 403, "quien no es el firmante final (sin permiso de jefatura en el depto.) → 403", r.datos?.message?.slice(0, 100));
  r = await api(firmante, "POST", `/fea/informe/${infId}/firmado`, formPdf(firmado, "firmado.pdf"));
  ok(r.status === 201 && r.datos?.firmado?.corresponde === true && r.datos.firmado.integridad === "comprobada", "el firmante sube el PDF firmado → corresponde al emitido, integridad comprobada", r.datos?.firmado?.leyenda ?? r.datos?.message);
  ok(r.datos?.firmado?.hash === sha(firmado), "se guarda con su SHA-256");
  r = await api(firmante, "GET", `/informes/${infId}/pdf`);
  ok(r.status === 200 && sha(r.datos) === sha(firmado), "GET /informes/:id/pdf entrega la versión FEA");
  r = await publico(`/informes/verificar/${infCod}`);
  ok(r.datos?.firmadoFea === true && /Firmado con firma electrónica avanzada por JEFATURA PRUEBA FEA el 14-11-2026 10:30/.test(r.datos?.leyendaFea), "verificación pública: «Firmado con FEA por … el …»", r.datos?.leyendaFea);
  r = await api(firmante, "GET", `/fea/pendientes`);
  ok(!r.datos.data.some((d) => d.id === infId), "ya no está en pendientes de firma FEA");
  r = await api(firmante, "POST", `/informes/${infId}/entregar`, { medio: "mano", destinatario: "PRUEBA FEA" });
  ok(r.status === 201 || r.status === 200, "con la versión FEA, la entrega se registra", r.status === 201 || r.status === 200 ? "entregado" : r.datos?.message);

  console.log("\nEXC · PDF firmado de otro documento");
  const otro = sql(`SELECT c.id, COALESCE(c.numero, c.codigo) FROM certificado c WHERE c.estado = 'oficial' AND c.id <> '${infId}' AND c.documento_html IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM documento_fea_archivo x WHERE x.documento_id = c.id AND x.clase = 'firmado')
      AND EXISTS (SELECT 1 FROM documento_firma f WHERE f.certificado_id = c.id AND f.firmado_por = (SELECT id FROM usuario WHERE username = '${firmante}')) LIMIT 1`).split("|");
  if (otro[0]) {
    // El PDF emitido del otro documento queda congelado al descargarlo; se le sube el firmado del informe anterior.
    r = await api(firmante, "GET", `/fea/informe/${otro[0]}/original`);
    ok(r.status === 200, `${otro[1]}: PDF emitido descargado para firmar`);
    const ajeno = firmarReal(original, "JEFATURA PRUEBA FEA");
    r = await api(firmante, "POST", `/fea/informe/${otro[0]}/firmado`, formPdf(ajeno, "ajeno.pdf"));
    ok(r.status === 409 && r.datos?.requiereExcepcion === true && /no corresponde al documento emitido/.test(r.datos?.message), `subir a ${otro[1]} el firmado de ${infNum} → 409 requiere excepción`, r.datos?.message?.slice(0, 110));
    r = await api(firmante, "POST", `/fea/informe/${otro[0]}/firmado`, formPdf(ajeno, "ajeno.pdf", "corto"));
    ok(r.status === 400 && /al menos 10/.test(r.datos?.message), "motivo demasiado corto → 400");
    r = await api(firmante, "POST", `/fea/informe/${otro[0]}/firmado`, formPdf(ajeno, "ajeno.pdf", "PRUEBA FEA: excepción aceptada para el recorrido"));
    ok(r.status === 201 && r.datos?.firmado?.corresponde === false && r.datos.firmado.excepcionMotivo, "jefatura con permiso y motivo → aceptado como excepción", r.datos?.firmado?.excepcionMotivo ?? r.datos?.message);
    ok((r.datos?.historial ?? []).some((h) => h.accion === "EXCEPCION"), "la excepción queda en el historial");
  } else console.log("  (sin otro documento oficial del mismo firmante: se omite)");

  console.log("\nMET · certificado de calibración");
  const met = sql(`SELECT c.id, c.numero_certificado, c.codigo_verificacion, u.username FROM met_calibracion c JOIN usuario u ON u.id = c.emitido_by
      WHERE c.estado = 'emitida' AND c.documento_html IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documento_fea_archivo x WHERE x.documento_id = c.id AND x.clase = 'firmado') LIMIT 1`).split("|");
  if (met[0]) {
    const [mId, mNum, mCod, mFirm] = met;
    const mo = await api(mFirm, "GET", `/fea/metrologia/${mId}/original`);
    ok(mo.status === 200 && Buffer.isBuffer(mo.datos), `${mNum}: PDF para firmar (firmante ${mFirm})`);
    const mf = firmarReal(mo.datos, "METROLOGÍA PRUEBA FEA");
    r = await api(mFirm, "POST", `/fea/metrologia/${mId}/firmado`, formPdf(mf, "met.pdf"));
    ok(r.status === 201 && r.datos?.firmado?.corresponde, "versión FEA subida y corresponde", r.datos?.firmado?.leyenda ?? r.datos?.message);
    r = await api(mFirm, "GET", `/metrologia/calibraciones/${mId}/pdf`);
    ok(r.status === 200 && sha(r.datos) === sha(mf), "GET /metrologia/calibraciones/:id/pdf entrega la versión FEA");
    r = await publico(`/metrologia/verificar/${mCod}`);
    ok(r.datos?.firmadoFea === true && /METROLOGÍA PRUEBA FEA/.test(r.datos?.leyendaFea ?? ""), "verificación pública de Metrología con la FEA", r.datos?.leyendaFea);
  } else console.log("  (sin certificado de calibración emitido: se omite)");

  console.log("\nD11 · certificado por arma");
  const d11 = sql(`SELECT c.id, COALESCE(c.numero, c.codigo), c.codigo_verificacion,
      (SELECT u.username FROM documento_firma f JOIN usuario u ON u.id = f.firmado_por WHERE f.certificado_id = c.id AND f.estado = 'firmado' ORDER BY f.orden DESC LIMIT 1)
    FROM certificado c WHERE c.tipo_documento = 'CERTIFICADO_ARMA' AND c.estado = 'oficial' AND c.documento_html IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM documento_fea_archivo x WHERE x.documento_id = c.id AND x.clase = 'firmado') LIMIT 1`).split("|");
  if (d11[0] && d11[3]) {
    const [dId, dNum, dCod, dFirm] = d11;
    const dOr = await api(dFirm, "GET", `/fea/informe/${dId}/original`);
    ok(dOr.status === 200, `${dNum}: PDF para firmar (firmante ${dFirm})`);
    r = await api(dFirm, "POST", `/fea/informe/${dId}/firmado`, formPdf(firmarReal(dOr.datos, "JEFE D11 PRUEBA FEA"), "d11.pdf"));
    ok(r.status === 201 && r.datos?.firmado?.corresponde, "versión FEA del certificado por arma subida", r.datos?.firmado?.leyenda ?? r.datos?.message);
    r = await publico(`/informes/verificar/${dCod}`);
    ok(r.datos?.firmadoFea === true && r.datos?.tipoDocumento === "CERTIFICADO_ARMA", "verificación pública del certificado por arma con la FEA", r.datos?.leyendaFea);
  } else console.log("  (sin certificado por arma oficial con firmante: se omite)");

  r = await api(ADMIN, "PUT", `/parametros/configurables/fea/informe_ensayo`, { valor: false, motivo: "PRUEBA FEA: se deja como estaba" });
  ok(r.status === 200 || r.status === 201, "parámetro vuelve a «no»");

  console.log(`\n${fallos ? `${fallos} FALLA(S)` : "Todo OK"} · PDF firmados y certificado PRUEBA en ${DIR}`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
