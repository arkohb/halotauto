import type { NextConfig } from "next";

// Security headers on every response. The Content-Security-Policy itself is
// set per request in src/proxy.ts (it needs a fresh nonce for every page).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone stays allowed for this origin — HALO's voice commands use it
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // HALO_DIST_DIR lets a verification build run beside the live one without
  // overwriting the .next/standalone build the server is running from
  distDir: process.env.HALO_DIST_DIR || ".next",
  poweredByHeader: false,
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
