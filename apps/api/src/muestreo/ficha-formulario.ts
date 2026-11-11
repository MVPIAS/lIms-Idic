/**
 * Ficha imprimible del formulario de «Selección y extracción de muestras»
 * (sesión R6): todos los campos del formulario, el plan NCh 44, las unidades
 * seleccionadas, los sellos y el registro fotográfico. Se abre desde
 * OT › Muestreo › «Imprimir formulario» (GET /muestreo/:id/formulario).
 */
import { escapeHtml, fmtFecha, fmtFechaHora } from "../plantilla-render/html.util";

const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : escapeHtml(String(x)));

export function fichaFormularioHtml(mu: any, fotos: { mime: string; datos: string; pie: string | null }[]): string {
  const filas: [string, string][] = [
    ["OT", v(mu.otCodigo)],
    ["Nº de formulario", v(mu.numeroFormulario)],
    ["Lugar de muestreo", v(mu.lugar)],
    ["Fecha de la toma", mu.fechaToma ? escapeHtml(fmtFechaHora(mu.fechaToma)) : "—"],
    ["Hora de inicio · término", `${v(mu.horaInicio)} · ${v(mu.horaTermino)}`],
    ["Responsable", v(mu.responsable)],
    ["Solicitado por", v(mu.solicitadoPor)],
    ["Producto", v(mu.producto)],
    ["Especificación técnica", v(mu.especificacionTecnica)],
    ["Protocolo o norma", v(mu.protocoloNorma)],
    ["Proveedor", v(mu.proveedor)],
    ["Guía de despacho", v(mu.guiaDespacho)],
    ["Nº de lote", v(mu.identificacionLote)],
    ["Fecha de fabricación", mu.fechaElaboracion ? escapeHtml(fmtFecha(mu.fechaElaboracion)) : "—"],
    ["Tamaño del lote", `${v(mu.tamanoLote)} ${mu.unidadLote ? escapeHtml(mu.unidadLote) : ""}`],
    ["Tamaño de la muestra", `${v(mu.tamanoMuestra)} ${mu.unidadMuestra ? escapeHtml(mu.unidadMuestra) : ""}`],
    ["Norma del muestreo", v(mu.normaMuestreo)],
    [
      "Plan de muestreo",
      mu.plan ? escapeHtml(`nivel ${mu.plan.nivel ?? "—"} · letra código ${mu.plan.letra ?? "—"} · n ${mu.plan.n ?? "—"}`) : "Sin plan NCh 44",
    ],
    ["Muestras de la selección al azar", v(mu.cantidadAleatoria)],
    ["Cantidad y envase", v(mu.cantidadEnvase)],
    ["Sellos", (mu.sellos ?? []).length ? escapeHtml((mu.sellos as string[]).join(", ")) : "—"],
    ["Detalle de las muestras", v(mu.detalleMuestras)],
    ["Observaciones", v(mu.observaciones)],
  ];
  const unidades = (mu.unidades ?? []) as { posicion: number | null; identificacion: string | null; reemplazada: boolean }[];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Formulario de muestreo ${v(mu.numeroFormulario)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;margin:16mm;color:#111}
  h1{font-size:14pt;margin:0 0 4mm} table{border-collapse:collapse;width:100%;margin-bottom:5mm}
  th,td{border:1px solid #999;padding:3px 6px;text-align:left;vertical-align:top} th{width:34%;background:#f2f2f2}
  .fotos{display:grid;grid-template-columns:1fr 1fr;gap:4mm} .fotos figure{margin:0} .fotos img{width:100%;border:1px solid #ccc}
  figcaption{font-size:9pt;color:#444} .firmas{display:grid;grid-template-columns:1fr 1fr;gap:20mm;margin-top:20mm;text-align:center}
  .firmas div{border-top:1px solid #333;padding-top:3px}
</style></head><body>
<h1>Selección y extracción de muestras</h1>
<table>${filas.map(([k, x]) => `<tr><th>${k}</th><td>${x}</td></tr>`).join("")}</table>
${
  unidades.length
    ? `<h2 style="font-size:12pt">Unidades seleccionadas</h2><table><tr><th>Posición</th><td><b>Identificación</b></td></tr>${unidades
        .map((u) => `<tr><th>${v(u.posicion)}</th><td>${v(u.identificacion)}${u.reemplazada ? " (reemplazada)" : ""}</td></tr>`)
        .join("")}</table>`
    : ""
}
${
  fotos.length
    ? `<h2 style="font-size:12pt">Registro fotográfico</h2><div class="fotos">${fotos
        .map((f) => `<figure><img src="data:${f.mime === "image/png" ? "image/png" : "image/jpeg"};base64,${f.datos}" alt="${v(f.pie ?? "Foto del muestreo")}"><figcaption>${v(f.pie)}</figcaption></figure>`)
        .join("")}</div>`
    : ""
}
<div class="firmas"><div>Inspector / muestreador</div><div>Proveedor</div></div>
</body></html>`;
}
