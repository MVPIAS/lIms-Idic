/**
 * Inteligencia de negocio (Metabase, contrato §4.7.5 / §4.5.7 / §4.6.5) · regla
 * PURA de la dirección que abre el menú «Análisis e inteligencia de negocio».
 * La fija la variable de entorno URL_BI (docker-compose.prod.yml:
 * https://bi.<dominio>). Probada en respaldos.reglas.spec.ts.
 */

/** Dirección http(s) válida sin barra final, o null si falta o no es una URL. */
export function urlBi(valor: string | null | undefined): string | null {
  const s = String(valor ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // Sin credenciales embebidas: la URL se muestra en pantalla.
    if (u.username || u.password) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
