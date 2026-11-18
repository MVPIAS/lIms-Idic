/**
 * Documentos de la tasa de internación 1,5 % (IDIC, cuarto envío 17-11-2026,
 * COM-03) · reglas PURAS (sin BD), probadas en documentos-tasa.spec.ts.
 *
 *  · COMUNICACIÓN BREVE (CB) del Departamento Comercial: «Cálculo de tasa 1,5 %
 *    para efectos de facturación». Nº de control DTCG = Nº de la OT (como en el
 *    ejemplo real). Desglose del cálculo, facturas y Declaración de Ingreso,
 *    certificados de control de la resolución y reparto por centro de costo.
 *    «Copia Depto. Comercial».
 *  · CARTA AL CLIENTE: certificados disponibles para retiro, formas de pago y
 *    plazo de retiro. Sus textos se editan en Administración › Parámetros del
 *    sistema › «Carta al cliente de la tasa 1,5 %» (categoría tasa_carta): la
 *    cuenta bancaria, el correo y los teléfonos NO están en el código; los
 *    completa el IDIC en esos párrafos.
 *
 * Mismo subconjunto de HTML que el documento de cobro y la cotización
 * (membrete, h1/h2, table.meta, table.rep, .firmas) para heredar su maquetado y
 * su PDF/A. Todo dato pasa por `esc`. La firma (Jefe del Departamento
 * Comercial) se estampa a mano sobre el papel (el LIMS no aplica la firma del
 * Estado): el documento deja la línea y el cargo.
 */
import { createHash } from "node:crypto";
import { generarPdf } from "../../plantilla-render/pdf.renderer";
import type { Sello } from "../../plantilla-render/plantilla-defecto";
import { clp, esc, fechaCorta } from "../../cotizacion/cotizacion-documento";
import { porcentajeChile } from "../../common/numero-chile";
import type { PartidaReparto } from "../comun/reglas-bpch";

export interface CalculoTasaDoc {
  cifUsd: number;
  paridad: number;
  cifClp: number;
  adValoremUsd: number;
  adValoremClp: number;
  fleteNacional: number;
  agenciaTotalFactura: number;
  agenciaIvaInternacion: number;
  agenciaNeto: number;
  otrosGastosCliente: number;
  baseCalculo: number;
  pctAfecto: number;
  baseAfecta: number;
  tasaPct: number;
  tasa: number;
  dinNumero: string | null;
  facturaAgenciaNumero: string | null;
  facturaAgenciaEmisor: string | null;
  facturaTransporteNumero: string | null;
  facturaTransporteEmisor: string | null;
  fechaRecepcionSdbpch: string | null;
  agenciaAduana: string | null;
}

export interface DatosDocumentosTasa {
  /** Nº de la OT: es el Nº de control DTCG. */
  otCodigo: string;
  internacionNumero: string;
  resolucionNumero: string;
  resolucionFecha: string | null;
  /** Fecha del documento (AAAA-MM-DD, día de Chile). */
  fecha: string;
  cliente: { razonSocial: string; rut: string; direccion?: string | null; comuna?: string | null; telefono?: string | null; email?: string | null };
  /** Sucursal o unidad que atendió la internación (centro de costo «Sucursal»). */
  unidad: { codigo: string; nombre: string };
  calculo: CalculoTasaDoc;
  reparto: PartidaReparto[];
  certificados: { numero: string; condicion: string }[];
  textos: TextosCartaTasa;
}

export interface TextosCartaTasa {
  referencia: string;
  parrafos: string[];
  firmaCargo: string;
}

/** dd-mm-aaaa de una fecha de calendario (sin moverla de día). */
const dia = (f: string | null | undefined) => (f ? fechaCorta(new Date(`${String(f).slice(0, 10)}T00:00:00.000Z`)) : "—");
const usd = (v: number) => `US$ ${Number(v || 0).toLocaleString("es-CL", { maximumFractionDigits: 2 })}`;
const tc = (v: number) => Number(v || 0).toLocaleString("es-CL", { maximumFractionDigits: 4 });
const txt = (v: string | null | undefined) => (String(v ?? "").trim() ? esc(v) : "—");
/** «Fact. Nº 123 de Emisor» · solo lo que haya. */
const factura = (numero: string | null, emisor: string | null) =>
  [numero?.trim() ? `Fact. Nº ${numero.trim()}` : "", emisor?.trim() ? `de ${emisor.trim()}` : ""].filter(Boolean).join(" ") || "—";

/** Nombre del centro de costo de una partida: «Sucursal» lleva el nombre de la unidad que atendió. */
export function nombreCentro(p: PartidaReparto, unidad: { codigo: string; nombre: string }): string {
  return p.codigo === "sucursal" ? `Sucursal · ${unidad.nombre} (${unidad.codigo})` : p.etiqueta;
}

