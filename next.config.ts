import type { NextConfig } from "next";

// sql.js (CJS) statically requires Node's "fs"/"path" for its Node runtime;
// the browser client never uses that branch. Shim them for client bundles only
// (the `browser` condition), so server/Node bundles keep working normally.
const nodeShim = "./src/lib/node-shims.ts";

const nextConfig: NextConfig = {
  // Fully static export — the app is a client-side PWA with no server runtime.
  output: "export",

  // Allow HMR/live-refresh when the dev server is opened from these hosts.
  allowedDevOrigins: ["169.254.83.107"],

  turbopack: {
    resolveAlias: {
      fs: { browser: nodeShim },
      path: { browser: nodeShim },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false, path: false };
    }
    return config;
  },
};

export default nextConfig;