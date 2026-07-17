/**
 * Fuentes incrustadas del PDF/A y saneado del texto al repertorio que cubren.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ YA NO VALEN Helvetica/Courier
 * ---------------------------------------------------------------------------
 * Las 14 fuentes estándar de PDF (Helvetica, Courier…) NO se incrustan: el PDF
 * solo las REFERENCIA y confía en que el visor tenga una equivalente. PDF/A
 * prohíbe justamente eso (ISO 19005-3 §6.2.11.4.1: «the font programs for all
 * fonts used for rendering within a conforming file shall be embedded within
 * that file»), porque un documento que se archiva 30 años no puede depender de
 * las fuentes instaladas en la máquina que lo abra. Verificado: el renderizador
 * anterior fallaba esa regla en veraPDF.
 *
 * Por eso se incrusta Noto Sans / Noto Sans Mono (SIL OFL 1.1, ver OFL.txt y la
 * cabecera de fuentes.embebidas.ts). pdfkit + fontkit generan un SUBSET del TTF
 * con solo los glifos usados y lo escriben como FontFile2, que es lo que PDF/A
 * pide. Los bytes llegan en base64 desde fuentes.embebidas.ts.
 */
import {
  REGULAR_TTF_BASE64,
  NEGRITA_TTF_BASE64,
  CURSIVA_TTF_BASE64,
  MONO_TTF_BASE64,
  MONO_NEGRITA_TTF_BASE64,
} from "./fuentes.embebidas";

/**
 * Nombres con los que se registran las caras en el documento.
 *
 * Son los que se pasan a `doc.font(...)`. NO son los nombres de las fuentes
 * estándar de PDF a propósito: si quedara un `doc.font("Helvetica")` suelto en
 * el renderizador, pdfkit lo resolvería contra la fuente estándar sin incrustar
 * y el PDF dejaría de ser PDF/A en silencio. Con nombres propios, un descuido
 * así revienta en tiempo de ejecución en vez de degradar la conformidad.
 */
export const REGULAR = "IDIC-Sans";
export const NEGRITA = "IDIC-Sans-Bold";
export const CURSIVA = "IDIC-Sans-Italic";
export const MONO = "IDIC-Mono";
export const MONO_NEGRITA = "IDIC-Mono-Bold";

const CARAS: Array<[string, string]> = [
  [REGULAR, REGULAR_TTF_BASE64],
  [NEGRITA, NEGRITA_TTF_BASE64],
  [CURSIVA, CURSIVA_TTF_BASE64],
  [MONO, MONO_TTF_BASE64],
  [MONO_NEGRITA, MONO_NEGRITA_TTF_BASE64],
];

/**
 * Buffers decodificados una sola vez por proceso.
 *
 * `Buffer.from(base64)` sobre ~172 KB en cada emisión sería trabajo tirado: los
 * bytes son constantes. pdfkit no muta el buffer que recibe en `registerFont`
 * (fontkit lo abre en modo lectura), así que compartir la misma instancia entre
 * documentos es seguro.
 */
let cache: Array<[string, Buffer]> | null = null;

function caras(): Array<[string, Buffer]> {
  if (!cache) cache = CARAS.map(([nombre, b64]) => [nombre, Buffer.from(b64, "base64")]);
  return cache;
}

/** Registra las cinco caras en el documento. Llamar antes de dibujar nada. */
export function registrarFuentes(doc: PDFKit.PDFDocument): void {
  for (const [nombre, bytes] of caras()) doc.registerFont(nombre, bytes);
}

/* ========================================================================== */
/* Saneado del texto                                                           */
/* ========================================================================== */

/**
 * Glifos que las fuentes no traen (van con el subconjunto `latin`) mapeados a
 * un equivalente que sí existe. Antes esto se hacía para WinAnsiEncoding; ahora
 * el criterio es el repertorio REAL del TTF incrustado, comprobado con fontkit.
 */
const SUSTITUCIONES: Array<[RegExp, string]> = [
  [/[≥]/g, ">="],
  [/[≤]/g, "<="],
  [/[≈]/g, "~"],
  [/[→]/g, "->"],
  [/[←]/g, "<-"],
  [/[✓✔]/g, "OK"],
  [/[✗✘]/g, "X"],
  [/[…]/g, "..."],
  [/[«»]/g, '"'],
  // Espacios no separables y de ancho fijo -> espacio normal.
  [/[    - ]/g, " "],
  // Guiones tipográficos que no son el ASCII '-' ni el en/em dash que sí traemos.
  [/[‐‑‒]/g, "-"],
  // Anchura cero (ZWSP, ZWNJ, ZWJ, BOM): invisibles, fuera.
  [/[​-‍﻿]/g, ""],
];

/**
 * Repertorio EXACTO que cubren las fuentes incrustadas: la LISTA BLANCA.
 *
 * Los limites van con escapes \uXXXX y no con los caracteres literales a
 * proposito: escrito literal, este rango es un espacio seguido de una tilde y
 * poco mas. Asi es imposible de revisar en una auditoria y trivial de romper
 * con un copy/paste o con un editor que normalice el fichero.
 */
