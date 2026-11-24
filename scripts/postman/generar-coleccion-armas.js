#!/usr/bin/env node
/**
 * Genera la colección Postman v2.1 de las rutas de ENTRADA del LIMS para el
 * software de armas del BPCH: apps/api/documentacion/integracion-armas-bpch/03_Coleccion_Postman_LIMS_IDIC_integracion_armas.json
 * (apps/api/documentacion/integracion-armas-bpch). Datos PRUEBA; variables vacías.
 *
 *   node scripts/postman/generar-coleccion-armas.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const SALIDA = path.resolve(__dirname, "..", "..", "apps", "api", "documentacion", "integracion-armas-bpch", "03_Coleccion_Postman_LIMS_IDIC_integracion_armas.json");
// PDF mínimo PRUEBA (acta de cierre de ejemplo).
const PDF_PRUEBA = Buffer.from("%PDF-1.4\n% Acta PRUEBA\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");

const FIRMA = [
  "// Firma del webhook: X-BPCH-Signature = sha256=<HMAC-SHA256 del cuerpo EXACTO con {{hmac_secret}}>.",
  "// X-Event-ID: un UUID nuevo por evento; en un reintento se repite el MISMO (ver «Reenvío»).",
  "const cuerpo = pm.variables.replaceIn(pm.request.body.raw);",
  "const secreto = pm.variables.get('hmac_secret') || '';",
  "if (!secreto) { console.warn('Falta la variable hmac_secret: el LIMS responderá 401.'); }",
  "const firma = 'sha256=' + CryptoJS.HmacSHA256(cuerpo, secreto).toString(CryptoJS.enc.Hex);",
  "const eventoId = pm.variables.replaceIn('{{$guid}}');",
  "pm.collectionVariables.set('ultimo_evento_id', eventoId);",
  "pm.collectionVariables.set('ultimo_cuerpo', cuerpo);",
  "pm.request.body.raw = cuerpo;",
  "pm.request.headers.upsert({ key: 'X-BPCH-Signature', value: firma });",
  "pm.request.headers.upsert({ key: 'X-Event-ID', value: eventoId });",
];
const FIRMA_REENVIO = [
  "// Reenvío: MISMO cuerpo y MISMO X-Event-ID del último evento enviado. El LIMS responde 200 con duplicado: true.",
  "const cuerpo = pm.collectionVariables.get('ultimo_cuerpo') || pm.variables.replaceIn(pm.request.body.raw);",
  "const secreto = pm.variables.get('hmac_secret') || '';",
  "pm.request.body.raw = cuerpo;",
  "pm.request.headers.upsert({ key: 'X-BPCH-Signature', value: 'sha256=' + CryptoJS.HmacSHA256(cuerpo, secreto).toString(CryptoJS.enc.Hex) });",
  "pm.request.headers.upsert({ key: 'X-Event-ID', value: pm.collectionVariables.get('ultimo_evento_id') || pm.variables.replaceIn('{{$guid}}') });",
];
const PRUEBA_200 = ["pm.test('Acuse 2xx', () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));"];
const PRUEBA_DUP = [
  "pm.test('Acuse 200', () => pm.response.to.have.status(200));",
  "pm.test('duplicado: true', () => pm.expect(pm.response.json().duplicado).to.eql(true));",
];

const json = (o) => JSON.stringify(o, null, 2);
const ahora = () => "{{$isoTimestamp}}";

function webhook(nombre, descripcion, cuerpo, { reenvio = false } = {}) {
  return {
    name: nombre,
    event: [
      { listen: "prerequest", script: { type: "text/javascript", exec: reenvio ? FIRMA_REENVIO : FIRMA } },
      { listen: "test", script: { type: "text/javascript", exec: reenvio ? PRUEBA_DUP : PRUEBA_200 } },
    ],
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: { mode: "raw", raw: json(cuerpo), options: { raw: { language: "json" } } },
      url: { raw: "{{lims_url}}/api/v1/integracion/bpch/webhook", host: ["{{lims_url}}"], path: ["api", "v1", "integracion", "bpch", "webhook"] },
      description: descripcion,
    },
  };
}

const coleccion = {
  info: {
    name: "LIMS IDIC · Integración software de armas BPCH (entrada al LIMS)",
    description:
      "Rutas que el software de armas del BPCH llama en el LIMS. Guía: apps/api/documentacion/integracion-armas-bpch.\n\n" +
      "Variables (vacías a propósito; se completan por canal seguro, nunca en el repositorio):\n" +
      "- lims_url: dirección del LIMS en la red del IDIC (sin barra final).\n" +
      "- token: token de integración del LIMS (opción 1, POST directo).\n" +
      "- hmac_secret: clave compartida de la firma del webhook (opción 2).\n" +
      "- token_adjunto: parte final del enlace firmado de descarga (solo si modo_adjunto = url).\n\n" +
      "Acuse: el LIMS responde en menos de 2 s. Si no hay 2xx en 10 s, reintentar con espera 1 min, 5 min, 15 min, 1 h y luego cada 6 h hasta 48 h, SIEMPRE con el mismo X-Event-ID.\n" +
      "Datos de ejemplo: PRUEBA (RUT y series ficticios).",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "lims_url", value: "" },
    { key: "token", value: "" },
    { key: "hmac_secret", value: "" },
    { key: "token_adjunto", value: "" },
    { key: "ot", value: "OT-PRUEBA-0001" },
    { key: "ultimo_evento_id", value: "" },
    { key: "ultimo_cuerpo", value: "" },
  ],
  item: [
    {
      name: "Opción 2 · Webhook firmado (HMAC)",
      description: "POST /api/v1/integracion/bpch/webhook sin sesión. El script previo calcula X-BPCH-Signature y X-Event-ID.",
      item: [
        webhook("Estado 6 · Visado Delegación", "Avance normal.", { ot: "{{ot}}", estado: 6, estado_descripcion: "Visado Delegación", usuario_rut: "11111111", fecha_cambio: ahora(), motivo: null }),
        webhook("Estado 7 · Visado Internación", "Solo OT de empresa (tipo 2).", { ot: "{{ot}}", estado: 7, estado_descripcion: "Visado Internación", usuario_rut: "11111111", fecha_cambio: ahora(), motivo: null }),
        webhook(
          "Pendiente rechazado (código por confirmar)",
          "Devolución sin término (el código 9 es provisional: el BPCH define el suyo). El LIMS avisa a la D11 y a Comercial.",
          { ot: "{{ot}}", estado: 9, estado_descripcion: "Pendiente rechazado", usuario_rut: "11111111", fecha_cambio: ahora(), motivo: "Falta comprobante PRUEBA" },
        ),
        webhook("Estado 5 · En firma digital", "A la espera de la FEA con OTP en el BPCH.", { ot: "{{ot}}", estado: 5, estado_descripcion: "En firma digital", usuario_rut: "11111111", fecha_cambio: ahora() }),
        webhook(
          "Estado 2 · Firmada y en Comercial (con enlaces)",
          "Los certificados quedan en el BPCH: el LIMS guarda solo los enlaces (http/https a servidores permitidos) y los disparos.",
          {
            ot: "{{ot}}",
            estado: 2,
            estado_descripcion: "Firmada y en Comercial",
            usuario_rut: "11111111",
            fecha_cambio: ahora(),
            total_disparos: 6,
            url_ot: "https://armas.idic.local/ot/PRUEBA",
            certificados: [
              { numero_serie: "PRUEBA-SERIE-001", url: "https://armas.idic.local/certificados/PRUEBA-1", idFed: "FED-PRUEBA-1", total_disparos: 3 },
              { numero_serie: "PRUEBA-SERIE-002", url: "https://armas.idic.local/certificados/PRUEBA-2", idFed: "FED-PRUEBA-2", total_disparos: 3 },
            ],
          },
        ),
        webhook(
          "Certificado de rechazo (enlace)",
          "Un enlace tipo certificado_rechazo deja pendiente la notificación a la DGMN.",
          { ot: "{{ot}}", estado: 6, fecha_cambio: ahora(), enlaces: [{ tipo: "certificado_rechazo", numero_serie: "PRUEBA-SERIE-003", url: "https://armas.idic.local/certificados/PRUEBA-3" }] },
        ),
        webhook(
          "Estado 4 · Rechazado total",
          "Rechazo definitivo (terminal). Deja pendiente la notificación a la DGMN.",
          { ot: "{{ot}}", estado: 4, estado_descripcion: "Rechazado total", usuario_rut: "11111111", fecha_cambio: ahora(), motivo: "Arma no apta PRUEBA" },
        ),
        webhook(
          "Estado 8 · OT Finalizada (acta en base64)",
          "Acta en PDF dentro del mensaje (o documento_cierre.url para enviar solo el enlace).",
          {
            ot: "{{ot}}",
            estado: 8,
            estado_descripcion: "OT Finalizada",
            usuario_rut: "11111111",
            fecha_cambio: ahora(),
            total_certificados: 2,
            documento_cierre: { nombre: "Acta_Cierre_PRUEBA.pdf", tipo: "acta_finalizacion", descripcion: "Acta PRUEBA", base64: PDF_PRUEBA },
          },
        ),
        webhook("Reenvío con el mismo X-Event-ID", "Repite el último evento: el LIMS responde 200 con duplicado: true.", { ot: "{{ot}}", estado: 6 }, { reenvio: true }),
      ],
    },
    {
      name: "Opción 1 · POST directo con token",
      item: [
        {
          name: "Cambio de estado (Bearer)",
          event: [{ listen: "test", script: { type: "text/javascript", exec: PRUEBA_200 } }],
          request: {
            method: "POST",
            auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
            header: [
              { key: "Content-Type", value: "application/json" },
              { key: "X-Event-ID", value: "{{$guid}}", description: "Opcional; recomendado para los reintentos." },
            ],
            body: {
              mode: "raw",
              raw: json({ ot: "{{ot}}", nuevo_estado: 6, estado_descripcion: "Visado Delegación", fecha_actualizacion: ahora(), operador_rut: "11111111", motivo: null }),
              options: { raw: { language: "json" } },
            },
            url: { raw: "{{lims_url}}/api/v1/integracion/bpch/estado", host: ["{{lims_url}}"], path: ["api", "v1", "integracion", "bpch", "estado"] },
            description: "Token de integración del LIMS con un rol que tenga integracion.armas.estado.",
          },
        },
      ],
    },
    {
      name: "Adjuntos (solo modo_adjunto = url)",
      item: [
        {
          name: "Descargar la resolución por enlace firmado",
          request: {
            method: "GET",
            url: {
              raw: "{{lims_url}}/api/v1/integracion/bpch/adjuntos/{{token_adjunto}}",
              host: ["{{lims_url}}"],
              path: ["api", "v1", "integracion", "bpch", "adjuntos", "{{token_adjunto}}"],
            },
            description: "Por defecto la resolución viaja DENTRO del mensaje (documentos_adjuntos[].contenido_base64). Este enlace solo existe con modo_adjunto = url; vence según vigencia_enlace_horas.",
          },
        },
      ],
    },
  ],
};

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify(coleccion, null, 2) + "\n");
console.log(SALIDA);
