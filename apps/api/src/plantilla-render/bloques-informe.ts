/**
 * Bloques HTML del informe de ensayo que genera el motor (no la plantilla):
 *   {{tabla_resultados}}   resultados agrupados por muestra o por sección › componente
 *   {{referencias}}        cuadro con los No cumple citando el punto del informe
 *   {{anexo_fotografico}}  fotos elegidas para el informe, con su pie
 *   {{conclusion}}         texto fijo de la plantilla + texto libre del documento
 *   {{portada}}            portada del IVC (propósito, OT, OPI/OC, contrato…)
 *   {{tabla_metodos}}      análisis · método · fecha del análisis (PG09 Anexo 02-02, 3.1)
 *   {{termograma}}         termogramas u otros registros del instrumento (LME)
 *   {{identificacion_muestras}} Nº interno, producto, cliente y datos de recepción
 *
 * TODO valor que viene de la BD se escapa (`escapeHtml`); el HTML lo pone el
 * motor. Solo se usan etiquetas que entiende el PDF (pdf.renderer.ts):
 * h2/h3/h4, p, div, table, img (data URI PNG/JPEG).
 */
import { escapeHtml } from "./html.util";
import type { ConfigInforme } from "./config-informe";
import type { EstructuraInforme, FilaInforme, FilaMetodo } from "./filas-informe";

const GUION = "—";
const celda = (v: string, clase = "") =>
  `<td${clase ? ` class="${clase}"` : ""}>${v && v.trim() !== "" ? escapeHtml(v) : GUION}</td>`;

const minMax = (cfg: ConfigInforme) => cfg.columnasRequisito === "min_max";

function cabecera(est: EstructuraInforme, cfg: ConfigInforme): string {
  const e = cfg.etiquetas;
  const th = (t: string, num = false) => `<th${num ? ' class="num"' : ""}>${escapeHtml(t)}</th>`;
  const cumplimiento = est.modalidad === "cumplimiento";
  return (
    "<thead><tr>" +
    (est.mostrarMuestra ? th(e.muestra) : "") +
    th(e.ensayo) +
    (cfg.columnaMetodo ? th(e.metodo) : "") +
    (cfg.columnaUnidad ? th(e.unidad) : "") +
    (cumplimiento ? (minMax(cfg) ? th(e.minimo, true) + th(e.maximo, true) : th(e.requisito)) : "") +
    th(e.resultado) +
    (est.mostrarEstadisticas ? th("DE", true) + th("CV %", true) : "") +
    (cumplimiento ? th(e.veredicto) : "") +
    "</tr></thead>"
  );
}

function filaHtml(f: FilaInforme, est: EstructuraInforme, cfg: ConfigInforme): string {
  const cumplimiento = est.modalidad === "cumplimiento";
  const requisito = f.requisitoOrigen === "orden" ? `${f.requisito} *` : f.requisito;
  const marca = f.requisitoOrigen === "orden" ? " *" : "";
  const cota = (v: string) => `<td class="num">${escapeHtml(v ? `${v}${marca}` : cfg.textoSinCota || GUION)}</td>`;
  const conUnidad = cfg.unidadEnResultado && f.unidad && f.resultado !== "Sin resultado" ? `${f.resultado} ${f.unidad}` : f.resultado;
  const resultado =
    `<td>${escapeHtml(conUnidad)}` +
    (f.observacion ? `<br><span class="obs">Obs.: ${escapeHtml(f.observacion)}</span>` : "") +
    "</td>";
  const clase = f.veredicto === "cumple" ? "ok" : f.veredicto === "no_cumple" ? "no" : "";
  return (
    "<tr>" +
    (est.mostrarMuestra ? celda(f.muestra) : "") +
    celda(f.ensayo) +
    (cfg.columnaMetodo ? celda(f.metodo) : "") +
    (cfg.columnaUnidad ? celda(f.unidad) : "") +
    (cumplimiento ? (minMax(cfg) ? cota(f.minimo) + cota(f.maximo) : celda(requisito)) : "") +
    resultado +
    (est.mostrarEstadisticas ? celda(f.desviacion, "num") + celda(f.cv, "num") : "") +
    (cumplimiento ? celda(f.veredictoTexto, clase) : "") +
    "</tr>"
  );
}

