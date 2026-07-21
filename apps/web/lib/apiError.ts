/**
 * apiError · helper compartido para traducir respuestas de error del API a un
 * mensaje legible para el usuario.
 *
 * El backend responde los 400 de validación con la forma:
 *   { "message": "Validación fallida", "issues": [{ "path": "rut", "message": "…" }] }
 * y los errores simples con solo `{ "message": "…" }`. Estas utilidades componen
 * un texto único que los formularios pueden mostrar en un `.alert warn`, para que
 * un 400 nunca deje el formulario "en silencio".
 */

/** Una incidencia de validación tal como la emite el backend (Zod). */
export interface ApiIssue {
  path?: string | (string | number)[];
  message?: string;
}

/** Normaliza `path` (string, array o ausente) a un texto plano. */
function pathTexto(path: ApiIssue["path"]): string {
  if (Array.isArray(path)) return path.join(".");
  return path ?? "";
}

/**
 * Compone el mensaje a partir de un body ya parseado y el status HTTP.
 * - Si trae `issues`, devuelve `"<message>: path: msg; path2: msg2"`.
 * - Si trae solo `message`, lo devuelve tal cual.
 * - Si no hay nada aprovechable, devuelve `"HTTP <status>"`.
 */
export function errorMensajeDe(body: any, status: number): string {
  const base = typeof body?.message === "string" && body.message.trim() ? body.message.trim() : "";
  const issues: ApiIssue[] = Array.isArray(body?.issues) ? body.issues : [];

  if (issues.length > 0) {
    const detalle = issues
      .map((i) => {
        const p = pathTexto(i?.path);
        const m = i?.message ?? "";
        return p ? `${p}: ${m}` : m;
      })
      .filter(Boolean)
      .join("; ");
    if (base && detalle) return `${base}: ${detalle}`;
    return detalle || base || `HTTP ${status}`;
  }

  if (base) return base;
  return `HTTP ${status}`;
}

/**
 * Lee el JSON de un `Response` de error y devuelve el mensaje compuesto.
 * Tolerante a cuerpos no-JSON (o vacíos): en ese caso cae a `"HTTP <status>"`.
 */
export async function errorMensaje(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return errorMensajeDe(body, res.status);
}
