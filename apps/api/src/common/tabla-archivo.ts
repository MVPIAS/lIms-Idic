/**
 * Lectura de una planilla subida por el usuario (carga masiva): Excel (.xlsx)
 * o texto separado por comas, punto y coma o tabuladores (.csv, .txt, o lo
 * pegado desde Excel). Sin dependencias: un .xlsx es un ZIP con XML; se lee
 * con zlib (incluido en Node) solo la PRIMERA hoja, como texto.
 *
 * Límites (defensa ante archivos maliciosos o enormes): 5 MB comprimido,
 * 20 MB por entrada descomprimida, 2.000 filas y 40 columnas.
 * Probado en tabla-archivo.spec.ts.
 */
import { inflateRawSync } from "node:zlib";

export const MAX_BYTES_ARCHIVO = 5_000_000;
const MAX_BYTES_ENTRADA = 20_000_000;
export const MAX_FILAS = 2000;
const MAX_COLUMNAS = 40;

export class TablaError extends Error {}

/** Filas de texto (sin las vacías). La primera suele ser la cabecera. */
export function leerTabla(nombre: string, contenido: Buffer): string[][] {
  if (contenido.length > MAX_BYTES_ARCHIVO) throw new TablaError("El archivo supera los 5 MB.");
  const esZip = contenido.length > 4 && contenido.readUInt32LE(0) === 0x04034b50;
  if (esZip || /\.xlsx$/i.test(nombre)) {
    if (!esZip) throw new TablaError("El archivo no es un Excel (.xlsx) válido.");
    return limpiar(leerXlsx(contenido));
  }
  if (/\.xls$/i.test(nombre)) throw new TablaError("El formato .xls (Excel 97-2003) no se admite: guárdelo como .xlsx o .csv.");
  return limpiar(leerTexto(contenido.toString("utf8")));
}

function limpiar(filas: string[][]): string[][] {
  const out = filas
    .map((f) => f.slice(0, MAX_COLUMNAS).map((c) => (c ?? "").replace(/\s+/g, " ").trim()))
    .filter((f) => f.some((c) => c !== ""));
  if (out.length > MAX_FILAS + 1) throw new TablaError(`El archivo tiene más de ${MAX_FILAS} filas.`);
  return out;
}

/* ------------------------------------------------------------------ texto --- */

/** CSV/TSV con comillas dobles; separador detectado en la primera línea (tab > ; > ,). */
export function leerTexto(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const primera = t.split("\n", 1)[0] ?? "";
  const sep = primera.includes("\t") ? "\t" : primera.includes(";") ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else celda += ch;
    } else if (ch === '"' && celda === "") comillas = true;
    else if (ch === sep) {
      fila.push(celda);
      celda = "";
    } else if (ch === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += ch;
  }
  if (celda !== "" || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

/* ------------------------------------------------------------------- xlsx --- */

interface EntradaZip {
  nombre: string;
  metodo: number;
  comprimido: number;
  descomprimido: number;
  offsetLocal: number;
}

function entradasZip(b: Buffer): EntradaZip[] {
  // Fin del directorio central: firma 0x06054b50 en los últimos 64 KB.
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new TablaError("El archivo .xlsx está dañado (sin directorio).");
  const total = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const out: EntradaZip[] = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new TablaError("El archivo .xlsx está dañado.");
    const metodo = b.readUInt16LE(p + 10);
    const comprimido = b.readUInt32LE(p + 20);
    const descomprimido = b.readUInt32LE(p + 24);
    const largoNombre = b.readUInt16LE(p + 28);
    const largoExtra = b.readUInt16LE(p + 30);
    const largoComentario = b.readUInt16LE(p + 32);
    const offsetLocal = b.readUInt32LE(p + 42);
    const nombre = b.toString("utf8", p + 46, p + 46 + largoNombre);
    out.push({ nombre, metodo, comprimido, descomprimido, offsetLocal });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return out;
}

function contenidoEntrada(b: Buffer, e: EntradaZip): string {
  if (e.descomprimido > MAX_BYTES_ENTRADA) throw new TablaError("El Excel es demasiado grande.");
  const p = e.offsetLocal;
  if (p + 30 > b.length || b.readUInt32LE(p) !== 0x04034b50) throw new TablaError("El archivo .xlsx está dañado.");
  const inicio = p + 30 + b.readUInt16LE(p + 26) + b.readUInt16LE(p + 28);
  const datos = b.subarray(inicio, inicio + e.comprimido);
  if (e.metodo === 0) return datos.toString("utf8");
  if (e.metodo !== 8) throw new TablaError("Compresión del .xlsx no admitida.");
  return inflateRawSync(datos, { maxOutputLength: MAX_BYTES_ENTRADA }).toString("utf8");
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

/** Texto de un <si> o <is>: concatena todos sus <t> (rich text en varios tramos). */
function textoDe(xml: string): string {
  let s = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += decodificar(m[1]);
  return s;
}

function columna(ref: string): number {
  const letras = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function leerXlsx(b: Buffer): string[][] {
  const entradas = entradasZip(b);
  const porNombre = new Map(entradas.map((e) => [e.nombre, e]));
  const compartidas: string[] = [];
  const ss = porNombre.get("xl/sharedStrings.xml");
  if (ss) for (const m of contenidoEntrada(b, ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidas.push(textoDe(m[1]));
  const hojas = entradas
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.nombre))
    .sort((a, b2) => Number(/(\d+)\.xml$/.exec(a.nombre)![1]) - Number(/(\d+)\.xml$/.exec(b2.nombre)![1]));
  if (!hojas.length) throw new TablaError("El Excel no tiene hojas.");
  const xml = contenidoEntrada(b, hojas[0]);
  const filas: string[][] = [];
  for (const fm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const fila: string[] = [];
    let siguiente = 0;
    for (const cm of (fm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columna(ref) : siguiente;
      siguiente = col + 1;
      if (col >= MAX_COLUMNAS) continue;
      const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const cuerpo = cm[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      let valor = "";
      if (tipo === "s") valor = v != null ? compartidas[Number(v)] ?? "" : "";
      else if (tipo === "inlineStr") valor = textoDe(cuerpo);
      else if (tipo === "b") valor = v === "1" ? "VERDADERO" : "FALSO";
      else valor = v != null ? decodificar(v) : "";
      while (fila.length < col) fila.push("");
      fila[col] = valor;
    }
    filas.push(fila);
    if (filas.length > MAX_FILAS + 1) throw new TablaError(`El archivo tiene más de ${MAX_FILAS} filas.`);
  }
  return filas;
}
