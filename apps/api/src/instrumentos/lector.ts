/**
 * Adquisición de datos desde archivos de instrumentos (contrato §4.4.6, §4.4.7) ·
 * funciones PURAS, probadas en lector.spec.ts.
 *
 * Un «perfil de importación» describe cómo exporta un instrumento: formato
 * (CSV, TXT o XML), separador, decimal, fila de cabecera y qué columna trae el
 * código de la muestra, el ensayo y el valor. El lector devuelve filas
 * normalizadas; emparejarlas con los ensayos de la OT es del servicio.
 */

export const FORMATOS = ["CSV", "TXT", "XML"] as const;
export type Formato = (typeof FORMATOS)[number];
export const SEPARADORES = ["auto", ";", ",", "\t", "|", "espacios"] as const;
export type Separador = (typeof SEPARADORES)[number];

export interface Perfil {
  formato: Formato;
  separador?: Separador | null;
  decimal?: "," | "." | null;
  /** Fila de la cabecera (1 = primera); 0 = sin cabecera (las columnas se indican por número). */
  filaCabecera?: number | null;
  /** XML: nombre del elemento que es un registro (p. ej. «Sample» o «Result»). */
  elementoRegistro?: string | null;
  /** Columna (nombre de cabecera, número 1.. o, en XML, hijo/atributo) de cada dato. */
  colMuestra: string;
  colEnsayo?: string | null;
  colValor: string;
  colUnidad?: string | null;
  colFecha?: string | null;
  /** Si no hay columna de ensayo: el ensayo fijo que mide el instrumento. */
  ensayoFijo?: string | null;
  /** Nombre del ensayo en el instrumento → código o nombre en el LIMS. */
  equivalencias?: Record<string, string> | null;
}

export interface FilaLeida {
  fila: number; // línea o registro en el archivo (1..)
  muestra: string;
  ensayo: string; // ya traducido con las equivalencias del perfil
  ensayoArchivo: string; // como viene en el archivo
  valor: string; // tal como llega, con el decimal ya normalizado a «,» o texto
  unidad: string | null;
  fecha: string | null;
  error: string | null;
}

export const MAX_FILAS = 5000;

/** Texto comparable: sin tildes, minúsculas, espacios simples. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Decodifica el archivo: UTF-8 (con o sin BOM) o, si no es UTF-8 válido, Latin-1 (Windows). */
export function decodificar(b: Buffer): string {
  const sinBom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  const t = sinBom.toString("utf8");
  return t.includes("�") ? sinBom.toString("latin1") : t;
}

/* -------------------------------------------------------- texto delimitado --- */

/** Separador más probable de la línea de muestra. */
export function detectarSeparador(linea: string): Exclude<Separador, "auto"> {
  const cuenta = (c: string) => linea.split(c).length - 1;
  const opciones: [Exclude<Separador, "auto">, number][] = [
    ["\t", cuenta("\t")],
    [";", cuenta(";")],
    [",", cuenta(",")],
    ["|", cuenta("|")],
  ];
  opciones.sort((a, b) => b[1] - a[1]);
  return opciones[0][1] > 0 ? opciones[0][0] : "espacios";
}

/** Divide una línea respetando comillas dobles («"a;b"» es un solo campo; «""» es una comilla). */
export function dividirLinea(linea: string, sep: Exclude<Separador, "auto">): string[] {
  if (sep === "espacios") return linea.trim().split(/\s{2,}|\t/).map((x) => x.trim());
  const salida: string[] = [];
  let actual = "";
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (c === '"') comillas = false;
      else actual += c;
    } else if (c === '"' && actual.trim() === "") {
      comillas = true;
      actual = "";
    } else if (c === sep) {
      salida.push(actual.trim());
      actual = "";
    } else actual += c;
  }
  salida.push(actual.trim());
  return salida;
}

/** Índice (0..) de una columna indicada por nombre de cabecera o por número (1..). */
function indiceColumna(col: string, cabecera: string[] | null): number {
  const t = col.trim();
  if (/^\d{1,3}$/.test(t)) return Number(t) - 1;
  if (!cabecera) return -1;
  const n = normalizar(t);
  return cabecera.findIndex((h) => normalizar(h) === n);
}

/* ------------------------------------------------------------------- XML --- */

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const desescapar = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e.toLowerCase()],
    )
    .trim();
const sinPrefijo = (n: string) => n.replace(/^[\w.-]+:/, "");

/**
 * Registros de un XML sencillo: cada elemento `registro` da un objeto con sus
 * atributos y el texto de sus hijos directos (el nombre sin espacio de nombres).
 */
