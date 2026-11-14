import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite and pg are server-only packages; keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
