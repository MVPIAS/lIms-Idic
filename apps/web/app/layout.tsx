import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LIMS IDIC · Sistema de Gestión de Laboratorios",
  description: "Instituto de Investigaciones y Control · Ejército de Chile",
};

/**
 * OBLIGATORIO PARA LA CSP CON NONCE (ver apps/web/middleware.ts).
 *
 * El nonce se genera por request, así que el HTML tiene que generarse por
 * request. Sin esta línea, Next prerenderiza estas rutas en build (`○ Static`)
 * y congela un HTML SIN atributos nonce; `base-server` lo sirve desde caché sin
 * pasar por app-render, de modo que el nonce del middleware nunca se estampa.
 * Como la CSP lleva 'strict-dynamic' (que ANULA 'self'), todos los <script> de
 * Next quedarían bloqueados => aplicación en blanco.
 *
 * Verificado: sin esta línea, /dashboard sirve 13 <script> sin nonce; con ella,
 * los 13 llevan el nonce del request y la CSP valida.
 *
 * Coste: se pierde el prerender estático (34 rutas pasan a `ƒ` SSR on-demand).
 * Asumible: es un LIMS interno tras login, sin tráfico anónimo masivo, y las
 * páginas ya son client components que de todos modos cargan sus datos vía API.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
