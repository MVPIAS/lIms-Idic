/**
 * Generador de `fuentes.embebidas.ts` a partir de los .ttf de esta carpeta.
 *
 * Ejecutar desde la raíz del repo tras cambiar cualquier .ttf:
 *   node apps/api/src/plantilla-render/assets/generar-fuentes.mjs
 *
 * No forma parte del build (es .mjs: tsc solo compila .ts, así que este fichero
 * no entra en dist/). Vive junto a las fuentes a propósito, para que quien
 * sustituya un .ttf tenga el generador delante y no se olvide de regenerar.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Constante exportada -> fichero .ttf. El orden se respeta en la salida. */
const CARAS = [
  ["REGULAR", "NotoSans-Regular.ttf"],
  ["NEGRITA", "NotoSans-Bold.ttf"],
  ["CURSIVA", "NotoSans-Italic.ttf"],
  ["MONO", "NotoSansMono-Regular.ttf"],
  ["MONO_NEGRITA", "NotoSansMono-Bold.ttf"],
];

const CABECERA = `/**
 * Fuentes TTF embebidas en base64 · FICHERO GENERADO, NO EDITAR A MANO.
 * Regenerar con: node apps/api/src/plantilla-render/assets/generar-fuentes.mjs
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ BASE64 Y NO leer el .ttf del disco
 * ---------------------------------------------------------------------------
 * PDF/A exige que las fuentes viajen DENTRO del PDF (FontFile2), así que el
 * proceso necesita los bytes del TTF en runtime. Los .ttf originales están al
 * lado de este fichero (son la fuente de verdad y quedan auditables), pero
 * \`nest build\` compila con tsc y NO copia binarios a dist/ (no hay entrada
 * \`assets\` en nest-cli.json, y ese fichero queda fuera del alcance de este
 * trabajo). Leerlos por ruta relativa obligaría a adivinar si el proceso corre
 * desde src/ o desde dist/ y se rompería según el empaquetado.
 *
 * Embebidos como base64 en un .ts, los bytes son parte del módulo compilado:
 * funcionan igual en dev (ts-node), en dist/ (tsc), en Docker y en Jest, sin
 * configuración ni paso de build extra. Coste: ~172 KB de fuente.
 *
 * Los SHA-256 de cada cara permiten comprobar que el base64 sigue
 * correspondiendo al .ttf del repo:
 *   sha256sum apps/api/src/plantilla-render/assets/*.ttf
 *
 * ---------------------------------------------------------------------------
 * FUENTE Y LICENCIA
 * ---------------------------------------------------------------------------
 * Noto Sans 2.015 y Noto Sans Mono 2.014, subconjunto \`latin\`.
 * Copyright 2022 The Noto Project Authors
 * (https://github.com/notofonts/latin-greek-cyrillic)
 * Licencia: SIL Open Font License 1.1 — texto íntegro en \`assets/OFL.txt\`.
 * La OFL permite uso, incrustación y redistribución sin coste ni regalías, y la
 * incrustación en un documento NO obliga a licenciar el documento bajo OFL
 * (cláusula de la propia OFL sobre documentos que incrustan la fuente).
 * Descargadas de https://gwfh.mranftl.com (subconjunto latin, formato ttf).
 *
 * Cubren íntegro el rango imprimible Latin-1 (U+0020–U+00FF salvo los controles
 * C1 y el guion blando) más € – — “ ” ‘ ’ •, que es exactamente lo que deja
 * pasar \`sanearParaFuente()\` en fuentes.ts. Verificado con fontkit: sin esa
 * correspondencia, un carácter sin glifo se emitiría como .notdef y veraPDF lo
 * marcaría como no conforme.
 */
`;

let salida = CABECERA;
for (const [constante, fichero] of CARAS) {
  const bytes = readFileSync(join(AQUI, fichero));
  const sha = createHash("sha256").update(bytes).digest("hex");
  salida += `\n/** ${fichero} · ${bytes.length} bytes · sha256 ${sha} */\n`;
  salida += `export const ${constante}_TTF_BASE64 =\n  "${bytes.toString("base64")}";\n`;
}

const destino = join(AQUI, "fuentes.embebidas.ts");
writeFileSync(destino, salida);
console.log(`${destino} escrito (${(statSync(destino).size / 1024).toFixed(0)} KB)`);
