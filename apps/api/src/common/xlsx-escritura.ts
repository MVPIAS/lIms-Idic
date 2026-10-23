/**
 * Escritura de un libro Excel (.xlsx) sin dependencias: un .xlsx es un ZIP con
 * XML (Office Open XML). Se escribe sin compresión (método STORE) con su CRC-32,
 * texto como cadenas en línea (inlineStr) y números como números, para que Excel
 * los sume y filtre. La primera fila de cada hoja va en negrita y fija.
 * Probado en xlsx-escritura.spec.ts (se vuelve a leer con tabla-archivo.ts).
 */

export type Celda = string | number | null | undefined;
export interface Hoja {
  nombre: string;
  filas: Celda[][];
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

function hojaXml(filas: Celda[][]): string {
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
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fija}<sheetData>${cuerpo}</sheetData></worksheet>`;
}

/** Libro .xlsx con una o varias hojas. */
export function libroXlsx(hojas: Hoja[]): Buffer {
  const usados = new Set<string>();
  const hs = (hojas.length ? hojas : [{ nombre: "Hoja", filas: [] }]).map((h) => ({ ...h, nombre: nombreHoja(h.nombre, usados) }));
  const archivos = [
    {
      nombre: "[Content_Types].xml",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hs
        .map((_h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
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
    ...hs.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: hojaXml(h.filas) })),
  ];
  return zip(archivos.map((a) => ({ nombre: a.nombre, datos: Buffer.from(a.datos, "utf8") })));
}
