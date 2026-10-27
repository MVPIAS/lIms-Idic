import { ahoraInputChile, ZONA_CHILE } from "./fecha-chile";
/**
 * metrologiaOt.ts · vocabulario e impresos de la Metrología ligada a la OT
 * (instrumentos, recepción con custodia, entrega y devolución). Reglas en el
 * servidor: apps/api/src/metrologia/metrologia-ot.reglas.ts y
 * docs/FLUJO_METROLOGIA.md §7. Aquí solo se pinta.
 */

export const ESTADO_INSTRUMENTO: Record<string, { texto: string; pill: string }> = {
  por_recibir: { texto: "Por recibir", pill: "gray" },
  recibido: { texto: "En custodia", pill: "blue" },
  no_apto: { texto: "No calibrable", pill: "amber" },
  devuelto: { texto: "Devuelto", pill: "green" },
  anulado: { texto: "Anulado", pill: "gray" },
};

export const ESTADO_CALIBRACION: Record<string, { texto: string; pill: string; chip: string }> = {
  borrador: { texto: "Borrador", pill: "gray", chip: "Borrador" },
  calculada: { texto: "Borrador", pill: "gray", chip: "Borrador" },
  en_revision: { texto: "En revisión técnica", pill: "blue", chip: "En revisión técnica" },
  en_firma: { texto: "Pendiente de firma", pill: "blue", chip: "Pendiente de firma" },
  emitida: { texto: "Emitido", pill: "green", chip: "Emitido" },
  reemplazada: { texto: "Reemplazado", pill: "amber", chip: "Reemplazado" },
};

export const ESTADOS_FISICOS: { valor: string; texto: string }[] = [
  { valor: "bueno", texto: "Buen estado" },
  { valor: "con_observaciones", texto: "Con observaciones" },
  { valor: "danado", texto: "Dañado" },
];
export const textoEstadoFisico = (v?: string | null) => ESTADOS_FISICOS.find((e) => e.valor === v)?.texto ?? v ?? "—";

export const SENTIDOS: { valor: string; texto: string }[] = [
  { valor: "T", texto: "Tracción" },
  { valor: "C", texto: "Compresión" },
  { valor: "T+C", texto: "Tracción y compresión" },
];

export const ORIGEN_OT: Record<string, string> = {
  COTIZACION: "Cotización",
  OT_INTERNA: "OT interna",
  INTERLABORATORIO: "Interlaboratorio",
  DISPOSICION: "Disposición",
  DIRECTA: "Registro directo",
};

