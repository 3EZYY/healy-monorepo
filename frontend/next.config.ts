import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Pin the workspace root to THIS directory (frontend/) so Turbopack stops
  // walking up the tree, finding the repo-root package-lock.json, and
  // mis-resolving deps (e.g. tailwindcss) from the root node_modules.
  // Must be an absolute path (Next.js 16.2.4 turbopack.root).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
