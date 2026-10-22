/**
 * Imágenes del certificado de calibración: logo de acreditación (configuración) y
 * esquema de la calibración (por defecto el del proceso; o uno propio; o ninguno).
 * Solo PNG o JPEG reconocidos por sus bytes y con dimensiones acotadas
 * (plantilla-render/reglas-fotos.ts). Funciones PURAS: imagenes.spec.ts.
 */
import { dimensionesImagen, errorDimensionesFoto, tipoImagen } from "../../plantilla-render/reglas-fotos";
import type { ImagenCert } from "../metrologia.certificado";
import type { Presentacion } from "./presentacion";

export const CLAVE_LOGO = "logo_acreditacion";
/** Tamaño máximo de una imagen del certificado (bytes). */
export const MAX_IMAGEN_BYTES = 2 * 1024 * 1024;
const CLAVE = /^(logo_acreditacion|esquema:[A-Za-z0-9-]{2,20})$/;

export const claveEsquema = (proceso: string) => `esquema:${proceso}`;
/** Procesos ITV02a/g/c comparten el esquema de ITV02 si no tienen uno propio. */
export const clavesEsquema = (proceso: string) => [claveEsquema(proceso), claveEsquema(proceso.replace(/[a-z]$/, ""))];
export const claveValida = (c: string) => CLAVE.test(c);

/** Motivo de rechazo de una imagen subida, o su tipo. */
export function revisarImagen(buf: Buffer | null | undefined): { error: string } | { mime: "image/png" | "image/jpeg" } {
  if (!buf?.length) return { error: "Adjunte una imagen PNG o JPEG." };
  if (buf.length > MAX_IMAGEN_BYTES) return { error: `La imagen no puede superar ${MAX_IMAGEN_BYTES / 1024 / 1024} MB.` };
  const mime = tipoImagen(buf);
  if (!mime) return { error: "El archivo no es una imagen PNG o JPEG válida." };
  const dim = errorDimensionesFoto(buf, mime);
  if (dim) return { error: dim };
  return { mime };
}

/** Imagen lista para el certificado (data URL y dimensiones), o null si no se puede leer. */
export function imagenCert(mime: string | null | undefined, b64: string | null | undefined): ImagenCert | null {
  if (!b64 || (mime !== "image/png" && mime !== "image/jpeg")) return null;
  const d = dimensionesImagen(Buffer.from(b64, "base64"), mime);
  if (!d || d.ancho <= 0 || d.alto <= 0) return null;
  return { src: `data:${mime};base64,${b64}`, ancho: d.ancho, alto: d.alto };
}

export interface FilaImagen { clave: string; titulo: string | null; mime: string; datos: string }

/** Esquema que se imprime según el modo elegido en la presentación. */
export function esquemaEfectivo(
  p: Pick<Presentacion, "esquemaModo">,
  propio: { mime: string | null; datos: string | null },
  defecto: FilaImagen | null,
): (ImagenCert & { titulo: string; origen: "propio" | "defecto" }) | null {
  if (p.esquemaModo === "ninguno") return null;
  const titulo = defecto?.titulo || "Esquema de la calibración";
  if (p.esquemaModo === "propio") {
    const i = imagenCert(propio.mime, propio.datos);
    return i ? { ...i, titulo, origen: "propio" } : null;
  }
  const i = defecto ? imagenCert(defecto.mime, defecto.datos) : null;
  return i ? { ...i, titulo, origen: "defecto" } : null;
}