const CUBIERTO = new RegExp(
  "[^" +
    "\u0020-\u007E" + // ASCII imprimible
    "\u00A0-\u00FF" + // Latin-1: todo el español (á é í ó ú ñ ü ¿ ¡ º ª · ° ±)
    "\u20AC" +          // €
    "\u2013\u2014" +    // – —
    "\u2018\u2019" +    // ‘ ’
    "\u201C\u201D" +    // “ ”
    "\u2022" +          // •
    "]",
  "g",
);

/**
 * Espacios de control (tabulador, salto de línea, retorno, avance de página y
 * tabulador vertical) -> espacio normal.
 *
 * TIENE QUE IR ANTES DE LA LISTA BLANCA. Un salto de línea es U+000A, que queda
 * FUERA del repertorio (que empieza en U+0020), así que la lista blanca lo
 * convertiría en '?'. Y como quien llama (textoDe) colapsa los espacios DESPUÉS
 * de sanear, ya sería tarde: un '?' es un carácter corriente y no se colapsa.
 *
 * No es hipotético: cualquier <p> de una plantilla escrito en varias líneas
 * (todos los de plantilla-defecto.ts y los del certificado SAEC) metía un '?'
 * en mitad de la frase por cada salto de línea del fuente.
 */
const ESPACIOS_CONTROL = new RegExp("[\t\n\r\f\v]", "g");

/**
 * Invisibles SIN glifo en las fuentes. Se BORRAN en vez de caer a '?': son
 * invisibles por definición, y un '?' sería peor que no imprimir nada.
 *   · U+0000-U+001F  controles C0 que no son espacio (los que sí lo son ya se
 *                    han convertido arriba)
 *   · U+007F-U+009F  DEL y controles C1
 *   · U+00AD         guion blando (Noto Sans Mono no trae glifo)
 */
const SIN_GLIFO_INVISIBLE = new RegExp("[\x00-\x1F\x7F-\x9F\xAD]", "g");

/**
 * Deja el texto dentro del repertorio que las fuentes incrustadas cubren.
 *
 * IMPORTANTE PARA PDF/A: un carácter sin glifo en la fuente se emite como
 * .notdef, y eso es NO CONFORME (ISO 19005-3 §6.2.11.5: todo glifo referenciado
 * debe existir en el programa de fuente incrustado). No es solo cosmético: un
 * emoji pegado en el nombre de un cliente tumbaría la conformidad del
 * certificado. Por eso el filtro es una LISTA BLANCA, no una lista negra.
 *
 * Se conserva: U+0020–U+007E (ASCII imprimible), U+00A0–U+00FF (Latin-1: todo
 * el español) y el puñado de signos tipográficos comprobados uno a uno contra
 * el TTF (€ – — “ ” ‘ ’ •).
 *
 * Todo lo demás fuera de la lista blanca cae a '?', que sí tiene glifo: el dato
 * se ve mutilado (y eso es visible y corregible) en vez de romper el PDF.
 *
 * EL ORDEN DE LOS TRES PASOS IMPORTA:
 *   1. Equivalencias: los glifos que no tenemos pero sí sabemos traducir
 *      (≥ -> ">=") deben sustituirse ANTES de que la lista blanca los mate.
 *   2. Espacios de control -> espacio, y resto de invisibles -> nada. También
 *      antes: si no, un salto de línea acabaría como '?' (ver ESPACIOS_CONTROL).
 *   3. Lista blanca: lo que quede sin cubrir -> '?'.
 */
export function sanearParaFuente(texto: string): string {
  let out = texto;
  for (const [re, rep] of SUSTITUCIONES) out = out.replace(re, rep);
  out = out.replace(ESPACIOS_CONTROL, " ");
  out = out.replace(SIN_GLIFO_INVISIBLE, "");
  return out.replace(CUBIERTO, "?");
}

/**
 * Sanea un valor que va a `info` del PDF y, por tanto, al XMP.
 *
 * pdfkit interpola `info.Title` / `Author` / `Subject` DENTRO del XML del XMP
 * sin escaparlos (ver `_addInfo` en pdfkit/js/pdfkit.js). Un `&` o un `<` en el
 * título rompe el paquete XMP, y con él el bloque `pdfaid` que declara la
 * conformidad: el resultado es un PDF que ya NO es PDF/A. Comprobado con
 * veraPDF — un título como «Laboratorio Química & Física» convertía un fichero
 * conforme en uno con 3 fallos de la cláusula 6.6.2.1 (XMP mal formado).
 *
 * Esto NO es teórico: el título se construye con el nombre de la plantilla y el
 * código de la OT, que son datos de la BD tecleados por usuarios.
 *
 * No se pueden escapar a entidades (`&amp;`) porque la misma cadena alimenta el
 * diccionario `Info`, donde saldría el literal «&amp;». Se sustituyen por
 * equivalentes legibles, que es lo correcto para un título de documento.
 */
export function sanearParaMetadatos(texto: string): string {
  return sanearParaFuente(texto)
    .replace(/&/g, " y ")
    .replace(/[<>]/g, "-")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
