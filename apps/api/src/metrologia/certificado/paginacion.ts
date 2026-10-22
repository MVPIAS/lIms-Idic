/**
 * Reparto en hojas del certificado de calibración (respuesta del LMT del 21-10-2026,
 * pregunta 12: «¿los certificados pueden llevar más de una hoja?» · sí, N hojas).
 *
 * La hoja 1 es fija (identificación, condiciones, patrones, síntesis, firmas del Jefe
 * de Departamento y del Jefe de Laboratorio y leyenda legal). Los resultados ocupan
 * las hojas 2..N: cada una repite la cabecera y lleva las firmas del Jefe de
 * Laboratorio y del metrólogo; OBSERVACIONES y «Fin del certificado» van en la última.
 *
 * Las alturas son estimaciones en puntos tipográficos del PDF A4 (pdf.renderer.ts:
 * margen 42 pt, pie de 26 pt, filas de tabla de ~16,5 pt). Son conservadoras a
 * propósito; la prueba `paginacion.spec.ts` genera el PDF real con tablas de 1 a 80
 * filas y comprueba que el número de hojas impreso coincide con el del PDF.
 * Función PURA.
 */

export interface BloqueTabla {
  tipo: "tabla";
  titulo?: string;
  cabecera: string[];
  filas: string[][];
}
export interface BloqueFijo {
  tipo: "fijo";
  /** HTML ya armado (esquema, tabla pequeña, texto). */
  html: string;
  /** Alto estimado en puntos. */
  alto: number;
}
export type Bloque = BloqueTabla | BloqueFijo;

/** Alto útil de una hoja de resultados (A4 842 pt − márgenes 84 − pie técnico 26). */
export const ALTO_UTIL = 732;
/** Cabecera repetida: membrete, «Página X de N», título, línea de acreditación y datos del ítem. */
export const ALTO_CABECERA = 172;
/** Pie de las hojas 2..N: firmas del Jefe de Laboratorio y del metrólogo. */
export const ALTO_FIRMAS = 70;
/** «Fin del certificado de calibración». */
export const ALTO_FIN = 22;
export const ALTO_FILA = 17.5;
export const ALTO_TITULO = 24;
/** Mínimo de filas de una tabla que se deja en una hoja antes de partirla. */
const MIN_FILAS = 3;
/** Tablas de hasta estas filas no se parten: pasan enteras a la hoja siguiente. */
const TABLA_CORTA = 12;

/** Alto de la cabecera de una tabla: las etiquetas largas ocupan varias líneas. */
export function altoCabeceraTabla(cab: string[]): number {
  const ancho = 511 / Math.max(1, cab.length) - 8;
  const lineas = Math.max(1, ...cab.map((c) => Math.ceil((c.length * 3.9) / Math.max(20, ancho))));
  return lineas * 9 + 8;
}

export function altoObservaciones(lineas: string[]): number {
  return ALTO_TITULO + lineas.reduce((t, l) => t + 12.5 * Math.max(1, Math.ceil((l.length * 4.15) / 511)), 0) + 6;
}

/** Contenido de una hoja de resultados. */
export type Hoja = Bloque[];

/**
 * Reparte los bloques en hojas. Las tablas se parten por filas (la cabecera se
 * repite en cada trozo); un bloque fijo que no cabe pasa entero a la hoja
 * siguiente. Las observaciones (`altoObs`) van en la última hoja.
 */
export function paginar(bloques: Bloque[], altoObs: number): Hoja[] {
  const disponible = ALTO_UTIL - ALTO_CABECERA - ALTO_FIRMAS;
  const hojas: Hoja[] = [[]];
  let libre = disponible;
  const nueva = () => { hojas.push([]); libre = disponible; };
  for (const b of bloques) {
    if (b.tipo === "fijo") {
      if (b.alto > libre && hojas[hojas.length - 1].length) nueva();
      hojas[hojas.length - 1].push(b);
      libre -= b.alto;
      continue;
    }
    const cab = (b.titulo ? ALTO_TITULO : 0) + altoCabeceraTabla(b.cabecera) + 6;
    let resto = b.filas;
    let primera = true;
    while (resto.length || primera) {
      let caben = Math.floor((libre - cab) / ALTO_FILA);
      // Una tabla corta no se parte; una larga no deja menos de MIN_FILAS en ninguna hoja.
      const corta = resto.length <= TABLA_CORTA && caben < resto.length;
      if ((corta || caben < Math.min(MIN_FILAS, resto.length)) && hojas[hojas.length - 1].length) { nueva(); caben = Math.floor((libre - cab) / ALTO_FILA); }
      caben = Math.max(1, caben);
      if (caben < resto.length && resto.length - caben < MIN_FILAS) caben = Math.max(1, resto.length - MIN_FILAS);
      const trozo = resto.slice(0, caben);
      hojas[hojas.length - 1].push({ ...b, titulo: primera ? b.titulo : b.titulo ? `${b.titulo} (continuación)` : undefined, filas: trozo });
      libre -= cab + trozo.length * ALTO_FILA;
      resto = resto.slice(trozo.length);
      primera = false;
      if (resto.length) nueva();
    }
  }
  if (altoObs + ALTO_FIN > libre && hojas[hojas.length - 1].length) nueva();
  return hojas;
}
