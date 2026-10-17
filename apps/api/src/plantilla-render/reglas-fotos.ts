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
