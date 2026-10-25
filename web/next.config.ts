import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // `next upgrade --agent=security` (2026-10-25): keep security upgrade
    // nudges enabled for coding agents.
    agentUpgrade: "security",
  },
  // Dev-only same-origin proxy: browser calls /api/v1 on THIS origin and Next
  // forwards to the NestJS API, so the app works from any host (LAN IP,
  // tunnels) without CORS. Set NEXT_PUBLIC_API_URL=/api/v1 when using this.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://127.0.0.1:3001/api/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
