/**
 * Informe trimestral de encuestas · cuerpo del PDF (formato de los Anexos 01 a
 * 06 de DCO-PG01-P04-IT05) y hojas del Excel (planilla de análisis del
 * Departamento Comercial). Funciones PURAS (informe-trimestral.documento.spec.ts).
 *
 * El PDF lo dibuja el motor común (plantilla-render/pdf.renderer.ts, subconjunto
 * de HTML): todo dato se escapa. La firma del Jefe del Departamento Comercial se
 * estampa a mano sobre el papel (el LIMS no firma documentos del Estado).
 */
import { escapeHtml as esc } from "../plantilla-render/html.util";
import type { Celda, Hoja } from "../common/xlsx-escritura";
import { ETIQUETA_TRIMESTRE, textoNota, textoPct, type InformeTrimestral, type SeccionInforme } from "./informe-trimestral";

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r0 = (v: number | null) => (v === null ? null : Math.round(v));
const dos = (n: number) => String(n).padStart(2, "0");

/** Código del anexo: «DCO-PG01-P04-IT05-Anexo04». */
export function codigoAnexo(s: SeccionInforme["tipo"]): string {
  return s.anexoNumero ? `${s.instruccion}-Anexo${s.anexoNumero}` : s.instruccion;
}

function seccionHtml(inf: InformeTrimestral, s: SeccionInforme): string {
  const t = s.tipo;
  const g = t.agruparPor === "sucursal" ? "SUCURSAL" : "LABORATORIO";
  const items = s.items.length
    ? s.items.map((i) => `<tr><td>${esc(i.texto)}</td><td class="num">${textoNota(i.promedio)}</td><td class="num">${textoPct(i.indice)}</td></tr>`).join("")
    : `<tr><td class="vacio" colspan="3">Sin encuestas contestadas en el trimestre.</td></tr>`;
  const grupos = s.grupos.length
    ? s.grupos.map((x) => `<tr><td>${esc(x.grupo)}</td><td class="num">${textoNota(x.promedio)}</td><td class="num">${textoPct(x.indice)}</td></tr>`).join("")
    : `<tr><td class="vacio" colspan="3">Sin encuestas contestadas en el trimestre.</td></tr>`;
  const obs = s.observaciones.length
    ? `<h2>Observaciones señaladas por los encuestados</h2><ul>${s.observaciones.map((o) => `<li><b>${esc(o.referencia)}</b> (${esc(o.grupo)}): ${esc(o.texto)}</li>`).join("")}</ul>`
    : "";
  const a = s.aplicacion;
  const dist = t.distribucion.length ? `<p><b>DISTRIBUCIÓN:</b></p><ol>${t.distribucion.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>` : "";
  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b><span>Ejército de Chile &middot; Departamento Comercial</span></div>
  <div class="doc"><b>${esc(codigoAnexo(t))}</b><span>Revisión ${esc(t.anexoRevision ?? "—")}</span></div>
</div>
<table class="meta">
  <tr><th>Instrucción de Trabajo</th><td>${esc(t.instruccion)}</td><th>Fecha de emisión</th><td>${esc(t.anexoEmision ?? "—")}</td></tr>
  <tr><th>Anexo Nº</th><td>${esc(t.anexoNumero ?? "—")}</td><th>Revisión Nº</th><td>${esc(t.anexoRevision ?? "—")}</td></tr>
  <tr><th>Formulario de encuesta</th><td colspan="3">${esc(t.formulario)}${t.formularioRevision ? ` · Revisión ${esc(t.formularioRevision)}` : ""} · ${esc(t.nombre)}</td></tr>
</table>
<h1>${esc(t.tituloInforme)}</h1>
<p>En conformidad a lo estipulado en el IDIC-PG02-Anexo02 «Objetivos de la Calidad y sus indicadores», adjunto se remite cuadro informe de ${esc(t.objetoInforme)}, correspondiente al ${esc(inf.texto)}.</p>
<table class="rep">
  <thead><tr><th>TRIMESTRES · AÑO ${inf.anio}</th><th class="num">${ETIQUETA_TRIMESTRE[inf.trimestre - 1]} TRIMESTRE</th></tr></thead>
  <tbody>
    <tr><td>TOTAL Nº DE ENCUESTAS CONTESTADAS</td><td class="num">${dos(s.resumen.contestadas)}</td></tr>
    <tr><td>TOTAL Nº DE ENCUESTAS CON ÍNDICE DE SATISFACCIÓN AL CLIENTE SOBRE EL ${Math.round(t.umbralPct)} %</td><td class="num">${dos(s.resumen.sobreUmbral)}</td></tr>
    <tr><td>PORCENTAJE DE ENCUESTAS CON ÍNDICE DE SATISFACCIÓN AL CLIENTE SOBRE ${Math.round(t.umbralPct)} %</td><td class="num">${s.resumen.porcentajeSobreUmbral === null ? "0 %" : textoPct(s.resumen.porcentajeSobreUmbral)}</td></tr>
  </tbody>
</table>
<table class="rep">
  <thead><tr><th>ÍTEMES</th><th class="num">EVALUACIÓN PROMEDIO</th><th class="num">ÍNDICE SATISFACCIÓN PROMEDIO</th></tr></thead>
  <tbody>${items}</tbody>
</table>
<table class="rep">
  <thead><tr><th>${g}</th><th class="num">EVALUACIÓN PROMEDIO</th><th class="num">ÍNDICE SATISFACCIÓN PROMEDIO</th></tr></thead>
  <tbody>${grupos}</tbody>
</table>
${obs}
<h2>Control de aplicación de las encuestas</h2>
<table class="rep compacta">
  <thead><tr><th>Encuestas del trimestre</th><th class="num">Contestadas</th><th class="num">Pendientes</th><th class="num">Sin respuesta</th><th class="num">Tasa de respuesta</th></tr></thead>
  <tbody><tr><td class="num">${a.total}</td><td class="num">${a.contestadas}</td><td class="num">${a.pendientes}</td><td class="num">${a.sinRespuesta}</td><td class="num">${textoPct(a.tasaRespuesta)}</td></tr></tbody>
</table>
${a.gruposSinContestar.length ? `<p class="nota">Sin ninguna encuesta contestada en el trimestre (la instrucción pide al menos una por laboratorio): ${a.gruposSinContestar.map(esc).join(", ")}.</p>` : ""}
<p>Saluda a UD.</p>
<div class="firmas"><div class="firma">Jefe Departamento Comercial</div></div>
${dist}`;
}

/** Cuerpo HTML del PDF: un anexo por formulario, cada uno en su página. */
export function cuerpoInformeHtml(inf: InformeTrimestral): string {
  if (!inf.secciones.length) return `<h1>Informe de encuestas · ${esc(inf.etiqueta)}</h1><p>No hay formularios de encuesta activos.</p>`;
  return inf.secciones.map((s) => seccionHtml(inf, s)).join(`\n<div class="salto-pagina"></div>\n`);
}

/** Nombre de hoja de Excel (máx. 31 caracteres). */
const hojaNombre = (s: SeccionInforme) => `${s.tipo.codigo} ${s.tipo.nombre}`.replace(/[\\/?*[\]:]/g, "").slice(0, 31);

/** Hojas del Excel: Resumen (cuadros de cada anexo) + una planilla de análisis por formulario. */
export function hojasInforme(inf: InformeTrimestral): Hoja[] {
  const resumen: Celda[][] = [
    ["Formulario", "Anexo", "Contestadas", `Con índice sobre el umbral`, "% sobre el umbral", "Evaluación promedio", "Índice promedio (%)", "Encuestas del trimestre", "Pendientes", "Sin respuesta", "Tasa de respuesta (%)", "Contestadas trim. anterior", "Evaluación trim. anterior"],
    ...inf.secciones.map((s): Celda[] => [
      `${s.tipo.formulario} · ${s.tipo.nombre}`,
      codigoAnexo(s.tipo),
      s.resumen.contestadas,
      s.resumen.sobreUmbral,
      r0(s.resumen.porcentajeSobreUmbral),
      r1(s.resumen.promedio),
      r0(s.resumen.indice),
      s.aplicacion.total,
      s.aplicacion.pendientes,
      s.aplicacion.sinRespuesta,
      r0(s.aplicacion.tasaRespuesta),
      s.anterior?.contestadas ?? null,
      r1(s.anterior?.promedio ?? null),
    ]),
    [],
    [`RESUMEN DE ENCUESTAS ${inf.etiqueta} (${inf.desde} a ${inf.hasta}, sin incluir el último día)`],
    ["Índice = promedio de notas / nota máxima. El trimestre se toma de la fecha del servicio (cierre de la OT o vencimiento de la cotización)."],
    ...(inf.sinTipo ? [[`${inf.sinTipo} encuesta(s) del trimestre no tienen formulario asignado y no entran en ningún anexo.`]] : []),
  ];
  const hojas: Hoja[] = [{ nombre: "Resumen", filas: resumen, anchos: [46, 26, 12, 14, 12, 12, 12, 14, 11, 11, 12, 14, 14] }];

  for (const s of inf.secciones) {
    const g = s.tipo.agruparPor === "sucursal" ? "Sucursal" : "Laboratorio";
    const cab: Celda[] = ["Ítem", ...s.detalle.map((d) => `${d.grupo} / ${d.referencia}`), "Nota prom.", "Índice prom. (%)"];
    const filas: Celda[][] = [cab];
    for (const it of s.items)
      filas.push([it.texto, ...s.detalle.map((d) => d.valores[it.codigo] ?? null), r1(it.promedio), r0(it.indice)]);
    filas.push(["Suma", ...s.detalle.map((d) => d.suma)]);
    filas.push(["Promedio", ...s.detalle.map((d) => r1(d.promedio))]);
    filas.push(["Índice satisfacción del cliente (%)", ...s.detalle.map((d) => r0(d.indice))]);
    filas.push(["Sobre el umbral", ...s.detalle.map((d) => (d.sobreUmbral ? "Sí" : "No"))]);
    filas.push([]);
    filas.push([g, "Contestadas", "Evaluación promedio", "Índice promedio (%)"]);
    for (const x of s.grupos) filas.push([x.grupo, x.contestadas, r1(x.promedio), r0(x.indice)]);
    filas.push([]);
    filas.push(["OBSERVACIONES SEÑALADAS POR ENCUESTADOS"]);
    if (s.observaciones.length) for (const o of s.observaciones) filas.push([`${o.grupo} / ${o.referencia}: ${o.texto}`]);
    else filas.push(["Sin observaciones."]);
    if (s.aplicacion.gruposSinContestar.length) {
      filas.push([]);
      filas.push([`${g}s sin ninguna encuesta contestada: ${s.aplicacion.gruposSinContestar.join(", ")}`]);
    }
    hojas.push({ nombre: hojaNombre(s), filas, anchos: [60, ...s.detalle.map(() => 16), 12, 14] });
  }
  return hojas;
}
