import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // `next upgrade --agent=security` (2026-10-25): keep security upgrade
    // nudges enabled for coding agents.
    agentUpgrade: "security",
    // Instant-navigation validation is implicit for every page under
    // cacheComponents, but this app's auth gate withholds children until the
    // session restores from localStorage — so no authenticated page can render
    // during validation and each one is reported as a "dropped segment" in the
    // dev overlay. Only segments that opt in with `instant` are validated;
    // flip to "warning" (and adopt `instant` per page) once the session is
    // server-visible, e.g. via a cookie.
    instantInsights: {
      validationLevel: "manual-warning",
    },
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
