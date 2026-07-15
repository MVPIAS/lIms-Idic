import { NextRequest, NextResponse } from "next/server";

/**
 * CSP con NONCE por request (patrón oficial Next.js 14 App Router).
 *
 * ── CÓMO FUNCIONA ─────────────────────────────────────────────────────────
 * Next.js NO lee la cabecera `x-nonce`. Lee la cabecera de REQUEST
 * `content-security-policy`, extrae el primer `'nonce-...'` de la directiva
 * `script-src` (fallback a `default-src`) y lo estampa en todos los <script>
 * que emite (bootstrap inline `self.__next_f.push`, chunks, preloads).
 * Ver: next/dist/server/app-render/app-render.js -> getScriptNonceFromHeader().
 * Por eso reenviamos la CSP en los REQUEST headers, no solo en la respuesta.
 * `x-nonce` se expone además para que Server Components puedan leerlo con
 * headers() si algún día se necesita (<Script nonce={...} />).
 *
 * ── REQUISITO CRÍTICO: RENDER DINÁMICO ───────────────────────────────────
 * Un nonce por request sólo puede inyectarse si el HTML se genera por
 * request. Si una ruta está prerenderizada estáticamente (`○ Static`), su
 * HTML se congela en build SIN nonce y `base-server` lo sirve tal cual: el
 * middleware nunca llega a app-render. Con `'strict-dynamic'` (que anula
 * `'self'`) esos <script> quedarían BLOQUEADOS -> pantalla en blanco.
 * => Las rutas servidas con esta CSP DEBEN renderizarse dinámicamente.
 *    Ver nota en docs/seguridad y `export const dynamic` en app/layout.tsx.
 */

const isDev = process.env.NODE_ENV === "development";

export function middleware(request: NextRequest) {
  // 128 bits de entropía por request. En Edge runtime `crypto` es global.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const csp = [
    `default-src 'self'`,

    // script-src: el corazón del endurecimiento.
    // - 'nonce-<n>'      : sólo ejecuta lo que este servidor firmó en este request.
    // - 'strict-dynamic' : los scripts con nonce pueden cargar sus propios chunks
    //                      (webpack los inyecta dinámicamente). Ojo: 'strict-dynamic'
    //                      hace que 'self' sea IGNORADO en navegadores CSP3; se deja
    //                      'self' sólo como fallback para CSP2 legacy.
    // - SIN 'unsafe-inline': un XSS reflejado ya no puede ejecutar <script>.
    // - 'unsafe-eval'    : SOLO dev (webpack HMR / react-refresh usan eval).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,

    // style-src: SE MANTIENE 'unsafe-inline' Y SE OMITE EL NONCE. DELIBERADO.
    // Motivo: por spec CSP3, si style-src lleva un nonce, 'unsafe-inline' queda
    // ANULADO. La app usa 112 atributos `style={{...}}` en las páginas, y los
    // atributos style NUNCA pueden llevar nonce (sólo los cubre 'unsafe-inline'
    // vía style-src / style-src-attr). Poner el nonce aquí romperia toda la UI.
    // Riesgo residual asumido: CSS injection (defacement / exfiltración por
    // selectores). Es muy inferior al de ejecutar JS. Eliminarlo exige refactor
    // de las páginas a clases Tailwind => fuera del alcance de este cambio.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,

    // globals.css hace @import de fonts.googleapis.com; los .woff2 salen de gstatic.
    `font-src 'self' https://fonts.gstatic.com data:`,

    `img-src 'self' data: https:`,

    // La API va bajo /api del MISMO dominio (Caddy la enruta a NestJS) => 'self'.
    // En dev, el websocket de HMR (ws://localhost:3000) es same-origin y 'self'
    // lo cubre en navegadores modernos.
    `connect-src 'self'`,

    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `form-action 'self'`,
  ].join("; ");

  // Next necesita ver la CSP en los headers de REQUEST para extraer el nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Y el navegador la necesita en los headers de RESPUESTA para aplicarla.
  response.headers.set("content-security-policy", csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Se excluyen:
     *  - api             -> lo sirve NestJS (helmet ya pone su propia CSP)
     *  - _next/static    -> chunks JS/CSS inmutables, no son documentos
     *  - _next/image     -> optimizador de imágenes
     *  - favicon.ico     -> asset estático
     *  - *.svg|png|jpg…  -> assets de /public
     * Añadir CSP a un asset no aporta nada y rompería su cacheabilidad.
     */
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
      // Las peticiones de prefetch del router se excluyen: se cachean y
      // reutilizarían un nonce viejo (patrón recomendado en la doc de Next).
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "x-middleware-prefetch" },
      ],
    },
  ],
};