/** Texto del reparto para la observación de la factura (no cambia el total ni las líneas). */
export function textoReparto(reparto: PartidaReparto[], unidad: { codigo: string; nombre: string }): string {
  return `Cargar a centro de costo: ${reparto.map((p) => `${nombreCentro(p, unidad)} ${porcentajeChile(p.pct)} ${clp(p.monto)}`).join(" · ")}.`;
}

function membrete(titulo: string, otCodigo: string, subtitulo: string): string {
  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Banco de Pruebas de Chile &middot; ${esc(subtitulo)}</span>
  </div>
  <div class="doc">
    <b>${esc(otCodigo)}</b>
    <span>${esc(titulo)}</span>
  </div>
</div>`;
}

function firma(cargo: string): string {
  return `
<p>Saluda a Ud.</p>
<div class="firmas"><div class="firma"><span class="linea"></span>${esc(cargo)}</div></div>`;
}

/** Cuerpo de la Comunicación Breve del cálculo de la tasa. */
export function cuerpoComunicacionBreve(d: DatosDocumentosTasa): string {
  const c = d.calculo;
  const filas: string[] = [
    `<tr><td>A</td><td>CIF declarado</td><td>${esc(usd(c.cifUsd))} &times; tipo de cambio ${esc(tc(c.paridad))}</td><td class="num">${clp(c.cifClp)}</td></tr>`,
  ];
  if (c.adValoremClp) filas.push(`<tr><td>B</td><td>Ad valorem (código 223)</td><td>${esc(usd(c.adValoremUsd))} &times; ${esc(tc(c.paridad))}</td><td class="num">${clp(c.adValoremClp)}</td></tr>`);
  if (c.agenciaTotalFactura || c.agenciaIvaInternacion) {
    filas.push(`<tr><td>C</td><td>Agencia de aduana · monto de la operación</td><td>${esc(factura(c.facturaAgenciaNumero, c.facturaAgenciaEmisor))}</td><td class="num">${clp(c.agenciaTotalFactura)}</td></tr>`);
    filas.push(`<tr><td></td><td>Menos IVA de internación (pagado por cuenta del cliente)</td><td>Declaración de Ingreso Nº ${txt(c.dinNumero)}</td><td class="num">${c.agenciaIvaInternacion ? `&minus; ${clp(c.agenciaIvaInternacion)}` : clp(0)}</td></tr>`);
  }
  if (c.otrosGastosCliente) filas.push(`<tr><td>C</td><td>Otros gastos por cuenta del cliente</td><td>Desaduanamiento, bodega</td><td class="num">${clp(c.otrosGastosCliente)}</td></tr>`);
  if (c.fleteNacional) filas.push(`<tr><td>D</td><td>Flete nacional (IVA incluido)</td><td>${esc(factura(c.facturaTransporteNumero, c.facturaTransporteEmisor))}</td><td class="num">${clp(c.fleteNacional)}</td></tr>`);
  filas.push(`<tr><td></td><td><b>Total base de cálculo</b></td><td></td><td class="num"><b>${clp(c.baseCalculo)}</b></td></tr>`);
  filas.push(`<tr><td></td><td>% afecto</td><td>${esc(porcentajeChile(c.pctAfecto))}</td><td class="num">${clp(c.baseAfecta)}</td></tr>`);
  filas.push(`<tr><td></td><td><b>TOTAL A CANCELAR</b> (tasa ${esc(porcentajeChile(c.tasaPct))}, exenta de IVA)</td><td></td><td class="num"><b>${clp(c.tasa)}</b></td></tr>`);

  const certs = d.certificados.length
    ? d.certificados.map((x) => `<tr><td>${esc(x.numero)}</td><td>${esc(x.condicion)}</td></tr>`).join("")
    : '<tr><td class="vacio" colspan="2">Aún no hay certificados oficiales asociados a la resolución.</td></tr>';
  const reparto = d.reparto
    .map((p) => `<tr><td>${esc(nombreCentro(p, d.unidad))}</td><td class="num">${esc(porcentajeChile(p.pct))}</td><td class="num">${clp(p.monto)}</td></tr>`)
    .join("");
  const total = d.reparto.reduce((s, p) => s + p.monto, 0);

  return `${membrete("Comunicación Breve", d.otCodigo, "Departamento Comercial")}

<h1>COMUNICACIÓN BREVE</h1>

<table class="meta">
  <tr><th>Nº control DTCG</th><td>${esc(d.otCodigo)}</td><th>Fecha</th><td>${dia(d.fecha)}</td></tr>
</table>
<p>Adjunto se remite cálculo de tasa ${esc(porcentajeChile(c.tasaPct))} para efectos de facturación correspondiente a O/T Nº ${esc(d.otCodigo)}.</p>

<table class="meta">
  <tr><th>Empresa</th><td>${txt(d.cliente.razonSocial)}</td><th>RUT</th><td>${txt(d.cliente.rut)}</td></tr>
  <tr><th>Dirección</th><td>${txt(d.cliente.direccion)}</td><th>Comuna</th><td>${txt(d.cliente.comuna)}</td></tr>
  <tr><th>Teléfono</th><td>${txt(d.cliente.telefono)}</td><th>Correo</th><td>${txt(d.cliente.email)}</td></tr>
  <tr><th>Resolución</th><td>${txt(d.resolucionNumero)}</td><th>Internación</th><td>${txt(d.internacionNumero)}</td></tr>
  <tr><th>Agencia de aduana</th><td>${txt(c.agenciaAduana)}</td><th>Declaración de Ingreso</th><td>${txt(c.dinNumero)}</td></tr>
  <tr><th>Monto CIF</th><td>${esc(usd(c.cifUsd))}</td><th>Tipo de cambio US$</th><td>${esc(tc(c.paridad))}</td></tr>
</table>

<h2>Cálculo de la tasa (en pesos)</h2>
<table class="rep">
  <thead><tr><th>Letra</th><th>Concepto</th><th>Detalle</th><th class="num">Monto</th></tr></thead>
  <tbody>${filas.join("")}</tbody>
</table>
<p>Fecha de recepción de documentos SDBPCH: ${dia(c.fechaRecepcionSdbpch)}.</p>

<h2>Certificados de control asociados a la resolución</h2>
<table class="rep">
  <thead><tr><th>Nº certificado</th><th>Condición</th></tr></thead>
  <tbody>${certs}</tbody>
</table>
<p>Total de certificados: ${d.certificados.length}.</p>

<h2>Cargar a centro de costo</h2>
<table class="rep">
  <thead><tr><th>Centro de costo</th><th class="num">%</th><th class="num">Monto</th></tr></thead>
  <tbody>${reparto}<tr><td><b>Total</b></td><td></td><td class="num"><b>${clp(total)}</b></td></tr></tbody>
</table>
${firma(d.textos.firmaCargo)}
<p class="nota">Copia Depto. Comercial.</p>`;
}

/** Cuerpo de la carta al cliente (certificados disponibles, formas de pago y plazo). */
export function cuerpoCartaCliente(d: DatosDocumentosTasa): string {
  const parrafos = d.textos.parrafos.map((p) => String(p ?? "").trim()).filter(Boolean);
  return `${membrete("Carta al cliente · tasa de internación", d.otCodigo, "Departamento Comercial")}

<h1>DEPARTAMENTO COMERCIAL</h1>

<table class="meta">
  <tr><th>Empresa</th><td>${txt(d.cliente.razonSocial)}</td><th>RUT</th><td>${txt(d.cliente.rut)}</td></tr>
  <tr><th>Planta</th><td>${txt([d.cliente.direccion, d.cliente.comuna].filter((x) => String(x ?? "").trim()).join(", "))}</td><th>Correo</th><td>${txt(d.cliente.email)}</td></tr>
  <tr><th>De</th><td>Banco de Pruebas de Chile</td><th>Fecha</th><td>${dia(d.fecha)}</td></tr>
  <tr><th>IDIC.BPCH.DTCG Nº</th><td>${esc(d.otCodigo)}</td><th>Referencia</th><td>${txt(d.textos.referencia)}</td></tr>
</table>

${parrafos.map((p, i) => `<p>${i + 1}.- ${esc(p)}</p>`).join("\n")}

<table class="meta">
  <tr><th>Nº doc./resolución</th><td>${txt(d.resolucionNumero)}</td></tr>
  <tr><th>Fecha documento</th><td>${dia(d.resolucionFecha)}</td></tr>
  <tr><th>Monto a cancelar</th><td><b>${clp(d.calculo.tasa)}</b></td></tr>
</table>
${firma(d.textos.firmaCargo)}`;
}

export type TipoDocumentoTasa = "comunicacion-breve" | "carta-cliente";

/** Cuerpo, sello (sin código de verificación: no es un documento sellado del LIMS) y título. */
export function documentoTasa(tipo: TipoDocumentoTasa, d: DatosDocumentosTasa) {
  const cuerpo = tipo === "comunicacion-breve" ? cuerpoComunicacionBreve(d) : cuerpoCartaCliente(d);
  const nombre = tipo === "comunicacion-breve" ? "Comunicación Breve" : "Carta al cliente";
  const sello: Sello = {
    numero: `${d.otCodigo} · ${nombre} · tasa de internación`,
    codigoVerificacion: "",
    hash: createHash("sha256").update(cuerpo, "utf8").digest("hex"),
    fecha: dia(d.fecha),
    urlVerificacion: "",
    borrador: false,
  };
  const archivo = `${tipo === "comunicacion-breve" ? "CB" : "Carta"}-tasa-${d.otCodigo}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return { cuerpo, sello, titulo: `${nombre} ${d.otCodigo} · tasa de internación`, archivo };
}

export async function pdfDocumentoTasa(tipo: TipoDocumentoTasa, d: DatosDocumentosTasa): Promise<{ buffer: Buffer; nombre: string }> {
  const x = documentoTasa(tipo, d);
  return { buffer: await generarPdf(x.cuerpo, x.sello, x.titulo), nombre: `${x.archivo}.pdf` };
}
