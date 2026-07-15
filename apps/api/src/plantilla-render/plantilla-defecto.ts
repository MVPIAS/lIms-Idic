/**
 * Cuerpos de plantilla por defecto (membrete institucional IDIC) y envoltorio
 * imprimible del documento.
 *
 * ESPEJO de la sección 4 de `packages/db/align_certificado.sql`, que siembra
 * estos mismos cuerpos en `plantilla_informe.cuerpo_html` para los tipos
 * CERTIFICADO / I.ENSAYO / I.TECNICO. Aquí viven como FALLBACK de runtime: si
 * una plantilla no tiene cuerpo (las 114 sembradas son cáscaras con nombre;
 * IVC/PLANILLA/BOLETIN/OTRO se dejan sin cuerpo a propósito), el motor usa el
 * de su tipo y lo AVISA en `avisos[]` de la respuesta.
 *
 * Si cambia uno, cambie el otro.
 */

const MEMBRETE = (subtitulo: string) => `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; ${subtitulo}</span>
  </div>
  <div class="doc">
    <b>{{certificado.numero}}</b>
    <span>{{plantilla.repid}} &middot; {{plantilla.version}}</span>
  </div>
</div>`;

const FIRMAS = (izq: string, der: string) => `
<div class="firmas">
  <div class="firma"><span class="linea"></span>${izq}</div>
  <div class="firma"><span class="linea"></span>${der}</div>
</div>`;

const CERTIFICADO = `${MEMBRETE("Laboratorio de Ensayo y Calibración")}

<h1>CERTIFICADO DE ANÁLISIS</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
  <tr><th>Subdirección</th><td>{{ot.subdireccionAsignada}}</td><th>N.º de muestras</th><td>{{n_muestras}}</td></tr>
</table>

{{#si ot.descripcionTrabajo}}
<h2>Trabajo solicitado</h2>
<p>{{ot.descripcionTrabajo}}</p>
{{/si}}

<h2>Resultados de los ensayos</h2>
{{tabla_resultados}}

<h2>Muestras analizadas</h2>
{{tabla_muestras}}

<p class="nota">Los resultados de este certificado se refieren exclusivamente a las muestras
sometidas a ensayo. Este documento no podrá ser reproducido parcialmente sin la autorización
escrita del Instituto.</p>
${FIRMAS("Analista responsable", "Jefe de Laboratorio")}`;

const I_ENSAYO = `${MEMBRETE("Laboratorio de Ensayo y Calibración")}

<h1>INFORME DE ENSAYO</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
  <tr><th>Solicitante</th><td>{{ot.solicitante}}</td><th>Fecha de recepción</th><td>{{ot.fechaRecepcion}}</td></tr>
  <tr><th>Subdirección</th><td>{{ot.subdireccionAsignada}}</td><th>N.º de muestras</th><td>{{n_muestras}}</td></tr>
</table>

{{#si ot.descripcionTrabajo}}
<h2>Objeto del ensayo</h2>
<p>{{ot.descripcionTrabajo}}</p>
{{/si}}

<h2>Muestras sometidas a ensayo</h2>
{{tabla_muestras}}

<h2>Resultados</h2>
{{tabla_resultados}}

<p class="nota">Los resultados se refieren únicamente a las muestras ensayadas y a las
condiciones descritas. DE: desviación estándar; CV: coeficiente de variación.</p>
${FIRMAS("Analista responsable", "Jefe de Laboratorio")}`;

const I_TECNICO = `${MEMBRETE("Subdirección Técnica")}

<h1>INFORME TÉCNICO</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
  <tr><th>Tipo de trabajo</th><td>{{ot.tipoTrabajo}}</td><th>Subdirección</th><td>{{ot.subdireccionAsignada}}</td></tr>
</table>

<h2>Antecedentes</h2>
{{#si ot.descripcionTrabajo}}<p>{{ot.descripcionTrabajo}}</p>{{/si}}
{{#no ot.descripcionTrabajo}}<p>Sin descripción de trabajo registrada en la orden.</p>{{/no}}

<h2>Desarrollo y resultados</h2>
{{tabla_resultados}}

{{#si ot.notas}}
<h2>Observaciones</h2>
<p>{{ot.notas}}</p>
{{/si}}
${FIRMAS("Profesional responsable", "Jefe de Departamento")}`;

/** Genérico: cualquier otro tipo (IVC, PLANILLA, BOLETIN, OTRO). */
const GENERICO = `${MEMBRETE("Laboratorio de Ensayo y Calibración")}

<h1>{{plantilla.nombre}}</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razonSocial}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Orden de Trabajo</th><td>{{ot.codigo}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
</table>

<h2>Muestras</h2>
{{tabla_muestras}}

<h2>Resultados</h2>
{{tabla_resultados}}
${FIRMAS("Analista responsable", "Jefe de Laboratorio")}`;

const POR_TIPO: Record<string, string> = {
  CERTIFICADO,
  "I.ENSAYO": I_ENSAYO,
  "I.TECNICO": I_TECNICO,
};

/** Cuerpo por defecto para un tipo de plantilla. Nunca devuelve vacío. */
export function cuerpoPorDefecto(tipo: string | null | undefined): string {
  return POR_TIPO[(tipo ?? "").toUpperCase()] ?? GENERICO;
}

/**
 * Hoja de estilo del documento. Se usa tanto en la previsualización como en la
 * descarga HTML imprimible.
 *
 * `@media print`: A4 con márgenes reales, sin fondos que se coman el tóner, y
 * `page-break-inside: avoid` en las filas y en el bloque de firmas para que la
 * tabla de resultados no parta una fila entre páginas.
 */