const tabla = (filas: FilaInforme[], est: EstructuraInforme, cfg: ConfigInforme) =>
  `<table class="rep">${cabecera(est, cfg)}<tbody>${filas.map((f) => filaHtml(f, est, cfg)).join("")}</tbody></table>`;

const conNumero = (n: string | null, t: string) => escapeHtml(n ? `${n} ${t}` : t);

/** `{{tabla_resultados}}` del informe de ensayo. */
export function bloqueResultados(est: EstructuraInforme, cfg: ConfigInforme): string {
  if (!est.secciones.length)
    return `<table class="rep"><tbody><tr><td class="vacio">Sin resultados registrados para esta orden de trabajo.</td></tr></tbody></table>`;
  const cumplimiento = est.modalidad === "cumplimiento";
  const porMuestra = cfg.agrupacion === "muestra";
  const veredictoDe = new Map(est.veredictosMuestra.map((v) => [v.codigo, v]));
  let html = "";
  for (const s of est.secciones) {
    if (s.titulo) html += `<h3>${conNumero(s.numero, s.titulo)}</h3>`;
    for (const c of s.componentes) {
      if (c.titulo) html += `<h4>${conNumero(c.numero, c.titulo)}</h4>`;
      html += tabla(c.filas, est, cfg);
    }
    // Agrupado por muestra: el veredicto de la muestra va bajo su tabla.
    const codigo = s.componentes[0]?.filas[0]?.muestra;
    const v = codigo ? veredictoDe.get(codigo) : undefined;
    if (cumplimiento && porMuestra && v && s.titulo.startsWith(`Muestra ${codigo}`))
      html += `<p class="veredicto-muestra">Veredicto de la muestra ${escapeHtml(v.codigo)}: <b>${escapeHtml(v.texto)}</b></p>`;
  }
  if (cumplimiento && !porMuestra && est.veredictosMuestra.length) {
    html +=
      `<p class="veredicto-muestra">` +
      est.veredictosMuestra
        .map((v) => `Veredicto de la muestra ${escapeHtml(v.codigo)}${v.nombre ? ` (${escapeHtml(v.nombre)})` : ""}: <b>${escapeHtml(v.texto)}</b>`)
        .join("<br>") +
      "</p>";
  }
  const notas: string[] = [];
  if (est.hayRequisitoDeOrden)
    notas.push("* Requisito fijado para esta orden de trabajo (completa o reemplaza el del catálogo).");
  if (est.mostrarEstadisticas) notas.push("DE: desviación estándar; CV: coeficiente de variación de las réplicas.");
  if (cumplimiento && est.secciones.some((s) => s.componentes.some((c) => c.filas.some((f) => f.requisitoOrigen === null))))
    notas.push("«No especificado»: el ensayo no tiene requisito; el resultado es informativo.");
  if (notas.length) html += `<p class="nota">${notas.map(escapeHtml).join("<br>")}</p>`;
  return html;
}

/** `{{referencias}}`: los No cumple, citando el punto del informe. */
export function bloqueReferencias(est: EstructuraInforme, cfg: ConfigInforme): string {
  if (est.modalidad !== "cumplimiento" || !cfg.referencias || !est.referencias.length) return "";
  return (
    `<h2>Referencias</h2><table class="rep ref"><tbody>` +
    est.referencias.map((r) => `<tr><td>${escapeHtml(r.texto)}</td></tr>`).join("") +
    `</tbody></table>`
  );
}

