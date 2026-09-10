import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep this minimal on purpose: no image domains, no rewrites, no
  // experimental flags. The dashboard talks to Livqeno's Control API only
  // via server-side fetches (see src/lib/api-client.ts), never a proxy.
};

export default nextConfig;
