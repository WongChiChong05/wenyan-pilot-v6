/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Answer keys live only in server code; fail the build if anything imports them client-side.
  experimental: { typedRoutes: false },
};

export default nextConfig;