export interface FotoInforme {
  mime: string;
  datos: string; // base64
  pie: string | null;
  punto: string | null;
  titulo: string | null;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** `{{anexo_fotografico}}`: fotos con su pie, que remite al punto del informe. */
export function bloqueAnexo(fotos: FotoInforme[], cfg: ConfigInforme): string {
  if (!cfg.anexoFotografico) return "";
  const validas = fotos.filter((f) => /^image\/(png|jpeg)$/.test(f.mime) && BASE64.test(f.datos));
  if (!validas.length) return "";
  return (
    `<h2>Anexo fotográfico</h2>` +
    validas
      .map((f, i) => {
        const ref = [f.punto ? `Punto ${f.punto}` : "", f.titulo ?? ""].filter(Boolean).join(" ");
        const pie = [`Foto ${i + 1}`, ref, f.pie ?? ""].filter((x) => x && x.trim()).join(" · ");
        return `<div class="foto"><img src="data:${f.mime};base64,${f.datos}" alt="Foto ${i + 1}"><p class="pie-foto">${escapeHtml(pie)}</p></div>`;
      })
      .join("")
  );
}

/**
 * `{{termograma}}`: termogramas (u otro registro gráfico del instrumento) de la
 * OT marcados para el informe, con su pie. Vacío si no hay.
 */
export function bloqueTermograma(fotos: FotoInforme[]): string {
  const validas = fotos.filter((f) => /^image\/(png|jpeg)$/.test(f.mime) && BASE64.test(f.datos));
  if (!validas.length) return "";
  return validas
    .map((f, i) => {
      const pie = [`Termograma ${i + 1}`, f.titulo ?? "", f.pie ?? ""].filter((x) => x && x.trim()).join(" · ");
      return `<div class="foto termograma"><img src="data:${f.mime};base64,${f.datos}" alt="Termograma ${i + 1}"><p class="pie-foto">${escapeHtml(pie)}</p></div>`;
    })
    .join("");
}

/** `{{tabla_metodos}}`: análisis, método y fecha y hora del análisis. */
export function bloqueMetodos(filas: FilaMetodo[]): string {
  if (!filas.length) return `<table class="rep"><tbody><tr><td class="vacio">Sin ensayos registrados.</td></tr></tbody></table>`;
  return (
    `<table class="rep"><thead><tr><th>Análisis</th><th>Método</th><th>Fecha del análisis</th></tr></thead><tbody>` +
    filas.map((f) => `<tr>${celda(f.analisis)}${celda(f.metodo)}${celda(f.fechas)}</tr>`).join("") +
    `</tbody></table>`
  );
}

/** Identificación de una muestra para el informe (recepción R1). */
export interface IdentificacionMuestra {
  codigo: string;
  nombre: string | null;
  numeroInterno: string | null;
  producto: string | null;
  cliente: string | null;
  identificacionCliente: string | null;
  /** Datos propios de la recepción ya con su etiqueta («Lote», «Fabricante»…). */
  datos: { etiqueta: string; valor: string }[];
}

/** `{{identificacion_muestras}}`: un renglón por muestra con lo registrado al recibirla. */
export function bloqueIdentificacion(ms: IdentificacionMuestra[]): string {
  if (!ms.length) return `<p class="nota">Sin muestras registradas.</p>`;
  return ms
    .map((m) => {
      const partes = [
        m.nombre ?? "",
        m.producto ? `Producto: ${m.producto}` : "",
        m.identificacionCliente ? `Identificación del cliente: ${m.identificacionCliente}` : "",
        m.cliente ? `Cliente: ${m.cliente}` : "",
        ...m.datos.map((d) => `${d.etiqueta}: ${d.valor}`),
      ].filter((x) => x.trim());
      const cab = `Muestra ${m.codigo}${m.numeroInterno ? ` · Nº ${m.numeroInterno}` : ""}`;
      return `<p><b>${escapeHtml(cab)}</b>${partes.length ? `<br>${escapeHtml(partes.join(". "))}.` : ""}</p>`;
    })
    .join("");
}

/** `{{conclusion}}`: texto fijo de la plantilla y texto libre del documento. */
export function bloqueConclusion(cfg: ConfigInforme, libre: string | null | undefined, conTitulo = true): string {
  const parrafos = [cfg.conclusionFija ?? "", ...(libre ?? "").split(/\r?\n+/)]
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parrafos.length) return "";
  const cuerpo = parrafos.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return conTitulo ? `<h2>Conclusión</h2>${cuerpo}` : cuerpo;
}

