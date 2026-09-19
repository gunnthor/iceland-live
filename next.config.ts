import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // maplibre-gl ships a large ESM bundle; keep it out of the server graph.
    optimizePackageImports: ["maplibre-gl"],
  },
};

export default nextConfig;
