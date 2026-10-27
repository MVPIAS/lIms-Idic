/**
 * Lo que pasa alrededor de la emisión y la entrega del certificado (entrega R4, T28):
 * actualizar el equipo del laboratorio dueño (P8.4), publicar el resultado del LNF en el
 * maestro de patrones (P8.5), avisar al solicitante y enviar el certificado por correo
 * (P7.2, P8.1). SQL crudo con parámetros (las tablas met_* no están en Prisma); las reglas
 * puras están en ficha.reglas.ts.
 */
import { createHash } from "node:crypto";
import type { Sello } from "../plantilla-render/plantilla-defecto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import type { ConsultaCruda } from "./metrologia-ot.datos";
import { actualizacionEquipo, actualizacionPatronLnf, configFicha, destinatariosAviso, type ConfigFicha, type PatronMaestro } from "./ficha.reglas";
import { urlVerificacionBase } from "../common/url-verificacion";
import { ZONA_CHILE, diaInstanteChile, diaChile as diaCalendario } from "../common/fecha-chile";

/** Cliente con escritura (PrismaService, PrismaClient o la transacción `tx`). */
export interface ConsultaEscritura extends ConsultaCruda {
  $executeRawUnsafe(query: string, ...values: any[]): Promise<number>;
}

const diaChile = (d: Date | string) => diaInstanteChile(d) ?? "";
const fechaIso = (d: any): string => (d instanceof Date ? diaCalendario(d) ?? "" : String(d ?? "").slice(0, 10));
/** AAAA-MM-DD → DD-MM-AAAA para los textos de la bitácora. */
const fechaCl = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const URL_VERIFICACION = () => urlVerificacionBase();

/** Parámetros de la operación de la ficha (Administración › Parámetros del sistema, categoría metrologia_ficha). */
export async function leerConfigFicha(db: ConsultaCruda, tenantId: string): Promise<ConfigFicha> {
  const filas = await db.$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
    `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'metrologia_ficha'`, tenantId);
  return configFicha(filas);
}

async function evento(db: ConsultaEscritura, calId: string, accion: string, comentario: string, usuarioId: string | null) {
  await db.$executeRawUnsafe(
    // clock_timestamp(): dentro de la transacción de la emisión, el evento queda después de «Firmada y emitida».
    `INSERT INTO met_calibracion_evento (calibracion_id, accion, estado_desde, estado_hasta, usuario_id, comentario, created_at)
     SELECT id, $2, estado, estado, $3::uuid, $4, clock_timestamp() FROM met_calibracion WHERE id = $1::uuid`,
    calId, accion, usuarioId, comentario.slice(0, 1000));
}

/* ------------------------------------------- equipo del laboratorio dueño --- */
/**
 * OT interna (P8.4): el ítem enlazado a un equipo del maestro de Equipos actualiza su última
 * calibración, la próxima (emisión + intervalo) y deja la calibración en su historial con el
 * número del certificado (una vez por certificado). Devuelve lo hecho, o null si no aplica.
 */
export async function actualizarEquipoDueno(db: ConsultaEscritura, calId: string, usuarioId: string | null, momento: "emitir" | "entregar"): Promise<string | null> {
  const f = await db.$queryRawUnsafe<any[]>(
    `SELECT c.tenant_id, c.numero_certificado, c.fecha_calibracion, c.emitido_at, c.intervalo_meses, c.estado, i.equipo_id, e.codigo AS equipo,
            pr.norma, un.codigo AS laboratorio, o.codigo AS ot
       FROM met_calibracion c
       JOIN met_ot_instrumento i ON i.id = c.ot_instrumento_id
       JOIN equipo e ON e.id = i.equipo_id AND e.deleted_at IS NULL
       JOIN met_proceso pr ON pr.id = c.proceso_id
       LEFT JOIN unidad un ON un.id = c.unidad_id
       LEFT JOIN orden_trabajo o ON o.id = c.ot_id
      WHERE c.id = $1::uuid`, calId);
  const c = f[0];
  if (!c || c.estado !== "emitida" || !c.numero_certificado) return null;
  const a = actualizacionEquipo({
    numero: c.numero_certificado, fechaCalibracion: fechaIso(c.fecha_calibracion), fechaEmision: diaChile(c.emitido_at ?? new Date()),
    intervaloMeses: c.intervalo_meses == null ? null : Number(c.intervalo_meses),
  });
  await db.$executeRawUnsafe(
    `UPDATE equipo SET fecha_ultima_calibracion = $2::date, proxima_calibracion = COALESCE($3::date, proxima_calibracion), updated_at = now() WHERE id = $1::uuid`,
    c.equipo_id, a.ultima, a.proxima);
  await db.$executeRawUnsafe(
    `INSERT INTO calibracion (tenant_id, equipo_id, fecha, ejecutada_por, norma_calibracion, resultado, observaciones, proxima_fecha, certificado_ref, registrada_por)
     SELECT $1::uuid, $2::uuid, $3::date, $4, $5, NULL, $6, $7::date, $8, $9::uuid
      WHERE NOT EXISTS (SELECT 1 FROM calibracion WHERE tenant_id = $1::uuid AND certificado_ref = $8)`,
    c.tenant_id, c.equipo_id, a.ultima, `Laboratorio de Metrología del IDIC (${c.laboratorio ?? "SAM"})`.slice(0, 200), (c.norma ?? null)?.slice(0, 120) ?? null,
    `Certificado de calibración ${a.certificado} (OT ${c.ot ?? "—"}), registrado por el LIMS al ${momento === "emitir" ? "emitirse" : "entregarse"}. ` +
      "El Laboratorio de Metrología no evalúa conformidad: la aptitud del equipo la decide su laboratorio.",
    a.proxima, a.certificado, usuarioId);
  const txt = `Equipo ${c.equipo} actualizado: última calibración ${fechaCl(a.ultima)}${a.proxima ? `, próxima ${fechaCl(a.proxima)}` : " (sin intervalo: la próxima no cambia)"}, certificado ${a.certificado}.`;
  await evento(db, calId, "EQUIPO_ACTUALIZADO", txt, usuarioId);
  return txt;
}

