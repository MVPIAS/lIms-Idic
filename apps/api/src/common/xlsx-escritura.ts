/**
 * Escritura de un libro Excel (.xlsx) sin dependencias: un .xlsx es un ZIP con
 * XML (Office Open XML). Se escribe sin compresión (método STORE) con su CRC-32,
 * texto como cadenas en línea (inlineStr) y números como números, para que Excel
 * los sume y filtre. La primera fila de cada hoja va en negrita y fija.
 * Opcional por hoja: autofiltro, anchos de columna y un gráfico nativo de Excel
 * (columnas, barras, líneas o torta) que lee sus datos de la propia hoja.
 * Probado en xlsx-escritura.spec.ts (se vuelve a leer con tabla-archivo.ts).
 */

export type Celda = string | number | null | undefined;
export interface GraficoHoja {
  tipo: "columna" | "barra" | "linea" | "torta";
  titulo: string;
  /** Filas de datos (1-based, sin contar la cabecera): de `desde` a `hasta`. */
  desde: number;
  hasta: number;
  /** Columna (0-based) con las categorías; las series son `series` (0-based, su nombre en la fila 1). */
  categorias: number;
  series: number[];
}
export interface Hoja {
  nombre: string;
  filas: Celda[][];
  autoFiltro?: boolean;
  /** Ancho de cada columna en caracteres. */
  anchos?: number[];
  grafico?: GraficoHoja;
}

/* ------------------------------------------------------------------ ZIP --- */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(archivos: { nombre: string; datos: Buffer }[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, "utf8");
    const crc = crc32(a.datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1-ene-1980
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(a.datos.length, 18);
    local.writeUInt32LE(a.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nombre, a.datos);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(a.datos.length, 20);
    cd.writeUInt32LE(a.datos.length, 24);
    cd.writeUInt16LE(nombre.length, 28);
    cd.writeUInt32LE(desplazamiento, 42);
    central.push(cd, nombre);
    desplazamiento += 30 + nombre.length + a.datos.length;
  }
  const dir = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partes, dir, fin]);
}

/* ------------------------------------------------------------------ XML --- */

