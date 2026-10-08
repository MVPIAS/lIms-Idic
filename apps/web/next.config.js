/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
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
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
