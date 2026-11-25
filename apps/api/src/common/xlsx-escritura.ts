/**
 * Escritura de un libro Excel (.xlsx) sin dependencias: un .xlsx es un ZIP con
 * XML (Office Open XML). Se escribe sin compresión (método STORE) con su CRC-32,
 * texto como cadenas en línea (inlineStr) y números como números, para que Excel
 * los sume y filtre. La primera fila de cada hoja va en negrita y fija.
 * Opcional por hoja: autofiltro, anchos de columna y un gráfico nativo de Excel
 * (columnas, barras, líneas o torta) que lee sus datos de la propia hoja, y una
 * tabla dinámica nativa de Excel (PivotTable) construida sobre otra hoja de datos,
 * que el usuario puede reorganizar en Excel y que se actualiza al abrir el libro.
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
export type AgregadoPivot = "conteo" | "suma" | "promedio" | "minimo" | "maximo";
/**
 * Tabla dinámica nativa de Excel que se coloca en la hoja que la declara (desde A3),
 * construida sobre la hoja `origen` (cabecera en la fila 1, datos debajo).
 */
export interface TablaDinamicaNativa {
  /** Nombre (tal como se pasa en `hojas`) de la hoja con los datos. */
  origen: string;
  /** Columnas (0-based) de la hoja de origen: campo de filas, de columnas y de valor. */
  filas: number;
  columnas?: number | null;
  valor?: number | null;
  /** Si el campo de valor tiene texto (o no tiene números), el agregado pasa a conteo. */
  agregado?: AgregadoPivot;
}
export interface Hoja {
  nombre: string;
  filas: Celda[][];
  autoFiltro?: boolean;
  /** Ancho de cada columna en caracteres. */
  anchos?: number[];
  grafico?: GraficoHoja;
  tablaDinamica?: TablaDinamicaNativa;
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
  const fija = filas.length > 1 && !h.tablaDinamica ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
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

/* ------------------------------------------------------ tabla dinámica --- */

type Valor = string | number | null;
/** Valor tal como queda en la hoja (mismo criterio que hojaXml). */
const valorCelda = (v: Celda): Valor =>
  v === null || v === undefined || v === ""
    ? null
    : typeof v === "number" && Number.isFinite(v)
      ? v
      : String(v).replace(/[ --]/g, "");
const claveValor = (v: Valor) => (v === null ? "m" : typeof v === "number" ? `n${v}` : `s${v}`);

const SUBTOTAL: Record<AgregadoPivot, string> = { conteo: "count", suma: "sum", promedio: "average", minimo: "min", maximo: "max" };
const NOMBRE_SUBTOTAL: Record<AgregadoPivot, string> = { conteo: "Cuenta", suma: "Suma", promedio: "Promedio", minimo: "Mínimo", maximo: "Máximo" };

/** Atributos de <sharedItems> según los tipos presentes (como los escribe Excel). */
function atributosCompartidos(vals: Valor[]): string {
  let txt = false;
  let num = false;
  let vacio = false;
  let entero = true;
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    if (v === null) vacio = true;
    else if (typeof v === "number") {
      num = true;
      if (!Number.isInteger(v)) entero = false;
      if (v < min) min = v;
      if (v > max) max = v;
    } else txt = true;
  }
  const a: string[] = [];
  if (!txt && !num) return ` containsNonDate="0" containsString="0" containsBlank="1"`;
  if (num && !txt) {
    if (!vacio) a.push(`containsSemiMixedTypes="0"`);
    a.push(`containsString="0"`);
  }
  if (vacio) a.push(`containsBlank="1"`);
  if (num) {
    if (txt) a.push(`containsMixedTypes="1"`);
    a.push(`containsNumber="1"`);
    if (entero) a.push(`containsInteger="1"`);
    a.push(`minValue="${min}"`, `maxValue="${max}"`);
  }
  return a.length ? " " + a.join(" ") : "";
}

const itemXml = (v: Valor) => (v === null ? "<m/>" : typeof v === "number" ? `<n v="${v}"/>` : `<s v="${xml(v)}"/>`);

interface PivotArmada {
  definicion: string;
  registros: string;
  tabla: string;
  /** Celdas ya calculadas de la tabla (como las guarda Excel), desde la fila `inicio`. */
  celdas: Celda[][];
}

/**
 * Partes de una tabla dinámica: definición de la caché (fuente = rango de la hoja
 * de datos, refreshOnLoad), registros de la caché y la tabla (filas, columnas
 * opcionales y un campo de datos). Los campos de filas/columnas llevan sus
 * elementos ordenados; el resto de campos van en línea en los registros.
 */