/* ------------------------------------------------ LNF → maestro de patrones --- */
/**
 * P8.5: al emitir un certificado del LNF de un transductor que figura en el maestro de
 * patrones (misma serie, magnitud fuerza), se publican clase, coeficientes, deriva, U y
 * vencimiento, con el antes y el después en met_patron_actualizacion.
 */
export async function actualizarPatronLnf(db: ConsultaEscritura, calId: string, usuarioId: string | null): Promise<string | null> {
  const f = await db.$queryRawUnsafe<any[]>(
    `SELECT c.tenant_id, c.motor, c.resultado, c.numero_certificado, c.fecha_calibracion, c.intervalo_meses, c.estado,
            NULLIF(trim(c.instrumento->>'serie'), '') AS serie
       FROM met_calibracion c WHERE c.id = $1::uuid`, calId);
  const c = f[0];
  if (!c || c.motor !== "LCPNF-IT01" || c.estado !== "emitida" || !c.serie || !c.resultado?.coef) return null;
  if (/^(s\/s|no tiene|--|-)$/i.test(c.serie)) return null;
  const pats = await db.$queryRawUnsafe<any[]>(
    `SELECT p.id, p.codigo, p.clase, p.coeficientes, p.deriva, p.u_expandida, p.n_certificado, to_char(p.ultima_calibracion, 'YYYY-MM-DD') AS ultima_calibracion,
            to_char(p.vence, 'YYYY-MM-DD') AS vence, p.intervalo_meses, p.emisor
       FROM met_patron p JOIN met_magnitud m ON m.id = p.magnitud_id
      WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL AND COALESCE(p.tipo, 'patron') <> 'auxiliar' AND m.codigo = 'fuerza'
        AND lower(trim(p.serie)) = lower($2)
      FOR UPDATE OF p`, c.tenant_id, c.serie);
  if (!pats.length) return null;
  if (pats.length > 1) {
    const txt = `El maestro de patrones tiene ${pats.length} equipos con la serie ${c.serie} (${pats.map((p) => p.codigo).join(", ")}): no se actualizó ninguno.`;
    await evento(db, calId, "PATRON_NO_ACTUALIZADO", txt, usuarioId);
    return txt;
  }
  const p = pats[0];
  const antes: PatronMaestro = {
    clase: p.clase, coeficientes: p.coeficientes, deriva: p.deriva == null ? null : Number(p.deriva), u_expandida: p.u_expandida == null ? null : Number(p.u_expandida),
    n_certificado: p.n_certificado, ultima_calibracion: p.ultima_calibracion, vence: p.vence, intervalo_meses: p.intervalo_meses, emisor: p.emisor,
  };
  const a = actualizacionPatronLnf(c.resultado, {
    numero: c.numero_certificado, fechaCalibracion: fechaIso(c.fecha_calibracion), intervaloMeses: c.intervalo_meses == null ? null : Number(c.intervalo_meses),
  }, antes);
  const d = a.despues;
  await db.$executeRawUnsafe(
    `UPDATE met_patron SET clase = $2, coeficientes = $3::jsonb, deriva = $4, u_expandida = $5, n_certificado = $6, ultima_calibracion = $7::date,
            vence = $8::date, intervalo_meses = $9, emisor = $10, actualizado_por_cal = $11::uuid
      WHERE id = $1::uuid`,
    p.id, d.clase, JSON.stringify(d.coeficientes), d.deriva, d.u_expandida, d.n_certificado, d.ultima_calibracion, d.vence, d.intervalo_meses, d.emisor, calId);
  await db.$executeRawUnsafe(
    `INSERT INTO met_patron_actualizacion (tenant_id, patron_id, calibracion_id, antes, despues, usuario_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::jsonb, $6::uuid) ON CONFLICT (patron_id, calibracion_id) DO NOTHING`,
    c.tenant_id, p.id, calId, JSON.stringify(antes), JSON.stringify(d), usuarioId);
  const txt = `Maestro de patrones: ${p.codigo} toma ${d.clase}, t/u/v del certificado ${c.numero_certificado}` +
    `${a.deriva != null ? `, deriva ${a.deriva.toLocaleString("es-CL", { maximumFractionDigits: 4 })} %` : ""}, U ${Number(d.u_expandida).toLocaleString("es-CL", { maximumFractionDigits: 4 })} % y vence ${fechaCl(d.vence)}.`;
  await evento(db, calId, "PATRON_ACTUALIZADO", txt, usuarioId);
  return txt;
}

