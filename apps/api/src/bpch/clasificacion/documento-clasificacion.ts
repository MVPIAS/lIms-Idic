/**
 * Documento de clasificación de una sustancia (BPCH) · cuerpo sellado.
 *
 * Se arma con el mismo motor que los informes (`renderizar`: todo dato se
 * escapa; los bloques de tabla se construyen aquí escapando cada celda) y se
 * presenta con el mismo envoltorio (`documentoCompleto` / `generarPdf`).
 * El cuerpo NO lleva el pie con el hash (iría dentro de lo sellado).
 */
import { renderizar } from "../../plantilla-render/template.engine";
import { escapeHtml } from "../../plantilla-render/html.util";
import { evaluarPruebas, NOMBRE_PRUEBA, type Pruebas, type ResultadoPrueba, lecturasMasa } from "./reglas-clasificacion";

const ETIQUETA: Record<ResultadoPrueba, string> = {
  positivo: "Positivo (+)",
  negativo: "Negativo (−)",
  incompleto: "Incompleto",
  no_aplica: "No aplica",
};

const CUERPO = `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Banco de Pruebas de Chile</span>
  </div>
  <div class="doc">
    <b>{{doc.numero}}</b>
    <span>Clasificación {{c.codigo}} &middot; versión {{c.version}}</span>
  </div>
</div>

<h1>CLASIFICACIÓN DE SUSTANCIA · SERIES DE PRUEBA ONU</h1>

<table class="meta">
  <tr><th>Sustancia / producto</th><td colspan="3">{{c.sustancia}}</td></tr>
  <tr><th>Fabricante / origen</th><td>{{c.fabricante}}</td><th>RUT</th><td>{{c.rut}}</td></tr>
  <tr><th>OT de las pruebas</th><td>{{c.ot}}</td><th>Muestra</th><td>{{c.muestra}}</td></tr>
  <tr><th>Fecha de emisión</th><td colspan="3">{{doc.fecha}}</td></tr>
</table>

{{#si c.descripcion}}
<h2>Antecedentes</h2>
<p>{{c.descripcion}}</p>
{{/si}}

<h2>Pruebas (registro SAC-PG01-FORM12)</h2>
{{tabla_pruebas}}

<h2>Clasificación</h2>
<table class="meta">
  <tr><th>¿Es explosiva (Clase 1)?</th><td>{{c.explosivaTexto}}</td><th>Clase / División</th><td>{{c.claseDivision}}</td></tr>
  <tr><th>Grupo de compatibilidad</th><td>{{c.grupoCompatibilidad}}</td><th>Nº ONU</th><td>{{c.numeroOnu}}</td></tr>
  <tr><th>Designación oficial de transporte</th><td colspan="3">{{c.nombreEnvio}}</td></tr>
</table>
{{#si c.justificacion}}
<p><b>Justificación:</b> {{c.justificacion}}</p>
{{/si}}

<h2>Responsables</h2>
<table class="meta">
  <tr><th>Clasificó</th><td>{{c.clasificadoPor}}</td><th>Fecha</th><td>{{c.clasificadoAt}}</td></tr>
  <tr><th>Aprobó</th><td>{{c.aprobadoPor}}</td><th>Fecha</th><td>{{c.aprobadoAt}}</td></tr>
</table>

<p class="nota">Criterios: SAC-PG01-IT21 (positivo si el tubo se fragmenta completamente o la placa testigo resulta perforada),
SAC-PG01-IT22 Koenen (positivo si el diámetro límite es igual o superior a 1,0 mm en Serie 1 o 2,0 mm en Serie 2),
SAC-PG01-IT23 TPT (positivo si la presión máxima alcanza 2.070 kPa). Manual de Pruebas y Criterios de las Naciones Unidas.</p>
`;

export interface DatosDocumentoClasificacion {
  numero: string;
  fecha: string;
  codigo: string;
  version: number;
  sustancia: string;
  fabricante: string;
  rut: string;
  ot: string;
  muestra: string;
  descripcion: string;
  explosiva: boolean | null;
  claseDivision: string;
  grupoCompatibilidad: string;
  numeroOnu: string;
  nombreEnvio: string;
  justificacion: string;
  clasificadoPor: string;
  clasificadoAt: string;
  aprobadoPor: string;
  aprobadoAt: string;
  pruebas: Pruebas;
}

function tablaPruebas(pruebas: Pruebas): string {
  const ev = evaluarPruebas(pruebas);
  const masas = lecturasMasa(pruebas);
  const filas: [string, string, string][] = [
    [NOMBRE_PRUEBA.it21, ev.it21.detalle, ETIQUETA[ev.it21.resultado]],
    [NOMBRE_PRUEBA.it22, [ev.it22.detalle, masas.it22].filter(Boolean).join(" · "), ETIQUETA[ev.it22.resultado]],
    [NOMBRE_PRUEBA.it23, [ev.it23.detalle, masas.it23].filter(Boolean).join(" · "), ETIQUETA[ev.it23.resultado]],
  ];
  const cuerpo = filas
    .map(([a, b, c]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td><td>${escapeHtml(c)}</td></tr>`)
    .join("");
  const indicador =
    ev.indicaExplosiva === null
      ? "Sin indicador (no hay pruebas concluyentes)"
      : ev.indicaExplosiva
        ? "Las pruebas indican comportamiento explosivo"
        : "Las pruebas no indican comportamiento explosivo";
  return `<table class="rep"><thead><tr><th>Prueba</th><th>Lecturas</th><th>Resultado</th></tr></thead><tbody>${cuerpo}</tbody></table>
<p class="nota">${escapeHtml(indicador)}.</p>`;
}

/** Cuerpo HTML (lo que se sella) del documento de clasificación. */
export function cuerpoDocumentoClasificacion(d: DatosDocumentoClasificacion): string {
  const ctx = {
    doc: { numero: d.numero, fecha: d.fecha },
    c: {
      ...d,
      explosivaTexto: d.explosiva === true ? "Sí" : d.explosiva === false ? "No" : "—",
      claseDivision: d.claseDivision || "—",
      grupoCompatibilidad: d.grupoCompatibilidad || "—",
      numeroOnu: d.numeroOnu ? `UN ${d.numeroOnu}` : "—",
      nombreEnvio: d.nombreEnvio || "—",
      fabricante: d.fabricante || "—",
      rut: d.rut || "—",
      ot: d.ot || "—",
      muestra: d.muestra || "—",
    },
  };
  return renderizar(CUERPO, ctx, { tabla_pruebas: tablaPruebas(d.pruebas) }).html;
}
