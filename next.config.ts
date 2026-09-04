import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows an isolated build directory during verification runs.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.1.195"],
  turbopack: { root: process.cwd() },
  experimental: { proxyClientMaxBodySize: "75mb" },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};

export default nextConfig;
