/**
 * Validación de las fotos del anexo fotográfico por sus BYTES (no por la
 * extensión ni por el tipo que declara el navegador). Función PURA:
 * reglas-fotos.spec.ts.
 */

/** PNG o JPEG según la firma del fichero; null si no es ninguno de los dos. */
export function tipoImagen(buf: Buffer | Uint8Array | null | undefined): "image/png" | "image/jpeg" | null {
  if (!buf || buf.length < 8) return null;
  const b = buf;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  if (png) return "image/png";
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return jpg ? "image/jpeg" : null;
}

/** Lado máximo y píxeles máximos de una foto: evita imágenes que al descomprimirse ocupan GB. */
export const MAX_LADO_FOTO = 8000;
export const MAX_PIXELES_FOTO = 40_000_000;

/** Ancho y alto declarados en la cabecera (PNG: IHDR; JPEG: marcador SOF). null si no se encuentran. */
export function dimensionesImagen(buf: Buffer | Uint8Array, mime: "image/png" | "image/jpeg"): { ancho: number; alto: number } | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (mime === "image/png") {
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return null;
    return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marca = b[i + 1];
    if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7) || marca === 0xff) { i += marca === 0xff ? 1 : 2; continue; }
    const largo = b.readUInt16BE(i + 2);
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc)
      return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
    if (largo < 2) return null;
    i += 2 + largo;
  }
  return null;
}

/** Motivo por el que una foto no se acepta por su tamaño en píxeles, o null. */
export function errorDimensionesFoto(buf: Buffer | Uint8Array, mime: "image/png" | "image/jpeg"): string | null {
  const d = dimensionesImagen(buf, mime);
  if (!d || d.ancho <= 0 || d.alto <= 0) return "No se pudieron leer las dimensiones de la imagen.";
  if (d.ancho > MAX_LADO_FOTO || d.alto > MAX_LADO_FOTO || d.ancho * d.alto > MAX_PIXELES_FOTO)
    return `La foto mide ${d.ancho} × ${d.alto} px: el máximo es ${MAX_LADO_FOTO} px por lado y ${MAX_PIXELES_FOTO / 1_000_000} megapíxeles (la pantalla las reduce a 1600 px).`;
  return null;
}
