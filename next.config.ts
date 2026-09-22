import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  typescript: { ignoreBuildErrors: true }
};
export default nextConfig;
