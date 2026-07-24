import type { NextConfig } from 'next';

// Rewrite /api/* to the backend API. The browser only ever talks to this
// Next.js origin, so cookies flow same-origin (no CORS/credentials dance)
// and the API's Origin-header check (C6 S2/S9) sees the web app's own
// origin rather than a cross-origin API host.
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
