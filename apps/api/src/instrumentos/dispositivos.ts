/**
 * Instrumentos conectados por puerto serie (RS-232) o Ethernet (contrato
 * §4.4.7) · funciones PURAS, probadas en dispositivos.spec.ts.
 *
 * Un servidor web no puede abrir el puerto serie del PC del laboratorio: lo
 * hace el «agente de instrumentos» (tools/agente-instrumentos), instalado en
 * el PC conectado al equipo. El agente lee las tramas del puerto serie o del
 * socket TCP, las limpia (STX/ETX, retornos) y las envía al LIMS con un token
 * de dispositivo. El LIMS las interpreta con el perfil del instrumento (el
 * mismo lector de archivos, lector.ts) y las deja como lectura pendiente de
 * revisión en «Datos de instrumentos», igual que un archivo cargado a mano.
 */
import { createHash, randomBytes } from "crypto";

export const PREFIJO_TOKEN = "lims_disp_";
/** Límites de un envío del agente (el cuerpo JSON de Nest admite ~100 kB). */
export const MAX_TRAMAS = 2000;
export const MAX_LARGO_TRAMA = 2000;
export const MAX_TEXTO = 90_000;

export class IngestaError extends Error {}

/** Token nuevo: se muestra una sola vez; en la BD queda solo su SHA-256 y el prefijo. */
export function generarToken(): { token: string; hash: string; prefijo: string } {
  const token = `${PREFIJO_TOKEN}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefijo: token.slice(0, PREFIJO_TOKEN.length + 6) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Token del dispositivo en la petición: «Authorization: Bearer lims_disp_…» o
 * la cabecera «X-Token-Dispositivo». Un JWT de usuario no sirve aquí.
 */
export function tokenDeCabeceras(h: Record<string, unknown> | undefined): string | null {
  const directo = h?.["x-token-dispositivo"];
  if (typeof directo === "string" && directo.trim().startsWith(PREFIJO_TOKEN)) return directo.trim();
  const auth = h?.["authorization"];
  if (typeof auth !== "string") return null;
  const m = /^(?:Bearer|Dispositivo)\s+(\S+)$/i.exec(auth.trim());
  return m && m[1].startsWith(PREFIJO_TOKEN) && m[1].length <= 120 ? m[1] : null;
}

/**
 * Trama limpia: sin caracteres de control del protocolo (STX, ETX, EOT, ENQ,
 * ACK, NAK, NUL…) ni retornos; se conserva el tabulador (separador de campos).
 */
export function limpiarTrama(t: string): string {
  return t.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, "").trim();
}

/**
 * Texto que se interpreta con el perfil: las tramas, una por línea. Si el
 * perfil (CSV/TXT) espera cabecera en la fila N, el agente debe enviarla
 * («cabecera» en su configuración): los equipos serie no la repiten en cada
 * trama.
 */
export function textoDeLecturas(
  b: { tramas?: unknown; cabecera?: unknown } | null | undefined,
  perfil: { formato: string; filaCabecera: number },
): { texto: string; tramas: number } {
  if (!b || !Array.isArray(b.tramas) || !b.tramas.length) throw new IngestaError("El envío no trae tramas.");
  if (b.tramas.length > MAX_TRAMAS) throw new IngestaError(`Como máximo ${MAX_TRAMAS} tramas por envío.`);
  const tramas: string[] = [];
  for (const t of b.tramas) {
    if (typeof t !== "string") throw new IngestaError("Cada trama debe ser texto.");
    if (t.length > MAX_LARGO_TRAMA) throw new IngestaError(`Una trama supera ${MAX_LARGO_TRAMA} caracteres.`);
    const limpia = limpiarTrama(t);
    if (limpia) tramas.push(limpia);
  }
  if (!tramas.length) throw new IngestaError("Las tramas recibidas no traen datos.");
  let lineas = tramas;
  if (perfil.formato !== "XML" && perfil.filaCabecera > 0) {
    const cabecera = typeof b.cabecera === "string" ? limpiarTrama(b.cabecera) : "";
    if (!cabecera)
      throw new IngestaError(
        `El perfil espera la cabecera en la fila ${perfil.filaCabecera}: configure «cabecera» en el agente o use un perfil sin cabecera (fila 0, columnas por número).`,
      );
    lineas = [...Array(perfil.filaCabecera - 1).fill(""), cabecera, ...tramas];
  }
  const texto = lineas.join("\n");
  if (texto.length > MAX_TEXTO) throw new IngestaError("El envío es demasiado grande: reduzca el tamaño del lote en el agente.");
  return { texto, tramas: tramas.length };
}

/** Datos de alta de un dispositivo (pantalla «Dispositivos conectados»). */
export function datosDispositivo(b: any): { perfilId: string; nombre: string; conexion: "SERIE" | "ETHERNET"; ubicacion: string | null } {
  const nombre = typeof b?.nombre === "string" ? b.nombre.trim() : "";
  if (nombre.length < 3) throw new IngestaError("Indique el nombre del dispositivo (mínimo 3 caracteres).");
  if (nombre.length > 120) throw new IngestaError("Nombre del dispositivo: como máximo 120 caracteres.");
  const perfilId = typeof b?.perfilId === "string" ? b.perfilId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(perfilId)) throw new IngestaError("Elija el perfil del instrumento.");
  const conexion = b?.conexion === "ETHERNET" ? "ETHERNET" : b?.conexion === "SERIE" || b?.conexion == null ? "SERIE" : null;
  if (!conexion) throw new IngestaError("Conexión: «SERIE» (RS-232) o «ETHERNET».");
  const ubicacion = typeof b?.ubicacion === "string" && b.ubicacion.trim() ? b.ubicacion.trim().slice(0, 200) : null;
  return { perfilId, nombre, conexion, ubicacion };
}
