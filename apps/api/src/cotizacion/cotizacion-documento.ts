/**
 * Documento de la cotización (DCO-PG01-P01-IT02-FORM04): cuerpo HTML, vista
 * previa con firmas y PDF. Lo usan el panel de la cotización (GET
 * /cotizaciones/:id/pdf y /html, «Enviar al cliente») y Mensajería.
 *
 * El cuerpo es el mismo subconjunto de HTML que usan los informes (membrete,
 * h1/h2, table.meta, table.rep), así que hereda su maquetado y su PDF/A. Las
 * firmas del circuito (1 Elabora · Ejecutivo, 2 Firma · Jefe DCO, matriz
 * COTIZACION) van fuera del cuerpo sellado. Mientras no está firmada, el
 * documento lleva el aviso «en proceso de firma: no tiene validez».
 * Nunca imprime las observaciones internas ni el costeo (SVT3).
 */
import { createHash } from "node:crypto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { documentoCompleto, type FirmaEstampada, type Sello } from "../plantilla-render/plantilla-defecto";

/** Escapa texto para incrustarlo en HTML. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Peso chileno sin decimales, miles con punto (convención es-CL). */
export function clp(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "$ 0";
  return "$ " + Math.round(n).toLocaleString("es-CL");
}

/** dd-mm-aaaa. */
export function fechaCorta(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** dd-mm-aaaa hh:mm en hora de Chile. */
export function fechaHoraCl(d: Date | string): string {
  const x = new Date(d);
  const f = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(x);
  const v = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return `${v("day")}-${v("month")}-${v("year")} ${v("hour")}:${v("minute")}`;
}

/**
 * Cuerpo HTML de la cotización que consume el generador de PDF (pdf.renderer).
 * Es el mismo subconjunto de HTML (membrete, h1/h2, table.meta, table.rep) que
 * usan los informes, así que hereda su maquetado sin código nuevo de layout.
 */
export function cuerpoCotizacionHtml(cot: any): string {
  const razon = esc(cot.cliente?.razonSocial ?? cot.cliente?.razon_social ?? "—");
  const rut = esc(cot.cliente?.rut ?? "—");
  const lineas: any[] = Array.isArray(cot.lineas) ? cot.lineas : [];
  // Comercial R1: moneda CLP o USD (dólar congelado al emitir).
  const usd = cot.moneda === "USD";
  const monto = (v: unknown) => (usd ? usdFmt(v) : clp(v));
  const filas = lineas
    .map(
      (l, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(l.descripcion ?? l.categoria ?? l.tipo ?? "—")}</td>
        <td class="num">${esc(l.cantidad ?? 1)}</td>
        <td class="num">${monto(l.precioUnitario)}</td>
        <td class="num">${monto(l.subtotal)}</td>
      </tr>`,
    )
    .join("");
  const validez = cot.validaHasta
    ? `hasta el ${fechaCorta(fechaUtc(cot.validaHasta))}`
    : `${esc(cot.validezDias ?? 30)} días`;
  // Texto con saltos de línea → párrafos (escapado).
  const parrafos = (t: unknown) =>
    String(t ?? "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => `<p>${esc(x)}</p>`)
      .join("");

  // OJO: `observacionesInternas` NO se imprime nunca (SVT3). Solo van al PDF
  // la referencia, la descripción técnica y las condiciones adicionales.
  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Cotización comercial</span>
  </div>
  <div class="doc">
    <b>${esc(cot.codigo)}</b>
    <span>Cotización</span>
  </div>
</div>

<h1>COTIZACIÓN</h1>

<table class="meta">
  <tr><th>Cliente</th><td>${razon}</td><th>RUT</th><td>${rut}</td></tr>
  <tr><th>Código</th><td>${esc(cot.codigo)}</td><th>Fecha</th><td>${fechaCorta(cot.fechaEmision ? fechaUtc(cot.fechaEmision) : new Date(cot.createdAt ?? Date.now()))}</td></tr>
  <tr><th>Forma de pago</th><td>${esc(etiquetaFormaPago(cot.formaPago))}</td><th>Validez</th><td>${validez}</td></tr>
  ${cot.referencia ? `<tr><th>Referencia</th><td colspan="3">${esc(cot.referencia)}</td></tr>` : ""}
  ${cot.plazoEntregaDias ? `<tr><th>Plazo de entrega</th><td colspan="3">${esc(cot.plazoEntregaDias)} días corridos desde la recepción de las muestras o ítems</td></tr>` : ""}
  ${usd ? `<tr><th>Moneda</th><td>US$</td><th>Dólar del día</th><td>${clp(cot.dolarValor)}${cot.dolarFecha ? ` (${fechaCorta(fechaUtc(cot.dolarFecha))})` : ""}</td></tr>` : ""}
</table>

${cot.descripcionTecnica ? `<h2>Descripción técnica y alcance</h2>${parrafos(cot.descripcionTecnica)}` : ""}

<h2>Detalle</h2>
<table class="rep">
  <thead>
    <tr><th>#</th><th>Ensayo / descripción</th><th class="num">Cantidad</th><th class="num">P. unitario</th><th class="num">Subtotal</th></tr>
  </thead>
  <tbody>
    ${filas || '<tr><td class="vacio" colspan="5">Sin líneas de detalle.</td></tr>'}
  </tbody>
</table>

<h2>Totales</h2>
<table class="meta">
  <tr><th>Subtotal</th><td>${monto(cot.subtotal)}</td><th>Neto</th><td>${monto(cot.neto)}</td></tr>
  <tr><th>IVA</th><td>${monto(cot.ivaMonto)}</td><th>TOTAL</th><td>${monto(cot.total)}</td></tr>
</table>

${cot.condicionesAdicionales ? `<h2>Condiciones adicionales</h2>${parrafos(cot.condicionesAdicionales)}` : ""}

<p class="nota">Documento generado por el sistema LIMS IDIC. Los valores están expresados en ${usd ? "dólares estadounidenses (US$)" : "pesos chilenos (CLP)"}.</p>`;
}

/** US$ con 2 decimales (convención es-CL). */
export function usdFmt(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "US$ 0,00";
  return "US$ " + n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Columnas DATE de Prisma llegan a medianoche UTC: se pasan a fecha local equivalente. */
export function fechaUtc(d: Date | string): Date {
  const x = new Date(d);
  return new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

/** Etiqueta de las formas de pago R1 (los códigos históricos se muestran tal cual). */
export function etiquetaFormaPago(codigo?: string | null): string {
  const m: Record<string, string> = { contado_30: "Contado 30 días", adelantado: "Por adelantado" };
  return codigo ? m[codigo] ?? codigo : "—";
}

/* --------------------------------------------------------- documento firmado --- */

export interface FirmasCotizacion {
  /** Ejecutivo que elabora (paso 1 de la matriz COTIZACION). */
  elabora: { nombre: string | null; fecha: Date | string | null };
  /** Jefe DCO que firma (paso 2). Si no ha firmado, `pendientes` = responsables de la matriz. */
  firma: { nombre: string | null; fecha: Date | string | null } | null;
  pendientes: string[];
}

/** ¿El documento es oficial? Firmado por el Jefe DCO, o histórico (anterior al circuito). */
export const cotizacionOficial = (cot: { circuito?: string | null; firmaEstado?: string | null }) =>
  cot.circuito !== "r1" || cot.firmaEstado === "firmada";

/** Firmas estampadas en la presentación (fuera del cuerpo sellado). */
export function firmasEstampadas(f: FirmasCotizacion): FirmaEstampada[] {
  return [
    {
      accion: "ELABORA",
      rol: "Ejecutivo de Ventas",
      unidad: "DCO",
      nombre: f.elabora.nombre ?? "Ejecutivo de Ventas",
      fecha: f.elabora.fecha ? fechaHoraCl(f.elabora.fecha) : null,
      pendiente: false,
    },
    f.firma
      ? { accion: "FIRMA", rol: "Jefe del Departamento Comercial", unidad: "DCO", nombre: f.firma.nombre, fecha: f.firma.fecha ? fechaHoraCl(f.firma.fecha) : null, pendiente: false }
      : { accion: "FIRMA", rol: "Jefe del Departamento Comercial", unidad: "DCO", nombre: f.pendientes.join(" · ") || "Jefe DCO", pendiente: true },
  ];
}

/** Cuerpo, sello y título del documento de la cotización. */
export function documentoCotizacion(cot: any, firmas: FirmasCotizacion) {
  const cuerpo = cuerpoCotizacionHtml(cot);
  const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
  const oficial = cotizacionOficial(cot);
  const fecha = cot.firmadaAt ?? cot.fechaEmision ?? cot.createdAt ?? new Date();
  const sello: Sello = {
    numero: cot.codigo,
    codigoVerificacion: cot.codigo,
    hash,
    fecha: fechaCorta(new Date(fecha)),
    urlVerificacion: "el Departamento Comercial del IDIC",
    borrador: false,
    estadoDocumento: oficial ? undefined : "en_firma",
    firmas: cot.circuito === "r1" ? firmasEstampadas(firmas) : undefined,
  };
  return { cuerpo, sello, titulo: `Cotización ${cot.codigo}` };
}

/** Vista previa HTML completa (la misma que el PDF). */
export function htmlCotizacion(cot: any, firmas: FirmasCotizacion): string {
  const d = documentoCotizacion(cot, firmas);
  return documentoCompleto(d.cuerpo, d.sello, d.titulo);
}

/** PDF/A de la cotización. */
export async function pdfCotizacion(cot: any, firmas: FirmasCotizacion): Promise<Buffer> {
  const d = documentoCotizacion(cot, firmas);
  return generarPdf(d.cuerpo, d.sello, d.titulo);
}

/** Nombre de fichero seguro para el PDF. */
export const nombrePdfCotizacion = (codigo: string) => `Cotizacion-${String(codigo).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;

/**
 * Estado de firma y nombres de la cotización leídos de la BD (columnas del
 * circuito, fuera del modelo Prisma). `db` = PrismaService o PrismaClient.
 */
export async function datosFirmaCotizacion(db: any, cotizacionId: string): Promise<{
  circuito: string | null;
  firmaEstado: string | null;
  firmadaAt: Date | null;
  firmas: FirmasCotizacion;
}> {
  const f: any[] = await db.$queryRawUnsafe(
    `SELECT c.circuito, c.firma_estado AS "firmaEstado", c.firmada_at AS "firmadaAt", c.created_at AS "creadaAt",
            e.nombre_completo AS "ejecutivo", fp.nombre_completo AS "firmante"
       FROM cotizacion c
       LEFT JOIN usuario e  ON e.id = c.ejecutivo_id
       LEFT JOIN usuario fp ON fp.id = c.firmada_por
      WHERE c.id = $1::uuid`,
    cotizacionId,
  );
  const r = f[0] ?? {};
  return {
    circuito: r.circuito ?? null,
    firmaEstado: r.firmaEstado ?? null,
    firmadaAt: r.firmadaAt ?? null,
    firmas: {
      elabora: { nombre: r.ejecutivo ?? null, fecha: r.creadaAt ?? null },
      firma: r.firmaEstado === "firmada" ? { nombre: r.firmante ?? null, fecha: r.firmadaAt ?? null } : null,
      pendientes: [],
    },
  };
}
