import type { NextConfig } from "next";

/**
 * Static security headers. Vercel adds HSTS. The Content-Security-Policy is *not* here: it carries a
 * per-request nonce and is set by middleware.ts, the one place the browser's rules are written.
 */
const headers = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The microphone is the one powerful permission this app uses; everything else is off, and nothing embedded gets it.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  devIndicators: false, // the "N" badge bottom-left in dev
  // Let `next build` run while `next dev` is up without the two clobbering each other's .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers }];
  },
};
export default nextConfig;
