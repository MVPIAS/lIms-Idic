/**
 * Generación del PDF/A del informe SIN navegador headless.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN: pdfkit + renderizador de un subconjunto de HTML
 * ---------------------------------------------------------------------------
 * El contenedor de la API es `node:20-alpine`. Se descartaron:
 *   · Puppeteer / html-pdf-node / Playwright -> arrastran Chromium (~300 MB),
 *     requieren `apk add chromium nss freetype harfbuzz ttf-*` y un `--no-sandbox`
 *     que es justo lo que no queremos en un servicio que renderiza HTML con
 *     datos de usuario. Multiplican por 5 el tamaño de imagen y el tiempo de build.
 *     Además Chromium NO produce PDF/A: habría que post-procesar igualmente.
 *   · Gotenberg / servicio externo -> es Chromium en otro contenedor: nueva pieza
 *     de infraestructura que operar, y el proyecto es on-premise a 2 meses.
 *   · @react-pdf/renderer -> tampoco entiende HTML (su DSL son componentes React)
 *     y mete React en el runtime de la API para nada.
 *   · Ghostscript (`-dPDFA`) -> binario nativo pesado y de licencia AGPL/comercial.
 *
 * `pdfkit` es JavaScript puro: sus dependencias (fontkit, linebreak, png-js) no
 * traen ningún binario `.node`, así que funciona en Alpine/musl tal cual, sin
 * `apk add` ni paso de build extra. Verificado en este repo.
 *
 * El coste de pdfkit es que dibuja primitivas, no HTML. Por eso este módulo
 * implementa un renderizador del SUBCONJUNTO de HTML que usan las plantillas:
 * h1/h2/h3, p, div, br, hr, strong/b, em/i, ul/ol/li, y table/thead/tbody/tr/th/td
 * con `class="num"`. Es un subconjunto CONTROLADO: los cuerpos los siembra
 * `align_certificado.sql`. Lo que no reconoce degrada a texto plano en vez de
 * romper: ninguna plantilla puede tumbar la descarga.
 *
 * ---------------------------------------------------------------------------
 * PDF/A-3b (ISO 19005-3, nivel B)
 * ---------------------------------------------------------------------------
 * El PDF era antes un 1.3 corriente. Ahora se emite como PDF/A-3b, que es lo que
 * pide un documento con valor probatorio que se archiva décadas y va a
 * acreditación ISO 17025. Lo aporta pdfkit >= 0.14 con `subset: 'PDF/A-3b'`, que
 * escribe el OutputIntent sRGB (con el perfil ICC que la propia librería trae),
 * el XMP con el identificador `pdfaid` y el `ID` del trailer. Aquí se añade lo
 * que la librería NO puede saber:
 *   · `pdfVersion: '1.7'`  — sin esto pdfkit escribe 1.3 y NO emite el stream
 *     Metadata (ver `endMetadata`), con lo que no habría XMP y no sería PDF/A.
 *   · Fuentes TTF incrustadas (assets/fuentes.ts): las estándar no valen.
 *   · Saneado del texto y de `info` (assets/fuentes.ts): glifos que existan y
 *     XMP que no se pueda romper con un `&` en el título.
 *   · Cero transparencia (ver `marcaDeAgua`).
 *   · El cuerpo HTML sellado incrustado como fichero asociado (ver `generarPdf`).
 *
 * POR QUÉ A-3b Y NO A-2b: la única diferencia relevante es que PDF/A-3 permite
 * incrustar ficheros arbitrarios y PDF/A-2 no. Se aprovecha para meter DENTRO
 * del PDF el cuerpo HTML exacto sobre el que se calculó el SHA-256, con
 * AFRelationship /Source. Así el PDF es autoverificable: quien lo recibe puede
 * extraer el HTML, rehashearlo y comparar con el sello impreso, sin acceso al
 * LIMS. Es el mismo patrón que ZUGFeRD/Factur-X con su XML. Sin ese fichero
 * asociado no habría razón para A-3 y lo correcto sería A-2b.
 *
 * Nivel B (Basic) = fidelidad visual garantizada. El nivel A exige además
 * estructura semántica (PDF con tags) y no lo aporta: implicaría reconstruir el
 * árbol de marcado y no es requisito de archivo ni de la acreditación.
 *
 * CONFORMIDAD VERIFICADA con veraPDF 1.30.2 (validador de referencia de la PDF
 * Association) sobre la salida real de este módulo, incluido el caso de varias
 * páginas y el de tabla vacía. No es una afirmación de diseño: ver el informe.
 */
import PDFDocument from "pdfkit";
import { decodeEntities } from "./html.util";
import { avisoEstado, textoAccion, type FirmaEstampada, type Sello } from "./plantilla-defecto";
import {
  registrarFuentes,
  sanearParaFuente,
  sanearParaMetadatos,
  REGULAR,
  NEGRITA,
  CURSIVA,
  MONO,
  MONO_NEGRITA,
} from "./assets/fuentes";

/* ========================================================================== */
/* 1. Parser de un subconjunto de HTML                                         */
/* ========================================================================== */

