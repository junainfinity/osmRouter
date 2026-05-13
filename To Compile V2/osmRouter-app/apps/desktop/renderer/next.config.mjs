/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  // Renderer is loaded via file:// — relative asset paths are mandatory.
  assetPrefix: "./",
  images: { unoptimized: true },
  // CSP is set via Electron response headers in Main. Don't duplicate here.
};
export default nextConfig;
