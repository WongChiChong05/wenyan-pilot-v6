/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  serverExternalPackages: ['pg'],
  // Never bundle local research records or backups into a serverless deployment.
  outputFileTracingExcludes: {
    '/**': ['./data/**/*', './backups/**/*', './tmp/**/*', './.verify/**/*'],
  },
};

export default nextConfig;