type Nodo = { tag: string; clase: string; hijos: Nodo[]; texto?: string; src?: string; colspan?: number };

const VACIOS = new Set(["br", "hr", "img", "meta", "link", "input", "col"]);
/** Estos nunca deben llegar al PDF: se descarta su contenido entero. */
const IGNORADOS = new Set(["script", "style", "head", "title"]);

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;

function leerClase(attrs: string): string {
  return leerAtributo(attrs, "class");
}

function leerAtributo(attrs: string, nombre: string): string {
  const m = new RegExp(`(?:^|\\s)${nombre}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return (m?.[2] ?? m?.[3] ?? "").trim();
}

/** Solo imágenes incrustadas PNG/JPEG en base64: nada de URLs ni ficheros. */
const DATA_IMAGEN = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Convierte HTML en un árbol. Tolerante: las etiquetas de cierre huérfanas se
 * ignoran y las que quedan abiertas se cierran al final del documento.
 */
export function parsearHtml(html: string): Nodo {
  const raiz: Nodo = { tag: "#root", clase: "", hijos: [] };
  const pila: Nodo[] = [raiz];
  const cima = () => pila[pila.length - 1];
  let ignorarHasta: string | null = null;
  let pos = 0;
  let m: RegExpExecArray | null;

  TAG.lastIndex = 0;
  while ((m = TAG.exec(html)) !== null) {
    const [completo, cierre, nombreCrudo, attrs, autocierre] = m;
    const tag = (nombreCrudo ?? "").toLowerCase();

    // Texto acumulado antes de esta etiqueta.
    if (m.index > pos && !ignorarHasta) {
      const texto = html.slice(pos, m.index);
      if (texto.trim() !== "") cima().hijos.push({ tag: "#text", clase: "", hijos: [], texto });
    }
    pos = m.index + completo.length;

    if (completo.startsWith("<!--")) continue;

    if (ignorarHasta) {
      if (cierre && tag === ignorarHasta) ignorarHasta = null;
      continue;
    }
    if (!cierre && IGNORADOS.has(tag)) {
      if (!autocierre) ignorarHasta = tag;
      continue;
    }

    if (cierre) {
      // Cierra hasta el primero que coincida; si no está abierto, se ignora.
      const i = pila.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) pila.length = i;
      continue;
    }

    const nodo: Nodo = { tag, clase: leerClase(attrs ?? ""), hijos: [] };
    if (tag === "img") nodo.src = leerAtributo(attrs ?? "", "src");
    if (tag === "td" || tag === "th") {
      const cs = Number(leerAtributo(attrs ?? "", "colspan"));
      if (Number.isInteger(cs) && cs > 1 && cs <= 12) nodo.colspan = cs;
    }
    cima().hijos.push(nodo);
    if (!autocierre && !VACIOS.has(tag)) pila.push(nodo);
  }

  if (pos < html.length && !ignorarHasta) {
    const texto = html.slice(pos);
    if (texto.trim() !== "") cima().hijos.push({ tag: "#text", clase: "", hijos: [], texto });
  }
  return raiz;
}

/* ========================================================================== */
/* 2. Texto: entidades + saneado al repertorio de las fuentes incrustadas      */
/* ========================================================================== */

/**
 * Saneado del texto. Antes el criterio era WinAnsiEncoding (el de Helvetica);
 * ahora es el repertorio REAL de los TTF incrustados, que es lo que PDF/A
 * obliga a respetar: un glifo que no esté en la fuente incrustada es una no
 * conformidad, no un defecto cosmético.
 *
 * La lógica vive en `assets/fuentes.ts`, junto a las fuentes cuyo repertorio
 * describe: si mañana se cambia la fuente, el filtro está en el mismo sitio y
 * no se queda desincronizado.
 *
 * Se conserva `aWinAnsi` como alias porque era API pública de este módulo, pero
 * su nombre ya miente: internamente no queda nada de WinAnsi.
 *
 * @deprecated Usar `sanearParaFuente` de `./assets/fuentes`.
 */
export const aWinAnsi = sanearParaFuente;

/** Texto de un nodo: entidades decodificadas, espacios colapsados, saneado. */
function textoDe(nodo: Nodo): string {
  let out = "";
  const visitar = (n: Nodo) => {
    if (n.tag === "#text") out += n.texto ?? "";
    else if (n.tag === "br") out += " ";
    else n.hijos.forEach(visitar);
  };
  visitar(nodo);
  return sanearParaFuente(decodeEntities(out)).replace(/\s+/g, " ").trim();
}

/* ========================================================================== */
/* 3. Layout                                                                   */
/* ========================================================================== */

const AZUL = "#123a63";
const TINTA = "#12212f";
const SUAVE = "#5b6b7c";
const LINEA = "#c9d4de";
const VERDE = "#155e3d";
const ROJO = "#7d1f1f";

const MARGEN = 42; // ~15 mm

/**
 * REGULAR / NEGRITA / CURSIVA / MONO / MONO_NEGRITA ya no son las fuentes
 * estándar de PDF: son los nombres de las caras Noto que se incrustan (ver
 * `assets/fuentes.ts`). Se importan en vez de declararse aquí para que exista
 * UN solo sitio donde se decide qué fuente se incrusta y con qué nombre.
 */
type Doc = PDFKit.PDFDocument;

const anchoUtil = (doc: Doc) => doc.page.width - MARGEN * 2;
const fondo = (doc: Doc) => doc.page.height - MARGEN - 26; // hueco para el pie

/** Salta de página si no caben `alto` puntos. */
function asegurar(doc: Doc, alto: number): void {
  if (doc.y + alto > fondo(doc)) doc.addPage();
}

function dibujarMembrete(doc: Doc, nodo: Nodo): void {
  const x = MARGEN;
  const y = doc.y;
  const org = nodo.hijos.find((h) => h.clase === "org");
  const docu = nodo.hijos.find((h) => h.clase === "doc");
  const escudo = nodo.hijos.find((h) => h.clase === "escudo");

  doc.circle(x + 16, y + 16, 16).fill(AZUL);
  doc.font(NEGRITA).fontSize(7.5).fillColor("#ffffff");
  doc.text(textoDe(escudo ?? { tag: "", clase: "", hijos: [] }) || "IDIC", x, y + 13, {
    width: 32,
    align: "center",
  });

  const orgB = org?.hijos.find((h) => h.tag === "b");
  const orgS = org?.hijos.find((h) => h.tag === "span");
  doc.font(NEGRITA).fontSize(9.5).fillColor(AZUL);
  doc.text(textoDe(orgB ?? { tag: "", clase: "", hijos: [] }), x + 42, y + 4, { width: 290 });
  doc.font(REGULAR).fontSize(7.5).fillColor(SUAVE);
  doc.text(textoDe(orgS ?? { tag: "", clase: "", hijos: [] }), x + 42, doc.y + 1, { width: 290 });

  const docB = docu?.hijos.find((h) => h.tag === "b");
  const docS = docu?.hijos.find((h) => h.tag === "span");
  const anchoDer = 170;
  const xDer = doc.page.width - MARGEN - anchoDer;
  doc.font(MONO_NEGRITA).fontSize(10).fillColor(AZUL);
  doc.text(textoDe(docB ?? { tag: "", clase: "", hijos: [] }), xDer, y + 5, {
    width: anchoDer,
    align: "right",
  });
  doc.font(REGULAR).fontSize(7).fillColor(SUAVE);
  doc.text(textoDe(docS ?? { tag: "", clase: "", hijos: [] }), xDer, doc.y + 1, {
    width: anchoDer,
    align: "right",
  });

  const yLinea = Math.max(y + 38, doc.y + 6);
  doc.moveTo(x, yLinea).lineTo(doc.page.width - MARGEN, yLinea).lineWidth(1.6).stroke(AZUL);
  doc.y = yLinea + 12;
  doc.x = MARGEN;
  doc.fillColor(TINTA).lineWidth(1);
}

/**
 * Firmas del circuito que se dibujan en vez del bloque de la plantilla. Se
 * cuelgan del propio documento pdfkit (y no de una variable de módulo) para que
 * dos PDF generados a la vez no se mezclen.
 */
type DocConFirmas = Doc & {
  _firmasCircuito?: FirmaEstampada[];
  _firmasDibujadas?: boolean;
  /** Celdas «N.º de páginas» pendientes de rellenar (portada del IVC). */
  _nPaginas?: { pagina: number; x: number; y: number; w: number }[];
};

/** Rellena las celdas «N.º de páginas» con el total, ya conocido. */
function rellenarNumeroPaginas(doc: Doc): void {
  const pend = (doc as DocConFirmas)._nPaginas ?? [];
  if (!pend.length) return;
  const total = doc.bufferedPageRange().count;
  for (const p of pend) {
    doc.switchToPage(p.pagina);
    const margen = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(REGULAR).fontSize(8).fillColor(TINTA);
    doc.text(String(total), p.x, p.y, { width: p.w, lineBreak: false });
    doc.page.margins.bottom = margen;
  }
}

/**
 * Foto del anexo fotográfico: imagen (PNG/JPEG incrustada) ajustada al ancho
 * útil y a 300 pt de alto, centrada, con su pie debajo. Una imagen ilegible no
 * tumba el documento: se imprime el pie con el aviso.
 */
function dibujarFoto(doc: Doc, nodo: Nodo): void {
  const img = nodo.hijos.find((h) => h.tag === "img");
  const pie = nodo.hijos.filter((h) => h.tag !== "img").map(textoDe).filter(Boolean).join(" ");
  const m = img?.src ? DATA_IMAGEN.exec(img.src) : null;
  const maxW = anchoUtil(doc);
  const maxH = 300;
  let w = 0;
  let h = 0;
  let buf: Buffer | null = null;
  if (m) {
    try {
      buf = Buffer.from(m[2], "base64");
      const abierta = (doc as any).openImage(buf) as { width: number; height: number };
      const k = Math.min(maxW / abierta.width, maxH / abierta.height, 1);
      w = abierta.width * k;
      h = abierta.height * k;
    } catch {
      buf = null;
    }
  }
  asegurar(doc, (buf ? h : 0) + 30);
  const y0 = doc.y + 4;
  const x0 = MARGEN + (maxW - w) / 2;
  if (buf) {
    doc.image(buf, x0, y0, { width: w, height: h });
    doc.rect(x0, y0, w, h).lineWidth(0.5).stroke(LINEA);
  }
  doc.font(CURSIVA).fontSize(7.4).fillColor(SUAVE);
  doc.text(buf ? pie : `${pie} (imagen no disponible)`, MARGEN, y0 + (buf ? h : 0) + 4, { width: maxW, align: "center" });
  doc.y += 6;
  doc.x = MARGEN;
  doc.fillColor(TINTA);
}

/** Firmas electrónicas: imagen (si hay), línea, nombre, cargo, acción y fecha. */
function dibujarFirmasCircuito(doc: Doc, firmas: FirmaEstampada[]): void {
  const porFila = Math.min(3, Math.max(1, firmas.length));
  const sep = 26;
  const ancho = (anchoUtil(doc) - sep * (porFila - 1)) / porFila;
  for (let i = 0; i < firmas.length; i += porFila) {
    const fila = firmas.slice(i, i + porFila);
    asegurar(doc, 96);
    const y0 = doc.y + 8;
    let maxY = y0;
    fila.forEach((f, j) => {
      const x = MARGEN + j * (ancho + sep);
      const altoImg = 34;
      if (f.imagen && !f.pendiente) {
        try {
          doc.image(Buffer.from(f.imagen.data, "base64"), x + 10, y0, {
            fit: [ancho - 20, altoImg],
            align: "center",
            valign: "bottom",
          });
        } catch {
          /* imagen ilegible: se firma sin imagen */
        }
      }
      const yLinea = y0 + altoImg + 3;
      doc.moveTo(x, yLinea).lineTo(x + ancho, yLinea).lineWidth(0.8).stroke(TINTA);
      let y = yLinea + 4;
      const linea = (texto: string, fuente: string, tam: number, color: string) => {
        if (!texto) return;
        doc.font(fuente).fontSize(tam).fillColor(color);
        doc.text(sanearParaFuente(texto), x, y, { width: ancho, align: "center" });
        y = doc.y + 0.5;
      };
      linea(f.nombre ?? "", NEGRITA, 8, TINTA);
      linea(f.cargo ?? "", REGULAR, 7, SUAVE);
      linea(`${textoAccion(f.accion)} · ${f.rol}${f.unidad ? ` · ${f.unidad}` : ""}`, REGULAR, 6.6, SUAVE);
      linea(f.pendiente ? "Pendiente de firma" : `Firmado electrónicamente el ${f.fecha ?? ""}`, f.pendiente ? CURSIVA : REGULAR, 6.6, f.pendiente ? "#9a5b00" : VERDE);
      if (y > maxY) maxY = y;
    });
    doc.y = maxY + 6;
    doc.x = MARGEN;
  }
  doc.fillColor(TINTA);
}

function dibujarFirmas(doc: Doc, nodo: Nodo): void {
  const conFirmas = doc as DocConFirmas;
  if (conFirmas._firmasCircuito?.length) {
    if (!conFirmas._firmasDibujadas) dibujarFirmasCircuito(doc, conFirmas._firmasCircuito);
    conFirmas._firmasDibujadas = true;
    return;
  }
  const firmas = nodo.hijos.filter((h) => h.clase === "firma");
  if (firmas.length === 0) return;
  asegurar(doc, 70);
  const y = doc.y + 34;
  const ancho = (anchoUtil(doc) - 40 * (firmas.length - 1)) / firmas.length;
  firmas.forEach((f, i) => {
    const x = MARGEN + i * (ancho + 40);
    doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(0.8).stroke(TINTA);
    doc.font(REGULAR).fontSize(8).fillColor(SUAVE);
    doc.text(textoDe(f), x, y + 5, { width: ancho, align: "center" });
  });
  doc.y = y + 22;
  doc.x = MARGEN;
  doc.fillColor(TINTA);
}

type Celda = { texto: string; th: boolean; num: boolean; clase: string; span: number };

function filasDe(tabla: Nodo): Celda[][] {
  const filas: Celda[][] = [];
  const recoger = (n: Nodo) => {
    if (n.tag === "tr") {
      const celdas: Celda[] = [];
      const verCelda = (c: Nodo) => {
        if (c.tag === "th" || c.tag === "td") {
          celdas.push({
            texto: textoDe(c),
            th: c.tag === "th",
            num: /\bnum\b/.test(c.clase),
            clase: c.clase,
            span: c.colspan ?? 1,
          });
        } else c.hijos.forEach(verCelda);
      };
      n.hijos.forEach(verCelda);
      if (celdas.length) filas.push(celdas);
      return;
    }
    n.hijos.forEach(recoger);
  };
  recoger(tabla);
  return filas;
}

/**
 * Anchos de columna proporcionales al contenido más largo, con mínimo y tope,
 * normalizados al ancho útil. Las cabeceras de `table.meta` (th) se dejan
 * estrechas: son etiquetas, no datos.
 */
function anchosColumna(doc: Doc, filas: Celda[][], total: number): number[] {
  const cols = Math.max(...filas.map((f) => f.reduce((n, c) => n + c.span, 0)));
  const medidas = new Array(cols).fill(0);
  for (const fila of filas) {
    let i = 0;
    for (const c of fila) {
      // Las celdas que abarcan varias columnas no fijan el ancho de ninguna.
      if (c.span === 1) {
        doc.font(c.th ? NEGRITA : REGULAR).fontSize(c.th ? 6.8 : 8);
        const w = Math.min(doc.widthOfString(c.texto || "-"), 190);
        if (w > medidas[i]) medidas[i] = w;
      }
      i += c.span;
    }
  }
  // Mínimo de cada columna: su palabra más larga (no se parte «Unidad» en «Unida d»).
  const palabra = new Array(cols).fill(0);
  for (const fila of filas) {
    let i = 0;
    for (const c of fila) {
      if (c.span === 1) {
        doc.font(c.th ? NEGRITA : REGULAR).fontSize(c.th ? 6.8 : 8);
        for (const p of (c.texto || "").split(/\s+/)) palabra[i] = Math.max(palabra[i], Math.min(doc.widthOfString(p), 120));
      }
      i += c.span;
    }
  }
  const MIN = 34;
  const minimos = palabra.map((w) => Math.max(w + 10, MIN));
  const ajustadas = medidas.map((w, i) => Math.max(w + 10, minimos[i]));
  const suma = ajustadas.reduce((a, b) => a + b, 0);
  const anchos = ajustadas.map((w) => (w / suma) * total);
  // Si al escalar alguna queda bajo su mínimo, se le da y se descuenta de las que sobran.
  const faltan = anchos.reduce((a, w, i) => a + Math.max(0, minimos[i] - w), 0);
  const holgura = anchos.reduce((a, w, i) => a + Math.max(0, w - minimos[i]), 0);
  if (faltan > 0 && holgura > faltan)
    return anchos.map((w, i) => (w < minimos[i] ? minimos[i] : w - ((w - minimos[i]) / holgura) * faltan));
  return anchos;
}

function dibujarTabla(doc: Doc, tabla: Nodo): void {
  const filas = filasDe(tabla);
  if (filas.length === 0) return;
  const meta = /\bmeta\b/.test(tabla.clase);
  const total = anchoUtil(doc);
  const anchos = anchosColumna(doc, filas, total);
  const padX = 4;
  const padY = 3.2;

  const cabecera = filas[0]?.every((c) => c.th) && !meta ? filas[0] : null;

  // Ancho de cada celda de una fila (suma de las columnas que abarca).
  const anchosDe = (fila: Celda[]) => {
    let i = 0;
    return fila.map((c) => {
      const w = anchos.slice(i, i + c.span).reduce((a, b) => a + b, 0) || anchos[anchos.length - 1];
      i += c.span;
      return w;
    });
  };

  const pintarFila = (fila: Celda[], esCabecera: boolean) => {
    const fuente = (c: Celda) => (c.th ? NEGRITA : REGULAR);
    const tam = (c: Celda) => (c.th && esCabecera ? 6.8 : c.th ? 7 : 8);
    const anchoCelda = anchosDe(fila);

    // Alto = la celda más alta.
    let alto = 0;
    fila.forEach((c, i) => {
      doc.font(fuente(c)).fontSize(tam(c));
      const h = doc.heightOfString(c.texto || " ", { width: anchoCelda[i] - padX * 2 });
      if (h > alto) alto = h;
    });
    alto += padY * 2;

    if (doc.y + alto > fondo(doc)) {
      doc.addPage();
      if (cabecera) pintarFila(cabecera, true); // repite cabecera en cada página
    }

    const y = doc.y;
    let x = MARGEN;
    fila.forEach((c, i) => {
      const w = anchoCelda[i];
      if (esCabecera) doc.rect(x, y, w, alto).fill(AZUL);
      else if (c.th) doc.rect(x, y, w, alto).fill("#f1f5f8");
      doc.rect(x, y, w, alto).lineWidth(0.5).stroke(LINEA);

      let color = TINTA;
      if (esCabecera) color = "#ffffff";
      else if (c.th) color = SUAVE;
      else if (/\bok\b/.test(c.clase)) color = VERDE;
      else if (/\bno\b/.test(c.clase)) color = ROJO;

      const vacio = /\bvacio\b/.test(c.clase);
      // «N.º de páginas» de la portada: se escribe al final, cuando se conoce el total.
      if (/\bn-paginas\b/.test(c.clase)) {
        const rango = doc.bufferedPageRange();
        const d = doc as DocConFirmas;
        d._nPaginas = [...(d._nPaginas ?? []), { pagina: rango.start + rango.count - 1, x: x + padX, y: y + padY, w: w - padX * 2 }];
        x += w;
        return;
      }
      doc.font(vacio ? CURSIVA : fuente(c)).fontSize(tam(c)).fillColor(vacio ? SUAVE : color);
      doc.text(c.texto || " ", x + padX, y + padY, {
        width: w - padX * 2,
        align: c.num ? "right" : vacio ? "center" : "left",
        lineBreak: true,
      });
      x += w;
    });
    doc.y = y + alto;
    doc.x = MARGEN;
    doc.fillColor(TINTA);
  };

  filas.forEach((fila, i) => pintarFila(fila, !meta && i === 0 && fila.every((c) => c.th)));
  doc.y += 4;
}

/** ¿El nodo contiene algún bloque? Si no, se trata como párrafo. */
const BLOQUES = new Set(["h1", "h2", "h3", "h4", "p", "div", "table", "ul", "ol", "hr", "li"]);
function tieneBloques(n: Nodo): boolean {
  return n.hijos.some((h) => BLOQUES.has(h.tag) || tieneBloques(h));
}

function dibujarNodo(doc: Doc, n: Nodo, listaIdx?: number): void {
  switch (n.tag) {
    case "#text":
      return;
    case "h1": {
      asegurar(doc, 30);
      doc.moveDown(0.5);
      doc.font(NEGRITA).fontSize(13).fillColor(TINTA);
      doc.text(textoDe(n), MARGEN, doc.y, { width: anchoUtil(doc), align: "center", characterSpacing: 0.8 });
      doc.moveDown(0.5);
      return;
    }
    case "h4": {
      asegurar(doc, 24);
      doc.moveDown(0.35);
      doc.font(NEGRITA).fontSize(8.4).fillColor(TINTA);
      doc.text(textoDe(n), MARGEN, doc.y, { width: anchoUtil(doc) });
      doc.moveDown(0.2);
      doc.x = MARGEN;
      return;
    }
    case "h2":
    case "h3": {
      asegurar(doc, 26);
      doc.moveDown(0.55);
      doc.font(NEGRITA).fontSize(8.6).fillColor(AZUL);
      doc.text(textoDe(n).toUpperCase(), MARGEN, doc.y, { width: anchoUtil(doc), characterSpacing: 0.5 });
      const y = doc.y + 1.5;
      doc.moveTo(MARGEN, y).lineTo(doc.page.width - MARGEN, y).lineWidth(0.5).stroke(LINEA);
      doc.y = y + 4;
      doc.x = MARGEN;
      doc.fillColor(TINTA);
      return;
    }
    case "hr": {
      asegurar(doc, 10);
      const y = doc.y + 3;
      doc.moveTo(MARGEN, y).lineTo(doc.page.width - MARGEN, y).lineWidth(0.5).stroke(LINEA);
      doc.y = y + 5;
      return;
    }
    case "table":
      dibujarTabla(doc, n);
      return;
    case "ul":
    case "ol": {
      n.hijos.filter((h) => h.tag === "li").forEach((li, i) => dibujarNodo(doc, li, n.tag === "ol" ? i + 1 : undefined));
      doc.y += 3;
      return;
    }
    case "li": {
      const t = textoDe(n);
      if (!t) return;
      asegurar(doc, 16);
      doc.font(REGULAR).fontSize(8.5).fillColor(TINTA);
      doc.text(`${listaIdx ? `${listaIdx}.` : "•"}  ${t}`, MARGEN + 10, doc.y, {
        width: anchoUtil(doc) - 10,
      });
      return;
    }
    case "p": {
      const t = textoDe(n);
      if (!t) return;
      const nota = /\bnota\b/.test(n.clase);
      asegurar(doc, 18);
      doc.moveDown(0.2);
      doc.font(nota ? CURSIVA : REGULAR).fontSize(nota ? 7.4 : 8.5).fillColor(nota ? SUAVE : TINTA);
      const x = nota ? MARGEN + 8 : MARGEN;
      const y0 = doc.y;
      doc.text(t, x, y0, { width: anchoUtil(doc) - (nota ? 8 : 0), align: "left" });
      if (nota) {
        doc.moveTo(MARGEN + 1, y0).lineTo(MARGEN + 1, doc.y).lineWidth(1.4).stroke(LINEA);
        doc.x = MARGEN;
      }
      doc.fillColor(TINTA);
      return;
    }
    case "div":
    case "#root":
    default: {
      if (/\bmembrete\b/.test(n.clase)) return dibujarMembrete(doc, n);
      if (/\bfirmas\b/.test(n.clase)) return dibujarFirmas(doc, n);
      if (/\bfoto\b/.test(n.clase)) return dibujarFoto(doc, n);
      if (tieneBloques(n) || n.tag === "#root") {
        n.hijos.forEach((h) => dibujarNodo(doc, h));
        return;
      }
      // Contenedor de solo texto (o etiqueta desconocida): párrafo plano.
      const t = textoDe(n);
      if (!t) return;
      asegurar(doc, 16);
      doc.font(REGULAR).fontSize(8.5).fillColor(TINTA);
      doc.text(t, MARGEN, doc.y, { width: anchoUtil(doc) });
      return;
    }
  }
}

/** Pie con el sello: numeración de página + código de verificación + hash. */
function dibujarPies(doc: Doc, sello: Sello): void {
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    // El pie se escribe DENTRO del margen inferior. Con el margen puesto, el
    // ajuste de línea de pdfkit (opción `width`) creía que el texto no cabía y
    // abría una página nueva por cada línea del pie: todo PDF salía con 3
    // páginas de más («Pagina 1 de 1» en la 3.ª). Se anula el margen mientras
    // se dibuja el pie y se restaura después.
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGEN + 2;
    doc.moveTo(MARGEN, y - 6).lineTo(doc.page.width - MARGEN, y - 6).lineWidth(0.5).stroke(LINEA);

    doc.font(REGULAR).fontSize(6).fillColor(SUAVE);
    const aviso = avisoEstado(sello);
    const izq = sello.borrador
      ? "PREVISUALIZACION - documento sin valor: no emitido"
      : aviso
        ? `${sello.numero}  |  ${aviso}`
        : `${sello.numero}  |  Emitido el ${sello.fecha}  |  Cod. verificacion: ${sello.codigoVerificacion}  |  ${sello.urlVerificacion}`;
    doc.text(sanearParaFuente(izq), MARGEN, y - 2, { width: anchoUtil(doc) - 60, lineBreak: false });
    doc.text(`Pagina ${i - rango.start + 1} de ${rango.count}`, doc.page.width - MARGEN - 60, y - 2, {
      width: 60,
      align: "right",
      lineBreak: false,
    });
    doc.font(MONO).fontSize(5).fillColor(SUAVE);
    doc.text(`SHA-256: ${sello.hash}`, MARGEN, y + 5.5, { width: anchoUtil(doc), lineBreak: false });
    doc.page.margins.bottom = margenInferior;
  }
}

/* ========================================================================== */
/* 4. API pública                                                              */
/* ========================================================================== */

/**
 * Fecha fija para los metadatos del fichero incrustado.
 *
 * pdfkit exige CreationDate/ModDate en el /Params del EmbeddedFile. Si se usara
 * `new Date()`, dos descargas del MISMO certificado darían PDFs distintos byte a
 * byte, y la reproducibilidad de la descarga es justo lo que se promete en el
 * módulo (`plantilla-render.service.pdf`). Se ancla al epoch: el fichero
 * incrustado no tiene fecha propia, la del documento es la de emisión y esa ya
 * va en el sello, en `Info` y en el XMP.
 *
 * (El PDF completo no es byte-idéntico entre descargas de todos modos, porque
 * `Info.CreationDate` y el `/ID` del trailer los deriva pdfkit del momento de
 * generación. Lo reproducible y verificable es el CONTENIDO sellado, que es de
 * lo que depende el hash.)
 */
const FECHA_FIJA_ADJUNTO = new Date(0);

/**
 * Renderiza el CUERPO sellado del informe a PDF/A-3b.
 *
 * @param cuerpoHtml Cuerpo ya renderizado (el mismo texto sobre el que se
 *                   calculó `sello.hash`). Se dibuja Y se incrusta como fichero
 *                   asociado, de modo que el PDF lleva dentro su propia fuente.
 * @param sello      Número, código de verificación y hash, para el pie.
 * @param titulo     Título del documento (metadatos del PDF).
 */
export async function generarPdf(cuerpoHtml: string, sello: Sello, titulo: string): Promise<Buffer> {
  // `Info` va saneado para XMP: pdfkit interpola estos valores dentro del XML
  // del paquete XMP sin escaparlos, y un '&' en el título rompería el bloque
  // pdfaid que declara la conformidad. Ver `sanearParaMetadatos`.
  const tituloSeguro = sanearParaMetadatos(titulo);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
    bufferPages: true, // necesario para numerar "página X de N" al final
    // PDF/A-3b: OutputIntent sRGB + XMP con pdfaid + ID en el trailer.
    subset: "PDF/A-3b",
    // Obligatorio: con la 1.3 por defecto pdfkit NO escribe el stream Metadata
    // (lo omite explícitamente) y sin XMP no hay PDF/A. 1.7 es la versión que
    // ISO 19005-3 toma como base.
    pdfVersion: "1.7",
    // Idioma del documento: no lo exige el nivel B, pero es gratis y es lo
    // correcto para lectores de pantalla y para el archivo.
    lang: "es-CL",
    displayTitle: true, // el visor muestra el título, no el nombre del fichero
    info: {
      Title: tituloSeguro,
      Author: "Instituto de Investigaciones y Control - IDIC",
      Subject: sanearParaMetadatos(
        sello.borrador ? "Previsualizacion (sin valor)" : `${sello.numero} - ${sello.hash}`,
      ),
      // Creator y Producer IGUALES a propósito: pdfkit emite en el XMP
      // `pdf:Producer` tomando el valor de `info.Creator` (bug suyo). Con los
      // dos iguales, `Info` y XMP no pueden contradecirse, que es lo que PDF/A
      // persigue con la coherencia de metadatos.
      Creator: "LIMS IDIC",
      Producer: "LIMS IDIC",
    },
  });

  // Antes de dibujar: sin esto, cualquier doc.font(...) reventaría.
  registrarFuentes(doc);

  // El cuerpo sellado, DENTRO del PDF (esto es lo que justifica A-3 sobre A-2).
  // AFRelationship /Source = "el fichero del que deriva este documento", que es
  // literalmente el caso. Quien reciba el PDF puede extraerlo, calcular su
  // SHA-256 y compararlo con el hash impreso en el pie, sin tocar el LIMS.
  const nombreAdjunto = `${(sello.numero || "documento").replace(/[^A-Za-z0-9._-]/g, "_")}.html`;
  doc.file(Buffer.from(cuerpoHtml, "utf8"), {
    name: nombreAdjunto,
    type: "text/html",
    description: "Cuerpo HTML sellado: origen del documento y base del SHA-256 del pie.",
    creationDate: FECHA_FIJA_ADJUNTO,
    modifiedDate: FECHA_FIJA_ADJUNTO,
    // `relationship` NO está en @types/pdfkit — ni siquiera en la última (0.17.6,
    // comprobado): los typings van por detrás del runtime, que sí lo soporta
    // desde 0.13 (ver `AttachmentsMixin.file` en pdfkit/js/pdfkit.js, escribe
    // /AFRelationship en el Filespec). Se pasa con un cast acotado a esta
    // propiedad en vez de subir los typings (no arreglaría nada) o castear el
    // objeto entero a `any` (perdería el chequeo del resto de opciones).
    //
    // NO es cosmético: PDF/A-3 EXIGE /AFRelationship en cada fichero asociado
    // (ISO 19005-3 §6.8). Sin esto el PDF deja de ser conforme.
    ...({ relationship: "Source" } as { relationship: string }),
  });

  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const terminado = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const aviso = avisoEstado(sello);
  if (sello.borrador) marcaDeAgua(doc);
  else if (aviso) marcaDeAgua(doc, MARCA_ESTADO[sello.estadoDocumento ?? ""] ?? "SIN VALIDEZ");
  // Si el documento no es oficial, la página se rotula para cada salto de página.
  if (!sello.borrador && aviso) {
    const texto = MARCA_ESTADO[sello.estadoDocumento ?? ""] ?? "SIN VALIDEZ";
    doc.on("pageAdded", () => marcaDeAgua(doc, texto));
    doc.font(NEGRITA).fontSize(8).fillColor("#7a4700");
    doc.text(sanearParaFuente(aviso), MARGEN, doc.y, { width: anchoUtil(doc), align: "center" });
    doc.moveDown(0.6);
  }
  doc.fillColor(TINTA);
  const conFirmas = doc as DocConFirmas;
  conFirmas._firmasCircuito = sello.firmas;
  dibujarNodo(doc, parsearHtml(cuerpoHtml));
  // Plantilla sin bloque de firmas: las del circuito van al final del cuerpo.
  if (sello.firmas?.length && !conFirmas._firmasDibujadas) dibujarFirmasCircuito(doc, sello.firmas);
  rellenarNumeroPaginas(doc);
  dibujarPies(doc, sello);

  doc.end();
  await terminado;
  return Buffer.concat(trozos);
}

/**
 * «PREVISUALIZACION» en diagonal: un borrador impreso no puede pasar por emitido.
 *
 * SIN `opacity()`: la transparencia se sustituye por un gris claro sólido. PDF/A
 * -3 toleraría la transparencia (lleva OutputIntent, que es lo que la regla
 * 6.2.10 exige para permitirla), pero un documento de archivo no debe depender
 * de que el visor componga bien un grupo transparente 30 años después, y el
 * requisito de partida era emitir sin transparencia. El resultado visual es
 * equivalente: el texto ya era gris claro sobre blanco.
 */
const MARCA_ESTADO: Record<string, string> = {
  en_firma: "EN FIRMA",
  devuelto: "DEVUELTO",
  anulado: "ANULADO",
};

function marcaDeAgua(doc: Doc, texto = "PREVISUALIZACION"): void {
  const x0 = doc.x;
  const y0 = doc.y;
  doc.save();
  doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font(NEGRITA).fontSize(52).fillColor("#dfe6ec");
  doc.text(texto, 0, doc.page.height / 2 - 26, {
    width: doc.page.width,
    align: "center",
  });
  doc.restore();
  // save/restore no devuelve la fuente: se deja la del cuerpo.
  doc.font(REGULAR).fontSize(8.5).fillColor(TINTA);
  // En la primera página se empieza arriba; en un salto, se respeta la posición
  // que pdfkit fija para la página nueva (el margen superior).
  doc.x = x0 || MARGEN;
  doc.y = y0 || MARGEN;
}
