/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Les rendus des participants sont servis par notre propre route /api/media :
  // les faire transiter par l'optimiseur Next reintroduirait un cache indexe
  // par URL, donc un risque de fuite entre deux sessions.
  images: { unoptimized: true },
};

export default nextConfig;