/* -------------------------------------------------------- correo y PDF --- */
/** PDF del certificado emitido: el cuerpo sellado (el del SHA-256) con su sello. */
export async function pdfEmitido(cal: { numero_certificado: string; codigo_verificacion: string | null; documento_html: string; certificado_hash: string | null; emitido_at: Date | string | null }) {
  const sello: Sello = {
    numero: cal.numero_certificado,
    codigoVerificacion: cal.codigo_verificacion ?? "SIN EMITIR",
    hash: cal.certificado_hash ?? createHash("sha256").update(cal.documento_html, "utf8").digest("hex"),
    fecha: new Date(cal.emitido_at ?? Date.now()).toLocaleDateString("es-CL", { timeZone: ZONA_CHILE }),
    urlVerificacion: cal.codigo_verificacion ? `${URL_VERIFICACION()}/${cal.codigo_verificacion}` : URL_VERIFICACION(),
    borrador: false,
  };
  const buffer = await generarPdf(cal.documento_html, sello, `Certificado de Calibración ${cal.numero_certificado}`);
  return { buffer, nombre: `${cal.numero_certificado.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`, sello };
}

/** Destinatarios del aviso al emitir (OT interna → jefe del laboratorio dueño; externa → contacto principal o cliente). */
export async function destinatariosDe(db: ConsultaCruda, calId: string) {
  const f = await db.$queryRawUnsafe<any[]>(
    `SELECT o.origen_trabajo, o.lab_solicitante_cc_id, cl.email::text AS cliente_email,
            (SELECT ct.email FROM contacto ct WHERE ct.cliente_id = o.cliente_id AND ct.deleted_at IS NULL AND COALESCE(ct.activo, TRUE)
                AND (ct.es_principal OR ct.principal) AND NULLIF(ct.email, '') IS NOT NULL ORDER BY ct.created_at LIMIT 1) AS contacto_email,
            ARRAY(SELECT u.email::text FROM centro_costo cc JOIN unidad_jefe uj ON uj.unidad_id = cc.unidad_id AND uj.rol = 'titular'
                    JOIN usuario u ON u.id = uj.usuario_id AND u.deleted_at IS NULL
                   WHERE cc.id = o.lab_solicitante_cc_id) AS jefes
       FROM met_calibracion c JOIN orden_trabajo o ON o.id = c.ot_id
       LEFT JOIN cliente cl ON cl.id = o.cliente_id
      WHERE c.id = $1::uuid`, calId);
  const x = f[0];
  if (!x) return { destinatarios: [] as string[], motivo: "la calibración no está ligada a una OT" };
  const interna = ["OT_INTERNA", "INTERLABORATORIO"].includes(String(x.origen_trabajo ?? "").toUpperCase()) || !!x.lab_solicitante_cc_id;
  return destinatariosAviso({ interna, jefesDueno: x.jefes ?? [], contacto: x.contacto_email ?? null, cliente: x.cliente_email ?? null });
}

export interface ServicioCorreo {
  sendMail(tenantId: string, msg: { to: string | string[]; subject: string; html: string; attachments?: any[] }): Promise<{ ok: true; messageId?: string }>;
}

const escHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/**
 * Error del servidor de correo en palabras del usuario, sin punto final (el que
 * lo cita pone el suyo: antes salía «…este tenant..»; B-081).
 */
