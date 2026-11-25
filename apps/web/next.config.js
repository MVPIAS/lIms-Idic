/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No anunciar el framework en cada respuesta (cabecera X-Powered-By).
  poweredByHeader: false,
  // El LIMS no usa next/image. Con el optimizador apagado, la ruta
  // /_next/image deja de procesar imágenes, y con ella desaparece la
  // superficie de las fallas publicadas para ese componente.
  images: { unoptimized: true },
  typedRoutes: true,
  /**
   * Rutas legacy del catálogo que tienen equivalente en el catálogo v2: se
   * redirigen (307, temporal) para que marcadores y enlaces antiguos sigan
   * funcionando sin mantener dos pantallas para la misma tabla maestra.
   */
  async redirects() {
    return [
      { source: "/metodos", destination: "/catalogo/metodos", permanent: false },
      { source: "/analitos", destination: "/catalogo/analitos", permanent: false },
      { source: "/gran-grupos", destination: "/catalogo/gran-grupos", permanent: false },
      { source: "/grupos", destination: "/catalogo/grupos", permanent: false },
      // Internaciones: una sola pantalla para BPCH y Comercial (la comercial antigua redirige).
      { source: "/internaciones", destination: "/bpch/internaciones", permanent: false },
    ];
  },
  async rewrites() {
    // En producción Caddy envía /api/* directo a la API y este reenvío no se
    // usa. Las reglas de reenvío se fijan al compilar, así que en la imagen
    // apuntarían a localhost:3001, que dentro del contenedor web no existe:
    // una ruta rara (por ejemplo con «..») terminaba en error 500. Solo se
    // deja para el entorno de desarrollo.
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
