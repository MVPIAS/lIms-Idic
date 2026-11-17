/**
 * «Documento de cobro» de una factura (PDF). El LIMS no emite documentos
 * tributarios electrónicos (no sale a internet): este documento acompaña el
 * cobro y dice, en el encabezado y en el pie de cada página, que NO es un
 * documento tributario electrónico. El DTE lo emite el sistema de facturación
 * del IDIC con el JSON de exportacion-factura.ts.
 *
 * Cuerpo en el mismo subconjunto de HTML que la cotización y los informes
 * (membrete, h1/h2, table.meta, table.rep) para heredar su maquetado y su PDF/A.
 */
import { createHash } from "node:crypto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import type { Sello } from "../plantilla-render/plantilla-defecto";
import { clp, esc, fechaCorta } from "../cotizacion/cotizacion-documento";
import { esExenta, rutSii, separarCodigo, type EmisorEntrada, type FacturaEntrada, type LineaEntrada, type ReceptorEntrada, type ReferenciaEntrada } from "./exportacion-factura";

export const LEYENDA_NO_DTE = "Documento de cobro · no es un documento tributario electrónico";

export interface DatosDocumentoCobro {
  factura: FacturaEntrada;
  lineas: LineaEntrada[];
  emisor: EmisorEntrada;
  receptor: ReceptorEntrada | null;
  formaPago?: { codigo: string | null; etiqueta?: string | null } | null;
  referencias: ReferenciaEntrada[];
  centroCosto?: { codigo: string; nombre: string } | null;
  pagado: number;
  notasCredito: number;
}

const ESTADO: Record<string, string> = {
  pendiente: "Pendiente de facturar",
  emitida: "Emitida",
  parcial: "Pago parcial",
  pagada: "Pagada",
  anulada: "Anulada",
};

const ETQ_REF: Record<string, string> = {
  OT: "Orden de trabajo",
  COTIZACION: "Cotización",
  OC: "Orden de compra",
  OPI: "OPI",
  RESOLUCION: "Resolución",
  DISPOSICION: "Disposición",
};

/** dd-mm-aaaa de una fecha de calendario «YYYY-MM-DD» (sin moverla de día). */
const dia = (f: string | null | undefined) => (f ? fechaCorta(new Date(`${String(f).slice(0, 10)}T00:00:00.000Z`)) : "—");

/** «Transferencia · 30 días»; sin repetir los días si la forma de pago ya los dice («Contado 30 días»). */
export function textoFormaPago(fp: DatosDocumentoCobro["formaPago"], dias: number | null | undefined): string {
  const t = String(fp?.etiqueta ?? fp?.codigo ?? "").trim();
  const conDias = dias && !/d[ií]as?/i.test(t) ? `${dias} días` : "";
  return [t, conDias].filter(Boolean).join(" · ") || "—";
}

