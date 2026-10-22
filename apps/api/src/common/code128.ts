/**
 * Código de barras Code 128 (juego B) en SVG, sin dependencias.
 *
 * Lo usan las etiquetas de las armas de la Delegación Nº 11 (EP-11 11.7): el
 * código que se imprime es el de la muestra de la OT y se lee con cualquier
 * lector de código de barras (pistola USB en modo teclado) en la entrega (11.27).
 *
 * Juego B: ASCII 32–126 (letras, dígitos y signos). Dígito de control módulo 103.
 * Probado en code128.spec.ts.
 */

/** Anchos (barra, espacio, barra…) de los 107 símbolos: 0–102 datos, 103–105 inicio A/B/C, 106 fin. */
export const PATRONES_128: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const INICIO_B = 104;
const FIN = 106;

/** Valores Code 128B del texto (inicio, datos, control, fin). Lanza si hay caracteres fuera del juego B. */
export function valoresCode128B(texto: string): number[] {
  if (!texto) throw new Error("El código de barras no puede estar vacío.");
  const datos: number[] = [];
  for (const ch of texto) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Carácter no admitido en el código de barras: «${ch}».`);
    datos.push(c - 32);
  }
  const control = datos.reduce((s, v, i) => s + v * (i + 1), INICIO_B) % 103;
  return [INICIO_B, ...datos, control, FIN];
}

/** Secuencia de anchos (en módulos) de barras y espacios alternos, empezando por barra. */
export function anchosCode128B(texto: string): number[] {
  return valoresCode128B(texto).flatMap((v) => PATRONES_128[v].split("").map(Number));
}

/**
 * SVG del código con su zona de silencio (10 módulos a cada lado). `modulo` = ancho
 * del módulo en px; `alto` en px. El texto legible va debajo.
 */
export function svgCode128(texto: string, opciones: { modulo?: number; alto?: number; conTexto?: boolean } = {}): string {
  const modulo = opciones.modulo ?? 1.6;
  const alto = opciones.alto ?? 46;
  const anchos = anchosCode128B(texto);
  const silencio = 10 * modulo;
  let x = silencio;
  const barras: string[] = [];
  anchos.forEach((w, i) => {
    const ancho = w * modulo;
    if (i % 2 === 0) barras.push(`<rect x="${x.toFixed(2)}" y="0" width="${ancho.toFixed(2)}" height="${alto}"/>`);
    x += ancho;
  });
  const total = x + silencio;
  const textoAlto = opciones.conTexto === false ? 0 : 14;
  const leyenda =
    opciones.conTexto === false
      ? ""
      : `<text x="${(total / 2).toFixed(2)}" y="${alto + 12}" text-anchor="middle" font-family="monospace" font-size="11">${escaparXml(texto)}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Código de barras ${escaparXml(texto)}" ` +
    `width="${total.toFixed(2)}" height="${alto + textoAlto}" viewBox="0 0 ${total.toFixed(2)} ${alto + textoAlto}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${barras.join("")}</g>${leyenda}</svg>`
  );
}

function escaparXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
