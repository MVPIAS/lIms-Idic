/**
 * Informe técnico de Producción Nacional a DCO · cuerpo sellado.
 * (Bizagi «Subproceso Producción Nacional»: correlación de la relación de
 * ventas con las planillas de actividades ejecutadas → informe técnico → DCO.)
 * Mismo motor y envoltorio que los informes del LIMS: todo dato se escapa.
 */
import { renderizar } from "../../plantilla-render/template.engine";
import { escapeHtml, fmtNum } from "../../plantilla-render/html.util";
import type { FilaCorrelacion } from "./reglas-pn";

const CUERPO = `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Banco de Pruebas de Chile &middot; Producción Nacional</span>
  </div>
  <div class="doc">
    <b>{{doc.numero}}</b>
    <span>Informe técnico a DCO</span>
  </div>
</div>

<h1>INFORME TÉCNICO · PRODUCCIÓN NACIONAL</h1>

<table class="meta">
  <tr><th>Fabricante</th><td>{{i.fabricante}}</td><th>RUT</th><td>{{i.rut}}</td></tr>
  <tr><th>RAF DGMN</th><td>{{i.raf}}</td><th>Línea</th><td>{{i.linea}}</td></tr>
  <tr><th>O/C operativa</th><td>{{i.oc}}</td><th>Año</th><td>{{i.anio}}</td></tr>
  <tr><th>Período</th><td>{{i.periodo}}</td><th>Relación de ventas</th><td>{{i.relacionVentas}}</td></tr>
  <tr><th>Fecha de emisión</th><td colspan="3">{{doc.fecha}}</td></tr>
</table>

<h2>Correlación relación de ventas ↔ planillas de actividades ejecutadas</h2>
{{tabla_correlacion}}

<h2>Conclusión</h2>
<p><b>{{i.conclusion}}</b></p>
{{#si i.observaciones}}<p>{{i.observaciones}}</p>{{/si}}

{{#si i.requerimientoSucursal}}
<h2>Requerimiento técnico</h2>
<table class="meta">
  <tr><th>Solicitud a la Sucursal</th><td>{{i.requerimientoSucursal}}</td></tr>
  <tr><th>Respuesta de la Sucursal</th><td>{{i.respuestaSucursal}}</td></tr>
  <tr><th>¿Responde al requerimiento?</th><td>{{i.responde}}</td></tr>
</table>
{{/si}}

{{#si i.solicitudDgmn}}
<table class="meta">
  <tr><th>Solicitud a la DGMN</th><td>{{i.solicitudDgmn}}</td></tr>
  <tr><th>Respuesta de la DGMN</th><td>{{i.respuestaDgmn}}</td></tr>
</table>
{{/si}}

{{#si i.propuestaTecnica}}
<h2>Propuesta técnica</h2>
<p>{{i.propuestaTecnica}}</p>
{{/si}}

<table class="meta">
  <tr><th>Elaboró</th><td>{{i.elaboro}}</td><th>Destino</th><td>Departamento Comercial (DCO)</td></tr>
</table>
`;

export interface DatosInformeTecnico {
  numero: string;
  fecha: string;
  fabricante: string;
  rut: string;
  raf: string;
  linea: string;
  oc: string;
  anio: number;
  periodo: string;
  relacionVentas: string;
  conforme: boolean;
  observaciones: string;
  requerimientoSucursal: string;
  respuestaSucursal: string;
  responde: boolean | null;
  solicitudDgmn: string;
  respuestaDgmn: string;
  propuestaTecnica: string;
  elaboro: string;
  filas: FilaCorrelacion[];
}

function tabla(filas: FilaCorrelacion[]): string {
  const n = (v: number | null) => (v === null ? "—" : fmtNum(v, 3));
  const cuerpo = filas
    .map((f) => {
      const clase = f.desviacion !== null && f.desviacion > 0 ? "no" : f.desviacion !== null ? "ok" : "";
      return `<tr><td>${escapeHtml(f.producto)}</td><td>${escapeHtml(f.unidadMedida)}</td><td class="num">${escapeHtml(n(f.ventas))}</td><td class="num">${escapeHtml(n(f.inspeccionado))}</td><td class="num ${clase}">${escapeHtml(n(f.desviacion))}</td></tr>`;
    })
    .join("");
  return `<table class="rep"><thead><tr><th>Producto</th><th>Unidad</th><th class="num">Declarado en ventas</th><th class="num">Inspeccionado (OT cerradas)</th><th class="num">Desviación</th></tr></thead><tbody>${cuerpo}</tbody></table>
<p class="nota">Desviación = declarado en ventas − inspeccionado. Un valor positivo es producto vendido sin inspección registrada en el período.</p>`;
}

export function cuerpoInformeTecnico(d: DatosInformeTecnico): string {
  const ctx = {
    doc: { numero: d.numero, fecha: d.fecha },
    i: {
      ...d,
      conclusion: d.conforme
        ? "Relación de ventas CONFORME con las planillas de actividades ejecutadas."
        : "Relación de ventas NO CONFORME con las planillas de actividades ejecutadas.",
      responde: d.responde === true ? "Sí" : d.responde === false ? "No" : "",
    },
  };
  return renderizar(CUERPO, ctx, { tabla_correlacion: tabla(d.filas) }).html;
}
