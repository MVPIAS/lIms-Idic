/**
 * fx5-c · F003 · Emisión robusta de documentos · regla PURA (reintento-emision.spec.ts).
 *
 * «Emitir Certificado de control» justo después de aprobar los resultados
 * fallaba a veces con «Error interno del servidor» y a la segunda funcionaba.
 * Causa probable: la emisión reserva el correlativo y RENDERIZA el documento
 * dentro de una transacción interactiva con el plazo por defecto de Prisma
 * (5 s de duración y 2 s para obtener conexión). En frío, o con la base ocupada
 * por la aprobación recién hecha (recálculo de veredictos, avisos), el render
 * pasa de 5 s o no hay conexión a tiempo: Prisma cierra la transacción (P2028)
 * y la API respondía 500. Dos emisiones casi simultáneas pueden además chocar en
 * el número (UNIQUE tenant/código, P2002) o en un bloqueo (P2034, 40001/40P01).
 *
 * Corrección: plazo amplio para la transacción y UN reintento controlado solo
 * ante esos errores transitorios. Todo ocurre dentro de la transacción, así que
 * un intento fallido no deja documento ni consume el correlativo.
 */

/** Plazos de la transacción de emisión (los mismos que el registro de muestras). */
export const PLAZO_TX_EMISION = { maxWait: 15_000, timeout: 120_000 } as const;

const CODIGOS_TRANSITORIOS = new Set(["P2028", "P2034", "P2024", "P2002"]);
const TEXTOS_TRANSITORIOS = [/transaction already closed/i, /transaction api error/i, /could not serialize/i, /deadlock detected/i, /timed out fetching a new connection/i, /40001|40P01/];

/** ¿El error es transitorio (vale la pena repetir la emisión una vez)? */
export function esErrorTransitorio(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const x = e as { code?: unknown; message?: unknown; meta?: { target?: unknown } };
  const code = typeof x.code === "string" ? x.code : "";
  if (code === "P2002") {
    // Solo el choque de número del documento (UNIQUE tenant/código o número), no cualquier duplicado.
    const target = JSON.stringify(x.meta?.target ?? "");
    return /codigo|numero/i.test(target) || target === '""';
  }
  if (CODIGOS_TRANSITORIOS.has(code)) return true;
  const msg = typeof x.message === "string" ? x.message : "";
  return TEXTOS_TRANSITORIOS.some((r) => r.test(msg));
}

/** Ejecuta `fn` y, si falla con un error transitorio, lo repite (hasta `reintentos` veces). */
export async function conReintento<T>(fn: () => Promise<T>, reintentos = 1, esperaMs = 300): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      if (intento >= reintentos || !esErrorTransitorio(e)) throw e;
      if (esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs * (intento + 1)));
    }
  }
}