const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Columna Excel de un índice (0 → A, 26 → AA). */
export function columna(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Nombre de hoja válido para Excel: sin []:*?/\, máx. 31 caracteres, único. */
export function nombreHoja(n: string, usados: Set<string>): string {
  const base = (n.replace(/[\[\]:*?/\\]/g, " ").trim() || "Hoja").slice(0, 31).trim();
  let k = 2;
  let s = base;
  while (usados.has(s.toLowerCase())) s = `${base.slice(0, 28)} ${k++}`;
  usados.add(s.toLowerCase());
  return s;
}

function hojaXml(filas: Celda[][], h: Partial<Hoja> = {}, conDibujo = false): string {
  const cuerpo = filas
    .map((fila, i) => {
      const celdas = fila
        .map((v, j) => {
          const ref = `${columna(j)}${i + 1}`;
          const estilo = i === 0 ? ' s="1"' : "";
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${estilo}><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${i + 1}">${celdas}</row>`;
    })
    .join("");
  const fija = filas.length > 1 ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  const anchos = h.anchos?.length
    ? `<cols>${h.anchos.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${Math.max(4, Math.min(80, w))}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const ncol = Math.max(1, ...filas.map((f) => f.length));
  const filtro = h.autoFiltro && filas.length > 1 ? `<autoFilter ref="A1:${columna(ncol - 1)}${filas.length}"/>` : "";
  const dibujo = conDibujo ? `<drawing r:id="rId1"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${fija}${anchos}<sheetData>${cuerpo}</sheetData>${filtro}${dibujo}</worksheet>`;
}

/* -------------------------------------------------------------- gráfico --- */

const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Nombre de hoja entre comillas simples para una fórmula: 'Hoja'. */
const hojaRef = (hoja: string) => `'${hoja.replace(/'/g, "''")}'`;

/** Referencia absoluta a un rango de una columna: 'Hoja'!$A$2:$A$9. */
function rango(hoja: string, col: number, desde: number, hasta: number): string {
  const c = columna(col);
  return `${hojaRef(hoja)}!$${c}$${desde}:$${c}$${hasta}`;
}

function graficoXml(hoja: string, g: GraficoHoja): string {
  const desde = g.desde + 1; // la fila 1 es la cabecera
  const hasta = g.hasta + 1;
  const series = g.series
    .map((col, i) => {
      const nombre = `${hojaRef(hoja)}!$${columna(col)}$1`;
      const marcador = g.tipo === "linea" ? `<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>` : "";
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${xml(nombre)}</c:f></c:strRef></c:tx>${marcador}<c:cat><c:strRef><c:f>${xml(rango(hoja, g.categorias, desde, hasta))}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${xml(rango(hoja, col, desde, hasta))}</c:f></c:numRef></c:val></c:ser>`;
    })
    .join("");
  const ejes = `<c:axId val="10"/><c:axId val="20"/>`;
  const barra = g.tipo === "barra";
  const defEjes = `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${barra ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${barra ? "b" : "l"}"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  let cuerpo: string;
  if (g.tipo === "torta") cuerpo = `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`;
  else if (g.tipo === "linea") cuerpo = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${ejes}</c:lineChart>${defEjes}`;
  else cuerpo = `<c:barChart><c:barDir val="${barra ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/>${ejes}</c:barChart>${defEjes}`;
  const titulo = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-CL" sz="1200" b="1"/><a:t>${xml(g.titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>${titulo}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${cuerpo}</c:plotArea><c:legend><c:legendPos val="${g.tipo === "torta" ? "r" : "b"}"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

/** Dibujo que coloca el gráfico a la derecha de los datos (10 columnas × 20 filas). */
function dibujoXml(col: number): string {
  const ancla = (c: number, r: number) => `<xdr:col>${c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}"><xdr:twoCellAnchor><xdr:from>${ancla(col, 1)}</xdr:from><xdr:to>${ancla(col + 9, 21)}</xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Gráfico 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

/** Libro .xlsx con una o varias hojas. */
export function libroXlsx(hojas: Hoja[]): Buffer {
  const usados = new Set<string>();
  const hs = (hojas.length ? hojas : [{ nombre: "Hoja", filas: [] } as Hoja]).map((h) => ({ ...h, nombre: nombreHoja(h.nombre, usados) }));
  // Índice de gráfico por hoja (el k-ésimo gráfico es drawing{k+1}/chart{k+1}).
  const graficoDe = new Map<number, number>();
  hs.forEach((h, i) => {
    if (h.grafico && h.grafico.series.length && h.grafico.hasta >= h.grafico.desde) graficoDe.set(i, graficoDe.size);
  });
  const conGrafico = [...graficoDe.values()];
  const archivos = [
    {
      nombre: "[Content_Types].xml",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hs
        .map((_h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}${conGrafico
        .map(
          (k) =>
            `<Override PartName="/xl/drawings/drawing${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
        )
        .join("")}</Types>`,
    },
    {
      nombre: "_rels/.rels",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: "xl/workbook.xml",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hs
        .map((h, i) => `<sheet name="${xml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hs
        .map((_h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${hs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      nombre: "xl/styles.xml",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    },
    ...hs.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: hojaXml(h.filas, h, graficoDe.has(i)) })),
    ...[...graficoDe.entries()].flatMap(([i, k]) => {
      const h = hs[i];
      const n = k + 1;
      const ncol = Math.max(1, ...h.filas.map((f) => f.length));
      const rel = (tipo: string, destino: string) =>
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${tipo}" Target="${destino}"/></Relationships>`;
      return [
        { nombre: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, datos: rel("drawing", `../drawings/drawing${n}.xml`) },
        { nombre: `xl/drawings/drawing${n}.xml`, datos: dibujoXml(ncol + 1) },
        { nombre: `xl/drawings/_rels/drawing${n}.xml.rels`, datos: rel("chart", `../charts/chart${n}.xml`) },
        { nombre: `xl/charts/chart${n}.xml`, datos: graficoXml(h.nombre, h.grafico!) },
      ];
    }),
  ];
  return zip(archivos.map((a) => ({ nombre: a.nombre, datos: Buffer.from(a.datos, "utf8") })));
}
