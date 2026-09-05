import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

function developmentOrigins() {
  const origins = new Set(["localhost", "127.0.0.1"]);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) if (!address.internal && address.family === "IPv4") origins.add(address.address);
  }
  for (const value of (process.env.DEV_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = value.trim();
    if (origin) origins.add(origin);
  }
  if (process.env.APP_URL) {
    try { origins.add(new URL(process.env.APP_URL).hostname); } catch { /* db/setup validation reports malformed URLs */ }
  }
  return [...origins];
}

const nextConfig: NextConfig = {
  // Allows an isolated build directory during verification runs.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  allowedDevOrigins: developmentOrigins(),
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