export const ESTILOS_DOCUMENTO = `
  :root { --tinta:#12212f; --linea:#c9d4de; --suave:#5b6b7c; --azul:#123a63; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:#eef2f5; color:var(--tinta);
         font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.45; }
  .hoja { max-width:820px; margin:0 auto; background:#fff; padding:38px 42px;
          box-shadow:0 2px 12px rgba(0,0,0,.10); }
  .membrete { display:flex; align-items:center; gap:14px; border-bottom:2.5px solid var(--azul);
              padding-bottom:12px; margin-bottom:20px; }
  .membrete .escudo { width:46px; height:46px; border-radius:50%; background:var(--azul); color:#fff;
                      font-weight:700; font-size:13px; display:flex; align-items:center;
                      justify-content:center; letter-spacing:.5px; flex:0 0 auto; }
  .membrete .org { flex:1; display:flex; flex-direction:column; }
  .membrete .org b { font-size:13.5px; letter-spacing:.3px; color:var(--azul); }
  .membrete .org span { font-size:10.5px; color:var(--suave); }
  .membrete .doc { text-align:right; display:flex; flex-direction:column; }
  .membrete .doc b { font-family:Consolas,"Courier New",monospace; font-size:13px; color:var(--azul); }
  .membrete .doc span { font-size:10px; color:var(--suave); }
  h1 { font-size:16px; text-align:center; letter-spacing:1.2px; margin:18px 0 16px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.7px; color:var(--azul);
       border-bottom:1px solid var(--linea); padding-bottom:3px; margin:20px 0 8px; }
  p { margin:6px 0; }
  table { width:100%; border-collapse:collapse; }
  table.meta { margin-bottom:6px; }
  table.meta th { width:15%; text-align:left; background:#f1f5f8; color:var(--suave);
                  font-size:9.5px; text-transform:uppercase; letter-spacing:.4px;
                  padding:5px 7px; border:1px solid var(--linea); vertical-align:middle; }
  table.meta td { padding:5px 7px; border:1px solid var(--linea); font-size:11.5px; }
  table.rep { font-size:11px; margin:6px 0 4px; }
  table.rep th { background:var(--azul); color:#fff; text-align:left; padding:5px 7px;
                 font-size:9.5px; text-transform:uppercase; letter-spacing:.4px;
                 border:1px solid var(--azul); }
  table.rep td { padding:5px 7px; border:1px solid var(--linea); vertical-align:top; }
  table.rep tbody tr:nth-child(even) td { background:#f7fafc; }
  table.rep .num { text-align:right; font-variant-numeric:tabular-nums; }
  table.rep .vacio { text-align:center; color:var(--suave); font-style:italic; padding:12px; }
  table.rep td.ok { color:#155e3d; font-weight:600; }
  table.rep td.no { color:#7d1f1f; font-weight:600; }
  .nota { font-size:10px; color:var(--suave); border-left:2.5px solid var(--linea);
          padding-left:9px; margin-top:14px; }
  .firmas { display:flex; gap:52px; margin-top:44px; }
  .firma { flex:1; text-align:center; font-size:10.5px; color:var(--suave); }
  .firma .linea { display:block; border-top:1px solid var(--tinta); margin-bottom:5px; height:34px; }
  .pie { margin-top:26px; border-top:1px solid var(--linea); padding-top:9px;
         font-size:9px; color:var(--suave); }
  .pie .sello { font-family:Consolas,"Courier New",monospace; word-break:break-all; }
  .pie b { color:var(--tinta); }
  .pie .cv { font-size:13px; letter-spacing:2px; color:var(--azul); }

  @media print {
    @page { size:A4; margin:14mm; }
    body { background:#fff; padding:0; font-size:10.5pt; }
    .hoja { box-shadow:none; max-width:none; padding:0; }
    h2, .firmas, .pie { page-break-inside:avoid; }
    table.rep tr { page-break-inside:avoid; }
    table.rep thead { display:table-header-group; }
    table.rep th { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .membrete { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }`;

/** Datos del sello que va al pie del documento (fuera del cuerpo sellado). */
export type Sello = {
  numero: string;
  codigoVerificacion: string;
  hash: string;
  fecha: string;
  urlVerificacion: string;
  borrador?: boolean;
};

/**
 * Envuelve el cuerpo renderizado en un documento HTML completo e imprimible.
 *
 * IMPORTANTE: el pie con el hash NO forma parte del cuerpo sellado. El hash se
 * calcula sobre el cuerpo, y el pie lo IMPRIME. Si el pie estuviera dentro de
 * lo hasheado tendríamos una dependencia circular (hash de un texto que
 * contiene su propio hash) y la verificación sería imposible.
 */
export function documentoCompleto(cuerpoRenderizado: string, sello: Sello, titulo: string): string {
  const pie = sello.borrador
    ? `<div class="pie"><b>PREVISUALIZACIÓN — DOCUMENTO NO EMITIDO.</b>
         Sin número correlativo ni código de verificación: no tiene validez.
         El hash mostrado (<span class="sello">${sello.hash}</span>) corresponde al
         borrador y cambiará al emitir si varían los datos del expediente.</div>`
    : `<div class="pie">
         <div><b>${escapar(sello.numero)}</b> · Emitido el ${escapar(sello.fecha)}</div>
         <div>Código de verificación: <span class="cv">${escapar(sello.codigoVerificacion)}</span>
           · Verifique en ${escapar(sello.urlVerificacion)}</div>
         <div>Sello de integridad SHA-256: <span class="sello">${escapar(sello.hash)}</span></div>
       </div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<style>${ESTILOS_DOCUMENTO}</style>
</head>
<body><div class="hoja">${cuerpoRenderizado}${pie}</div></body>
</html>`;
}

/** Escapado local para no acoplar este módulo al motor (evita import circular). */
function escapar(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
