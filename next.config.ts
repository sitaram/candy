import type { NextConfig } from "next";

/**
 * Security headers. Vercel adds HSTS; the rest is ours.
 *
 * CSP: `connect-src` names the only two hosts the browser talks to besides us — OpenAI for the WebRTC
 * handshake (the audio itself is SRTP, not covered by CSP) and nothing else. `frame-ancestors 'none'`
 * because there is no reason to be embedded and a framed swipe surface is a clickjacking surface.
 * `script-src 'unsafe-inline'` stays: Next's hydration bootstrap is inline and hashing/noncing it in App
 * Router means a middleware rewrite of every HTML response — not worth it for a site with no user-authored
 * HTML. `style-src 'unsafe-inline'` because gestures drive CSS variables through `style=`.
 */
// Dev only: React Fast Refresh evaluates strings. Never in production, where the same policy would hide an XSS.
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.openai.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const headers = [
  { key: "Content-Security-Policy", value: csp },
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