function armarPivot(origen: Hoja, def: TablaDinamicaNativa, n: number, inicio: number): PivotArmada | null {
  const [cab, ...datos] = origen.filas;
  const ncol = Math.max(1, ...origen.filas.map((f) => f.length));
  if (!cab || !datos.length) return null;
  const enRango = (c: number | null | undefined) => c !== null && c !== undefined && c >= 0 && c < ncol;
  if (!enRango(def.filas)) return null;
  const colCampo = enRango(def.columnas) && def.columnas !== def.filas ? (def.columnas as number) : null;

  // Nombres de campo únicos y no vacíos (Excel los toma de la cabecera).
  const usados = new Set<string>();
  const nombres = Array.from({ length: ncol }, (_x, j) => {
    const base = String(valorCelda(cab[j]) ?? `Columna${j + 1}`);
    let n = base;
    let k = 2;
    while (usados.has(n.toLowerCase())) n = `${base}${k++}`;
    usados.add(n.toLowerCase());
    return n;
  });
  const columnasV: Valor[][] = nombres.map((_n, j) => datos.map((f) => valorCelda(f[j])));

  // Campo de datos y agregado: si el valor tiene texto (o ningún número) se cuenta.
  let agregado: AgregadoPivot = def.agregado ?? "conteo";
  let campoDatos = enRango(def.valor) ? (def.valor as number) : null;
  const numerico = (c: Valor[]) => c.some((v) => typeof v === "number") && !c.some((v) => typeof v === "string");
  if (agregado !== "conteo" && (campoDatos === null || !numerico(columnasV[campoDatos]))) agregado = "conteo";
  if (agregado === "conteo" && campoDatos === null) {
    // Contar registros: un campo sin vacíos (Excel cuenta celdas no vacías).
    const lleno = columnasV.findIndex((c) => c.every((v) => v !== null));
    campoDatos = lleno >= 0 ? lleno : def.filas;
  }
  const fd = campoDatos as number;
  const nombreDatos = `${NOMBRE_SUBTOTAL[agregado]} de ${nombres[fd]}`;

  // Elementos (ordenados) de los campos de eje.
  const orden = (a: Valor, b: Valor) => {
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
  };
  const ejes = new Map<number, { items: Valor[]; indice: Map<string, number> }>();
  for (const j of [def.filas, colCampo]) {
    if (j === null || ejes.has(j)) continue;
    const unicos = new Map<string, Valor>();
    for (const v of columnasV[j]) if (!unicos.has(claveValor(v))) unicos.set(claveValor(v), v);
    const items = [...unicos.values()].sort(orden);
    ejes.set(j, { items, indice: new Map(items.map((v, i) => [claveValor(v), i])) });
  }

  const campos = nombres
    .map((n, j) => {
      const e = ejes.get(j);
      const attrs = atributosCompartidos(columnasV[j]);
      const cuerpo = e ? `<sharedItems${attrs} count="${e.items.length}">${e.items.map(itemXml).join("")}</sharedItems>` : `<sharedItems${attrs}/>`;
      return `<cacheField name="${xml(n)}" numFmtId="0">${cuerpo}</cacheField>`;
    })
    .join("");
  const ultima = `${columna(ncol - 1)}${datos.length + 1}`;
  const definicion = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}" r:id="rId1" refreshOnLoad="1" refreshedBy="LIMS" refreshedDate="0" createdVersion="3" refreshedVersion="3" minRefreshableVersion="3" recordCount="${datos.length}"><cacheSource type="worksheet"><worksheetSource ref="A1:${ultima}" sheet="${xml(origen.nombre)}"/></cacheSource><cacheFields count="${ncol}">${campos}</cacheFields></pivotCacheDefinition>`;

  const registros = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}" count="${datos.length}">${datos
    .map(
      (_f, i) =>
        `<r>${columnasV
          .map((c, j) => {
            const e = ejes.get(j);
            return e ? `<x v="${e.indice.get(claveValor(c[i]))}"/>` : itemXml(c[i]);
          })
          .join("")}</r>`,
    )
    .join("")}</pivotCacheRecords>`;

  // Valores de la tabla (mismo cálculo que hará Excel al actualizarla).
  const acum = () => ({ n: 0, suma: 0, nums: 0, min: Infinity, max: -Infinity });
  type Acum = ReturnType<typeof acum>;
  const celdasAcum = new Map<string, Acum>();
  const tomar = (clave: string) => celdasAcum.get(clave) ?? (celdasAcum.set(clave, acum()), celdasAcum.get(clave)!);
  datos.forEach((_f, i) => {
    const v = columnasV[fd][i];
    if (v === null) return;
    const fi = ejes.get(def.filas)!.indice.get(claveValor(columnasV[def.filas][i]))!;
    const ci = colCampo !== null ? ejes.get(colCampo)!.indice.get(claveValor(columnasV[colCampo][i]))! : -1;
    for (const clave of [`${fi}|${ci}`, `${fi}|*`, `*|${ci}`, `*|*`]) {
      const a = tomar(clave);
      a.n++;
      if (typeof v === "number") {
        a.nums++;
        a.suma += v;
        if (v < a.min) a.min = v;
        if (v > a.max) a.max = v;
      }
    }
  });
  const valorDe = (clave: string): Celda => {
    const a = celdasAcum.get(clave);
    if (!a) return null;
    if (agregado === "conteo") return a.n;
    if (!a.nums) return null;
    if (agregado === "suma") return a.suma;
    if (agregado === "promedio") return a.suma / a.nums;
    return agregado === "minimo" ? a.min : a.max;
  };
  const etiqueta = (v: Valor): Celda => (v === null ? "(en blanco)" : v);

  // Tabla: compacta, desde la fila `inicio`, con totales generales.
  const filasEje = ejes.get(def.filas)!;
  const colsEje = colCampo !== null ? ejes.get(colCampo)! : null;
  const k = filasEje.items.length;
  const itemsDe = (e: { items: Valor[] }) => `<items count="${e.items.length + 1}">${e.items.map((_v, i) => `<item x="${i}"/>`).join("")}<item t="default"/></items>`;
  const pivotFields = nombres
    .map((_n, j) => {
      const attrs: string[] = [];
      if (j === def.filas) attrs.push(`axis="axisRow"`);
      else if (j === colCampo) attrs.push(`axis="axisCol"`);
      if (j === fd) attrs.push(`dataField="1"`);
      attrs.push(`showAll="0"`);
      const e = j === def.filas || j === colCampo ? ejes.get(j)! : null;
      return e ? `<pivotField ${attrs.join(" ")}>${itemsDe(e)}</pivotField>` : `<pivotField ${attrs.join(" ")}/>`;
    })
    .join("");
  const elementosEje = (n: number) =>
    `${Array.from({ length: n }, (_x, i) => (i === 0 ? `<i><x/></i>` : `<i><x v="${i}"/></i>`)).join("")}<i t="grand"><x/></i>`;
  const rowItems = `<rowItems count="${k + 1}">${elementosEje(k)}</rowItems>`;
  let location: string;
  let colPart: string;
  const celdas: Celda[][] = [];
  if (colsEje) {
    const m = colsEje.items.length;
    location = `<location ref="A${inicio}:${columna(m + 1)}${inicio + 2 + k}" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>`;
    colPart = `<colFields count="1"><field x="${colCampo}"/></colFields><colItems count="${m + 1}">${elementosEje(m)}</colItems>`;
    const cols = [...colsEje.items.keys(), "*"];
    celdas.push([nombreDatos, nombres[colCampo as number]]);
    celdas.push([nombres[def.filas], ...colsEje.items.map(etiqueta), "Total general"]);
    filasEje.items.forEach((v, i) => celdas.push([etiqueta(v), ...cols.map((c) => valorDe(`${i}|${c}`))]));
    celdas.push(["Total general", ...cols.map((c) => valorDe(`*|${c}`))]);
  } else {
    location = `<location ref="A${inicio}:B${inicio + 1 + k}" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/>`;
    colPart = `<colItems count="1"><i/></colItems>`;
    celdas.push([nombres[def.filas], nombreDatos]);
    filasEje.items.forEach((v, i) => celdas.push([etiqueta(v), valorDe(`${i}|*`)]));
    celdas.push(["Total general", valorDe("*|*")]);
  }
  const subtotal = agregado === "suma" ? "" : ` subtotal="${SUBTOTAL[agregado]}"`;
  const tabla = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="TablaDinamica${n}" cacheId="${n}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Valores" updatedVersion="3" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="3" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="${xml(nombres[def.filas])}"${colsEje ? ` colHeaderCaption="${xml(nombres[colCampo as number])}"` : ""}>${location}<pivotFields count="${ncol}">${pivotFields}</pivotFields><rowFields count="1"><field x="${def.filas}"/></rowFields>${rowItems}${colPart}<dataFields count="1"><dataField name="${xml(nombreDatos)}" fld="${fd}"${subtotal} baseField="0" baseItem="0"/></dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
  return { definicion, registros, tabla, celdas };
}

/** Libro .xlsx con una o varias hojas. */
export function libroXlsx(hojas: Hoja[]): Buffer {
  const usados = new Set<string>();
  const hs = (hojas.length ? hojas : [{ nombre: "Hoja", filas: [] } as Hoja]).map((h) => ({ ...h, original: h.nombre, nombre: nombreHoja(h.nombre, usados) }));
  // Índice de gráfico por hoja (el k-ésimo gráfico es drawing{k+1}/chart{k+1}).
  const graficoDe = new Map<number, number>();
  hs.forEach((h, i) => {
    if (h.grafico && h.grafico.series.length && h.grafico.hasta >= h.grafico.desde) graficoDe.set(i, graficoDe.size);
  });
  const conGrafico = [...graficoDe.values()];
  // Tablas dinámicas: la p-ésima es pivotTable{p}/pivotCacheDefinition{p} (cacheId = p).
  const pivotDe = new Map<number, { n: number; partes: PivotArmada }>();
  hs.forEach((h, i) => {
    if (!h.tablaDinamica) return;
    const o = hs.findIndex((x, j) => j !== i && x.original === h.tablaDinamica!.origen);
    if (o < 0) return;
    const n = pivotDe.size + 1;
    const inicio = Math.max(3, h.filas.length + 2);
    const partes = armarPivot(hs[o], h.tablaDinamica, n, inicio);
    if (!partes) return;
    pivotDe.set(i, { n, partes });
    // La hoja lleva los valores ya calculados (Excel los recalcula al actualizar).
    const filas = h.filas.slice();
    while (filas.length < inicio - 1) filas.push([]);
    hs[i] = { ...h, filas: [...filas, ...partes.celdas] };
  });
  const pivots = [...pivotDe.values()];
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rels = (lista: [string, string][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${lista
      .map(([tipo, destino], k) => `<Relationship Id="rId${k + 1}" Type="${REL}/${tipo}" Target="${destino}"/>`)
      .join("")}</Relationships>`;
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
        .join("")}${pivots
        .map(
          ({ n }) =>
            `<Override PartName="/xl/pivotCache/pivotCacheDefinition${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotCache/pivotCacheRecords${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/><Override PartName="/xl/pivotTables/pivotTable${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>`,
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
        .join("")}</sheets>${
        pivots.length ? `<pivotCaches>${pivots.map(({ n }) => `<pivotCache cacheId="${n}" r:id="rId${hs.length + 1 + n}"/>`).join("")}</pivotCaches>` : ""
      }</workbook>`,
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      datos: rels([
        ...hs.map((_h, i): [string, string] => ["worksheet", `worksheets/sheet${i + 1}.xml`]),
        ["styles", "styles.xml"],
        ...pivots.map(({ n }): [string, string] => ["pivotCacheDefinition", `pivotCache/pivotCacheDefinition${n}.xml`]),
      ]),
    },
    {
      nombre: "xl/styles.xml",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    },
    ...hs.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: hojaXml(h.filas, h, graficoDe.has(i)) })),
    // Relaciones de cada hoja: el dibujo (si hay) es rId1, luego la tabla dinámica.
    ...hs.flatMap((_h, i) => {
      const lista: [string, string][] = [];
      if (graficoDe.has(i)) lista.push(["drawing", `../drawings/drawing${graficoDe.get(i)! + 1}.xml`]);
      if (pivotDe.has(i)) lista.push(["pivotTable", `../pivotTables/pivotTable${pivotDe.get(i)!.n}.xml`]);
      return lista.length ? [{ nombre: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, datos: rels(lista) }] : [];
    }),
    ...[...graficoDe.entries()].flatMap(([i, k]) => {
      const h = hs[i];
      const n = k + 1;
      const ncol = Math.max(1, ...h.filas.map((f) => f.length));
      return [
        { nombre: `xl/drawings/drawing${n}.xml`, datos: dibujoXml(ncol + 1) },
        { nombre: `xl/drawings/_rels/drawing${n}.xml.rels`, datos: rels([["chart", `../charts/chart${n}.xml`]]) },
        { nombre: `xl/charts/chart${n}.xml`, datos: graficoXml(h.nombre, h.grafico!) },
      ];
    }),
    ...pivots.flatMap(({ n, partes }) => [
      { nombre: `xl/pivotTables/pivotTable${n}.xml`, datos: partes.tabla },
      { nombre: `xl/pivotTables/_rels/pivotTable${n}.xml.rels`, datos: rels([["pivotCacheDefinition", `../pivotCache/pivotCacheDefinition${n}.xml`]]) },
      { nombre: `xl/pivotCache/pivotCacheDefinition${n}.xml`, datos: partes.definicion },
      { nombre: `xl/pivotCache/_rels/pivotCacheDefinition${n}.xml.rels`, datos: rels([["pivotCacheRecords", `pivotCacheRecords${n}.xml`]]) },
      { nombre: `xl/pivotCache/pivotCacheRecords${n}.xml`, datos: partes.registros },
    ]),
  ];
  return zip(archivos.map((a) => ({ nombre: a.nombre, datos: Buffer.from(a.datos, "utf8") })));
}