/** Datos de la portada del IVC (elegidos al emitir; los de la OT vienen propuestos). */
export interface DatosPortada {
  proposito?: string | null;
  opiOc?: string | null;
  fechaOpi?: string | null;
  contrato?: string | null;
  fechaContrato?: string | null;
  proyecto?: string | null;
  proveedor?: string | null;
  item?: string | null;
  cantidad?: string | null;
  fabricante?: string | null;
  paisOrigen?: string | null;
}

/** `{{portada}}` del Informe de Verificación de Calidad. */
export function bloquePortadaIvc(
  d: DatosPortada,
  fijos: { numero: string; ot: string; fechaOt: string; fecha: string },
): string {
  const v = (x: string | null | undefined) => (x && x.trim() ? escapeHtml(x.trim()) : "N/A");
  return (
    `<table class="meta portada">` +
    `<tr><th>Propósito del documento</th><td colspan="3">${v(d.proposito)}</td></tr>` +
    `<tr><th>Identificación del documento</th><td colspan="3">${escapeHtml(fijos.numero)}</td></tr>` +
    `<tr><th>N.º O/T</th><td>${escapeHtml(fijos.ot)}</td><th>Fecha de O/T</th><td>${v(fijos.fechaOt)}</td></tr>` +
    `<tr><th>N.º OPI / Orden de compra</th><td>${v(d.opiOc)}</td><th>Fecha OPI</th><td>${v(d.fechaOpi)}</td></tr>` +
    `<tr><th>Contrato</th><td>${v(d.contrato)}</td><th>Fecha de contrato</th><td>${v(d.fechaContrato)}</td></tr>` +
    `<tr><th>Nombre del proyecto</th><td colspan="3">${v(d.proyecto)}</td></tr>` +
    `<tr><th>Proveedor</th><td colspan="3">${v(d.proveedor)}</td></tr>` +
    `<tr><th>Identificación del ítem</th><td>${v(d.item)}</td><th>Cantidad</th><td>${v(d.cantidad)}</td></tr>` +
    `<tr><th>Fabricante</th><td>${v(d.fabricante)}</td><th>País de origen</th><td>${v(d.paisOrigen)}</td></tr>` +
    `<tr><th>Fecha de elaboración</th><td>${escapeHtml(fijos.fecha)}</td><th>N.º de páginas</th><td class="n-paginas">Ver pie de página</td></tr>` +
    `</table>`
  );
}

/** Bloque de firmas de las plantillas (el circuito lo sustituye al presentar). */
const RE_FIRMAS = /<div class="firmas">/;

/**
 * Asegura que el cuerpo tenga los bloques que pide el formato aunque la
 * plantilla (sembrada antes de esta versión) no los nombre: referencias, anexo
 * y conclusión antes del bloque de firmas (o al final); la portada antes del
 * primer título. Solo añade marcadores; el contenido lo pone el motor y queda
 * vacío si no aplica.
 */
export function completarCuerpo(cuerpo: string, cfg: ConfigInforme): string {
  let out = cuerpo;
  const tiene = (t: string) => new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`).test(out);
  const finales = ["referencias", "anexo_fotografico", "conclusion"]
    .filter((t) => !tiene(t) && !(t === "conclusion" && tiene("conclusion_texto")))
    .map((t) => `{{${t}}}`);
  if (finales.length) {
    const bloque = `\n${finales.join("\n")}\n`;
    out = RE_FIRMAS.test(out) ? out.replace(RE_FIRMAS, `${bloque}<div class="firmas">`) : `${out}${bloque}`;
  }
  if (cfg.portada === "ivc" && !tiene("portada")) {
    const i = out.search(/<h1[\s>]/i);
    if (i >= 0) {
      const fin = out.indexOf("</h1>", i);
      out = fin >= 0 ? `${out.slice(0, fin + 5)}\n{{portada}}\n${out.slice(fin + 5)}` : `{{portada}}\n${out}`;
    } else out = `{{portada}}\n${out}`;
  }
  return out;
}