/** Fecha-hora local de Chile para un <input type="datetime-local"> (AAAA-MM-DDTHH:mm). */
export function ahoraLocal(): string {
  return ahoraInputChile();
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fh = (v?: string | null) => (v ? new Date(v).toLocaleString("es-CL", { timeZone: ZONA_CHILE, dateStyle: "short", timeStyle: "short" }) : "—");

/** Abre un impreso en una ventana nueva y lanza la impresión (sin datos inventados: solo lo registrado). */
/** Membrete IDIC de los impresos de Metrología (B-074): organismo, laboratorio y número del documento. */
function membrete(laboratorio: string | null | undefined, numero: string): string {
  return `<div class="membrete"><div class="escudo">IDIC</div>
<div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b><span>Ejército de Chile · ${esc(laboratorio ? `Laboratorio de Metrología · ${laboratorio}` : "Laboratorio de Metrología")}</span></div>
<div class="doc"><b>${esc(numero)}</b></div></div>`;
}

function imprimir(titulo: string, cuerpo: string) {
  const w = window.open("", "_blank", "width=760,height=900");
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
 body{font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18212f;margin:24px}
 h1{font-size:16px;margin:0 0 4px} .sub{color:#5f6b7a;margin:0 0 14px}
 table{border-collapse:collapse;width:100%;margin:8px 0} th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left;vertical-align:top}
 th{background:#eef3f7;width:34%;font-weight:600}
 .etiqueta{border:2px solid #18212f;border-radius:6px;padding:12px 14px;width:320px}
 .etiqueta .cod{font:700 20px ui-monospace,Consolas,monospace;letter-spacing:.04em}
 .firmas{display:flex;gap:40px;margin-top:48px} .firmas div{flex:1;border-top:1px solid #18212f;padding-top:4px;text-align:center}
 .membrete{display:flex;align-items:center;gap:12px;border-bottom:2px solid #123a63;padding-bottom:8px;margin-bottom:14px}
 .membrete .escudo{width:36px;height:36px;border-radius:50%;background:#123a63;color:#fff;font:700 10px system-ui;display:flex;align-items:center;justify-content:center}
 .membrete .org{flex:1} .membrete .org b{display:block;color:#123a63;font-size:13px} .membrete .org span{color:#5f6b7a;font-size:11px}
 .membrete .doc b{font:700 12px ui-monospace,Consolas,monospace;color:#123a63}
 @media print{body{margin:10mm}}
</style></head><body>${cuerpo}<script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
  return true;
}

export function imprimirEtiqueta(ot: { codigo: string; laboratorio?: string | null }, i: any) {
  return imprimir(`Etiqueta ${i.etiqueta ?? ""}`, `
<div class="etiqueta">
  <div style="font-size:10px;text-transform:uppercase;color:#5f6b7a">IDIC · ${esc(ot.laboratorio ?? "Metrología")} · Instrumento en custodia</div>
  <div class="cod">${esc(i.etiqueta)}</div>
  <div><b>${esc(i.descripcion)}</b></div>
  <div>${esc([i.marca, i.modelo].filter(Boolean).join(" · ") || "—")} · Serie ${esc(i.serie || "s/s")}</div>
  <div>OT ${esc(ot.codigo)} · ítem ${esc(i.numero)}</div>
  <div>Recibido ${esc(fh(i.recibidoAt))} · Ubicación ${esc(i.ubicacion || "—")}</div>
</div>`);
}

export function imprimirRecepcion(ot: { codigo: string; cliente?: string | null; laboratorio?: string | null }, i: any) {
  const acc = (i.accesorios ?? []) as any[];
  return imprimir(`Recepción ${i.etiqueta ?? ""}`, `${membrete(ot.laboratorio, `Recepción ${ot.codigo}-${i.numero}`)}
<h1>Registro de recepción del instrumento</h1>
<p class="sub">OT ${esc(ot.codigo)} · ítem ${esc(i.numero)} · ${esc(ot.laboratorio ?? "")} · etiqueta ${esc(i.etiqueta)}</p>
<table>
 <tr><th>Cliente</th><td>${esc(ot.cliente ?? "—")}</td></tr>
 <tr><th>Instrumento</th><td>${esc(i.descripcion)} · ${esc([i.marca, i.modelo].filter(Boolean).join(" · ") || "—")}</td></tr>
 <tr><th>N° de serie · identificación</th><td>${esc(i.serie || "s/s")} · ${esc(i.idEspecial || "—")}</td></tr>
 <tr><th>Capacidad · resolución</th><td>${esc(i.capacidad || "—")} · ${esc(i.resolucion || "—")}</td></tr>
 <tr><th>Fecha y hora de recepción</th><td>${esc(fh(i.recibidoAt))}</td></tr>
 <tr><th>Recibido por</th><td>${esc(i.recibidoPorNombre ?? "—")}</td></tr>
 <tr><th>Entregado por</th><td>${esc(i.entregadoPor ?? "—")}</td></tr>
 <tr><th>Estado físico</th><td>${esc(textoEstadoFisico(i.estadoFisico))}${i.estadoFisicoObs ? ` · ${esc(i.estadoFisicoObs)}` : ""}</td></tr>
 <tr><th>Accesorios</th><td>${acc.length ? acc.map((a) => esc([a.tipo, a.marca, a.modelo, a.serie, a.detalle].filter(Boolean).join(" · "))).join("<br>") : "Sin accesorios"}</td></tr>
 <tr><th>Ubicación de almacenamiento</th><td>${esc(i.ubicacion ?? "—")}</td></tr>
 <tr><th>¿Se puede calibrar?</th><td>${i.calibrable === false ? `No · ${esc(i.motivoNoCalibrable ?? "")}` : "Sí"}</td></tr>
</table>
<div class="firmas"><div>Entrega</div><div>Recibe (laboratorio)</div></div>`);
}

export function imprimirActaDevolucion(ot: { codigo: string; cliente?: string | null; laboratorio?: string | null }, i: any) {
  const cert = i.calibracion?.numeroCertificado;
  // B-074: membrete, número del acta y documento del no calibrable (informe técnico o certificado externo).
  const numero = `Acta de devolución ${ot.codigo}-${i.numero}`;
  const docNoCal = ((i.documentosNoCalibrable ?? []) as any[])
    .map((x) => `${x.tipo === "informe_tecnico" ? "Informe técnico" : "Certificado externo"} N° ${esc(x.numero ?? "—")}`).join("; ");
  return imprimir(numero, `${membrete(ot.laboratorio, numero)}
<h1>Acta de devolución del instrumento</h1>
<p class="sub">OT ${esc(ot.codigo)} · ítem ${esc(i.numero)} · ${esc(ot.laboratorio ?? "")} · etiqueta ${esc(i.etiqueta)}</p>
<table>
 <tr><th>Cliente</th><td>${esc(ot.cliente ?? "—")}</td></tr>
 <tr><th>Instrumento</th><td>${esc(i.descripcion)} · Serie ${esc(i.serie || "s/s")}</td></tr>
 <tr><th>Documento emitido</th><td>${cert ? `Certificado de Calibración N° ${esc(cert)}` : i.estado === "no_apto" || i.calibrable === false ? `No calibrable: ${esc(i.motivoNoCalibrable ?? "")}${docNoCal ? ` · ${docNoCal}` : ""}` : "—"}</td></tr>
 <tr><th>Recibido en el laboratorio</th><td>${esc(fh(i.recibidoAt))}</td></tr>
 <tr><th>Fecha y hora de devolución</th><td>${esc(fh(i.devueltoAt))}</td></tr>
 <tr><th>Recibe</th><td>${esc(i.devueltoRecibe ?? "—")}</td></tr>
 <tr><th>Estado al devolver</th><td>${esc(textoEstadoFisico(i.devueltoEstado))}${i.devueltoObs ? ` · ${esc(i.devueltoObs)}` : ""}</td></tr>
 <tr><th>Guía o medio</th><td>${esc(i.devueltoGuia ?? "—")}</td></tr>
 <tr><th>Registró la devolución</th><td>${esc(i.devueltoPorNombre ?? "—")}</td></tr>
</table>
<div class="firmas"><div>Entrega (laboratorio)</div><div>Recibe conforme</div></div>`);
}
