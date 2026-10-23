/**
 * URL base de la verificación pública de documentos (la que se imprime en el
 * pie y en el QR; la pantalla es /verificar/<código> de la web). B-079: es un
 * parámetro de la instalación, no el dominio de producción:
 *   1. URL_VERIFICACION, si se definió (deploy/onpremise/conf/env.onpremise.example);
 *   2. si no, el sitio de la propia instalación: https://<DOMAIN>/verificar o el
 *      primer origen de CORS_ORIGINS (que en preproducción y on-premise es el dominio);
 *   3. en desarrollo sin nada configurado, /verificar (ruta relativa).
 */
export function urlVerificacionBase(env: NodeJS.ProcessEnv = process.env): string {
  const limpia = (u: string) => u.trim().replace(/\/+$/, "");
  const explicita = env.URL_VERIFICACION?.trim();
  if (explicita) return limpia(explicita);
  const dominio = env.DOMAIN?.trim().replace(/^https?:\/\//, "");
  if (dominio) return `https://${limpia(dominio)}/verificar`;
  const origen = (env.CORS_ORIGINS ?? "").split(",").map((x) => x.trim()).find((x) => /^https?:\/\/[^/\s]+$/i.test(x.replace(/\/+$/, "")));
  if (origen) return `${limpia(origen)}/verificar`;
  return "/verificar";
}