export function textoErrorCorreo(error: string | null | undefined): string {
  return String(error ?? "error del servidor de correo")
    .replace(/\s*para este tenant\.?/i, " en esta instalación (Administración › Correo)")
    .trim()
    .replace(/[.\s]+$/, "");
}

/**
 * Envía el certificado emitido (PDF adjunto) y lo deja en la bitácora de Mensajería
 * (correo_enviado) y en la de la calibración. Si el SMTP no está operativo responde
 * { ok:false } sin lanzar: la emisión o la entrega no se caen por el correo.
 */
export async function enviarCertificado(
  db: ConsultaEscritura, mail: ServicioCorreo, calId: string, destinatarios: string[], o: { mensaje?: string | null; usuarioId: string | null; motivo: "aviso" | "envio" },
): Promise<{ ok: boolean; error: string | null; destinatarios: string[] }> {
  const f = await db.$queryRawUnsafe<any[]>(
    `SELECT c.tenant_id, c.ot_id, c.numero_certificado, c.codigo_verificacion, c.documento_html, c.certificado_hash, c.emitido_at, c.estado,
            o.codigo AS ot, cl.razon_social AS cliente, pr.nombre AS proceso
       FROM met_calibracion c LEFT JOIN orden_trabajo o ON o.id = c.ot_id LEFT JOIN cliente cl ON cl.id = o.cliente_id
       JOIN met_proceso pr ON pr.id = c.proceso_id
      WHERE c.id = $1::uuid`, calId);
  const c = f[0];
  if (!c || c.estado !== "emitida" || !c.documento_html) return { ok: false, error: "Solo se envía un certificado emitido.", destinatarios };
  const { buffer, nombre } = await pdfEmitido(c);
  const asunto = `IDIC · Certificado de calibración ${c.numero_certificado}${c.ot ? ` · OT ${c.ot}` : ""}`.slice(0, 300);
  const html =
    `<p>Estimado(a) ${escHtml(c.cliente ?? "cliente")}:</p>` +
    `<p>Adjuntamos el certificado de calibración <b>${escHtml(c.numero_certificado)}</b> (${escHtml(c.proceso)})` +
    `${c.ot ? `, correspondiente a la orden de trabajo <b>${escHtml(c.ot)}</b>` : ""}.</p>` +
    (o.mensaje?.trim() ? `<p>${escHtml(o.mensaje.trim())}</p>` : "") +
    `<p>Puede verificar su autenticidad con el código <b>${escHtml(c.codigo_verificacion ?? "")}</b> en ${escHtml(URL_VERIFICACION())}.</p>` +
    `<p>Instituto de Investigaciones y Control del Ejército de Chile · Laboratorio de Metrología</p>`;
  let ok = true, error: string | null = null, messageId: string | null = null;
  try {
    const r = await mail.sendMail(c.tenant_id, { to: destinatarios, subject: asunto, html, attachments: [{ filename: nombre, content: buffer, contentType: "application/pdf" }] });
    messageId = r.messageId ?? null;
  } catch (e: any) {
    ok = false;
    error = String(e?.response ?? e?.message ?? "Error al enviar").slice(0, 300);
  }
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO correo_enviado (tenant_id, tipo, destinatarios, asunto, cuerpo_resumen, plantilla, ot_id, estado, error, message_id, enviado_por)
       VALUES ($1::uuid, 'certificado', $2, $3, $4, NULL, $5::uuid, $6, $7, $8, $9::uuid)`,
      c.tenant_id, destinatarios.join(", "), asunto, `${o.motivo === "aviso" ? "Aviso de emisión" : "Envío"} del certificado ${c.numero_certificado} (PDF adjunto).`,
      c.ot_id, ok ? "enviado" : "error", error, messageId, o.usuarioId);
  } catch {
    /* sin bitácora de correo en esta base */
  }
  await evento(db, calId, o.motivo === "aviso" ? "NOTIFICADA" : "CORREO",
    ok ? `Certificado enviado por correo a ${destinatarios.join(", ")}.` : `Envío fallido: no se pudo enviar el correo a ${destinatarios.join(", ")}: ${textoErrorCorreo(error)}.`, o.usuarioId);
  return { ok, error, destinatarios };
}

/** Ítems no calibrables de la OT con su informe técnico emitido o su servicio externo validado. */
export async function noAptoResueltos(db: ConsultaCruda, otId: string): Promise<Set<string>> {
  const f = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT ot_instrumento_id AS id FROM met_informe_tecnico WHERE ot_id = $1::uuid AND estado = 'emitido'
     UNION SELECT ot_instrumento_id FROM met_servicio_externo WHERE ot_id = $1::uuid AND estado = 'validado'`, otId);
  return new Set(f.map((x) => x.id));
}
