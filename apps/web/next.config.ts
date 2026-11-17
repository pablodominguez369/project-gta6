import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source.
  transpilePackages: ["@gta6/domain", "@gta6/config", "@gta6/db", "@gta6/observability"],
  experimental: {
    // Enables forbidden() so role checks answer with a real 403 status. Experimental in Next 16.
    authInterrupts: true,
  },
  poweredByHeader: false,
};

export default nextConfig;
