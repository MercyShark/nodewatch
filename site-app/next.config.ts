import type { NextConfig } from "next";

// Static export: the site is plain files, so it can be hosted anywhere (GitHub Pages, S3-less: any static host).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // This folder is its own package; do not infer the monorepo above as the workspace root.
  turbopack: { root: __dirname },
};

export default nextConfig;