export function registrosXml(xml: string, registro: string): Record<string, string>[] {
  const limpio = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  const nombre = registro.trim().replace(/[^\w.:-]/g, "");
  if (!nombre) return [];
  const re = new RegExp(`<((?:[\\w.-]+:)?${nombre.replace(/[.]/g, "\\.")})(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</\\1\\s*>)`, "g");
  const salida: Record<string, string>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio)) && salida.length <= MAX_FILAS) {
    const o: Record<string, string> = {};
    for (const a of (m[2] ?? "").matchAll(/([\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) o[sinPrefijo(a[1])] = desescapar(a[3] ?? a[4] ?? "");
    for (const h of (m[3] ?? "").matchAll(/<([\w.:-]+)(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g)) {
      const k = sinPrefijo(h[1]);
      if (!(k in o)) o[k] = /<[\w]/.test(h[3] ?? "") ? "" : desescapar(h[3] ?? "");
    }
    salida.push(o);
  }
  return salida;
}

const campoXml = (o: Record<string, string>, col: string | null | undefined) => {
  if (!col) return "";
  const n = normalizar(col.replace(/^@/, ""));
  const k = Object.keys(o).find((x) => normalizar(x) === n);
  return k ? o[k] : "";
};

/* ------------------------------------------------------------------ valor --- */

/**
 * Valor con el decimal del LIMS (coma). Respeta los textos («Ausente») y los
 * censurados («< 0.05» → «< 0,05»). Con decimal «,» los puntos son de miles.
 */
export function normalizarValor(v: string, decimal: "," | "." | null | undefined): string {
  const t = v.trim();
  const m = t.match(/^([<>]=?|≤|≥)?\s*([-+]?[\d.,]+(?:[eE][-+]?\d+)?)$/);
  if (!m) return t;
  let num = m[2];
  if ((decimal ?? ".") === ".") num = num.replace(/,/g, "").replace(".", ",");
  else num = num.replace(/\.(?=\d{3}(\D|$))/g, "");
  return `${m[1] ? `${m[1]} ` : ""}${num}`;
}

/* ----------------------------------------------------------------- lector --- */

export class LecturaError extends Error {}

/** Lee el archivo según el perfil. Lanza LecturaError si el archivo no encaja con el perfil. */
export function leerArchivo(texto: string, p: Perfil): FilaLeida[] {
  const equiv = new Map(Object.entries(p.equivalencias ?? {}).map(([k, v]) => [normalizar(k), v]));
  const ensayoDe = (e: string) => {
    const base = e.trim() || (p.ensayoFijo ?? "").trim();
    return equiv.get(normalizar(base)) ?? base;
  };
  const fila = (n: number, muestra: string, ensayo: string, valor: string, unidad: string, fecha: string): FilaLeida => {
    const ens = ensayoDe(ensayo);
    const val = normalizarValor(valor, p.decimal);
    const error = !muestra.trim() ? "Sin código de muestra." : !ens ? "Sin ensayo." : !val ? "Sin valor." : null;
    return { fila: n, muestra: muestra.trim(), ensayo: ens, ensayoArchivo: ensayo.trim() || (p.ensayoFijo ?? "").trim(), valor: val, unidad: unidad.trim() || null, fecha: fecha.trim() || null, error };
  };

  if (p.formato === "XML") {
    if (!p.elementoRegistro) throw new LecturaError("El perfil XML necesita el nombre del elemento que es cada registro.");
    const regs = registrosXml(texto, p.elementoRegistro);
    if (!regs.length) throw new LecturaError(`El archivo no tiene elementos <${p.elementoRegistro}>.`);
    if (regs.length > MAX_FILAS) throw new LecturaError(`El archivo tiene más de ${MAX_FILAS} registros.`);
    return regs.map((o, i) => fila(i + 1, campoXml(o, p.colMuestra), campoXml(o, p.colEnsayo), campoXml(o, p.colValor), campoXml(o, p.colUnidad), campoXml(o, p.colFecha)));
  }

  const lineas = texto.split(/\r\n|\n|\r/);
  if (lineas.length > MAX_FILAS + 50) throw new LecturaError(`El archivo tiene más de ${MAX_FILAS} líneas.`);
  const filaCab = Math.max(0, Math.trunc(p.filaCabecera ?? 1));
  const muestraLinea = lineas[filaCab ? filaCab - 1 : 0] ?? "";
  const sep = !p.separador || p.separador === "auto" ? detectarSeparador(muestraLinea) : p.separador;
  const cabecera = filaCab ? dividirLinea(lineas[filaCab - 1] ?? "", sep) : null;
  const idx = (col: string | null | undefined, que: string, obligatoria: boolean) => {
    if (!col) return -1;
    const i = indiceColumna(col, cabecera);
    if (i < 0 && obligatoria) throw new LecturaError(`No se encontró la columna «${col}» (${que}) en la cabecera${cabecera ? `: ${cabecera.filter(Boolean).join(" · ")}` : ""}.`);
    return i;
  };
  const iM = idx(p.colMuestra, "muestra", true);
  const iE = idx(p.colEnsayo, "ensayo", !p.ensayoFijo);
  const iV = idx(p.colValor, "valor", true);
  const iU = idx(p.colUnidad, "unidad", false);
  const iF = idx(p.colFecha, "fecha", false);
  const salida: FilaLeida[] = [];
  for (let n = filaCab; n < lineas.length; n++) {
    if (!lineas[n].trim()) continue;
    const c = dividirLinea(lineas[n], sep);
    const g = (i: number) => (i >= 0 ? c[i] ?? "" : "");
    // Líneas de pie o de comentario sin muestra ni valor: se ignoran.
    if (!g(iM) && !g(iV)) continue;
    salida.push(fila(n + 1, g(iM), g(iE), g(iV), g(iU), g(iF)));
  }
  if (!salida.length) throw new LecturaError("El archivo no tiene filas de datos con el perfil elegido.");
  return salida;
}