/** Cuerpo HTML del documento de cobro. */
export function cuerpoDocumentoCobroHtml(d: DatosDocumentoCobro): string {
  const f = d.factura;
  const r = d.receptor ?? {};
  const e = d.emisor;
  const exenta = esExenta(f);
  const usd = String(f.moneda ?? "CLP").toUpperCase() !== "CLP";
  const monto = (v: unknown) => (usd ? `${esc(f.moneda)} ${Number(v ?? 0).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : clp(v));
  const filas = d.lineas
    .map((l, i) => {
      const { codigo, nombre } = separarCodigo(l.descripcion);
      return `<tr><td class="num">${i + 1}</td><td>${esc(codigo ?? "—")}</td><td>${esc(nombre)}</td><td class="num">${esc(Number(l.cantidad).toLocaleString("es-CL"))}</td><td class="num">${monto(l.precioUnitario)}</td><td class="num">${monto(l.subtotal)}</td></tr>`;
    })
    .join("");
  const refs = d.referencias.filter((x) => String(x.folio ?? "").trim());
  const saldo = f.estado === "anulada" ? 0 : Number(f.total) - d.pagado - d.notasCredito;
  const pendiente = f.estado === "pendiente";
  const rutE = rutSii(e.rut) ?? e.rut ?? "—";
  const rutR = rutSii(r.rut) ?? r.rut ?? "—";
  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>${esc(e.razonSocial || "INSTITUTO DE INVESTIGACIONES Y CONTROL")}</b>
    <span>RUT ${esc(rutE)} &middot; ${esc(e.giro ?? "")}</span>
  </div>
  <div class="doc">
    <b>${esc(f.numero)}</b>
    <span>Documento de cobro</span>
  </div>
</div>

<h1>DOCUMENTO DE COBRO</h1>
<h2>No es un documento tributario electrónico</h2>
<p>Este documento informa el cobro de los servicios. La factura electrónica (DTE) la emite el sistema de facturación del IDIC${pendiente ? "; el número de este documento es provisional hasta que se emita" : ""}.</p>

<table class="meta">
  <tr><th>N° interno</th><td>${esc(f.numero)}</td><th>Estado</th><td>${esc(ESTADO[f.estado] ?? f.estado)}</td></tr>
  <tr><th>Fecha</th><td>${pendiente ? "—" : dia(f.fechaEmision)}</td><th>Forma de pago</th><td>${esc(textoFormaPago(d.formaPago, r.diasCredito))}</td></tr>
  <tr><th>Tipo sugerido</th><td>${exenta ? "Factura exenta (34)" : "Factura afecta (33)"}</td><th>Centro de costo</th><td>${esc(d.centroCosto ? `${d.centroCosto.codigo} · ${d.centroCosto.nombre}` : "—")}</td></tr>
</table>

<h2>Emisor</h2>
<table class="meta">
  <tr><th>Razón social</th><td>${esc(e.razonSocial ?? "—")}</td><th>RUT</th><td>${esc(rutE)}</td></tr>
  <tr><th>Dirección</th><td>${esc(e.direccion ?? "—")}</td><th>Comuna · ciudad</th><td>${esc([e.comuna, e.ciudad].filter(Boolean).join(" · ") || "—")}</td></tr>
</table>

<h2>Cliente</h2>
<table class="meta">
  <tr><th>Razón social</th><td>${esc(r.razonSocial ?? "—")}</td><th>RUT</th><td>${esc(rutR)}</td></tr>
  <tr><th>Giro</th><td>${esc(r.giro ?? "—")}</td><th>Contacto</th><td>${esc([r.contactoNombre, r.contactoCorreo].filter(Boolean).join(" · ") || "—")}</td></tr>
  <tr><th>Dirección</th><td>${esc(r.direccion ?? "—")}</td><th>Comuna · ciudad</th><td>${esc([r.comuna, r.ciudad].filter(Boolean).join(" · ") || "—")}</td></tr>
</table>

<h2>Detalle</h2>
<table class="rep">
  <thead><tr><th>#</th><th>Código</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">P. unitario</th><th class="num">Monto</th></tr></thead>
  <tbody>${filas || '<tr><td class="vacio" colspan="6">Sin líneas de detalle.</td></tr>'}</tbody>
</table>

<h2>Totales</h2>
<table class="meta">
  <tr><th>${exenta ? "Exento" : "Neto"}</th><td>${monto(f.neto)}</td><th>IVA ${exenta ? "(exenta)" : `${esc(Number(f.ivaPct).toLocaleString("es-CL"))} %`}</th><td>${monto(f.ivaMonto)}</td></tr>
  <tr><th>TOTAL</th><td>${monto(f.total)}</td><th>Saldo por pagar</th><td>${monto(Math.max(0, saldo))}</td></tr>
</table>

${refs.length ? `<h2>Referencias</h2><table class="meta">${refs.map((x) => `<tr><th>${esc(ETQ_REF[x.tipo] ?? x.tipo)}</th><td>${esc(x.folio)}</td><th>Fecha</th><td>${dia(x.fecha)}</td></tr>`).join("")}</table>` : ""}

<p class="nota">${esc(LEYENDA_NO_DTE)}. Generado por el LIMS IDIC. Montos en ${usd ? esc(f.moneda) : "pesos chilenos (CLP)"}.</p>`;
}

/** Cuerpo, sello y título: el pie de cada página repite la leyenda. */
export function documentoCobro(d: DatosDocumentoCobro, hoy: string) {
  const cuerpo = cuerpoDocumentoCobroHtml(d);
  const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
  const sello: Sello = {
    numero: `${d.factura.numero} · ${LEYENDA_NO_DTE}`,
    codigoVerificacion: "",
    hash,
    fecha: d.factura.estado === "pendiente" || !d.factura.fechaEmision ? dia(hoy) : dia(d.factura.fechaEmision),
    urlVerificacion: "",
    borrador: false,
    estadoDocumento: d.factura.estado === "anulada" ? "anulado" : undefined,
  };
  return { cuerpo, sello, titulo: `Documento de cobro ${d.factura.numero}` };
}

/** PDF/A del documento de cobro. */
export async function pdfDocumentoCobro(d: DatosDocumentoCobro, hoy: string): Promise<Buffer> {
  const x = documentoCobro(d, hoy);
  return generarPdf(x.cuerpo, x.sello, x.titulo);
}
