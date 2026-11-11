import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desk is entirely request-driven. Cache Components left the client
  // shell on "Opening the desk…" and never ran its effects.
  cacheComponents: false,
  partialPrefetching: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      bodySizeLimit: "32mb",
    },
    proxyClientMaxBodySize: "32mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
