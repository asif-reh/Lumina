import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A long-running Node server, not a serverless bundle. Tectonic and the
  // project directory need a real process and a writable filesystem.
  output: "standalone",
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
