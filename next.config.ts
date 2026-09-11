import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  devIndicators: false, // the "N" badge bottom-left in dev
  // Let `next build` run while `next dev` is up without the two clobbering each other's .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};
export default nextConfig;
