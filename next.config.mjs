/** @type {import('next').NextConfig} */
const nextConfig = {
  // Genera un servidor Node.js autocontenido (necesario para Electron/desktop)
  output: 'standalone',

  // Desactivar x-powered-by header por seguridad
  poweredByHeader: false,

  // Optimización de imágenes
  images: {
    domains: [],
  },

  // Headers para mejorar compatibilidad
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
